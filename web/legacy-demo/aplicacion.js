const formularioRuta = document.querySelector('#formulario-ruta');
const direccionOrigen = document.querySelector('#direccion-origen');
const direccionDestino = document.querySelector('#direccion-destino');
const botonBuscarOrigen = document.querySelector('#boton-buscar-origen');
const botonBuscarDestino = document.querySelector('#boton-buscar-destino');

const campos = {
  latitudOrigen: document.querySelector('#latitud-origen'),
  longitudOrigen: document.querySelector('#longitud-origen'),
  latitudDestino: document.querySelector('#latitud-destino'),
  longitudDestino: document.querySelector('#longitud-destino'),
};
const mensajeRuta = document.querySelector('#mensaje-ruta');
const botonCalcular = document.querySelector('#boton-calcular');
const botonAvanzar = document.querySelector('#boton-avanzar');
const botonReiniciar = document.querySelector('#boton-reiniciar');
const iconoEstado = document.querySelector('#icono-estado');
const nombreEstado = document.querySelector('#nombre-estado');
const etapas = ['SOLICITADO', 'ASIGNADO', 'EN_CURSO', 'FINALIZADO'];
const nombresEtapas = ['Solicitado', 'Asignado', 'En curso', 'Finalizado'];
const mapasEtapas = ['◆', '●', '➤', '✓'];

const mapa = L.map('mapa', { zoomControl: false }).setView([-27.456, -58.989], 14);
L.control.zoom({ position: 'bottomright' }).addTo(mapa);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(mapa);

let lineaRuta;
let marcadorOrigen;
let marcadorDestino;
let indiceEtapa = -1;
let hayRuta = false;
let temporizadorVigencia;

function crearIconoPin(tipo) {
  const esOrigen = tipo === 'origen';
  const gradienteId = esOrigen ? 'degradado-pin-origen' : 'degradado-pin-destino';
  const color1 = esOrigen ? '#22ae7b' : '#f05244';
  const color2 = esOrigen ? '#116849' : '#c5281b';
  const sombraColor = esOrigen ? '#093725' : '#57130d';
  const filtroId = esOrigen ? 'filtro-sombra-origen' : 'filtro-sombra-destino';
  const iconoInterior = esOrigen
    ? '<circle cx="17" cy="16.5" r="5" fill="#ffffff" />'
    : '<rect x="12" y="11.5" width="10" height="10" rx="2.5" fill="#ffffff" />';

  const html = `
    <div class="pin-contenedor pin-${tipo}">
      <div class="pin-svg-wrapper">
        <svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="${gradienteId}" x1="17" y1="2" x2="17" y2="42" gradientUnits="userSpaceOnUse">
              <stop stop-color="${color1}"/>
              <stop offset="1" stop-color="${color2}"/>
            </linearGradient>
            <filter id="${filtroId}" x="-25%" y="-15%" width="150%" height="140%">
              <feDropShadow dx="0" dy="3.5" stdDeviation="2.5" flood-color="${sombraColor}" flood-opacity="0.4"/>
            </filter>
          </defs>
          <path d="M17 42.5C17 42.5 3 27.5 3 16.5C3 8.49187 9.26801 2 17 2C24.732 2 31 8.49187 31 16.5C31 27.5 17 42.5 17 42.5Z"
                fill="url(#${gradienteId})"
                stroke="#ffffff"
                stroke-width="2.5"
                stroke-linejoin="round"
                filter="url(#${filtroId})"/>
          ${iconoInterior}
        </svg>
      </div>
      <div class="pin-base-sombra"></div>
    </div>
  `;

  return L.divIcon({
    className: 'pin-leaflet-icono',
    html,
    iconSize: [34, 44],
    iconAnchor: [17, 43],
    popupAnchor: [0, -45],
  });
}

function armarPopupContenido(tipo, etiqueta, latitud, longitud) {
  const esOrigen = tipo === 'origen';
  const badgeClass = esOrigen ? 'badge-origen' : 'badge-destino';
  const badgeTexto = esOrigen ? 'ORIGEN' : 'DESTINO';
  return `
    <div class="popup-marcador">
      <span class="popup-badge ${badgeClass}">${badgeTexto}</span>
      <strong class="popup-nombre">${etiqueta || (esOrigen ? 'Punto de partida' : 'Punto de destino')}</strong>
      <span class="popup-coordenadas">[${latitud.toFixed(5)}, ${longitud.toFixed(5)}]</span>
      <span class="popup-guia">Arrastrá para reubicar este punto</span>
    </div>
  `;
}

function leerCoordenadas() {
  const origen = [Number(campos.latitudOrigen.value), Number(campos.longitudOrigen.value)];
  const destino = [Number(campos.latitudDestino.value), Number(campos.longitudDestino.value)];
  if (![...origen, ...destino].every(Number.isFinite)) throw new Error('Completá las coordenadas o buscá por dirección.');
  if (Math.abs(origen[0]) > 90 || Math.abs(destino[0]) > 90 || Math.abs(origen[1]) > 180 || Math.abs(destino[1]) > 180) {
    throw new Error('La latitud debe estar entre −90 y 90, y la longitud entre −180 y 180.');
  }
  return { origen, destino };
}

function mostrarMensaje(texto, tipo = '') {
  mensajeRuta.textContent = texto;
  mensajeRuta.className = `mensaje ${tipo}`;
}

function invalidarRutaActual() {
  if (lineaRuta) {
    mapa.removeLayer(lineaRuta);
    lineaRuta = undefined;
  }
  hayRuta = false;
  indiceEtapa = -1;
  window.clearInterval(temporizadorVigencia);
  document.querySelector('#distancia-ruta').textContent = '—';
  document.querySelector('#duracion-ruta').textContent = '—';
  document.querySelector('#precio-estimado').textContent = '—';
  document.querySelector('#vigencia-precio').textContent = 'Calculando precio…';
  actualizarEtapa();
}

function fijarOrigen(latitud, longitud, etiqueta, centrar = false) {
  campos.latitudOrigen.value = latitud.toFixed(6);
  campos.longitudOrigen.value = longitud.toFixed(6);
  const desc = etiqueta || direccionOrigen?.value || 'Plaza 25 de Mayo, Resistencia';
  const textoPopup = armarPopupContenido('origen', desc, latitud, longitud);
  if (!marcadorOrigen) {
    marcadorOrigen = L.marker([latitud, longitud], {
      icon: crearIconoPin('origen'),
      draggable: true,
      title: 'Origen (arrastrá para reubicar)',
    }).bindPopup(textoPopup).addTo(mapa);

    marcadorOrigen.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      void actualizarOrigenPorCoordenadaMapa(pos.lat, pos.lng);
    });
  } else {
    marcadorOrigen.setLatLng([latitud, longitud]);
    marcadorOrigen.setPopupContent(textoPopup);
  }
  if (centrar) {
    mapa.panTo([latitud, longitud]);
  }
  if (hayRuta) {
    invalidarRutaActual();
    mostrarMensaje('Modificaste el origen. Volvé a calcular el recorrido.');
  }
}

function fijarDestino(latitud, longitud, etiqueta, centrar = false) {
  campos.latitudDestino.value = latitud.toFixed(6);
  campos.longitudDestino.value = longitud.toFixed(6);
  const desc = etiqueta || direccionDestino?.value || 'Terminal de Ómnibus, Resistencia';
  const textoPopup = armarPopupContenido('destino', desc, latitud, longitud);
  if (!marcadorDestino) {
    marcadorDestino = L.marker([latitud, longitud], {
      icon: crearIconoPin('destino'),
      draggable: true,
      title: 'Destino (arrastrá para reubicar)',
    }).bindPopup(textoPopup).addTo(mapa);

    marcadorDestino.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      void actualizarDestinoPorCoordenadaMapa(pos.lat, pos.lng);
    });
  } else {
    marcadorDestino.setLatLng([latitud, longitud]);
    marcadorDestino.setPopupContent(textoPopup);
  }
  if (centrar) {
    mapa.panTo([latitud, longitud]);
  }
  if (hayRuta) {
    invalidarRutaActual();
    mostrarMensaje('Modificaste el destino. Volvé a calcular el recorrido.');
  }
}

function actualizarOrigenDesdeInputs() {
  const lat = Number(campos.latitudOrigen.value);
  const lon = Number(campos.longitudOrigen.value);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    const texto = direccionOrigen?.value || 'Punto de partida';
    if (!marcadorOrigen) {
      fijarOrigen(lat, lon, texto);
    } else {
      marcadorOrigen.setLatLng([lat, lon]);
      marcadorOrigen.setPopupContent(armarPopupContenido('origen', texto, lat, lon));
    }
    if (hayRuta) {
      invalidarRutaActual();
      mostrarMensaje('Cambiaste las coordenadas. Volvé a calcular el recorrido.');
    }
  }
}

function actualizarDestinoDesdeInputs() {
  const lat = Number(campos.latitudDestino.value);
  const lon = Number(campos.longitudDestino.value);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    const texto = direccionDestino?.value || 'Punto de destino';
    if (!marcadorDestino) {
      fijarDestino(lat, lon, texto);
    } else {
      marcadorDestino.setLatLng([lat, lon]);
      marcadorDestino.setPopupContent(armarPopupContenido('destino', texto, lat, lon));
    }
    if (hayRuta) {
      invalidarRutaActual();
      mostrarMensaje('Cambiaste las coordenadas. Volvé a calcular el recorrido.');
    }
  }
}

campos.latitudOrigen.addEventListener('input', actualizarOrigenDesdeInputs);
campos.longitudOrigen.addEventListener('input', actualizarOrigenDesdeInputs);
campos.latitudDestino.addEventListener('input', actualizarDestinoDesdeInputs);
campos.longitudDestino.addEventListener('input', actualizarDestinoDesdeInputs);

function obtenerCentroProximidad() {
  const lat = Number(campos.latitudOrigen.value);
  const lon = Number(campos.longitudOrigen.value);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { latitud: lat, longitud: lon };
  }
  return { latitud: -27.451, longitud: -58.986 };
}

async function buscarDireccion(texto) {
  const respuesta = await fetch('/demostracion/geocodificar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      direccion: texto,
      proximidad: obtenerCentroProximidad(),
    }),
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error?.mensaje || `No se pudo geocodificar "${texto}".`);
  return datos.coordenada;
}

async function buscarDireccionInversa(latitud, longitud) {
  try {
    const respuesta = await fetch('/demostracion/geocodificar-inversa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitud, longitud }),
    });
    const datos = await respuesta.json();
    if (respuesta.ok && datos.direccion) {
      return datos.direccion;
    }
  } catch {
    // Si falla la red, usa coordenadas formateadas como respaldo
  }
  return `Ubicación (${latitud.toFixed(4)}, ${longitud.toFixed(4)})`;
}

async function actualizarOrigenPorCoordenadaMapa(lat, lng) {
  fijarOrigen(lat, lng, 'Buscando dirección del punto…', false);
  marcadorOrigen?.openPopup();
  mostrarMensaje('Identificando lugar o dirección en el mapa…');
  const direccion = await buscarDireccionInversa(lat, lng);
  if (direccionOrigen) direccionOrigen.value = direccion;
  fijarOrigen(lat, lng, direccion, false);
  marcadorOrigen?.openPopup();
  mostrarMensaje(`Origen ubicado en: ${direccion}`, 'exito');
}

async function actualizarDestinoPorCoordenadaMapa(lat, lng) {
  fijarDestino(lat, lng, 'Buscando dirección del punto…', false);
  marcadorDestino?.openPopup();
  mostrarMensaje('Identificando lugar o dirección en el mapa…');
  const direccion = await buscarDireccionInversa(lat, lng);
  if (direccionDestino) direccionDestino.value = direccion;
  fijarDestino(lat, lng, direccion, false);
  marcadorDestino?.openPopup();
  mostrarMensaje(`Destino ubicado en: ${direccion}`, 'exito');
}

async function resolverOrigenPorTexto() {
  const texto = direccionOrigen.value.trim();
  if (!texto) return;
  mostrarMensaje(`Buscando coordenadas para "${texto}"…`);
  try {
    const coord = await buscarDireccion(texto);
    fijarOrigen(coord.latitud, coord.longitud, texto, true);
    marcadorOrigen?.openPopup();
    mostrarMensaje(`Origen resuelto: [${coord.latitud.toFixed(4)}, ${coord.longitud.toFixed(4)}]`, 'exito');
  } catch (error) {
    mostrarMensaje(error.message, 'error');
  }
}

async function resolverDestinoPorTexto(textoPersonalizado) {
  const texto = (textoPersonalizado ?? direccionDestino.value).trim();
  if (!texto) return;
  direccionDestino.value = texto;
  mostrarMensaje(`Buscando coordenadas para "${texto}"…`);
  try {
    const coord = await buscarDireccion(texto);
    fijarDestino(coord.latitud, coord.longitud, texto, true);
    marcadorDestino?.openPopup();
    mostrarMensaje(`Destino resuelto: [${coord.latitud.toFixed(4)}, ${coord.longitud.toFixed(4)}]`, 'exito');
  } catch (error) {
    mostrarMensaje(error.message, 'error');
  }
}

if (botonBuscarOrigen) {
  botonBuscarOrigen.addEventListener('click', () => resolverOrigenPorTexto());
}
if (direccionOrigen) {
  direccionOrigen.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); resolverOrigenPorTexto(); } });
}
if (botonBuscarDestino) {
  botonBuscarDestino.addEventListener('click', () => resolverDestinoPorTexto());
}
if (direccionDestino) {
  direccionDestino.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); resolverDestinoPorTexto(); } });
}

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', async () => {
    const destinoSugerido = chip.dataset.destino;
    if (!destinoSugerido) return;
    await resolverDestinoPorTexto(destinoSugerido);
    formularioRuta.dispatchEvent(new Event('submit', { cancelable: true }));
  });
});

mapa.on('click', (evento) => {
  const { lat, lng } = evento.latlng;
  const latTexto = lat.toFixed(6);
  const lonTexto = lng.toFixed(6);
  const contenido = `
    <div class="popup-seleccion-mapa">
      <div class="popup-seleccion-cabecera">
        <span class="popup-seleccion-icono">📍</span>
        <div>
          <strong>Ubicación en el mapa</strong>
          <small>[${lat.toFixed(4)}, ${lng.toFixed(4)}]</small>
        </div>
      </div>
      <div class="popup-botones">
        <button type="button" class="btn-popup btn-fijar-origen" data-lat="${latTexto}" data-lng="${lonTexto}">
          <span class="pin-punto-mini origen"></span> Partir desde aquí
        </button>
        <button type="button" class="btn-popup btn-fijar-destino" data-lat="${latTexto}" data-lng="${lonTexto}">
          <span class="pin-punto-mini destino"></span> Llegar hasta aquí
        </button>
      </div>
    </div>
  `;
  L.popup({ offset: [0, -6], closeButton: true })
    .setLatLng([lat, lng])
    .setContent(contenido)
    .openOn(mapa);
});

document.addEventListener('click', (evento) => {
  const botonOrigen = evento.target.closest('.btn-fijar-origen');
  if (botonOrigen) {
    const lat = Number(botonOrigen.dataset.lat);
    const lng = Number(botonOrigen.dataset.lng);
    mapa.closePopup();
    void actualizarOrigenPorCoordenadaMapa(lat, lng);
    return;
  }
  const botonDestino = evento.target.closest('.btn-fijar-destino');
  if (botonDestino) {
    const lat = Number(botonDestino.dataset.lat);
    const lng = Number(botonDestino.dataset.lng);
    mapa.closePopup();
    void actualizarDestinoPorCoordenadaMapa(lat, lng);
    return;
  }
});

function actualizarEtapa() {
  nombreEstado.textContent = indiceEtapa < 0 ? 'Sin iniciar' : nombresEtapas[indiceEtapa];
  iconoEstado.textContent = indiceEtapa < 0 ? '…' : mapasEtapas[indiceEtapa];
  document.querySelectorAll('[data-paso]').forEach((elemento) => {
    const paso = Number(elemento.dataset.paso);
    elemento.classList.toggle('activo', paso === indiceEtapa);
    elemento.classList.toggle('completado', indiceEtapa >= 0 && paso < indiceEtapa);
  });
  botonAvanzar.disabled = !hayRuta || indiceEtapa >= etapas.length - 1;
  botonAvanzar.textContent = !hayRuta
    ? 'Primero mostrá el recorrido'
    : indiceEtapa === -1
      ? 'Solicitar viaje de prueba'
      : indiceEtapa >= etapas.length - 1
        ? 'Viaje finalizado'
        : `Avanzar a ${nombresEtapas[indiceEtapa + 1].toLowerCase()}`;
}

function mostrarMedida(metros) {
  return metros >= 1000 ? `${(metros / 1000).toFixed(1)} km` : `${Math.round(metros)} m`;
}

function mostrarDuracion(segundos) {
  const minutos = Math.max(1, Math.round(segundos / 60));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

function decodificarPolilinea(cadena, precision) {
  const escala = 10 ** precision;
  const puntos = [];
  let indice = 0;
  let latitud = 0;
  let longitud = 0;

  function leerDelta() {
    let resultado = 0;
    let desplazamiento = 0;
    let fragmento;
    do {
      fragmento = cadena.charCodeAt(indice++) - 63;
      resultado |= (fragmento & 0x1f) << desplazamiento;
      desplazamiento += 5;
    } while (fragmento >= 0x20 && indice < cadena.length);
    return resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
  }

  while (indice < cadena.length) {
    latitud += leerDelta();
    longitud += leerDelta();
    puntos.push([latitud / escala, longitud / escala]);
  }
  return puntos;
}

function iniciarVigencia(fecha) {
  window.clearInterval(temporizadorVigencia);
  const etiqueta = document.querySelector('#vigencia-precio');
  const actualizar = () => {
    const segundos = Math.max(0, Math.ceil((Date.parse(fecha) - Date.now()) / 1000));
    if (segundos === 0) {
      etiqueta.textContent = 'Estimación vencida. Volvé a calcular para actualizar el precio.';
      hayRuta = false;
      indiceEtapa = -1;
      actualizarEtapa();
      window.clearInterval(temporizadorVigencia);
      return;
    }
    const minutos = Math.floor(segundos / 60);
    const resto = String(segundos % 60).padStart(2, '0');
    etiqueta.textContent = `Vigente por ${minutos}:${resto} min`;
  };
  actualizar();
  temporizadorVigencia = window.setInterval(actualizar, 1000);
}

function formatearPrecio(importe, moneda) {
  if (typeof importe !== 'string' || !/^\d+$/.test(importe)) throw new Error('El servidor devolvió un precio inválido.');
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: moneda, maximumFractionDigits: 0,
  }).format(BigInt(importe));
}

function limpiarRuta() {
  invalidarRutaActual();
}

formularioRuta.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    const { origen, destino } = leerCoordenadas();
    invalidarRutaActual();
    botonCalcular.disabled = true;
    botonCalcular.innerHTML = 'Buscando recorrido…';
    mostrarMensaje('Calculando recorrido y precio…');
    const respuesta = await fetch('/demostracion/estimaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origen: { latitud: origen[0], longitud: origen[1] },
        destino: { latitud: destino[0], longitud: destino[1] },
      }),
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error?.mensaje || 'No se pudo calcular el recorrido. Probá de nuevo.');
    const ruta = datos.proveedor_ruta === 'HAVERSINE' || !datos.polilinea
      ? [[origen[0], origen[1]], [destino[0], destino[1]]]
      : decodificarPolilinea(datos.polilinea, datos.proveedor_ruta === 'GOOGLE' ? 5 : 6);
    if (ruta.length < 2) throw new Error('El proveedor no devolvió un recorrido válido.');
    lineaRuta = L.polyline(ruta, { color: '#167957', weight: 5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(mapa);
    fijarOrigen(origen[0], origen[1], direccionOrigen?.value || 'Punto de partida');
    fijarDestino(destino[0], destino[1], direccionDestino?.value || 'Punto de destino');
    mapa.fitBounds(lineaRuta.getBounds(), { padding: [42, 42] });
    document.querySelector('#distancia-ruta').textContent = mostrarMedida(datos.distancia_metros);
    document.querySelector('#duracion-ruta').textContent = mostrarDuracion(datos.duracion_segundos);
    document.querySelector('#precio-estimado').textContent = formatearPrecio(datos.precio_estimado, datos.moneda);
    iniciarVigencia(datos.vigente_hasta);
    hayRuta = true;
    indiceEtapa = -1;
    actualizarEtapa();
    const mensaje = datos.proveedor_ruta === 'HAVERSINE'
      ? 'Precio calculado. El trazo recto es ilustrativo; Haversine no obtiene rutas por calles.'
      : `Recorrido y precio calculados con ${datos.proveedor_ruta}. Ya podés iniciar la simulación.`;
    mostrarMensaje(mensaje, 'exito');
  } catch (error) {
    document.querySelector('#precio-estimado').textContent = 'No disponible';
    document.querySelector('#vigencia-precio').textContent = 'No se pudo generar la estimación.';
    mostrarMensaje(error.message || 'Ocurrió un error al buscar el recorrido.', 'error');
  } finally {
    botonCalcular.disabled = false;
    botonCalcular.innerHTML = 'Mostrar recorrido <span aria-hidden="true">↗</span>';
  }
});

botonAvanzar.addEventListener('click', () => {
  if (!hayRuta || indiceEtapa >= etapas.length - 1) return;
  indiceEtapa += 1;
  actualizarEtapa();
});

botonReiniciar.addEventListener('click', () => {
  indiceEtapa = -1;
  actualizarEtapa();
  mostrarMensaje(hayRuta ? 'Simulación reiniciada. El recorrido sigue visible.' : 'Ingresá direcciones o coordenadas.');
});

document.querySelector('#boton-ubicacion').addEventListener('click', () => {
  if (!navigator.geolocation) return mostrarMensaje('Este navegador no permite obtener la ubicación.', 'error');
  mostrarMensaje('Esperando permiso para usar tu ubicación…');
  navigator.geolocation.getCurrentPosition((ubicacion) => {
    if (direccionOrigen) direccionOrigen.value = 'Mi ubicación actual';
    fijarOrigen(ubicacion.coords.latitude, ubicacion.coords.longitude, 'Mi ubicación actual', true);
    marcadorOrigen?.openPopup();
    mostrarMensaje('Origen actualizado a tu ubicación. Elegí «Mostrar recorrido».', 'exito');
  }, () => mostrarMensaje('No se pudo obtener la ubicación. Podés ingresar las coordenadas manualmente.', 'error'), { timeout: 10000 });
});

function inicializarPinesEnMapa() {
  const latOri = Number(campos.latitudOrigen.value);
  const lonOri = Number(campos.longitudOrigen.value);
  const latDes = Number(campos.latitudDestino.value);
  const lonDes = Number(campos.longitudDestino.value);

  if (Number.isFinite(latOri) && Number.isFinite(lonOri)) {
    fijarOrigen(latOri, lonOri, direccionOrigen?.value || 'Punto de partida');
  }
  if (Number.isFinite(latDes) && Number.isFinite(lonDes)) {
    fijarDestino(latDes, lonDes, direccionDestino?.value || 'Punto de destino');
  }

  if (marcadorOrigen && marcadorDestino) {
    const grupo = L.featureGroup([marcadorOrigen, marcadorDestino]);
    mapa.fitBounds(grupo.getBounds(), { padding: [60, 60], maxZoom: 15 });
  }
}

inicializarPinesEnMapa();
actualizarEtapa();
