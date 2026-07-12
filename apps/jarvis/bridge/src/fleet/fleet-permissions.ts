import { MutationClass, type MissionPermissions } from '@jericho/shared';

import type { FleetLaneRegistry } from './lane-registry.js';

/** Expand mission permissions so fleet telegram / bridge external actions validate. */
export function fleetMissionPermissions(registry: FleetLaneRegistry): MissionPermissions {
  const recipients = registry.targets()
    .map((target) => target.telegramRecipient)
    .filter((value): value is string => Boolean(value));
  const hasTelegram = recipients.length > 0;
  const hasBridge = registry.hasBridge();

  const allowedTools: string[] = [];
  const allowedSystems: string[] = [];
  const allowedChannels: string[] = [];
  const allowedCredentialRefs: string[] = [];
  const allowedDataScopes: string[] = [];
  const allowedRecipients: string[] = [];

  if (hasTelegram) {
    allowedTools.push('telegram.send');
    allowedSystems.push('telegram');
    allowedChannels.push('telegram');
    allowedCredentialRefs.push('telegram-gateway');
    allowedDataScopes.push('telegram:selected');
    allowedRecipients.push(...recipients);
  }
  if (hasBridge) {
    allowedTools.push('fleet.bridge.write');
    // connectorId is checked against allowedSystems
    allowedSystems.push('fleet-bridge', 'conductor-bridge');
    allowedChannels.push('filesystem');
    allowedCredentialRefs.push('fleet-bridge');
    allowedDataScopes.push('fleet:bridge');
    allowedRecipients.push('fleet-bridge');
  }

  return {
    allowedTools,
    allowedSystems,
    allowedRepositories: [],
    allowedChannels,
    allowedRecipients: [...new Set(allowedRecipients)],
    allowedCredentialRefs,
    allowedDataScopes,
    allowedMutationClasses: [MutationClass.ReadOnly, MutationClass.Reversible],
  };
}

export function mergeMissionPermissions(
  base: MissionPermissions,
  extra: MissionPermissions,
): MissionPermissions {
  return {
    allowedTools: unique([...base.allowedTools, ...extra.allowedTools]),
    allowedSystems: unique([...base.allowedSystems, ...extra.allowedSystems]),
    allowedRepositories: structuredClone(base.allowedRepositories),
    allowedChannels: unique([...base.allowedChannels, ...extra.allowedChannels]),
    allowedRecipients: unique([...base.allowedRecipients, ...extra.allowedRecipients]),
    allowedCredentialRefs: unique([...base.allowedCredentialRefs, ...extra.allowedCredentialRefs]),
    allowedDataScopes: unique([...base.allowedDataScopes, ...extra.allowedDataScopes]),
    allowedMutationClasses: [...new Set([
      ...base.allowedMutationClasses,
      ...extra.allowedMutationClasses,
    ])],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
