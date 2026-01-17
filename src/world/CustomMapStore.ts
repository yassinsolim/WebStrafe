import { openDB } from 'idb';
import type { CustomMapRecord } from './types';

const DB_NAME = 'webstrafe-db';
const STORE_NAME = 'custom-maps';
const DB_VERSION = 1;

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
}

export async function listCustomMaps(): Promise<CustomMapRecord[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function saveCustomMap(record: CustomMapRecord): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, record);
}

export async function deleteCustomMap(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}
