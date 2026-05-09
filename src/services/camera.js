import { state, CONFIG } from '../store/state.js';
import { sbUploadPhoto } from '../api/supabase.js';
import { showToast } from '../main.js';
import { savePhoto, markPhotoUploaded } from './db.js';

export function trigCam(i) {
  if (state.photos[i]) return;
  const lat = document.getElementById('f-lat').value;
  const lng = document.getElementById('f-lng').value;
  if (!lat || !lng) {
    showToast('⚠️ Primero captura la coordenada GPS del poste');
    return;
  }
  clearSlotHighlight();
  document.getElementById(`cam-${i}`).click();
}

export function highlightNextSlot(currentIdx) {
  clearSlotHighlight();
  const next = currentIdx + 1;
  if (next < 3 && !state.photos[next]) {
    document.getElementById(`slot-${next}`).classList.add('next');
  }
}

export function clearSlotHighlight() {
  for (let i = 0; i < 3; i++) {
    document.getElementById(`slot-${i}`).classList.remove('next');
  }
}

export function handleFoto(e, i) {
  const inp = e.target;
  if (inp._processing) { inp.value = ''; return; }
  const file = e.target.files[0]; if(!file) return;
  inp._processing = true;
  inp.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    const name = `${state.uid}_F0${i+1}.jpg`;
    const img  = new Image();
    img.onload = () => {
      const maxW = 1600;
      let w=img.width, h=img.height;
      if(w>maxW){ h=Math.round(h*maxW/w); w=maxW; }

      const canvas = document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,0,0,w,h);

      const lat   = document.getElementById('f-lat').value  || 'Sin GPS';
      const lng   = document.getElementById('f-lng').value  || 'Sin GPS';
      const nPoste= document.getElementById('f-num').value  || '—';
      const now   = new Date();
      const fecha = now.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'});
      const hora  = now.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const fotoLabel = ['Vista General','Placa / N°','Detalle Estado'][i];

      const scale  = w / CONFIG.PHOTO_SCALE_REF;
      const pad    = Math.round(20*scale);
      const lh     = Math.round(36*scale);
      const fCoord = Math.round(28*scale);
      const fMain  = Math.round(23*scale);
      const fSub   = Math.round(19*scale);
      const fTiny  = Math.round(16*scale);

      const hasGeo = state.geoAddress && state.geoAddress.length > 0;
      const nLines = hasGeo ? 7 : 6;
      const boxH   = lh * nLines + pad * 3.2;

      const marginBottom = Math.round(h * 0.03);
      const boxY   = h - boxH - marginBottom;

      const margin  = Math.round(w * 0.035);
      const radius  = Math.round(14 * scale);
      const cardX   = margin;
      const cardW   = w - margin * 2;
      const barH    = Math.round(6 * scale);

      ctx.shadowColor   = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur    = Math.round(18 * scale);
      ctx.shadowOffsetY = Math.round(4 * scale);

      ctx.fillStyle = 'rgba(10,12,20,0.85)';
      ctx.beginPath();
      ctx.roundRect(cardX, boxY, cardW, boxH, radius);
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0;
      ctx.shadowOffsetY = 0;

      ctx.fillStyle = '#0B5FA5';
      ctx.beginPath();
      ctx.roundRect(cardX, boxY, cardW, barH, [radius, radius, 0, 0]);
      ctx.fill();

      ctx.strokeStyle = 'rgba(11,95,165,0.35)';
      ctx.lineWidth   = Math.round(1.5 * scale);
      ctx.beginPath();
      ctx.roundRect(cardX, boxY, cardW, boxH, radius);
      ctx.stroke();

      const innerPad = Math.round(pad * 1.4);
      const x1 = cardX + innerPad;
      const x2 = cardX + cardW * 0.50;
      let   y  = boxY + barH + innerPad + lh * 0.85;

      ctx.font      = `bold ${fCoord}px monospace`;
      ctx.fillStyle = '#2E7D32';
      ctx.fillText(`LAT: ${lat}`, x1, y);
      ctx.fillText(`LNG: ${lng}`, x2, y);
      y += lh * 0.55;

      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth   = Math.round(1.5*scale);
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(cardX + cardW - innerPad, y); ctx.stroke();
      y += lh * 0.65;

      if(hasGeo) {
        ctx.font      = `bold ${fMain}px monospace`;
        ctx.fillStyle = '#0B5FA5';
        ctx.fillText(`📍 ${state.geoAddress}`, x1, y);
        y += lh;
      }

      ctx.font      = `${fMain}px monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`📅 ${fecha}   🕐 ${hora}`, x1, y);
      y += lh;

      ctx.font      = `bold ${fMain}px monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`Poste: ${nPoste}`, x1, y);
      ctx.font      = `${fSub}px monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`Proyecto: ${state.projectName}`, x2, y);
      y += lh;

      ctx.font      = `${fTiny}px monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`ID: ${state.uid}`, x1, y);
      ctx.fillText(`${fotoLabel}  [F0${i+1}/F03]  #${state.seqNum}`, x2, y);
      y += lh * 0.95;

      ctx.font      = `${fTiny}px monospace`;
      ctx.fillStyle = 'rgba(11,95,165,0.7)';
      ctx.fillText(name, x1, y);

      canvas.toBlob(blob => {
        state.photos[i] = { name, blob };
        const objectUrl = URL.createObjectURL(blob);
        state.photos[i].objectUrl = objectUrl;

        if (blob.size > 200 * 1024) {
          console.warn('Foto ' + name + ' supera 200 KB: ' + (blob.size / 1024).toFixed(1) + ' KB');
        }

        if (navigator.storage && navigator.storage.estimate) {
          navigator.storage.estimate().then(function(est) {
            var free = est.quota - est.usage;
            if (free < 10 * 1048576) {
              showToast('⚠️ Límite de seguridad del navegador alcanzado. Limpia fotos antiguas', 'error');
              return;
            }
            savePhoto(name, blob, state.uid).catch(err => {
              console.error('Error guardando foto en IndexedDB:', err);
              showToast('⚠️ No se pudo guardar: ' + (err.name || err.message || 'Error desconocido'), 'error');
            });
          }).catch(function() {
            savePhoto(name, blob, state.uid).catch(err => {
              console.error('Error guardando foto en IndexedDB:', err);
              showToast('⚠️ No se pudo guardar: ' + (err.name || err.message || 'Error desconocido'), 'error');
            });
          });
        } else {
          savePhoto(name, blob, state.uid).catch(err => {
            console.error('Error guardando foto en IndexedDB:', err);
            showToast('⚠️ No se pudo guardar: ' + (err.name || err.message || 'Error desconocido'), 'error');
          });
        }

        const slot=document.getElementById(`slot-${i}`);
        let im=slot.querySelector('img');
        if(!im){im=document.createElement('img');slot.insertBefore(im,slot.firstChild);}
        im.src=objectUrl; slot.classList.add('done');
        document.getElementById(`fn-${i}`).textContent=name;
        showToast(`📸 Foto ${i+1} georreferenciada ✓`);
        state.photos[i]._uploadPromise = sbUploadPhoto(blob, name)
          .then(url => {
            state.photos[i].url = url;
            markPhotoUploaded(name).catch(() => {});
            showToast(`☁️ ${name} subida a Supabase`);
            return url;
          })
          .catch(e => {
            console.error('Error subiendo foto:', e);
            showToast('⚠️ Error al subir foto — se guardará localmente');
            throw e;
          });
        highlightNextSlot(i);
        inp._processing = false;
      }, 'image/jpeg', CONFIG.PHOTO_JPEG_QUALITY);
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
}

export function rmFoto(e, i) {
  e.stopPropagation();
  const photo = state.photos[i];
  if (photo?.objectUrl) { URL.revokeObjectURL(photo.objectUrl); }
  state.photos[i]=null;
  const s=document.getElementById(`slot-${i}`);
  const im=s.querySelector('img'); if(im) im.remove();
  s.classList.remove('done');
  document.getElementById(`fn-${i}`).textContent='—';
  const inp = document.getElementById(`cam-${i}`);
  inp.value = '';
  inp._processing = false;
  clearSlotHighlight();
  for (let j = 0; j < 3; j++) {
    if (!state.photos[j]) { document.getElementById(`slot-${j}`).classList.add('next'); break; }
  }
}
