import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import {
  HandTrackManager,
  type RawHandObservation,
  type TrackedHandFrame,
} from './hand-tracks';
import {
  hasOpenPalmGeometry,
  normalizedPinchRatio,
  palmAnchor,
  pinchPoint,
  type Handedness,
  type Landmark,
} from './tracking';

export type { TrackedHandFrame } from './hand-tracks';
export type { GestureState, Handedness, Landmark, PinchPhase, Point } from './tracking';

export interface GestureFrame {
  hands: TrackedHandFrame[];
  left?: TrackedHandFrame;
  right?: TrackedHandFrame;
  timestamp: number;
  fps: number;
  inferenceMs: number;
}

const WASM_URL = '/mediapipe/wasm';
const MODEL_URL = '/mediapipe/models/gesture_recognizer.task';

export class GestureEngine {
  private recognizer: GestureRecognizer | null = null;
  private raf = 0;
  private running = false;
  private lastVideoTime = -1;
  private lastFrameAt = 0;
  private fps = 0;
  private swapHands = localStorage.getItem('jericho.swap-hands') === 'true';
  private readonly tracks = new HandTrackManager();

  private constructor(private readonly video: HTMLVideoElement) {}

  static async create(video: HTMLVideoElement): Promise<GestureEngine> {
    const engine = new GestureEngine(video);
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    engine.recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.5,
    });
    return engine;
  }

  setSwapHands(swapped: boolean) {
    this.swapHands = swapped;
    localStorage.setItem('jericho.swap-hands', String(swapped));
  }

  start(onFrame: (frame: GestureFrame) => void) {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      if (this.video.currentTime !== this.lastVideoTime && this.recognizer) {
        this.lastVideoTime = this.video.currentTime;
        const elapsed = now - this.lastFrameAt;
        if (elapsed > 0) this.fps = this.fps ? this.fps * 0.85 + (1000 / elapsed) * 0.15 : 1000 / elapsed;
        this.lastFrameAt = now;
        const inferenceStarted = performance.now();
        const result = this.recognizer.recognizeForVideo(this.video, now);
        const inferenceMs = performance.now() - inferenceStarted;
        const observations: RawHandObservation[] = [];

        for (let index = 0; index < (result.landmarks?.length ?? 0); index++) {
          const landmarks = result.landmarks[index] as Landmark[];
          if (landmarks.length < 21) continue;
          const label = result.handednesses[index]?.[0]?.categoryName;
          if (label !== 'Left' && label !== 'Right') continue;
          const rawHandedness = label as Handedness;
          const handednessConfidence = result.handednesses[index]?.[0]?.score ?? 0;
          const gesture = result.gestures[index]?.[0];
          const rawAnchor = palmAnchor(landmarks);
          const rawPinch = pinchPoint(landmarks);
          observations.push({
            rawHandedness,
            handednessConfidence,
            recognizedGesture: gesture?.categoryName ?? 'None',
            gestureConfidence: gesture?.score ?? 0,
            confidence: Math.max(handednessConfidence, gesture?.score ?? 0),
            landmarks,
            palmAnchor: { x: 1 - rawAnchor.x, y: rawAnchor.y },
            pinchPoint: { x: 1 - rawPinch.x, y: rawPinch.y },
            pinchRatio: normalizedPinchRatio(landmarks),
            atFrameEdge: rawAnchor.x < 0.04 || rawAnchor.x > 0.96 || rawAnchor.y < 0.04 || rawAnchor.y > 0.96,
            openPalm:
              (gesture?.categoryName === 'Open_Palm' && (gesture.score ?? 0) >= 0.5) ||
              hasOpenPalmGeometry(landmarks),
          });
        }

        const hands = this.tracks.update(observations, now, this.swapHands);
        onFrame({
          hands,
          left: hands.find((hand) => hand.handedness === 'Left'),
          right: hands.find((hand) => hand.handedness === 'Right'),
          timestamp: now,
          fps: this.fps,
          inferenceMs,
        });
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.tracks.reset();
  }

  dispose() {
    this.stop();
    this.recognizer?.close();
    this.recognizer = null;
  }
}
