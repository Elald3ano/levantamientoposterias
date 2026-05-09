import './style.css';
import { state, CONFIG, SESSION_TIMEOUT, DYNAMIC_FIELDS, DYN_IDS, CSV_COLS, CSV_BASE, CSV_DYN, CSV_END } from './store/state.js';
import { SB, BUCKET_FOTOS, SUPABASE_URL, SUPABASE_KEY, withTimeout, sbUploadPhoto, sbSaveRecord, sbDeleteProject, sbUploadKMZ, loadAdminCode, sbGetMaxSeq } from './api/supabase.js';
import { captureGPS, autoCaptureGPS, openMap, closeMap, confirmMapCoord, openProjectMap, updateKMZSection, adminKMZChanged, adminDeleteKMZ, stopUserLocationMarker, clearAreaInteres } from './services/map.js';
import { trigCam, handleFoto, rmFoto, clearSlotHighlight } from './services/camera.js';
import { saveRecordToOfflineQueue, getOfflineRecords, deleteOfflineRecord, getPendingPhotos, getPhotosByRecordUid, deletePhotosByRecordUid, markPhotoUploaded, getOfflineCount as dbGetOfflineCount } from './services/db.js';

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then(function(granted) {
    if (granted) console.log('Persistent storage granted');
  });
}

// ═══════════════════════════════════════════════════
// POLYFILLS & ERROR HANDLERS (execute immediately)
// ═══════════════════════════════════════════════════
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    this.beginPath();
    this.moveTo(x + r.tl, y);
    this.lineTo(x + w - r.tr, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    this.lineTo(x + w, y + h - r.br);
    this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    this.lineTo(x + r.bl, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    this.lineTo(x, y + r.tl);
    this.quadraticCurveTo(x, y, x + r.tl, y);
    this.closePath();
  };
}

window.onerror = function(msg, src, line, col, err) {
  const el = document.getElementById('js-error-banner');
  if(el) { el.style.display='block'; el.textContent = `JS Error: ${msg} (line ${line})`; }
  console.error('JS ERROR:', msg, src, line);
  return false;
};
window.addEventListener('unhandledrejection', e => {
  const el = document.getElementById('js-error-banner');
  if(el) { el.style.display='block'; el.textContent = `Promise Error: ${e.reason}`; }
  console.error('UNHANDLED REJECTION:', e.reason);
});

// ═══════════════════════════════════════════════════
// UI UTILITIES — exported for cross-module use
// ═══════════════════════════════════════════════════
export function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  t.classList.remove('error', 'warning');
  const inferred = type || (/error|inválido|⚠️|falta/i.test(msg) ? 'error' : /⏳|🌐|📡|📝/i.test(msg) ? 'warning' : 'success');
  if (inferred === 'error') t.classList.add('error');
  else if (inferred === 'warning') t.classList.add('warning');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), CONFIG.TOAST_DURATION);
}

export function showLoading(msg) {
  const ov = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (ov) ov.classList.add('open');
  if (txt) txt.textContent = msg || 'Sincronizando...';
}

function hideLoading() {
  const ov = document.getElementById('loading-overlay');
  if (ov) ov.classList.remove('open');
}

export function escHtml(str) {
  const el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || String(e).toLowerCase().includes('quota')) {
      console.warn('QuotaExceededError: intentando liberar espacio...');
      try {
        const keys = Object.keys(localStorage).filter(k =>
          k.startsWith('pf_projects_cache') || k.startsWith('pf_draft_')
        );
        keys.forEach(k => { if (k !== key) localStorage.removeItem(k); });
        localStorage.setItem(key, value);
        return true;
      } catch (e2) {
        console.error('No se pudo liberar espacio en localStorage');
        return false;
      }
    }
    throw e;
  }
}

export function updateConnDot() {
  const dot = document.getElementById('conn-dot');
  if (dot) dot.textContent = navigator.onLine ? '🟢' : '🔴';
}

// ═══════════════════════════════════════════════════
// UID & FILENAMES
// ═══════════════════════════════════════════════════
export function genUID() {
  const d = new Date();
  const s = d.getFullYear().toString() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  return 'POST-' + s + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
}

export function refreshFilenames() {
  const folder = state.projectKey || 'proyecto';
  for(let i=0;i<3;i++) {
    const el = document.getElementById(`fn-${i}`);
    if(el) el.textContent = `${state.uid}_F0${i+1}.jpg`;
  }
  const pp = document.getElementById('foto-path-preview');
  if(pp) pp.textContent = `${folder}/fotos/${state.uid}_F01.jpg`;
}

// ═══════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════
export function goTo(step) {
  document.querySelectorAll('.panel').forEach((p,i) => p.classList.toggle('active', i===step));
  document.querySelectorAll('.tab').forEach((b,i) => {
    b.classList.remove('active','done');
    if(i < step && i !== 4) b.classList.add('done');
    if(i === step) b.classList.add('active');
    b.setAttribute('aria-selected', i === step ? 'true' : 'false');
  });
  window.scrollTo(0,0);
  if(step===3) updateExportPanel();
}

// ═══════════════════════════════════════════════════
// FORM UTILS
// ═══════════════════════════════════════════════════
export function readFormData() {
  return {
    n_poste: document.getElementById('f-num').value,
    direccion: document.getElementById('f-dir').value,
    material: document.getElementById('f-mat').value,
    altura: document.getElementById('f-alt').value,
    carga: document.getElementById('f-car').value,
    tension: document.getElementById('f-ten').value,
    estado: document.getElementById('f-est').value,
    lat: document.getElementById('f-lat').value,
    lng: document.getElementById('f-lng').value,
    observaciones: document.getElementById('f-obs').value,
  };
}

export function updateAriaRequired() {
  const fields = ['f-num','f-dir','f-mat','f-alt','f-car','f-ten','f-est','f-lat','f-lng'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-required', state.projectMode === 'estricto' ? 'true' : 'false');
  });
}

// ═══════════════════════════════════════════════════
// OFFLINE QUEUE
// ═══════════════════════════════════════════════════
export function saveToOfflineQueue(record) {
  record.projectKey = state.projectKey;
  saveRecordToOfflineQueue(record).catch(err => {
    console.error('Error guardando en cola offline:', err);
    showToast('⚠️ Almacenamiento local lleno — libera espacio o sincroniza', 'error');
  });
}

export async function actualizarBotonSync() {
  const btn = document.getElementById('sync-btn');
  const box = document.getElementById('offline-queue-box');
  const countEl = document.getElementById('offline-count');
  if (!btn || !box) return;

  let count = 0;
  let corrupted = false;
  try {
    count = await dbGetOfflineCount(state.projectKey);
  } catch (e) {
    corrupted = true;
    count = 0;
  }

  if (corrupted) {
    box.style.display = 'block';
    btn.textContent = '⚠️ Cola dañada';
    btn.disabled = false;
    btn.style.cursor = 'pointer';
    btn.onclick = () => showToast('La cola de sincronización está dañada. Intenta exportar los datos manualmente desde la sección Exportar.', 'error');
    if (countEl) countEl.textContent = '—';
    return;
  }

  btn.onclick = syncOfflineQueue;

  if (count > 0) {
    box.style.display = 'block';
    btn.textContent = `↻ Sincronizar (${count})`;
    btn.disabled = false;
    btn.style.cursor = 'pointer';
    if (countEl) countEl.textContent = count;
  } else {
    box.style.display = 'none';
    if (countEl) countEl.textContent = '0';
  }
}

export async function syncOfflineQueue() {
  if (!state.projectKey) return;
  const btn = document.getElementById('sync-btn');

  try {
    const pendingPhotos = await getPendingPhotos();
    for (const p of pendingPhotos) {
      try {
        await withTimeout(sbUploadPhoto(p.blob, p.name), CONFIG.NETWORK_TIMEOUT_UPLOAD);
        await markPhotoUploaded(p.name);
      } catch(e) { /* retry next time */ }
    }
  } catch(e) { /* IndexedDB might not be available */ }

  let queue;
  try {
    queue = await getOfflineRecords(state.projectKey);
  } catch (e) {
    showToast('⚠️ Error al acceder a la cola offline.', 'error');
    return;
  }
  if (!queue || !queue.length) { updateExportPanel(); return; }

  if (btn) { btn.disabled = true; btn.style.cursor = 'wait'; }
  showLoading(`Sincronizando 0 de ${queue.length} registros...`);

  const total = queue.length;
  let synced = 0;
  let failed = 0;

  for (const record of queue) {
    try {
      const photos = await getPhotosByRecordUid(record.uid);
      for (const p of photos) {
        await withTimeout(sbUploadPhoto(p.blob, p.name), CONFIG.NETWORK_TIMEOUT_UPLOAD);
      }
      await withTimeout(sbSaveRecord(record), CONFIG.NETWORK_TIMEOUT_SAVE);
      await deletePhotosByRecordUid(record.uid);
      await deleteOfflineRecord(record.uid);
      synced++;
    } catch(e) {
      failed++;
    }
    const txt = document.getElementById('loading-text');
    if (txt) txt.textContent = `Sincronizando... (${synced} de ${total})`;
  }

  hideLoading();
  if (btn) { btn.disabled = false; btn.style.cursor = 'pointer'; }

  if (failed > 0) {
    if (synced > 0) {
      showToast(`☁️ Sincronización parcial: ${synced} enviados, ${failed} pendientes`);
    } else {
      showToast(`⚠️ Sincronización falló. Quedan ${failed} pendientes.`, 'error');
    }
  } else {
    showToast(`☁️ Sincronización completada: ${synced} enviados ✓`);
  }
  updateExportPanel();
  actualizarBotonSync();
}

export async function getOfflineCount() {
  if (!state.projectKey) return 0;
  try {
    return await dbGetOfflineCount(state.projectKey);
  } catch (e) {
    throw new Error('Cola corrupta');
  }
}

// ═══════════════════════════════════════════════════
// DRAFT
// ═══════════════════════════════════════════════════
export function startDraftAutoSave() {
  stopDraftAutoSave();
  state.draftInterval = setInterval(saveDraft, CONFIG.DRAFT_AUTO_SAVE_INTERVAL);
}

export function stopDraftAutoSave() {
  if (state.draftInterval) { clearInterval(state.draftInterval); state.draftInterval = null; }
}

export function saveDraft() {
  if (!state.projectKey) return;
  const fd = readFormData();
  const draft = {
    ...fd,
    geoAddress: state.geoAddress,
    seqNum: state.seqNum,
    uid: state.uid,
    photos: state.photos.map(p => p ? { name: p.name, url: p.url || '' } : null),
    equipamiento: {},
    savedAt: new Date().toISOString()
  };
  DYNAMIC_FIELDS.forEach(df => {
    const chip = document.getElementById(`chip-${df.id}`);
    const field = document.getElementById(`dyn-${df.id}`);
    const valEl = document.getElementById(`dyn-val-${df.id}`);
    draft.equipamiento[df.id] = {
      open: field && field.classList.contains('open'),
      value: valEl ? valEl.value || '0' : '0'
    };
  });
  if (!safeSetItem(`pf_draft_${state.projectKey}`, JSON.stringify(draft))) {
    console.warn('No se pudo guardar borrador — localStorage lleno');
  }
}

function loadDraft() {
  if (!state.projectKey) return;
  const raw = localStorage.getItem(`pf_draft_${state.projectKey}`);
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    const draftDate = new Date(d.savedAt).toDateString();
    if (draftDate !== new Date().toDateString()) { clearDraft(); return; }
    return d;
  } catch(e) { return null; }
}

function restoreDraft(d) {
  if (!d) return;
  document.getElementById('f-num').value = d.n_poste || '';
  document.getElementById('f-dir').value = d.direccion || '';
  document.getElementById('f-mat').value = d.material || '';
  document.getElementById('f-alt').value = d.altura || '';
  document.getElementById('f-car').value = d.carga || '';
  document.getElementById('f-ten').value = d.tension || '';
  document.getElementById('f-est').value = d.estado || '';
  document.getElementById('f-lat').value = d.lat || '';
  document.getElementById('f-lng').value = d.lng || '';
  document.getElementById('f-obs').value = d.observaciones || '';
  if (d.lat && d.lng) document.getElementById('gps-acc').textContent = 'Coordenada restaurada del borrador';
  state.geoAddress = d.geoAddress || '';
  state.uid = d.uid || genUID();
  state.seqNum = d.seqNum || state.seqNum;
  if (d.photos) {
    d.photos.forEach((p, i) => {
      if (p && p.name) {
        state.photos[i] = { name: p.name, url: p.url || '' };
        document.getElementById(`fn-${i}`).textContent = p.name;
        const slot = document.getElementById(`slot-${i}`);
        if (slot) slot.style.borderColor = 'var(--accent)';
      }
    });
  }
  if (d.equipamiento) {
    Object.entries(d.equipamiento).forEach(([id, stateObj]) => {
      if (stateObj && stateObj.open) {
        const chip = document.getElementById(`chip-${id}`);
        const field = document.getElementById(`dyn-${id}`);
        if (chip) chip.classList.add('active');
        if (field) field.classList.add('open');
        const valEl = document.getElementById(`dyn-val-${id}`);
        if (valEl) valEl.value = stateObj.value;
      }
    });
  }
  showToast('📝 Borrador restaurado');
}

function clearDraft() {
  if (state.projectKey) localStorage.removeItem(`pf_draft_${state.projectKey}`);
  state.photos = [null, null, null];
  for (let i = 0; i < 3; i++) document.getElementById(`slot-${i}`).style.borderColor = '';
}

// ═══════════════════════════════════════════════════
// SAVE RECORD
// ═══════════════════════════════════════════════════
export async function saveAndExport() {
  if (saveAndExport._saving) return;
  saveAndExport._saving = true;

  const btn = document.getElementById('save-btn');

  try {

  const now = new Date();
  const lat = document.getElementById('f-lat').value;
  const lng = document.getElementById('f-lng').value;
  const nPoste = document.getElementById('f-num').value.trim();

  const missing = [];
  if (!nPoste) missing.push('N° Poste');
  if (state.projectMode === 'estricto') {
    if (!lat || !lng) missing.push('Coordenada GPS');
    const dir = document.getElementById('f-dir').value.trim();
    if (!dir) missing.push('Dirección');
    const mat = document.getElementById('f-mat').value;
    if (!mat) missing.push('Material');
    const alt = document.getElementById('f-alt').value;
    if (!alt) missing.push('Altura');
    const car = document.getElementById('f-car').value;
    if (!car) missing.push('Carga');
    const ten = document.getElementById('f-ten').value;
    if (!ten) missing.push('Tensión');
    const est = document.getElementById('f-est').value;
    if (!est) missing.push('Estado del poste');
    const photosTaken = state.photos.filter(Boolean).length;
    if (photosTaken < 3) missing.push(`Fotos (${photosTaken}/3)`);
  }
  if (state.projectMode !== 'estricto') {
    const photosTaken = state.photos.filter(Boolean).length;
    if (photosTaken === 0) {
      showToast('Debes tomar al menos una foto en modo libre.', 'warning');
      return;
    }
  }
  if (missing.length) {
    showToast(`⚠️ Faltan: ${missing.join(', ')}`);
    return;
  }

  const GENERIC_POSTES = ['n/a', 's/n', 'sin nombre', 'sin placa', ''];
  if (!GENERIC_POSTES.includes(nPoste.toLowerCase())
      && state.records.some(r => r.n_poste && r.n_poste.toLowerCase() === nPoste.toLowerCase())) {
    showToast('⚠️ El poste "' + nPoste + '" ya existe en este proyecto', 'error');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ GUARDANDO...'; }
  showLoading('Guardando poste...');

  await Promise.allSettled(state.photos.filter(Boolean).map(p => {
    if (p._uploadPromise) return p._uploadPromise;
    return Promise.resolve();
  }));

  const equipamiento = {};
  DYNAMIC_FIELDS.forEach(df => {
    const el = document.getElementById(`dyn-val-${df.id}`);
    equipamiento[df.id] = (el && el.closest('.dyn-field.open')) ? (el.value || '0') : '0';
  });

  const record = {
    uid: state.uid, seq: state.seqNum,
    fecha: now.toLocaleDateString('es-CO'),
    hora:  now.toLocaleTimeString('es-CO'),
    n_poste: nPoste,
    direccion: document.getElementById('f-dir').value,
    material:  document.getElementById('f-mat').value,
    altura:    document.getElementById('f-alt').value,
    carga:     document.getElementById('f-car').value,
    tension:   document.getElementById('f-ten').value,
    estado:    document.getElementById('f-est').value,
    lat, lng,
    ubicacion: state.geoAddress || '',
    equipamiento,
    foto1: state.photos[0]?.name||'',
    foto2: state.photos[1]?.name||'',
    foto3: state.photos[2]?.name||'',
    observaciones: document.getElementById('f-obs').value,
    _photos: state.photos.filter(Boolean)
  };

  try {
    await withTimeout(sbSaveRecord(record), CONFIG.NETWORK_TIMEOUT_SAVE);
    state.records.push(record);
    clearDraft();
    showToast(`✓ ${state.uid} guardado · ${state.records.length} postes`);
    newRecord();
  } catch(e) {
    console.error('Error guardando en Supabase:', e);
    var msg = String(e.message || e);
    if (msg.toUpperCase().indexOf('DUPLICADO') !== -1) {
      showToast('⚠️ Poste duplicado en el servidor — verifica el número', 'error');
      // No guardar localmente ni avanzar al siguiente poste
    } else {
      saveToOfflineQueue(record);
      state.records.push(record);
      showToast('⚠️ Sin conexión — guardado local. Se sincronizará al reconectar.');
      newRecord();
    }
  }
  } finally {
    hideLoading();
    if (btn) { btn.disabled = false; btn.textContent = '✓ GUARDAR Y SIGUIENTE POSTE'; }
    saveAndExport._saving = false;
  }
}

export function newRecord() {
  ['f-num','f-dir','f-obs'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('f-lat').value='';
  document.getElementById('f-lng').value='';
  document.getElementById('gps-acc').textContent='Párate al pie del poste y presiona el botón';
  document.getElementById('gps-acc').style.color='';
  state.geoAddress = '';
  document.querySelectorAll('.chip').forEach(ch=>ch.classList.remove('active'));
  document.querySelectorAll('.dyn-field').forEach(df=>df.classList.remove('open'));
  document.querySelectorAll('.dyn-field input').forEach(inp=>inp.value='');
  state.photos.forEach(p => {
    if (p?.objectUrl) URL.revokeObjectURL(p.objectUrl);
  });
  state.photos=[null,null,null];
  for(let i=0;i<3;i++){
    const s=document.getElementById(`slot-${i}`);
    const im=s.querySelector('img'); if(im) im.remove();
    s.classList.remove('done');
    document.getElementById(`fn-${i}`).textContent='—';
    const inp = document.getElementById(`cam-${i}`);
    inp.value = '';
    inp._processing = false;
  }
  const btn=document.getElementById('gps-btn');
  btn.className='gps-btn'; btn.textContent='🎯 CAPTURAR POSICIÓN GPS';
  stopUserLocationMarker();
  clearAreaInteres();
  if(state.mapInst) { state.mapInst.remove(); state.mapInst = null; state.layerControl = null; }
  state.mapReady=false;
  clearSlotHighlight();
  state.seqNum = state.records.length > 0 ? Math.max(...state.records.map(r => r.seq)) + 1 : 1;
  state.uid=genUID(); refreshFilenames();
  autoCaptureGPS();
  goTo(0);
}

// ═══════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════
export function buildCSV() {
  const esc = v => `"${String(v || '').replace(/"/g,'""')}"`;
  const lines = [CSV_COLS.join(',')];
  state.records.forEach(r => {
    const base = [
      r.seq||'', esc(r.uid), esc(r.fecha), esc(r.hora), esc(r.n_poste), esc(r.direccion||''),
      esc(r.material||''), esc(r.altura||''), esc(r.carga||''), esc(r.tension||''), esc(r.estado||'')
    ];
    const eq = r.equipamiento || {};
    const dyn = DYN_IDS.map(id => esc(eq[id] !== undefined ? eq[id] : '0'));
    const end = [
      esc(r.ubicacion||''), esc(r.lat||''), esc(r.lng||''), esc(r.foto1||''), esc(r.foto2||''), esc(r.foto3||''),
      esc(r.observaciones||'')
    ];
    lines.push([...base, ...dyn, ...end].join(','));
  });
  return lines.join('\n');
}

function buildKML() {
  const places = state.records.filter(r=>r.lat&&r.lng);
  if (!places.length) return null;
  const esc = v => String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const placemarks = places.map(r => `
    <Placemark>
      <name>${esc(r.uid)}</name>
      <description>Poste: ${esc(r.n_poste)} · ${esc(r.estado)} · ${esc(r.material)} · Alt:${esc(r.altura)}m</description>
      <Point><coordinates>${r.lng},${r.lat},0</coordinates></Point>
    </Placemark>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>${escHtml(state.projectName)}</name>${placemarks}</Document>
</kml>`;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], {type});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

export async function exportZIP() {
  if(!state.records.length){ showToast('No hay registros para exportar'); return; }

  const btn = document.getElementById('zip-btn');
  btn.disabled=true; btn.textContent='⏳ Generando ZIP...';

  try {
    const zip    = new JSZip();
    const folder = zip.folder(state.projectKey);
    const fotos  = folder.folder('fotos');

    folder.file(`${state.projectKey}_datos.csv`, '\uFEFF'+buildCSV());

    const kmlContent = buildKML();
    if (kmlContent) folder.file(`${state.projectKey}_mapa.kml`, kmlContent);

    const allPhotos = [];
    state.records.forEach(r => {
      (r._photos||[]).forEach(p => allPhotos.push(p));
    });

    btn.textContent = `⏳ Descargando ${allPhotos.length} fotos...`;
    for (const p of allPhotos) {
      if (p.blob) {
        fotos.file(p.name, p.blob);
      } else if (p.url) {
        try {
          const resp = await withTimeout(fetch(p.url), CONFIG.NETWORK_TIMEOUT_UPLOAD);
          const blob = await resp.blob();
          fotos.file(p.name, blob);
        } catch(e) {
          console.warn(`No se pudo descargar ${p.name}:`, e);
        }
      } else {
        const path = `${state.projectKey}/${p.name}`;
        const { data } = SB.storage.from(BUCKET_FOTOS).getPublicUrl(path);
        try {
          const resp = await withTimeout(fetch(data.publicUrl), CONFIG.NETWORK_TIMEOUT_UPLOAD);
          if (resp.ok) {
            const blob = await resp.blob();
            fotos.file(p.name, blob);
          }
        } catch(e) { /* skip */ }
      }
    }

    btn.textContent = '⏳ Comprimiendo...';
    const blob = await zip.generateAsync({type:'blob', compression:'DEFLATE', compressionOptions:{level:6}}, meta => {
      btn.textContent = `⏳ Comprimiendo... ${meta.percent.toFixed(0)}%`;
    });

    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const today= new Date().toISOString().slice(0,10);
    a.href=url; a.download=`${state.projectKey}_${today}.zip`; a.click();
    URL.revokeObjectURL(url);

    const sizeMB = (blob.size/1048576).toFixed(1);
    showToast(`📦 ZIP descargado · ${sizeMB} MB`);
  } catch(err) {
    showToast('Error al generar ZIP: '+err.message);
    console.error(err);
  } finally {
    btn.disabled=false; btn.textContent='📦 DESCARGAR ZIP (CSV + KML + fotos)';
  }
}

function downloadCSVOnly() {
  if(!state.records.length){ showToast('No hay registros aún'); return; }
  const blob = new Blob(['\uFEFF'+buildCSV()],{type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const today= new Date().toISOString().slice(0,10);
  a.href=url; a.download=`${state.projectKey}_datos_${today}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast(`↓ CSV descargado · ${state.records.length} registros`);
}

function downloadKML() {
  const kml = buildKML();
  if (!kml) { showToast('No hay registros con coordenadas'); return; }
  const places = state.records.filter(r=>r.lat&&r.lng).length;
  downloadBlob(kml, `${state.projectKey}_mapa.kml`, 'application/vnd.google-earth.kml+xml');
  showToast(`📍 KML descargado · ${places} puntos`);
}

function downloadGeoJSON() {
  if(!state.records.length){ showToast('No hay registros aún'); return; }
  const features = state.records.filter(r=>r.lat&&r.lng).map(r => ({
    type:'Feature',
    geometry:{ type:'Point', coordinates:[parseFloat(r.lng), parseFloat(r.lat)] },
    properties:{ uid:r.uid, n_poste:r.n_poste, estado:r.estado, material:r.material, altura:r.altura, lat:r.lat, lng:r.lng }
  }));
  const geojson = { type:'FeatureCollection', features };
  downloadBlob(JSON.stringify(geojson, null, 2), `${state.projectKey}_mapa.geojson`, 'application/geo+json');
  showToast(`🛰 GeoJSON descargado · ${features.length} puntos`);
}

export function filterTable() {
  const query = (document.getElementById('table-filter')?.value || '').toLowerCase();
  const container = document.getElementById('records-table');
  if (!container) return;
  const filtered = query
    ? state.records.filter(r =>
        (r.n_poste||'').toLowerCase().includes(query) ||
        (r.uid||'').toLowerCase().includes(query) ||
        (r.direccion||'').toLowerCase().includes(query) ||
        (r.estado||'').toLowerCase().includes(query) ||
        (r.material||'').toLowerCase().includes(query))
    : state.records;
  container.innerHTML = filtered.length
    ? `<table style="width:100%;border-collapse:collapse">
        <thead><tr style="color:var(--muted);text-align:left">
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">#</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">UID</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Poste</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Estado</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Mat.</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">GPS</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Fotos</th>
        </tr></thead>
        <tbody>${filtered.map((r,i) => `
          <tr style="${i%2?'background:rgba(0,0,0,.03)':''}">
            <td style="padding:5px 8px;color:var(--muted)">${r.seq||'—'}</td>
            <td style="padding:5px 8px;color:var(--accent)">${escHtml(r.uid||'—')}</td>
            <td style="padding:5px 8px">${escHtml(r.n_poste||'—')}</td>
            <td style="padding:5px 8px;color:${r.estado==='Bueno'?'var(--green)':r.estado==='Malo'?'var(--red)':'var(--accent)'}">${escHtml(r.estado||'—')}</td>
            <td style="padding:5px 8px">${escHtml(r.material||'—')}</td>
            <td style="padding:5px 8px;color:var(--muted)">${r.lat?'✓':''}</td>
            <td style="padding:5px 8px;color:var(--muted)">${[r.foto1,r.foto2,r.foto3].filter(Boolean).length}/3</td>
          </tr>`).join('')}</tbody></table>`
    : '<div style="padding:16px;text-align:center;color:var(--muted)">Sin registros</div>';
}

export function updateExportPanel() {
  const n    = state.records.length;
  const wc   = state.records.filter(r=>r.lat&&r.lng).length;
  const allPhotos = state.records.flatMap(r => r._photos||[]);
  const photoCount = allPhotos.length;

  const setEl = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  setEl('ep-name',   state.projectName || '—');
  setEl('ep-count',  n);
  setEl('ep-coords', `${wc} / ${n}`);
  setEl('ep-photos', `${photoCount} subidas`);

  actualizarBotonSync();

  const csvStr = buildCSV();
  const lines  = csvStr.split('\n');
  document.getElementById('csv-preview').textContent = lines.slice(0,6).join('\n') + (lines.length>6?`\n... +${lines.length-6} filas`:'');
  filterTable();
}

// ═══════════════════════════════════════════════════
// DYNAMIC FIELDS UI
// ═══════════════════════════════════════════════════
export function buildDynUI() {
  const container = document.getElementById('dyn-groups');
  if(!container) return;
  const groups = {};
  DYNAMIC_FIELDS.forEach(df => {
    if(!groups[df.group]) groups[df.group] = [];
    groups[df.group].push(df);
  });
  container.innerHTML = Object.entries(groups).map(([grp, fields]) => `
    <div>
      <div class="dyn-group-label">${grp}</div>
      <div class="chip-row">
        ${fields.map(df => `<div class="chip" id="chip-${df.id}">${df.label}</div>`).join('')}
      </div>
      ${fields.map(df => `
        <div class="dyn-field" id="dyn-${df.id}">
          <div class="dyn-field-header">
            <span>${df.label}</span>
            <button class="dyn-close-btn" data-chip-id="${df.id}" title="Cerrar">✕</button>
          </div>
          <div class="dyn-qty">
            <div class="f">
              ${df.options
                ? `<label>Tipo</label>
                   <select id="dyn-val-${df.id}">
                     ${df.options.map(o => `<option value="${o}">${o}</option>`).join('')}
                   </select>`
                : `<label>Cantidad</label>
                   <input type="number" id="dyn-val-${df.id}" min="0" value="1" style="max-width:100px">`
              }
            </div>
          </div>
        </div>`).join('')}
    </div>
  `).join('');
  // Bind dynamic chip events after DOM is generated
  bindDynamicChipEvents();
}

function bindDynamicChipEvents() {
  document.querySelectorAll('.chip').forEach(chip => {
    if (chip._bound) return;
    chip._bound = true;
    chip.addEventListener('click', () => toggleChip(chip.id.replace('chip-', '')));
  });
  document.querySelectorAll('.dyn-close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleChip(btn.getAttribute('data-chip-id'));
    });
  });
}

export function toggleChip(id) {
  const chip  = document.getElementById(`chip-${id}`);
  const field = document.getElementById(`dyn-${id}`);
  if (!chip || !field) return;
  const isOpen = field.classList.contains('open');
  if(isOpen) {
    field.classList.remove('open');
    chip.classList.remove('active');
    const inp = document.getElementById(`dyn-val-${id}`);
    if(inp && inp.tagName === 'INPUT') inp.value = '1';
  } else {
    field.classList.add('open');
    chip.classList.add('active');
    setTimeout(()=>{ const inp=document.getElementById(`dyn-val-${id}`); if(inp) inp.focus(); },150);
  }
}

// ═══════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════
export function openR() {
  renderR();
  document.getElementById('rpanel').classList.add('open');
  document.getElementById('overlay').classList.add('open');
}

export function closeR() {
  document.getElementById('rpanel').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

export function renderR() {
  document.getElementById('r-count').textContent=`(${state.records.length})`;
  const el=document.getElementById('rlist');
  if(!state.records.length) {
    el.innerHTML='<p style="color:var(--muted);text-align:center;margin-top:24px;font-size:13px">Sin registros aún</p>';
    return;
  }
  el.innerHTML=[...state.records].reverse().map(r=>`
    <div class="ri">
      <div class="ri-id">${escHtml(r.uid)}</div>
      <div class="ri-meta">Poste ${escHtml(r.n_poste||'—')} · ${escHtml(r.material||'—')} · <span style="color:${r.estado==='Bueno'?'var(--green)':r.estado==='Malo'?'var(--red)':'var(--accent)'}">${escHtml(r.estado||'—')}</span></div>
      <div class="ri-meta" style="font-size:12px;margin-top:2px">
        ${r.lat?`📍 ${parseFloat(r.lat).toFixed(5)}, ${parseFloat(r.lng).toFixed(5)}`:'📍 Sin coord'}
        · ${[r.foto1,r.foto2,r.foto3].filter(Boolean).length} fotos
        · ${escHtml(r.fecha)} ${escHtml(r.hora||'')}
      </div>
    </div>`).join('');
}

async function clearAll() {
  if(!confirm(`¿Borrar todos los registros del proyecto "${state.projectName}" de Supabase?`)) return;
  try {
    await sbDeleteProject(state.projectKey);
    state.records = [];
    localStorage.removeItem(`pf_mode_${state.projectKey}`);
    showToast('Proyecto borrado de Supabase');
  } catch(e) {
    showToast('Error al borrar: ' + e.message);
  }
  renderR();
  closeR();
}

// ═══════════════════════════════════════════════════
// PROJECT SETUP
// ═══════════════════════════════════════════════════
function sanitizeProjInput() {
  const raw  = document.getElementById('proj-input').value;
  const safe = raw.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ \-_]/g,'').trim();
  const slug = safe.replace(/\s+/g,'_');
  document.getElementById('proj-preview').textContent = slug ? slug + '/' : '—';
}

export function updateModeUI() {
  const libre = document.querySelector('input[name="proj-mode"][value="libre"]');
  if (!libre) return;
  state.projectMode = libre.checked ? 'libre' : 'estricto';
  document.getElementById('mode-libre-label').style.borderColor = state.projectMode === 'libre' ? 'var(--green)' : 'var(--border)';
  document.getElementById('mode-estricto-label').style.borderColor = state.projectMode === 'estricto' ? 'var(--accent)' : 'var(--border)';
  document.getElementById('mode-requirements').innerHTML = state.projectMode === 'estricto'
    ? '🔒 <b>Obligatorio:</b> N° Poste · Dirección · Material · Altura · Carga · Tensión · Estado · GPS · 3 fotos &nbsp;|&nbsp; No podrás guardar sin estos datos.'
    : '🆓 <b>Sin restricciones:</b> guarda con los datos que tengas.';
}

function validateKMZInput() {
  const file = document.getElementById('proj-kmz').files[0];
  const hint = document.getElementById('kmz-hint');
  if (file) {
    const mb = (file.size / 1048576).toFixed(1);
    document.getElementById('kmz-fname').textContent = file.name;
    document.getElementById('kmz-fsize').textContent = mb + ' MB';
    hint.style.display = 'block';
    if (mb > CONFIG.KMZ_MAX_MB) showToast('⚠️ El archivo pesa más de 5 MB. Considera simplificarlo.');
  } else {
    hint.style.display = 'none';
  }
}

async function createProject() {
  const raw = document.getElementById('proj-input').value.trim();
  const code = document.getElementById('proj-code').value.trim().toUpperCase();
  if (!raw) { showToast('Ingresa un nombre de proyecto'); return; }
  if (!code || code.length < 3) { showToast('Ingresa un código de acceso (mínimo 3 caracteres)'); return; }
  state.projectName = raw;
  state.projectKey = raw.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚüÜñÑ]/g,'');
  updateModeUI();

  const { error } = await withTimeout(
    SB.from('proyectos').upsert({
      proyecto_key: state.projectKey,
      nombre: state.projectName,
      codigo_acceso: code,
      modo: state.projectMode,
      activo: true
    }, { onConflict: 'proyecto_key' }),
    CONFIG.NETWORK_TIMEOUT_SAVE
  );
  if (error) { showToast('Error al crear proyecto: ' + error.message); return; }

  const kmzFile = document.getElementById('proj-kmz').files[0];
  if (kmzFile) {
    try { await sbUploadKMZ(kmzFile); showToast('✓ Proyecto creado + KMZ cargado. Código: ' + code); }
    catch(e) { showToast('✓ Proyecto creado. Código: ' + code + ' (KMZ no se pudo subir)'); }
  } else {
    showToast('✓ Proyecto creado. Código: ' + code);
  }
  safeSetItem(`pf_mode_${state.projectKey}`, state.projectMode);
  document.getElementById('proj-code').value = '';
  await openProject();
}

async function loadPrevProjects() {
  const statusEl = document.getElementById('ps-supabase-status');
  const sec = document.getElementById('prev-projects-section');
  const list = document.getElementById('prev-projects-list');
  const title = document.getElementById('prev-projects-title');
  const createSec = document.getElementById('ps-create-section');
  const sub = document.getElementById('ps-sub');
  if (!SB) { statusEl.textContent = '⚠️ Cargando Supabase... recarga en unos segundos'; statusEl.style.color='var(--accent)'; return; }

  if (state.isAdmin) {
    createSec.style.display = 'block';
  }

  try {
    const { data, error } = await SB.from('proyectos').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    if (!data || !data.length) {
      sec.style.display = 'none';
      statusEl.textContent = state.isAdmin ? '☁️ Sin proyectos — crea el primero' : '';
      statusEl.style.color = 'var(--muted)';
      safeSetItem('pf_projects_cache', '[]');
      return;
    }

    safeSetItem('pf_projects_cache', JSON.stringify(data));

    sec.style.display = 'block';
    title.textContent = state.isAdmin ? 'Todos los proyectos' : 'Proyecto';
    statusEl.textContent = '☁️ Supabase conectado';
    statusEl.style.color = 'var(--green)';

    list.innerHTML = data.map(p => {
      const safeName = escHtml(p.nombre);
      const statusIcon = p.activo ? '🟢' : '🔴';
      const actionBtns = state.isAdmin
        ? `<button class="admin-btn" style="font-size:9px;padding:3px 6px;background:rgba(183,28,28,.08);border:1px solid var(--red);color:var(--red)" data-action="delete" data-proj-key="${escHtml(p.proyecto_key)}" data-proj-name="${safeName.replace(/'/g, "\\'")}">🗑</button>
           <button class="admin-btn" style="font-size:10px;padding:4px 8px" data-action="toggle" data-proj-key="${escHtml(p.proyecto_key)}" data-active="${p.activo}">${p.activo ? '🔴 Desactivar' : '🟢 Activar'}</button>`
        : '';
      return `<div class="ps-prev-item" data-start-project="${safeName.replace(/'/g, "\\'")}">
        <div><div class="ps-prev-name">${statusIcon} ${safeName}</div><div class="ps-prev-meta">Código: ${escHtml(p.codigo_acceso)} · ${p.modo}</div></div>
        <div style="display:flex;align-items:center;gap:4px">
          ${actionBtns}
          <div class="ps-prev-count">▶</div>
        </div>
      </div>`;
    }).join('');

    // Bind project list events
    bindPrevProjectEvents(data);
  } catch (e) {
    try {
      const cache = JSON.parse(localStorage.getItem('pf_projects_cache') || '[]');
      if (cache.length) {
        sec.style.display = 'block';
        title.textContent = state.isAdmin ? 'Todos los proyectos (offline)' : 'Proyecto';
        statusEl.textContent = '📡 Modo offline — datos locales';
        statusEl.style.color = 'var(--accent)';
        list.innerHTML = cache.map(p => {
          const safeName = escHtml(p.nombre);
          const statusIcon = p.activo ? '🟢' : '🔴';
          return `<div class="ps-prev-item" data-start-project="${safeName.replace(/'/g, "\\'")}">
            <div><div class="ps-prev-name">${statusIcon} ${safeName}</div><div class="ps-prev-meta">Código: ${escHtml(p.codigo_acceso)} · ${p.modo}</div></div>
            <div style="display:flex;align-items:center;gap:6px">
              <div class="ps-prev-count">▶</div>
            </div>
          </div>`;
        }).join('');
        bindPrevProjectOfflineEvents(cache);
        return;
      }
    } catch (_) {}
    statusEl.textContent = '⚠️ Sin conexión';
    statusEl.style.color = 'var(--red)';
    sec.style.display = 'none';
  }
}

function bindPrevProjectEvents(data) {
  document.querySelectorAll('[data-start-project]').forEach(el => {
    const name = el.getAttribute('data-start-project');
    el.addEventListener('click', () => startProject(name));
  });
  document.querySelectorAll('[data-action="delete"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProject(el.getAttribute('data-proj-key'), el.getAttribute('data-proj-name'));
    });
  });
  document.querySelectorAll('[data-action="toggle"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleProject(el.getAttribute('data-proj-key'), el.getAttribute('data-active') === 'true');
    });
  });
}

function bindPrevProjectOfflineEvents(cache) {
  document.querySelectorAll('[data-start-project]').forEach(el => {
    const name = el.getAttribute('data-start-project');
    el.addEventListener('click', () => startProject(name));
  });
}

async function toggleProject(key, currentlyActive) {
  const newState = !currentlyActive;
  await SB.from('proyectos').update({ activo: newState }).eq('proyecto_key', key);
  showToast(newState ? '🟢 Proyecto activado' : '🔴 Proyecto desactivado');
  loadPrevProjects();
}

async function deleteProject(projKey, projName) {
  if (!confirm(`⚠️ ¿Eliminar definitivamente el proyecto "${projName}"?\n\nSe borrarán TODOS los registros, fotos y el proyecto de Supabase.`)) return;
  if (!confirm('¿Estás seguro? Esta acción NO se puede deshacer.')) return;

  try {
    showToast('📦 Generando respaldo ZIP...');
    state.projectKey = projKey;
    state.projectName = projName;
    const sbRecords = await SB.from('registros').select('*').eq('proyecto', projKey).order('seq', { ascending: true });
    if (sbRecords.data && sbRecords.data.length) {
      const tempRecords = sbRecords.data.map(r => ({
        ...r,
        _photos: [r.foto1, r.foto2, r.foto3].filter(Boolean).map(name => {
          const { data } = SB.storage.from(BUCKET_FOTOS).getPublicUrl(`${projKey}/${name}`);
          return { name, url: data?.publicUrl || '' };
        })
      }));
      const saved = state.records;
      state.records = tempRecords;
      try { await exportZIP(); } catch(_) {}
      state.records = saved;
    }

    await sbDeleteProject(projKey);

    localStorage.removeItem(`pf_mode_${projKey}`);
    localStorage.removeItem(`pf_draft_${projKey}`);

    try {
      const cache = JSON.parse(localStorage.getItem('pf_projects_cache') || '[]');
      safeSetItem('pf_projects_cache', JSON.stringify(cache.filter(p => p.proyecto_key !== projKey)));
    } catch(_) {}

    showToast('✓ Proyecto eliminado');
    loadPrevProjects();
  } catch(e) {
    showToast('Error al eliminar: ' + e.message);
  }
}

export function startProject(nameOverride) {
  state.projectName = nameOverride;
  state.projectKey = nameOverride.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚüÜñÑ]/g,'');
  state.projectMode = localStorage.getItem(`pf_mode_${state.projectKey}`) || 'libre';
  openProject();
}

async function openProject() {
  state.records = [];
  if (SB) {
    try {
      const { data, error } = await SB
        .from('registros')
        .select('*')
        .eq('proyecto', state.projectKey)
        .order('seq', { ascending: true });

      if (error) {
        showToast('Error al cargar proyecto: ' + error.message);
      } else if (data) {
        state.records = data.map(r => ({
          ...r,
          _photos: [r.foto1, r.foto2, r.foto3]
            .filter(Boolean)
            .map(name => {
              const path = `${state.projectKey}/${name}`;
              const { data: d } = SB.storage.from(BUCKET_FOTOS).getPublicUrl(path);
              return { name, url: d?.publicUrl || '' };
            })
        }));
      }
    } catch (e) {
      console.warn('Offline — usando datos locales');
      try {
        const offlineRecords = await getOfflineRecords(state.projectKey);
        if (offlineRecords && offlineRecords.length) {
          state.records = offlineRecords;
        }
      } catch (_) {}
    }
  }

  document.getElementById('project-screen').style.display = 'none';
  document.getElementById('header-logout-btn').style.display = 'inline';
  const modeIcon = state.projectMode === 'estricto' ? '🔒' : '🆓';
  document.getElementById('project-chip').textContent = modeIcon + ' ' + state.projectName.slice(0, 18);

  var localMax = state.records.length > 0 ? Math.max(...state.records.map(r => r.seq)) + 1 : 1;
  if (SB) {
    try {
      var dbMax = await sbGetMaxSeq(state.projectKey);
      state.seqNum = Math.max(localMax, dbMax + 1);
    } catch (e) {
      state.seqNum = localMax;
    }
  } else {
    state.seqNum = localMax;
  }
  state.uid = genUID();
  refreshFilenames();
  updateExportPanel();
  updateKMZSection();
  buildDynUI();
  updateAriaRequired();
  const draft = loadDraft();
  if (draft) {
    if (confirm('📝 Hay un borrador sin guardar de hoy. ¿Restaurarlo?')) {
      restoreDraft(draft);
    } else {
      clearDraft();
    }
  }
  startDraftAutoSave();
  setTimeout(() => syncOfflineQueue(), CONFIG.SYNC_INITIAL_DELAY);
}

export function promptChangeProject() {
  if (confirm('¿Cambiar de proyecto? Se guardará el progreso actual.')) {
    saveDraft();
    stopDraftAutoSave();
    document.getElementById('project-screen').style.display = 'flex';
    if (!state.isAdmin) {
      document.getElementById('access-section').style.display = 'block';
    }
    document.getElementById('ps-create-section').style.display = state.isAdmin ? 'block' : 'none';
    document.getElementById('project-chip').textContent = '📁 —';
    document.getElementById('proj-input').value = '';
    document.getElementById('proj-preview').textContent = '—';
    loadPrevProjects();
  }
}

// ═══════════════════════════════════════════════════
// ACCESS / AUTH
// ═══════════════════════════════════════════════════
function resetActivityTimer() {
  if (state.accessCode) safeSetItem('pf_access_ts', Date.now());
}

async function updateAdminCode(newCode) {
  const code = newCode.trim().toUpperCase();
  if (!code || code.length < 4) { showToast('El código debe tener mínimo 4 caracteres'); return; }
  try {
    const { error } = await SB.from('config').upsert({ key: 'admin_code', value: code }, { onConflict: 'key' });
    if (error) { showToast('Error: ' + error.message); return; }
    state.ADMIN_CODE = code;
    showToast('✓ Código admin actualizado');
    document.getElementById('admin-code-input').value = '';
  } catch (e) {
    showToast('Error de conexión al guardar el código. Revisa tu internet.');
  }
}

async function verifyCode() {
  try {
  const input = document.getElementById('access-input').value.trim().toUpperCase();
  if (!input) { showToast('Ingresa un código de acceso'); return; }

  if (input === state.ADMIN_CODE) {
  state.isAdmin = true;
  state.accessCode = input;
  safeSetItem('pf_access_code', input);
  safeSetItem('pf_access_ts', Date.now());
    document.getElementById('access-section').style.display = 'none';
    document.getElementById('ps-create-section').style.display = 'block';
    document.getElementById('ps-sub').textContent = '🔑 Modo administrador. Crea y gestiona proyectos.';
    document.getElementById('admin-code-section').style.display = 'block';
    document.getElementById('ps-logout-btn').style.display = 'block';
    document.getElementById('ps-supabase-status').textContent = '';
    loadPrevProjects();
    return;
  }

  let data = null;
  if (SB) {
    try {
      const res = await withTimeout(
        SB.from('proyectos').select('*').eq('codigo_acceso', input).eq('activo', true).single(),
        CONFIG.NETWORK_TIMEOUT_QUERY
      );
      if (!res.error) data = res.data;
    } catch (e) { /* offline — buscar en caché */ }
  }

  if (!data) {
    try {
      const cache = JSON.parse(localStorage.getItem('pf_projects_cache') || '[]');
      data = cache.find(p => p.codigo_acceso === input && p.activo);
    } catch (_) {}
  }
  if (!data) {
    try {
      var rawMapping = localStorage.getItem('pf_access_project_' + input);
      if (rawMapping) data = JSON.parse(rawMapping);
    } catch (_) {}
  }

  if (!data) {
    showToast('⚠️ Código inválido o proyecto inactivo');
    return;
  }

  state.isAdmin = false;
  state.accessCode = input;
  safeSetItem('pf_access_code', input);
  safeSetItem('pf_access_ts', Date.now());
  safeSetItem('pf_access_project_' + input, JSON.stringify({
    nombre: data.nombre,
    proyecto_key: data.proyecto_key || data.nombre.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚüÜñÑ]/g,''),
    modo: data.modo || 'libre'
  }));
  document.getElementById('access-section').style.display = 'none';
  document.getElementById('ps-create-section').style.display = 'none';
  document.getElementById('ps-sub').textContent = '';
  document.getElementById('ps-supabase-status').textContent = '';
  state.projectMode = data.modo || 'libre';
  startProject(data.nombre);
  } catch(e) {
    showToast('Error: ' + (e.message || 'inesperado'));
    console.error(e);
  }
}

function clearAccess() {
  localStorage.removeItem('pf_access_code');
  localStorage.removeItem('pf_access_ts');
  location.reload();
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
function initApp() {
  const ts = localStorage.getItem('pf_access_ts');
  if (ts && Date.now() - parseInt(ts) > SESSION_TIMEOUT) {
    localStorage.removeItem('pf_access_code');
    localStorage.removeItem('pf_access_ts');
    state.accessCode = '';
  }
  loadAdminCode();
  const saved = localStorage.getItem('pf_access_code');
  if (saved) {
    state.accessCode = saved;
    document.getElementById('access-input').value = saved;
    setTimeout(() => verifyCode(), 100);
  }
  document.getElementById('project-screen').style.display = 'flex';
  document.getElementById('ps-sub').textContent = '✓ App lista. Ingresa el código de acceso.';
  updateConnDot();
}

// ═══════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════
function bindAllEvents() {
  // Access screen
  const enterBtn = document.getElementById('enter-btn');
  if (enterBtn) enterBtn.addEventListener('click', verifyCode);

  const accessInput = document.getElementById('access-input');
  if (accessInput) accessInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); verifyCode(); }
  });

  const psLogoutBtn = document.getElementById('ps-logout-btn');
  if (psLogoutBtn) psLogoutBtn.addEventListener('click', clearAccess);

  const headerLogoutBtn = document.getElementById('header-logout-btn');
  if (headerLogoutBtn) headerLogoutBtn.addEventListener('click', clearAccess);

  const adminCodeSaveBtn = document.getElementById('admin-code-save-btn');
  if (adminCodeSaveBtn) adminCodeSaveBtn.addEventListener('click', () => {
    updateAdminCode(document.getElementById('admin-code-input').value);
  });

  // Create project
  const psCreateBtn = document.getElementById('ps-create-btn');
  if (psCreateBtn) psCreateBtn.addEventListener('click', createProject);

  const projInput = document.getElementById('proj-input');
  if (projInput) projInput.addEventListener('input', sanitizeProjInput);

  const projKmz = document.getElementById('proj-kmz');
  if (projKmz) projKmz.addEventListener('change', validateKMZInput);

  // Mode radio buttons
  document.querySelectorAll('input[name="proj-mode"]').forEach(radio => {
    radio.addEventListener('change', updateModeUI);
  });

  // Tabs
  for (let i = 0; i <= 4; i++) {
    const tab = document.getElementById(`tab${i}`);
    if (tab) tab.addEventListener('click', () => goTo(i));
  }

  // Panel navigation buttons
  document.getElementById('btn-to-ubicacion')?.addEventListener('click', () => goTo(1));
  document.getElementById('btn-to-encuesta')?.addEventListener('click', () => goTo(0));
  document.getElementById('btn-to-fotos')?.addEventListener('click', () => goTo(2));
  document.getElementById('btn-to-ubicacion-back')?.addEventListener('click', () => goTo(1));

  // GPS
  document.getElementById('gps-btn')?.addEventListener('click', captureGPS);

  // Map modal
  document.getElementById('btn-open-map')?.addEventListener('click', openMap);
  document.getElementById('btn-close-map')?.addEventListener('click', closeMap);
  document.getElementById('btn-cancel-map')?.addEventListener('click', closeMap);
  document.getElementById('btn-confirm-map')?.addEventListener('click', confirmMapCoord);

  // Camera slots
  for (let i = 0; i < 3; i++) {
    const slot = document.getElementById(`slot-${i}`);
    const delBtn = document.getElementById(`foto-del-${i}`);
    const camInput = document.getElementById(`cam-${i}`);
    if (slot) slot.addEventListener('click', () => trigCam(i));
    if (delBtn) delBtn.addEventListener('click', (e) => rmFoto(e, i));
    if (camInput) camInput.addEventListener('change', (e) => handleFoto(e, i));
  }

  // Save
  document.getElementById('save-btn')?.addEventListener('click', saveAndExport);

  // Export panel
  document.getElementById('btn-new-record')?.addEventListener('click', newRecord);
  document.getElementById('zip-btn')?.addEventListener('click', exportZIP);
  document.getElementById('btn-csv-only')?.addEventListener('click', downloadCSVOnly);
  document.getElementById('btn-kml-only')?.addEventListener('click', downloadKML);
  document.getElementById('btn-geojson-only')?.addEventListener('click', downloadGeoJSON);
  document.getElementById('btn-project-map')?.addEventListener('click', openProjectMap);
  document.getElementById('table-filter')?.addEventListener('input', filterTable);

  // Admin KMZ section
  document.getElementById('kmz-upload-btn')?.addEventListener('click', () => {
    document.getElementById('admin-kmz-input').click();
  });
  document.getElementById('admin-kmz-input')?.addEventListener('change', adminKMZChanged);
  document.getElementById('kmz-delete-btn')?.addEventListener('click', adminDeleteKMZ);

  // Header
  document.getElementById('project-chip')?.addEventListener('click', promptChangeProject);
  document.getElementById('open-rpanel-btn')?.addEventListener('click', openR);

  // Sidebar
  document.getElementById('overlay')?.addEventListener('click', closeR);
  document.getElementById('btn-close-rpanel')?.addEventListener('click', closeR);
  document.getElementById('btn-sidebar-zip')?.addEventListener('click', () => { exportZIP(); closeR(); });
  document.getElementById('btn-clear-all')?.addEventListener('click', clearAll);

  // Connectivity
  window.addEventListener('online', () => {
    updateConnDot();
    showToast('🌐 Conexión restaurada — sincronizando...');
    syncOfflineQueue().then(() => actualizarBotonSync());
  });
  window.addEventListener('offline', () => {
    updateConnDot();
    showToast('📡 Sin conexión — los datos se guardan localmente');
  });

  // Activity timer
  ['click','keypress','touchstart','scroll'].forEach(ev =>
    document.addEventListener(ev, resetActivityTimer, { passive: true })
  );
}

// ═══════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════
updateModeUI();
bindAllEvents();
initApp();
