import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  buildWifiMappingActionPlan,
  NodeStaticSiteProcessPort,
  selectSecondaryDisplay,
  WifiMappingExperienceLauncher,
  wifiMappingExperienceDescriptor,
  type BrowserPort,
  type ExperienceProcessPort,
  type WindowPort,
} from '../src/experiences/wifi-mapping/index.js';

describe('wifi-mapping Jericho experience contract', () => {
  it('records inspected RuView provenance and keeps the truth boundary simulated', async () => {
    expect(wifiMappingExperienceDescriptor).toMatchObject({
      id: 'wifi-mapping',
      version: '2026.08.04',
      route: '/observatory.html',
      stableUrl: 'http://127.0.0.1:39004/observatory.html',
      simulation: {
        demoLabelRequired: true,
        scenario: 'gesture_control',
        people: 1,
        peopleAreSynthetic: true,
        props: ['TV'],
        autoCycle: false,
      },
      provenance: {
        image: 'ghcr.io/ruvnet/wifi-densepose@sha256:c94b541fe6269e5ce28ebfc297e34cf240997427c8f9bfb97f6775b32d50ceab',
        imageDigest: 'sha256:c94b541fe6269e5ce28ebfc297e34cf240997427c8f9bfb97f6775b32d50ceab',
        manifestDigest: 'sha256:dfa81709ff7889dd394eb5f1f069618d4bff90e306789a9f4ca94821e450720c',
        source: 'https://github.com/ruvnet/RuView',
        revision: '5780c239e4cdcd4389eed37a96d19a98154ebe03',
        license: 'MIT',
      },
    });
    expect(wifiMappingExperienceDescriptor.simulation.truthBoundary).toContain('DEMO/SIMULATED only');
    expect(JSON.stringify(wifiMappingExperienceDescriptor)).not.toContain('/tmp/');

    const page = await readFile(new URL('../src/experiences/wifi-mapping/assets/observatory.html', import.meta.url), 'utf8');
    expect(page).toContain('data-experience-id="wifi-mapping"');
    expect(page).toContain('DEMO');
    expect(page).toContain('SIMULATED');
    expect(page).toContain('NO LIVE SENSING');
    expect(page).toContain('gesture_control');
    expect(page).toContain('1 synthetic');
    expect(page).toContain('TV PROP');
    expect(page).toContain("does not see Carlos's wife");
    expect(page).toContain('not measured');
    expect(page).not.toContain('Auto-Cycle');
  });

  it('starts idempotently through the process port and returns the stable local URL', async () => {
    const processPort: ExperienceProcessPort = {
      ensureStaticSite: vi.fn(async () => ({
        baseUrl: 'http://127.0.0.1:39004',
        readyUrl: 'http://127.0.0.1:39004/observatory.html',
      })),
    };
    const launcher = new WifiMappingExperienceLauncher({
      processPort,
      browserPort: fakeBrowserPort(),
      windowPort: fakeWindowPort(),
    });

    await expect(launcher.start()).resolves.toMatchObject({
      ready: true,
      url: 'http://127.0.0.1:39004/observatory.html',
      descriptor: { id: 'wifi-mapping', stableUrl: 'http://127.0.0.1:39004/observatory.html' },
    });
    await launcher.start();

    expect(processPort.ensureStaticSite).toHaveBeenCalledTimes(1);
    expect(processPort.ensureStaticSite).toHaveBeenCalledWith({
      host: '127.0.0.1',
      preferredPort: 39004,
      rootDirectory: expect.stringContaining('/src/experiences/wifi-mapping/assets'),
      readinessPath: '/observatory.html',
      readinessMarker: 'data-experience-id="wifi-mapping"',
    });
  });

  it('exports a bounded Chrome action plan using discovered secondary display inventory', () => {
    const displays = [
      { id: 'built-in', index: 0, x: 0, y: 0, width: 1512, height: 982, primary: true },
      { id: 'studio-display', index: 1, x: -1920, y: 0, width: 1920, height: 1080, primary: false },
    ];

    expect(buildWifiMappingActionPlan('http://127.0.0.1:39004/observatory.html', displays)).toEqual({
      experienceId: 'wifi-mapping',
      url: 'http://127.0.0.1:39004/observatory.html',
      targetDisplay: displays[1],
      actions: [
        {
          type: 'open_chrome_window',
          browser: 'Google Chrome',
          url: 'http://127.0.0.1:39004/observatory.html',
          freshWindow: true,
        },
        {
          type: 'move_chrome_window',
          displayId: 'studio-display',
          position: 'full',
          reason: 'secondary_display',
        },
      ],
    });

    expect(() => buildWifiMappingActionPlan('http://example.com/observatory.html', displays))
      .toThrow('experience_url_must_be_stable_local_observatory');
    expect(() => selectSecondaryDisplay([displays[0]]))
      .toThrow('secondary_display_required');
  });

  it('opens a fresh Chrome window and moves it through injected ports', async () => {
    const browserPort: BrowserPort = {
      openFreshChromeWindow: vi.fn(async () => ({ application: 'Google Chrome' as const, windowCountAfter: 5 })),
    };
    const windowPort: WindowPort = {
      listDisplays: vi.fn(async () => [
        { id: '0', index: 0, x: 0, y: 0, width: 1512, height: 982, primary: true },
        { id: '1', index: 1, x: 1512, y: 0, width: 1920, height: 1080, primary: false },
      ]),
      moveChromeWindowToDisplay: vi.fn(async input => ({
        application: 'Google Chrome' as const,
        displayId: input.displayId,
        bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
      })),
    };
    const launcher = new WifiMappingExperienceLauncher({
      processPort: fakeProcessPort(),
      browserPort,
      windowPort,
    });

    await expect(launcher.openOnSecondaryDisplay()).resolves.toMatchObject({
      plan: { targetDisplay: { id: '1' } },
      browser: { application: 'Google Chrome', windowCountAfter: 5 },
      placement: { application: 'Google Chrome', displayId: '1' },
    });
    expect(browserPort.openFreshChromeWindow).toHaveBeenCalledWith('http://127.0.0.1:39004/observatory.html');
    expect(windowPort.moveChromeWindowToDisplay).toHaveBeenCalledWith({ displayId: '1' });
  });

  it('closes a Jericho-owned static server and can start it again', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const processPort: ExperienceProcessPort = {
      ensureStaticSite: vi.fn(async () => ({
        baseUrl: 'http://127.0.0.1:39004',
        readyUrl: 'http://127.0.0.1:39004/observatory.html',
        close,
      })),
    };
    const launcher = new WifiMappingExperienceLauncher({
      processPort, browserPort: fakeBrowserPort(), windowPort: fakeWindowPort(),
    });
    await launcher.start();
    await launcher.close();
    await launcher.start();
    expect(close).toHaveBeenCalledTimes(1);
    expect(processPort.ensureStaticSite).toHaveBeenCalledTimes(2);
  });

  it('serves the durable page without shelling out or relying on a temporary path', async () => {
    const port = new NodeStaticSiteProcessPort();
    const server = await port.ensureStaticSite({
      host: '127.0.0.1',
      preferredPort: 0,
      rootDirectory: new URL('../src/experiences/wifi-mapping/assets', import.meta.url).pathname,
      readinessPath: '/observatory.html',
      readinessMarker: 'data-experience-id="wifi-mapping"',
    });

    try {
      const response = await fetch(server.readyUrl);
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(text).toContain('data-experience-id="wifi-mapping"');
      expect(text).toContain('TV PROP');
      expect(text).toContain('1 synthetic');
    } finally {
      await server.close?.();
    }
  });
});

function fakeProcessPort(): ExperienceProcessPort {
  return {
    ensureStaticSite: vi.fn(async () => ({
      baseUrl: 'http://127.0.0.1:39004',
      readyUrl: 'http://127.0.0.1:39004/observatory.html',
    })),
  };
}

function fakeBrowserPort(): BrowserPort {
  return {
    openFreshChromeWindow: vi.fn(async () => ({ application: 'Google Chrome' as const })),
  };
}

function fakeWindowPort(): WindowPort {
  return {
    listDisplays: vi.fn(async () => [
      { id: '0', x: 0, y: 0, width: 1512, height: 982, primary: true },
      { id: '1', x: 1512, y: 0, width: 1920, height: 1080, primary: false },
    ]),
    moveChromeWindowToDisplay: vi.fn(async () => ({
      application: 'Google Chrome' as const,
      displayId: '1',
      bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
    })),
  };
}
