/**
 * Database Management (IndexedDB)
 */

import { DB_NAME, DB_VERSION, STORE_NAME } from './config.js';
import { state } from './state.js';

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      state.db = e.target.result;
      resolve();
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function saveFileToDB(key, file) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getFileFromDB(key) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function removeFileFromDB(key) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
