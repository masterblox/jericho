import { ReflectionScheduler } from '../reflection/reflection-engine.js';
import type { JerichoStore } from '../core/store.js';
import {
  MissionKnowledgeRetentionService,
  ReflectionReviewService,
} from './knowledge-services.js';
import { ObsidianRetentionWriter } from './obsidian-writer.js';
import type { VaultGatewayPort } from '../vault/vault-gateway-client.js';
import { VaultMaintenanceScheduler } from './vault-maintenance.js';

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
  readonly retention?: MissionKnowledgeRetentionService;
  readonly #scheduler: ReflectionScheduler;
  readonly #vaultMaintenance?: VaultMaintenanceScheduler;

  constructor(options: KnowledgeRuntimeOptions) {
    this.reflection = new ReflectionReviewService(options.store);
    this.retention = options.obsidianVaultPath
      ? new MissionKnowledgeRetentionService(
        options.store,
        new ObsidianRetentionWriter({ vaultPath: options.obsidianVaultPath }),
      )
      : undefined;
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
