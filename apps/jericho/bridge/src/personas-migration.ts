/**
 * Bounded one-window legacy persona migration.
 *
 * The active product emits only `jericho`. This parser alone may recognize the
 * historical persisted value and immediately rewrite it. Do not reuse the
 * legacy literal elsewhere.
 */

import type { PersonaMode } from './personas.js';

const LEGACY_PERSONA_MODE = 'jarvis' as const;

/**
 * Normalize a persisted or configured persona mode.
 * Legacy `jarvis` rewrites to `jericho`; unknown values return undefined.
 */
export function migratePersonaMode(value: unknown): PersonaMode | undefined {
  if (value === 'jericho' || value === 'megatron') return value;
  if (value === LEGACY_PERSONA_MODE) return 'jericho';
  return undefined;
}

/** Test/helper export — exposes the allowlisted legacy literal for fixtures. */
export function legacyPersonaModeLiteralForMigrationTests(): typeof LEGACY_PERSONA_MODE {
  return LEGACY_PERSONA_MODE;
}
