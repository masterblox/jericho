import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { CommandCenterApp } from './command-center-app';
import { CommandCenterStore } from './command-center-store';
import { CoreClient } from './core-client';
import { EngageGate } from './engage-gate';
import { GestureTargetRegistry } from './gesture-target-registry';
import { GestureLab } from './gesture-lab';
import { JarvisRuntime } from './jarvis-runtime';

const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Jericho root is unavailable');

const store = new CommandCenterStore();
const client = new CoreClient(store);
const gestureTargets = new GestureTargetRegistry(document);

const gestureLab = new URLSearchParams(window.location.search).get('lab') === 'gestures';
const legacyCommandCenter = new URLSearchParams(window.location.search).get('view') === 'command';
const SphereShell = lazy(async () => {
  const module = await import('./sphere-shell');
  return { default: module.SphereShell };
});

createRoot(rootElement).render(
  <StrictMode>
    {gestureLab ? <GestureLab root={rootElement} /> : legacyCommandCenter ? <>
      <CommandCenterApp store={store} client={client} />
      <EngageGate createRuntime={() => new JarvisRuntime({
        root: rootElement,
        registry: gestureTargets,
      })} />
    </> : <>
      <Suspense fallback={<div className="jericho-loading">CONNECTING TO JERICHO CORE</div>}>
        <SphereShell store={store} client={client} />
      </Suspense>
      <EngageGate createRuntime={() => new JarvisRuntime({ root: rootElement, registry: gestureTargets })} />
    </>}
  </StrictMode>,
);
