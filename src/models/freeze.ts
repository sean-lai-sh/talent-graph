/**
 * `deepFreeze`, on its own so a leaf module can freeze a spec without
 * importing `registry.ts` — the registry side-effect-imports the model
 * definitions, which reach into `scoring/` and `inference/`.
 *
 * This module imports nothing.
 */

/**
 * Recursively freeze a plain object/array graph. `Object.freeze` is shallow,
 * so a registered spec's nested `weights` would otherwise stay mutable and
 * `isRegisteredSpec` (which compares a spec to its registry entry) could not
 * catch the drift. Functions, Dates, Maps and other exotic objects are left
 * alone; specs contain none.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value as object)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}
