import { describe, expect, it } from 'vitest';

import { assertEventEnvelope } from '@jericho/shared';

describe('assertEventEnvelope', () => {
  it('accepts a JSON-serializable event at the ingestion boundary', () => {
    const event: unknown = {
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
    };

    expect(() => assertEventEnvelope(event)).not.toThrow();
  });

  it('rejects non-JSON payload values at the ingestion boundary', () => {
    const event = {
      id: 'evt-2',
      source: 'local',
      sourceType: 'system',
      sourceEventId: 'local-2',
      type: 'invalid.payload',
      occurredAt: '2026-07-11T00:00:00.000Z',
      ingestedAt: '2026-07-11T00:00:01.000Z',
      payload: { missing: undefined },
      provenance: [],
    };

    expect(() => assertEventEnvelope(event)).toThrow(
      'Event envelope payload must be JSON-serializable',
    );
  });
});
