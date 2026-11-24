import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { inicializarTema } from "./nucleo/tema";
import "./index.css";

inicializarTema();

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
