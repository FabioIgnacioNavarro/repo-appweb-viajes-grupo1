import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { ActorAutenticado, PublicadorEventosTiempoReal } from "./dominio";

export interface ValidadorTokenTiempoReal {
  validar(token: string): Promise<ActorAutenticado>;
}

/** Adaptador WebSocket. Las conexiones quedan agrupadas por el usuario del JWT, nunca por datos del cliente. */
export class AdaptadorWebSocketTiempoReal implements PublicadorEventosTiempoReal {
  private readonly servidorWs = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    handleProtocols: (protocolos) => {
      if (protocolos.has("viajes.v1")) return "viajes.v1";
      if (protocolos.has("viajes-jwt")) return "viajes-jwt";
      return false;
    }
  });
  private readonly conexiones = new Map<string, Set<WebSocket>>();
  private readonly actoresPorPedido = new WeakMap<IncomingMessage, ActorAutenticado>();
  private readonly manejarUpgrade = (pedido: IncomingMessage, socket: Socket, encabezado: Buffer): void => {
    let ruta: URL;
    try { ruta = new URL(pedido.url ?? "/", "http://localhost"); } catch { socket.destroy(); return; }
    if (ruta.pathname !== "/tiempo-real" && ruta.pathname !== "/ws") { socket.destroy(); return; }
    const autorizacion = pedido.headers.authorization;
    const tokenBearer = typeof autorizacion === "string" && autorizacion.startsWith("Bearer ") ? autorizacion.slice(7) : "";
    const protocolos = typeof pedido.headers["sec-websocket-protocol"] === "string"
      ? pedido.headers["sec-websocket-protocol"].split(",").map((protocolo) => protocolo.trim())
      : [];
    let tokenProtocolo = "";
    if (protocolos[0] === "viajes.v1" && protocolos[1] === "autenticacion-jwt") {
      tokenProtocolo = protocolos[2] ?? "";
    } else if (protocolos[0] === "viajes-jwt" && protocolos[1]) {
      tokenProtocolo = protocolos[1] ?? "";
    }
    const token = tokenBearer || tokenProtocolo;
    if (!token) { this.rechazar(socket, 401, "Unauthorized"); return; }
    void this.validador.validar(token).then((actor) => {
      if (!actor.idUsuario || !["PASAJERO", "CHOFER", "SOPORTE", "ADMINISTRADOR"].includes(actor.rol)) {
        this.rechazar(socket, 401, "Unauthorized"); return;
      }
      this.actoresPorPedido.set(pedido, actor);
      this.servidorWs.handleUpgrade(pedido, socket, encabezado, (conexion) => this.servidorWs.emit("connection", conexion, pedido));
    }).catch(() => this.rechazar(socket, 401, "Unauthorized"));
  };

  constructor(private readonly servidorHttp: Server, private readonly validador: ValidadorTokenTiempoReal) {
    this.servidorWs.on("connection", (conexion, pedido) => {
      const actor = this.actoresPorPedido.get(pedido);
      if (!actor) { conexion.close(1008, "Autenticación requerida"); return; }
      let grupo = this.conexiones.get(actor.idUsuario);
      if (!grupo) { grupo = new Set(); this.conexiones.set(actor.idUsuario, grupo); }
      grupo.add(conexion);
      conexion.send(JSON.stringify({ evento: "CANAL_LISTO", datos: { id_usuario: actor.idUsuario } }));
      conexion.on("message", (mensajeRaw) => {
        try {
          const parseado = JSON.parse(mensajeRaw.toString()) as { accion?: string };
          if (parseado.accion === "PING") {
            conexion.send(JSON.stringify({ evento: "PONG", datos: { timestamp: new Date().toISOString() } }));
          }
        } catch {
          // Ignorar mensajes no JSON o de prueba
        }
      });
      conexion.on("close", () => {
        grupo?.delete(conexion);
        if (grupo?.size === 0) this.conexiones.delete(actor.idUsuario);
      });
      conexion.on("error", () => {
        grupo?.delete(conexion);
        if (grupo?.size === 0) this.conexiones.delete(actor.idUsuario);
      });
    });
    servidorHttp.on("upgrade", this.manejarUpgrade);
  }

  publicarAUsuario(idUsuario: string, evento: string, datos: Record<string, unknown>): void {
    const mensaje = JSON.stringify({ evento, datos });
    for (const conexion of this.conexiones.get(idUsuario) ?? []) {
      if (conexion.readyState !== WebSocket.OPEN) continue;
      try {
        conexion.send(mensaje, (error) => {
          if (error) console.error(JSON.stringify({ evento: "websocket_envio_fallido", servicio: "ms-viajes", resultado: "error_transporte" }));
        });
      } catch { console.error(JSON.stringify({ evento: "websocket_envio_fallido", servicio: "ms-viajes", resultado: "error_transporte" })); }
    }
  }

  async cerrar(): Promise<void> {
    this.servidorHttp.off("upgrade", this.manejarUpgrade);
    for (const grupo of this.conexiones.values()) for (const conexion of grupo) {
      conexion.close(1001, "Servidor apagándose");
      conexion.terminate();
    }
    this.conexiones.clear();
    this.servidorWs.close();
  }

  private rechazar(socket: Socket, estado: number, texto: string): void {
    if (socket.destroyed) return;
    socket.write(`HTTP/1.1 ${estado} ${texto}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }
}
