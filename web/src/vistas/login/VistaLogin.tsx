import React, { useEffect, useState } from "react";
import { useRouter } from "../../nucleo/router";
import {
  cerrarSesion,
  consumirAvisoSesion,
  crearTokenFalsoDesarrollo,
  iniciarSesion,
} from "../../nucleo/sesion";
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
    descripcion: "Solicita viajes, visualiza precio dinámico (Variante A), sigue en vivo y paga.",
    icono: <IconoPasajero size={20} />,
    colorIcono: "bg-blue-50 text-blue-700 border-blue-200",
    colorBorde: "hover:border-blue-400",
    colorInsignia: "bg-blue-50 text-blue-800 border-blue-200",
  },
  {
    id: "11111111-1111-4111-8111-111111111111",
    nombre: "Carlos Maidana",
    rol: "CHOFER",
    descripcion: "Activa disponibilidad, recibe ofertas en tiempo real y realiza el trayecto.",
    icono: <IconoChofer size={20} />,
    colorIcono: "bg-emerald-50 text-emerald-700 border-emerald-200",
    colorBorde: "hover:border-emerald-400",
    colorInsignia: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    nombre: "Lucía Operaciones",
    rol: "SOPORTE",
    descripcion: "Supervisa viajes en curso, consulta auditoría de tarifas y asiste en cancelaciones.",
    icono: <IconoSoporte size={20} />,
    colorIcono: "bg-amber-50 text-amber-800 border-amber-200",
    colorBorde: "hover:border-amber-400",
    colorInsignia: "bg-amber-50 text-amber-900 border-amber-200",
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    nombre: "Martín Administrador",
    rol: "ADMINISTRADOR",
    descripcion: "Acceso total, configuración de reglas de demanda por zona y métricas del sistema.",
    icono: <IconoAdmin size={20} />,
    colorIcono: "bg-indigo-50 text-indigo-700 border-indigo-200",
    colorBorde: "hover:border-indigo-400",
    colorInsignia: "bg-indigo-50 text-indigo-800 border-indigo-200",
  },
];

type ModoEmisionToken = "emulador" | "falso";

export const VistaLogin: React.FC = () => {
  const { navegarA, rutaPorDefectoParaRol } = useRouter();
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
    <div className="max-w-4xl mx-auto py-4 sm:py-8 space-y-6" data-testid="vista-login">
      <div className="space-y-2 text-center sm:text-left">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Bienvenido a la Plataforma de Viajes
        </h1>
        <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
          Iniciá sesión con tu usuario y contraseña. La identidad se valida en el emulador externo y la plataforma recibe un JWT firmado.
        </p>
      </div>

      <Tarjeta titulo="Iniciar sesión" subtitulo="Usá las credenciales de una cuenta registrada.">
        <form onSubmit={iniciarConCredenciales} className="max-w-md space-y-4">
          <CampoTexto
            id="login-usuario"
            data-testid="login-usuario"
            etiqueta="Usuario o email"
            autoComplete="username"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            placeholder="ana o ana@viajes.local"
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
          <Boton type="submit" data-testid="boton-iniciar-sesion" variante="primario" disabled={!usuario.trim() || !contrasena || cargando}>
            {cargando ? "Verificando…" : "Iniciar sesión"}
          </Boton>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          En el emulador local: usuarios ana, carlos, lucia o martin; contraseña de prueba <code>ViajesDemo2026!</code>.
        </p>
      </Tarjeta>

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-sm text-slate-800">
          Opciones de acceso para demo y desarrollo
        </summary>
        <div className="mt-4 space-y-6">
      {/* Selector de modo de emisión de credenciales */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
        <span className="font-semibold text-slate-800">Modo de emisión de credenciales:</span>
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 w-full sm:w-auto" role="group" aria-label="Modo de token">
          <button
            type="button"
            data-testid="modo-token-emulador"
            onClick={() => setModoToken("emulador")}
            className={`flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
              modoToken === "emulador" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-700 hover:text-slate-900"
            }`}
          >
            Emulador JWKS (RS256)
          </button>
          <button
            type="button"
            data-testid="modo-token-falso"
            onClick={() => setModoToken("falso")}
            className={`flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
              modoToken === "falso" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-700 hover:text-slate-900"
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
          className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Cerrar aviso"
            className="font-bold text-rose-900 px-2 py-1 rounded-md hover:bg-rose-100 cursor-pointer shrink-0"
          >
            &times;
          </button>
        </div>
      )}

      {/* Cuadrícula de Perfiles por Rol */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PERFILES_DEMO.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={cargando}
            onClick={() => iniciarConPerfil(p)}
            className={`p-5 rounded-xl border border-slate-200 bg-white text-left transition-all cursor-pointer flex flex-col justify-between gap-4 group ${p.colorBorde}`}
          >
            <div className="space-y-3 w-full">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${p.colorIcono}`}>
                    {p.icono}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-900 text-sm sm:text-base truncate">{p.nombre}</h2>
                    <span className="block text-[11px] font-mono text-slate-500 truncate">{p.id}</span>
                  </div>
                </div>
                <span className={`text-[11px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full border shrink-0 ${p.colorInsignia}`}>
                  {p.rol}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{p.descripcion}</p>
            </div>

            <div className="w-full pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 group-hover:text-slate-900">
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
            <IconoEscudo size={18} className="text-slate-700" />
            Ingresar con Token JWT propio (Tema 19 / OIDC)
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
    </div>
  );
};
