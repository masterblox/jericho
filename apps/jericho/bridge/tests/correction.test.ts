import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CorrectionConfirmStatus,
  EntityType,
  LifecycleStatus,
  RelationType,
  RiskLevel,
  SourceType,
  type Entity,
  type Provenance,
  type CorrectionConfirmRequest,
} from '@jericho/shared';

import {
  JerichoStore,
} from '../src/core/store.js';
import {
  CanonicalNoteWriter,
} from '../src/correction/note-writer.js';
import {
  createJerichoServer,
  type JerichoServer,
} from '../src/server.js';

const KEY = Buffer.alloc(32, 17);
const TOKEN = 'correction-test-token';
const T0 = '2026-07-12T00:00:00.000Z';
const T1 = '2026-07-12T00:01:00.000Z';
const T2 = '2026-07-12T00:02:00.000Z';

const stores: JerichoStore[] = [];
const servers: JerichoServer[] = [];
const tempDirs: string[] = [];

const CANONICAL_NOTE_CONTENT = `---
jericho_managed: true
person_id: isabella-handel
---
# Isabella Handel

CEO of MasterBlox Capital. Francisco's wife.
`;

const HISTORICAL_SOURCE_CONTENT = `# Francisco's Contact List

Isabella Handel — Francisco's wife. CEO of MasterBlox Capital.
Do not modify this file.`;

function canonicalNoteHash(): string {
  return createHash('sha256').update(CANONICAL_NOTE_CONTENT).digest('hex');
}

function historicalSourceHash(): string {
  return createHash('sha256').update(HISTORICAL_SOURCE_CONTENT).digest('hex');
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function openStore(): JerichoStore {
  const store = new JerichoStore({ path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jericho-correction-'));
  tempDirs.push(dir);
  return dir;
}

function tempVault(): string {
  const vault = join(tempDir(), 'vault');
  mkdirSync(vault, { recursive: true });
  return vault;
}

function writeCanonicalNote(vault: string, content = CANONICAL_NOTE_CONTENT): { relativePath: string; hash: string } {
  const dir = join(vault, 'Prada Mind', '05 - People & Partnerships', 'Team Members');
  mkdirSync(dir, { recursive: true });
  const notePath = join(dir, 'Isabella Handel.md');
  writeFileSync(notePath, content, 'utf8');
  return {
    relativePath: relative(vault, notePath).split(sep).join('/'),
    hash: createHash('sha256').update(content).digest('hex'),
  };
}

function writeHistoricalSource(vault: string): string {
  const srcPath = join(vault, 'Historical Sources', 'Francisco Contact List.md');
  mkdirSync(join(vault, 'Historical Sources'), { recursive: true });
  writeFileSync(srcPath, HISTORICAL_SOURCE_CONTENT, 'utf8');
  return srcPath;
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
    provenance: [],
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function sourceProvenance(): Provenance[] {
  return [
    { source: 'historical-note', sourceType: SourceType.Import, sourceEventId: 'note-v1', observedAt: T0 },
  ];
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `HTTP ${response.status}`));
  return body;
}

describe('spouse_of relation type', () => {
  it('is a member of RelationType enum', () => {
    expect(RelationType.SpouseOf).toBe('spouse_of');
  });
});

describe('CorrectionPreview (store)', () => {
  it('creates preview with disputed claim, source, entity binding, and effects', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] }));

    const preview = store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
      canonicalNoteHash: canonicalNoteHash(),
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    expect(preview.id).toMatch(/^correction-preview-/);
    expect(preview.version).toBe(1);
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.disputedClaim).toBe("Francisco's wife");
    expect(preview.currentIdentityBinding.entityName).toBe('Isabella Handel');
    expect(preview.coreEffects.relationsToCreate[0].type).toBe(RelationType.SpouseOf);
    expect(preview.canonicalNotePath).toContain('Isabella Handel.md');
  });

  it('rejects path traversal', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));
    expect(() => store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: 'x',
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: '../../etc/passwd',
      canonicalNoteHash: canonicalNoteHash(),
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    })).toThrow('Path traversal');
  });
});

describe('Core confirm (store)', () => {
  it('writes symmetric spouse_of relations and identity exclusion', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] }));

    const preview = store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'note.md',
      canonicalNoteHash: canonicalNoteHash(),
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    const result = store.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos',
      toEntityId: 'entity-isabella',
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: canonicalNoteHash(),
      canonicalNotePath: 'note.md',
      obsidianFieldsToAdd: {},
      decidedBy: 'carlos',
      decidedAt: T2,
    });

    expect(result.status).toBe(CorrectionConfirmStatus.Confirmed);
    expect(result.coreReceipt.status).toBe('succeeded');

    const spouses = store.listRelations({ type: RelationType.SpouseOf });
    expect(spouses.length).toBe(2);

    const carlosToIsabella = spouses.find((r) => r.fromEntityId === 'entity-carlos' && r.toEntityId === 'entity-isabella');
    const isabellaToCarlos = spouses.find((r) => r.fromEntityId === 'entity-isabella' && r.toEntityId === 'entity-carlos');
    expect(carlosToIsabella).toBeDefined();
    expect(isabellaToCarlos).toBeDefined();

    const exclusions = store.listIdentityExclusions('entity-isabella');
    expect(exclusions.length).toBe(1);
    expect(exclusions[0].claimPattern).toBe("Francisco's wife");
  });

  it('is idempotent on repeated confirmation', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    const preview = store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'n.md',
      canonicalNoteHash: canonicalNoteHash(),
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    });

    const first = store.confirmCorrection({
      previewId: preview.id, previewHash: preview.previewHash, previewVersion: preview.version,
      entityId: 'entity-isabella', claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella',
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: canonicalNoteHash(), canonicalNotePath: 'n.md',
      obsidianFieldsToAdd: {}, decidedBy: 'carlos', decidedAt: T2,
    });
    expect(first.status).toBe(CorrectionConfirmStatus.Confirmed);
    store.finalizeCorrectionObsidian(first.correctionId, {
      status: 'skipped', notePath: 'n.md', fieldsWritten: [], completedAt: T2,
    });

    const second = store.confirmCorrection({
      previewId: preview.id, previewHash: preview.previewHash, previewVersion: preview.version,
      entityId: 'entity-isabella', claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella',
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: canonicalNoteHash(), canonicalNotePath: 'n.md',
      obsidianFieldsToAdd: {}, decidedBy: 'carlos', decidedAt: T2,
    });
    expect(second.status).toBe(CorrectionConfirmStatus.Idempotent);
    expect(store.listRelations({ type: RelationType.SpouseOf }).length).toBe(2);
  });

  it('rejects stale preview hash', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    const preview = store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'n.md',
      canonicalNoteHash: canonicalNoteHash(),
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    });

    const bogus = createHash('sha256').update('stale').digest('hex');
    expect(() => store.confirmCorrection({
      previewId: preview.id, previewHash: bogus, previewVersion: preview.version,
      entityId: 'entity-isabella', claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella',
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: canonicalNoteHash(), canonicalNotePath: 'n.md',
      obsidianFieldsToAdd: {}, decidedBy: 'carlos', decidedAt: T2,
    })).toThrow('does not match the exact preview');
  });

  it('rejects stale note hash', () => {
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    const preview = store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: sourceProvenance(),
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'n.md',
      canonicalNoteHash: canonicalNoteHash(),
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    });

    const staleNote = createHash('sha256').update('modified').digest('hex');
    expect(() => store.confirmCorrection({
      previewId: preview.id, previewHash: preview.previewHash, previewVersion: preview.version,
      entityId: 'entity-isabella', claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella',
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: staleNote, canonicalNotePath: 'n.md',
      obsidianFieldsToAdd: {}, decidedBy: 'carlos', decidedAt: T2,
    })).toThrow('does not match the exact preview');
  });
});

describe('CanonicalNoteWriter', () => {
  it('adds spouse field to YAML frontmatter via atomic write', () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const writer = new CanonicalNoteWriter({ vaultPath: vault });

    const hashBefore = writer.hashNote(note.relativePath);
    expect(hashBefore).toBe(note.hash);

    const receipt = writer.write({
      relativePath: note.relativePath,
      expectedHash: note.hash,
      fieldsToAdd: { spouse: 'Carlos Prada' },
      now: T2,
    });

    expect(receipt.status).toBe('succeeded');
    expect(receipt.fieldsWritten).toContain('spouse');

    const updated = readFileSync(join(vault, note.relativePath), 'utf8');
    expect(updated).toContain('spouse: Carlos Prada');
    expect(updated).toContain('# Isabella Handel');
    expect(updated).toContain("Francisco's wife");
  });

  it('rejects stale note hash', () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const writer = new CanonicalNoteWriter({ vaultPath: vault });

    const bogusHash = createHash('sha256').update('stale').digest('hex');
    expect(() => writer.write({
      relativePath: note.relativePath,
      expectedHash: bogusHash,
      fieldsToAdd: { spouse: 'Carlos Prada' },
      now: T2,
    })).toThrow('Note hash mismatch');
  });

  it('rejects path traversal', () => {
    const vault = tempVault();
    const writer = new CanonicalNoteWriter({ vaultPath: vault });
    expect(() => writer.hashNote('../../etc/passwd')).toThrow('Path traversal');
  });

  it('is idempotent when field already exists', () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const writer = new CanonicalNoteWriter({ vaultPath: vault });

    const first = writer.write({
      relativePath: note.relativePath,
      expectedHash: note.hash,
      fieldsToAdd: { spouse: 'Carlos Prada' },
      now: T1,
    });
    expect(first.status).toBe('succeeded');

    const secondNoteHash = createHash('sha256').update(readFileSync(join(vault, note.relativePath), 'utf8')).digest('hex');
    const second = writer.write({
      relativePath: note.relativePath,
      expectedHash: secondNoteHash,
      fieldsToAdd: { spouse: 'Carlos Prada' },
      now: T2,
    });
    expect(second.status).toBe('skipped');
  });
});

describe('HTTP correction endpoints with vault', () => {
  it('confirm writes spouse to canonical note and symmetric relations to Core', async () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] }));

    const writer = new CanonicalNoteWriter({ vaultPath: vault });
    const server = await startServer(store, writer);
    const base = `http://localhost:${server.port}`;

    const previewBody = await fetchJson(`${base}/api/v1/corrections/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        sourceProvenance: sourceProvenance(),
        proposedRelationType: 'spouse_of',
        proposedFromEntityId: 'entity-carlos',
        proposedToEntityId: 'entity-isabella',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
        obsidianFieldsToRemove: [],
      }),
    }) as { preview: Record<string, unknown> };

    const preview = previewBody.preview as Record<string, unknown>;
    const confirmBody = await fetchJson(`${base}/api/v1/corrections/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        previewId: preview.id,
        previewHash: preview.previewHash,
        previewVersion: preview.version,
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        fromEntityId: 'entity-carlos',
        toEntityId: 'entity-isabella',
        relationType: 'spouse_of',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      }),
    }) as Record<string, unknown>;

    expect(confirmBody.status).toBe('confirmed');
    expect(confirmBody.coreReceipt).toBeDefined();
    const obs = confirmBody.obsidianReceipt as Record<string, unknown>;
    expect(obs?.status).toBe('succeeded');
    expect(obs?.fieldsWritten).toContain('spouse');

    const updatedNote = readFileSync(join(vault, note.relativePath), 'utf8');
    expect(updatedNote).toContain('spouse: Carlos Prada');

    const spouses = store.listRelations({ type: RelationType.SpouseOf });
    expect(spouses.length).toBe(2);
  });

  it('historical source note stays byte-identical', async () => {
    const vault = tempVault();
    const srcPath = writeHistoricalSource(vault);
    const note = writeCanonicalNote(vault);
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    const writer = new CanonicalNoteWriter({ vaultPath: vault });
    const server = await startServer(store, writer);
    const base = `http://localhost:${server.port}`;

    const previewBody = await fetchJson(`${base}/api/v1/corrections/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        sourceProvenance: sourceProvenance(),
        proposedRelationType: 'spouse_of',
        proposedFromEntityId: 'entity-carlos',
        proposedToEntityId: 'entity-isabella',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
        obsidianFieldsToRemove: [],
      }),
    }) as { preview: Record<string, unknown> };

    const preview = previewBody.preview as Record<string, unknown>;
    await fetchJson(`${base}/api/v1/corrections/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        previewId: preview.id,
        previewHash: preview.previewHash,
        previewVersion: preview.version,
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        fromEntityId: 'entity-carlos',
        toEntityId: 'entity-isabella',
        relationType: 'spouse_of',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      }),
    });

    const srcContent = readFileSync(srcPath, 'utf8');
    expect(srcContent).toBe(HISTORICAL_SOURCE_CONTENT);
    expect(createHash('sha256').update(srcContent).digest('hex')).toBe(historicalSourceHash());
  });

  it('rejects confirmation with stale canonical note hash', async () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    const writer = new CanonicalNoteWriter({ vaultPath: vault });
    const server = await startServer(store, writer);
    const base = `http://localhost:${server.port}`;

    const previewBody = await fetchJson(`${base}/api/v1/corrections/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        sourceProvenance: sourceProvenance(),
        proposedRelationType: 'spouse_of',
        proposedFromEntityId: 'entity-carlos',
        proposedToEntityId: 'entity-isabella',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
        obsidianFieldsToRemove: [],
      }),
    }) as { preview: Record<string, unknown> };

    const preview = previewBody.preview as Record<string, unknown>;
    const staleHash = createHash('sha256').update('stale note').digest('hex');

    await expect(fetchJson(`${base}/api/v1/corrections/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        previewId: preview.id,
        previewHash: preview.previewHash,
        previewVersion: preview.version,
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        fromEntityId: 'entity-carlos',
        toEntityId: 'entity-isabella',
        relationType: 'spouse_of',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: staleHash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      }),
    })).rejects.toThrow('correction_decision_conflict');
  });

  it('repeated confirmation is idempotent', async () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));

    const writer = new CanonicalNoteWriter({ vaultPath: vault });
    const server = await startServer(store, writer);
    const base = `http://localhost:${server.port}`;

    const previewBody = await fetchJson(`${base}/api/v1/corrections/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        sourceProvenance: sourceProvenance(),
        proposedRelationType: 'spouse_of',
        proposedFromEntityId: 'entity-carlos',
        proposedToEntityId: 'entity-isabella',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
        obsidianFieldsToRemove: [],
      }),
    }) as { preview: Record<string, unknown> };

    const preview = previewBody.preview as Record<string, unknown>;
    const first = await fetchJson(`${base}/api/v1/corrections/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        previewId: preview.id, previewHash: preview.previewHash, previewVersion: preview.version,
        entityId: 'entity-isabella', claimPattern: "Francisco's wife",
        fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella',
        relationType: 'spouse_of',
        canonicalNotePath: note.relativePath, canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      }),
    }) as Record<string, unknown>;
    expect(first.status).toBe('confirmed');

    const second = await fetchJson(`${base}/api/v1/corrections/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        previewId: preview.id, previewHash: preview.previewHash, previewVersion: preview.version,
        entityId: 'entity-isabella', claimPattern: "Francisco's wife",
        fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella',
        relationType: 'spouse_of',
        canonicalNotePath: note.relativePath, canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      }),
    }) as Record<string, unknown>;
    expect(second.status).toBe('idempotent');
    expect(store.listRelations({ type: RelationType.SpouseOf }).length).toBe(2);
  });

  it('reports partial completion and retries only the failed note write', async () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));
    const server = await startServer(store, new CanonicalNoteWriter({ vaultPath: vault }));
    const base = `http://localhost:${server.port}`;

    const previewBody = await fetchJson(`${base}/api/v1/corrections/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        entityId: 'entity-isabella', claimPattern: "Francisco's wife",
        sourceProvenance: sourceProvenance(), proposedRelationType: 'spouse_of',
        proposedFromEntityId: 'entity-carlos', proposedToEntityId: 'entity-isabella',
        canonicalNotePath: note.relativePath, canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' }, obsidianFieldsToRemove: [],
      }),
    }) as { preview: Record<string, unknown> };
    const preview = previewBody.preview;
    const confirmPayload = {
      previewId: preview.id, previewHash: preview.previewHash, previewVersion: preview.version,
      entityId: 'entity-isabella', claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella', relationType: 'spouse_of',
      canonicalNotePath: note.relativePath, canonicalNoteHash: note.hash,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
    };

    writeFileSync(join(vault, note.relativePath), `${CANONICAL_NOTE_CONTENT}\nchanged`, 'utf8');
    const partial = await fetchJson(`${base}/api/v1/corrections/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(confirmPayload),
    }) as Record<string, unknown>;
    expect(partial.status).toBe('partial');
    expect((partial.partialCompletion as Record<string, unknown>).retryOnlyNote).toBe(true);
    expect(store.listRelations({ type: RelationType.SpouseOf })).toHaveLength(2);

    writeFileSync(join(vault, note.relativePath), CANONICAL_NOTE_CONTENT, 'utf8');
    const retried = await fetchJson(`${base}/api/v1/corrections/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        correctionId: partial.correctionId,
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
      }),
    }) as Record<string, unknown>;
    expect(retried.status).toBe('confirmed');
    expect((retried.obsidianReceipt as Record<string, unknown>).status).toBe('succeeded');
    expect(readFileSync(join(vault, note.relativePath), 'utf8')).toContain('spouse: Carlos Prada');
    expect(store.listRelations({ type: RelationType.SpouseOf })).toHaveLength(2);
  });

  it('retrieval answers correctly after correction', async () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const store = openStore();
    store.upsertEntity(makeEntity());
    store.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] }));

    const writer = new CanonicalNoteWriter({ vaultPath: vault });
    const server = await startServer(store, writer);
    const base = `http://localhost:${server.port}`;

    const previewBody = await fetchJson(`${base}/api/v1/corrections/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        sourceProvenance: sourceProvenance(),
        proposedRelationType: 'spouse_of',
        proposedFromEntityId: 'entity-carlos',
        proposedToEntityId: 'entity-isabella',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
        obsidianFieldsToRemove: [],
      }),
    }) as { preview: Record<string, unknown> };

    const preview = previewBody.preview as Record<string, unknown>;
    await fetchJson(`${base}/api/v1/corrections/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        previewId: preview.id, previewHash: preview.previewHash, previewVersion: preview.version,
        entityId: 'entity-isabella', claimPattern: "Francisco's wife",
        fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella',
        relationType: 'spouse_of',
        canonicalNotePath: note.relativePath, canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      }),
    });

    const spouses = store.listRelations({ type: RelationType.SpouseOf });
    expect(spouses.some((r) => r.fromEntityId === 'entity-carlos' && r.toEntityId === 'entity-isabella')).toBe(true);
    expect(spouses.some((r) => r.fromEntityId === 'entity-isabella' && r.toEntityId === 'entity-carlos')).toBe(true);

    const exclusions = store.listIdentityExclusions('entity-isabella');
    expect(exclusions.length).toBe(1);
  });

  it('exclusions survive restart and index rebuild', async () => {
    const vault = tempVault();
    const note = writeCanonicalNote(vault);

    const dbPath = join(tempDir(), 'jericho.db');
    const store1 = new JerichoStore({ path: dbPath, key: KEY });
    stores.push(store1);
    store1.upsertEntity(makeEntity());
    store1.upsertEntity(makeEntity({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] }));

    const writer = new CanonicalNoteWriter({ vaultPath: vault });
    const server = await startServer(store1, writer);
    const base = `http://localhost:${server.port}`;

    const previewBody = await fetchJson(`${base}/api/v1/corrections/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        entityId: 'entity-isabella',
        claimPattern: "Francisco's wife",
        sourceProvenance: sourceProvenance(),
        proposedRelationType: 'spouse_of',
        proposedFromEntityId: 'entity-carlos',
        proposedToEntityId: 'entity-isabella',
        canonicalNotePath: note.relativePath,
        canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
        obsidianFieldsToRemove: [],
      }),
    }) as { preview: Record<string, unknown> };

    const preview = previewBody.preview as Record<string, unknown>;
    await fetchJson(`${base}/api/v1/corrections/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        previewId: preview.id, previewHash: preview.previewHash, previewVersion: preview.version,
        entityId: 'entity-isabella', claimPattern: "Francisco's wife",
        fromEntityId: 'entity-carlos', toEntityId: 'entity-isabella',
        relationType: 'spouse_of',
        canonicalNotePath: note.relativePath, canonicalNoteHash: note.hash,
        obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      }),
    });

    store1.close();
    await server.close();

    const store2 = new JerichoStore({ path: dbPath, key: KEY });
    stores.push(store2);
    const exclusions = store2.listIdentityExclusions('entity-isabella');
    expect(exclusions.length).toBe(1);
    expect(exclusions[0].claimPattern).toBe("Francisco's wife");
    expect(store2.listRelations({ type: RelationType.SpouseOf }).length).toBe(2);
  });
});

async function startServer(store: JerichoStore, writer: CanonicalNoteWriter): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createJerichoServer({
    store,
    apiToken: TOKEN,
    host: '127.0.0.1',
    correctionNoteWriter: writer,
  });
  const addr = await server.listen(0, '127.0.0.1');
  servers.push(server);
  return { port: addr.port, close: () => server.close() };
}
