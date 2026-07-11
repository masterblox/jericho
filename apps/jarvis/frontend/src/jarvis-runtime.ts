import { BridgeClient, type BridgeEvents } from './bridge-client';
import { ContextHoldController, type ContextHoldAction } from './context-hold-controller';
import { mapHandToScreen } from './coords';
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
import type { Point } from './tracking';

export type { GestureSurfacePort } from './gesture-surface-renderer';

export interface RuntimeVideoPort {
  srcObject: MediaProvider | null;
  muted: boolean;
  playsInline: boolean;
  play(): Promise<void>;
  pause(): void;
}

export interface GestureEngineRuntimePort {
  start(onFrame: (frame: GestureFrame) => void): void;
  stop(): void;
  dispose(): void | Promise<void>;
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
  private readonly coordinator = new GestureCoordinator();
  private readonly context = new ContextHoldController();

  private engagePromise: Promise<void> | null = null;
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

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
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
    this.stopObserving = this.observeTargets(this.root, this.registry);
    try {
      this.stream = await this.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: false,
      });
      this.video = this.createVideo();
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.stream;
      await this.video.play();
      this.engine = await this.createGestureEngine(this.video);
      this.bridge = this.createBridge({
        onReady: () => this.setStatus('voice and gestures online'),
        onStatus: (value) => this.setStatus(`voice ${value}`),
        onToolStart: (name) => this.setStatus(`agent action · ${name}`),
        onToolResult: (name) => this.setStatus(`agent action complete · ${name}`),
        onError: (message) => this.setStatus(`voice unavailable · ${message}`),
      });
      this.engine.start(this.onFrame);
      await this.bridge.start();
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
      this.setStatus('camera unavailable · keyboard mode remains active');
      throw error;
    }
  }

  private readonly onFrame = (frame: GestureFrame) => {
    if (this.disposed || this.paused) return;
    const viewport = this.viewport();
    const leftPoint = frame.left ? screenPoint(frame.left, viewport) : undefined;
    const rightPoint = frame.right ? screenPoint(frame.right, viewport) : undefined;
    const leftTarget = leftPoint ? this.registry.resolveAt(leftPoint) : null;
    const rightTarget = rightPoint ? this.registry.resolveAt(rightPoint) : null;

    const coordinated = this.coordinator.update(
      { hand: frame.left, point: leftPoint, targetId: leftTarget?.id },
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
      ? this.context.update({
        point: rightPoint,
        pinching: frame.right.state === 'pinch',
        now: frame.timestamp,
        target: rightTarget,
      })
      : this.context.cancel();
    this.dispatchContextActions(contextActions);

    const view: GestureSurfaceView = {
      right: cursorView(frame.right, rightPoint),
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
}

function defaultVideo(ownerDocument: Document): HTMLVideoElement {
  const video = ownerDocument.createElement('video');
  video.autoplay = true;
  video.setAttribute('aria-hidden', 'true');
  return video;
}

function screenPoint(hand: TrackedHandFrame, viewport: { width: number; height: number }): Point {
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
