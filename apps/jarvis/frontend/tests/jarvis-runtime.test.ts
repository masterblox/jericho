// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GestureTargetRegistry } from '../src/gesture-target-registry';
import { mapHandToScreen } from '../src/coords';
import {
  JERICHO_APPROVAL_GESTURE_EVENT,
  JERICHO_CANCEL_PENDING_EVENT,
  JERICHO_NUCLEUS_CAMERA_EVENT,
  JERICHO_NUCLEUS_DEPTH_EVENT,
} from '../src/gesture-events';
import {
  GESTURE_HOLD_MS,
  NUCLEUS_DEPTH_HOLD_MS,
} from '../src/gesture-grammar';
import {
  createCalibrationProfile,
  loadCalibration,
  saveCalibration,
  type CalibrationSample,
} from '../src/calibration';
import {
  JarvisRuntime,
  type BridgeRuntimePort,
  type GestureEngineRuntimePort,
  type GestureSurfacePort,
  type RuntimeVideoPort,
} from '../src/jarvis-runtime';
import type { GestureFrame } from '../src/gestures';
import type { TrackedHandFrame } from '../src/hand-tracks';

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('JarvisRuntime lifecycle', () => {
  it('engages hardware once, toggles pause safely, and tears every resource down idempotently', async () => {
    const harness = createHarness();
    await Promise.all([harness.runtime.engage(), harness.runtime.engage()]);

    expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
    expect(harness.createGestureEngine).toHaveBeenCalledTimes(1);
    expect(harness.createBridge).toHaveBeenCalledTimes(1);
    expect(harness.video.play).toHaveBeenCalledTimes(1);
    expect(harness.engine.start).toHaveBeenCalledTimes(1);
    expect(harness.bridge.start).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(harness.engine.stop).toHaveBeenCalledTimes(1);
    expect(harness.root.classList.contains('gestures-frozen')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(harness.engine.start).toHaveBeenCalledTimes(2);
    expect(harness.root.classList.contains('gestures-frozen')).toBe(false);

    await harness.runtime.dispose();
    await harness.runtime.dispose();
    expect(harness.engine.dispose).toHaveBeenCalledTimes(1);
    expect(harness.bridge.dispose).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.video.pause).toHaveBeenCalledTimes(1);
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(harness.engine.start).toHaveBeenCalledTimes(2);
  });

  it('cleans partial state and leaves the React keyboard surface usable when camera permission fails', async () => {
    const root = appRoot();
    const renderer = fakeRenderer();
    const createGestureEngine = vi.fn();
    const createBridge = vi.fn();
    const runtime = new JarvisRuntime({
      root,
      registry: new GestureTargetRegistry(document),
      renderer,
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('permission denied')) },
      createGestureEngine,
      createBridge,
      createVideo: () => fakeVideo(),
      eventTarget: document,
    });

    await expect(runtime.engage()).rejects.toThrow('permission denied');
    expect(createGestureEngine).not.toHaveBeenCalled();
    expect(createBridge).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Keyboard command center');
    expect(renderer.setSystemStatus).toHaveBeenCalledWith('camera unavailable · keyboard mode remains active');
    await runtime.dispose();
  });

  it('normalizes only left-navigation Y while retaining pixel hit and render coordinates', async () => {
    const harness = createHarness({ viewport: () => ({ width: 1_000, height: 1_000 }) });
    const leftBay = document.createElement('aside');
    leftBay.className = 'jericho-bay--left';
    const scrollBy = vi.fn();
    Object.defineProperty(leftBay, 'scrollBy', { configurable: true, value: scrollBy });
    harness.root.append(leftBay);
    await harness.runtime.engage();

    harness.emit(frame(0, tracked('Left', 'palm', 0.4, 0.47)));
    harness.emit(frame(33, tracked('Left', 'palm', 0.4, 0.54)));

    const expected = mapHandToScreen(0.4, 0.54, 1_000, 1_000);
    expect(harness.renderer.render).toHaveBeenLastCalledWith(expect.objectContaining({
      left: expect.objectContaining({ x: expected.px, y: expected.py }),
    }));
    const delta = scrollBy.mock.calls[0]?.[0]?.top as number;
    expect(delta).toBeGreaterThan(4);
    expect(delta).toBeLessThan(6);
  });

  it('clamps the visible pre-pinch cursor inside an acquired draggable without moving the raw hand point', async () => {
    const viewport = { width: 500, height: 500 };
    const harness = createHarness({ viewport: () => viewport });
    const raw = mapHandToScreen(0.7, 0.5, viewport.width, viewport.height);
    const card = document.createElement('article');
    harness.root.append(card);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      left: raw.px - 210, right: raw.px - 10, top: raw.py - 50, bottom: raw.py + 50,
      width: 200, height: 100, x: raw.px - 210, y: raw.py - 50, toJSON: () => ({}),
    });
    harness.registry.register({ id: 'card', element: card, draggable: true });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true, value: vi.fn().mockReturnValue([card]),
    });
    await harness.runtime.engage();

    harness.emit(frame(0, undefined, tracked('Right', 'palm', 0.7, 0.5)));

    expect(harness.renderer.render).toHaveBeenLastCalledWith(expect.objectContaining({
      right: expect.objectContaining({
        x: raw.px - 24,
        y: raw.py,
      }),
    }));

    harness.emit(frame(20, undefined, tracked('Right', 'pinch', 0.7, 0.5)));
    expect(harness.renderer.render).toHaveBeenLastCalledWith(expect.objectContaining({
      right: expect.objectContaining({ x: raw.px, y: raw.py }),
    }));
  });

  it('awaits and aborts an in-flight engage so resources cannot start after disposal', async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const pendingStream = new Promise<MediaStream>((resolve) => { resolveStream = resolve; });
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const harness = createHarness({ getUserMedia: vi.fn().mockReturnValue(pendingStream) });

    const engaging = harness.runtime.engage();
    const disposing = harness.runtime.dispose();
    resolveStream(stream);

    await expect(engaging).rejects.toThrow(/disposed/i);
    await disposing;
    expect(harness.createGestureEngine).not.toHaveBeenCalled();
    expect(harness.createBridge).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('observes the document so runtime action-ring buttons remain gesture selectable', async () => {
    const observeTargets = vi.fn().mockReturnValue(vi.fn());
    const harness = createHarness({ observeTargets });
    await harness.runtime.engage();

    expect(observeTargets).toHaveBeenCalledWith(document, harness.registry);
  });

  it('loads the saved per-camera/per-hand calibration using live camera settings', async () => {
    const storage = new MemoryStorage();
    saveCalibration(storage, createCalibrationProfile(
      calibrationSamples,
      'camera-a',
      16 / 9,
      'Right',
      '2026-07-10T00:00:00.000Z',
    ));
    const harness = createHarness({
      storage,
      trackSettings: { deviceId: 'camera-a', width: 1_920, height: 1_080 },
      viewport: () => ({ width: 1_000, height: 1_000 }),
    });
    await harness.runtime.engage();

    harness.emit(frame(0, undefined, tracked('Right', 'palm', 0.2, 0.2)));

    const rendered = harness.renderer.render.mock.calls.at(-1)?.[0];
    expect(rendered.right.x).toBeCloseTo(50, 6);
    expect(rendered.right.y).toBeCloseTo(50, 6);
    expect(harness.renderer.updateControlState).toHaveBeenLastCalledWith({
      calibratedHands: ['Right'], swapped: false, diagnosticsEnabled: false,
    });
  });

  it('ignores a saved calibration when current camera aspect settings are incompatible', async () => {
    const storage = new MemoryStorage();
    saveCalibration(storage, createCalibrationProfile(
      calibrationSamples, 'camera-a', 16 / 9, 'Right',
    ));
    const harness = createHarness({
      storage,
      trackSettings: { deviceId: 'camera-a', width: 1_024, height: 768 },
      viewport: () => ({ width: 1_000, height: 1_000 }),
    });
    await harness.runtime.engage();

    harness.emit(frame(0, undefined, tracked('Right', 'palm', 0.2, 0.2)));

    const fallback = mapHandToScreen(0.2, 0.2, 1_000, 1_000);
    expect(harness.renderer.render).toHaveBeenLastCalledWith(expect.objectContaining({
      right: expect.objectContaining({ x: fallback.px, y: fallback.py }),
    }));
    expect(harness.renderer.updateControlState).toHaveBeenLastCalledWith(expect.objectContaining({
      calibratedHands: [],
    }));
  });

  it('calibrates, resets, and swaps hands through runtime control bindings', async () => {
    const storage = new MemoryStorage();
    const harness = createHarness({
      storage,
      trackSettings: { deviceId: 'camera-a', width: 1_920, height: 1_080 },
    });
    await harness.runtime.engage();
    const controls = harness.controls();
    if (!controls) throw new Error('Runtime controls were not configured');

    controls.calibrate('Right');
    expect(harness.renderer.showCalibration).toHaveBeenLastCalledWith(expect.objectContaining({
      handedness: 'Right', target: 'center', point: { x: 0.5, y: 0.5 },
    }));
    let timestamp = 0;
    for (const sample of calibrationSamples) {
      for (let index = 0; index < 8; index += 1) {
        harness.emit(frame(timestamp++, undefined, tracked('Right', 'palm', sample.camera.x, sample.camera.y)));
      }
      harness.emit(frame(timestamp++, undefined, tracked('Right', 'pinch', sample.camera.x, sample.camera.y)));
    }
    expect(loadCalibration(storage, 'camera-a', 16 / 9, 'Right')).not.toBeNull();
    expect(harness.renderer.showCalibration).toHaveBeenLastCalledWith(null);

    controls.swap();
    expect(storage.getItem('jericho.swap-hands')).toBe('true');
    expect(harness.engine.setSwapHands).toHaveBeenCalledWith(true);
    controls.reset();
    expect(loadCalibration(storage, 'camera-a', 16 / 9, 'Right')).toBeNull();
    expect(harness.renderer.updateControlState).toHaveBeenLastCalledWith({
      calibratedHands: [], swapped: true, diagnosticsEnabled: false,
    });
  });

  it('records and exports only sanitized in-memory diagnostics through local controls', async () => {
    const exported = vi.fn();
    const harness = createHarness({ diagnosticsExporter: exported });
    await harness.runtime.engage();
    const controls = harness.controls();
    if (!controls) throw new Error('Runtime controls were not configured');
    controls.diagnostics();
    harness.emit(frame(0, undefined, tracked('Right', 'pinch', 0.5, 0.5)));

    const panel = harness.renderer.showDiagnostics.mock.calls.at(-1)?.[0] as string;
    expect(panel).toContain('"fps": 60');
    expect(panel).not.toMatch(/landmarks|palmAnchor|smoothedAnchor|transcript|payload/);
    controls.exportDiagnostics();
    const contents = exported.mock.calls[0]?.[0] as string;
    expect(JSON.parse(contents)).toMatchObject({ version: 2, snapshots: [{ hands: [{ state: 'pinch' }] }] });
    expect(contents).not.toMatch(/landmarks|palmAnchor|smoothedAnchor|transcript|payload/);
  });

  it('dispatches one semantic held-thumb decision only when React exposes an active approval', async () => {
    const harness = createHarness();
    const approval = document.createElement('article');
    approval.dataset.jerichoActiveApproval = 'true';
    harness.root.append(approval);
    const decisions: unknown[] = [];
    const listener = (event: Event) => decisions.push((event as CustomEvent).detail);
    document.addEventListener(JERICHO_APPROVAL_GESTURE_EVENT, listener);
    await harness.runtime.engage();

    const thumbUp = tracked('Right', 'idle', 0.5, 0.5, 'Thumb_Up');
    harness.emit(frame(0, undefined, thumbUp));
    harness.emit(frame(GESTURE_HOLD_MS, undefined, thumbUp));
    harness.emit(frame(GESTURE_HOLD_MS + 300, undefined, thumbUp));
    expect(decisions).toEqual([{ outcome: 'approved' }]);

    approval.remove();
    harness.emit(frame(GESTURE_HOLD_MS + 400, undefined, tracked('Right', 'idle', 0.5, 0.5, 'None')));
    const thumbDown = tracked('Right', 'idle', 0.5, 0.5, 'Thumb_Down');
    harness.emit(frame(GESTURE_HOLD_MS + 500, undefined, thumbDown));
    harness.emit(frame(GESTURE_HOLD_MS * 2 + 500, undefined, thumbDown));
    expect(decisions).toHaveLength(1);
    document.removeEventListener(JERICHO_APPROVAL_GESTURE_EVENT, listener);
  });

  it('dispatches one semantic cancellation after both fresh open palms are held', async () => {
    const harness = createHarness();
    const cancellations: unknown[] = [];
    const listener = (event: Event) => cancellations.push((event as CustomEvent).detail);
    document.addEventListener(JERICHO_CANCEL_PENDING_EVENT, listener);
    await harness.runtime.engage();
    const left = tracked('Left', 'palm', 0.35, 0.5, 'Open_Palm');
    const right = tracked('Right', 'palm', 0.65, 0.5, 'Open_Palm');

    harness.emit(frame(0, left, right));
    harness.emit(frame(GESTURE_HOLD_MS, left, right));
    harness.emit(frame(GESTURE_HOLD_MS + 200, left, right));

    expect(cancellations).toEqual([{ source: 'both-open-palms' }]);
    expect(harness.renderer.hideActionRing).toHaveBeenCalled();
    document.removeEventListener(JERICHO_CANCEL_PENDING_EVENT, listener);
  });

  it('clutches the camera only from empty Nucleus space and emits local semantic deltas', async () => {
    const harness = createHarness({ viewport: () => ({ width: 1_000, height: 1_000 }) });
    const nucleus = nucleusSpace(harness.root);
    const camera: unknown[] = [];
    const listener = (event: Event) => camera.push((event as CustomEvent).detail);
    document.addEventListener(JERICHO_NUCLEUS_CAMERA_EVENT, listener);
    await harness.runtime.engage();

    harness.emit(frame(0, undefined, tracked('Right', 'pinch', 0.5, 0.5)));
    harness.emit(frame(20, undefined, tracked('Right', 'pinch', 0.55, 0.48)));
    harness.emit(frame(40, undefined, tracked('Right', 'idle', 0.55, 0.48, 'None')));

    expect(camera).toEqual([
      { phase: 'start', point: expect.any(Object) },
      { phase: 'move', point: expect.any(Object), delta: expect.any(Object) },
      { phase: 'end', cancelled: false },
    ]);
    expect((camera[1] as { delta: { x: number } }).delta.x).not.toBe(0);

    const node = document.createElement('button');
    nucleus.append(node);
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(nucleus.getBoundingClientRect());
    harness.registry.register({ id: 'nucleus:node', element: node, draggable: true });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue([node]),
    });
    harness.emit(frame(60, undefined, tracked('Right', 'pinch', 0.5, 0.5)));
    harness.emit(frame(80, undefined, tracked('Right', 'idle', 0.5, 0.5, 'None')));
    expect(camera).toHaveLength(3);
    document.removeEventListener(JERICHO_NUCLEUS_CAMERA_EVENT, listener);
  });

  it('routes two palms inside Nucleus to semantic depth without firing global cancel', async () => {
    const harness = createHarness({ viewport: () => ({ width: 1_000, height: 1_000 }) });
    nucleusSpace(harness.root);
    const depths: unknown[] = [];
    const cancellations: unknown[] = [];
    const depthListener = (event: Event) => depths.push((event as CustomEvent).detail);
    const cancelListener = (event: Event) => cancellations.push((event as CustomEvent).detail);
    document.addEventListener(JERICHO_NUCLEUS_DEPTH_EVENT, depthListener);
    document.addEventListener(JERICHO_CANCEL_PENDING_EVENT, cancelListener);
    await harness.runtime.engage();
    const left = tracked('Left', 'palm', 0.42, 0.5, 'Open_Palm');
    const right = tracked('Right', 'palm', 0.58, 0.5, 'Open_Palm');

    harness.emit(frame(0, left, right));
    harness.emit(frame(NUCLEUS_DEPTH_HOLD_MS, left, right));
    harness.emit(frame(
      NUCLEUS_DEPTH_HOLD_MS + 300,
      left,
      tracked('Right', 'palm', 0.72, 0.5, 'Open_Palm'),
    ));

    expect(depths).toEqual([{ delta: 1 }]);
    expect(cancellations).toEqual([]);
    document.removeEventListener(JERICHO_NUCLEUS_DEPTH_EVENT, depthListener);
    document.removeEventListener(JERICHO_CANCEL_PENDING_EVENT, cancelListener);
  });
});

function createHarness(options: {
  viewport?: () => { width: number; height: number };
  getUserMedia?: ReturnType<typeof vi.fn>;
  observeTargets?: ReturnType<typeof vi.fn>;
  storage?: MemoryStorage;
  trackSettings?: MediaTrackSettings;
  diagnosticsExporter?: ReturnType<typeof vi.fn>;
} = {}) {
  const root = appRoot();
  const track = { stop: vi.fn(), getSettings: vi.fn(() => options.trackSettings ?? {}) };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const getUserMedia = options.getUserMedia ?? vi.fn().mockResolvedValue(stream);
  const video = fakeVideo();
  let frameListener: ((frame: GestureFrame) => void) | undefined;
  const engine: GestureEngineRuntimePort = {
    start: vi.fn((listener) => { frameListener = listener; }),
    stop: vi.fn(),
    dispose: vi.fn(),
    setSwapHands: vi.fn(),
  };
  const bridge: BridgeRuntimePort = {
    start: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    wake: vi.fn(),
  };
  const renderer = fakeRenderer();
  const createGestureEngine = vi.fn().mockResolvedValue(engine);
  const createBridge = vi.fn().mockReturnValue(bridge);
  const registry = new GestureTargetRegistry(document);
  const runtime = new JarvisRuntime({
    root,
    registry,
    renderer,
    mediaDevices: { getUserMedia },
    createGestureEngine,
    createBridge,
    createVideo: () => video,
    eventTarget: document,
    ...(options.viewport ? { viewport: options.viewport } : {}),
    ...(options.observeTargets ? { observeTargets: options.observeTargets } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.diagnosticsExporter ? { diagnosticsExporter: options.diagnosticsExporter } : {}),
  });
  return {
    root, track, getUserMedia, video, engine, bridge, renderer, registry,
    createGestureEngine, createBridge, runtime,
    controls: () => renderer.configureControls.mock.calls.at(-1)?.[0],
    emit: (value: GestureFrame) => {
      if (!frameListener) throw new Error('Gesture engine is not started');
      frameListener(value);
    },
  };
}

function appRoot() {
  const root = document.createElement('div');
  root.id = 'app';
  root.textContent = 'Keyboard command center';
  document.body.append(root);
  return root;
}

function nucleusSpace(root: HTMLElement): HTMLElement {
  const nucleus = document.createElement('div');
  nucleus.dataset.jerichoNucleusSpace = 'true';
  vi.spyOn(nucleus, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 1_000, bottom: 1_000,
    width: 1_000, height: 1_000, x: 0, y: 0, toJSON: () => ({}),
  });
  root.append(nucleus);
  return nucleus;
}

function fakeVideo(): RuntimeVideoPort {
  return {
    srcObject: null,
    muted: false,
    playsInline: false,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  };
}

function fakeRenderer(): GestureSurfacePort & Record<string, ReturnType<typeof vi.fn>> {
  return {
    render: vi.fn(),
    setSystemStatus: vi.fn(),
    showActionRing: vi.fn(),
    hideActionRing: vi.fn(),
    configureControls: vi.fn(),
    updateControlState: vi.fn(),
    showCalibration: vi.fn(),
    showDiagnostics: vi.fn(),
    dispose: vi.fn(),
  };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const calibrationSamples: CalibrationSample[] = [
  { target: 'center', camera: { x: 0.5, y: 0.5 } },
  { target: 'top-left', camera: { x: 0.2, y: 0.2 } },
  { target: 'top-right', camera: { x: 0.8, y: 0.2 } },
  { target: 'bottom-right', camera: { x: 0.8, y: 0.8 } },
  { target: 'bottom-left', camera: { x: 0.2, y: 0.8 } },
];

function frame(
  timestamp: number,
  left?: TrackedHandFrame,
  right?: TrackedHandFrame,
): GestureFrame {
  return {
    hands: [left, right].filter((hand): hand is TrackedHandFrame => Boolean(hand)),
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
    timestamp, fps: 60, inferenceMs: 5,
  };
}

function tracked(
  handedness: 'Left' | 'Right',
  state: 'idle' | 'palm' | 'pinch',
  x: number,
  y: number,
  recognizedGesture = state === 'palm' ? 'Open_Palm' : 'None',
): TrackedHandFrame {
  return {
    trackId: handedness === 'Left' ? 1 : 2,
    handedness, handednessConfidence: 1, rawHandedness: handedness,
    rawHandednessConfidence: 1, state, recognizedGesture,
    gestureConfidence: 1, confidence: 1,
    landmarks: Array.from({ length: 21 }, () => ({ x, y, z: 0 })),
    palmAnchor: { x, y }, smoothedAnchor: { x, y }, velocity: { x: 0, y: 0 },
    pinchRatio: state === 'pinch' ? 0.2 : 0.8,
    pinchPhase: state === 'pinch' ? 'pinched' : 'open', pinchCandidateMs: 0,
    fresh: true, lastSeenAt: 0, lossAgeMs: 0, associationDistance: 0,
  };
}
