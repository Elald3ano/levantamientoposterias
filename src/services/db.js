import { state } from '../store/state.js';

const DB_NAME = 'posteapp_db';
const DB_VERSION = 1;

let _db = null;
let _dbOpenPromise = null;

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDB() {
  if (_db) {
    try {
      const tx = _db.transaction(['offline_queue'], 'readonly');
      tx.abort();
      return Promise.resolve(_db);
    } catch (e) {
      console.warn('IndexedDB connection lost, reconnecting...');
      _db = null;
      _dbOpenPromise = null;
    }
  }

  if (_dbOpenPromise) return _dbOpenPromise;

  _dbOpenPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('offline_queue')) {
        const store = db.createObjectStore('offline_queue', { keyPath: 'uid' });
        store.createIndex('projectKey', 'projectKey', { unique: false });
      }

      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'name' });
        photoStore.createIndex('record_uid', 'record_uid', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      _db.onclose = () => {
        console.warn('IndexedDB connection closed by browser');
        _db = null;
        _dbOpenPromise = null;
      };
      _dbOpenPromise = null;
      resolve(_db);
    };

    req.onerror = () => {
      _dbOpenPromise = null;
      reject(req.error);
    };

    req.onblocked = () => {
      _dbOpenPromise = null;
      reject(new Error('IndexedDB blocked — close other tabs'));
    };
  });

  return _dbOpenPromise;
}

function withRetry(fn, maxRetries = 1) {
  return fn().catch(err => {
    if (
      maxRetries > 0 &&
      (err.name === 'InvalidStateError' ||
       err.name === 'TransactionInactiveError' ||
       String(err).includes('transaction') ||
       String(err).includes('closed'))
    ) {
      _db = null;
      _dbOpenPromise = null;
      return openDB().then(() => withRetry(fn, maxRetries - 1));
    }
    throw err;
  });
}

function storeTx(storeName, mode) {
  return openDB().then(db => {
    const tx = db.transaction(storeName, mode);
    tx.onerror = () => {};
    tx.onabort = () => {};
    return tx.objectStore(storeName);
  });
}

export function saveRecordToOfflineQueue(record) {
  return withRetry(() =>
    storeTx('offline_queue', 'readwrite').then(store => {
      // Use put so it can update if uid already exists
      return promisifyRequest(store.put(record)).then(() => record);
    })
  );
}

export function getOfflineRecords(projectKey) {
  return withRetry(() =>
    storeTx('offline_queue', 'readonly').then(store => {
      const index = store.index('projectKey');
      return promisifyRequest(index.getAll(projectKey));
    })
  );
}

export function getOfflineCount(projectKey) {
  return withRetry(() =>
    storeTx('offline_queue', 'readonly').then(store => {
      const index = store.index('projectKey');
      return promisifyRequest(index.count(projectKey));
    })
  );
}

export function deleteOfflineRecord(uid) {
  return withRetry(() =>
    storeTx('offline_queue', 'readwrite').then(store =>
      promisifyRequest(store.delete(uid))
    )
  );
}

export function savePhoto(name, blob, recordUid) {
  return withRetry(() =>
    storeTx('photos', 'readwrite').then(store =>
      promisifyRequest(store.put({ name, blob, record_uid: recordUid, uploaded: false }))
    )
  );
}

export function getPendingPhotos() {
  return withRetry(() =>
    storeTx('photos', 'readonly').then(store =>
      promisifyRequest(store.getAll()).then(all => all.filter(p => !p.uploaded))
    )
  );
}

export function getPhotosByRecordUid(recordUid) {
  return withRetry(() =>
    storeTx('photos', 'readonly').then(store => {
      const index = store.index('record_uid');
      return promisifyRequest(index.getAll(recordUid));
    })
  );
}

export function markPhotoUploaded(name) {
  return withRetry(() =>
    storeTx('photos', 'readwrite').then(store =>
      promisifyRequest(store.get(name)).then(photo => {
        if (!photo) return;
        photo.uploaded = true;
        return promisifyRequest(store.put(photo));
      })
    )
  );
}

export function deletePhoto(name) {
  return withRetry(() =>
    storeTx('photos', 'readwrite').then(store =>
      promisifyRequest(store.delete(name))
    )
  );
}

export function deletePhotosByRecordUid(recordUid) {
  return withRetry(() =>
    getPhotosByRecordUid(recordUid).then(photos =>
      Promise.all(photos.map(p => deletePhoto(p.name)))
    )
  );
}
