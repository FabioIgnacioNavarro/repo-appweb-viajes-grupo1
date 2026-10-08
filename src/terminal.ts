import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as entrada, stdout as salida } from "node:process";
import { ejecutarViajeDeDemoConRuta, RepositorioViajesMemoria, Rol } from "./viaje";
import { crearCalculadorRuta } from "./rutas";

function leerRol(valor: string): Rol {
  const normalizado = valor.trim().toUpperCase();
  if (normalizado !== "PASAJERO" && normalizado !== "CHOFER") {
    throw new Error("El rol debe ser PASAJERO o CHOFER.");
  }
  return normalizado;
}

function leerNumero(valor: string, nombre: string): number {
  const numero = Number(valor.trim().replace(",", "."));
  if (!Number.isFinite(numero)) throw new Error(`${nombre} debe ser un número.`);
  return numero;
}

async function main(): Promise<void> {
  const interfaz = createInterface({ input: entrada, output: salida });
  const repositorio = new RepositorioViajesMemoria();
  try {
    console.log("\n=== Demo de viajes ===");
    const rol = leerRol(await interfaz.question("¿Sos PASAJERO o CHOFER? "));
    console.log("Ingresá tu ubicación actual en coordenadas decimales.");
    const origen = {
      latitud: leerNumero(await interfaz.question("Latitud actual: "), "La latitud actual"),
      longitud: leerNumero(await interfaz.question("Longitud actual: "), "La longitud actual")
    };
    console.log("Ingresá la ubicación de destino.");
    const destino = {
      latitud: leerNumero(await interfaz.question("Latitud de destino: "), "La latitud"),
      longitud: leerNumero(await interfaz.question("Longitud de destino: "), "La longitud")
    };
    const calculadorRuta = crearCalculadorRuta();
    const { estimacion, viaje } = await ejecutarViajeDeDemoConRuta(rol, origen, destino, repositorio, calculadorRuta);
    console.log("\n--- Tarifa estimada ---");
    console.log(`Distancia: ${(estimacion.distanciaMetros / 1000).toFixed(2)} km`);
    console.log(`Duración estimada: ${Math.ceil(estimacion.duracionSegundos / 60)} min`);
    console.log(`Precio: ${estimacion.moneda} ${estimacion.precioEstimado}`);
    console.log(`Multiplicador de demanda: ${estimacion.multiplicadorDemanda}`);
    console.log(`Proveedor de ruta: ${estimacion.proveedorRuta}`);
    console.log("\nViaje iniciado y finalizado de forma hipotética.");
    console.log(`Código: ${viaje.codigo}`);
    console.log(`Pasajero: ${viaje.pasajero} | Chofer: ${viaje.chofer}`);
    console.log(`Estado: ${viaje.estado}`);
    console.log(`Precio a pagar: ${viaje.moneda} ${viaje.precioFinal}`);
    console.log(`Viajes guardados en memoria: ${repositorio.listar().length}`);
  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : "entrada inválida"}`);
    process.exitCode = 1;
  } finally {
    interfaz.close();
  }
}

void main();
