import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

const PUERTO_GRAFANA = process.env.PUERTO_GRAFANA_HOST || "3300";
const URL_GRAFANA = `http://localhost:${PUERTO_GRAFANA}/?refresh=5s&from=now-5m&to=now`;
const AUTO_DOWN = process.argv.includes("--auto-down");

const COMPOSE_K6 = ["compose", "-f", "docker-compose.yml", "-f", "carga/docker-compose.k6.yml"];

function ejecutarDocker(args, { permitirFallo = false } = {}) {
  const res = spawnSync("docker", args, { stdio: "inherit" });
  if (res.status !== 0 && !permitirFallo) {
    throw new Error(`El comando 'docker ${args.join(" ")}' falló con código ${res.status ?? 1}`);
  }
  return res.status ?? 1;
}

function abrirNavegador(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

function esperarMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esperarEnter(mensaje) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(mensaje, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  let codigoK6;
  let interrumpido = false;
  let grafanaAbierto = false;

  process.on("SIGINT", () => {
    interrumpido = true;
  });

  try {
    console.log("\n[1/4] Levantando Prometheus y Grafana (tablero k6)...");
    // Limpia contenedores previos de prometheus/grafana por si quedaron atados a una red vieja de docker compose down
    ejecutarDocker([...COMPOSE_K6, "--profile", "grafana", "rm", "-sf", "prometheus", "grafana"], {
      permitirFallo: true,
    });
    ejecutarDocker([...COMPOSE_K6, "--profile", "grafana", "up", "-d", "--wait"]);

    console.log(`[2/4] Abriendo Grafana automáticamente en ${URL_GRAFANA} ...`);
    abrirNavegador(URL_GRAFANA);
    grafanaAbierto = true;
    await esperarMs(2500);

    console.log("[3/4] Ejecutando prueba de estrés k6 (100 usuarios, ~50 s)...");
    codigoK6 = ejecutarDocker(
      [
        ...COMPOSE_K6,
        "run",
        "--rm",
        "-e",
        "K6_MODO=stress",
        "k6",
        "run",
        "-o",
        "experimental-prometheus-rw",
        "--summary-export=/resultados/k6-100-usuarios.json",
        "/scripts/carga-100-usuarios.js",
      ],
      { permitirFallo: true },
    );
  } finally {
    console.log("\n[4/4] Restaurando nginx y ms-tarifas al modo funcional normal (OSRM/Nominatim)...");
    ejecutarDocker(
      ["compose", "-f", "docker-compose.yml", "up", "-d", "--force-recreate", "nginx", "ms-tarifas"],
      { permitirFallo: true },
    );

    if (grafanaAbierto && !AUTO_DOWN && !interrumpido && process.stdin.isTTY) {
      await esperarEnter(
        "\n✓ La app en http://localhost:8080 ya volvió al estado normal.\n" +
          "  Grafana sigue abierto en http://localhost:" +
          PUERTO_GRAFANA +
          " para que muestres las curvas finales.\n" +
          "  Presioná ENTER cuando termines de mostrarlo para apagar Prometheus y Grafana... ",
      );
    }

    console.log("Apagando y limpiando Prometheus y Grafana...");
    ejecutarDocker([...COMPOSE_K6, "--profile", "grafana", "rm", "-sf", "prometheus", "grafana"], {
      permitirFallo: true,
    });
    console.log("✓ Entorno restaurado al estado funcional normal.");
  }

  process.exit(codigoK6 ?? 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
