import { describe, expect, it } from 'vitest';

import {
  assertConnectorHealth,
  assertEntity,
  assertEventEnvelope,
  assertRelation,
} from '@jericho/shared';

describe('assertEventEnvelope', () => {
  it('accepts a JSON-serializable event at the ingestion boundary', () => {
    const event: unknown = makeValidEvent();

    expect(() => assertEventEnvelope(event)).not.toThrow();
  });

  it('accepts canonical RFC3339 offsets', () => {
    const event = makeValidEvent({
      occurredAt: '2026-07-11T04:00:00+04:00',
      freshness: { observedAt: '2026-07-11T04:00:00+04:00' },
    });

    expect(() => assertEventEnvelope(event)).not.toThrow();
  });

  it('rejects non-JSON payload values at the ingestion boundary', () => {
    const event = makeValidEvent({
      payload: { missing: undefined },
    });

    expect(() => assertEventEnvelope(event)).toThrow(
      'Event envelope payload must be JSON-serializable',
    );
  });

  it('rejects sparse JSON arrays', () => {
    const sparse: unknown[] = [];
    sparse[1] = 'value';

    expect(() => assertEventEnvelope(makeValidEvent({ payload: sparse }))).toThrow(
      'Event envelope payload must be JSON-serializable',
    );
  });

  it.each([
    ['sourceType', { sourceType: 'email' }],
    ['status', { status: 'done' }],
    ['route', { route: 'cloud' }],
    ['risk', { risk: 'extreme' }],
  ])('rejects an invalid %s enum', (_field, override) => {
    expect(() => assertEventEnvelope(makeValidEvent(override))).toThrow(TypeError);
  });

  it.each([
    ['occurredAt', { occurredAt: '2026-07-11 00:00:00Z' }],
    ['ingestedAt', { ingestedAt: '2026-02-30T00:00:00.000Z' }],
    ['freshness.observedAt', { freshness: { observedAt: 'yesterday' } }],
  ])('rejects a non-canonical %s timestamp', (_field, override) => {
    expect(() => assertEventEnvelope(makeValidEvent(override))).toThrow(TypeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])(
    'rejects invalid confidence %s',
    (confidence) => {
      expect(() =>
        assertEventEnvelope(makeValidEvent({ confidence })),
      ).toThrow(TypeError);
    },
  );

  it('validates nested freshness and provenance fields', () => {
    const event = makeValidEvent({
      freshness: {
        observedAt: '2026-07-11T00:00:00.000Z',
        status: 'expired',
      },
      provenance: [
        {
          source: '',
          sourceType: 'connector',
          observedAt: '2026-07-11T00:00:00.000Z',
          confidence: Number.NaN,
        },
      ],
    });

    expect(() => assertEventEnvelope(event)).toThrow(TypeError);
  });

  it('validates an optional integrity hash', () => {
    expect(() =>
      assertEventEnvelope(makeValidEvent({ integrityHash: 'not-a-digest' })),
    ).toThrow(TypeError);
  });
});

describe('truth-store record assertions', () => {
  it('accepts complete entity, relation, and connector-health values', () => {
    expect(() => assertEntity(makeValidEntity())).not.toThrow();
    expect(() => assertRelation(makeValidRelation())).not.toThrow();
    expect(() => assertConnectorHealth(makeValidHealth())).not.toThrow();
  });

  it('rejects invalid entity values', () => {
    expect(() =>
      assertEntity(
        makeValidEntity({
          type: 'contact',
          attributes: { invalid: new Date() },
          freshness: { observedAt: 'not-a-time' },
        }),
      ),
    ).toThrow(TypeError);
  });

  it('rejects empty entity aliases', () => {
    expect(() => assertEntity(makeValidEntity({ aliases: [''] }))).toThrow(
      TypeError,
    );
  });

  it('rejects invalid relation values', () => {
    const aliases: unknown[] = [];
    aliases[2] = 'sparse';
    expect(() =>
      assertRelation(
        makeValidRelation({
          type: 'knows',
          confidence: Number.POSITIVE_INFINITY,
          attributes: { aliases },
        }),
      ),
    ).toThrow(TypeError);
  });

  it('rejects invalid connector-health values', () => {
    expect(() =>
      assertConnectorHealth(
        makeValidHealth({
          status: 'online',
          latencyMs: Number.NaN,
          consecutiveFailures: -1,
          details: { token: undefined },
        }),
      ),
    ).toThrow(TypeError);
  });
});

function makeValidEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    source: 'gmail',
    sourceType: 'connector',
    sourceEventId: 'message-9',
    type: 'message.received',
    occurredAt: '2026-07-11T00:00:00.000Z',
    ingestedAt: '2026-07-11T00:00:01.000Z',
    payload: { subject: 'Quarterly plan', unread: true },
    confidence: 0.98,
    risk: 'low',
    route: 'connector',
    freshness: { observedAt: '2026-07-11T00:00:00.000Z' },
    provenance: [
      {
        source: 'gmail',
        sourceType: 'connector',
        sourceEventId: 'message-9',
        observedAt: '2026-07-11T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function makeValidEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entity-1',
    type: 'person',
    canonicalName: 'Carlos',
    aliases: ['C. Prada'],
    attributes: { timezone: 'Asia/Dubai' },
    status: 'active',
    risk: 'low',
    confidence: 0.9,
    freshness: { observedAt: '2026-07-11T00:00:00.000Z' },
    provenance: [
      {
        source: 'user',
        sourceType: 'user',
        observedAt: '2026-07-11T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    ...overrides,
  };
}

function makeValidRelation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'relation-1',
    fromEntityId: 'entity-1',
    toEntityId: 'entity-2',
    type: 'member_of',
    attributes: { role: 'owner' },
    status: 'active',
    risk: 'low',
    confidence: 0.9,
    freshness: { observedAt: '2026-07-11T00:00:00.000Z' },
    provenance: [
      {
        source: 'user',
        sourceType: 'user',
        observedAt: '2026-07-11T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    ...overrides,
  };
}

function makeValidHealth(overrides: Record<string, unknown> = {}) {
  return {
    connectorId: 'gmail',
    status: 'healthy',
    checkedAt: '2026-07-11T00:00:00.000Z',
    lastSuccessAt: '2026-07-11T00:00:00.000Z',
    latencyMs: 100,
    consecutiveFailures: 0,
    freshness: { observedAt: '2026-07-11T00:00:00.000Z' },
    details: { account: 'primary' },
    provenance: [
      {
        source: 'monitor',
        sourceType: 'system',
        observedAt: '2026-07-11T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}
