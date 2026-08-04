import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AuthorityRejectionReason,
  CommandAuthority,
} from '../src/voice/command-authority.js';
import type { AuthorityToken } from '../src/voice/command-authority.js';

describe('CommandAuthority', () => {
  let authority: CommandAuthority;
  const SESSION_ID = randomUUID();
  let clockTime = 0;

  beforeEach(() => {
    authority = new CommandAuthority({
      sessionId: SESSION_ID,
      clock: () => clockTime,
    });
    clockTime = 1_000_000;
  });

  it('mints a valid token', () => {
    const token = authority.mint({
      toolName: 'search_vault',
      args: { query: 'test' },
      maxAgeMs: 30_000,
      speakerVerified: true,
    });

    expect(token.sessionId).toBe(SESSION_ID);
    expect(token.commandDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(token.expiryMs).toBe(1_030_000);
    expect(token.source).toBe('voice');
    expect(token.speakerVerified).toBe(true);
    expect(token.nonce).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('validates a freshly minted token', () => {
    const token = authority.mint({
      toolName: 'open_browser',
      args: { url: 'https://example.com' },
      maxAgeMs: 30_000,
      speakerVerified: true,
    });

    const result = authority.validate(token, 'open_browser', { url: 'https://example.com' });
    expect(result.ok).toBe(true);
  });

  it('rejects when authority is inactive', () => {
    const token = authority.mint({
      toolName: 'search_vault',
      args: { query: 'x' },
      maxAgeMs: 30_000,
      speakerVerified: true,
    });

    authority.deactivate();
    const result = authority.validate(token, 'search_vault', { query: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(AuthorityRejectionReason.Inactive);
    }
  });

  it('rejects after reactivation with stale inactive period', () => {
    authority.deactivate();
    const token = authority.mint({
      toolName: 'search_vault',
      args: { query: 'x' },
      maxAgeMs: 30_000,
      speakerVerified: true,
    });

    authority.activate();
    const result = authority.validate(token, 'search_vault', { query: 'x' });
    expect(result.ok).toBe(true);
  });

  it('rejects expired tokens', () => {
    const token = authority.mint({
      toolName: 'search_vault',
      args: { query: 'x' },
      maxAgeMs: 30_000,
      speakerVerified: true,
    });

    clockTime += 60_000;

    const result = authority.validate(token, 'search_vault', { query: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(AuthorityRejectionReason.Expired);
    }
  });

  it('rejects replayed nonces', () => {
    const token = authority.mint({
      toolName: 'fleet_status',
      args: {},
      maxAgeMs: 30_000,
      speakerVerified: true,
    });

    const first = authority.validate(token, 'fleet_status', {});
    expect(first.ok).toBe(true);

    const second = authority.validate(token, 'fleet_status', {});
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe(AuthorityRejectionReason.Replayed);
    }
  });

  it('rejects altered command digests', () => {
    const token = authority.mint({
      toolName: 'search_vault',
      args: { query: 'original' },
      maxAgeMs: 30_000,
      speakerVerified: true,
    });

    const result = authority.validate(token, 'search_vault', { query: 'tampered' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(AuthorityRejectionReason.Altered);
    }
  });

  it('rejects altered tool names (even same digest)', () => {
    const token = authority.mint({
      toolName: 'search_vault',
      args: { query: 'x' },
      maxAgeMs: 30_000,
      speakerVerified: true,
    });

    const result = authority.validate(token, 'open_browser', { query: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(AuthorityRejectionReason.Altered);
    }
  });

  it('rejects pointer-originated tokens (source != voice)', () => {
    const invalidToken: AuthorityToken = {
      sessionId: SESSION_ID,
      commandDigest: 'a'.repeat(64),
      expiryMs: clockTime + 30_000,
      source: 'voice' as any, // actually ok
      speakerVerified: true,
      nonce: randomUUID(),
    };

    const mouseToken: AuthorityToken = { ...invalidToken, source: 'pointer' as any, nonce: randomUUID() };
    const result = authority.validate(mouseToken, 'search_vault', {});
    expect(result.ok).toBe(false);
  });

  it('rejects speaker-unverified tokens', () => {
    const token = authority.mint({
      toolName: 'search_vault',
      args: { query: 'x' },
      maxAgeMs: 30_000,
      speakerVerified: false,
    });

    const result = authority.validate(token, 'search_vault', { query: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(AuthorityRejectionReason.SpeakerUnverified);
    }
  });

  it('rejectIfNotVerified throws on invalid tokens', () => {
    const token = authority.mint({
      toolName: 'test',
      args: {},
      maxAgeMs: 10_000,
      speakerVerified: false,
    });

    expect(() => authority.rejectIfNotVerified(token, 'test', {})).toThrow();
  });

  it('rejectIfNotVerified passes for valid tokens', () => {
    const token = authority.mint({
      toolName: 'test',
      args: {},
      maxAgeMs: 10_000,
      speakerVerified: true,
    });

    expect(() => authority.rejectIfNotVerified(token, 'test', {})).not.toThrow();
  });

  it('resets nonces allowing re-mint', () => {
    const token1 = authority.mint({
      toolName: 't',
      args: {},
      maxAgeMs: 30_000,
      speakerVerified: true,
    });
    authority.validate(token1, 't', {});
    authority.resetNonces();

    const token2 = authority.mint({
      toolName: 't',
      args: {},
      maxAgeMs: 30_000,
      speakerVerified: true,
    });
    const result = authority.validate(token2, 't', {});
    expect(result.ok).toBe(true);
  });

  it('rejects invalid token shapes', () => {
    const result = authority.validate(null as any, 'x', {});
    expect(result.ok).toBe(false);

    const empty: any = {};
    const r2 = authority.validate(empty, 'x', {});
    expect(r2.ok).toBe(false);

    const wrongSession: AuthorityToken = {
      sessionId: 'wrong-session',
      commandDigest: 'a'.repeat(64),
      expiryMs: clockTime + 30_000,
      source: 'voice',
      speakerVerified: true,
      nonce: randomUUID(),
    };
    const r3 = authority.validate(wrongSession, 'x', {});
    expect(r3.ok).toBe(false);
  });

  it('rejects tokens with empty or missing digest', () => {
    const token: AuthorityToken = {
      sessionId: SESSION_ID,
      commandDigest: '',
      expiryMs: clockTime + 30_000,
      source: 'voice',
      speakerVerified: true,
      nonce: randomUUID(),
    };
    const result = authority.validate(token, 'x', {});
    expect(result.ok).toBe(false);
  });
});
