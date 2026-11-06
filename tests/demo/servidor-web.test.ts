import express from "express";
import { createServer, type Server } from "node:http";
import { strict as assert } from "node:assert";
import test from "node:test";
import { GeocodificadorFalso, RutaHaversine } from "../../src/rutas";
import { crearEstimacionConRuta, type Coordenada } from "../../src/viaje";

function crearAplicacionDemo() {
  const app = express();
  app.use(express.json());
  const geocodificador = new GeocodificadorFalso();
  const calculadorRuta = new RutaHaversine();

  app.post("/demostracion/geocodificar", async (req, res) => {
    const direccion = typeof req.body?.direccion === "string" ? req.body.direccion.trim() : undefined;
    if (!direccion) {
      res.status(400).json({ error: { codigo: "DIRECCION_INVALIDA", mensaje: "Dirección requerida." } });
      return;
    }
    const prox = req.body?.proximidad;
    const centro = typeof prox?.latitud === "number" && typeof prox?.longitud === "number"
      ? { latitud: prox.latitud, longitud: prox.longitud }
      : { latitud: -27.451, longitud: -58.986 };
    try {
      const coordenada = await geocodificador.geocodificar(direccion, { centro });
      res.status(200).json({ direccion, coordenada });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error";
      res.status(404).json({ error: { codigo: "DIRECCION_NO_ENCONTRADA", mensaje } });
    }
  });

  app.post("/demostracion/geocodificar-inversa", async (req, res) => {
    const latitud = req.body?.latitud;
    const longitud = req.body?.longitud;
    if (typeof latitud !== "number" || typeof longitud !== "number" || !Number.isFinite(latitud) || !Number.isFinite(longitud)) {
      res.status(400).json({ error: { codigo: "COORDENADAS_INVALIDAS", mensaje: "Coordenadas inválidas." } });
      return;
    }
    try {
      const direccion = await geocodificador.geocodificarInversa({ latitud, longitud });
      res.status(200).json({ direccion, coordenada: { latitud, longitud } });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "Error";
      res.status(404).json({ error: { codigo: "DIRECCION_NO_ENCONTRADA", mensaje } });
    }
  });

  app.post("/demostracion/estimaciones", async (req, res) => {
    async function resolver(valor: unknown): Promise<Coordenada | undefined> {
      if (typeof valor === "object" && valor !== null) {
        const v = valor as Record<string, unknown>;
        if (typeof v.latitud === "number" && typeof v.longitud === "number") {
          return { latitud: v.latitud, longitud: v.longitud };
        }
        if (typeof v.direccion === "string" && v.direccion.trim()) {
          try {
            return await geocodificador.geocodificar(v.direccion.trim());
          } catch {
            return undefined;
          }
        }
      }
      return undefined;
    }

    const [origen, destino] = await Promise.all([
      resolver(req.body?.origen),
      resolver(req.body?.destino)
    ]);
    if (!origen || !destino) {
      res.status(400).json({ error: { codigo: "COORDENADAS_INVALIDAS", mensaje: "Origen y destino inválidos." } });
      return;
    }

    const estimacion = await crearEstimacionConRuta(origen, destino, calculadorRuta);
    res.status(201).json({
      distancia_metros: estimacion.distanciaMetros,
      duracion_segundos: estimacion.duracionSegundos,
      precio_estimado: String(estimacion.precioEstimado),
      moneda: estimacion.moneda,
      origen,
      destino
    });
  });

  return app;
}

async function iniciarServidor(app: express.Express): Promise<{ base: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sin dirección de test.");
  return { base: `http://127.0.0.1:${address.port}`, server };
}

async function cerrarServidor(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

test("demo web /demostracion/geocodificar resuelve dirección semilla conocida", async () => {
  const { base, server } = await iniciarServidor(crearAplicacionDemo());
  try {
    const res = await fetch(`${base}/demostracion/geocodificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direccion: "Plaza 25 de Mayo, Resistencia" })
    });
    assert.equal(res.status, 200);
    const cuerpo = await res.json() as { direccion: string; coordenada: { latitud: number; longitud: number } };
    assert.equal(cuerpo.coordenada.latitud, -27.451);
    assert.equal(cuerpo.coordenada.longitud, -58.986);
  } finally {
    await cerrarServidor(server);
  }
});

test("demo web /demostracion/geocodificar rechaza entrada vacía con 400 y desconocida con 404", async () => {
  const { base, server } = await iniciarServidor(crearAplicacionDemo());
  try {
    const resVacia = await fetch(`${base}/demostracion/geocodificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direccion: "   " })
    });
    assert.equal(resVacia.status, 400);

    const resDesconocida = await fetch(`${base}/demostracion/geocodificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direccion: "calle inventada 9999" })
    });
    assert.equal(resDesconocida.status, 404);
  } finally {
    await cerrarServidor(server);
  }
});

test("demo web /demostracion/estimaciones calcula precio a partir de direcciones en texto", async () => {
  const { base, server } = await iniciarServidor(crearAplicacionDemo());
  try {
    const res = await fetch(`${base}/demostracion/estimaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origen: { direccion: "Plaza 25 de Mayo" },
        destino: { direccion: "Terminal de Ómnibus" }
      })
    });
    assert.equal(res.status, 201);
    const cuerpo = await res.json() as {
      distancia_metros: number;
      duracion_segundos: number;
      precio_estimado: string;
      origen: Coordenada;
      destino: Coordenada;
    };
    assert.equal(cuerpo.origen.latitud, -27.451);
    assert.equal(cuerpo.destino.latitud, -27.462);
    assert.ok(cuerpo.distancia_metros > 0);
    assert.ok(Number(cuerpo.precio_estimado) > 0);
  } finally {
    await cerrarServidor(server);
  }
});

test("demo web /demostracion/geocodificar-inversa devuelve el nombre del lugar al arrastrar el pin", async () => {
  const { base, server } = await iniciarServidor(crearAplicacionDemo());
  try {
    const res = await fetch(`${base}/demostracion/geocodificar-inversa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitud: -27.451, longitud: -58.986 })
    });
    assert.equal(res.status, 200);
    const cuerpo = await res.json() as { direccion: string; coordenada: Coordenada };
    assert.equal(cuerpo.direccion, "Plaza 25 de Mayo, Resistencia");
  } finally {
    await cerrarServidor(server);
  }
});
