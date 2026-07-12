import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CorrectionConfirmStatus,
  DecisionOutcome,
  EntityType,
  LifecycleStatus,
  RelationType,
  RiskLevel,
  RouteType,
  SourceType,
  type Entity,
  type Provenance,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';

const KEY = Buffer.alloc(32, 17);
const T0 = '2026-07-12T00:00:00.000Z';
const T1 = '2026-07-12T00:01:00.000Z';
const T2 = '2026-07-12T00:02:00.000Z';

const openStores: JerichoStore[] = [];
const tempDirectories: string[] = [];

const CANONICAL_NOTE_CONTENT = `---
jericho_managed: true
person_id: isabella-handel
---
# Isabella Handel

CEO of MasterBlox Capital. Francisco's wife.
`;

const CANONICAL_NOTE_HASH = createHash('sha256').update(CANONICAL_NOTE_CONTENT).digest('hex');

afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
  for (const dir of tempDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function openStore(path = ':memory:'): JerichoStore {
  const store = new JerichoStore({ path, key: KEY });
  openStores.push(store);
  return store;
}

function tempVaultDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jericho-correction-vault-'));
  tempDirectories.push(dir);
  mkdirSync(join(dir, 'Prada Mind', '05 - People & Partnerships', 'Team Members'), { recursive: true });
  return dir;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jericho-correction-'));
  tempDirectories.push(dir);
  return join(dir, 'jericho.db');
}

function writeCanonicalNote(vaultDir: string): { path: string; hash: string } {
  const noteDir = join(vaultDir, 'Prada Mind', '05 - People & Partnerships', 'Team Members');
  const notePath = join(noteDir, 'Isabella Handel.md');
  writeFileSync(notePath, CANONICAL_NOTE_CONTENT, 'utf8');
  return {
    path: notePath,
    hash: createHash('sha256').update(CANONICAL_NOTE_CONTENT).digest('hex'),
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'entity-isabella',
    type: EntityType.Person,
    canonicalName: 'Isabella Handel',
    aliases: ['Isabella', "Francisco's wife"],
    attributes: { role: 'CEO' },
    status: LifecycleStatus.Active,
    risk: RiskLevel.Low,
    confidence: 0.95,
    freshness: { observedAt: T0 },
    provenance: [
      { source: 'user', sourceType: SourceType.User, observedAt: T0 },
    ],
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function sourceProvenance(): Provenance[] {
  return [
    { source: 'historical-note', sourceType: SourceType.Import, sourceEventId: 'note-v1', observedAt: T0 },
    { source: 'local:command-center', sourceType: SourceType.User, sourceEventId: 'correction-request', observedAt: T1 },
  ];
}

describe('spouse_of relation type', () => {
  it('is a valid RelationType enum value', () => {
    expect(RelationType.SpouseOf).toBe('spouse_of');
    expect(Object.values(RelationType)).toContain('spouse_of');
  });
});

describe('CorrectionPreview', () => {
  it('creates a preview with disputed claim, source, entity binding, and effects', () => {
    const store = openStore();
    const isabella = makeEntity();
    const carlos = makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] });
    store.upsertEntity(isabella);
    store.upsertEntity(carlos);

    const preview = store.createCorrectionPreview({
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: carlos.id,
      proposedToEntityId: isabella.id,
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: ["Francisco's wife"],
    });

    expect(preview.id).toMatch(/^correction-preview-/);
    expect(preview.version).toBe(1);
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.disputedClaim).toBe("Francisco's wife");
    expect(preview.sourceProvenance).toEqual(sourceProvenance());
    expect(preview.currentIdentityBinding).toMatchObject({
      entityId: isabella.id,
      entityName: 'Isabella Handel',
      entityType: EntityType.Person,
    });
    expect(preview.proposedExclusion.entityId).toBe(isabella.id);
    expect(preview.proposedExclusion.claimPattern).toBe("Francisco's wife");
    expect(preview.coreEffects.relationsToCreate).toHaveLength(1);
    expect(preview.coreEffects.relationsToCreate[0]).toMatchObject({
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      type: RelationType.SpouseOf,
    });
    expect(preview.coreEffects.exclusionsToApply).toHaveLength(1);
    expect(preview.obsidianEffects.notePath).toContain('Isabella Handel.md');
    expect(preview.obsidianEffects.noteHash).toBe(CANONICAL_NOTE_HASH);
    expect(preview.obsidianEffects.fieldsToAdd).toEqual({ spouse: 'Carlos Prada' });
    expect(preview.canonicalNotePath).toContain('Isabella Handel.md');
  });

  it('rejects a non-Person entity', () => {
    const store = openStore();
    store.upsertEntity(makeEntity({ id: 'org-1', type: EntityType.Organization, canonicalName: 'Acme' }));
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    expect(() => store.createCorrectionPreview({
      entityId: 'org-1',
      claimPattern: 'claim',
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'org-1',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'note.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    })).toThrow('must be a Person');
  });

  it('rejects empty claim pattern', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    expect(() => store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: '  ',
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'note.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    })).toThrow('Claim pattern is required');
  });

  it('rejects path traversal in canonical note path', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    expect(() => store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: '../../etc/passwd',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    })).toThrow('Path traversal');
  });

  it('rejects absolute path', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    expect(() => store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: '/etc/passwd',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    })).toThrow('Path must be relative');
  });
});

describe('Correction confirm', () => {
  it('confirms a correction, writes spouse_of relation and identity exclusion', () => {
    const store = openStore();
    const isabella = makeEntity();
    const carlos = makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] });
    store.upsertEntity(isabella);
    store.upsertEntity(carlos);

    const preview = store.createCorrectionPreview({
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: carlos.id,
      proposedToEntityId: isabella.id,
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: ["Francisco's wife"],
    });

    const result = store.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      canonicalNotePath: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      decidedBy: 'carlos',
      decidedAt: T2,
    });

    expect(result.status).toBe(CorrectionConfirmStatus.Confirmed);
    expect(result.correctionId).toMatch(/^correction-/);
    expect(result.coreReceipt.status).toBe('succeeded');
    expect(result.coreReceipt.relationsCreated.length).toBeGreaterThan(0);
    expect(result.obsidianReceipt.status).toBe('succeeded');

    const spouseRelations = store.listRelations({ type: RelationType.SpouseOf });
    expect(spouseRelations.length).toBeGreaterThanOrEqual(1);
    const spouse = spouseRelations[0];
    expect(spouse.fromEntityId).toBe(carlos.id);
    expect(spouse.toEntityId).toBe(isabella.id);

    const exclusions = store.listIdentityExclusions(isabella.id);
    expect(exclusions.length).toBe(1);
    expect(exclusions[0].claimPattern).toBe("Francisco's wife");
  });

  it('is idempotent on repeated confirmation', () => {
    const store = openStore();
    const isabella = makeEntity();
    const carlos = makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] });
    store.upsertEntity(isabella);
    store.upsertEntity(carlos);

    const preview = store.createCorrectionPreview({
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: carlos.id,
      proposedToEntityId: isabella.id,
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'note.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    const first = store.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      canonicalNotePath: 'note.md',
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      decidedBy: 'carlos',
      decidedAt: T2,
    });
    expect(first.status).toBe(CorrectionConfirmStatus.Confirmed);

    const second = store.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      canonicalNotePath: 'note.md',
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      decidedBy: 'carlos',
      decidedAt: T2,
    });
    expect(second.status).toBe(CorrectionConfirmStatus.Idempotent);

    const exclusions = store.listIdentityExclusions(isabella.id);
    expect(exclusions.length).toBe(1);
    const spouseRelations = store.listRelations({ type: RelationType.SpouseOf });
    expect(spouseRelations.length).toBe(1);
  });

  it('rejects stale preview hash', () => {
    const store = openStore();
    const isabella = makeEntity();
    const carlos = makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] });
    store.upsertEntity(isabella);
    store.upsertEntity(carlos);

    const preview = store.createCorrectionPreview({
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: carlos.id,
      proposedToEntityId: isabella.id,
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'note.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    });

    const bogusHash = createHash('sha256').update('stale').digest('hex');

    expect(() => store.confirmCorrection({
      previewId: preview.id,
      previewHash: bogusHash,
      previewVersion: preview.version,
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      canonicalNotePath: 'note.md',
      obsidianFieldsToAdd: {},
      decidedBy: 'carlos',
      decidedAt: T2,
    })).toThrow('does not match the exact preview');
  });

  it('rejects stale note hash', () => {
    const store = openStore();
    const isabella = makeEntity();
    const carlos = makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] });
    store.upsertEntity(isabella);
    store.upsertEntity(carlos);

    const preview = store.createCorrectionPreview({
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: carlos.id,
      proposedToEntityId: isabella.id,
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'note.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    });

    const staleNoteHash = createHash('sha256').update('modified note').digest('hex');

    expect(() => store.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: staleNoteHash,
      canonicalNotePath: 'note.md',
      obsidianFieldsToAdd: {},
      decidedBy: 'carlos',
      decidedAt: T2,
    })).toThrow('does not match the exact preview');
  });
});

describe('Identity exclusions persist across restarts', () => {
  it('survives close and reopen', () => {
    const path = tempDbPath();
    const store1 = openStore(path);
    const isabella = makeEntity();
    const carlos = makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] });
    store1.upsertEntity(isabella);
    store1.upsertEntity(carlos);

    const preview = store1.createCorrectionPreview({
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: carlos.id,
      proposedToEntityId: isabella.id,
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'note.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    });

    store1.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      canonicalNotePath: 'note.md',
      obsidianFieldsToAdd: {},
      decidedBy: 'carlos',
      decidedAt: T2,
    });
    store1.close();

    const store2 = openStore(path);
    const exclusions = store2.listIdentityExclusions(isabella.id);
    expect(exclusions.length).toBe(1);
    expect(exclusions[0].claimPattern).toBe("Francisco's wife");

    const spouseRelations = store2.listRelations({ type: RelationType.SpouseOf });
    expect(spouseRelations.length).toBe(1);
  });
});

describe('Historical source note preservation', () => {
  it('preserves historical note content - correction does not modify the source file', () => {
    const vaultDir = tempVaultDir();
    const note = writeCanonicalNote(vaultDir);

    const currentContent = readFileSync(note.path, 'utf8');
    expect(currentContent).toBe(CANONICAL_NOTE_CONTENT);
    expect(currentContent).toContain("Francisco's wife");

    const store = openStore();
    const isabella = makeEntity();
    const carlos = makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] });
    store.upsertEntity(isabella);
    store.upsertEntity(carlos);

    const relativePath = 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md';

    const preview = store.createCorrectionPreview({
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: carlos.id,
      proposedToEntityId: isabella.id,
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: relativePath,
      canonicalNoteHash: note.hash,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: ["Francisco's wife"],
    });

    store.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: note.hash,
      canonicalNotePath: relativePath,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      decidedBy: 'carlos',
      decidedAt: T2,
    });

    const finalContent = readFileSync(note.path, 'utf8');
    expect(finalContent).toBe(CANONICAL_NOTE_CONTENT);
    expect(finalContent).toContain("Francisco's wife");
  });
});

describe('Correction retrieval correctness', () => {
  it('answers correctly after correction', () => {
    const store = openStore();
    const isabella = makeEntity();
    const carlos = makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] });
    store.upsertEntity(isabella);
    store.upsertEntity(carlos);

    const preview = store.createCorrectionPreview({
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: carlos.id,
      proposedToEntityId: isabella.id,
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'note.md',
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    });

    store.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: isabella.id,
      claimPattern: "Francisco's wife",
      fromEntityId: carlos.id,
      toEntityId: isabella.id,
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: CANONICAL_NOTE_HASH,
      canonicalNotePath: 'note.md',
      obsidianFieldsToAdd: {},
      decidedBy: 'carlos',
      decidedAt: T2,
    });

    const spouseRelations = store.listRelations({ type: RelationType.SpouseOf });
    expect(spouseRelations.some((r) =>
      r.fromEntityId === carlos.id && r.toEntityId === isabella.id,
    )).toBe(true);

    const worksForRelations = store.listRelations({ fromEntityId: isabella.id, type: RelationType.WorksFor });
    // WorksFor should still be queryable
    expect(Array.isArray(worksForRelations)).toBe(true);

    const exclusions = store.listIdentityExclusions(isabella.id);
    expect(exclusions.length).toBe(1);
  });
});
