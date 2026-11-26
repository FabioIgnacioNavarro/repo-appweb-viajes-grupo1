import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const raiz = process.cwd();
const rutaEnv = path.join(raiz, ".env");
const rutaEnvEjemplo = path.join(raiz, ".env.example");

if (!fs.existsSync(rutaEnv) && fs.existsSync(rutaEnvEjemplo)) {
  fs.copyFileSync(rutaEnvEjemplo, rutaEnv);
  console.log("setup: creado .env desde .env.example.");
} else {
  console.log("setup: .env ya existe o no se encontró .env.example.");
}

const esquemas = [
  "src/ms-flota/schema.sql",
  "src/ms-tarifas/schema.sql",
  "src/ms-viajes/schema.sql",
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("setup: DATABASE_URL no está definida; Docker Compose aplica los esquemas SQL automáticamente al crear postgres_data.");
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  for (const archivo of esquemas) {
    const sql = fs.readFileSync(path.join(raiz, archivo), "utf8");
    await pool.query(sql);
    console.log(`setup: esquema aplicado (${archivo}).`);
  }
} finally {
  await pool.end();
}
