import { getRandomValues } from 'expo-crypto';
import { uuidv7 as make } from './ids';

/** Phones: random bytes from the OS through expo-crypto (Hermes may lack crypto.getRandomValues). */
export const uuidv7 = (now = Date.now()) => make(now, (b) => void getRandomValues(b));
