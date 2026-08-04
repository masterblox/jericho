import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { CommandCenterStore } from './command-center-store';
import { CoreClient } from './core-client';
import { EngageGate } from './engage-gate';
import { GestureTargetRegistry } from './gesture-target-registry';
import { GestureLab } from './gesture-lab';
import { startInterfaceSoundEngine } from './interface-sound';
import { JerichoRuntime } from './jericho-runtime';

const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Jericho root is unavailable');

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

createRoot(rootElement).render(
  <StrictMode>
    {gestureLab ? <GestureLab root={rootElement} /> : <>
      <Suspense fallback={<div className="jericho-loading">CONNECTING TO JERICHO CORE</div>}>
        <SphereShell store={store} client={client} />
      </Suspense>
      <EngageGate createRuntime={() => new JerichoRuntime({
        root: rootElement,
        registry: gestureTargets,
        showAdvancedControls: false,
      })} />
    </>}
  </StrictMode>,
);

window.addEventListener('pagehide', () => {
  interfaceSounds.dispose();
}, { once: true });
