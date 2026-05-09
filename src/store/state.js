export const state = {
  projectName: '',
  projectKey: '',
  records: [],
  photos: [null, null, null],
  uid: '',
  seqNum: 0,
  projectMode: 'libre',
  accessCode: '',
  isAdmin: false,
  geoAddress: '',
  mapInst: null,
  mapReady: false,
  userMarker: null,
  gpsWatchId: null,
  userAccCircle: null,
  layerControl: null,
  kmzLayerGroup: null,
  draftInterval: null,
  idb: null,
  ADMIN_CODE: '4839'
};

export const CONFIG = {
  GPS_TIMEOUT: 15000,
  GPS_MAX_AGE: 10000,
  GPS_AUTO_TIMEOUT: 12000,
  GPS_AUTO_MAX_AGE: 10000,
  GPS_WATCH_TIMEOUT: 30000,
  GPS_WATCH_MAX_AGE: 5000,
  PHOTO_MAX_WIDTH: 1280,
  PHOTO_SCALE_REF: 1100,
  PHOTO_JPEG_QUALITY: 0.60,
  TOAST_DURATION: 2800,
  MAP_INVALIDATE_DELAY: 120,
  DRAFT_AUTO_SAVE_INTERVAL: 30000,
  KMZ_MAX_MB: 5,
  SYNC_INITIAL_DELAY: 1500,
  NETWORK_TIMEOUT_SAVE: 20000,
  NETWORK_TIMEOUT_QUERY: 15000,
  NETWORK_TIMEOUT_UPLOAD: 25000,
};

export const SESSION_TIMEOUT = 5 * 60 * 1000;
export const OFFLINE_KEY_PREFIX = 'pf_offline_';

export const DYNAMIC_FIELDS = [
  { id:'retenidas',     label:'Retenidas',               group:'Infraestructura Eléctrica' },
  { id:'bajantes',      label:'Bajantes',                group:'Infraestructura Eléctrica' },
  { id:'transformador', label:'Transformador',           group:'Infraestructura Eléctrica', options:['TRANSF. 15 KVA','TRANSF. 30 KVA','TRANSF. 45 KVA','TRANSF. 75 KVA','TRANSF. 112,5 KVA','TRANSF. 150 KVA'] },
  { id:'multpar',       label:'Multpar Telefónico',      group:'Cable / Fibra' },
  { id:'rg500',         label:'Cable RG 500',            group:'Cable / Fibra' },
  { id:'rg11',          label:'Cable RG 11',             group:'Cable / Fibra' },
  { id:'fibra_optica',  label:'Fibra Óptica',            group:'Cable / Fibra' },
  { id:'reservas',      label:'Reservas',                group:'Cable / Fibra' },
  { id:'caja_tel',      label:'Cajas Telefónicas',       group:'Cajas y Equipos' },
  { id:'caja_nap',      label:'Cajas NAP',               group:'Cajas y Equipos' },
  { id:'caja_empalme',  label:'Cajas de Empalme (Domos)',group:'Cajas y Equipos' },
  { id:'fuente_poder',  label:'Fuente de Poder',         group:'Cajas y Equipos' },
  { id:'nodo_optico',   label:'Nodo Óptico',             group:'Cajas y Equipos' },
  { id:'amplificador',  label:'Amplificador',            group:'Cajas y Equipos' },
  { id:'proyectado',    label:'Uso / Elemento Proyectado', group:'Proyección', options:['Apoyo','Caja NAP','Caja Empalme','Caja Empalme y NAP'] },
];

export const DYN_IDS = DYNAMIC_FIELDS.map(d => d.id);
export const CSV_BASE = ['SEQ','UID','FECHA','HORA','N_POSTE','DIRECCION','MATERIAL','ALTURA_M','CARGA_DAN','TENSION','ESTADO'];
export const CSV_DYN  = DYN_IDS.map(id => id.toUpperCase());
export const CSV_END  = ['UBICACION','LAT','LNG','FOTO_1','FOTO_2','FOTO_3','OBSERVACIONES'];
export const CSV_COLS = [...CSV_BASE, ...CSV_DYN, ...CSV_END];
