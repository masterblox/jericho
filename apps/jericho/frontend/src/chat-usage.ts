import { ConnectorHealthStatus, type CommandCenterSnapshot } from '@jericho/shared';

import type { CoreHealth } from './core-client';

export interface CoreUsageMeter {
  actualMicroUsd: number;
  maxMicroUsd: number;
  spentLabel: string;
  capLabel: string;
  ratio: number;
  missionCount: number;
  connectorsHealthy: number;
  connectorsTotal: number;
  connectorLabel: string;
}

export function coreUsageMeter(
  snapshot: CommandCenterSnapshot | undefined,
  health: CoreHealth | undefined,
): CoreUsageMeter {
  const missions = snapshot?.missions ?? [];
  const actualMicroUsd = missions.reduce((sum, mission) => sum + (mission.budget?.actualCostMicroUsd ?? 0), 0);
  const maxMicroUsd = missions.reduce((sum, mission) => sum + (mission.budget?.limits?.maxCostMicroUsd ?? 0), 0);
  const snapshotConnectors = snapshot?.connectors ?? [];
  const healthConnectors = health?.connectors ?? [];
  const connectors = snapshotConnectors.length > 0
    ? snapshotConnectors.map((connector) => ({ status: connector.status }))
    : healthConnectors;
  const connectorsHealthy = connectors.filter((connector) => connector.status === ConnectorHealthStatus.Healthy
    || connector.status === 'healthy').length;
  const connectorsTotal = connectors.length;
  return {
    actualMicroUsd,
    maxMicroUsd,
    spentLabel: formatUsdFromMicro(actualMicroUsd),
    capLabel: formatUsdFromMicro(maxMicroUsd),
    ratio: maxMicroUsd > 0 ? Math.min(1, actualMicroUsd / maxMicroUsd) : 0,
    missionCount: missions.length,
    connectorsHealthy,
    connectorsTotal,
    connectorLabel: connectorsTotal === 0
      ? 'No connectors reported'
      : `${connectorsHealthy}/${connectorsTotal} connectors healthy`,
  };
}

export function formatUsdFromMicro(microUsd: number): string {
  const value = Number.isFinite(microUsd) ? microUsd / 1_000_000 : 0;
  return `$${value.toFixed(2)}`;
}
