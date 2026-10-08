const formularioRuta = document.querySelector('#formulario-ruta');
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

function punto(latitud, longitud, clase, texto) {
  const icono = L.divIcon({
    className: '',
    html: `<span class="marcador-mapa ${clase}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  return L.marker([latitud, longitud], { icon: icono }).bindPopup(texto).addTo(mapa);
}

function leerCoordenadas() {
  const origen = [Number(campos.latitudOrigen.value), Number(campos.longitudOrigen.value)];
  const destino = [Number(campos.latitudDestino.value), Number(campos.longitudDestino.value)];
  if (![...origen, ...destino].every(Number.isFinite)) throw new Error('Completá las cuatro coordenadas.');
  if (Math.abs(origen[0]) > 90 || Math.abs(destino[0]) > 90 || Math.abs(origen[1]) > 180 || Math.abs(destino[1]) > 180) {
    throw new Error('La latitud debe estar entre −90 y 90, y la longitud entre −180 y 180.');
  }
  return { origen, destino };
}

function mostrarMensaje(texto, tipo = '') {
  mensajeRuta.textContent = texto;
  mensajeRuta.className = `mensaje ${tipo}`;
}

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
    ? 'Primero mostr&aacute; el recorrido'
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
  if (lineaRuta) mapa.removeLayer(lineaRuta);
  if (marcadorOrigen) mapa.removeLayer(marcadorOrigen);
  if (marcadorDestino) mapa.removeLayer(marcadorDestino);
  lineaRuta = undefined;
  marcadorOrigen = undefined;
  marcadorDestino = undefined;
  hayRuta = false;
  indiceEtapa = -1;
  window.clearInterval(temporizadorVigencia);
  document.querySelector('#distancia-ruta').textContent = '—';
  document.querySelector('#duracion-ruta').textContent = '—';
  document.querySelector('#precio-estimado').textContent = '—';
  document.querySelector('#vigencia-precio').textContent = 'Calculando precio…';
  actualizarEtapa();
}

formularioRuta.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    const { origen, destino } = leerCoordenadas();
    limpiarRuta();
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
    marcadorOrigen = punto(origen[0], origen[1], 'origen', 'Punto de partida');
    marcadorDestino = punto(destino[0], destino[1], 'destino', 'Punto de destino');
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
  mostrarMensaje(hayRuta ? 'Simulación reiniciada. El recorrido sigue visible.' : 'Ingresá las coordenadas o elegí tu ubicación.');
});

Object.values(campos).forEach((campo) => campo.addEventListener('input', () => {
  if (!hayRuta) return;
  limpiarRuta();
  mostrarMensaje('Cambiaste las coordenadas. Volvé a calcular el precio y el recorrido.');
}));

document.querySelector('#boton-ubicacion').addEventListener('click', () => {
  if (!navigator.geolocation) return mostrarMensaje('Este navegador no permite obtener la ubicación.', 'error');
  mostrarMensaje('Esperando permiso para usar tu ubicación…');
  navigator.geolocation.getCurrentPosition((ubicacion) => {
    campos.latitudOrigen.value = ubicacion.coords.latitude.toFixed(6);
    campos.longitudOrigen.value = ubicacion.coords.longitude.toFixed(6);
    if (hayRuta) limpiarRuta();
    mostrarMensaje('Origen actualizado. Elegí «Mostrar recorrido».', 'exito');
  }, () => mostrarMensaje('No se pudo obtener la ubicación. Podés ingresar las coordenadas manualmente.', 'error'), { timeout: 10000 });
});

actualizarEtapa();
