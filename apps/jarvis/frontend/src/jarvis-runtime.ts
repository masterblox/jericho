import { BridgeClient, type BridgeEvents } from './bridge-client';
import {
  CALIBRATION_ORDER,
  TARGET_POINTS,
  StableSampleBuffer,
  applyCalibration,
  createCalibrationProfile,
  derivePinchThresholds,
  loadCalibration,
  resetCalibrations,
  saveCalibration,
  type CalibrationProfile,
  type CalibrationSample,
} from './calibration';
import { ContextHoldController, type ContextHoldAction } from './context-hold-controller';
import { mapHandToScreen } from './coords';
import { DiagnosticRecorder, type DiagnosticActionInput, type SanitizedDiagnosticSnapshot } from './diagnostics';
import {
  JERICHO_APPROVAL_GESTURE_EVENT,
  JERICHO_CANCEL_PENDING_EVENT,
  JERICHO_NUCLEUS_CAMERA_EVENT,
  JERICHO_NUCLEUS_DEPTH_EVENT,
} from './gesture-events';
import {
  type ActiveApprovalScope,
  HeldGestureInterpreter,
  NucleusGestureInterpreter,
  type NucleusGestureAction,
} from './gesture-grammar';
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
  setPinchThresholds?(handedness: Handedness, thresholds: { engageRatio: number; releaseRatio: number }): void;
}

export interface BridgeRuntimePort {
  start(): void | Promise<void>;
  wake(source?: 'clap' | 'manual'): void;
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
  onGestureLabSnapshot?: (snapshot: GestureLabSnapshot) => void;
}

export interface GestureLabSnapshot extends SanitizedDiagnosticSnapshot {
  status: string;
  wakeSource?: 'clap' | 'manual';
  targets: SanitizedDiagnosticSnapshot['targets'] & {
    leftId: string | null;
    rightId: string | null;
  };
  calibrationVersion: number;
  calibratedThresholds: Partial<Record<Handedness, { engageRatio: number; releaseRatio: number }>>;
  cameraIdentifierHash: string;
  suppressionReason?: string;
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
  private readonly onGestureLabSnapshot?: (snapshot: GestureLabSnapshot) => void;
  private readonly coordinator = new GestureCoordinator();
  private readonly context = new ContextHoldController();
  private readonly heldGestures = new HeldGestureInterpreter();
  private readonly nucleusGestures = new NucleusGestureInterpreter();
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
  private lastWakeSource?: 'clap' | 'manual';
  private cameraId = 'default';
  private cameraIdentifierHash = 'pending';
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
  private calibrationOpenRatios: number[] = [];
  private calibrationClosedRatios: number[] = [];

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
    this.onGestureLabSnapshot = options.onGestureLabSnapshot;
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
    this.resetSemanticGestures();
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
    this.bridge?.wake('manual');
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
    this.resetSemanticGestures();
    this.registry.releaseSticky();
    this.root.classList.remove('gestures-frozen', 'jericho-persona--megatron', 'jericho-persona--pending');

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
      for (const [handedness, profile] of this.profiles) {
        this.engine.setPinchThresholds?.(handedness, {
          engageRatio: profile.pinchEngageRatio,
          releaseRatio: profile.pinchReleaseRatio,
        });
      }
      this.bridge = this.createBridge({
        onReady: () => this.setStatus('voice and gestures online'),
        onStatus: (value) => this.setStatus(`voice ${value}`),
        onWake: (source) => { this.lastWakeSource = source; },
        onToolStart: (name) => this.setStatus(`agent action · ${name}`),
        onToolResult: (name, result) => {
          this.setStatus(`agent action complete · ${name}`);
          this.root.ownerDocument.dispatchEvent(new CustomEvent('jericho:voice-tool-result', {
            detail: { name, result },
          }));
        },
        onGuidedTestStart: (test) => {
          this.root.ownerDocument.dispatchEvent(new CustomEvent('jericho:guided-test-start', {
            detail: { test },
          }));
        },
        onModePending: (_mode, name) => {
          this.root.classList.add('jericho-persona--pending');
          this.setStatus(`persona pending · ${name}`);
        },
        onModeChange: (mode, name) => {
          this.root.classList.remove('jericho-persona--pending');
          this.root.classList.toggle('jericho-persona--megatron', mode === 'megatron');
          this.setStatus(`persona active · ${name}`);
        },
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
    const leftClosedFist = frame.left?.fresh === true && frame.left.recognizedGesture === 'Closed_Fist';
    const rightClosedFist = frame.right?.fresh === true && frame.right.recognizedGesture === 'Closed_Fist';
    const leftSuppressed = leftClosedFist || this.consumeSuppression(frame.left);
    const rightSuppressed = rightClosedFist || this.consumeSuppression(frame.right);
    const leftTarget = leftPoint ? this.registry.resolveAt(leftPoint) : null;
    const rightTarget = rightPoint ? this.registry.resolveAt(rightPoint) : null;
    const rightCursorPoint = rightPoint && rightTarget?.draggable && frame.right?.state !== 'pinch'
      ? pointInsideTarget(rightPoint, rightTarget)
      : rightPoint;

    const nucleus = this.root.querySelector<HTMLElement>('[data-jericho-nucleus-space="true"]');
    const leftInsideNucleus = Boolean(leftPoint && nucleus && pointInRect(leftPoint, nucleus.getBoundingClientRect()));
    const rightInsideNucleus = Boolean(rightPoint && nucleus && pointInRect(rightPoint, nucleus.getBoundingClientRect()));
    const bothOpenPalmsInsideNucleus = leftInsideNucleus
      && rightInsideNucleus
      && frame.left?.fresh === true
      && frame.right?.fresh === true
      && frame.left.recognizedGesture === 'Open_Palm'
      && frame.right.recognizedGesture === 'Open_Palm';
    const nucleusActions = this.nucleusGestures.update({
      left: frame.left,
      right: frame.right,
      leftPoint,
      rightPoint,
      rightOnEmptyNucleus: rightInsideNucleus && !rightTarget,
      bothHandsInsideNucleus: bothOpenPalmsInsideNucleus,
      now: frame.timestamp,
    });
    this.dispatchNucleusActions(nucleusActions);
    const nucleusConsumesRight = this.nucleusGestures.isCameraActive();
    const nucleusConsumesBoth = this.nucleusGestures.isDepthActive();
    if (nucleusConsumesRight || nucleusConsumesBoth) this.registry.releaseSticky();

    const heldActions = this.heldGestures.update({
      left: leftSuppressed ? undefined : frame.left,
      right: rightSuppressed ? undefined : frame.right,
      now: frame.timestamp,
      activeApproval: readActiveApprovalScope(this.root.ownerDocument),
      cancelEnabled: !bothOpenPalmsInsideNucleus,
    });
    if (heldActions.length) {
      this.dispatchContextActions(this.context.cancel());
      this.coordinator.cancelAll();
      this.registry.releaseSticky();
      this.renderer.hideActionRing();
      for (const action of heldActions) {
        if (action.type === 'approval-decision') {
          this.root.ownerDocument.dispatchEvent(new CustomEvent(JERICHO_APPROVAL_GESTURE_EVENT, {
            detail: { outcome: action.outcome, ...action.approval },
          }));
        } else {
          this.root.ownerDocument.dispatchEvent(new CustomEvent(JERICHO_CANCEL_PENDING_EVENT, {
            detail: { source: 'both-open-palms' },
          }));
        }
      }
      this.recordDiagnostics(
        frame,
        heldActions.map((action) => ({ channel: 'right', action })),
        leftTarget?.id ?? null,
        rightTarget?.id ?? null,
      );
      this.updateDiagnosticsPanel();
      this.renderer.render({
        right: cursorView(frame.right, rightCursorPoint, rightTarget?.id, nucleusConsumesRight),
        left: cursorView(frame.left, leftPoint, leftTarget?.id),
        status: this.status,
      });
      return;
    }

    const coordinated = this.coordinator.update(
      {
        hand: leftSuppressed || nucleusConsumesBoth ? undefined : frame.left,
        point: leftPoint ? { x: leftPoint.x, y: leftPoint.y / viewport.height } : undefined,
        targetId: leftTarget?.id,
      },
      { hand: nucleusConsumesRight || nucleusConsumesBoth ? undefined : frame.right, point: rightPoint, target: null },
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
      && !rightSuppressed && !nucleusConsumesRight && !nucleusConsumesBoth
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
      right: cursorView(frame.right, rightCursorPoint, rightTarget?.id, nucleusConsumesRight),
      left: cursorView(frame.left, leftPoint, leftTarget?.id),
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

  private dispatchNucleusActions(actions: NucleusGestureAction[]): void {
    for (const action of actions) {
      if (action.type === 'depth') {
        this.root.ownerDocument.dispatchEvent(new CustomEvent(JERICHO_NUCLEUS_DEPTH_EVENT, {
          detail: { delta: action.delta },
        }));
        continue;
      }
      this.root.ownerDocument.dispatchEvent(new CustomEvent(JERICHO_NUCLEUS_CAMERA_EVENT, {
        detail: action.phase === 'start'
          ? { phase: action.phase, point: action.point }
          : action.phase === 'move'
            ? { phase: action.phase, point: action.point, delta: action.delta }
            : { phase: action.phase, cancelled: action.cancelled },
      }));
    }
  }

  private resetSemanticGestures(): void {
    this.heldGestures.reset();
    this.dispatchNucleusActions(this.nucleusGestures.reset());
  }

  private readonly onKeyDown: EventListener = (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === 'Escape') {
      if (this.paused) this.resume();
      else this.pause();
      return;
    }
    if (event.key === 'v' || event.key === 'V') {
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      this.wake();
    }
  };

  private setStatus(status: string) {
    this.status = status;
    this.renderer.setSystemStatus(status);
    const jericho = (globalThis as typeof globalThis & {
      jericho?: { setCoreState?: (state: string) => void };
    }).jericho;
    const coreState = status.includes('unavailable') ? 'alert'
      : status.includes('listening') ? 'listening'
        : status.includes('greeting') ? 'speaking'
          : status.includes('agent action') ? 'thinking'
            : 'idle';
    jericho?.setCoreState?.(coreState);
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
    void hashCameraIdentifier(this.cameraId).then((hash) => { this.cameraIdentifierHash = hash; });
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
    // The right hand aims and grabs, so place its cursor at the live
    // thumb/index midpoint while keeping the stable palm-based calibration.
    const offsetX = hand.handedness === 'Right' ? hand.smoothedPinch.x - hand.smoothedAnchor.x : 0;
    const offsetY = hand.handedness === 'Right' ? hand.smoothedPinch.y - hand.smoothedAnchor.y : 0;
    const profile = this.profiles.get(hand.handedness);
    if (profile) {
      const normalized = applyCalibration(profile.matrix, hand.smoothedAnchor);
      return {
        x: (normalized.x + offsetX) * viewport.width,
        y: (normalized.y + offsetY) * viewport.height,
      };
    }
    return fallbackScreenPoint(hand, viewport, { x: offsetX, y: offsetY });
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
    this.resetSemanticGestures();
    this.registry.releaseSticky();
    this.calibrationHand = handedness;
    this.calibrationIndex = 0;
    this.calibrationSamples = [];
    this.calibrationPreviousPinch = false;
    this.calibrationBuffer.clear();
    this.calibrationOpenRatios = [];
    this.calibrationClosedRatios = [];
    this.renderCalibration(`Hold ${handedness.toLowerCase()} palm at center, then pinch`);
  }

  private handleCalibration(hand: TrackedHandFrame): void {
    if (hand.handedness !== this.calibrationHand) return;
    if (hand.state === 'palm' || hand.recognizedGesture === 'Open_Palm') {
      this.calibrationBuffer.push(hand.palmAnchor);
      this.calibrationOpenRatios.push(hand.pinchRatio);
      if (this.calibrationOpenRatios.length > 80) this.calibrationOpenRatios.shift();
    }
    const openMedian = medianNumber(this.calibrationOpenRatios) ?? 0.75;
    const rawPinched = hand.pinchRatio <= Math.min(0.72, Math.max(0.38, openMedian * 0.68));
    const pinchStarted = rawPinched && !this.calibrationPreviousPinch;
    if (pinchStarted) {
      this.calibrationClosedRatios.push(hand.pinchRatio);
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
    this.calibrationPreviousPinch = rawPinched;
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
        new Date().toISOString(),
        derivePinchThresholds(this.calibrationOpenRatios, this.calibrationClosedRatios),
      );
      saveCalibration(this.storage, profile);
      this.profiles.set(handedness, profile);
      this.engine?.setPinchThresholds?.(handedness, {
        engageRatio: profile.pinchEngageRatio,
        releaseRatio: profile.pinchReleaseRatio,
      });
      this.suppressUntilPalm.add(handedness);
      this.calibrationHand = null;
      this.renderer.showCalibration(null);
      this.updateControlState();
      this.setStatus(`${handedness.toLowerCase()} hand calibrated`);
    } catch (error) {
      this.calibrationIndex = 0;
      this.calibrationSamples = [];
      this.calibrationBuffer.clear();
      this.calibrationOpenRatios = [];
      this.calibrationClosedRatios = [];
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
    this.resetSemanticGestures();
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
    const snapshot = this.recorder.latest();
    if (snapshot) {
      this.onGestureLabSnapshot?.({
        ...snapshot,
        status: this.status,
        wakeSource: this.lastWakeSource,
        targets: {
          ...snapshot.targets,
          leftId: leftTarget,
          rightId: rightTarget,
        },
        calibrationVersion: 2,
        cameraIdentifierHash: this.cameraIdentifierHash,
        calibratedThresholds: Object.fromEntries([...this.profiles].map(([handedness, profile]) => [handedness, {
          engageRatio: profile.pinchEngageRatio,
          releaseRatio: profile.pinchReleaseRatio,
        }])),
        ...(this.calibrationHand ? { suppressionReason: `calibrating_${this.calibrationHand.toLocaleLowerCase()}` }
          : this.paused ? { suppressionReason: 'runtime_paused' }
            : undefined),
      });
    }
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

function fallbackScreenPoint(
  hand: TrackedHandFrame,
  viewport: { width: number; height: number },
  offset: Point = { x: 0, y: 0 },
): Point {
  const mapped = mapHandToScreen(
    hand.smoothedAnchor.x + offset.x,
    hand.smoothedAnchor.y + offset.y,
    viewport.width,
    viewport.height,
  );
  return { x: mapped.px, y: mapped.py };
}

function pointInRect(point: Point, rect: DOMRect): boolean {
  return point.x >= rect.left
    && point.x <= rect.right
    && point.y >= rect.top
    && point.y <= rect.bottom;
}

function readActiveApprovalScope(ownerDocument: Document): ActiveApprovalScope | undefined {
  const element = ownerDocument.querySelector<HTMLElement>('[data-jericho-active-approval="true"]');
  if (!element) return undefined;
  const missionId = element.dataset.jerichoApprovalMissionId;
  const planHash = element.dataset.jerichoApprovalPlanHash;
  const version = Number(element.dataset.jerichoApprovalVersion);
  if (!missionId || !planHash || !Number.isSafeInteger(version) || version < 1) return undefined;
  return { missionId, planHash, version };
}

function cursorView(hand?: TrackedHandFrame, point?: Point, targetId?: string, clutch = false) {
  return {
    visible: Boolean(hand?.fresh && point),
    x: point?.x ?? 0,
    y: point?.y ?? 0,
    mode: hand?.state ?? 'idle',
    phase: hand?.pinchPhase,
    ...(targetId ? { targetId } : undefined),
    clutch,
  };
}

async function hashCameraIdentifier(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 20);
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

function medianNumber(values: number[]): number | undefined {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  return finite.length ? finite[Math.floor(finite.length / 2)] : undefined;
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
