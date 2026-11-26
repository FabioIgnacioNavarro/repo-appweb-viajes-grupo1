import React, { useEffect, useState } from "react";
import { useRouter } from "../../nucleo/router";
import {
  cerrarSesion,
  consumirAvisoSesion,
  crearTokenFalsoDesarrollo,
  iniciarSesion,
} from "../../nucleo/sesion";
import { useModoDesarrollador } from "../../nucleo/modoDesarrollador";
import { Rol } from "../../nucleo/tipos";
import {
  Boton,
  CampoTexto,
  IconoAdmin,
  IconoChofer,
  IconoEscudo,
  IconoFlechaDerecha,
  IconoPasajero,
  IconoSoporte,
  Tarjeta,
} from "../../componentes/comunes";

interface PerfilDemo {
  id: string;
  nombre: string;
  rol: Rol;
  descripcion: string;
  icono: React.ReactNode;
  colorIcono: string;
  colorBorde: string;
  colorInsignia: string;
}

const PERFILES_DEMO: PerfilDemo[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    nombre: "Ana Gómez",
    rol: "PASAJERO",
    descripcion: "Solicita viajes, consulta la tarifa estimada, sigue en vivo y paga.",
    icono: <IconoPasajero size={20} />,
    colorIcono: "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    colorBorde: "hover:border-blue-400 dark:hover:border-blue-600",
    colorInsignia: "bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
  {
    id: "11111111-1111-4111-8111-111111111111",
    nombre: "Carlos Maidana",
    rol: "CHOFER",
    descripcion: "Activa disponibilidad, recibe ofertas en tiempo real y realiza el trayecto.",
    icono: <IconoChofer size={20} />,
    colorIcono: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    colorBorde: "hover:border-emerald-400 dark:hover:border-emerald-600",
    colorInsignia: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    nombre: "Lucía Operaciones",
    rol: "SOPORTE",
    descripcion: "Supervisa viajes en curso, consulta auditoría de tarifas y asiste en cancelaciones.",
    icono: <IconoSoporte size={20} />,
    colorIcono: "bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    colorBorde: "hover:border-amber-400 dark:hover:border-amber-600",
    colorInsignia: "bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    nombre: "Martín Administrador",
    rol: "ADMINISTRADOR",
    descripcion: "Acceso total, configuración de reglas de tarifa y métricas del sistema.",
    icono: <IconoAdmin size={20} />,
    colorIcono: "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
    colorBorde: "hover:border-indigo-400 dark:hover:border-indigo-600",
    colorInsignia: "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
  },
];

type ModoEmisionToken = "emulador" | "falso";

export const VistaLogin: React.FC = () => {
  const { navegarA, rutaPorDefectoParaRol } = useRouter();
  const { modoDev } = useModoDesarrollador();
  const [tokenManual, setTokenManual] = useState("");
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [modoToken, setModoToken] = useState<ModoEmisionToken>("emulador");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const aviso = consumirAvisoSesion();
    if (aviso) {
      setError(aviso);
    }
  }, []);

  const iniciarConCredenciales = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError(null);

    try {
      const respuesta = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, contrasena }),
      });
      const datos = (await respuesta.json().catch(() => null)) as {
        token?: string;
        error?: { mensaje?: string };
      } | null;

      if (!respuesta.ok || !datos?.token) {
        setError(datos?.error?.mensaje ?? "No se pudo iniciar sesión. Revisá tus credenciales.");
        return;
      }

      const sesion = iniciarSesion(datos.token);
      setContrasena("");
      navegarA(rutaPorDefectoParaRol(sesion.rol));
    } catch {
      setError("No se pudo conectar con el servicio de identidad. Intentá nuevamente.");
    } finally {
      setCargando(false);
    }
  };

  const iniciarConPerfil = async (perfil: PerfilDemo) => {
    setCargando(true);
    setError(null);

    try {
      if (modoToken === "emulador") {
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

      const soloProduccion =
        typeof window !== "undefined" &&
        (window as unknown as { __ENV__?: { VITE_DESHABILITAR_JWT_FALSO?: string } }).__ENV__
          ?.VITE_DESHABILITAR_JWT_FALSO === "true";
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
    <div className="max-w-3xl mx-auto py-8 sm:py-12 space-y-8" data-testid="vista-login">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl sm:text-3xl font-bold text-[#2C2B28] dark:text-slate-100 tracking-tight">
          Bienvenido a Viapp
        </h1>
        <p className="text-sm text-[#5E5B54] dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          Iniciá sesión con tu cuenta para pedir viajes o gestionar tu jornada.
        </p>
      </div>

      <div className="max-w-md mx-auto w-full space-y-4">
        <Tarjeta titulo="Iniciar sesión" className="shadow-xs">
          <form onSubmit={iniciarConCredenciales} className="space-y-4">
            <CampoTexto
              id="login-usuario"
              data-testid="login-usuario"
              etiqueta="Usuario o email"
              autoComplete="username"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Usuario o correo electrónico"
              required
            />
            <CampoTexto
              id="login-contrasena"
              data-testid="login-contrasena"
              etiqueta="Contraseña"
              type="password"
              autoComplete="current-password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              required
            />
            <div className="pt-1">
              <Boton type="submit" data-testid="boton-iniciar-sesion" variante="primario" anchoCompleto disabled={!usuario.trim() || !contrasena || cargando}>
                {cargando ? "Verificando…" : "Iniciar sesión"}
              </Boton>
            </div>
          </form>
        </Tarjeta>

        {error && (
          <div
            role="alert"
            data-testid="alerta-login"
            className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs sm:text-sm flex items-center justify-between gap-3"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Cerrar aviso"
              className="font-bold text-rose-900 dark:text-rose-200 px-2 py-1 rounded-md hover:bg-rose-100 dark:hover:bg-rose-900/50 cursor-pointer shrink-0"
            >
              &times;
            </button>
          </div>
        )}
      </div>

      {modoDev && (
        <details open className="rounded-xl border border-[#DDD8CC] dark:border-slate-800 bg-[#EFECE4] dark:bg-slate-900 text-[#2C2B28] dark:text-slate-100 p-4 sm:p-5 space-y-4 shadow-xs" data-testid="panel-demo-dev">
          <summary className="cursor-pointer font-semibold text-sm text-[#2C2B28] dark:text-slate-200">
            Opciones de acceso para demo y desarrollo
          </summary>

          <p className="mt-3 text-xs text-[#5E5B54] dark:text-slate-400">
            En el emulador local: usuarios <code className="font-mono font-semibold text-[#2C2B28] dark:text-slate-200">ana</code>, <code className="font-mono font-semibold text-[#2C2B28] dark:text-slate-200">carlos</code>, <code className="font-mono font-semibold text-[#2C2B28] dark:text-slate-200">lucia</code> o <code className="font-mono font-semibold text-[#2C2B28] dark:text-slate-200">martin</code>; contraseña de prueba <code className="font-mono font-semibold text-[#2C2B28] dark:text-slate-200">ViajesDemo2026!</code>.
          </p>

          <div className="mt-4 space-y-6">
            {/* Selector de modo de emisión de credenciales */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-[#DDD8CC] dark:border-slate-800 bg-[#F7F5F0] dark:bg-slate-950/60 px-4 py-3 text-xs">
              <span className="font-semibold text-[#2C2B28] dark:text-slate-200">Modo de emisión de credenciales:</span>
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#E5E0D4] dark:bg-slate-800 p-1 w-full sm:w-auto" role="group" aria-label="Modo de token">
                <button
                  type="button"
                  data-testid="modo-token-emulador"
                  onClick={() => setModoToken("emulador")}
                  className={`flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
                    modoToken === "emulador"
                      ? "bg-[#F7F5F0] dark:bg-slate-900 text-[#4A7C59] dark:text-emerald-300 shadow-xs"
                      : "text-[#5E5B54] dark:text-slate-300 hover:text-[#2C2B28] dark:hover:text-slate-100"
                  }`}
                >
                  Emulador JWKS (RS256)
                </button>
                <button
                  type="button"
                  data-testid="modo-token-falso"
                  onClick={() => setModoToken("falso")}
                  className={`flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
                    modoToken === "falso"
                      ? "bg-[#F7F5F0] dark:bg-slate-900 text-[#4A7C59] dark:text-emerald-300 shadow-xs"
                      : "text-[#5E5B54] dark:text-slate-300 hover:text-[#2C2B28] dark:hover:text-slate-100"
                  }`}
                  title="Solo para entornos locales con JWT_MODO=falso fuera de producción"
                >
                  Desarrollo (JWT falso)
                </button>
              </div>
            </div>

            {/* Cuadrícula de Perfiles por Rol */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PERFILES_DEMO.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={cargando}
                  onClick={() => iniciarConPerfil(p)}
                  className={`p-5 rounded-xl border border-[#DDD8CC] dark:border-slate-800 bg-[#F7F5F0] dark:bg-slate-800/60 hover:bg-[#FCFBF8] dark:hover:bg-slate-800 text-left transition-all cursor-pointer flex flex-col justify-between gap-4 group ${p.colorBorde}`}
                >
                  <div className="space-y-3 w-full">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${p.colorIcono}`}>
                          {p.icono}
                        </div>
                        <div className="min-w-0">
                          <h2 className="font-semibold text-slate-900 dark:text-slate-100 text-sm sm:text-base truncate">{p.nombre}</h2>
                          <span className="block text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">{p.id}</span>
                        </div>
                      </div>
                      <span className={`text-[11px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full border shrink-0 ${p.colorInsignia}`}>
                        {p.rol}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{p.descripcion}</p>
                  </div>

                  <div className="w-full pt-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100">
                    <span>Ingresar como {p.rol.toLowerCase()}</span>
                    <span className="transition-transform group-hover:translate-x-1">
                      <IconoFlechaDerecha size={14} />
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Ingreso Manual de Token JWT */}
            <Tarjeta
              titulo={
                <span className="inline-flex items-center gap-2">
                  <IconoEscudo size={18} className="text-slate-700 dark:text-slate-300" />
                  Ingresar con Token JWT propio (OIDC)
                </span>
              }
              subtitulo="Si tenés un token generado por el emulador JWKS o un JWT de desarrollo (falso.*), pegalo aquí para validar la sesión."
            >
              <form onSubmit={iniciarConTokenManual} className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1 min-w-0">
                  <CampoTexto
                    id="input-token-manual"
                    data-testid="input-token-manual"
                    etiqueta="Token JWT (Bearer)"
                    value={tokenManual}
                    onChange={(e) => setTokenManual(e.target.value)}
                    placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="font-mono text-xs"
                  />
                </div>
                <Boton
                  type="submit"
                  data-testid="boton-token-manual"
                  variante="primario"
                  disabled={!tokenManual.trim() || cargando}
                  className="w-full sm:w-auto shrink-0"
                >
                  Validar e Ingresar
                </Boton>
              </form>
            </Tarjeta>
          </div>
        </details>
      )}
    </div>
  );
};
