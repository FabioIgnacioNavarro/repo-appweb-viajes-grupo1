import { EventoWebSocket } from "./tipos";
import { obtenerToken } from "./sesion";

export type EstadoConexionWs = "CONECTADO" | "CONECTANDO" | "DESCONECTADO";
export type OyenteEventoWs = (evento: EventoWebSocket) => void;
export type OyenteEstadoConexion = (estado: EstadoConexionWs) => void;

export class ClienteWebSocket {
  private socket: WebSocket | null = null;
  private estadoConexion: EstadoConexionWs = "DESCONECTADO";
  private reintentos = 0;
  private temporizadorReconexion: ReturnType<typeof setTimeout> | null = null;
  private cerradoVoluntario = false;

  private oyentesEventos: Map<string, Set<OyenteEventoWs>> = new Map();
  private oyentesEstado: Set<OyenteEstadoConexion> = new Set();
  private oyentesReconexionExitosa: Set<() => void> = new Set();

  constructor(private readonly urlPersonalizada?: string) {}

  /**
   * Resuelve la URL del WebSocket apuntando al gateway o al host actual
   */
  private obtenerUrlWebSocket(): string {
    if (this.urlPersonalizada) return this.urlPersonalizada;
    if (typeof window !== "undefined") {
      const protocolo = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocolo}//${window.location.host}/ws`;
    }
    return "ws://localhost:8080/ws";
  }

  /**
   * Conecta o reconecta el socket enviando el token en el protocolo secundario
   */
  public conectar(): void {
    this.cerradoVoluntario = false;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const token = obtenerToken();
    if (!token) {
      this.actualizarEstado("DESCONECTADO");
      return;
    }

    this.actualizarEstado("CONECTANDO");

    try {
      const url = this.obtenerUrlWebSocket();
      // Enviar subprotocolo con JWT según contrato de ms-viajes/tiempo-real.ts
      this.socket = new WebSocket(url, ["viajes-jwt", token]);

      this.socket.onopen = () => {
        const eraReconexion = this.reintentos > 0;
        this.reintentos = 0;
        this.actualizarEstado("CONECTADO");

        // Si veníamos de una caída de red, notificar para que las vistas reconsulten vía GET
        if (eraReconexion) {
          for (const callback of this.oyentesReconexionExitosa) {
            try {
              callback();
            } catch (e) {
              console.error("Error en callback de reconexión:", e);
            }
          }
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const evento = JSON.parse(event.data) as EventoWebSocket;
          this.despacharEvento(evento);
        } catch (e) {
          console.warn("Mensaje WebSocket no deserializable como JSON:", event.data);
        }
      };

      this.socket.onerror = () => {
        // En navegadores, onerror siempre viene acompañado de onclose
      };

      this.socket.onclose = () => {
        this.actualizarEstado("DESCONECTADO");
        if (!this.cerradoVoluntario) {
          this.programarReconexion();
        }
      };
    } catch (err) {
      this.actualizarEstado("DESCONECTADO");
      this.programarReconexion();
    }
  }

  /**
   * Cierra el socket voluntariamente (ej. logout) y no programa reintentos
   */
  public desconectar(): void {
    this.cerradoVoluntario = true;
    if (this.temporizadorReconexion) {
      clearTimeout(this.temporizadorReconexion);
      this.temporizadorReconexion = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignorar
      }
      this.socket = null;
    }
    this.actualizarEstado("DESCONECTADO");
  }

  /**
   * Programa la reconexión exponencial con tope de 10 segundos
   */
  private programarReconexion(): void {
    if (this.temporizadorReconexion || this.cerradoVoluntario) return;

    // Backoff: 1s, 2s, 4s, máx 10s con jitter
    const delay = Math.min(1000 * Math.pow(1.5, this.reintentos), 10000) + Math.random() * 500;
    this.reintentos++;

    this.temporizadorReconexion = setTimeout(() => {
      this.temporizadorReconexion = null;
      this.conectar();
    }, delay);
  }

  private actualizarEstado(nuevoEstado: EstadoConexionWs): void {
    this.estadoConexion = nuevoEstado;
    for (const oyente of this.oyentesEstado) {
      try {
        oyente(nuevoEstado);
      } catch (e) {
        console.error("Error en oyente de estado WS:", e);
      }
    }
  }

  private despacharEvento(evento: EventoWebSocket): void {
    // 1. Oyentes específicos del tipo de evento
    const oyentesTipo = this.oyentesEventos.get(evento.tipo);
    if (oyentesTipo) {
      for (const oyente of oyentesTipo) {
        try {
          oyente(evento);
        } catch (e) {
          console.error("Error en oyente específico de evento WS:", e);
        }
      }
    }

    // 2. Oyentes globales wildcard (*)
    const oyentesTodos = this.oyentesEventos.get("*");
    if (oyentesTodos) {
      for (const oyente of oyentesTodos) {
        try {
          oyente(evento);
        } catch (e) {
          console.error("Error en oyente general de evento WS:", e);
        }
      }
    }
  }

  /**
   * Suscribe una función a un tipo de evento ("*" para todos)
   */
  public on(tipo: string, oyente: OyenteEventoWs): () => void {
    if (!this.oyentesEventos.has(tipo)) {
      this.oyentesEventos.set(tipo, new Set());
    }
    this.oyentesEventos.get(tipo)!.add(oyente);

    return () => {
      this.oyentesEventos.get(tipo)?.delete(oyente);
    };
  }

  /**
   * Suscribe a cambios en el estado de conexión (conectado, reconectando, desconectado)
   */
  public alCambiarEstado(oyente: OyenteEstadoConexion): () => void {
    this.oyentesEstado.add(oyente);
    oyente(this.estadoConexion);
    return () => {
      this.oyentesEstado.delete(oyente);
    };
  }

  /**
   * Suscribe un callback a ejecutar al reconectar tras una caída de red
   */
  public alReconectar(callback: () => void): () => void {
    this.oyentesReconexionExitosa.add(callback);
    return () => {
      this.oyentesReconexionExitosa.delete(callback);
    };
  }

  public obtenerEstado(): EstadoConexionWs {
    return this.estadoConexion;
  }
}

// Instancia singleton para compartir en la aplicación
export const clienteTiempoReal = new ClienteWebSocket();
