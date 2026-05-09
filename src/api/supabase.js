import { state, CONFIG } from '../store/state.js';

export const SUPABASE_URL = 'https://aoduvchuwxuzdstzlxuu.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZHV2Y2h1d3h1emRzdHpseHV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTgzMDQsImV4cCI6MjA5MzIzNDMwNH0.4kXaLjnjCpsXWkQoNpzX3OozhxIsZFLQnwddIvyIxco';
export const BUCKET_FOTOS = 'fotos';
export const SB = typeof supabase !== 'undefined' ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function sbUploadPhoto(blob, filename) {
  const path = `${state.projectKey}/${filename}`;
  const { data, error } = await withTimeout(
    SB.storage.from(BUCKET_FOTOS).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true
    }), CONFIG.NETWORK_TIMEOUT_UPLOAD
  );
  if (error) throw error;

  const { data: { publicUrl } } = SB.storage.from(BUCKET_FOTOS).getPublicUrl(path);
  return publicUrl;
}

export async function sbSaveRecord(record) {
  const { error, data } = await SB.rpc('insert_registro_seguro', {
    p_proyecto: state.projectKey,
    p_codigo: state.accessCode,
    p_record_data: record
  });
  if (error) throw error;
  return data;
}

export async function sbDeleteProject(projKey) {
  try { await SB.storage.from(BUCKET_FOTOS).remove([`${projKey}/area_interes.kmz`]); } catch(_) {}
  try {
    const { data: files } = await SB.storage.from(BUCKET_FOTOS).list(projKey);
    if (files && files.length) {
      const paths = files.map(f => `${projKey}/${f.name}`);
      await SB.storage.from(BUCKET_FOTOS).remove(paths);
    }
  } catch(e) { /* puede fallar si no hay fotos */ }
  await SB.from('registros').delete().eq('proyecto', projKey);
  await SB.from('proyectos').delete().eq('proyecto_key', projKey);
}

export function kmzPath() { return `${state.projectKey}/area_interes.kmz`; }

export function kmzPublicUrl() {
  const { data } = SB.storage.from(BUCKET_FOTOS).getPublicUrl(kmzPath());
  return data?.publicUrl || '';
}

export async function sbCheckKMZ() {
  try {
    const resp = await withTimeout(fetch(kmzPublicUrl(), { method: 'HEAD' }), CONFIG.NETWORK_TIMEOUT_QUERY);
    return resp.ok;
  } catch (_) { return false; }
}

export async function sbUploadKMZ(file) {
  const path = kmzPath();
  const { error } = await SB.storage.from(BUCKET_FOTOS).upload(path, file, {
    contentType: file.type || 'application/vnd.google-earth.kmz',
    upsert: true
  });
  if (error) throw error;
}

export async function sbDeleteKMZ() {
  const { error } = await SB.storage.from(BUCKET_FOTOS).remove([kmzPath()]);
  if (error) throw error;
}

export async function loadAdminCode() {
  try {
    const { data } = await SB.from('config').select('value').eq('key', 'admin_code').single();
    if (data) state.ADMIN_CODE = data.value;
  } catch(e) { /* usar fallback '4839' */ }
}

export async function sbGetMaxSeq(projectKey) {
  const { data, error } = await SB
    .from('registros')
    .select('seq')
    .eq('proyecto', projectKey)
    .order('seq', { ascending: false })
    .limit(1)
    .single();
  if (error) return 0;
  return (data && data.seq) ? data.seq : 0;
}
