import { useEffect, useRef, useState } from 'react';

export interface RuntimeLifecyclePort {
  engage(): Promise<void>;
  dispose(): void | Promise<void>;
}

export interface EngageGateProps {
  createRuntime: () => RuntimeLifecyclePort;
}

type GateState = 'idle' | 'engaging' | 'engaged' | 'failed' | 'dismissed';

/** Hardware is constructed only from the explicit button event, never an effect. */
export function EngageGate({ createRuntime }: EngageGateProps) {
  const runtime = useRef<RuntimeLifecyclePort | null>(null);
  const engaging = useRef(false);
  const [state, setState] = useState<GateState>('idle');
  const [error, setError] = useState<string>();

  useEffect(() => () => {
    void runtime.current?.dispose();
    runtime.current = null;
  }, []);

  const engage = async () => {
    if (engaging.current || runtime.current) return;
    engaging.current = true;
    setState('engaging');
    setError(undefined);
    const next = createRuntime();
    runtime.current = next;
    try {
      await next.engage();
      setState('engaged');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Local runtime permission failed');
      setState('failed');
    } finally {
      engaging.current = false;
    }
  };

  const continueWithKeyboard = async () => {
    const current = runtime.current;
    runtime.current = null;
    if (current) await current.dispose();
    setState('dismissed');
  };

  if (state === 'engaged' || state === 'dismissed') return null;
  return (
    <section className="jericho-engage-overlay" role="dialog" aria-modal="true" aria-labelledby="jericho-engage-title">
      <div className="jericho-engage-panel">
        <span className="jericho-eyebrow">LOCAL HARDWARE BOUNDARY</span>
        <h2 id="jericho-engage-title">Enable voice + gestures</h2>
        <p>Camera and microphone remain local to this runtime. The command center is fully usable by keyboard if permission is unavailable.</p>
        {error && <p className="jericho-engage-error" role="alert">{error}</p>}
        {state === 'failed' ? (
          <button className="jericho-engage-button" type="button" onClick={() => void continueWithKeyboard()}>
            Continue with keyboard
          </button>
        ) : (
          <button
            className="jericho-engage-button"
            type="button"
            disabled={state === 'engaging'}
            onClick={() => void engage()}
          >
            {state === 'engaging' ? 'Engaging…' : 'Engage local runtime'}
          </button>
        )}
      </div>
    </section>
  );
}
