import type { CommandCenterSnapshot } from '@jericho/shared';

import type {
  CommandCenterPatch,
  CommandCenterState,
} from './command-center-types';

export type PatchResult = 'applied' | 'stale' | 'gap';

const INITIAL_STATE: CommandCenterState = {
  status: 'idle',
  needsRefetch: false,
};

export class CommandCenterStore {
  #state: CommandCenterState = INITIAL_STATE;
  readonly #listeners = new Set<() => void>();

  getSnapshot = (): CommandCenterState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  loading(): void {
    this.#set({ ...this.#state, status: 'loading', error: undefined, needsRefetch: false });
  }

  replace(snapshot: CommandCenterSnapshot): boolean {
    const currentSequence = this.#state.snapshot?.lastChangeSequence ?? -1;
    if (snapshot.lastChangeSequence < currentSequence) return false;
    if (
      snapshot.lastChangeSequence === currentSequence &&
      this.#state.status === 'ready' &&
      this.#state.snapshot?.revision === snapshot.revision
    ) {
      return false;
    }
    this.#set({ status: 'ready', snapshot, needsRefetch: false });
    return true;
  }

  applyPatch(update: CommandCenterPatch): PatchResult {
    const snapshot = this.#state.snapshot;
    if (!snapshot || update.sequence > snapshot.lastChangeSequence + 1) {
      this.#set({ ...this.#state, status: 'loading', needsRefetch: true });
      return 'gap';
    }
    if (update.sequence <= snapshot.lastChangeSequence) return 'stale';
    this.#set({
      status: 'ready',
      snapshot: {
        ...snapshot,
        ...update.patch,
        lastChangeSequence: update.sequence,
      },
      needsRefetch: false,
    });
    return 'applied';
  }

  gap(): void {
    this.#set({ ...this.#state, status: 'loading', needsRefetch: true });
  }

  disconnected(error = 'Live updates disconnected'): void {
    this.#set({ ...this.#state, status: 'disconnected', error, needsRefetch: false });
  }

  unavailable(error = 'Jericho Core unavailable'): void {
    this.#set({ ...this.#state, status: 'unavailable', error, needsRefetch: false });
  }

  #set(state: CommandCenterState): void {
    if (state.error === undefined) delete state.error;
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
