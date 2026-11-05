import { useSyncExternalStore } from 'react';
import { getDb, subscribe } from '../db.js';

/* Re-renders the calling component whenever db.js mutates and saves. */
export function useDb() {
  return useSyncExternalStore(subscribe, getDb);
}
