import { describe, expect, it } from 'vitest';

import {
  legacyPersonaModeLiteralForMigrationTests,
  migratePersonaMode,
} from '../src/personas-migration.js';

describe('legacy persona mode migration', () => {
  it('rewrites the allowlisted legacy persona value to jericho', () => {
    const legacy = legacyPersonaModeLiteralForMigrationTests();
    expect(legacy).toBe('jarvis');
    expect(migratePersonaMode(legacy)).toBe('jericho');
  });

  it('passes through active persona modes unchanged', () => {
    expect(migratePersonaMode('jericho')).toBe('jericho');
    expect(migratePersonaMode('megatron')).toBe('megatron');
  });

  it('rejects unknown values', () => {
    expect(migratePersonaMode('HAL')).toBeUndefined();
    expect(migratePersonaMode(null)).toBeUndefined();
    expect(migratePersonaMode(1)).toBeUndefined();
  });
});
