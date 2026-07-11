import { ReflectionScheduler } from '../reflection/reflection-engine.js';
import type { JerichoStore } from '../core/store.js';
import {
  MissionKnowledgeRetentionService,
  ReflectionReviewService,
} from './knowledge-services.js';
import { ObsidianRetentionWriter } from './obsidian-writer.js';

export interface KnowledgeRuntimeOptions {
  store: JerichoStore;
  reflectionIntervalMs: number;
  obsidianVaultPath?: string;
  clock?: () => string;
}

/** Owns the review-only reflection loop and optional verified Obsidian writer. */
export class KnowledgeRuntime {
  readonly reflection: ReflectionReviewService;
  readonly retention?: MissionKnowledgeRetentionService;
  readonly #scheduler: ReflectionScheduler;

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
  }

  start(): Promise<void> {
    return this.#scheduler.start();
  }

  stop(): Promise<void> {
    return this.#scheduler.stop();
  }
}

