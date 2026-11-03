import React, { useState } from "react";
import { useRouter } from "../../nucleo/router";
import { iniciarSesion } from "../../nucleo/sesion";
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
    id: "pasajero-demo-1",
    nombre: "Ana Gómez",
    rol: "PASAJERO",
    descripcion: "Solicita viajes, visualiza precio dinámico (Variante A), sigue en vivo y paga.",
    emoji: "🙋‍♀️",
    color: "border-blue-200 hover:border-blue-400 bg-blue-50/50",
  },
  {
    id: "chofer-demo-1",
    nombre: "Carlos Maidana",
    rol: "CHOFER",
    descripcion: "Activa disponibilidad, recibe ofertas en tiempo real y realiza el trayecto.",
    emoji: "🚕",
    color: "border-emerald-200 hover:border-emerald-400 bg-emerald-50/50",
  },
  {
    id: "soporte-demo-1",
    nombre: "Lucía Operaciones",
    rol: "SOPORTE",
    descripcion: "Supervisa viajes en curso, consulta auditoría de tarifas y asiste en cancelaciones.",
    emoji: "🎧",
    color: "border-purple-200 hover:border-purple-400 bg-purple-50/50",
  },
  {
    id: "admin-demo-1",
    nombre: "Martín Administrador",
    rol: "ADMINISTRADOR",
    descripcion: "Acceso total, configuración de reglas de demanda por zona y métricas del sistema.",
    emoji: "⚙️",
    color: "border-amber-200 hover:border-amber-400 bg-amber-50/50",
  },
];

export const VistaLogin: React.FC = () => {
  const { navegarA, rutaPorDefectoParaRol } = useRouter();
  const [tokenManual, setTokenManual] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Función para obtener un token real del emulador o generar el token de prueba
  const iniciarConPerfil = async (perfil: PerfilDemo) => {
    setCargando(true);
    setError(null);

    try {
      // 1. Intentar solicitar token RS256 al emulador de identidad (/auth/token)
      const respuesta = await fetch("/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idUsuario: perfil.id,
          rol: perfil.rol,
          email: `${perfil.id}@viajes.local`,
          nombre: perfil.nombre,
        }),
      }).catch(() => null);

      if (respuesta && respuesta.ok) {
        const datos = await respuesta.json();
        if (datos.token) {
          iniciarSesion(datos.token, { idUsuario: perfil.id, rol: perfil.rol, nombre: perfil.nombre });
          navegarA(rutaPorDefectoParaRol(perfil.rol));
          return;
        }
      }

      // 2. Si el emulador no está expuesto en ese puerto en desarrollo local, usar token falso estándar
      const payloadFalso = {
        sub: perfil.id,
        idUsuario: perfil.id,
        rol: perfil.rol,
        name: perfil.nombre,
        email: `${perfil.id}@viajes.local`,
        exp: Math.floor(Date.now() / 1000) + 7200,
      };
      const tokenFalso = `falso.${btoa(JSON.stringify(payloadFalso)).replace(/=/g, "")}`;

      iniciarSesion(tokenFalso, { idUsuario: perfil.id, rol: perfil.rol, nombre: perfil.nombre });
      navegarA(rutaPorDefectoParaRol(perfil.rol));
    } catch (err) {
      setError("No se pudo iniciar sesión con el perfil seleccionado.");
    } finally {
      setCargando(false);
    }
  };

  const iniciarConTokenManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenManual.trim()) return;

    try {
      const sesion = iniciarSesion(tokenManual.trim());
      navegarA(rutaPorDefectoParaRol(sesion.rol));
    } catch (err) {
      setError("El token ingresado no es válido o no tiene formato JWT compatible.");
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8">
      {/* Encabezado */}
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Bienvenido a la Plataforma de Viajes
        </h1>
        <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-xl mx-auto">
          Seleccioná un perfil de prueba para ingresar con credenciales de identidad externa o pegá un token JWT.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold text-rose-900">&times;</button>
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
            className={`p-5 rounded-2xl border text-left transition transform active:scale-98 shadow-xs cursor-pointer ${p.color}`}
          >
            <div className="flex items-start gap-3">
              <span className="text-3xl p-2 bg-white rounded-xl shadow-xs border border-slate-100">{p.emoji}</span>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900 text-base">{p.nombre}</h3>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
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
          Si tenés un token generado por el emulador de Firebase o el emulador JWKS, pegalo aquí para validar la sesión:
        </p>
        <form onSubmit={iniciarConTokenManual} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={tokenManual}
            onChange={(e) => setTokenManual(e.target.value)}
            placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
            className="flex-1 px-3.5 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-slate-50"
          />
          <button
            type="submit"
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
