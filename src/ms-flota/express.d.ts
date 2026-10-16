import type { ActorAutenticado } from "./dominio";

declare global {
  namespace Express {
    interface Request { actorAutenticado?: ActorAutenticado; }
  }
}

export {};
