import {
  EntityType,
  LifecycleStatus,
  RiskLevel,
  SourceType,
  type Entity,
} from '@jericho/shared';

import { JerichoStore } from '../../src/core/store.js';

const [databasePath, encodedKey, workerId] = process.argv.slice(2);
if (!databasePath || !encodedKey || workerId === undefined) {
  throw new Error('database path, key, and worker ID are required');
}

const entity: Entity = {
  id: 'entity-concurrent',
  type: EntityType.Person,
  canonicalName: 'Concurrent Entity',
  aliases: [`alias-${workerId}`],
  attributes: { [`field${workerId}`]: `value-${workerId}` },
  status: LifecycleStatus.Active,
  risk: RiskLevel.Low,
  confidence: 0.9,
  freshness: { observedAt: '2026-07-11T01:00:00.000Z' },
  provenance: [
    {
      source: `worker-${workerId}`,
      sourceType: SourceType.System,
      sourceEventId: `worker-event-${workerId}`,
      observedAt: '2026-07-11T01:00:00.000Z',
    },
  ],
  createdAt: '2026-07-11T01:00:00.000Z',
  updatedAt: '2026-07-11T01:00:00.000Z',
};

const store = new JerichoStore({
  path: databasePath,
  key: Buffer.from(encodedKey, 'base64'),
});
try {
  store.upsertEntity(entity);
} finally {
  store.close();
}
