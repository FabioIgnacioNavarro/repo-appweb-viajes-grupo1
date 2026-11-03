import React from "react";
import { ProveedorRouter, useRouter } from "./nucleo/router";
import { Shell } from "./componentes/comunes/Shell";
import { VistaLogin } from "./vistas/login/VistaLogin";
import { VistaPasajero } from "./vistas/pasajero/VistaPasajero";
import { VistaChofer } from "./vistas/chofer/VistaChofer";
import { VistaOperador } from "./vistas/operador/VistaOperador";
import { VistaAdmin } from "./vistas/admin/VistaAdmin";
import { VistaNoAutorizado } from "./vistas/no_autorizado/VistaNoAutorizado";

const ContenidoApp: React.FC = () => {
  const { rutaActual } = useRouter();

  const renderizarVista = () => {
    switch (rutaActual) {
      case "login":
        return <VistaLogin />;
      case "pasajero":
        return <VistaPasajero />;
      case "chofer":
        return <VistaChofer />;
      case "operador":
        return <VistaOperador />;
      case "admin":
        return <VistaAdmin />;
      case "no_autorizado":
        return <VistaNoAutorizado />;
      default:
        return <VistaLogin />;
    }
  };

  return <Shell>{renderizarVista()}</Shell>;
};

export const App: React.FC = () => {
  return (
    <ProveedorRouter>
      <ContenidoApp />
    </ProveedorRouter>
  );
};

export default App;
