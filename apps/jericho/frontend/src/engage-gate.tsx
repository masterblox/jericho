import { useEffect, useRef, useState } from 'react';
import type { EngagementState } from './jericho-runtime';

export interface RuntimeLifecyclePort {
  engage(): Promise<void>;
  dispose(): void | Promise<void>;
}

export interface EngageGateProps {
  createRuntime: (onEngagementState: (state: EngagementState) => void) => RuntimeLifecyclePort;
}

type GateState = 'idle' | 'engaging' | 'calibrating_left' | 'calibrating_right' | 'engaged' | 'failed' | 'dismissed';

const CALIBRATION_LABELS: Record<string, string> = {
  calibrating_left: 'Calibrating left hand — hold palm visible to camera',
  calibrating_right: 'Calibrating right hand — hold palm visible to camera',
};

export function EngageGate({ createRuntime }: EngageGateProps) {
  const runtime = useRef<RuntimeLifecyclePort | null>(null);
  const engaging = useRef(false);
  const [state, setState] = useState<GateState>('idle');
  const [error, setError] = useState<string>();

  useEffect(() => () => {
    void runtime.current?.dispose();
    runtime.current = null;
  }, []);

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
    try {
      await next.engage();
      if (runtime.current !== next) return;
      setState('engaged');
    } catch (reason) {
      if (runtime.current !== next) return;
      setError(reason instanceof Error ? reason.message : 'Local runtime permission failed');
      setState('failed');
    } finally {
      engaging.current = false;
    }
  };

  const continueWithKeyboard = async () => {
    const current = runtime.current;
    runtime.current = null;
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
        {!calibrating && (
          <div className="jericho-engage-actions">
            {state !== 'failed' && (
              <button
                className="jericho-engage-button"
                type="button"
                disabled={state === 'engaging'}
                onClick={() => void engage()}
              >
                {state === 'engaging' ? 'Waking…' : 'Wake Jericho'}
              </button>
            )}
            <button
              className="jericho-engage-button jericho-engage-button--secondary"
              type="button"
              onClick={() => void continueWithKeyboard()}
            >
              Not now
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
