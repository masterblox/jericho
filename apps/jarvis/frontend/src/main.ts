import './styles.css';
import { GestureEngine } from './gestures';
import { HUD } from './hud';
import { BridgeClient } from './bridge-client';

const TOOL_LABELS: Record<string, string> = {
  list_open_tasks: 'Pulling open tasks',
  draft_email: 'Drafting email',
  fleet_status: 'Checking fleet',
};

async function main() {
  const app = document.getElementById('app')!;

  // start overlay — required user gesture for mic + audio
  await new Promise<void>((resolve) => {
    app.innerHTML = `
      <div class="start-overlay" id="overlay">
        <div class="pulse-ring"></div>
        <h1>JARVIS</h1>
        <p>click to engage · enable camera + mic</p>
      </div>`;
    document.getElementById('overlay')!.addEventListener('click', () => {
      document.getElementById('overlay')!.remove();
      resolve();
    });
  });

  app.innerHTML = '';
  app.classList.add('boot');
  const hud = new HUD(app);

  // gesture layer (camera) — OS cursor stays visible; HUD hides it per-frame
  // only while a hand is actively tracked, so the browser is never trapped.
  let gestureEngine: GestureEngine | null = null;
  hud.onSwapHands((swapped) => gestureEngine?.setSwapHands(swapped));
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
      audio: false,
    });
    hud.video.srcObject = stream;
    await hud.video.play();
    const settings = stream.getVideoTracks()[0]?.getSettings();
    hud.setCameraInfo(
      settings?.deviceId ?? 'default',
      settings?.width ?? hud.video.videoWidth,
      settings?.height ?? hud.video.videoHeight,
    );
    gestureEngine = await GestureEngine.create(hud.video);
    gestureEngine.start((f) => hud.onFrame(f));
  } catch (err) {
    hud.showError(`camera: ${(err as Error).message}`);
  }

  // Escape key: force-restore the OS cursor + freeze gestures so the user
  // can always click around the browser even if tracking goes haywire.
  let gesturesFrozen = false;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      gesturesFrozen = !gesturesFrozen;
      app.classList.toggle('gestures-frozen', gesturesFrozen);
      if (gesturesFrozen) {
        gestureEngine?.stop();
        app.classList.remove('cursor-hidden');
        hud.setStatus('JARVIS · GESTURES PAUSED — press ESC to resume');
      } else {
        gestureEngine?.start((f) => hud.onFrame(f));
        hud.setStatus('JARVIS · ONLINE', true);
      }
    }
  });

  // voice layer (Gemini Live — always-on streaming, Gemini hears the wake word)
  const bridge = new BridgeClient({
    onReady: () => hud.setStatus('JARVIS · ONLINE', true),
    onArmed: (a) => hud.setArmed(a),
    onStatus: (s) => hud.setStatus(`JARVIS · ${s.toUpperCase()}`),
    onText: (t) => hud.setTranscript(t),
    onToolStart: (name, args) => hud.addTask(name, TOOL_LABELS[name] ?? name),
    onToolResult: (name, result) => hud.completeTask(name, result),
    onError: (m) => hud.showError(m),
  });
  // click the standby badge for a manual nudge
  hud.onWakeClick(() => bridge.wake());
  bridge.start();

  app.classList.remove('boot');
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById('app')!;
  app.innerHTML = `<div class="fatal">${(err as Error).message || err}</div>`;
});
