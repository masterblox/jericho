import { BridgeClient, type BridgeEvents } from './bridge-client';
import {
  CALIBRATION_ORDER,
  TARGET_POINTS,
  StableSampleBuffer,
  applyCalibration,
  createCalibrationProfile,
  loadCalibration,
  resetCalibrations,
  saveCalibration,
  type CalibrationProfile,
  type CalibrationSample,
} from './calibration';
import { ContextHoldController, type ContextHoldAction } from './context-hold-controller';
import { mapHandToScreen } from './coords';
import { DiagnosticRecorder, type DiagnosticActionInput } from './diagnostics';
import { GestureCoordinator } from './gesture-coordinator';
import {
  GestureSurfaceRenderer,
  type GestureSurfacePort,
  type GestureSurfaceView,
} from './gesture-surface-renderer';
import {
  GestureTargetRegistry,
  observeDomGestureTargets,
  type ResolvedGestureTarget,
} from './gesture-target-registry';
import { GestureEngine, type GestureFrame } from './gestures';
import type { TrackedHandFrame } from './hand-tracks';
import { pointInsideTarget } from './hit-testing';
import type { Handedness, Point } from './tracking';

export type { GestureSurfacePort } from './gesture-surface-renderer';

export interface RuntimeVideoPort {
  srcObject: MediaProvider | null;
  muted: boolean;
  playsInline: boolean;
  play(): Promise<void>;
  pause(): void;
  videoWidth?: number;
  videoHeight?: number;
}

export interface GestureEngineRuntimePort {
  start(onFrame: (frame: GestureFrame) => void): void;
  stop(): void;
  dispose(): void | Promise<void>;
  setSwapHands?(swapped: boolean): void;
}

export interface BridgeRuntimePort {
  start(): void | Promise<void>;
  wake(): void;
  dispose(): void | Promise<void>;
}

export interface RuntimeMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export interface RuntimeEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface RuntimeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface JarvisRuntimeOptions {
  root: HTMLElement;
  registry: GestureTargetRegistry;
  renderer?: GestureSurfacePort;
  mediaDevices?: RuntimeMediaDevices;
  createVideo?: () => RuntimeVideoPort;
  createGestureEngine?: (video: RuntimeVideoPort) => Promise<GestureEngineRuntimePort>;
  createBridge?: (events: BridgeEvents) => BridgeRuntimePort;
  eventTarget?: RuntimeEventTarget;
  viewport?: () => { width: number; height: number };
  observeTargets?: (root: ParentNode, registry: GestureTargetRegistry) => () => void;
  storage?: RuntimeStorage;
  diagnosticsExporter?: (contents: string) => void;
}

/**
 * User-engaged, disposable boundary around camera, MediaPipe and voice. It
 * forwards semantic gestures only and never stores audio, frames or landmarks.
 */
export class JarvisRuntime {
  private readonly root: HTMLElement;
  private readonly registry: GestureTargetRegistry;
  private readonly renderer: GestureSurfacePort;
  private readonly mediaDevices: RuntimeMediaDevices;
  private readonly createVideo: () => RuntimeVideoPort;
  private readonly createGestureEngine: (video: RuntimeVideoPort) => Promise<GestureEngineRuntimePort>;
  private readonly createBridge: (events: BridgeEvents) => BridgeRuntimePort;
  private readonly eventTarget: RuntimeEventTarget;
  private readonly viewport: () => { width: number; height: number };
  private readonly observeTargets: (root: ParentNode, registry: GestureTargetRegistry) => () => void;
  private readonly storage: RuntimeStorage;
  private readonly diagnosticsExporter: (contents: string) => void;
  private readonly coordinator = new GestureCoordinator();
  private readonly context = new ContextHoldController();
  private readonly recorder = new DiagnosticRecorder();

  private engagePromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private stream: MediaStream | null = null;
  private video: RuntimeVideoPort | null = null;
  private engine: GestureEngineRuntimePort | null = null;
  private bridge: BridgeRuntimePort | null = null;
  private stopObserving: (() => void) | null = null;
  private engaged = false;
  private paused = false;
  private disposed = false;
  private keyListenerAttached = false;
  private status = 'gesture runtime standby';
  private cameraId = 'default';
  private cameraAspectRatio = 16 / 9;
  private readonly profiles = new Map<Handedness, CalibrationProfile>();
  private readonly suppressUntilPalm = new Set<Handedness>();
  private swapped = false;
  private diagnosticsEnabled = false;
  private calibrationHand: Handedness | null = null;
  private calibrationIndex = 0;
  private calibrationSamples: CalibrationSample[] = [];
  private calibrationPreviousPinch = false;
  private readonly calibrationBuffer = new StableSampleBuffer();

  constructor(options: JarvisRuntimeOptions) {
    this.root = options.root;
    this.registry = options.registry;
    this.renderer = options.renderer ?? new GestureSurfaceRenderer(options.root.ownerDocument);
    this.mediaDevices = options.mediaDevices ?? navigator.mediaDevices;
    this.createVideo = options.createVideo ?? (() => defaultVideo(options.root.ownerDocument));
    this.createGestureEngine = options.createGestureEngine ?? (async (video) =>
      GestureEngine.create(video as HTMLVideoElement));
    this.createBridge = options.createBridge ?? ((events) => new BridgeClient(events));
    this.eventTarget = options.eventTarget ?? options.root.ownerDocument;
    this.viewport = options.viewport ?? (() => ({ width: window.innerWidth, height: window.innerHeight }));
    this.observeTargets = options.observeTargets ?? observeDomGestureTargets;
    this.storage = options.storage ?? browserStorage(options.root.ownerDocument);
    this.diagnosticsExporter = options.diagnosticsExporter ?? ((contents) =>
      downloadDiagnostics(options.root.ownerDocument, contents));
    this.swapped = safeGet(this.storage, 'jericho.swap-hands') === 'true';
    this.renderer.configureControls({
      calibrate: (handedness) => this.startCalibration(handedness),
      reset: () => this.resetCalibration(),
      swap: () => this.toggleSwap(),
      diagnostics: () => this.toggleDiagnostics(),
      exportDiagnostics: () => this.diagnosticsExporter(this.recorder.export()),
    });
    this.updateControlState();
  }

  engage(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Jarvis runtime is disposed'));
    if (this.engaged) return Promise.resolve();
    if (!this.engagePromise) this.engagePromise = this.engageInternal();
    return this.engagePromise;
  }

  pause(): void {
    if (!this.engaged || this.paused || this.disposed) return;
    this.paused = true;
    this.engine?.stop();
    this.dispatchContextActions(this.context.cancel());
    this.coordinator.cancelAll();
    this.registry.releaseSticky();
    this.renderer.hideActionRing();
    this.root.classList.add('gestures-frozen');
    this.setStatus('gestures paused · keyboard active');
  }

  resume(): void {
    if (!this.engaged || !this.paused || this.disposed || !this.engine) return;
    this.paused = false;
    this.root.classList.remove('gestures-frozen');
    this.engine.start(this.onFrame);
    this.setStatus('gestures online');
  }

  wake(): void {
    this.bridge?.wake();
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = this.disposeInternal();
    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    await this.engagePromise?.catch(() => undefined);
    if (this.keyListenerAttached) {
      this.eventTarget.removeEventListener('keydown', this.onKeyDown);
      this.keyListenerAttached = false;
    }
    this.stopObserving?.();
    this.stopObserving = null;
    this.context.cancel();
    this.coordinator.cancelAll();
    this.registry.releaseSticky();
    this.root.classList.remove('gestures-frozen');

    const engine = this.engine;
    this.engine = null;
    if (engine) {
      engine.stop();
      await engine.dispose();
    }
    const bridge = this.bridge;
    this.bridge = null;
    if (bridge) await bridge.dispose();
    this.releaseVideoAndStream();
    this.renderer.dispose();
    this.engaged = false;
  }

  private async engageInternal(): Promise<void> {
    this.setStatus('requesting local camera');
    this.stopObserving = this.observeTargets(this.root.ownerDocument, this.registry);
    try {
      this.stream = await this.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: false,
      });
      this.assertNotDisposed();
      this.video = this.createVideo();
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.stream;
      await this.video.play();
      this.assertNotDisposed();
      this.configureCamera();
      this.engine = await this.createGestureEngine(this.video);
      this.assertNotDisposed();
      this.engine.setSwapHands?.(this.swapped);
      this.bridge = this.createBridge({
        onReady: () => this.setStatus('voice and gestures online'),
        onStatus: (value) => this.setStatus(`voice ${value}`),
        onToolStart: (name) => this.setStatus(`agent action · ${name}`),
        onToolResult: (name) => this.setStatus(`agent action complete · ${name}`),
        onError: (message) => this.setStatus(`voice unavailable · ${message}`),
      });
      this.assertNotDisposed();
      this.engine.start(this.onFrame);
      await this.bridge.start();
      this.assertNotDisposed();
      this.eventTarget.addEventListener('keydown', this.onKeyDown);
      this.keyListenerAttached = true;
      this.engaged = true;
      this.setStatus('gestures online');
    } catch (error) {
      this.stopObserving?.();
      this.stopObserving = null;
      if (this.engine) {
        this.engine.stop();
        await this.engine.dispose();
        this.engine = null;
      }
      if (this.bridge) {
        await this.bridge.dispose();
        this.bridge = null;
      }
      this.releaseVideoAndStream();
      this.registry.releaseSticky();
      if (!this.disposed) this.setStatus('camera unavailable · keyboard mode remains active');
      throw error;
    }
  }

  private readonly onFrame = (frame: GestureFrame) => {
    if (this.disposed || this.paused) return;
    const viewport = this.viewport();
    if (this.calibrationHand) {
      const hand = this.calibrationHand === 'Left' ? frame.left : frame.right;
      if (hand?.fresh) this.handleCalibration(hand);
      this.dispatchContextActions(this.context.cancel());
      this.coordinator.cancelAll();
      this.registry.releaseSticky();
      this.recordDiagnostics(frame, [], null, null);
      this.renderer.render({
        right: cursorView(), left: cursorView(), status: this.status,
      });
      this.updateDiagnosticsPanel();
      return;
    }

    const leftPoint = frame.left ? this.screenPoint(frame.left, viewport) : undefined;
    const rightPoint = frame.right ? this.screenPoint(frame.right, viewport) : undefined;
    const leftSuppressed = this.consumeSuppression(frame.left);
    const rightSuppressed = this.consumeSuppression(frame.right);
    const leftTarget = leftPoint ? this.registry.resolveAt(leftPoint) : null;
    const rightTarget = rightPoint ? this.registry.resolveAt(rightPoint) : null;
    const rightCursorPoint = rightPoint && rightTarget?.draggable && frame.right?.state !== 'pinch'
      ? pointInsideTarget(rightPoint, rightTarget)
      : rightPoint;

    const coordinated = this.coordinator.update(
      {
        hand: leftSuppressed ? undefined : frame.left,
        point: leftPoint ? { x: leftPoint.x, y: leftPoint.y / viewport.height } : undefined,
        targetId: leftTarget?.id,
      },
      { hand: frame.right, point: rightPoint, target: null },
      frame.timestamp,
    );
    for (const event of coordinated) {
      if (event.channel !== 'left') continue;
      if (event.action.type === 'left-scroll') {
        this.root.querySelector<HTMLElement>('.jericho-bay--left')?.scrollBy({ top: event.action.delta });
      } else if (event.action.type === 'left-select') {
        this.registry.get(event.action.targetId)?.invokeTap();
      }
    }

    const contextActions = frame.right?.fresh && rightPoint
      && !rightSuppressed
      ? this.context.update({
        point: rightPoint,
        pinching: frame.right.state === 'pinch',
        now: frame.timestamp,
        target: rightTarget,
      })
      : this.context.cancel();
    this.dispatchContextActions(contextActions);
    this.recordDiagnostics(
      frame,
      [
        ...coordinated,
        ...contextActions.map((action) => ({ channel: 'right' as const, action })),
      ],
      leftTarget?.id ?? null,
      rightTarget?.id ?? null,
    );
    this.updateDiagnosticsPanel();

    const view: GestureSurfaceView = {
      right: cursorView(frame.right, rightCursorPoint),
      left: cursorView(frame.left, leftPoint),
      status: this.status,
    };
    this.renderer.render(view);
  };

  private dispatchContextActions(actions: ContextHoldAction[]) {
    for (const action of actions) {
      const target = this.registry.get(action.targetId);
      switch (action.type) {
        case 'press-start':
          this.registry.lock(action.targetId);
          this.renderer.hideActionRing();
          break;
        case 'tap':
          target?.invokeTap();
          this.renderer.hideActionRing();
          break;
        case 'hold':
          target?.invokeHold(action.point);
          this.renderer.showActionRing(action.point, target?.contextActions() ?? []);
          break;
        case 'drag-start':
          target?.dragStart(action.point);
          break;
        case 'drag-move':
          target?.dragMove(action.point, action.delta);
          break;
        case 'drag-end':
          target?.dragEnd(action.point, action.cancelled);
          break;
        case 'release':
          this.registry.releaseSticky();
          if (!action.held) this.renderer.hideActionRing();
          break;
        case 'cancel':
          this.registry.releaseSticky();
          this.renderer.hideActionRing();
          break;
      }
    }
  }

  private readonly onKeyDown: EventListener = (event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return;
    if (this.paused) this.resume();
    else this.pause();
  };

  private setStatus(status: string) {
    this.status = status;
    this.renderer.setSystemStatus(status);
  }

  private releaseVideoAndStream() {
    this.video?.pause();
    if (this.video) this.video.srcObject = null;
    this.video = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('Jarvis runtime was disposed during engage');
  }

  private configureCamera(): void {
    const videoTrack = typeof this.stream?.getVideoTracks === 'function'
      ? this.stream.getVideoTracks()[0]
      : undefined;
    let settings: MediaTrackSettings = {};
    try {
      settings = videoTrack?.getSettings?.() ?? {};
    } catch {
      settings = {};
    }
    this.cameraId = settings.deviceId?.trim() || 'default';
    const width = positive(settings.width) ?? positive(this.video?.videoWidth) ?? 1280;
    const height = positive(settings.height) ?? positive(this.video?.videoHeight) ?? 720;
    this.cameraAspectRatio = width / height;
    this.profiles.clear();
    for (const handedness of ['Left', 'Right'] as const) {
      const profile = loadCalibration(
        this.storage,
        this.cameraId,
        this.cameraAspectRatio,
        handedness,
      );
      if (profile) this.profiles.set(handedness, profile);
    }
    this.updateControlState();
  }

  private screenPoint(
    hand: TrackedHandFrame,
    viewport: { width: number; height: number },
  ): Point {
    const profile = this.profiles.get(hand.handedness);
    if (profile) {
      const normalized = applyCalibration(profile.matrix, hand.smoothedAnchor);
      return { x: normalized.x * viewport.width, y: normalized.y * viewport.height };
    }
    return fallbackScreenPoint(hand, viewport);
  }

  private consumeSuppression(hand: TrackedHandFrame | undefined): boolean {
    if (!hand || !this.suppressUntilPalm.has(hand.handedness)) return false;
    if (hand.fresh && hand.state === 'palm') this.suppressUntilPalm.delete(hand.handedness);
    return true;
  }

  private startCalibration(handedness: Handedness): void {
    if (this.disposed) return;
    this.dispatchContextActions(this.context.cancel());
    this.coordinator.cancelAll();
    this.registry.releaseSticky();
    this.calibrationHand = handedness;
    this.calibrationIndex = 0;
    this.calibrationSamples = [];
    this.calibrationPreviousPinch = false;
    this.calibrationBuffer.clear();
    this.renderCalibration(`Hold ${handedness.toLowerCase()} palm at center, then pinch`);
  }

  private handleCalibration(hand: TrackedHandFrame): void {
    if (hand.handedness !== this.calibrationHand) return;
    if (hand.state === 'palm') this.calibrationBuffer.push(hand.palmAnchor);
    const pinchStarted = hand.state === 'pinch' && !this.calibrationPreviousPinch;
    if (pinchStarted) {
      const point = this.calibrationBuffer.median();
      if (!point) {
        this.renderCalibration('Hold the open palm steady longer, then pinch');
      } else {
        this.calibrationSamples.push({
          target: CALIBRATION_ORDER[this.calibrationIndex],
          camera: point,
        });
        this.calibrationIndex += 1;
        this.calibrationBuffer.clear();
        if (this.calibrationIndex === CALIBRATION_ORDER.length) this.finishCalibration();
        else this.renderCalibration(
          `Move ${this.calibrationHand?.toLowerCase()} palm to ${CALIBRATION_ORDER[this.calibrationIndex]}, hold, then pinch`,
        );
      }
    }
    this.calibrationPreviousPinch = hand.state === 'pinch';
  }

  private finishCalibration(): void {
    const handedness = this.calibrationHand;
    if (!handedness) return;
    try {
      const profile = createCalibrationProfile(
        this.calibrationSamples,
        this.cameraId,
        this.cameraAspectRatio,
        handedness,
      );
      saveCalibration(this.storage, profile);
      this.profiles.set(handedness, profile);
      this.suppressUntilPalm.add(handedness);
      this.calibrationHand = null;
      this.renderer.showCalibration(null);
      this.updateControlState();
      this.setStatus(`${handedness.toLowerCase()} hand calibrated`);
    } catch (error) {
      this.calibrationIndex = 0;
      this.calibrationSamples = [];
      this.calibrationBuffer.clear();
      this.renderCalibration(`${error instanceof Error ? error.message : 'Calibration failed'}. Repeat from center.`);
    }
  }

  private renderCalibration(message: string): void {
    if (!this.calibrationHand) return;
    const target = CALIBRATION_ORDER[this.calibrationIndex];
    this.renderer.showCalibration({
      handedness: this.calibrationHand,
      target,
      point: TARGET_POINTS[target],
      message,
    });
  }

  private resetCalibration(): void {
    resetCalibrations(this.storage, this.cameraId);
    this.profiles.clear();
    this.calibrationHand = null;
    this.calibrationBuffer.clear();
    this.renderer.showCalibration(null);
    this.updateControlState();
    this.setStatus('hand calibration reset');
  }

  private toggleSwap(): void {
    this.dispatchContextActions(this.context.cancel());
    this.coordinator.cancelAll();
    this.registry.releaseSticky();
    this.suppressUntilPalm.add('Left');
    this.suppressUntilPalm.add('Right');
    this.swapped = !this.swapped;
    safeSet(this.storage, 'jericho.swap-hands', String(this.swapped));
    this.engine?.setSwapHands?.(this.swapped);
    this.updateControlState();
  }

  private toggleDiagnostics(): void {
    this.diagnosticsEnabled = !this.diagnosticsEnabled;
    this.updateControlState();
    this.updateDiagnosticsPanel();
  }

  private updateControlState(): void {
    this.renderer.updateControlState({
      calibratedHands: (['Left', 'Right'] as const).filter((handedness) =>
        this.profiles.has(handedness)),
      swapped: this.swapped,
      diagnosticsEnabled: this.diagnosticsEnabled,
    });
  }

  private recordDiagnostics(
    frame: GestureFrame,
    actions: DiagnosticActionInput[],
    leftTarget: string | null,
    rightTarget: string | null,
  ): void {
    const leftBay = this.root.querySelector<HTMLElement>('.jericho-bay--left');
    this.recorder.record({
      timestamp: frame.timestamp,
      frame,
      actions,
      scrollTop: leftBay?.scrollTop ?? 0,
      leftTarget,
      rightTarget,
    });
  }

  private updateDiagnosticsPanel(): void {
    const snapshot = this.recorder.latest();
    this.renderer.showDiagnostics(
      this.diagnosticsEnabled && snapshot ? JSON.stringify(snapshot, null, 2) : null,
    );
  }
}

function defaultVideo(ownerDocument: Document): HTMLVideoElement {
  const video = ownerDocument.createElement('video');
  video.autoplay = true;
  video.setAttribute('aria-hidden', 'true');
  return video;
}

function fallbackScreenPoint(hand: TrackedHandFrame, viewport: { width: number; height: number }): Point {
  const mapped = mapHandToScreen(
    hand.smoothedAnchor.x,
    hand.smoothedAnchor.y,
    viewport.width,
    viewport.height,
  );
  return { x: mapped.px, y: mapped.py };
}

function cursorView(hand?: TrackedHandFrame, point?: Point) {
  return {
    visible: Boolean(hand?.fresh && point),
    x: point?.x ?? 0,
    y: point?.y ?? 0,
    mode: hand?.state ?? 'idle',
  };
}

const NOOP_STORAGE: RuntimeStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function browserStorage(ownerDocument: Document): RuntimeStorage {
  try {
    return ownerDocument.defaultView?.localStorage ?? NOOP_STORAGE;
  } catch {
    return NOOP_STORAGE;
  }
}

function safeGet(storage: RuntimeStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: RuntimeStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Gesture controls remain usable for this session when storage is unavailable.
  }
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function downloadDiagnostics(ownerDocument: Document, contents: string): void {
  const view = ownerDocument.defaultView;
  if (!view?.URL?.createObjectURL) return;
  const url = view.URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = ownerDocument.createElement('a');
  link.href = url;
  link.download = `jericho-gesture-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
}
