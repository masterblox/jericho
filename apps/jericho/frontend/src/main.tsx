import { lazy, StrictMode, Suspense, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { CommandCenterStore } from './command-center-store';
import { CoreClient } from './core-client';
import { EngageGate } from './engage-gate';
import type { RuntimeLifecyclePort } from './engage-gate';
import { GestureTargetRegistry } from './gesture-target-registry';
import { GestureLab } from './gesture-lab';
import { startInterfaceSoundEngine } from './interface-sound';
import { JerichoRuntime } from './jericho-runtime';

const discoveredRoot = document.getElementById('app');
if (!discoveredRoot) throw new Error('Jericho root is unavailable');
const rootElement: HTMLElement = discoveredRoot;

const store = new CommandCenterStore();
const client = new CoreClient(store);
const gestureTargets = new GestureTargetRegistry(document);
const interfaceSounds = startInterfaceSoundEngine({
  eventTarget: document,
  storage: localStorage,
});

const gestureLab = new URLSearchParams(window.location.search).get('lab') === 'gestures';
const SphereShell = lazy(async () => {
  const module = await import('./sphere-shell');
  return { default: module.SphereShell };
});

function JerichoExperience() {
  const [activeRuntime, setActiveRuntime] = useState<RuntimeLifecyclePort | null>(null);
  const runtimeChanged = useCallback((runtime: RuntimeLifecyclePort | null) => {
    setActiveRuntime(runtime);
  }, []);
  const recalibrate = useCallback(() => activeRuntime?.recalibrate(), [activeRuntime]);

  return gestureLab ? <GestureLab root={rootElement} /> : (
    <>
      <Suspense fallback={<div className="jericho-loading">CONNECTING TO JERICHO CORE</div>}>
        <SphereShell
          store={store}
          client={client}
          onRecalibrate={activeRuntime ? recalibrate : undefined}
        />
      </Suspense>
      <EngageGate createRuntime={(onState) => new JerichoRuntime({
        root: rootElement,
        registry: gestureTargets,
        showAdvancedControls: false,
        onEngagementState: onState,
      })} onRuntimeChange={runtimeChanged} />
    </>
  );
}

createRoot(rootElement).render(
  <StrictMode><JerichoExperience /></StrictMode>,
);

window.addEventListener('pagehide', () => {
  interfaceSounds.dispose();
}, { once: true });
