import {
  KnowledgeDestination,
  LifecycleStatus,
  ReceiptStatus,
  type JsonObject,
  type KnowledgePackage,
  type KnowledgeProjection,
  type ProjectionReceipt,
} from '@jericho/shared';

export interface NotionProjectionPort {
  upsertPage(input: {
    idempotencyKey: string;
    fields: JsonObject;
  }, signal: AbortSignal): Promise<{ pageId: string }>;
}

export class NotionProjectionWriter {
  constructor(
    private readonly port: NotionProjectionPort,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async write(
    knowledge: KnowledgePackage,
    projection: KnowledgeProjection,
    signal = new AbortController().signal,
  ): Promise<ProjectionReceipt> {
    if (
      projection.destination !== KnowledgeDestination.Notion ||
      projection.status !== LifecycleStatus.Approved ||
      projection.packageId !== knowledge.id ||
      projection.packageHash !== knowledge.packageHash
    ) throw new Error('Notion projection is not explicitly approved or bound');
    const attemptedAt = new Date(this.clock()).toISOString();
    const fields = allowedFields(knowledge, projection.approvedFieldNames, projection.redactedFieldNames);
    try {
      const response = await this.port.upsertPage({ idempotencyKey: projection.id, fields }, signal);
      return {
        id: `projection-receipt-${projection.id}`,
        projectionId: projection.id,
        packageId: knowledge.id,
        packageHash: knowledge.packageHash,
        destination: KnowledgeDestination.Notion,
        status: ReceiptStatus.Succeeded,
        externalId: response.pageId,
        verified: true,
        attemptedAt,
        verifiedAt: attemptedAt,
      };
    } catch {
      return {
        id: `projection-receipt-${projection.id}`,
        projectionId: projection.id,
        packageId: knowledge.id,
        packageHash: knowledge.packageHash,
        destination: KnowledgeDestination.Notion,
        status: ReceiptStatus.Pending,
        verified: false,
        attemptedAt,
      };
    }
  }
}

function allowedFields(
  knowledge: KnowledgePackage,
  allowlist: string[],
  redactions: string[],
): JsonObject {
  const source = knowledge as unknown as Record<string, unknown>;
  const blocked = new Set(redactions);
  return Object.fromEntries(allowlist.flatMap((key) => {
    const value = source[key];
    if (blocked.has(key) || value === undefined || !jsonValue(value)) return [];
    return [[key, value]];
  })) as JsonObject;
}

function jsonValue(value: unknown): boolean {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(jsonValue);
  return typeof value === 'object' && Object.values(value as Record<string, unknown>).every(jsonValue);
}
