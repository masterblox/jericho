import { useEffect, useRef, useState } from 'react';
import type { EngagementState } from './jericho-runtime';

export interface RuntimeLifecyclePort {
  engage(): Promise<void>;
  wake(): void;
  recalibrate(): void;
  dispose(): void | Promise<void>;
}

export interface EngageGateProps {
  createRuntime: (onEngagementState: (state: EngagementState) => void) => RuntimeLifecyclePort;
  onRuntimeChange?: (runtime: RuntimeLifecyclePort | null) => void;
}

type GateState = 'idle' | 'engaging' | 'calibrating_left' | 'calibrating_right' | 'engaged' | 'failed' | 'dismissed';

const CALIBRATION_LABELS: Record<string, string> = {
  calibrating_left: 'Calibrating left hand — hold palm visible to camera',
  calibrating_right: 'Calibrating right hand — hold palm visible to camera',
};

export function EngageGate({ createRuntime, onRuntimeChange }: EngageGateProps) {
  const runtime = useRef<RuntimeLifecyclePort | null>(null);
  const engaging = useRef(false);
  const [state, setState] = useState<GateState>('idle');
  const [error, setError] = useState<string>();

  useEffect(() => () => {
    void runtime.current?.dispose();
    runtime.current = null;
    onRuntimeChange?.(null);
  }, [onRuntimeChange]);

  const handleEngagementState = (next: EngagementState) => {
    if (next === 'engaged') {
      setState('engaged');
    } else if (next === 'calibrating_left' || next === 'calibrating_right') {
      setState(next);
    }
  };

  const engage = async () => {
    if (engaging.current || runtime.current) return;
    engaging.current = true;
    setState('engaging');
    setError(undefined);
    const next = createRuntime(handleEngagementState);
    runtime.current = next;
    onRuntimeChange?.(next);
    try {
      await next.engage();
      if (runtime.current !== next) return;
      // The primary startup control promises to wake Jericho, not merely to
      // initialize camera, microphone, and the voice socket. BridgeClient can
      // safely queue this while the socket is connecting.
      next.wake();
      setState('engaged');
    } catch (reason) {
      if (runtime.current !== next) return;
      runtime.current = null;
      onRuntimeChange?.(null);
      await next.dispose();
      setError(reason instanceof Error ? reason.message : 'Local runtime permission failed');
      setState('failed');
    } finally {
      engaging.current = false;
    }
  };

  const continueWithKeyboard = async () => {
    const current = runtime.current;
    runtime.current = null;
    onRuntimeChange?.(null);
    setState('dismissed');
    if (current) await current.dispose();
  };

  if (state === 'engaged' || state === 'dismissed') return null;

  const calibrating = state === 'calibrating_left' || state === 'calibrating_right';

  return (
    <section className="jericho-engage-overlay" role="dialog" aria-modal="true" aria-labelledby="jericho-engage-title">
      <div className="jericho-engage-panel">
        <span className="jericho-eyebrow">JERICHO</span>
        <h2 id="jericho-engage-title">Wake Jericho</h2>
        {calibrating ? (
          <p className="jericho-engage-calibrating">{CALIBRATION_LABELS[state]}</p>
        ) : (
          <p>One click enables voice and hand control. Camera processing stays on this Mac; microphone audio reaches Gemini only while Jericho is awake.</p>
        )}
        {error && <p className="jericho-engage-error" role="alert">{error}</p>}
        <div className="jericho-engage-actions">
          {!calibrating && (
            <button
              className="jericho-engage-button"
              type="button"
              disabled={state === 'engaging'}
              onClick={() => void engage()}
            >
              {state === 'engaging' ? 'Waking…' : state === 'failed' ? 'Retry Wake' : 'Wake Jericho'}
            </button>
          )}
          <button
            className="jericho-engage-button jericho-engage-button--secondary"
            type="button"
            onClick={() => void continueWithKeyboard()}
          >
            {calibrating ? 'Use keyboard' : 'Not now'}
          </button>
        </div>
      </div>
    </section>
  );
}
