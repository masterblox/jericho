// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GestureTargetRegistry } from '../src/gesture-target-registry';
import {
  JarvisRuntime,
  type BridgeRuntimePort,
  type GestureEngineRuntimePort,
  type GestureSurfacePort,
  type RuntimeVideoPort,
} from '../src/jarvis-runtime';

afterEach(() => {
  document.body.replaceChildren();
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
});

function createHarness() {
  const root = appRoot();
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const video = fakeVideo();
  const engine: GestureEngineRuntimePort = {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  const bridge: BridgeRuntimePort = {
    start: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    wake: vi.fn(),
  };
  const renderer = fakeRenderer();
  const createGestureEngine = vi.fn().mockResolvedValue(engine);
  const createBridge = vi.fn().mockReturnValue(bridge);
  const runtime = new JarvisRuntime({
    root,
    registry: new GestureTargetRegistry(document),
    renderer,
    mediaDevices: { getUserMedia },
    createGestureEngine,
    createBridge,
    createVideo: () => video,
    eventTarget: document,
  });
  return {
    root, track, getUserMedia, video, engine, bridge, renderer,
    createGestureEngine, createBridge, runtime,
  };
}

function appRoot() {
  const root = document.createElement('div');
  root.id = 'app';
  root.textContent = 'Keyboard command center';
  document.body.append(root);
  return root;
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
    dispose: vi.fn(),
  };
}
