import type { GestureFrame } from './gestures';
import type { GestureState, Handedness, PinchPhase } from './tracking';

export interface DiagnosticActionInput {
  channel: 'left' | 'right';
  action: { type: string };
}

export interface DiagnosticInput {
  timestamp: number;
  frame: GestureFrame;
  actions: DiagnosticActionInput[];
  scrollTop: number;
  leftTarget: string | null;
  rightTarget: string | null;
}

export interface SanitizedDiagnosticSnapshot {
  timestamp: number;
  performance: { fps: number; inferenceMs: number };
  hands: Array<{
    handedness: Handedness;
    state: GestureState;
    fresh: boolean;
    lossAgeMs: number;
    pinchPhase: PinchPhase;
    pinchRatio: number;
    recognizedGesture?: string;
  }>;
  actions: Array<{ channel: 'left' | 'right'; type: string }>;
  scrollTop: number;
  targets: { leftAcquired: boolean; rightAcquired: boolean };
}

/** Rolling, memory-only telemetry. Raw sensor and private application data never enter the buffer. */
export class DiagnosticRecorder {
  private snapshots: SanitizedDiagnosticSnapshot[] = [];

  constructor(private readonly durationMs = 30_000) {}

  record(input: DiagnosticInput) {
    const snapshot: SanitizedDiagnosticSnapshot = {
      timestamp: Math.round(input.timestamp),
      performance: {
        fps: round(input.frame.fps, 1),
        inferenceMs: round(input.frame.inferenceMs, 1),
      },
      hands: input.frame.hands.map((hand) => ({
        handedness: hand.handedness,
        state: hand.state,
        fresh: hand.fresh,
        lossAgeMs: Math.round(hand.lossAgeMs),
        pinchPhase: hand.pinchPhase,
        pinchRatio: round(hand.pinchRatio, 2),
        recognizedGesture: hand.recognizedGesture,
      })),
      actions: input.actions.map(({ channel, action }) => ({ channel, type: action.type })),
      scrollTop: Math.round(input.scrollTop),
      targets: {
        leftAcquired: input.leftTarget !== null,
        rightAcquired: input.rightTarget !== null,
      },
    };
    this.snapshots.push(snapshot);
    const cutoff = snapshot.timestamp - this.durationMs;
    while (this.snapshots.length && this.snapshots[0].timestamp < cutoff) this.snapshots.shift();
  }

  export(): string {
    return JSON.stringify({ version: 2, durationMs: this.durationMs, snapshots: this.snapshots }, null, 2);
  }

  latest(): SanitizedDiagnosticSnapshot | undefined {
    const snapshot = this.snapshots.at(-1);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  get size(): number {
    return this.snapshots.length;
  }
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
