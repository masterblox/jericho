import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { CommandCenterApp } from './command-center-app';
import { CommandCenterStore } from './command-center-store';
import { CoreClient } from './core-client';
import { EngageGate } from './engage-gate';
import { GestureTargetRegistry } from './gesture-target-registry';
import { JarvisRuntime } from './jarvis-runtime';

const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Jericho root is unavailable');

const store = new CommandCenterStore();
const client = new CoreClient(store);
const gestureTargets = new GestureTargetRegistry(document);

createRoot(rootElement).render(
  <StrictMode>
    <CommandCenterApp store={store} client={client} />
    <EngageGate createRuntime={() => new JarvisRuntime({
      root: rootElement,
      registry: gestureTargets,
    })} />
  </StrictMode>,
);
