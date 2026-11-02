import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGUMENTOS_COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "carga/docker-compose.mediciones.yml"];
const CENTRO_RESISTENCIA = { latitud: -27.451, longitud: -58.986 };
const RADIO_PRUEBA_METROS = 5_000;
const MAXIMO_COLA = 30_000;

export function analizarArgumentos(argumentos) {
  const opciones = {
    ayuda: false,
    modo: "completa",
    escenario: "carga",
    baseUrl: "http://localhost:8080",
    choferes: undefined,
    calentamientoSegundos: undefined,
    duracionSegundos: undefined,
    recuperacionSegundos: undefined,
    semilla: 42,
    concurrencia: 256,
    repeticion: 1
  };
  const nombres = new Map([
    ["--modo", "modo"], ["--escenario", "escenario"], ["--base-url", "baseUrl"],
    ["--choferes", "choferes"], ["--calentamiento-segundos", "calentamientoSegundos"],
    ["--duracion-segundos", "duracionSegundos"], ["--recuperacion-segundos", "recuperacionSegundos"],
    ["--semilla", "semilla"], ["--concurrencia", "concurrencia"], ["--repeticion", "repeticion"]
  ]);

  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const argumento = argumentos[indice];
    if (argumento === "--ayuda" || argumento === "-h") { opciones.ayuda = true; continue; }
    const nombre = nombres.get(argumento);
    if (!nombre) throw new Error(`Opción desconocida: ${argumento}`);
    const valor = argumentos[indice + 1];
    if (!valor || valor.startsWith("--")) throw new Error(`Falta el valor de ${argumento}.`);
    opciones[nombre] = nombre === "baseUrl" || nombre === "modo" || nombre === "escenario" ? valor : Number(valor);
    indice += 1;
  }

  if (opciones.modo !== "completa" && opciones.modo !== "prueba") throw new Error("--modo debe ser completa o prueba.");
  if (opciones.escenario !== "carga" && opciones.escenario !== "reposo") throw new Error("--escenario debe ser carga o reposo.");
  const valoresPorDefecto = opciones.modo === "prueba"
    ? { choferes: 5, calentamientoSegundos: 2, duracionSegundos: 12, recuperacionSegundos: 1 }
    : { choferes: 500, calentamientoSegundos: 60, duracionSegundos: 300, recuperacionSegundos: 60 };
  for (const nombre of Object.keys(valoresPorDefecto)) opciones[nombre] ??= valoresPorDefecto[nombre];
  validarEntero(opciones.choferes, "choferes", 1, 500);
  validarEntero(opciones.calentamientoSegundos, "calentamiento", 0, 3600);
  validarEntero(opciones.duracionSegundos, "duración", 1, 3600);
  validarEntero(opciones.recuperacionSegundos, "recuperación", 0, 3600);
  validarEntero(opciones.semilla, "semilla", 1, 2_147_483_647);
  validarEntero(opciones.concurrencia, "concurrencia", 1, 1024);
  validarEntero(opciones.repeticion, "repetición", 1, 3);
  validarUrlLocal(opciones.baseUrl);
  return opciones;
}

export function crearGeneradorDeterminista(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado ^= estado << 13;
    estado ^= estado >>> 17;
    estado ^= estado << 5;
    return (estado >>> 0) / 4_294_967_296;
  };
}

export function crearUbicacionInicial(aleatorio) {
  const angulo = aleatorio() * Math.PI * 2;
  const radio = Math.sqrt(aleatorio()) * RADIO_PRUEBA_METROS;
  return {
    latitud: redondearCoordenada(CENTRO_RESISTENCIA.latitud + (radio * Math.cos(angulo)) / 111_320),
    longitud: redondearCoordenada(CENTRO_RESISTENCIA.longitud + (radio * Math.sin(angulo)) / (111_320 * Math.cos(CENTRO_RESISTENCIA.latitud * Math.PI / 180)))
  };
}

export function calcularPercentil(valores, percentil) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.max(0, Math.ceil((percentil / 100) * ordenados.length) - 1);
  return redondear(ordenados[indice]);
}

export function convertirMemoriaMiB(texto) {
  const coincidencia = texto.match(/([\d.,]+)\s*(B|KiB|MiB|GiB|kB|MB|GB)/i);
  if (!coincidencia) return null;
  const cantidad = Number(coincidencia[1].replace(",", "."));
  const unidad = coincidencia[2].toLowerCase();
  const factores = { b: 1 / (1024 * 1024), kib: 1 / 1024, mib: 1, gib: 1024, kb: 1000 / (1024 * 1024), mb: 1_000_000 / (1024 * 1024), gb: 1_000_000_000 / (1024 * 1024) };
  return Number.isFinite(cantidad) ? redondear(cantidad * factores[unidad]) : null;
}

export function crearTokenFalso(idUsuario, rol) {
  const carga = Buffer.from(JSON.stringify({ tipo: "jwt-falso", idUsuario, rol }), "utf8").toString("base64url");
  return `falso.${carga}`;
}

async function ejecutar() {
  let opciones;
  try { opciones = analizarArgumentos(process.argv.slice(2)); }
  catch (error) { console.error(error.message); console.error("Usá --ayuda para ver los comandos disponibles."); process.exitCode = 2; return; }
  if (opciones.ayuda) { console.log(textoAyuda()); return; }

  let idChoferes = [];
  let cola;
  let muestreadorRecursos;
  let interrumpido = false;
  const cancelar = () => { interrumpido = true; console.error("Interrupción recibida; se detendrán los envíos y se limpiarán los datos de prueba."); };
  process.once("SIGINT", cancelar);
  process.once("SIGTERM", cancelar);

  try {
    const contexto = verificarEntornoLocal();
    await verificarServicios(opciones);
    idChoferes = await prepararChoferes(opciones.choferes);
    if (idChoferes.length !== opciones.choferes) throw new Error("No se pudieron preparar todos los choferes de prueba; se limpiarán únicamente los que creó esta ejecución.");

    const aleatorio = crearGeneradorDeterminista(opciones.semilla);
    const choferes = idChoferes.map((idUsuario) => ({ idUsuario, token: crearTokenFalso(idUsuario, "CHOFER"), ubicacion: crearUbicacionInicial(aleatorio) }));
    const tokenPasajero = crearTokenFalso("pasajero-simulador-med-001", "PASAJERO");
    const informe = crearInforme(opciones, contexto);
    cola = crearColaSolicitudes(opciones.concurrencia, informe);

    const preparacion = await actualizarUbicacionesIniciales(opciones, choferes);
    if (preparacion.fallidas > 0) throw new Error(`Fallaron ${preparacion.fallidas} ubicaciones iniciales; no se inicia la medición.`);

    muestreadorRecursos = iniciarMuestreadorRecursos(informe);
    const fases = [
      { nombre: "calentamiento", duracion: opciones.calentamientoSegundos, medir: false },
      { nombre: "medicion", duracion: opciones.duracionSegundos, medir: true },
      { nombre: "recuperacion", duracion: opciones.recuperacionSegundos, medir: false }
    ];

    for (const fase of fases) {
      if (fase.duracion === 0 || interrumpido) continue;
      await ejecutarFase(fase, opciones, choferes, tokenPasajero, cola, informe, muestreadorRecursos, () => interrumpido);
    }
    await cola.drenar();
    await muestreadorRecursos.detener();
    muestreadorRecursos = undefined;
    informe.mediciones.contadores = cola.contadores();
    informe.mediciones.colaMaximaPendiente = cola.maximoEnEspera();
    informe.mediciones.procesoFlota = await leerMedicionesProcesoFlota(informe.fechas.medicionInicio, informe.fechas.medicionFin);
    if (informe.mediciones.procesoFlota.cantidad_ventanas === 0) informe.advertencias.push("No se capturaron ventanas de event loop/RSS dentro del período medido.");
    if (informe.mediciones.recursosFlota.length === 0) informe.advertencias.push("No se capturaron muestras de CPU/memoria del contenedor con docker stats.");
    else if (!informe.mediciones.recursosFlota.some((muestra) => muestra.cpu_porcentaje !== null)) informe.advertencias.push("Docker entregó memoria del contenedor, pero no un porcentaje de CPU válido.");
    informe.estado = interrumpido ? "interrumpida" : "completada";
    informe.resultados = resumirInforme(informe);
    const archivo = await guardarInforme(informe);
    console.log(JSON.stringify({ id_ejecucion: informe.id_ejecucion, estado: informe.estado, archivo, resultados: informe.resultados }, null, 2));
    if (interrumpido) process.exitCode = 130;
  } catch (error) {
    console.error(`No se completó la simulación: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await muestreadorRecursos?.detener().catch(() => undefined);
    await cola?.drenar().catch(() => undefined);
    if (idChoferes.length) {
      try { await limpiarChoferes(idChoferes); }
      catch (error) { console.error(`No se pudieron limpiar todos los datos de prueba: ${error.message}`); process.exitCode = 1; }
    }
    process.removeListener("SIGINT", cancelar);
    process.removeListener("SIGTERM", cancelar);
  }
}

function crearInforme(opciones, contexto) {
  return {
    id_ejecucion: randomUUID(),
    estado: "en_curso",
    fechas: { inicio: new Date().toISOString(), medicionInicio: null, medicionFin: null, fin: null },
    entorno: {
      commit: contexto.commit,
      version_node: process.version,
      plataforma: `${os.platform()}-${os.arch()}`,
      procesador: os.cpus()[0]?.model ?? "desconocido",
      memoria_host_mib: redondear(os.totalmem() / (1024 * 1024)),
      version_docker: contexto.versionDocker
    },
    configuracion: {
      escenario: opciones.escenario,
      cantidad_choferes: opciones.choferes,
      intervalo_ubicacion_ms: opciones.escenario === "carga" ? 2000 : null,
      calentamiento_segundos: opciones.calentamientoSegundos,
      duracion_medida_segundos: opciones.duracionSegundos,
      recuperacion_segundos: opciones.recuperacionSegundos,
      semilla: opciones.semilla,
      repeticion: opciones.repeticion,
      concurrencia_maxima: opciones.concurrencia,
      gateway_local: opciones.baseUrl
    },
    mediciones: { solicitudes: [], recursosFlota: [], procesoFlota: { ventanas: [], cantidad_ventanas: 0 } },
    advertencias: []
  };
}

function crearColaSolicitudes(concurrencia, informe) {
  const enEspera = [];
  const activas = new Set();
  const contadores = new Map();
  let maximoEnEspera = 0;

  function contador(fase, tipo) {
    const clave = `${fase}:${tipo}`;
    if (!contadores.has(clave)) contadores.set(clave, { fase, tipo, ofrecidas: 0, iniciadas: 0, perdidas: 0 });
    return contadores.get(clave);
  }

  function iniciarTrabajo(trabajo) {
    const promesa = Promise.resolve().then(trabajo.ejecutar).catch((error) => {
      informe.mediciones.solicitudes.push({ fase: trabajo.fase, tipo: trabajo.tipo, latencia_ms: null, espera_cola_ms: null, estado_http: null, error: clasificarError(error) });
    }).finally(() => {
      activas.delete(promesa);
      const siguiente = enEspera.shift();
      if (siguiente) iniciarTrabajo(siguiente);
    });
    activas.add(promesa);
  }

  return {
    enviar(fase, tipo, ejecutarTrabajo, programadaEn = performance.now()) {
      const cuenta = contador(fase, tipo);
      cuenta.ofrecidas += 1;
      const trabajo = { fase, tipo, ejecutar: async () => { cuenta.iniciadas += 1; await ejecutarTrabajo(programadaEn); } };
      if (activas.size < concurrencia) iniciarTrabajo(trabajo);
      else if (enEspera.length < MAXIMO_COLA) { enEspera.push(trabajo); maximoEnEspera = Math.max(maximoEnEspera, enEspera.length); }
      else {
        cuenta.perdidas += 1;
        informe.mediciones.solicitudes.push({ fase, tipo, latencia_ms: null, espera_cola_ms: null, estado_http: null, error: "cola_completa" });
      }
    },
    maximoEnEspera: () => maximoEnEspera,
    contadores: () => [...contadores.values()],
    async drenar() { while (activas.size || enEspera.length) await dormir(20); }
  };
}

async function ejecutarFase(fase, opciones, choferes, tokenPasajero, cola, informe, muestreadorRecursos, estaInterrumpida) {
  const inicio = performance.now();
  const fin = inicio + fase.duracion * 1000;
  if (fase.medir) {
    informe.fechas.medicionInicio = new Date().toISOString();
    muestreadorRecursos.iniciarMedicion();
  }
  const tareas = [];

  if (opciones.escenario === "carga") {
    const intervaloMs = 2000 / choferes.length;
    tareas.push(programarCada(intervaloMs, inicio, fin, estaInterrumpida, (indice, programada) => {
      const chofer = choferes[indice % choferes.length];
      chofer.ubicacion = moverUbicacion(chofer.ubicacion, opciones.semilla, indice);
      cola.enviar(fase.nombre, "actualizacion_ubicacion", (programadaEn) => solicitar(opciones.baseUrl, "/choferes/yo/ubicacion", "POST", chofer.token, {
        latitud: chofer.ubicacion.latitud,
        longitud: chofer.ubicacion.longitud,
        actualizado_at: new Date().toISOString(),
        precision_metros: 5
      }, fase.nombre, programadaEn, informe), programada);
    }));
  }

  tareas.push(programarCada(1000, inicio, fin, estaInterrumpida, (_indice, programada) => {
    cola.enviar(fase.nombre, "busqueda_cercanos", (programadaEn) => solicitar(
      opciones.baseUrl,
      `/choferes/cercanos?latitud=${CENTRO_RESISTENCIA.latitud}&longitud=${CENTRO_RESISTENCIA.longitud}&radio_metros=${RADIO_PRUEBA_METROS}`,
      "GET", tokenPasajero, undefined, fase.nombre, programadaEn, informe
    ), programada);
    cola.enviar(fase.nombre, "sonda_health", (programadaEn) => solicitar(opciones.baseUrl, "/health", "GET", undefined, undefined, fase.nombre, programadaEn, informe), programada);
    cola.enviar(fase.nombre, "sonda_ready_flota", (programadaEn) => solicitar(opciones.baseUrl, "/ready/flota", "GET", undefined, undefined, fase.nombre, programadaEn, informe), programada);
  }));

  await Promise.all(tareas);
  if (fase.medir) {
    muestreadorRecursos.terminarMedicion();
    informe.fechas.medicionFin = new Date().toISOString();
  }
  await cola.drenar();
  console.error(`Fase ${fase.nombre} completada (${fase.duracion}s).`);
}

async function programarCada(intervaloMs, inicio, fin, estaInterrumpida, accion) {
  let indice = 0;
  for (let programada = inicio; programada < fin && !estaInterrumpida(); programada = inicio + indice * intervaloMs) {
    await dormirHasta(programada);
    if (performance.now() >= fin || estaInterrumpida()) break;
    accion(indice, programada);
    indice += 1;
  }
}

async function solicitar(baseUrl, ruta, metodo, token, cuerpo, fase, programadaEn, informe) {
  const inicio = performance.now();
  const registro = { fase, tipo: tipoDeRuta(ruta), latencia_ms: null, espera_cola_ms: redondear(inicio - programadaEn), estado_http: null, error: null };
  const controlador = AbortSignal.timeout(10_000);
  try {
    const encabezados = {};
    if (token) encabezados.Authorization = `Bearer ${token}`;
    if (cuerpo) encabezados["Content-Type"] = "application/json";
    const respuesta = await fetch(new URL(ruta, baseUrl), {
      method: metodo,
      headers: encabezados,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: controlador
    });
    await respuesta.text();
    registro.estado_http = respuesta.status;
    registro.latencia_ms = redondear(performance.now() - inicio);
    if (!respuesta.ok) registro.error = `http_${respuesta.status}`;
  } catch (error) {
    registro.latencia_ms = redondear(performance.now() - inicio);
    registro.error = clasificarError(error);
  }
  informe.mediciones.solicitudes.push(registro);
}

function tipoDeRuta(ruta) {
  if (ruta.startsWith("/choferes/yo/ubicacion")) return "actualizacion_ubicacion";
  if (ruta.startsWith("/choferes/cercanos")) return "busqueda_cercanos";
  if (ruta === "/ready/flota") return "sonda_ready_flota";
  return "sonda_health";
}

async function actualizarUbicacionesIniciales(opciones, choferes) {
  let fallidas = 0;
  let cursor = 0;
  const trabajadores = Array.from({ length: Math.min(64, choferes.length) }, async () => {
    while (cursor < choferes.length) {
      const chofer = choferes[cursor++];
      try {
        const respuesta = await fetch(new URL("/choferes/yo/ubicacion", opciones.baseUrl), {
          method: "POST",
          headers: { Authorization: `Bearer ${chofer.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...chofer.ubicacion, actualizado_at: new Date().toISOString(), precision_metros: 5 }),
          signal: AbortSignal.timeout(10_000)
        });
        await respuesta.text();
        if (!respuesta.ok) fallidas += 1;
      } catch { fallidas += 1; }
    }
  });
  await Promise.all(trabajadores);
  return { fallidas };
}

function moverUbicacion(actual, semilla, indice) {
  const aleatorio = crearGeneradorDeterminista((semilla + indice + 1) % 2_147_483_647 || 1);
  const angulo = aleatorio() * Math.PI * 2;
  const radio = aleatorio() * 20;
  return {
    latitud: redondearCoordenada(actual.latitud + (radio * Math.cos(angulo)) / 111_320),
    longitud: redondearCoordenada(actual.longitud + (radio * Math.sin(angulo)) / (111_320 * Math.cos(actual.latitud * Math.PI / 180)))
  };
}

function iniciarMuestreadorRecursos(informe) {
  const identificador = obtenerDocker([...ARGUMENTOS_COMPOSE, "ps", "-q", "ms-flota"]).trim();
  if (!identificador) throw new Error("No se encontró el contenedor ms-flota. Levantalo con el Compose de mediciones antes de iniciar la carga.");
  const proceso = spawn("docker", ["stats", "--format", "{{.CPUPerc}};{{.MemUsage}}", identificador], { cwd: RAIZ, windowsHide: true });
  const lector = createInterface({ input: proceso.stdout });
  let faseActual = "preparacion";
  let errorSalida = "";
  proceso.stderr.setEncoding("utf8");
  proceso.stderr.on("data", (dato) => { errorSalida = `${errorSalida}${dato}`.slice(-2000); });
  lector.on("line", (linea) => {
    if (faseActual !== "medicion") return;
    if (!linea.trim()) return;
    const [cpuTexto, memoriaTexto] = linea.split(";");
    const memoriaMiB = convertirMemoriaMiB(memoriaTexto ?? "");
    const cpuPorcentaje = parsearPorcentaje(cpuTexto);
    if (cpuPorcentaje === null && memoriaMiB === null) return;
    informe.mediciones.recursosFlota.push({ registrado_en: new Date().toISOString(), cpu_porcentaje: cpuPorcentaje, memoria_contenedor_mib: memoriaMiB });
  });
  proceso.on("error", (error) => { errorSalida = error.message; });
  return {
    iniciarMedicion() { faseActual = "medicion"; },
    terminarMedicion() { faseActual = "finalizada"; },
    async detener() {
      if (proceso.exitCode === null) proceso.kill();
      lector.close();
      if (errorSalida) informe.advertencias.push(`No se pudo leer docker stats: ${errorSalida.trim()}`);
    }
  };
}

async function verificarServicios(opciones) {
  const nombresServicios = obtenerDocker([...ARGUMENTOS_COMPOSE, "config", "--services"]).trim().split(/\r?\n/);
  if (!nombresServicios.includes("postgres") || !nombresServicios.includes("ms-flota")) throw new Error("El Compose no contiene PostgreSQL y ms-flota.");
  const habilitacion = obtenerDocker([...ARGUMENTOS_COMPOSE, "exec", "-T", "ms-flota", "node", "-e", "process.stdout.write(process.env.MEDICIONES_HABILITADAS ?? '')"]).trim();
  if (habilitacion !== "true") throw new Error("El servicio no tiene activadas las métricas de proceso. Levantalo con carga/docker-compose.mediciones.yml.");

  for (const ruta of ["/health", "/ready/flota"]) {
    const respuesta = await fetch(new URL(ruta, opciones.baseUrl), { signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
    if (!respuesta?.ok) throw new Error(`El entorno local no está listo: ${ruta} no respondió con éxito.`);
  }
}

async function prepararChoferes(cantidad) {
  const choferes = Array.from({ length: cantidad }, () => randomUUID());
  const valores = choferes.map((id) => `('${id}'::uuid, '${id}'::uuid, TRUE, TRUE, TRUE)`).join(",\n");
  const sql = `INSERT INTO usuario_chofer (id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado) VALUES\n${valores}\nON CONFLICT (usuario_id) DO NOTHING\nRETURNING usuario_id;\n`;
  const insertados = obtenerDocker([...ARGUMENTOS_COMPOSE, "exec", "-T", "postgres", "sh", "-c", 'psql -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql)
    .split(/\r?\n/).map((valor) => valor.trim()).filter((valor) => /^[0-9a-f-]{36}$/i.test(valor));
  if (insertados.length !== cantidad) {
    await limpiarChoferes(insertados);
    throw new Error(`Solo se insertaron ${insertados.length} de ${cantidad} choferes nuevos; hubo una colisión con datos existentes. No se modificaron filas preexistentes.`);
  }
  return insertados;
}

async function limpiarChoferes(identificadores) {
  const seguros = identificadores.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!seguros.length) return;
  const lista = seguros.map((id) => `'${id}'::uuid`).join(", ");
  const sql = `BEGIN;\nDELETE FROM ubicacion_actual WHERE usuario_id = ANY (ARRAY[${lista}]);\nDELETE FROM usuario_chofer WHERE usuario_id = ANY (ARRAY[${lista}]);\nCOMMIT;\n`;
  obtenerDocker([...ARGUMENTOS_COMPOSE, "exec", "-T", "postgres", "sh", "-c", 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql);
}

async function leerMedicionesProcesoFlota(inicio, fin) {
  if (!inicio || !fin) return { cantidad_ventanas: 0, p99_event_loop_ms: null, max_event_loop_ms: null, rss_p95_mib: null, rss_maximo_mib: null, ...resumirMemoriaProcesoFlota([]), ventanas: [] };
  const salida = obtenerDocker([...ARGUMENTOS_COMPOSE, "logs", "--no-color", "--since", "15m", "ms-flota"]);
  const ventanas = [];
  for (const linea of salida.split(/\r?\n/)) {
    const inicioJson = linea.indexOf("{");
    if (inicioJson < 0) continue;
    try {
      const registro = JSON.parse(linea.slice(inicioJson));
      if (registro.evento !== "metrica_proceso_flota") continue;
      const marca = Date.parse(registro.registrado_en);
      if (!Number.isFinite(marca) || marca < Date.parse(inicio) || marca > Date.parse(fin)) continue;
      ventanas.push(registro);
    } catch { /* Ignora las líneas ordinarias del contenedor. */ }
  }
  return {
    cantidad_ventanas: ventanas.length,
    p99_event_loop_ms: calcularPercentil(ventanas.map((m) => m.lag_event_loop_p99_ms), 99),
    max_event_loop_ms: ventanas.length ? redondear(Math.max(...ventanas.map((m) => m.lag_event_loop_max_ms))) : null,
    rss_p95_mib: calcularPercentil(ventanas.map((m) => m.memoria_rss_mib), 95),
    rss_maximo_mib: ventanas.length ? redondear(Math.max(...ventanas.map((m) => m.memoria_rss_mib))) : null,
    ...resumirMemoriaProcesoFlota(ventanas),
    ventanas
  };
}

export function resumirMemoriaProcesoFlota(ventanas) {
  const campos = [
    ["memoria_heap_usado_mib", "memoria_heap_usado"],
    ["memoria_externa_mib", "memoria_externa"],
    ["memoria_array_buffers_mib", "memoria_array_buffers"]
  ];
  return Object.fromEntries(campos.flatMap(([campo, prefijo]) => {
    const valores = ventanas.map((ventana) => ventana[campo]).filter(Number.isFinite);
    return [[`${prefijo}_p95_mib`, calcularPercentil(valores, 95)], [`${prefijo}_maximo_mib`, valores.length ? redondear(Math.max(...valores)) : null]];
  }));
}

function resumirInforme(informe) {
  const tipos = [...new Set(informe.mediciones.solicitudes.filter((m) => m.fase === "medicion").map((m) => m.tipo))];
  const duracionSegundos = informe.configuracion.duracion_medida_segundos;
  const solicitudes = Object.fromEntries(tipos.map((tipo) => {
    const muestras = informe.mediciones.solicitudes.filter((m) => m.fase === "medicion" && m.tipo === tipo);
    const contador = informe.mediciones.contadores?.find((m) => m.fase === "medicion" && m.tipo === tipo);
    const latencias = muestras.flatMap((m) => m.latencia_ms === null ? [] : [m.latencia_ms]);
    const estadosHttp = {};
    for (const muestra of muestras) {
      const estado = muestra.estado_http === null ? "sin_respuesta" : String(muestra.estado_http);
      estadosHttp[estado] = (estadosHttp[estado] ?? 0) + 1;
    }
    const exitosas = muestras.filter((m) => m.estado_http !== null && m.estado_http >= 200 && m.estado_http < 300).length;
    return [tipo, {
      ofrecidas: contador?.ofrecidas ?? muestras.length,
      respondidas: latencias.length,
      exitosas,
      fallidas: muestras.length - exitosas,
      perdidas_por_cola: contador?.perdidas ?? 0,
      throughput_completado_por_segundo: redondear(exitosas / duracionSegundos),
      latencia_p50_ms: calcularPercentil(latencias, 50),
      latencia_p95_ms: calcularPercentil(latencias, 95),
      latencia_p99_ms: calcularPercentil(latencias, 99),
      espera_cola_p99_ms: calcularPercentil(muestras.flatMap((m) => m.espera_cola_ms === null ? [] : [m.espera_cola_ms]), 99),
      estados_http: estadosHttp,
      errores: muestras.filter((m) => m.error).reduce((acumulado, m) => ({ ...acumulado, [m.error]: (acumulado[m.error] ?? 0) + 1 }), {})
    }];
  }));
  const recursos = informe.mediciones.recursosFlota;
  return {
    solicitudes,
    cola_maxima_pendiente: informe.mediciones.colaMaximaPendiente ?? 0,
    cpu_p95_porcentaje: calcularPercentil(recursos.flatMap((m) => m.cpu_porcentaje === null ? [] : [m.cpu_porcentaje]), 95),
    memoria_contenedor_p95_mib: calcularPercentil(recursos.flatMap((m) => m.memoria_contenedor_mib === null ? [] : [m.memoria_contenedor_mib]), 95),
    memoria_contenedor_maxima_mib: recursos.length ? redondear(Math.max(...recursos.map((m) => m.memoria_contenedor_mib ?? 0))) : null,
    proceso_flota: informe.mediciones.procesoFlota
  };
}

async function guardarInforme(informe) {
  informe.fechas.fin = new Date().toISOString();
  const carpeta = path.join(RAIZ, "carga", "resultados");
  await mkdir(carpeta, { recursive: true });
  const destino = path.join(carpeta, `${informe.id_ejecucion}-${informe.configuracion.escenario}.json`);
  await writeFile(destino, `${JSON.stringify(informe, null, 2)}\n`, "utf8");
  console.error(`Reporte local guardado en ${path.relative(RAIZ, destino)} (no se versiona).`);
  return path.relative(RAIZ, destino);
}

function verificarEntornoLocal() {
  if (process.env.DOCKER_HOST) throw new Error("DOCKER_HOST está configurado; para evitar carga remota, quitá esa variable y usá un contexto Docker local.");
  const contextos = JSON.parse(obtenerDocker(["context", "inspect"]));
  const hostDocker = contextos[0]?.Endpoints?.docker?.Host ?? "";
  if (!/^(npipe:|unix:|tcp:\/\/(localhost|127\.0\.0\.1|\[::1\]))/i.test(hostDocker)) {
    throw new Error(`El contexto Docker (${hostDocker || "sin host"}) no parece local. No se ejecutará la carga sobre ese destino.`);
  }
  const commit = obtenerDocker(["rev-parse", "--short", "HEAD"]).trim();
  const versionDocker = obtenerDocker(["version", "--format", "{{.Server.Version}}"]).trim();
  return { commit, versionDocker };
}

function obtenerDocker(argumentos, entrada) {
  const [comando, ...resto] = argumentos[0] === "rev-parse" ? ["git", ...argumentos] : ["docker", ...argumentos];
  try {
    return execFileSync(comando, resto, { cwd: RAIZ, input: entrada, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const detalle = String(error.stderr ?? error.message).trim().split(/\r?\n/).slice(-3).join(" ");
    throw new Error(`Falló ${comando} ${resto.slice(0, 3).join(" ")}: ${detalle}`);
  }
}

function validarUrlLocal(valor) {
  let url;
  try { url = new URL(valor); } catch { throw new Error("--base-url debe ser una URL válida."); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("El simulador solo admite HTTP en localhost, 127.0.0.1 o ::1; no se permite enviar carga a servicios remotos.");
  }
}

function validarEntero(valor, nombre, minimo, maximo) {
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) throw new Error(`${nombre} debe ser un entero entre ${minimo} y ${maximo}.`);
}
export function parsearPorcentaje(valor) {
  const coincidencia = String(valor ?? "").match(/[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)/);
  if (!coincidencia) return null;
  const numero = Number(coincidencia[0].replace(",", "."));
  return Number.isFinite(numero) ? redondear(numero) : null;
}
function redondear(valor) { return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : null; }
function redondearCoordenada(valor) { return Math.round(valor * 1_000_000) / 1_000_000; }
function clasificarError(error) { return error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "fallo_red"; }
function dormir(ms) { return new Promise((resolver) => setTimeout(resolver, Math.max(0, ms))); }
async function dormirHasta(marca) { while (performance.now() < marca) await dormir(Math.min(50, marca - performance.now())); }

function textoAyuda() {
  return `Simulador local MED-001\n\n` +
    `Levantar el entorno con métricas de proceso:\n` +
    `  docker compose -f docker-compose.yml -f carga/docker-compose.mediciones.yml up --build -d\n\n` +
    `Prueba corta (5 choferes, 12 segundos de medición):\n` +
    `  npm.cmd run carga:flota -- --modo prueba\n\n` +
    `Carga completa (500 choferes cada 2 segundos, 5 minutos):\n` +
    `  npm.cmd run carga:flota -- --modo completa --escenario carga\n\n` +
    `Escenario de reposo:\n` +
    `  npm.cmd run carga:flota -- --modo completa --escenario reposo\n\n` +
    `El destino solo puede ser localhost. El simulador crea y elimina únicamente perfiles aleatorios de prueba.\n` +
    `Los reportes quedan en carga/resultados/ y no se suben a Git.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void ejecutar();
