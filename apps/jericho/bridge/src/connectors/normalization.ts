import { createHash } from 'node:crypto';

import {
  SourceType,
  type EventEnvelope,
  type JsonValue,
} from '@jericho/shared';

export function stableConnectorEvent(input: {
  source: string;
  sourceEventId: string;
  type: string;
  occurredAt: string;
  payload: JsonValue;
}): EventEnvelope {
  const digest = createHash('sha256')
    .update(`${input.source}\0${input.sourceEventId}`)
    .digest('hex')
    .slice(0, 32);
  return {
    id: `${input.source}-${digest}`,
    source: input.source,
    sourceType: SourceType.Connector,
    sourceEventId: input.sourceEventId,
    type: input.type,
    occurredAt: input.occurredAt,
    // Source-version time is deliberate: local poll time must not make replay conflict.
    ingestedAt: input.occurredAt,
    payload: structuredClone(input.payload),
    provenance: [{
      source: input.source,
      sourceType: SourceType.Connector,
      sourceEventId: input.sourceEventId,
      observedAt: input.occurredAt,
    }],
  };
}
