import { getRandomValues } from 'expo-crypto';
import { makeUuidv7 } from './uuid';

/** Phones: random bytes from the OS through expo-crypto (Hermes may lack crypto.getRandomValues). */
export const uuidv7 = (now = Date.now()) => makeUuidv7(now, (b) => void getRandomValues(b));
