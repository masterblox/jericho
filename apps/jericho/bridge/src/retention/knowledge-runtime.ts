import { ReflectionScheduler } from '../reflection/reflection-engine.js';
import type { JerichoStore } from '../core/store.js';
import {
  ReflectionReviewService,
} from './knowledge-services.js';
import { ObsidianRetentionWriter } from './obsidian-writer.js';
import type { VaultGatewayPort } from '../vault/vault-gateway-client.js';
import { VaultMaintenanceScheduler } from './vault-maintenance.js';
import { KnowledgeDestination, ReceiptStatus, type ProjectionReceipt } from '@jericho/shared';
import { FleetKnowledgeService } from '../knowledge/fleet-knowledge.js';

export interface KnowledgeRuntimeOptions {
  store: JerichoStore;
  reflectionIntervalMs: number;
  obsidianVaultPath?: string;
  clock?: () => string;
  vaultGateway?: VaultGatewayPort;
  vaultMaintenanceIntervalMs?: number;
  vaultRebuildWindowStartUtc?: number;
  vaultRebuildWindowEndUtc?: number;
}

/** Owns the review-only reflection loop and optional verified Obsidian writer. */
export class KnowledgeRuntime {
  readonly reflection: ReflectionReviewService;
  readonly fleet: FleetKnowledgeService;
  readonly retention?: { retainMission(missionId: string): { relativePath: string; status: 'created' | 'updated' | 'unchanged' } };
  readonly #scheduler: ReflectionScheduler;
  readonly #vaultMaintenance?: VaultMaintenanceScheduler;

  constructor(options: KnowledgeRuntimeOptions) {
    this.reflection = new ReflectionReviewService(options.store);
    this.fleet = new FleetKnowledgeService(options.store, options.clock);
    if (options.obsidianVaultPath) {
      const writer = new ObsidianRetentionWriter({ vaultPath: options.obsidianVaultPath });
      this.retention = {
        retainMission: (missionId) => {
          const knowledge = this.fleet.createPackage(missionId);
          const projection = this.fleet.createProjection(
            knowledge.id,
            KnowledgeDestination.Obsidian,
            ['title', 'objective', 'deliverables', 'decisions', 'outcomes', 'receipts', 'evidence'],
          );
          const result = writer.writePackage(knowledge);
          const attemptedAt = new Date(options.clock?.() ?? Date.now()).toISOString();
          const receipt: ProjectionReceipt = {
            id: `projection-receipt-${projection.id}`,
            projectionId: projection.id,
            packageId: knowledge.id,
            packageHash: knowledge.packageHash,
            destination: KnowledgeDestination.Obsidian,
            status: ReceiptStatus.Succeeded,
            relativePath: result.relativePath,
            verified: true,
            attemptedAt,
            verifiedAt: attemptedAt,
          };
          this.fleet.recordProjectionReceipt(receipt);
          return result;
        },
      };
    }
    this.#scheduler = new ReflectionScheduler({
      intervalMs: options.reflectionIntervalMs,
      clock: options.clock,
      load: () => ({
        intents: options.store.listIntents(),
        missions: options.store.listMissions(),
        decisions: options.store.listDecisions(),
      }),
      publish: (suggestions) => { this.reflection.publish(suggestions); },
    });
    this.#vaultMaintenance = options.vaultGateway
      ? new VaultMaintenanceScheduler({
          gateway: options.vaultGateway,
          intervalMs: options.vaultMaintenanceIntervalMs ?? 10 * 60_000,
          windowStartUtcHour: options.vaultRebuildWindowStartUtc ?? 1,
          windowEndUtcHour: options.vaultRebuildWindowEndUtc ?? 5,
          clock: options.clock,
        })
      : undefined;
  }

  async start(): Promise<void> {
    await this.#scheduler.start();
    await this.#vaultMaintenance?.start();
  }

  async stop(): Promise<void> {
    await this.#vaultMaintenance?.stop();
    await this.#scheduler.stop();
  }
}
