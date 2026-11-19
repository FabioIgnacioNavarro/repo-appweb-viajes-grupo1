---
name: Plataforma de Viajes — Sistema de Diseño
description: Sistema de diseño sobrio, accesible y técnico para transporte urbano y movilidad
colors:
  surface-bg: "#f8fafc"
  surface-card: "#ffffff"
  surface-border: "#e2e8f0"
  text-primary: "#0f172a"
  text-secondary: "#475569"
  text-muted: "#64748b"
  role-pasajero: "#2563eb"
  role-pasajero-bg: "#eff6ff"
  role-pasajero-border: "#bfdbfe"
  role-chofer: "#059669"
  role-chofer-bg: "#ecfdf5"
  role-chofer-border: "#a7f3d0"
  role-operador: "#d97706"
  role-operador-bg: "#fffbeb"
  role-operador-border: "#fde68a"
  role-admin: "#4f46e5"
  role-admin-bg: "#eef2ff"
  role-admin-border: "#c7d2fe"
  status-online: "#10b981"
  status-offline: "#94a3b8"
  status-error: "#dc2626"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  caption:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.text-primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-chofer:
    backgroundColor: "{colors.role-chofer}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  card-panel:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Sistema de Diseño de la Plataforma de Viajes

## Overview

Este sistema de diseño guía la experiencia de usuario para los cuatro roles de la plataforma: Pasajero, Chofer, Operador y Administrador. 
Está construido para resistir entornos reales de movilidad urbana: interfaces de alta legibilidad para el chofer en ruta, paneles de auditoría precisos para el operador y flujos de reserva transparentes para el pasajero.
Erradica los clichés de diseño genéricos generados por IA (degradados violetas, tarjetas anidadas sin jerarquía, emojis como íconos) y prioriza la velocidad de escaneo visual, la accesibilidad de contraste y la robustez técnica.

## Colors

La paleta se apoya en una base neutra limpia y funcional, reservando colores cromáticos exclusivamente para la identificación inequívoca de roles y estados de conexión.

### Colores Base y Superficies
- **Fondo General (`surface-bg`):** `#f8fafc` (Slate 50). Suave, reduce el deslumbramiento en pantallas grandes.
- **Superficie de Tarjeta / Panel (`surface-card`):** `#ffffff`. Superficie blanca sólida con borde de 1px.
- **Borde Primario (`surface-border`):** `#e2e8f0` (Slate 200). Define contornos nítidos sin saturar.
- **Texto Principal (`text-primary`):** `#0f172a` (Slate 900). Relación de contraste 14:1 contra blanco.
- **Texto Secundario (`text-secondary`):** `#475569` (Slate 600). Relación de contraste 6:1 contra blanco.

### Códigos de Rol (Identidad Funcional)
Cada rol cuenta con un matiz rector que orienta al usuario en todo momento:
- **Pasajero (`#2563eb` - Azul Zafiro):** Confianza, tranquilidad y claridad de tarifa.
- **Chofer (`#059669` - Verde Esmeralda):** Acción inmediata, disponibilidad, ingresos y conducción.
- **Operador (`#d97706` - Ámbar):** Atención, supervisión, soporte y resolución de cancelaciones.
- **Administrador (`#4f46e5` - Índigo):** Configuración técnica, gobierno de datos y reglas dinámicas.

### Estados Operativos
- **En Línea / Conectado:** `#10b981` (Verde).
- **Desconectado / Reconectando:** `#94a3b8` (Slate 400).
- **Error / Falla:** `#dc2626` (Rojo).

## Typography

Utilizamos la pila de fuentes nativas del sistema operativo (`system-ui`), garantizando cero tiempo de carga, renderizado nítido en cualquier dispositivo móvil o de escritorio y comportamiento predecible.

- **Display / Títulos Principales:** `text-2xl` (24px a 28px), peso `font-bold` (700), espaciado `-0.02em`. Se utiliza con moderación para títulos de página.
- **Encabezados de Sección:** `text-base` a `text-lg` (16px a 18px), peso `font-semibold` (600), espaciado `-0.01em`.
- **Cuerpo de Texto:** `text-sm` (14px), peso `font-normal` (400), interlineado `leading-relaxed` (1.5). Longitud de línea limitada a máximo 65-75 caracteres.
- **Etiquetas y Metadatos:** `text-xs` (12px), peso `font-medium` (500).
- **Códigos, Claves e IDs:** `font-mono text-xs`, tabular nums para precios, coordenadas y tokens de auditoría.

## Layout

Diseño estrictamente **Mobile-First**:
- **360px a 480px (Móvil - Chofer y Pasajero):** Una sola columna. Acciones principales fijadas o al alcance del pulgar. Elementos táctiles con un mínimo de 44x44px.
- **768px a 1023px (Tablet):** Cuadrículas de dos columnas. Mapas y paneles en proporción balanceada.
- **1024px+ (Desktop - Operador y Administrador):** Tres columnas con mapa interactivo central/derecho y consola de control lateral. Tablas densas con scroll horizontal protegido.

## Elevation & Depth

Regla de oro de Impeccable: **La elevación se declara una sola vez (borde O sombra sutil, nunca ambos compitiendo).**
- Los paneles utilizan bordes finos de 1px (`border-slate-200`) sobre fondos planos.
- Se evita el efecto "ghost card" (bordes con sombras difusas masivas).
- Las sombras se reservan únicamente para elementos flotantes interactivos (menús desplegables, toasts o modales de confirmación): `shadow-sm` o `shadow-md` con desenfoque suave y desplazamiento vertical.

## Shapes

- **Paneles y Tarjetas:** Esquinas redondeadas suaves de `rounded-xl` (12px a 16px).
- **Botones y Campos de Entrada:** `rounded-lg` (8px a 10px).
- **Insignias y Pills de Estado:** `rounded-full` (completamente redondeadas) con relleno vertical compacto.
- **Prohibido:** Neobrutalismo fuera de contexto (bordes de 3px negros con sombras sólidas desplazadas sin desenfoque).

## Components

### 1. Botones de Acción
- **Primario:** Fondo oscuro slate-900 con texto blanco para acciones neutras o de navegación.
- **Por Rol:** Botón esmeralda para el chofer ("Aceptar Viaje"), botón azul para el pasajero ("Confirmar Viaje").
- **Estados:** `hover:brightness-95`, `active:scale-[0.98]`, `disabled:opacity-50 disabled:cursor-not-allowed`. Foco visible `focus-visible:ring-2 focus-visible:ring-offset-2`.

### 2. Indicadores de Estado (Status Pills)
- Píldora compacta con punto de color pulsante o estático:
  - WebSocket: Punto verde titilante cuando está conectado a `/ws`.
  - Demanda: Insignia con multiplicador (`x1.25`) en tipografía monoespaciada para auditoría visual inmediata.

### 3. Iconografía Técnica
- **SVG lineales de 1.5px / 20px:** Dibujados directamente o vectorizados coherentemente.
- Se eliminan los emojis como sustitutos de íconos de sistema para conferir seriedad a la plataforma.

### 4. Paneles de Información
- Estructura sin tarjetas anidadas: un contenedor principal con separadores divisorios (`divide-y divide-slate-100`) en lugar de tarjetas dentro de tarjetas.

## Do's and Don'ts

### Do's ✅
- **Hacer:** Mostrar siempre el multiplicador dinámico y los factores antes de confirmar (Variante A).
- **Hacer:** Proporcionar etiquetas `label` asociadas a todos los campos `input` para lectores de pantalla.
- **Hacer:** Emplear números tabulares (`font-mono`) en importes monetarios, coordenadas geográficas y tiempos regresivos.
- **Hacer:** Diseñar primero para una mano en pantalla móvil de 360px.

### Don'ts ❌
- **No:** Usar emojis como sustitutos de botones o íconos de la interfaz.
- **No:** Anidar tarjetas dentro de tarjetas (anti-patrón de diseño de IA).
- **No:** Poner textos o eyebrows decorativos en mayúsculas pequeñas por encima de los títulos principales sin necesidad.
- **No:** Utilizar degradados llamativos sin justificación funcional.
- **No:** Colocar texto gris claro sobre fondos de color con contraste inferior a 4.5:1.
