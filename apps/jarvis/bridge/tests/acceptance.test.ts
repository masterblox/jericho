import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CorrectionConfirmStatus,
  EntityType,
  LifecycleStatus,
  RelationType,
  RiskLevel,
  SourceType,
} from '@jericho/shared';

import { JerichoStore } from '../src/core/store.js';
import { CanonicalNoteWriter } from '../src/correction/note-writer.js';
import { createJerichoServer, type JerichoServer } from '../src/server.js';
import { groupIdentityEvidence } from '../src/retrieval/identity-aware.js';
import { saveVoicePreset, loadVoicePreset, resolvePresentationVoice } from '../src/voice/voice-preference.js';

const KEY = Buffer.alloc(32, 17);
const TOKEN = 'acceptance-test-token';
const T0 = '2026-07-12T00:00:00.000Z';

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

const stores: JerichoStore[] = [];
const servers: JerichoServer[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function openStore(path?: string): JerichoStore {
  const store = new JerichoStore(path ? { path, key: KEY } : { path: ':memory:', key: KEY });
  stores.push(store);
  return store;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jericho-accept-'));
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

async function startServer(store: JerichoStore, vault: string): Promise<{ url: string; close(): Promise<void> }> {
  const writer = new CanonicalNoteWriter({ vaultPath: vault });
  const server = createJerichoServer({
    store,
    apiToken: TOKEN,
    host: '127.0.0.1',
    correctionNoteWriter: writer,
    obsidianOpen: {
      async open(relativePath: string) {
        return { relativePath };
      },
    },
  });
  servers.push(server);
  const address = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    async close() {
      await server.close();
    },
  };
}

async function postJson(url: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json;
}

function makeIsabellaEntity() {
  return {
    id: 'entity-isabella', type: EntityType.Person, canonicalName: 'Isabella Handel',
    aliases: ['Isabella', "Francisco's wife"], attributes: { role: 'CEO' },
    status: LifecycleStatus.Active, risk: RiskLevel.Low, confidence: 0.95,
    freshness: { observedAt: T0 }, provenance: [], createdAt: T0, updatedAt: T0,
  };
}

function makeCarlosEntity() {
  return {
    id: 'entity-carlos', type: EntityType.Person, canonicalName: 'Carlos Prada',
    aliases: ['Carlos'], attributes: {},
    status: LifecycleStatus.Active, risk: RiskLevel.Low, confidence: 0.95,
    freshness: { observedAt: T0 }, provenance: [], createdAt: T0, updatedAt: T0,
  };
}

// ═══════════════════════════════════════════════════════════════════
describe('Jericho integration acceptance', () => {
  // ── 1-4. Correction preview + confirm + spouse_of + exclusion ──
  it('creates correction preview and confirms with symmetric spouse_of and identity exclusion', async () => {
    const store = openStore();
    store.upsertEntity(makeIsabellaEntity());
    store.upsertEntity(makeCarlosEntity());

    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    writeHistoricalSource(vault);

    const server = await startServer(store, vault);

    // 1. Preview
    const preview = await postJson(server.url, '/api/v1/corrections/preview', {
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: [{
        source: 'historical-note', sourceType: 'import', sourceEventId: 'note-v1', observedAt: T0,
      }],
      proposedRelationType: 'spouse_of',
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      canonicalNotePath: note.relativePath,
      canonicalNoteHash: note.hash,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    expect(preview.preview).toBeDefined();
    expect(preview.preview.id).toMatch(/^correction-preview-/);
    expect(preview.preview.disputedClaim).toBe("Francisco's wife");
    expect(preview.preview.currentIdentityBinding.entityName).toBe('Isabella Handel');
    expect(preview.preview.coreEffects.relationsToCreate[0].type).toBe('spouse_of');
    expect(preview.preview.proposedExclusion.claimPattern).toBe("Francisco's wife");

    // 2. Confirm
    const result = await postJson(server.url, '/api/v1/corrections/confirm', {
      previewId: preview.preview.id,
      previewHash: preview.preview.previewHash,
      previewVersion: preview.preview.version,
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos',
      toEntityId: 'entity-isabella',
      relationType: 'spouse_of',
      canonicalNoteHash: note.hash,
      canonicalNotePath: note.relativePath,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
    });

    expect(result.status).toBe('confirmed');
    expect(result.correctionId).toMatch(/^correction-/);

    // 3. Two symmetric spouse_of relations
    expect(result.coreReceipt.status).toBe('succeeded');
    expect(result.coreReceipt.relationsCreated.length).toBe(2);
    const spouses = store.listRelations({ type: RelationType.SpouseOf });
    expect(spouses.length).toBe(2);
    expect(spouses.find(r => r.fromEntityId === 'entity-carlos' && r.toEntityId === 'entity-isabella')).toBeDefined();
    expect(spouses.find(r => r.fromEntityId === 'entity-isabella' && r.toEntityId === 'entity-carlos')).toBeDefined();

    // 4. Immutable identity exclusion
    expect(result.coreReceipt.exclusionsApplied.length).toBe(1);
    const exclusions = store.listIdentityExclusions('entity-isabella');
    expect(exclusions.length).toBe(1);
    expect(exclusions[0].claimPattern).toBe("Francisco's wife");

    await server.close();
  });

  // ── 5. Canonical note contains spouse: Carlos Prada ──
  it('writes spouse: Carlos Prada into the canonical note', async () => {
    const store = openStore();
    store.upsertEntity(makeIsabellaEntity());
    store.upsertEntity(makeCarlosEntity());

    const vault = tempVault();
    const note = writeCanonicalNote(vault);

    const server = await startServer(store, vault);
    const preview = await postJson(server.url, '/api/v1/corrections/preview', {
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: [{ source: 'historical-note', sourceType: 'import', sourceEventId: 'note-v1', observedAt: T0 }],
      proposedRelationType: 'spouse_of',
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      canonicalNotePath: note.relativePath,
      canonicalNoteHash: note.hash,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    await postJson(server.url, '/api/v1/corrections/confirm', {
      previewId: preview.preview.id,
      previewHash: preview.preview.previewHash,
      previewVersion: preview.preview.version,
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos',
      toEntityId: 'entity-isabella',
      relationType: 'spouse_of',
      canonicalNoteHash: note.hash,
      canonicalNotePath: note.relativePath,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
    });

    // 5. Canonical note contains spouse: Carlos Prada
    const updatedNote = readFileSync(join(vault, note.relativePath), 'utf8');
    expect(updatedNote).toContain('spouse: Carlos Prada');
    // Original content is preserved
    expect(updatedNote).toContain('# Isabella Handel');
    expect(updatedNote).toContain("Francisco's wife");

    await server.close();
  });

  // ── 6. Historical source note remains byte-identical ──
  it('preserves the historical source note byte-identical after correction', async () => {
    const store = openStore();
    store.upsertEntity(makeIsabellaEntity());
    store.upsertEntity(makeCarlosEntity());

    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const srcPath = writeHistoricalSource(vault);
    const srcContent = readFileSync(srcPath, 'utf8');
    const srcHash = historicalSourceHash();

    const server = await startServer(store, vault);
    const preview = await postJson(server.url, '/api/v1/corrections/preview', {
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: [{ source: 'historical-note', sourceType: 'import', sourceEventId: 'note-v1', observedAt: T0 }],
      proposedRelationType: 'spouse_of',
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      canonicalNotePath: note.relativePath,
      canonicalNoteHash: note.hash,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    await postJson(server.url, '/api/v1/corrections/confirm', {
      previewId: preview.preview.id,
      previewHash: preview.preview.previewHash,
      previewVersion: preview.preview.version,
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos',
      toEntityId: 'entity-isabella',
      relationType: 'spouse_of',
      canonicalNoteHash: note.hash,
      canonicalNotePath: note.relativePath,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
    });

    // Historical source is untouched
    const srcAfter = readFileSync(srcPath, 'utf8');
    expect(srcAfter).toBe(HISTORICAL_SOURCE_CONTENT);
    const srcHashAfter = createHash('sha256').update(srcAfter).digest('hex');
    expect(srcHashAfter).toBe(srcHash);

    await server.close();
  });

  // ── 7. Core and Obsidian receipts are real correction receipts ──
  it('returns real correction receipts — not manual captures', async () => {
    const store = openStore();
    store.upsertEntity(makeIsabellaEntity());
    store.upsertEntity(makeCarlosEntity());

    const vault = tempVault();
    const note = writeCanonicalNote(vault);

    const server = await startServer(store, vault);
    const preview = await postJson(server.url, '/api/v1/corrections/preview', {
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: [{ source: 'historical-note', sourceType: 'import', sourceEventId: 'note-v1', observedAt: T0 }],
      proposedRelationType: 'spouse_of',
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      canonicalNotePath: note.relativePath,
      canonicalNoteHash: note.hash,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    const result = await postJson(server.url, '/api/v1/corrections/confirm', {
      previewId: preview.preview.id,
      previewHash: preview.preview.previewHash,
      previewVersion: preview.preview.version,
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos',
      toEntityId: 'entity-isabella',
      relationType: 'spouse_of',
      canonicalNoteHash: note.hash,
      canonicalNotePath: note.relativePath,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
    });

    // Core receipt is an actual correction receipt
    expect(result.coreReceipt).toBeDefined();
    expect(result.coreReceipt.correctionId).toBe(result.correctionId);
    expect(result.coreReceipt.status).toBe('succeeded');
    expect(result.coreReceipt.relationsCreated).toHaveLength(2);
    result.coreReceipt.relationsCreated.forEach((id: string) => {
      expect(id).toMatch(/^relation-spouse-/);
    });
    expect(result.coreReceipt.exclusionsApplied).toHaveLength(1);
    expect(result.coreReceipt.exclusionsApplied[0] as string).toMatch(/^identity-exclusion-/);

    // Obsidian receipt is an actual note-write receipt
    expect(result.obsidianReceipt).toBeDefined();
    expect(result.obsidianReceipt.status).toBe('succeeded');
    expect(result.obsidianReceipt.fieldsWritten).toContain('spouse');

    await server.close();
  });

  // ── 8-9. Force note-write failure + retry only note ──
  it('handles partial completion: note-write failure then retry only note without duplicates', async () => {
    const store = openStore();
    store.upsertEntity(makeIsabellaEntity());
    store.upsertEntity(makeCarlosEntity());

    const vault = tempVault();
    const note = writeCanonicalNote(vault);
    const originalHash = note.hash;

    const server = await startServer(store, vault);
    const preview = await postJson(server.url, '/api/v1/corrections/preview', {
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: [{ source: 'historical-note', sourceType: 'import', sourceEventId: 'note-v1', observedAt: T0 }],
      proposedRelationType: 'spouse_of',
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      canonicalNotePath: note.relativePath,
      canonicalNoteHash: originalHash,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    // Modify note to cause hash mismatch
    writeFileSync(join(vault, note.relativePath), `${CANONICAL_NOTE_CONTENT}\nchanged`, 'utf8');

    const partial = await postJson(server.url, '/api/v1/corrections/confirm', {
      previewId: preview.preview.id,
      previewHash: preview.preview.previewHash,
      previewVersion: preview.preview.version,
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos',
      toEntityId: 'entity-isabella',
      relationType: 'spouse_of',
      canonicalNoteHash: originalHash, // stale hash — note was changed
      canonicalNotePath: note.relativePath,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
    });

    // 8. Partial completion: core succeeded, note failed
    expect(partial.status).toBe('partial');
    expect(partial.coreReceipt.status).toBe('succeeded');
    expect(partial.partialCompletion).toBeDefined();
    expect(partial.partialCompletion.obsidianReceipt.status).toBe('failed');
    expect(partial.partialCompletion.allowsRetry).toBe(true);
    expect(partial.partialCompletion.retryOnlyNote).toBe(true);

    // Core relations and exclusion already written
    const spousesAfterPartial = store.listRelations({ type: RelationType.SpouseOf });
    expect(spousesAfterPartial.length).toBe(2);
    const exclusionsAfterPartial = store.listIdentityExclusions('entity-isabella');
    expect(exclusionsAfterPartial.length).toBe(1);

    // 9. Retry only the note — restore content and compute new hash
    writeFileSync(join(vault, note.relativePath), CANONICAL_NOTE_CONTENT, 'utf8');
    const restoredHash = createHash('sha256').update(CANONICAL_NOTE_CONTENT).digest('hex');

    const retry = await postJson(server.url, '/api/v1/corrections/retry', {
      correctionId: partial.correctionId,
      canonicalNoteHash: restoredHash,
      canonicalNotePath: note.relativePath,
    });

    expect(retry.status).toBe('confirmed');
    expect(retry.coreReceipt.status).toBe('succeeded');
    expect(retry.obsidianReceipt.status).toBe('succeeded');
    expect(retry.obsidianReceipt.fieldsWritten).toContain('spouse');

    // No duplicate relations or exclusions
    const spousesFinal = store.listRelations({ type: RelationType.SpouseOf });
    expect(spousesFinal.length).toBe(2);
    const exclusionsFinal = store.listIdentityExclusions('entity-isabella');
    expect(exclusionsFinal.length).toBe(1);

    // Note now has the correction
    const updatedNote = readFileSync(join(vault, note.relativePath), 'utf8');
    expect(updatedNote).toContain('spouse: Carlos Prada');

    await server.close();
  });

  // ── 10. Restart persistence: receipts + correction survive ──
  it('persists correction receipts and relations across store restart', async () => {
    const tempDb = tempDir();
    const dbPath = join(tempDb, 'jericho.db');

    const store1 = openStore(dbPath);
    store1.upsertEntity(makeIsabellaEntity());
    store1.upsertEntity(makeCarlosEntity());

    const vault = tempVault();
    const note = writeCanonicalNote(vault);

    const server1 = await startServer(store1, vault);
    const preview = await postJson(server1.url, '/api/v1/corrections/preview', {
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      sourceProvenance: [{ source: 'historical-note', sourceType: 'import', sourceEventId: 'note-v1', observedAt: T0 }],
      proposedRelationType: 'spouse_of',
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      canonicalNotePath: note.relativePath,
      canonicalNoteHash: note.hash,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
      obsidianFieldsToRemove: [],
    });

    const result = await postJson(server1.url, '/api/v1/corrections/confirm', {
      previewId: preview.preview.id,
      previewHash: preview.preview.previewHash,
      previewVersion: preview.preview.version,
      entityId: 'entity-isabella',
      claimPattern: "Francisco's wife",
      fromEntityId: 'entity-carlos',
      toEntityId: 'entity-isabella',
      relationType: 'spouse_of',
      canonicalNoteHash: note.hash,
      canonicalNotePath: note.relativePath,
      obsidianFieldsToAdd: { spouse: 'Carlos Prada' },
    });

    const correctionId = result.correctionId;
    const coreReceiptId = result.coreReceipt.id;
    expect(correctionId).toBeTruthy();
    expect(coreReceiptId).toBeTruthy();
    // Verify the first confirm actually wrote the note
    expect(result.status).toBe('confirmed');

    await server1.close();
    store1.close();

    // Restart with same DB
    const store2 = openStore(dbPath);
    const server2 = await startServer(store2, vault);

    // Correction persisted
    const spouses = store2.listRelations({ type: RelationType.SpouseOf });
    expect(spouses.length).toBe(2);
    const exclusions = store2.listIdentityExclusions('entity-isabella');
    expect(exclusions.length).toBe(1);
    expect(exclusions[0].claimPattern).toBe("Francisco's wife");

    // Note content persisted
    const persistedNote = readFileSync(join(vault, note.relativePath), 'utf8');
    expect(persistedNote).toContain('spouse: Carlos Prada');

    await server2.close();
    store2.close();
  });

  // ── 11. Identity-aware retrieval resolves Isabella without inventing spouse claims ──
  it('retrieval resolves Isabella Handel with MasterBlox employment and excludes Francisco-wife evidence', () => {
    const result = groupIdentityEvidence('Isabella', [
      {
        path: 'Prada Mind/05 - People & Partnerships/Team Members/Isabella Handel.md',
        title: 'Isabella Handel',
        excerpt: 'Isabella Handel works at MasterBlox and is married to Carlos Prada.',
        score: 0.97,
      },
      {
        path: 'Sessions/Francisco-notes.md',
        title: 'Francisco session',
        excerpt: 'Isabella is Francisco\'s wife and works elsewhere.',
        score: 0.8,
      },
    ]);

    expect(result.retrievalCount).toBe(1);
    expect(result.resolved).toBeDefined();
    expect(result.resolved!.fullName).toBe('Isabella Handel');
    expect(result.resolved!.canonical).toBe(true);
    expect(result.resolved!.employment).toContain('MasterBlox');
    expect(result.resolved!.relationshipToCarlos).toBeUndefined();

    // Ambiguous first-name-only hit excluded
    expect(result.excluded.length).toBe(1);
    expect(result.excluded[0].ambiguous).toBe(true);
  });

  // ── 12. Voice preference preview → confirm → persistence ──
  it('saves, loads, and resolves voice calibration preferences', () => {
    const voiceDir = tempDir();
    const prefPath = join(voiceDir, 'voice-pref.json');

    // Default fallback when no preset exists
    expect(resolvePresentationVoice({ preferencePath: prefPath, configuredVoice: 'Fenrir' })).toBe('Fenrir');
    expect(resolvePresentationVoice({ preferencePath: prefPath })).toBe('Algieba');

    // Save a voice preset
    const saved = saveVoicePreset(prefPath, 'Orus', '2026-07-12T10:00:00.000Z');
    expect(saved.voice).toBe('Orus');
    expect(saved.confirmedAt).toBe('2026-07-12T10:00:00.000Z');

    // Load it back
    const loaded = loadVoicePreset(prefPath);
    expect(loaded).toBeDefined();
    expect(loaded!.voice).toBe('Orus');

    // Resolve picks saved preset over configured fallback
    expect(resolvePresentationVoice({ preferencePath: prefPath, configuredVoice: 'Fenrir' })).toBe('Orus');

    // Validate that an unsupported voice is rejected on save
    expect(() => saveVoicePreset(prefPath, 'NotARealVoice', 'now')).toThrow('unsupported_voice');
  });

  // ── 13. RAG evidence requires resolved Isabella — empty is failure ──
  it('rejects empty results as insufficient RAG evidence', () => {
    const result = groupIdentityEvidence('Isabella', []);
    // No hits at all: no resolved, no excluded
    expect(result.resolved).toBeUndefined();
    expect(result.excluded.length).toBe(0);

    // First-name-only "Isabella" mention without full canonical name:
    // excluded as ambiguous, never resolved
    const firstNameOnly = groupIdentityEvidence('Isabella', [
      { path: 'notes/other.md', title: 'Other', excerpt: 'Nothing about Isabella here.', score: 0.9 },
    ]);
    expect(firstNameOnly.resolved).toBeUndefined();
    expect(firstNameOnly.excluded.length).toBe(1);
    expect(firstNameOnly.excluded[0].ambiguous).toBe(true);
  });
});
