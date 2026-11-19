import React, { useEffect, useState } from "react";
import { useRouter } from "../../nucleo/router";
import {
  cerrarSesion,
  consumirAvisoSesion,
  crearTokenFalsoDesarrollo,
  iniciarSesion,
} from "../../nucleo/sesion";
import { Rol } from "../../nucleo/tipos";

interface PerfilDemo {
  id: string;
  nombre: string;
  rol: Rol;
  descripcion: string;
  emoji: string;
  color: string;
}

const PERFILES_DEMO: PerfilDemo[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    nombre: "Ana Gómez",
    rol: "PASAJERO",
    descripcion: "Solicita viajes, visualiza precio dinámico (Variante A), sigue en vivo y paga.",
    emoji: "🙋‍♀️",
    color: "border-blue-200 hover:border-blue-400 bg-blue-50/50",
  },
  {
    id: "11111111-1111-4111-8111-111111111111",
    nombre: "Carlos Maidana",
    rol: "CHOFER",
    descripcion: "Activa disponibilidad, recibe ofertas en tiempo real y realiza el trayecto.",
    emoji: "🚕",
    color: "border-emerald-200 hover:border-emerald-400 bg-emerald-50/50",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    nombre: "Lucía Operaciones",
    rol: "SOPORTE",
    descripcion: "Supervisa viajes en curso, consulta auditoría de tarifas y asiste en cancelaciones.",
    emoji: "🎧",
    color: "border-purple-200 hover:border-purple-400 bg-purple-50/50",
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    nombre: "Martín Administrador",
    rol: "ADMINISTRADOR",
    descripcion: "Acceso total, configuración de reglas de demanda por zona y métricas del sistema.",
    emoji: "⚙️",
    color: "border-amber-200 hover:border-amber-400 bg-amber-50/50",
  },
];

type ModoEmisionToken = "emulador" | "falso";

export const VistaLogin: React.FC = () => {
  const { navegarA, rutaPorDefectoParaRol } = useRouter();
  const [tokenManual, setTokenManual] = useState("");
  const [modoToken, setModoToken] = useState<ModoEmisionToken>("emulador");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const aviso = consumirAvisoSesion();
    if (aviso) {
      setError(aviso);
    }
  }, []);

  const iniciarConPerfil = async (perfil: PerfilDemo) => {
    setCargando(true);
    setError(null);

    try {
      if (modoToken === "emulador") {
        // Solicitar token RS256 al emulador de identidad (/auth/token)
        const respuesta = await fetch("/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_usuario: perfil.id,
            idUsuario: perfil.id,
            rol: perfil.rol.toLowerCase(),
            email: `${perfil.id}@viajes.local`,
            nombre: perfil.nombre,
          }),
        }).catch(() => null);

        if (respuesta && respuesta.ok) {
          const datos = (await respuesta.json().catch(() => null)) as { token?: string } | null;
          if (datos?.token) {
            iniciarSesion(datos.token, { idUsuario: perfil.id, rol: perfil.rol, nombre: perfil.nombre });
            navegarA(rutaPorDefectoParaRol(perfil.rol));
            return;
          }
        }
      }

      // Fallback explícito o modo desarrollo offline compatible con JWT_MODO=falso (solo fuera de producción)
      const soloProduccion =
        (typeof window !== "undefined" &&
          (window as unknown as { __ENV__?: { VITE_DESHABILITAR_JWT_FALSO?: string } }).__ENV__
            ?.VITE_DESHABILITAR_JWT_FALSO === "true");
      if (soloProduccion) {
        setError("El emulador de identidad no respondió y el modo falso está deshabilitado en producción.");
        return;
      }

      const tokenFalso = crearTokenFalsoDesarrollo({
        idUsuario: perfil.id,
        rol: perfil.rol,
        nombre: perfil.nombre,
      });

      iniciarSesion(tokenFalso, { idUsuario: perfil.id, rol: perfil.rol, nombre: perfil.nombre });
      navegarA(rutaPorDefectoParaRol(perfil.rol));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión con el perfil seleccionado.");
    } finally {
      setCargando(false);
    }
  };

  const iniciarConTokenManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenManual.trim()) return;
    setError(null);

    try {
      const sesion = iniciarSesion(tokenManual.trim());
      if (sesion.expiraEn > 0 && Date.now() / 1000 >= sesion.expiraEn) {
        cerrarSesion();
        setError("El token JWT ingresado ya expiró.");
        return;
      }
      navegarA(rutaPorDefectoParaRol(sesion.rol));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "El token ingresado no es válido o no tiene formato JWT compatible."
      );
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8" data-testid="vista-login">
      {/* Encabezado */}
      <div className="text-center mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Bienvenido a la Plataforma de Viajes
        </h1>
        <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-xl mx-auto">
          Seleccioná un perfil de prueba para ingresar con credenciales de identidad externa o pegá un token JWT.
        </p>
      </div>

      {/* Selector de modo de emisión de credenciales (Emulador RS256 vs Desarrollo jwt-falso) */}
      <div className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
        <span className="font-semibold text-slate-700">Modo de emisión de credenciales:</span>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Modo de token">
          <button
            type="button"
            data-testid="modo-token-emulador"
            onClick={() => setModoToken("emulador")}
            className={`px-3 py-1 rounded-md font-semibold transition cursor-pointer ${
              modoToken === "emulador" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Emulador JWKS (RS256)
          </button>
          <button
            type="button"
            data-testid="modo-token-falso"
            onClick={() => setModoToken("falso")}
            className={`px-3 py-1 rounded-md font-semibold transition cursor-pointer ${
              modoToken === "falso" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
            }`}
            title="Solo para entornos locales con JWT_MODO=falso fuera de producción"
          >
            Desarrollo (JWT falso)
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          data-testid="alerta-login"
          className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Cerrar aviso"
            className="font-bold text-rose-900 px-2 py-0.5 cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {/* Tarjetas de Selección Rápida de Rol */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {PERFILES_DEMO.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={cargando}
            onClick={() => iniciarConPerfil(p)}
            className={`p-5 rounded-2xl border text-left transition transform active:scale-98 shadow-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:outline-none ${p.color}`}
          >
            <div className="flex items-start gap-3">
              <span className="text-3xl p-2 bg-white rounded-xl shadow-xs border border-slate-100" aria-hidden="true">
                {p.emoji}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 text-base">{p.nombre}</h3>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 shrink-0">
                    {p.rol}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">{p.descripcion}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Ingreso Manual de Token JWT */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Ingresar con Token JWT propio (Tema 19 / OIDC)</h3>
        <p className="text-xs text-slate-500 mb-4">
          Si tenés un token generado por el emulador JWKS o un JWT de desarrollo (<code>falso.*</code>), pegalo aquí para validar la sesión:
        </p>
        <form onSubmit={iniciarConTokenManual} className="flex flex-col sm:flex-row gap-3">
          <label htmlFor="input-token-manual" className="sr-only">
            Token JWT
          </label>
          <input
            id="input-token-manual"
            data-testid="input-token-manual"
            type="text"
            value={tokenManual}
            onChange={(e) => setTokenManual(e.target.value)}
            placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
            className="flex-1 px-3.5 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50"
          />
          <button
            type="submit"
            data-testid="boton-token-manual"
            disabled={!tokenManual.trim() || cargando}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition shadow-xs cursor-pointer"
          >
            Validar e Ingresar
          </button>
        </form>
      </div>
    </div>
  );
};
