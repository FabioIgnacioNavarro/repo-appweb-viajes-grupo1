import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const raiz = process.cwd();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("seed: definí DATABASE_URL para cargar datos sintéticos directamente en PostgreSQL (Docker Compose los inicializa automáticamente desde los schema.sql).");
  console.log("seed: actores de demo -> ana (pasajero), carlos (chofer con vehículo AA123BB), lucia (soporte), martin (administrador).");
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  for (const archivo of ["src/ms-flota/schema.sql", "src/ms-tarifas/schema.sql"]) {
    const sql = fs.readFileSync(path.join(raiz, archivo), "utf8");
    await pool.query(sql);
  }
  console.log("seed: datos iniciales idempotentes de Flota y Tarifas verificados correctamente.");
} finally {
  await pool.end();
}
