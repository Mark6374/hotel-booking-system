import { useSyncExternalStore } from 'react';
import { getAuth, subscribeAuth } from '../auth.js';

/* { accounts, me } – re-renders when anyone logs in/out or accounts change. */
export function useAuth() {
  return useSyncExternalStore(subscribeAuth, getAuth);
}
