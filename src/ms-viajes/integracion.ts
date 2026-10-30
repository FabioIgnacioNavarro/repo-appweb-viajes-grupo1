import { ConfirmarViaje, CrearOfertasParaCandidatos, type ActorAutenticado, type EstimacionVigente, type FuenteCandidatos, type Viaje } from "./dominio";
import { ErrorDependenciaHttp } from "../compartido/cliente-servicios";

/** Orquesta casos de uso y puertos; las reglas de autorización y estado siguen en el dominio. */
export class ConfirmarViajeYBuscarChoferes {
  constructor(private readonly confirmar: ConfirmarViaje, private readonly candidatos: FuenteCandidatos, private readonly crearOfertas: CrearOfertasParaCandidatos) {}
  async ejecutar(actor: ActorAutenticado, estimacion: EstimacionVigente, clave: string, jwt: string): Promise<Viaje> {
    const viaje = await this.confirmar.ejecutar(actor, estimacion, clave);
    try {
      const choferes = await this.candidatos.buscar(viaje.origen, jwt);
      await this.crearOfertas.ejecutar(viaje, choferes);
      return viaje;
    } catch (causa) {
      if (causa instanceof ErrorDependenciaHttp) throw new ErrorDependenciaHttp("ms-flota", "buscar_candidatos");
      throw causa;
    }
  }
}
