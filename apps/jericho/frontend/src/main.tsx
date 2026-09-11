import { lazy, StrictMode, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/geist';
import './styles.css';
import { ChatSessionStore } from './chat-session';
import { CommandCenterStore } from './command-center-store';
import { CoreClient } from './core-client';
import { EngageGate, type RuntimeLifecyclePort } from './engage-gate';
import { GestureTargetRegistry } from './gesture-target-registry';
import { GestureLab } from './gesture-lab';
import { startInterfaceSoundEngine } from './interface-sound';
import { JerichoRuntime } from './jericho-runtime';

const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Jericho root is unavailable');

const store = new CommandCenterStore();
const client = new CoreClient(store);
const session = new ChatSessionStore();
const gestureTargets = new GestureTargetRegistry(document);
const interfaceSounds = startInterfaceSoundEngine({
  eventTarget: document,
  storage: localStorage,
});

const gestureLab = new URLSearchParams(window.location.search).get('lab') === 'gestures';
const ChatShell = lazy(async () => {
  const module = await import('./chat-shell');
  return { default: module.ChatShell };
});

function ProductRoot() {
  const [runtime, setRuntime] = useState<RuntimeLifecyclePort | null>(null);
  return (
    <>
      <Suspense fallback={<div className="jericho-loading">CONNECTING TO JERICHO CORE</div>}>
        <ChatShell store={store} client={client} session={session} runtime={runtime} />
      </Suspense>
      <EngageGate
        createRuntime={(onEngagementState) => new JerichoRuntime({
          root: rootElement!,
          registry: gestureTargets,
          onEngagementState,
        })}
        onRuntimeChange={setRuntime}
      />
    </>
  );
}

createRoot(rootElement).render(
  <StrictMode>
    {gestureLab ? <GestureLab root={rootElement} /> : <ProductRoot />}
  </StrictMode>,
);

window.addEventListener('pagehide', () => {
  interfaceSounds.dispose();
}, { once: true });
