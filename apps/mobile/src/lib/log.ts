// Step-by-step console logs: Metro terminal (phone) or browser console (web).
// On by default in development; set EXPO_PUBLIC_DEBUG_LOGS=1 to keep them in a release build, =0 to silence.

const started = Date.now();
const enabled =
  process.env.EXPO_PUBLIC_DEBUG_LOGS === '1' || (process.env.EXPO_PUBLIC_DEBUG_LOGS !== '0' && typeof __DEV__ !== 'undefined' && __DEV__);

function stamp(scope: string) {
  return `[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s][${scope}]`;
}

export function log(scope: string, message: string, data?: unknown) {
  if (!enabled) return;
  if (data === undefined) console.log(`${stamp(scope)} ${message}`);
  else console.log(`${stamp(scope)} ${message}`, data);
}

export function logError(scope: string, message: string, error: unknown) {
  console.warn(`${stamp(scope)} ✖ ${message}`, error instanceof Error ? error.message : error);
}
