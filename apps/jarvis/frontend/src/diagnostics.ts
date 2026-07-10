import type { GestureFrame } from './gestures';
import type { CoordinatorAction } from './gesture-coordinator';

export interface DiagnosticSnapshot {
  timestamp: number;
  frame: GestureFrame;
  actions: CoordinatorAction[];
  scrollTop: number;
  leftTarget: string | null;
  rightTarget: string | null;
}

export class DiagnosticRecorder {
  private snapshots: DiagnosticSnapshot[] = [];

  constructor(private readonly durationMs = 30_000) {}

  record(snapshot: DiagnosticSnapshot) {
    this.snapshots.push(snapshot);
    const cutoff = snapshot.timestamp - this.durationMs;
    while (this.snapshots.length && this.snapshots[0].timestamp < cutoff) this.snapshots.shift();
  }

  export(): string {
    return JSON.stringify({ version: 1, durationMs: this.durationMs, snapshots: this.snapshots }, null, 2);
  }

  get size(): number {
    return this.snapshots.length;
  }
}
