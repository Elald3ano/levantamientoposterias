import { state, CONFIG } from '../store/state.js';
import { SB, BUCKET_FOTOS, withTimeout, kmzPublicUrl, kmzPath, sbUploadKMZ, sbDeleteKMZ, sbCheckKMZ } from '../api/supabase.js';
import { showToast, escHtml } from '../main.js';

function calcularDistancia(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (v) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ═══════════════════════════════════════════════════
// RESILIENT TILE LAYER — 3-level auto-fallback
// ═══════════════════════════════════════════════════
const ResilientTileLayer = L.TileLayer.extend({
  initialize: function(urlTemplates, options) {
    this._urlTemplates = urlTemplates;
    L.TileLayer.prototype.initialize.call(this, urlTemplates[0], options);
  },

  createTile: function(coords, done) {
    const tile = document.createElement('img');

    L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
    L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));

    if (this.options.crossOrigin || this.options.crossOrigin === '') {
      tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
    }

    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    tile._fallbackIdx = 0;
    tile._urlTemplates = this._urlTemplates;
    tile._coords = coords;
    tile._layer = this;

    const data = L.extend({}, coords, { s: this._getSubdomain(coords) });
    tile.src = L.Util.template(this._urlTemplates[0], data);

    return tile;
  },

  _tileOnError: function(done, tile, e) {
    tile._fallbackIdx++;
    if (tile._fallbackIdx < tile._urlTemplates.length) {
      const data = L.extend({}, tile._coords, { s: tile._layer._getSubdomain(tile._coords) });
      tile.src = L.Util.template(tile._urlTemplates[tile._fallbackIdx], data);
    } else {
      L.DomEvent.off(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
      if (done) { done(new Error('All tile URLs failed'), tile); }
    }
  }
});

const GOOGLE_HYBRID = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const GOOGLE_ATTRIB = 'Tiles \u00A9 Google';
const ESRI_ATTRIB = 'Tiles \u00A9 Esri — Source: Esri, Maxar, Earthstar Geographics';
const OSM_ATTRIB = '\u00A9 OpenStreetMap contributors';

// ═══════════════════════════════════════════════════
// OFFLINE TILE DOWNLOAD
// ═══════════════════════════════════════════════════
function getTileCoordsForBounds(map, zoom) {
  var bounds = map.getBounds();
  var nw = bounds.getNorthWest();
  var se = bounds.getSouthEast();
  var nwPoint = map.project(nw, zoom);
  var sePoint = map.project(se, zoom);
  var tileNW = nwPoint.divideBy(256).floor();
  var tileSE = sePoint.divideBy(256).floor();
  var maxTile = Math.pow(2, zoom);
  var tiles = [];
  for (var x = tileNW.x; x <= tileSE.x; x++) {
    if (x < 0 || x >= maxTile) continue;
    for (var y = tileNW.y; y <= tileSE.y; y++) {
      if (y < 0 || y >= maxTile) continue;
      tiles.push({ x: x, y: y, z: zoom });
    }
  }
  return tiles;
}

function collectAllTiles(map, fromZoom, maxZoom) {
  var all = [];
  for (var z = fromZoom; z <= maxZoom; z++) {
    var levelTiles = getTileCoordsForBounds(map, z);
    all = all.concat(levelTiles);
  }
  return all;
}

async function resolveEsriCache() {
  if (typeof caches === 'undefined') return null;
  var names = await caches.keys();
  var exact = names.find(function(n) { return n === 'esri-tiles'; });
  if (exact) return exact;
  var partial = names.find(function(n) { return n.toLowerCase().indexOf('esri') !== -1; });
  return partial || null;
}

async function downloadOfflineMap() {
  var map = state.mapInst;
  if (!map) return;
  if (typeof caches === 'undefined') {
    showToast('Cache API no disponible en este navegador', 'error');
    return;
  }

  var currentZoom = Math.floor(map.getZoom());
  var MAX_ZOOM = 18;
  var allTiles = collectAllTiles(map, currentZoom, MAX_ZOOM);
  var total = allTiles.length;

  if (total > 1000) {
    showToast('\u00C1rea muy grande: Ac\u00E9rcate m\u00E1s a la zona de trabajo (' + total + ' tiles)', 'error');
    return;
  }
  if (total === 0) {
    showToast('No hay mosaicos que descargar en esta \u00E1rea', 'warning');
    return;
  }

  if (navigator.storage && navigator.storage.estimate) {
    var est = await navigator.storage.estimate();
    var free = est.quota - est.usage;
    var needed = total * 30 * 1024;
    if (needed > free * 0.8) {
      showToast('Espacio insuficiente en el navegador para este nivel de detalle', 'error');
      return;
    }
  }

  var cacheName = await resolveEsriCache();
  if (!cacheName) {
    showToast('Cach\u00E9 de mosaicos no encontrada. Abre el mapa con conexi\u00F3n primero.', 'error');
    return;
  }

  var cache = await caches.open(cacheName);
  var BATCH_SIZE = 10;
  var downloaded = 0;
  var skipped = 0;
  var failed = 0;

  for (var i = 0; i < total; i += BATCH_SIZE) {
    var batch = allTiles.slice(i, i + BATCH_SIZE);
    var results = await Promise.allSettled(batch.map(function(_a) {
      var x = _a.x, y = _a.y, z = _a.z;
      var url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
      return cache.match(url).then(function(cached) {
        if (cached) { skipped++; return; }
        return fetch(url, { mode: 'cors' }).then(function(resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return cache.put(url, resp);
        }).then(function() {
          downloaded++;
        }).catch(function(err) {
          if (err.name === 'QuotaExceededError' || String(err).toLowerCase().indexOf('quota') !== -1) {
            cache.delete(url);
            throw err; // let allSettled catch it, abort loop below
          }
          throw err;
        });
      });
    }));

    var batchFailed = results.filter(function(r) { return r.status === 'rejected'; }).length;
    failed += batchFailed;

    var quotaHit = results.some(function(r) {
      return r.status === 'rejected' && r.reason && (
        r.reason.name === 'QuotaExceededError' ||
        String(r.reason).toLowerCase().indexOf('quota') !== -1
      );
    });
    if (quotaHit) {
      showToast('Memoria del navegador llena. Por favor, borra mapas antiguos o datos del sitio', 'error');
      break;
    }

    showToast('Descargando mapa: ' + (downloaded + skipped) + ' de ' + total + '...', 'info');
  }

  if (failed > 0) {
    showToast('Mapa offline: ' + downloaded + ' nuevos, ' + skipped + ' en cach\u00E9, ' + failed + ' errores', 'warning');
  } else {
    showToast('Mapa offline listo: ' + downloaded + ' descargados + ' + skipped + ' en cach\u00E9 \u2713');
  }
}

var DownloadMapControl = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd: function() {
    var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    container.style.cssText = 'background:var(--card);border:1px solid var(--border);padding:8px 12px;cursor:pointer;font-family:Inter,sans-serif;font-size:13px;font-weight:700;color:var(--accent);border-radius:4px;user-select:none';
    container.textContent = '\uD83D\uDCE5 Descargar Zona (Offline)';

    L.DomEvent.on(container, 'click', function(e) {
      L.DomEvent.stopPropagation(e);
      if (container._downloading) return;
      container._downloading = true;
      container.textContent = '\u23F3 Descargando...';
      container.style.cursor = 'wait';
      container.style.color = 'var(--muted)';

      downloadOfflineMap().finally(function() {
        container._downloading = false;
        container.textContent = '\uD83D\uDCE5 Descargar Zona (Offline)';
        container.style.cursor = 'pointer';
        container.style.color = 'var(--accent)';
      });
    });

    return container;
  }
});

// ═══════════════════════════════════════════════════
// DEBOUNCED REVERSE GEOCODING — 1500ms
// ═══════════════════════════════════════════════════
let _nominatimTimer = null;
let _nominatimPendingResolve = null;

export async function reverseGeocode(lat, lng) {
  try {
    const r = await withTimeout(
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`),
      CONFIG.NETWORK_TIMEOUT_QUERY
    );
    const data = await r.json();
    const a = data.address || {};
    const partes = [
      a.neighbourhood || a.suburb || a.quarter || a.hamlet || '',
      a.city || a.town || a.village || a.county || '',
      a.state || ''
    ].filter(Boolean);
    return partes.join(', ');
  } catch (_) { return ''; }
}

function reverseGeocodeDebounced(lat, lng) {
  if (_nominatimTimer) {
    clearTimeout(_nominatimTimer);
    _nominatimTimer = null;
  }
  if (_nominatimPendingResolve) {
    _nominatimPendingResolve('');
    _nominatimPendingResolve = null;
  }

  return new Promise(resolve => {
    _nominatimPendingResolve = resolve;
    _nominatimTimer = setTimeout(async () => {
      _nominatimTimer = null;
      _nominatimPendingResolve = null;
      const result = await reverseGeocode(lat, lng);
      resolve(result);
    }, 1500);
  });
}

// ═══════════════════════════════════════════════════
// GPS
// ═══════════════════════════════════════════════════
export function captureGPS() {
  if(!navigator.geolocation) { showToast('GPS no disponible'); return; }
  const btn = document.getElementById('gps-btn');
  if(btn.classList.contains('loading')) return;
  const acc = document.getElementById('gps-acc');
  btn.className='gps-btn loading'; btn.textContent='\u23F3 Buscando se\u00F1al GPS...';

  navigator.geolocation.getCurrentPosition(pos => {
    const lat  = pos.coords.latitude.toFixed(7);
    const lng  = pos.coords.longitude.toFixed(7);
    const prec = pos.coords.accuracy.toFixed(1);
    document.getElementById('f-lat').value = lat;
    document.getElementById('f-lng').value = lng;
    btn.className='gps-btn ok'; btn.textContent=`\u2713 GPS \u00B1${prec}m CAPTURADO`;
    acc.textContent=`Precisi\u00F3n: \u00B1${prec} m \u2014 ${new Date().toLocaleTimeString()}`;
    acc.style.color = prec<=10 ? 'var(--green)' : prec<=20 ? 'var(--accent)' : 'var(--red)';
    if (prec > 20) {
      showToast(`\u26A0\uFE0F Precisi\u00F3n baja (\u00B1${prec}m). Ac\u00E9rcate al poste o espera.`);
    } else {
      showToast(`\uD83D\uDCCD \u00B1${prec}m \u2014 consultando ubicaci\u00F3n...`);
    }
    setTimeout(()=>{ btn.className='gps-btn'; btn.textContent='\uD83C\uDFAF CAPTURAR POSICI\u00D3N GPS'; },5000);

    state.geoAddress = '';
    reverseGeocodeDebounced(lat, lng).then(addr => {
      if (addr) {
        state.geoAddress = addr;
        acc.textContent = `\u00B1${prec}m \u00B7 ${state.geoAddress}`;
        showToast(`\uD83D\uDCCD ${state.geoAddress}`);
      }
    });
  }, err => {
    btn.className='gps-btn'; btn.textContent='\uD83C\uDFAF CAPTURAR POSICI\u00D3N GPS';
    acc.style.color='var(--red)';
    if (err.code === 1) {
      acc.textContent = 'Permiso de ubicaci\u00F3n denegado. Act\u00EDvalo en Ajustes.';
      showToast('\u26A0\uFE0F Permiso de ubicaci\u00F3n denegado');
    } else if (err.code === 2) {
      acc.textContent = 'GPS apagado o sin se\u00F1al. Activa el GPS en tu dispositivo.';
      showToast('\u26A0\uFE0F GPS apagado. Act\u00EDvalo en tu dispositivo.');
    } else {
      acc.textContent = 'No se obtuvo GPS. Ingresa la coordenada manualmente.';
      showToast('Error GPS \u2014 intenta al aire libre o ingresa manual');
    }
  }, { enableHighAccuracy:true, timeout:CONFIG.GPS_TIMEOUT, maximumAge:0 });
}

export function autoCaptureGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    if (!document.getElementById('f-lat').value) {
      document.getElementById('f-lat').value = pos.coords.latitude.toFixed(7);
      document.getElementById('f-lng').value = pos.coords.longitude.toFixed(7);
      const prec = pos.coords.accuracy.toFixed(1);
      const acc = document.getElementById('gps-acc');
      acc.textContent = `Precisi\u00F3n: \u00B1${prec} m (auto)`;
      acc.style.color = prec <= 20 ? 'var(--green)' : 'var(--accent)';
      const lat = pos.coords.latitude.toFixed(7);
      const lng = pos.coords.longitude.toFixed(7);
      state.geoAddress = '';
      reverseGeocodeDebounced(lat, lng).then(addr => {
        if (addr) {
          state.geoAddress = addr;
          acc.textContent = `\u00B1${prec}m \u00B7 ${state.geoAddress} (auto)`;
        }
      });
    }
  }, () => {}, { enableHighAccuracy: true, timeout: CONFIG.GPS_AUTO_TIMEOUT, maximumAge: CONFIG.GPS_AUTO_MAX_AGE });
}

// ═══════════════════════════════════════════════════
// MAP — single initialization, never destroyed
// ═══════════════════════════════════════════════════
const _ensureMap = function() {
  if (!state.mapReady) {
    var lat0 = parseFloat(document.getElementById('f-lat').value) || 4.6;
    var lng0 = parseFloat(document.getElementById('f-lng').value) || -74.1;
    state.mapInst = L.map('mmap', { zoomControl: true, attributionControl: false }).setView([lat0, lng0], 18);

    // ── 3-tier base layers ──────────────────────────
    var googleResilient = new ResilientTileLayer(
      [GOOGLE_HYBRID, ESRI_SAT, OSM_TILES],
      { maxZoom: 19, attribution: GOOGLE_ATTRIB, errorTileUrl: '' }
    );
    var esriResilient = new ResilientTileLayer(
      [ESRI_SAT, OSM_TILES],
      { maxZoom: 19, attribution: ESRI_ATTRIB, errorTileUrl: '' }
    );
    var osmFallback = L.tileLayer(OSM_TILES, {
      maxZoom: 19, attribution: OSM_ATTRIB,
      subdomains: 'abc', errorTileUrl: ''
    });

    // ── Labels overlay ──────────────────────────────
    var labelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
      attribution: '\u00A9 OpenStreetMap contributors, \u00A9 CartoDB',
      subdomains: 'abcd', maxZoom: 19
    });

    googleResilient.addTo(state.mapInst);
    labelsLayer.addTo(state.mapInst);

    state.layerControl = L.control.layers(
      {
        '\uD83D\uDEF0 Google H\u00EDbrido': googleResilient,
        '\uD83D\uDEF0 ESRI Sat\u00E9lite': esriResilient,
        '\uD83D\uDDFA OpenStreetMap': osmFallback
      },
      { '\uD83C\uDFF7 Etiquetas': labelsLayer },
      { position: 'topright' }
    ).addTo(state.mapInst);

    // ── Offline download control ────────────────────
    new DownloadMapControl().addTo(state.mapInst);

    state.mapInst.on('move', function() {
      var c = state.mapInst.getCenter();
      document.getElementById('coord-live').textContent = c.lat.toFixed(6) + ', ' + c.lng.toFixed(6);
    });

    if (!document.getElementById('f-lat').value && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function(p) {
        state.mapInst.setView([p.coords.latitude, p.coords.longitude], 19);
      });
    }
    state.mapReady = true;
    setTimeout(function() { state.mapInst.invalidateSize(); }, CONFIG.MAP_INVALIDATE_DELAY);
  }
};

export function openMap() {
  document.getElementById('map-modal').classList.add('open');
  _ensureMap();
  startUserLocationMarker();
  loadAreaInteres();
  if (state.mapInst._existingRecordLayer) state.mapInst.removeLayer(state.mapInst._existingRecordLayer);
  if (state.records.length > 0) {
    var existingMarkers = state.records.filter(function(r) { return r.lat && r.lng; }).map(function(r) {
      return L.circleMarker([parseFloat(r.lat), parseFloat(r.lng)], {
        radius: 6,
        fillColor: '#0B5FA5',
        color: '#FFFFFF',
        weight: 1,
        opacity: 0.7,
        fillOpacity: 0.4
      });
    });
    if (existingMarkers.length) {
      state.mapInst._existingRecordLayer = L.layerGroup(existingMarkers).addTo(state.mapInst);
    }
  }
  state.mapInst.invalidateSize();
}

export function closeMap() {
  document.getElementById('map-modal').classList.remove('open');
  var cb = document.querySelector('.mm-foot .btn-p');
  if(cb) cb.style.display = '';
  document.querySelector('.mm-head h3').textContent = '\uD83D\uDCCD Afinar Ubicaci\u00F3n';
  document.querySelector('.mm-head p').textContent = 'Mueve el mapa \u2022 el cursor se\u00F1ala el poste exacto';
  stopUserLocationMarker();
  clearAreaInteres();
}

export function startUserLocationMarker() {
  stopUserLocationMarker();
  if (!navigator.geolocation || !state.mapInst) return;
  state.gpsWatchId = navigator.geolocation.watchPosition(
    function(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      var acc = pos.coords.accuracy;
      if (state.userMarker) { state.mapInst.removeLayer(state.userMarker); state.userMarker = null; }
      if (state.userAccCircle) { state.mapInst.removeLayer(state.userAccCircle); state.userAccCircle = null; }
      state.userAccCircle = L.circle([lat, lng], {
        radius: acc, fillColor: '#4285F4', fillOpacity: 0.12,
        color: '#4285F4', weight: 1, interactive: false
      }).addTo(state.mapInst);
      state.userMarker = L.circleMarker([lat, lng], {
        radius: 8, fillColor: '#4285F4', fillOpacity: 1,
        color: '#FFFFFF', weight: 2.5, interactive: false
      }).addTo(state.mapInst);
    },
    function() {},
    { enableHighAccuracy: true, timeout: CONFIG.GPS_WATCH_TIMEOUT, maximumAge: CONFIG.GPS_WATCH_MAX_AGE }
  );
}

export function stopUserLocationMarker() {
  if (state.gpsWatchId) { navigator.geolocation.clearWatch(state.gpsWatchId); state.gpsWatchId = null; }
  if (state.userMarker && state.mapInst) { state.mapInst.removeLayer(state.userMarker); state.userMarker = null; }
  if (state.userAccCircle && state.mapInst) { state.mapInst.removeLayer(state.userAccCircle); state.userAccCircle = null; }
}

export function clearAreaInteres() {
  if (state.kmzLayerGroup && state.mapInst) {
    if (state.layerControl) state.layerControl.removeLayer(state.kmzLayerGroup);
    state.mapInst.removeLayer(state.kmzLayerGroup);
    state.kmzLayerGroup = null;
  }
}

export async function loadAreaInteres() {
  clearAreaInteres();
  if (!state.projectKey || !state.mapInst) return;
  try {
    var url = kmzPublicUrl();
    var resp = await withTimeout(fetch(url), CONFIG.NETWORK_TIMEOUT_QUERY);
    if (!resp.ok) return;
    var buffer = await withTimeout(resp.arrayBuffer(), CONFIG.NETWORK_TIMEOUT_QUERY);
    var zip = await JSZip.loadAsync(buffer);
    var kmlText = null;
    for (var name in zip.files) {
      var file = zip.files[name];
      if (file.dir) continue;
      if (name.toLowerCase().endsWith('.kml')) {
        kmlText = await file.async('string');
        break;
      }
    }
    if (!kmlText) return;
    var parser = new DOMParser();
    var kmlDoc = parser.parseFromString(kmlText, 'text/xml');
    var geojson = typeof toGeoJSON !== 'undefined' ? toGeoJSON.kml(kmlDoc) : null;
    if (!geojson || !geojson.features || !geojson.features.length) return;
    state.kmzLayerGroup = L.geoJSON(geojson, {
      style: function(feature) {
        var p = feature.properties || {};
        return {
          color: p.stroke || '#0B5FA5',
          weight: Number(p['stroke-width']) || 2.5,
          opacity: Number(p['stroke-opacity']) || 0.85,
          fillColor: p.fill || '#0B5FA5',
          fillOpacity: Number(p['fill-opacity']) || 0.18
        };
      },
      pointToLayer: function(feature, latlng) {
        var p = feature.properties || {};
        if (p.icon) {
          return L.marker(latlng, {
            icon: L.icon({ iconUrl: p.icon, iconSize: [28, 28], iconAnchor: [14, 14] })
          });
        }
        return L.circleMarker(latlng, {
          radius: 7, fillColor: p.fill || '#0B5FA5', fillOpacity: 0.85,
          color: p.stroke || '#FFFFFF', weight: 2.5
        });
      },
      onEachFeature: function(feature, layer) {
        var p = feature.properties || {};
        var raw = (p.name || '').trim();
        var desc = (p.description || '').trim();
        var skip = /^(untitled|sin identificar|sin nombre|unnamed|path|polygon|point|ruta|poligono|punto|linea)$/i;
        if (raw && raw.length > 1 && !skip.test(raw)) {
          layer.bindTooltip(raw, { permanent: false, direction: 'top' });
          if (desc && desc !== raw) {
            layer.bindPopup('<div style="max-width:220px;font-size:13px"><b>' + raw + '</b><br><span style="font-size:12px">' + desc + '</span></div>');
          }
        }
      }
    }).addTo(state.mapInst);
    if (state.layerControl) state.layerControl.addOverlay(state.kmzLayerGroup, '\uD83D\uDCCD \u00C1rea de Inter\u00E9s');
  } catch (_) { /* KMZ no disponible */ }
}

// ═══════════════════════════════════════════════════
// PROJECT MAP — reuses existing map, never destroys it
// ═══════════════════════════════════════════════════
export function openProjectMap() {
  var withCoords = state.records.filter(function(r) { return r.lat && r.lng; });
  if (!withCoords.length) { showToast('Ning\u00FAn poste tiene coordenadas a\u00FAn'); return; }

  document.getElementById('map-modal').classList.add('open');
  stopUserLocationMarker();
  _ensureMap();

  var applyMarkers = function() {
    if (!state.mapInst) return;

    if (state.mapInst._existingRecordLayer) {
      state.mapInst.removeLayer(state.mapInst._existingRecordLayer);
    }

    var markers = [];
    var bounds = [];
    withCoords.forEach(function(r) {
      var color = r.estado === 'Bueno' ? '#2E7D32' : r.estado === 'Malo' ? '#B71C1C' : '#0B5FA5';
      var marker = L.circleMarker([parseFloat(r.lat), parseFloat(r.lng)], {
        radius: 9, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9
      }).addTo(state.mapInst);
      marker.bindPopup('<b>' + escHtml(r.uid) + '</b><br>Poste: ' + escHtml(r.n_poste||'\u2014') + '<br>' + escHtml(r.estado||'\u2014') + ' \u00B7 ' + escHtml(r.material||'\u2014') + '<br><small>' + r.lat + ', ' + r.lng + '</small>');
      markers.push(marker);
      bounds.push([parseFloat(r.lat), parseFloat(r.lng)]);
    });

    state.mapInst._existingRecordLayer = L.layerGroup(markers);
    if (bounds.length) state.mapInst.fitBounds(bounds, { padding: [40, 40] });
    state.mapInst.invalidateSize();

    document.querySelector('.mm-head h3').textContent = '\uD83D\uDDFA Mapa del Proyecto';
    document.querySelector('.mm-head p').textContent = withCoords.length + ' poste(s) con coordenada';
    var confirmBtn = document.querySelector('.mm-foot .btn-p');
    if (confirmBtn) confirmBtn.style.display = 'none';
  };

  if (state.mapReady) {
    applyMarkers();
  } else {
    setTimeout(applyMarkers, 300);
  }
}

// ═══════════════════════════════════════════════════
// MAP COORDINATE CONFIRMATION
// ═══════════════════════════════════════════════════
export function confirmMapCoord() {
  if(!state.mapInst) return;
  var c   = state.mapInst.getCenter();
  var lat = c.lat.toFixed(7);
  var lng = c.lng.toFixed(7);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function(pos) {
      var d = calcularDistancia(
        parseFloat(lat), parseFloat(lng),
        pos.coords.latitude, pos.coords.longitude
      );
      if (d > 30) {
        if (!confirm('\u26A0\uFE0F La coordenada seleccionada est\u00E1 a ' + Math.round(d) + ' m de tu posici\u00F3n GPS actual.\n\n\u00BFEst\u00E1s seguro de que el poste est\u00E1 en esa ubicaci\u00F3n?')) return;
      }
      applyMapCoord(lat, lng);
    }, function() {
      applyMapCoord(lat, lng);
    }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 });
    return;
  }

  applyMapCoord(lat, lng);
}

function applyMapCoord(lat, lng) {
  document.getElementById('f-lat').value = lat;
  document.getElementById('f-lng').value = lng;
  document.getElementById('gps-acc').textContent = 'Coordenada del mapa \u2014 consultando ubicaci\u00F3n...';
  document.getElementById('gps-acc').style.color = 'var(--green)';
  closeMap();
  showToast('\u2713 Coordenada del mapa aplicada');

  state.geoAddress = '';
  reverseGeocodeDebounced(lat, lng).then(function(addr) {
    if (addr) {
      state.geoAddress = addr;
      document.getElementById('gps-acc').textContent = 'Mapa \u00B7 ' + state.geoAddress;
      showToast('\uD83D\uDCCD ' + state.geoAddress);
    } else {
      document.getElementById('gps-acc').textContent = 'Coordenada del mapa: ' + parseFloat(lat).toFixed(5) + ', ' + parseFloat(lng).toFixed(5);
    }
  });
}

// ═══════════════════════════════════════════════════
// KMZ ADMIN
// ═══════════════════════════════════════════════════
export async function updateKMZSection() {
  var section = document.getElementById('admin-kmz-section');
  if (!section) return;
  if (!state.isAdmin) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  var st = document.getElementById('kmz-status');
  var del = document.getElementById('kmz-delete-btn');
  try {
    var exists = await sbCheckKMZ();
    if (exists) {
      st.textContent = '\u2713 Cargado'; st.style.color = 'var(--green)';
      del.style.display = '';
    } else {
      st.textContent = '\u25CB No cargado'; st.style.color = 'var(--muted)';
      del.style.display = 'none';
    }
  } catch (_) {
    st.textContent = '\u26A0 Sin conexi\u00F3n'; st.style.color = 'var(--accent)';
    del.style.display = 'none';
  }
}

export async function adminKMZChanged() {
  var file = document.getElementById('admin-kmz-input').files[0];
  if (!file) return;
  var mb = (file.size / 1048576).toFixed(1);
  if (mb > CONFIG.KMZ_MAX_MB) { showToast('\u26A0\uFE0F Archivo muy grande (' + mb + ' MB). M\u00E1x. 5 MB.'); return; }
  try {
    await sbUploadKMZ(file);
    showToast('\u2713 KMZ ' + file.name + ' subido');
    updateKMZSection();
    if (state.mapInst && state.mapReady) loadAreaInteres();
  } catch(e) { showToast('Error al subir KMZ: ' + e.message); }
}

export async function adminDeleteKMZ() {
  if (!confirm('\u00BFEliminar el KMZ de \u00E1rea de inter\u00E9s?')) return;
  try {
    await sbDeleteKMZ();
    clearAreaInteres();
    showToast('\u2713 KMZ eliminado');
    updateKMZSection();
  } catch(e) { showToast('Error al eliminar: ' + e.message); }
}
