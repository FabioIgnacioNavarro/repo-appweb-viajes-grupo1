import { ConfirmarViaje, CrearOfertasParaCandidatos, type ActorAutenticado, type EstimacionVigente, type FuenteCandidatos, type PublicadorEventosTiempoReal, type Viaje } from "./dominio";
import { ErrorDependenciaHttp } from "../compartido/cliente-servicios";

/** Orquesta casos de uso y puertos; las reglas de autorización y estado siguen en el dominio. */
export class ConfirmarViajeYBuscarChoferes {
  constructor(private readonly confirmar: ConfirmarViaje, private readonly candidatos: FuenteCandidatos, private readonly crearOfertas: CrearOfertasParaCandidatos, private readonly eventos?: PublicadorEventosTiempoReal) {}
  async ejecutar(actor: ActorAutenticado, estimacion: EstimacionVigente, clave: string, jwt: string): Promise<Viaje> {
    const viaje = await this.confirmar.ejecutar(actor, estimacion, clave);
    try {
      const choferes = await this.candidatos.buscar(viaje.origen, jwt);
      const ofertas = await this.crearOfertas.ejecutar(viaje, choferes);
      for (const oferta of ofertas) {
        try {
          this.eventos?.publicarAUsuario(oferta.choferId, "OFERTA_NUEVA", {
            id_oferta: oferta.id, id_viaje: oferta.viajeId, estado: oferta.estado.toLowerCase(),
            enviada_en: oferta.enviadaEm.toISOString(), expira_en: oferta.expiraEm.toISOString()
          });
        } catch { /* La oferta queda persistida y puede recuperarse por HTTP. */ }
      }
      return viaje;
    } catch (causa) {
      if (causa instanceof ErrorDependenciaHttp) throw new ErrorDependenciaHttp("ms-flota", "buscar_candidatos");
      throw causa;
    }
  }
}
