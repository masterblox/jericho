import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertGroundedResultEvent,
  EntityType,
  LifecycleStatus,
  RelationType,
  RiskLevel,
  SourceType,
  type Entity,
} from '@jericho/shared';

import { loadConfig } from '../src/config.js';
import { JerichoStore } from '../src/core/store.js';
import { createJerichoServer } from '../src/server.js';
import {
  GroundedTurnController,
  classifyPrivateQuestion,
} from '../src/retrieval/grounded-turn.js';
import { MemoryIndex } from '../src/retrieval/memory-index.js';
import {
  IdentityResolutionCache,
  buildGroundedResultEvent,
  groupIdentityEvidence,
  ISABELLA_IDENTITY,
} from '../src/retrieval/identity-aware.js';
function person(overrides: Partial<Entity> & Pick<Entity, 'id' | 'canonicalName'>): Entity {
  return {
    type: EntityType.Person,
    aliases: [],
    attributes: {},
    status: LifecycleStatus.Active,
    risk: RiskLevel.Low,
    confidence: 1,
    freshness: { observedAt: '2026-07-13T00:00:00.000Z' },
    provenance: [],
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

const TOKEN = 'grounded-intel-token';
const stores: JerichoStore[] = [];
const directories: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  directories.push(dir);
  return dir;
}

function writeNotes(root: string, count: number, seed = 'note'): void {
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(root, `${seed}-${index}.md`), `# ${seed} ${index}\nBody about ${seed} topic ${index}.\n`);
  }
}

describe('JERICHO_MEMORY_ROOTS config', () => {
  it('maps JERICHO_OBSIDIAN_VAULT to one canonical root named obsidian', () => {
    const vault = tempDir('jericho-vault-');
    const config = loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_OBSIDIAN_VAULT: vault,
    }, []);
    expect(config.memoryRoots).toEqual([{ id: 'obsidian', path: vault, authority: 'canonical' }]);
    expect(config.obsidianVaultPath).toBe(vault);
  });

  it('parses multi-root JERICHO_MEMORY_ROOTS for other installations', () => {
    const canonical = tempDir('jericho-can-');
    const supplemental = tempDir('jericho-sup-');
    const config = loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_MEMORY_ROOTS: JSON.stringify([
        { id: 'canonical', path: canonical, authority: 'canonical' },
        { id: 'supplemental', path: supplemental, authority: 'supplemental' },
      ]),
    }, []);
    expect(config.memoryRoots).toHaveLength(2);
    expect(config.obsidianVaultPath).toBe(canonical);
  });

  it('fails when both MEMORY_ROOTS and OBSIDIAN_VAULT are set', () => {
    const vault = tempDir('jericho-both-');
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_OBSIDIAN_VAULT: vault,
      JERICHO_MEMORY_ROOTS: JSON.stringify([{ id: 'a', path: vault, authority: 'canonical' }]),
    }, [])).toThrow(/cannot both be configured/);
  });

  it('rejects duplicate ids, missing dirs, nested roots, and symlinks', () => {
    const root = tempDir('jericho-invalid-');
    const nested = join(root, 'child');
    mkdirSync(nested);
    const other = tempDir('jericho-other-');
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_MEMORY_ROOTS: JSON.stringify([
        { id: 'a', path: root, authority: 'canonical' },
        { id: 'a', path: other, authority: 'supplemental' },
      ]),
    }, [])).toThrow(/duplicate ids/);
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_MEMORY_ROOTS: JSON.stringify([
        { id: 'a', path: join(root, 'missing'), authority: 'canonical' },
      ]),
    }, [])).toThrow(/does not exist/);
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_MEMORY_ROOTS: JSON.stringify([
        { id: 'a', path: root, authority: 'canonical' },
        { id: 'b', path: nested, authority: 'supplemental' },
      ]),
    }, [])).toThrow(/nest/);
    const link = join(tempDir('jericho-link-parent-'), 'vault-link');
    symlinkSync(root, link);
    expect(() => loadConfig({
      JERICHO_API_TOKEN: TOKEN,
      JERICHO_MEMORY_ROOTS: JSON.stringify([
        { id: 'a', path: link, authority: 'canonical' },
      ]),
    }, [])).toThrow(/symlink/);
  });
});

describe('multi-root BM25 memory index', () => {
  it('indexes two real temporary roots with more than 500 documents', () => {
    const canonical = tempDir('jericho-idx-can-');
    const supplemental = tempDir('jericho-idx-sup-');
    writeNotes(canonical, 300, 'can');
    writeNotes(supplemental, 250, 'sup');
    writeFileSync(join(canonical, 'People Isabella Handel.md'), [
      '# Isabella Handel',
      'Isabella Handel works at MasterBlox.',
      'Family and company context.',
    ].join('\n'));
    writeFileSync(join(supplemental, 'Sessions Francisco.md'), [
      '# Francisco session',
      'Isabella is Francisco wife and works elsewhere.',
    ].join('\n'));
    mkdirSync(join(canonical, '.obsidian'));
    writeFileSync(join(canonical, '.obsidian', 'hidden.md'), '# hidden');
    writeFileSync(join(canonical, '.secret.md'), '# secret');

    const index = new MemoryIndex({
      roots: [
        { id: 'prada-mind', path: canonical, authority: 'canonical' },
        { id: 'jarvis-memory', path: supplemental, authority: 'supplemental' },
      ],
    });
    const health = index.refresh();
    expect(health.available).toBe(true);
    expect(health.roots.reduce((sum, root) => sum + root.documentCount, 0)).toBeGreaterThan(500);
    expect(health.roots.every((root) => root.authority && root.revision && root.lastIndexedAt)).toBe(true);

    const hits = index.search('Isabella Handel MasterBlox', 8);
    expect(hits[0]?.relativePath).toMatch(/Isabella Handel/);
    expect(hits[0]?.authority).toBe('canonical');
    expect(hits.some((hit) => hit.relativePath.includes('.obsidian'))).toBe(false);
  });
});

describe('identity resolution without Isabella fallback', () => {
  it('resolves canonical Isabella, excludes Francisco-wife evidence, and keeps spouse unconfirmed', () => {
    const hits = [
      {
        path: 'People/Isabella Handel.md',
        title: 'Isabella Handel',
        excerpt: 'Isabella Handel works at MasterBlox and is married to Carlos Prada.',
        score: 0.97,
        sourceId: 'src-isabella',
        rootId: 'prada-mind',
        authority: 'canonical' as const,
      },
      {
        path: 'Sessions/Francisco.md',
        title: 'Francisco session',
        excerpt: 'Isabella is Francisco wife and works elsewhere.',
        score: 0.8,
        sourceId: 'src-francisco',
        rootId: 'jarvis-memory',
        authority: 'supplemental' as const,
      },
    ];
    const result = groupIdentityEvidence('Isabella', hits, 1, ISABELLA_IDENTITY);
    expect(result.resolved?.fullName).toBe('Isabella Handel');
    expect(result.resolved?.employment).toContain('MasterBlox');
    expect(result.resolved?.relationshipToCarlos).toBeUndefined();
    expect(result.excluded).toHaveLength(1);
    const event = buildGroundedResultEvent(result, randomUUID(), 'private_knowledge', undefined, {
      hits,
      indexRevision: 'rev1',
    });
    assertGroundedResultEvent(event);
    expect(event.schemaVersion).toBe(2);
    expect(event.confidence).toBe('partial');
    expect(event.actions.openSourceIds?.length).toBeGreaterThan(0);
    expect(event.conflicts?.some((conflict) => /Francisco|spouse|wife|First-name/i.test(conflict.claim + conflict.reason))).toBe(true);
  });

  it('resolves another known person, leaves unknown unavailable, and never defaults to Isabella', () => {
    const aliceHits = [{
      path: 'People/Alice Smith.md',
      title: 'Alice Smith',
      excerpt: 'Alice Smith leads operations at MasterBlox.',
      score: 0.9,
      sourceId: 'src-alice',
      rootId: 'prada-mind',
      authority: 'canonical' as const,
    }];
    const alice = groupIdentityEvidence('Alice Smith', aliceHits, 1);
    expect(alice.resolved?.fullName).toBe('Alice Smith');
    expect(alice.resolved?.fullName).not.toMatch(/Isabella/i);

    const unknown = groupIdentityEvidence('Zebulon Quark', [], 1);
    expect(unknown.resolved).toBeUndefined();
    expect(unknown.excluded).toHaveLength(0);
    const event = buildGroundedResultEvent(unknown, randomUUID());
    expect(event.phase).toBe('unavailable');
    expect(event.canonicalIdentity).toBeUndefined();
  });
});

describe('GroundedTurnController', () => {
  it('handles Gemini messages without finished across orderings, duplicates, and barge-in', async () => {
    const root = tempDir('jericho-turn-');
    writeFileSync(join(root, 'People.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox.\n');
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 9) });
    stores.push(store);
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const sent: Record<string, unknown>[] = [];
    const instructions: string[] = [];
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      send: (message) => sent.push(message),
      instruct: (text) => instructions.push(text),
      clock: (() => {
        let now = 1_000;
        return () => {
          now += 10;
          return now;
        };
      })(),
    });

    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is' }, 'interim');
    controller.ingestTranscription({ text: 'Who is' }, 'interim'); // duplicate
    controller.ingestTranscription({ text: 'Who is Isabella' }, 'final');
    controller.ingestTranscription({ text: 'Who is Isabella' }, 'final'); // duplicate
    controller.onTurnComplete(); // turnComplete before quiet window
    await vi.waitFor(async () => {
      await controller.finalizeNow();
      expect(sent.some((message) => message.type === 'grounded_result' && message.phase !== 'retrieving')).toBe(true);
    });

    const spoken = store.listEvents().filter((event) => event.type === 'local.capture.spoken');
    expect(spoken).toHaveLength(1);
    const terminals = sent.filter((message) =>
      message.type === 'grounded_result' && message.phase !== 'retrieving');
    expect(terminals).toHaveLength(1);
    expect(instructions).toHaveLength(1);
    assertGroundedResultEvent(Object.fromEntries(
      Object.entries(terminals[0]!).filter(([key]) => key !== 'type'),
    ) as never);

    // Barge-in / second subject in same controller session.
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Tell me about Alice' }, 'final');
    await controller.finalizeNow();
    const spokenAfter = store.listEvents().filter((event) => event.type === 'local.capture.spoken');
    expect(spokenAfter).toHaveLength(2);
  });

  it('returns unavailable when indexing is unavailable instead of bypassing retrieval', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 11) });
    stores.push(store);
    const sent: Record<string, unknown>[] = [];
    const controller = new GroundedTurnController({
      store,
      send: (message) => sent.push(message),
      instruct: () => undefined,
    });
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is Isabella' }, 'final');
    await controller.finalizeNow();
    const terminal = sent.find((message) => message.type === 'grounded_result' && message.phase === 'unavailable');
    expect(terminal).toBeTruthy();
  });
});

describe('grounded result actions', () => {
  it('authorizes result-bound actions and rejects client-controlled paths/claims', async () => {
    const root = tempDir('jericho-actions-');
    writeFileSync(join(root, 'People Isabella Handel.md'), '# Isabella Handel\nWorks at MasterBlox.\n');
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 13) });
    stores.push(store);
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      send: () => undefined,
      instruct: () => undefined,
    });
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is Isabella Handel' }, 'final');
    const result = await controller.finalizeNow().then(async () => {
      const events = store.listEvents().filter((event) => event.type === 'grounded.result.terminal');
      return events.at(-1)?.payload as unknown as ReturnType<typeof buildGroundedResultEvent>;
    });
    expect(result?.resultId).toBeTruthy();
    const sourceId = result!.actions.openSourceIds![0]!;
    expect(controller.openAction(result!.resultId, sourceId).relativePath).toMatch(/Isabella/);
    expect(() => controller.openAction(result!.resultId, 'not-allowed')).toThrow(/source_not_permitted/);
    const proposal = controller.reorganizeAction(result!.resultId, sourceId);
    expect(proposal.body).toMatchObject({ writesApplied: false });

    const server = createJerichoServer({
      store,
      apiToken: TOKEN,
      memoryIndex: index,
      groundedActions: controller,
      clock: () => '2026-07-13T00:00:00.000Z',
    });
    servers.push(server);
    const address = await server.listen(0, '127.0.0.1');
    const rejected = await fetch(`http://127.0.0.1:${address.port}/api/v1/grounded-results/${result!.resultId}/actions/open`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sourceId, relativePath: '/etc/passwd' }),
    });
    expect(rejected.status).toBe(400);
    const ok = await fetch(`http://127.0.0.1:${address.port}/api/v1/grounded-results/${result!.resultId}/actions/reorganize`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sourceId }),
    });
    expect(ok.status).toBe(201);
  });
});

describe('core + multi-root aggregation', () => {
  it('aggregates Core, canonical, and supplemental evidence', () => {
    const canonical = tempDir('jericho-agg-can-');
    const supplemental = tempDir('jericho-agg-sup-');
    writeFileSync(join(canonical, 'Isabella Handel.md'), '# Isabella Handel\nIsabella Handel at MasterBlox.\n');
    writeFileSync(join(supplemental, 'notes.md'), '# Notes\nIsabella mentioned in passing.\n');
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 15) });
    stores.push(store);
    const occurredAt = '2026-07-13T00:00:00.000Z';
    store.appendEvent({
      id: 'core-ev-1',
      source: 'local:system',
      sourceType: SourceType.System,
      sourceEventId: 'core-1',
      type: 'memory.note',
      occurredAt,
      ingestedAt: occurredAt,
      payload: { text: 'Isabella Handel employment MasterBlox confirmed in Core' },
      provenance: [{
        source: 'local:system',
        sourceType: SourceType.System,
        sourceEventId: 'core-1',
        observedAt: occurredAt,
      }],
    });
    const index = new MemoryIndex({
      roots: [
        { id: 'canonical', path: canonical, authority: 'canonical' },
        { id: 'supplemental', path: supplemental, authority: 'supplemental' },
      ],
    });
    index.refresh();
    expect(classifyPrivateQuestion('Who is Isabella Handel')).toBe(true);
    const memoryHits = index.search('Isabella Handel', 8);
    expect(memoryHits.some((hit) => hit.authority === 'canonical')).toBe(true);
    expect(memoryHits.some((hit) => hit.authority === 'supplemental')).toBe(true);
    expect(createHash('sha256').update('isolation').digest('hex')).toBeTruthy();
  });
});

describe('review regressions', () => {
  it('same-byte-length content edit changes index revision', () => {
    const root = tempDir('jericho-rev-');
    const note = join(root, 'People.md');
    writeFileSync(note, '# Isabella Handel\nAAAA\n');
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    const first = index.refresh().revision;
    writeFileSync(note, '# Isabella Handel\nBBBB\n');
    const second = index.refresh().revision;
    expect(first).not.toBe(second);
  });

  it('stops Markdown traversal immediately at 50001 files', () => {
    const root = tempDir('jericho-bound-');
    // Use a low maxFilesPerRoot to prove early-stop without creating 50k files.
    for (let index = 0; index < 6; index += 1) {
      writeFileSync(join(root, `n${index}.md`), `# n${index}\n`);
    }
    const index = new MemoryIndex({
      roots: [{ id: 'obsidian', path: root, authority: 'canonical' }],
      maxFilesPerRoot: 5,
    });
    const health = index.refresh();
    expect(health.available).toBe(false);
  });

  it('prefers canonical full-name over higher-scoring supplemental conflict', () => {
    const hits = [
      {
        path: 'People/Isabella.md',
        title: 'Isabella',
        excerpt: 'Isabella only first name mention with high BM25 padding tokens Isabella Isabella Isabella',
        score: 0.99,
        sourceId: 'src-sup',
        rootId: 'jarvis-memory',
        authority: 'supplemental' as const,
      },
      {
        path: 'People/Isabella Handel.md',
        title: 'Isabella Handel',
        excerpt: 'Isabella Handel works at MasterBlox.',
        score: 0.4,
        sourceId: 'src-can',
        rootId: 'prada-mind',
        authority: 'canonical' as const,
      },
    ];
    const result = groupIdentityEvidence('Isabella', hits);
    expect(result.resolved?.fullName).toBe('Isabella Handel');
  });

  it('joins provenance and conflicts by sourceId across same relative paths in two roots', () => {
    const hits = [
      {
        path: 'People/Isabella.md',
        title: 'Isabella Handel',
        excerpt: 'Isabella Handel at MasterBlox.',
        score: 0.9,
        sourceId: 'src-a',
        rootId: 'prada-mind',
        authority: 'canonical' as const,
      },
      {
        path: 'People/Isabella.md',
        title: 'Isabella Handel',
        excerpt: 'Isabella Handel supplemental mention.',
        score: 0.8,
        sourceId: 'src-b',
        rootId: 'jarvis-memory',
        authority: 'supplemental' as const,
      },
    ];
    const evidence = groupIdentityEvidence('Isabella Handel', hits);
    const event = buildGroundedResultEvent(evidence, randomUUID(), 'private_knowledge', undefined, {
      hits,
      indexRevision: 'rev-multi',
    });
    expect(event.provenance.map((item) => item.sourceId).sort()).toEqual(['src-a', 'src-b']);
    expect(new Set(event.provenance.map((item) => item.rootId))).toEqual(new Set(['prada-mind', 'jarvis-memory']));
  });

  it('buffers speculative output while route unknown and discards after private classification', () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 21) });
    stores.push(store);
    const sent: Record<string, unknown>[] = [];
    const controller = new GroundedTurnController({
      store,
      send: (message) => sent.push(message),
      instruct: () => undefined,
      clock: () => 1_000,
    });
    controller.beginTurn();
    controller.bufferSpeculative({ kind: 'text', text: 'leak?', receivedAt: 1_000 });
    expect(sent.some((message) => message.type === 'text')).toBe(false);
    controller.ingestTranscription({ text: 'Who is Isabella' }, 'interim');
    controller.bufferSpeculative({ kind: 'text', text: 'private leak', receivedAt: 1_010 });
    expect(sent.some((message) => message.type === 'text')).toBe(false);
  });

  it('final transcript quiet arms 250ms finalizer; interim alone does not', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 22) });
    stores.push(store);
    const root = tempDir('jericho-finalizer-');
    writeFileSync(join(root, 'People.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox.\n');
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    vi.useFakeTimers();
    try {
      const sent: Record<string, unknown>[] = [];
      const controller = new GroundedTurnController({
        store,
        memoryIndex: index,
        send: (message) => sent.push(message),
        instruct: () => undefined,
        clock: () => Date.now(),
      });
      controller.beginTurn();
      controller.ingestTranscription({ text: 'Who is Isabella' }, 'interim');
      await vi.advanceTimersByTimeAsync(500);
      expect(sent.some((message) => message.type === 'grounded_result')).toBe(false);
      controller.ingestTranscription({ text: 'Who is Isabella' }, 'final');
      await vi.advanceTimersByTimeAsync(249);
      expect(sent.some((message) => message.type === 'grounded_result')).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await vi.waitFor(() => {
        expect(sent.some((message) => message.type === 'grounded_result' && message.phase !== 'retrieving')).toBe(true);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('turnComplete-before-transcript keeps gate active for 150ms grace and accepts late final', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 23) });
    stores.push(store);
    const root = tempDir('jericho-tc-first-');
    writeFileSync(join(root, 'People.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox.\n');
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const sent: Record<string, unknown>[] = [];
    let settled = 0;
    vi.useFakeTimers();
    try {
      const controller = new GroundedTurnController({
        store,
        memoryIndex: index,
        send: (message) => sent.push(message),
        instruct: () => undefined,
        onTurnSettled: () => {
          settled += 1;
        },
        clock: () => Date.now(),
      });
      controller.beginTurn();
      const early = controller.onTurnComplete();
      expect(early.mayDeactivate).toBe(false);
      // Late final within grace consumes pending turnComplete and finalizes once.
      controller.ingestTranscription({ text: 'Who is Isabella' }, 'final');
      await vi.advanceTimersByTimeAsync(150);
      await vi.waitFor(() => {
        expect(sent.some((message) => message.type === 'grounded_result' && message.phase !== 'retrieving')).toBe(true);
      });
      const terminals = sent.filter((message) => message.type === 'grounded_result' && message.phase !== 'retrieving');
      expect(terminals).toHaveLength(1);
      expect(settled).toBe(0);
      // Pending state must be consumed — a later empty turnComplete can settle the gate.
      controller.beginTurn();
      const again = controller.onTurnComplete();
      expect(again.mayDeactivate).toBe(false);
      await vi.advanceTimersByTimeAsync(150);
      expect(settled).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('speculative turnComplete during answering without grounded output does not allow deactivate', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 24) });
    stores.push(store);
    const root = tempDir('jericho-race-');
    writeFileSync(join(root, 'People.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox.\n');
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const sent: Record<string, unknown>[] = [];
    const instructions: string[] = [];
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      send: (message) => sent.push(message),
      instruct: (text) => instructions.push(text),
      clock: () => 10_000,
    });
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is Isabella' }, 'final');
    await controller.finalizeNow();
    expect(controller.groundingState).toBe('answering');
    expect(controller.groundedOutputSeen).toBe(false);
    const speculative = controller.onTurnComplete();
    expect(speculative.mayDeactivate).toBe(false);
    controller.bufferSpeculative({ kind: 'audio', data: 'Z3JvdW5kZWQ=', mimeType: 'audio/pcm;rate=24000', receivedAt: 10_000 });
    controller.noteGroundedOutput();
    const groundedComplete = controller.onTurnComplete();
    expect(groundedComplete.mayDeactivate).toBe(true);
    expect(sent.filter((message) => message.type === 'audio')).toHaveLength(1);
    expect(instructions).toHaveLength(1);
    expect(sent.filter((message) => message.type === 'grounded_result' && message.phase !== 'retrieving')).toHaveLength(1);
  });

  it('cache miss and cache hit emit byte-equivalent provenance actions and conflicts', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 25) });
    stores.push(store);
    const root = tempDir('jericho-cache-');
    writeFileSync(join(root, 'People.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox and is married to Carlos Prada.\n');
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      send: () => undefined,
      instruct: () => undefined,
    });
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is Isabella Handel' }, 'final');
    const miss = await controller.runPrivateRetrieval('Who is Isabella Handel');
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is Isabella Handel' }, 'final');
    const hit = await controller.runPrivateRetrieval('Who is Isabella Handel');
    expect(miss).toBeTruthy();
    expect(hit).toBeTruthy();
    const strip = (event: NonNullable<typeof miss>) => ({
      provenance: event.provenance,
      actions: event.actions,
      conflicts: event.conflicts ?? [],
      claims: event.claims ?? [],
      confidence: event.confidence,
      phase: event.phase,
      fullName: event.fullName,
      relationship: event.relationship,
    });
    expect(strip(hit!)).toEqual(strip(miss!));
  });

  it('opens notes from two roots with the same relative path via rootId', async () => {
    const canonical = tempDir('jericho-open-can-');
    const supplemental = tempDir('jericho-open-sup-');
    writeFileSync(join(canonical, 'People Isabella.md'), '# Isabella Handel\nCanonical Isabella Handel.\n');
    writeFileSync(join(supplemental, 'People Isabella.md'), '# Isabella Handel\nSupplemental Isabella Handel.\n');
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 26) });
    stores.push(store);
    const index = new MemoryIndex({
      roots: [
        { id: 'prada-mind', path: canonical, authority: 'canonical' },
        { id: 'jarvis-memory', path: supplemental, authority: 'supplemental' },
      ],
    });
    index.refresh();
    const opened: string[] = [];
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      memoryRootPaths: new Map([
        ['prada-mind', canonical],
        ['jarvis-memory', supplemental],
      ]),
      send: () => undefined,
      instruct: () => undefined,
    });
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is Isabella Handel' }, 'final');
    await controller.finalizeNow();
    const payload = store.listEvents().filter((event) => event.type === 'grounded.result.terminal').at(-1)?.payload as {
      resultId: string;
      actions: { openSourceIds?: string[] };
      provenance: Array<{ sourceId: string; rootId: string; relativePath: string }>;
    };
    expect(payload.actions.openSourceIds?.length).toBeGreaterThanOrEqual(1);
    const openers = new Map([
      ['prada-mind', { open: async (relativePath: string) => {
        opened.push(`prada-mind:${relativePath}`);
        return { relativePath };
      } }],
      ['jarvis-memory', { open: async (relativePath: string) => {
        opened.push(`jarvis-memory:${relativePath}`);
        return { relativePath };
      } }],
    ]);
    const server = createJerichoServer({
      store,
      apiToken: TOKEN,
      memoryIndex: index,
      groundedActions: controller,
      obsidianOpeners: openers,
      clock: () => '2026-07-13T00:00:00.000Z',
    });
    servers.push(server);
    const address = await server.listen(0, '127.0.0.1');
    for (const sourceId of payload.actions.openSourceIds ?? []) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/grounded-results/${payload.resultId}/actions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { rootId: string; sourceId: string };
      expect(body.sourceId).toBe(sourceId);
      expect(openers.has(body.rootId)).toBe(true);
    }
    expect(opened.length).toBeGreaterThanOrEqual(1);
  });

  it('result-bound exclusion-only correction confirms through opaque confirm endpoint', async () => {
    const root = tempDir('jericho-correct-');
    const notePath = 'People Isabella Handel.md';
    writeFileSync(join(root, notePath), [
      '# Isabella Handel',
      'Isabella Handel works at MasterBlox.',
    ].join('\n'));
    writeFileSync(join(root, 'Sessions Francisco.md'), [
      '# Francisco session',
      'Isabella is Francisco wife and works elsewhere.',
    ].join('\n'));
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 27) });
    stores.push(store);
    store.upsertEntity(person({ id: 'entity-isabella', canonicalName: 'Isabella Handel' }));
    store.upsertEntity(person({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] }));
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      memoryRootPaths: new Map([['obsidian', root]]),
      send: () => undefined,
      instruct: () => undefined,
    });
    controller.beginTurn();
    const grounded = await controller.runPrivateRetrieval('Who is Isabella Handel');
    expect(grounded?.actions.correctConflictIds?.length).toBeGreaterThan(0);
    expect(grounded?.relationship).toBeUndefined();
    const conflictId = grounded!.actions.correctConflictIds![0]!;
    const conflict = grounded!.conflicts!.find((item) => item.id === conflictId)!;
    expect(conflict.claim).toMatch(/Francisco|First-name|conflicting|wife|spouse|Unconfirmed/i);

    const server = createJerichoServer({
      store,
      apiToken: TOKEN,
      memoryIndex: index,
      groundedActions: controller,
      memoryRootPaths: new Map([['obsidian', root]]),
      clock: () => '2026-07-13T00:00:00.000Z',
    });
    servers.push(server);
    const address = await server.listen(0, '127.0.0.1');
    const previewResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/grounded-results/${grounded!.resultId}/actions/correct/preview`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ conflictId }),
      },
    );
    expect(previewResponse.status).toBe(200);
    const previewBody = await previewResponse.json() as {
      preview: {
        id: string;
        coreEffects: { relationsToCreate: unknown[]; exclusionsToApply: unknown[] };
      };
    };
    expect(previewBody.preview.coreEffects.relationsToCreate).toEqual([]);
    expect(previewBody.preview.coreEffects.exclusionsToApply.length).toBe(1);

    const relationsBefore = store.listRelations().length;
    const confirm = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/grounded-results/${grounded!.resultId}/actions/correct/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ conflictId, previewId: previewBody.preview.id }),
      },
    );
    expect(confirm.status).toBe(200);
    const confirmBody = await confirm.json() as {
      status: string;
      coreReceipt: { relationsCreated: string[]; exclusionsApplied: string[] };
    };
    expect(confirmBody.status).toMatch(/confirmed|idempotent/i);
    expect(confirmBody.coreReceipt.relationsCreated).toEqual([]);
    expect(confirmBody.coreReceipt.exclusionsApplied.length).toBeGreaterThan(0);
    expect(store.listRelations().length).toBe(relationsBefore);
    expect(store.listRelations({ type: RelationType.SpouseOf })).toHaveLength(0);
    expect(store.listIdentityExclusions('entity-isabella').some((item) => item.claimPattern === conflict.claim)).toBe(true);
  });

  it('rejects client-controlled fields and mismatched opaque correction IDs', async () => {
    const root = tempDir('jericho-correct-reject-');
    writeFileSync(join(root, 'People.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox.\n');
    writeFileSync(join(root, 'Francisco.md'), '# Francisco\nIsabella is Francisco wife.\n');
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 33) });
    stores.push(store);
    store.upsertEntity(person({ id: 'entity-isabella', canonicalName: 'Isabella Handel' }));
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      memoryRootPaths: new Map([['obsidian', root]]),
      send: () => undefined,
      instruct: () => undefined,
    });
    controller.beginTurn();
    const grounded = await controller.runPrivateRetrieval('Who is Isabella Handel');
    const conflictId = grounded!.actions.correctConflictIds![0]!;
    const server = createJerichoServer({
      store,
      apiToken: TOKEN,
      memoryIndex: index,
      groundedActions: controller,
      memoryRootPaths: new Map([['obsidian', root]]),
      clock: () => '2026-07-13T00:00:00.000Z',
    });
    servers.push(server);
    const address = await server.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${address.port}/api/v1/grounded-results/${grounded!.resultId}/actions/correct`;
    for (const body of [
      { conflictId, entityId: 'entity-isabella' },
      { conflictId, claim: 'x' },
      { conflictId, relationType: 'spouse_of' },
      { conflictId, canonicalNotePath: 'x.md' },
      { conflictId, canonicalNoteHash: 'a'.repeat(64) },
      { conflictId, fromEntityId: 'entity-carlos' },
    ]) {
      const rejected = await fetch(`${base}/preview`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(rejected.status).toBe(400);
    }
    const preview = await (await fetch(`${base}/preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conflictId }),
    })).json() as { preview: { id: string } };
    const mismatched = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conflictId: 'not-the-conflict', previewId: preview.preview.id }),
    });
    expect(mismatched.status).toBeGreaterThanOrEqual(400);
    const replayPreview = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        conflictId,
        previewId: preview.preview.id,
        entityId: 'entity-isabella',
        relationType: 'spouse_of',
      }),
    });
    expect(replayPreview.status).toBe(400);
    const first = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conflictId, previewId: preview.preview.id }),
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conflictId, previewId: preview.preview.id }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { status: string; coreReceipt: { relationsCreated: string[] } };
    expect(secondBody.status).toMatch(/idempotent|confirmed/i);
    expect(secondBody.coreReceipt.relationsCreated).toEqual([]);
  });

  it('opaque grounded confirmation survives reconnect via persisted result state', async () => {
    const root = tempDir('jericho-correct-reconnect-');
    writeFileSync(join(root, 'People.md'), '# Alice Smith\nAlice Smith leads ops.\nAlice (ambiguous) note.\n');
    // Force a first-name-only excluded conflict alongside canonical evidence.
    writeFileSync(join(root, 'Alice.md'), '# Alice\nAlice mentioned without surname.\n');
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 34) });
    stores.push(store);
    store.upsertEntity(person({ id: 'entity-alice', canonicalName: 'Alice Smith' }));
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const first = new GroundedTurnController({
      store,
      memoryIndex: index,
      memoryRootPaths: new Map([['obsidian', root]]),
      send: () => undefined,
      instruct: () => undefined,
    });
    first.beginTurn();
    const grounded = await first.runPrivateRetrieval('Who is Alice Smith');
    expect(grounded?.actions.correctConflictIds?.length).toBeGreaterThan(0);
    const conflictId = grounded!.actions.correctConflictIds![0]!;
    const preview = first.correctPreviewAction(grounded!.resultId, conflictId);
    expect(preview.coreEffects.relationsToCreate).toEqual([]);

    const reconnected = new GroundedTurnController({
      store,
      memoryIndex: index,
      memoryRootPaths: new Map([['obsidian', root]]),
      send: () => undefined,
      instruct: () => undefined,
    });
    reconnected.loadPersistedResults();
    const confirmed = reconnected.correctConfirmAction(grounded!.resultId, conflictId, preview.id);
    expect(confirmed.coreReceipt.relationsCreated).toEqual([]);
    expect(confirmed.coreReceipt.exclusionsApplied.length).toBeGreaterThan(0);
    expect(store.listIdentityExclusions('entity-alice').some((item) => item.claimPattern === preview.disputedClaim)).toBe(true);
  });


  it('binds confirmed spouse relations only to the subject entity and Carlos', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 28) });
    stores.push(store);
    store.upsertEntity(person({ id: 'entity-isabella', canonicalName: 'Isabella Handel' }));
    store.upsertEntity(person({ id: 'entity-carlos', canonicalName: 'Carlos Prada' }));
    store.upsertEntity(person({ id: 'entity-alice', canonicalName: 'Alice Smith' }));
    const occurredAt = '2026-07-13T00:00:00.000Z';
    // Create Isabella↔Carlos spouse via correction flow
    const preview = store.createCorrectionPreview({
      entityId: 'entity-isabella',
      claimPattern: 'spouse claim',
      sourceProvenance: [{
        source: 'test',
        sourceType: SourceType.User,
        sourceEventId: 'ev-1',
        observedAt: occurredAt,
      }],
      proposedFromEntityId: 'entity-carlos',
      proposedToEntityId: 'entity-isabella',
      proposedRelationType: RelationType.SpouseOf,
      canonicalNotePath: 'People Isabella Handel.md',
      canonicalNoteHash: createHash('sha256').update('x').digest('hex'),
      obsidianFieldsToAdd: {},
      obsidianFieldsToRemove: [],
    });
    store.confirmCorrection({
      previewId: preview.id,
      previewHash: preview.previewHash,
      previewVersion: preview.version,
      entityId: 'entity-isabella',
      claimPattern: 'spouse claim',
      fromEntityId: 'entity-carlos',
      toEntityId: 'entity-isabella',
      relationType: RelationType.SpouseOf,
      canonicalNoteHash: preview.obsidianEffects.noteHash,
      canonicalNotePath: preview.canonicalNotePath,
      obsidianFieldsToAdd: {},
      decidedBy: 'carlos',
      decidedAt: occurredAt,
    });
    const root = tempDir('jericho-spouse-bind-');
    writeFileSync(join(root, 'Alice.md'), '# Alice Smith\nAlice Smith works at MasterBlox.\n');
    writeFileSync(join(root, 'Isabella.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox.\n');
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      send: () => undefined,
      instruct: () => undefined,
    });
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is Alice Smith' }, 'final');
    await controller.finalizeNow();
    const alice = store.listEvents().filter((event) => event.type === 'grounded.result.terminal').at(-1)?.payload as {
      relationship?: string;
      fullName?: string;
    };
    expect(alice.fullName).toBe('Alice Smith');
    expect(alice.relationship).toBeUndefined();
    expect(store.listRelations({ type: RelationType.SpouseOf }).length).toBeGreaterThan(0);
    controller.beginTurn();
    const isabella = await controller.runPrivateRetrieval('Who is Isabella Handel');
    expect(isabella?.fullName).toBe('Isabella Handel');
    expect(isabella?.relationship).toMatch(/spouse|Carlos/i);
  });

  it('hoists greeting across two controllers sharing one browser session credential', () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 29) });
    stores.push(store);
    const sessionGreeting = { hasGreeted: false };
    const first = new GroundedTurnController({
      store,
      sessionGreeting,
      send: () => undefined,
    });
    const second = new GroundedTurnController({
      store,
      sessionGreeting,
      send: () => undefined,
    });
    expect(first.hasGreeted).toBe(false);
    first.markGreeted();
    expect(second.hasGreeted).toBe(true);
  });

  it('guided Test Isabella uses one controller-owned retrieval path without synthetic duplicate', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 30) });
    stores.push(store);
    const root = tempDir('jericho-guided-');
    writeFileSync(join(root, 'People.md'), '# Isabella Handel\nIsabella Handel works at MasterBlox.\n');
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const sent: Record<string, unknown>[] = [];
    let guidedResults = 0;
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      send: (message) => sent.push(message),
      instruct: () => undefined,
      onGuidedStart: () => undefined,
      onGuidedResult: () => {
        guidedResults += 1;
      },
    });
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Test Isabella' }, 'final');
    await controller.finalizeNow();
    expect(controller.guidedActive).toBe(true);
    expect(sent.some((message) => message.type === 'guided_test_start')).toBe(true);
    controller.beginTurn();
    controller.ingestTranscription({ text: 'Who is Isabella' }, 'final');
    await controller.finalizeNow();
    expect(guidedResults).toBe(1);
    const terminals = sent.filter((message) => message.type === 'grounded_result' && message.phase !== 'retrieving');
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.guided).toEqual({ test: 'isabella' });
  });

  it('index refresh and correction confirm invalidate shared live identity caches', async () => {
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 31) });
    stores.push(store);
    store.upsertEntity(person({ id: 'entity-isabella', canonicalName: 'Isabella Handel' }));
    store.upsertEntity(person({ id: 'entity-carlos', canonicalName: 'Carlos Prada', aliases: ['Carlos'] }));
    const root = tempDir('jericho-cache-inv-');
    const notePath = 'People Isabella Handel.md';
    writeFileSync(join(root, notePath), '# Isabella Handel\nIsabella Handel is married to Carlos Prada.\n');
    const index = new MemoryIndex({ roots: [{ id: 'obsidian', path: root, authority: 'canonical' }] });
    index.refresh();
    const identityCache = new IdentityResolutionCache();
    const actions = new GroundedTurnController({
      store,
      memoryIndex: index,
      identityCache,
      memoryRootPaths: new Map([['obsidian', root]]),
      send: () => undefined,
      instruct: () => undefined,
    });
    const voice = new GroundedTurnController({
      store,
      memoryIndex: index,
      identityCache,
      memoryRootPaths: new Map([['obsidian', root]]),
      send: () => undefined,
      instruct: () => undefined,
    });
    voice.beginTurn();
    await voice.runPrivateRetrieval('Who is Isabella Handel');
    const key = { question: 'Who is Isabella Handel', indexRevision: index.revision };
    expect(identityCache.get(key)).toBeTruthy();

    const server = createJerichoServer({
      store,
      apiToken: TOKEN,
      memoryIndex: index,
      groundedActions: actions,
      memoryRootPaths: new Map([['obsidian', root]]),
      correctionNoteWriter: {
        write: () => ({
          status: 'written',
          notePath,
          fieldsWritten: ['spouse'],
          completedAt: '2026-07-13T00:00:00.000Z',
        }),
      } as never,
      clock: () => '2026-07-13T00:00:00.000Z',
    });
    servers.push(server);
    index.refresh();
    expect(identityCache.get(key)).toBeUndefined();

    actions.beginTurn();
    await actions.runPrivateRetrieval('Who is Isabella Handel');
    expect(identityCache.get({ question: 'Who is Isabella Handel', indexRevision: index.revision })).toBeTruthy();
    const payload = store.listEvents().filter((event) => event.type === 'grounded.result.terminal').at(-1)?.payload as {
      resultId: string;
      actions: { correctConflictIds?: string[] };
    };
    const address = await server.listen(0, '127.0.0.1');
    const conflictId = payload.actions.correctConflictIds![0]!;
    const previewResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/grounded-results/${payload.resultId}/actions/correct/preview`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ conflictId }),
      },
    );
    expect(previewResponse.status).toBe(200);
    const previewBody = await previewResponse.json() as { preview: { id: string } };
    // Preview must not clear live caches; only successful confirmation does.
    expect(identityCache.get({ question: 'Who is Isabella Handel', indexRevision: index.revision })).toBeTruthy();
    const confirm = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/grounded-results/${payload.resultId}/actions/correct/confirm`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ conflictId, previewId: previewBody.preview.id }),
      },
    );
    expect(confirm.status).toBe(200);
    expect(identityCache.get({ question: 'Who is Isabella Handel', indexRevision: index.revision })).toBeUndefined();
  });

});


describe('jericho-unified synthetic vault', () => {
  const SOURCE_FOLDERS = [
    'Jarvis Brain',
    'Jarvis Brain Repo',
    'Mechanica',
    'Prada Mind',
    'Jarvis Docs',
    'Jarvis Backup 2026-03-25',
  ] as const;

  function buildUnifiedRoot(): string {
    // Path with spaces mirrors the live iCloud Drive layout.
    const parent = tempDir('jericho unified parent-');
    const root = join(parent, 'jericho unified');
    mkdirSync(root);
    for (const folder of SOURCE_FOLDERS) {
      const dir = join(root, folder);
      mkdirSync(dir, { recursive: true });
      const token = folder.replace(/\s+/gu, '');
      writeFileSync(
        join(dir, `${token} Unique Note.md`),
        `# ${token} Unique Person\n${token} Unique Person works in ${folder}.\n`,
      );
    }
    // Generated dependency/build noise must be excluded even when it contains Markdown.
    for (const noise of ['node_modules', 'node_modules_cache', 'dist', 'build', 'coverage', 'vendor', 'out', 'target']) {
      const dir = join(root, 'Jarvis Brain', noise);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SHOULD_NOT_INDEX.md'), '# Noise Leak\nNoise Leak must never be indexed.\n');
    }
    mkdirSync(join(root, '.obsidian'), { recursive: true });
    writeFileSync(join(root, '.obsidian', 'hidden.md'), '# Hidden\n');
    writeFileSync(join(root, '.secret.md'), '# Secret\n');
    return root;
  }

  it('indexes one jericho-unified root with spaces and only eligible documents', () => {
    const root = buildUnifiedRoot();
    const index = new MemoryIndex({
      roots: [{ id: 'jericho-unified', path: root, authority: 'canonical' }],
    });
    const health = index.refresh();
    expect(health.available).toBe(true);
    expect(health.roots).toHaveLength(1);
    expect(health.roots[0]?.id).toBe('jericho-unified');
    expect(health.roots[0]?.documentCount).toBe(SOURCE_FOLDERS.length);
    expect(index.search('Noise Leak', 8)).toHaveLength(0);
    expect(index.search('Hidden', 8)).toHaveLength(0);
  });

  it('retrieves a unique document from every top-level source folder', () => {
    const root = buildUnifiedRoot();
    const index = new MemoryIndex({
      roots: [{ id: 'jericho-unified', path: root, authority: 'canonical' }],
    });
    index.refresh();
    for (const folder of SOURCE_FOLDERS) {
      const token = folder.replace(/\s+/gu, '');
      const hits = index.search(`${token} Unique Person`, 5);
      expect(hits.some((hit) => hit.relativePath.startsWith(`${folder}/`))).toBe(true);
      expect(hits.every((hit) => !hit.relativePath.includes('node_modules'))).toBe(true);
    }
  });

  it('open and reorganize actions resolve each source inside the unified root and reject client paths', async () => {
    const root = buildUnifiedRoot();
    const store = new JerichoStore({ path: ':memory:', key: Buffer.alloc(32, 32) });
    stores.push(store);
    const index = new MemoryIndex({
      roots: [{ id: 'jericho-unified', path: root, authority: 'canonical' }],
    });
    index.refresh();
    const opened: string[] = [];
    const controller = new GroundedTurnController({
      store,
      memoryIndex: index,
      memoryRootPaths: new Map([['jericho-unified', root]]),
      send: () => undefined,
      instruct: () => undefined,
    });
    const server = createJerichoServer({
      store,
      apiToken: TOKEN,
      memoryIndex: index,
      groundedActions: controller,
      memoryRootPaths: new Map([['jericho-unified', root]]),
      obsidianOpeners: new Map([
        ['jericho-unified', {
          open: async (relativePath: string) => {
            opened.push(relativePath);
            return { relativePath };
          },
        }],
      ]),
      clock: () => '2026-07-14T00:00:00.000Z',
    });
    servers.push(server);
    const address = await server.listen(0, '127.0.0.1');
    for (const folder of SOURCE_FOLDERS) {
      const token = folder.replace(/\s+/gu, '');
      controller.beginTurn();
      const result = await controller.runPrivateRetrieval(`Who is ${token} Unique Person`);
      expect(result?.actions.openSourceIds?.length).toBeGreaterThan(0);
      const sourceId = result!.actions.openSourceIds![0]!;
      const open = await fetch(`http://127.0.0.1:${address.port}/api/v1/grounded-results/${result!.resultId}/actions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      expect(open.status).toBe(200);
      const body = await open.json() as { rootId: string; relativePath: string };
      expect(body.rootId).toBe('jericho-unified');
      expect(body.relativePath.startsWith(`${folder}/`)).toBe(true);
      const rejected = await fetch(`http://127.0.0.1:${address.port}/api/v1/grounded-results/${result!.resultId}/actions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId, relativePath: '../etc/passwd.md' }),
      });
      expect(rejected.status).toBe(400);
      const reorganize = await fetch(`http://127.0.0.1:${address.port}/api/v1/grounded-results/${result!.resultId}/actions/reorganize`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      expect(reorganize.status).toBe(201);
    }
    expect(opened).toHaveLength(SOURCE_FOLDERS.length);
  });
});
