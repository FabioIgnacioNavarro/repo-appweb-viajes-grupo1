import { ConfirmarViaje, CrearOfertasParaCandidatos, MarcarViajeSinChoferesDisponibles, publicarOfertasNuevas, type ActorAutenticado, type EstimacionVigente, type FuenteCandidatos, type PublicadorEventosTiempoReal, type Viaje } from "./dominio";
import { ErrorDependenciaHttp } from "../compartido/cliente-servicios";

/** Orquesta casos de uso y puertos; las reglas de autorización y estado siguen en el dominio. */
export class ConfirmarViajeYBuscarChoferes {
  private readonly matchingEnCurso = new Map<string, Promise<Viaje>>();

  constructor(
    private readonly confirmar: ConfirmarViaje,
    private readonly candidatos: FuenteCandidatos,
    private readonly crearOfertas: CrearOfertasParaCandidatos,
    private readonly sinChoferesDisponibles: MarcarViajeSinChoferesDisponibles,
    private readonly eventos?: PublicadorEventosTiempoReal,
    private readonly opciones?: { maxOfertasPorRonda?: number; vigenciaMs?: number }
  ) {}

  async ejecutar(actor: ActorAutenticado, estimacion: EstimacionVigente, clave: string, jwt: string): Promise<Viaje> {
    const viaje = await this.confirmar.ejecutar(actor, estimacion, clave);
    if (viaje.estado !== "SOLICITADO") return viaje;

    const enCurso = this.matchingEnCurso.get(viaje.id);
    if (enCurso) return await enCurso;

    const proceso = this.buscarYOfertar(viaje, jwt).finally(() => {
      if (this.matchingEnCurso.get(viaje.id) === proceso) {
        this.matchingEnCurso.delete(viaje.id);
      }
    });
    this.matchingEnCurso.set(viaje.id, proceso);
    return await proceso;
  }

  private async buscarYOfertar(viaje: Viaje, jwt: string): Promise<Viaje> {
    try {
      const choferes = await this.candidatos.buscar(viaje.origen, jwt);
      if (choferes.length === 0) return await this.sinChoferesDisponibles.ejecutar(viaje.id);
      const limite = this.opciones?.maxOfertasPorRonda;
      const seleccionados = limite !== undefined && limite > 0 ? choferes.slice(0, limite) : choferes;
      const ofertas = await this.crearOfertas.ejecutar(viaje, seleccionados, new Date(), this.opciones?.vigenciaMs ?? 30_000);
      publicarOfertasNuevas(this.eventos, viaje, ofertas);
      return viaje;
    } catch (causa) {
      if (causa instanceof ErrorDependenciaHttp) throw new ErrorDependenciaHttp("ms-flota", "buscar_candidatos");
      throw causa;
    }
  }
}
