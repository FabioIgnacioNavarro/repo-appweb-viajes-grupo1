import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");

function listarArchivosTs(dir) {
  const resultados = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultados.push(...listarArchivosTs(ruta));
    } else if (entrada.isFile() && ruta.endsWith(".ts")) {
      resultados.push(ruta);
    }
  }
  return resultados;
}

const IMPORTACIONES_PROHIBIDAS_DOMINIO = [
  /^express$/,
  /^pg$/,
  /^ws$/,
  /^dotenv$/,
  /^node:http$/,
  /^node:https$/,
  /^node:net$/,
  /cliente-servicios/,
  /(^|\/)(http|postgres|servidor)(\.ts)?$/,
];

const errores = [];

for (const archivo of listarArchivosTs(SRC_DIR)) {
  const relativo = path.relative(ROOT, archivo).replaceAll("\\", "/");
  const contenido = fs.readFileSync(archivo, "utf8");
  const lineas = contenido.split(/\r?\n/);

  const esDominio = /(^|\/)dominio\.ts$/.test(relativo) || /\/dominio\//.test(relativo);
  const esHttp = /(^|\/)http\.ts$/.test(relativo);

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const matchImport = linea.match(/^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/);
    const matchRequire = linea.match(/\brequire\(\s*["']([^"']+)["']\s*\)/);
    const especificador = matchImport?.[1] ?? matchRequire?.[1];

    if (esDominio) {
      if (especificador && IMPORTACIONES_PROHIBIDAS_DOMINIO.some((re) => re.test(especificador))) {
        errores.push(`${relativo}:${i + 1} - El dominio no debe importar infraestructura ('${especificador}').`);
      }
      if (/\bprocess\.env\b/.test(linea)) {
        errores.push(`${relativo}:${i + 1} - El dominio no debe leer process.env directamente.`);
      }
    }

    if (esHttp && especificador) {
      if (/^pg$/.test(especificador) || /(^|\/)postgres(\.ts)?$/.test(especificador)) {
        errores.push(`${relativo}:${i + 1} - El adaptador HTTP no debe acoplarse a PostgreSQL ('${especificador}').`);
      }
    }
  }
}

if (errores.length > 0) {
  console.error("Violaciones de arquitectura hexagonal detectadas:\n" + errores.map((e) => ` - ${e}`).join("\n"));
  process.exit(1);
}

console.log("Arquitectura hexagonal verificada: 0 violaciones en dominio y adaptadores HTTP.");
