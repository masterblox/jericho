import { useEffect, useRef, useState } from 'react';

import { EngageGate } from './engage-gate';
import {
  JERICHO_APPROVAL_GESTURE_EVENT,
  JERICHO_CANCEL_PENDING_EVENT,
  JERICHO_NUCLEUS_CAMERA_EVENT,
  JERICHO_NUCLEUS_DEPTH_EVENT,
} from './gesture-events';
import { GestureTargetRegistry } from './gesture-target-registry';
import { JarvisRuntime, type GestureLabSnapshot } from './jarvis-runtime';

const STEPS = [
  ['aim', 'Right palm aim', 'Move your right open palm; the cyan cursor should follow.'],
  ['tap', 'Pinch tap', 'Pinch once over the large TARGET button.'],
  ['drag', 'Pinch drag', 'Pinch the MOVE card, move it, then release.'],
  ['hold', 'Pinch hold', 'Pinch and hold TARGET without moving to open its action ring.'],
  ['scroll', 'Left palm scroll', 'Move your left open palm vertically over communications.'],
  ['camera', 'Nucleus clutch', 'Pinch empty Nucleus space and move your hand.'],
  ['depth', 'Semantic depth', 'Use two open palms inside Nucleus and change their distance.'],
  ['approval', 'Approval decision', 'Hold right thumb up or down against the synthetic approval.'],
  ['cancel', 'Cancel', 'Hold both open palms outside Nucleus.'],
  ['fist', 'Closed fist inert', 'Make a closed fist; no action should dispatch.'],
  ['wake', 'Clap wake', 'Clap once; Algieba should say the Jericho greeting.'],
] as const;

type StepId = typeof STEPS[number][0];

export function GestureLab({ root }: { root: HTMLElement }) {
  const video = useRef<HTMLVideoElement>(null);
  const runtime = useRef<JarvisRuntime | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<GestureLabSnapshot>();
  const [passed, setPassed] = useState<Set<StepId>>(new Set());
  const [activity, setActivity] = useState('waiting for local runtime');

  const pass = (id: StepId, message: string) => {
    setPassed((current) => new Set(current).add(id));
    setActivity(message);
  };

  useEffect(() => {
    const approval = () => pass('approval', 'approval gesture dispatched');
    const cancel = () => pass('cancel', 'cancel gesture dispatched');
    const camera = () => pass('camera', 'Nucleus camera clutch dispatched');
    const depth = () => pass('depth', 'Nucleus semantic depth dispatched');
    document.addEventListener(JERICHO_APPROVAL_GESTURE_EVENT, approval);
    document.addEventListener(JERICHO_CANCEL_PENDING_EVENT, cancel);
    document.addEventListener(JERICHO_NUCLEUS_CAMERA_EVENT, camera);
    document.addEventListener(JERICHO_NUCLEUS_DEPTH_EVENT, depth);
    return () => {
      document.removeEventListener(JERICHO_APPROVAL_GESTURE_EVENT, approval);
      document.removeEventListener(JERICHO_CANCEL_PENDING_EVENT, cancel);
      document.removeEventListener(JERICHO_NUCLEUS_CAMERA_EVENT, camera);
      document.removeEventListener(JERICHO_NUCLEUS_DEPTH_EVENT, depth);
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.hands.some((hand) => hand.handedness === 'Right' && hand.fresh)) pass('aim', 'right hand tracking active');
    if (snapshot.actions.some((action) => action.type === 'drag-start' || action.type === 'drag-move' || action.type === 'drag-end')) pass('drag', 'production drag controller dispatched');
    if (snapshot.actions.some((action) => action.type === 'hold')) pass('hold', 'production hold controller opened the action ring');
    if (snapshot.actions.some((action) => action.type === 'left-scroll')) pass('scroll', 'production communications scroll dispatched');
    if (snapshot.hands.some((hand) => hand.recognizedGesture === 'Closed_Fist') && snapshot.actions.length === 0) pass('fist', 'closed fist observed with no dispatched action');
    if (snapshot.wakeSource === 'clap') pass('wake', 'clap wake reached the unified Gemini voice path');
  }, [snapshot]);

  const createRuntime = () => {
    const camera = video.current;
    if (!camera) throw new Error('Gesture Lab camera surface is unavailable');
    const next = new JarvisRuntime({
      root,
      registry: new GestureTargetRegistry(document),
      createVideo: () => camera,
      onGestureLabSnapshot: setSnapshot,
    });
    runtime.current = next;
    return next;
  };

  return (
    <main className="gesture-lab">
      <header className="gesture-lab__header">
        <div><span className="jericho-eyebrow">JERICHO / PRODUCTION RUNTIME</span><h1>Gesture Lab</h1></div>
        <div className="gesture-lab__status"><i />{snapshot?.status ?? 'standby'}</div>
        <button type="button" onClick={() => runtime.current?.wake()}>Manual wake</button>
        <a href="/">Command center</a>
      </header>

      <section className="gesture-lab__stage">
        <div className="gesture-lab__camera"><video ref={video} autoPlay muted playsInline /><span>LOCAL MIRRORED CAMERA · NOT RECORDED</span></div>
        <div className="gesture-lab__nucleus" data-jericho-nucleus-space="true">
          <strong>NUCLEUS TEST SPACE</strong><small>empty-space clutch · two-palm depth</small>
        </div>
        <button className="gesture-lab__target" data-gesture-target="lab-target" onClick={() => pass('tap', 'production target tap invoked')} type="button">
          TARGET<small>pinch tap / hold</small>
          <span data-gesture-context-action="inspect">INSPECT</span>
        </button>
        <button className="gesture-lab__drag" data-gesture-target="lab-drag" data-gesture-draggable="true" type="button">MOVE</button>
      </section>

      <aside className="gesture-lab__telemetry" aria-label="Sanitized gesture telemetry">
        <h2>Live telemetry</h2>
        <dl>
          <div><dt>FPS</dt><dd>{snapshot?.performance.fps ?? '—'}</dd></div>
          <div><dt>Inference</dt><dd>{snapshot ? `${snapshot.performance.inferenceMs} ms` : '—'}</dd></div>
          <div><dt>Clap</dt><dd>{snapshot?.wakeSource === 'clap' ? 'DETECTED' : 'armed'}</dd></div>
          <div><dt>Targets</dt><dd>L {snapshot?.targets.leftId ?? '—'} · R {snapshot?.targets.rightId ?? '—'}</dd></div>
        </dl>
        {(snapshot?.hands ?? []).map((hand) => <article key={hand.handedness}>
          <strong>{hand.handedness}</strong><span>{hand.recognizedGesture ?? hand.state}</span>
          <span>pinch {hand.pinchPhase} · {hand.pinchRatio}</span><span>{hand.fresh ? 'fresh' : `lost ${hand.lossAgeMs}ms`}</span>
        </article>)}
        <p>{activity}</p>
      </aside>

      <section className="gesture-lab__tests">
        <h2>Guided production checks</h2>
        <ol>{STEPS.map(([id, title, instruction]) => <li className={passed.has(id) ? 'is-pass' : ''} key={id}>
          <b>{passed.has(id) ? 'PASS' : 'LIVE'}</b><div><strong>{title}</strong><span>{instruction}</span></div>
        </li>)}</ol>
      </section>

      <section className="gesture-lab__comms jericho-bay--left"><h2>Communications scroll</h2>{Array.from({ length: 12 }, (_, index) => <p key={index}>Priority conversation {index + 1}</p>)}</section>
      <article className="gesture-lab__approval" data-jericho-active-approval="true" data-jericho-approval-mission-id="gesture-lab" data-jericho-approval-plan-hash="local-synthetic-plan" data-jericho-approval-version="1"><b>SYNTHETIC LOCAL APPROVAL</b><span>Thumb up / down · no external effect</span></article>
      <EngageGate createRuntime={createRuntime} />
    </main>
  );
}
