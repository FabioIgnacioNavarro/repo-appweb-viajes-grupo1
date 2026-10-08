import { strict as assert } from "node:assert";
import test from "node:test";
import { ejecutarViajeDeDemo, ejecutarViajeDeDemoConRuta, RepositorioViajesMemoria } from "./viaje";

test("completa un viaje de demo para pasajero con chofer genérico", () => {
  const repositorio = new RepositorioViajesMemoria();
  const { estimacion, viaje } = ejecutarViajeDeDemo("PASAJERO", { latitud: -27.46, longitud: -58.99 }, repositorio);
  assert.equal(viaje.chofer, "chofer-generico");
  assert.equal(viaje.estado, "FINALIZADO");
  assert.equal(viaje.precioFinal, estimacion.precioEstimado);
  assert.equal(repositorio.obtener(viaje.id)?.codigo, viaje.codigo);
});

test("completa un viaje de demo para chofer con pasajero genérico", () => {
  const { viaje } = ejecutarViajeDeDemo("CHOFER", { latitud: -27.45, longitud: -58.98 }, new RepositorioViajesMemoria());
  assert.equal(viaje.pasajero, "pasajero-generico");
  assert.equal(viaje.chofer, "chofer-demo");
});

test("rechaza coordenadas inválidas", () => {
  assert.throws(() => ejecutarViajeDeDemo("PASAJERO", { latitud: 120, longitud: 0 }, new RepositorioViajesMemoria()));
});

test("usa el origen informado para calcular el viaje", () => {
  const { estimacion } = ejecutarViajeDeDemo(
    "PASAJERO",
    { latitud: -34.6037, longitud: -58.3816 },
    new RepositorioViajesMemoria(),
    new Date(),
    { latitud: -34.6118, longitud: -58.4173 }
  );
  assert.deepEqual(estimacion.origen, { latitud: -34.6118, longitud: -58.4173 });
  assert.ok(estimacion.distanciaMetros > 0);
});

test("usa distancia y duración del proveedor de rutas para fijar el precio", async () => {
  const calculadorRuta = {
    calcular: async () => ({ distanciaMetros: 10_000, duracionSegundos: 1_200, proveedor: "OSRM" as const })
  };
  const { estimacion, viaje } = await ejecutarViajeDeDemoConRuta(
    "PASAJERO",
    { latitud: -34.6, longitud: -58.4 },
    { latitud: -34.7, longitud: -58.5 },
    new RepositorioViajesMemoria(),
    calculadorRuta
  );
  assert.equal(estimacion.proveedorRuta, "OSRM");
  assert.equal(estimacion.precioEstimado, 1000 + 10 * 600 + 20 * 120);
  assert.equal(viaje.precioFinal, estimacion.precioEstimado);
});
