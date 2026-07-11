import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ObsidianRetentionWriter,
  type VerifiedMissionKnowledge,
} from '../src/retention/obsidian-writer.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('verified Obsidian retention', () => {
  it('writes a deterministic, human-readable managed note without raw artifacts or payloads', () => {
    const vault = temporaryDirectory('jericho-vault-');
    const writer = new ObsidianRetentionWriter({ vaultPath: vault });

    const first = writer.write(knowledge());
    const second = writer.write(knowledge());
    const content = readFileSync(first.absolutePath, 'utf8');

    expect(first.status).toBe('created');
    expect(second).toEqual({ ...first, status: 'unchanged' });
    expect(first.relativePath).toMatch(/^Jericho\/Missions\/mission-1-[a-f0-9]{12}\.md$/);
    expect(content).toContain('mission_id: "mission-1"');
    expect(content).toContain('# Ship the private command center');
    expect(content).toContain('Approved bounded plan');
    expect(content).toContain('telegram:message → person-paula');
    expect(content).not.toMatch(/rawArtifact|privatePayload|secret-token/);
  });

  it('rejects unverified outcomes or receipts instead of laundering them into durable memory', () => {
    const writer = new ObsidianRetentionWriter({ vaultPath: temporaryDirectory('jericho-vault-') });

    expect(() => writer.write(knowledge({ outcomes: [{
      taskId: 'task-1',
      status: 'failed',
      completedAt: '2026-07-11T05:00:00.000Z',
      evidenceEventIds: [],
    }] }))).toThrow(/verified outcome/i);
    expect(() => writer.write(knowledge({ receipts: [{
      action: 'message', destination: 'person-paula', connectorId: 'telegram',
      status: 'succeeded', verified: false, externalId: 'message-9', evidenceEventIds: [],
    }] }))).toThrow(/verified receipt/i);
  });

  it('refuses to overwrite an unmanaged note or traverse a symlink outside the vault', () => {
    const vault = temporaryDirectory('jericho-vault-');
    const writer = new ObsidianRetentionWriter({ vaultPath: vault });
    const expected = writer.pathFor('mission-1');
    mkdirSync(join(vault, 'Jericho', 'Missions'), { recursive: true });
    writeFileSync(expected.absolutePath, 'Carlos wrote this note', 'utf8');
    expect(() => writer.write(knowledge())).toThrow(/not managed by Jericho/i);

    const secondVault = temporaryDirectory('jericho-vault-');
    const outside = temporaryDirectory('jericho-outside-');
    mkdirSync(join(secondVault, 'Jericho'));
    symlinkSync(outside, join(secondVault, 'Jericho', 'Missions'));
    expect(() => new ObsidianRetentionWriter({ vaultPath: secondVault }).write(knowledge()))
      .toThrow(/outside|symbolic link/i);
  });
});

function knowledge(
  overrides: Partial<VerifiedMissionKnowledge> = {},
): VerifiedMissionKnowledge {
  return {
    missionId: 'mission-1',
    planHash: 'a'.repeat(64),
    title: 'Ship the private command center',
    objective: 'Deliver a verified, bounded Jericho mission',
    completedAt: '2026-07-11T05:00:00.000Z',
    deliverables: ['Command center', 'Verification report'],
    decisions: [{
      outcome: 'approved',
      rationale: 'Approved bounded plan',
      decidedBy: 'carlos',
      decidedAt: '2026-07-11T04:00:00.000Z',
      evidenceEventIds: ['event-request'],
    }],
    outcomes: [{
      taskId: 'task-1',
      status: 'succeeded',
      completedAt: '2026-07-11T05:00:00.000Z',
      evidenceEventIds: ['event-verification'],
    }],
    receipts: [{
      action: 'message',
      destination: 'person-paula',
      connectorId: 'telegram',
      status: 'succeeded',
      verified: true,
      externalId: 'message-9',
      evidenceEventIds: ['event-receipt'],
    }],
    evidenceEventIds: ['event-request', 'event-verification', 'event-receipt'],
    metadata: {
      rawArtifact: 'must never be rendered',
      privatePayload: 'customer:private',
      credential: 'secret-token',
    },
    ...overrides,
  };
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
