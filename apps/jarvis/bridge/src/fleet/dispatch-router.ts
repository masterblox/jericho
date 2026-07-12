import { AgentLane, MissionTaskKind } from '@jericho/shared';

import type { FleetDispatchMode, FleetLaneRegistry } from './lane-registry.js';

export interface FleetDispatchDecisionInput {
  lane: AgentLane;
  summary: string;
  taskKind?: MissionTaskKind;
  /** Prefer durable when true (Iris on-demand, multi-step, track-until-done). */
  preferDurable?: boolean;
}

export interface FleetDispatchDecision {
  mode: FleetDispatchMode;
  reason: string;
}

const INTERACTIVE_HINTS = [
  /\b(ask|ping|wake|quick|reply|status|check)\b/i,
  /\b(what('s| is)|who|when|where)\b/i,
];

const DURABLE_HINTS = [
  /\b(track|until done|ticket|cron|multi[- ]?step|deliverable|report|digest)\b/i,
  /\b(implement|build|ship|deploy|refactor|investigate thoroughly)\b/i,
];

/**
 * Hybrid router: interactive → Telegram wake; durable → bridge + Paperclip.
 * Falls back when a transport is missing.
 */
export function decideFleetDispatch(
  registry: FleetLaneRegistry,
  input: FleetDispatchDecisionInput,
): FleetDispatchDecision {
  const target = registry.target(input.lane);
  if (!target) {
    return { mode: 'telegram_wake', reason: 'unknown_lane' };
  }

  const durablePreferred =
    input.preferDurable === true ||
    input.lane === AgentLane.Iris ||
    input.taskKind === MissionTaskKind.Execute ||
    DURABLE_HINTS.some((pattern) => pattern.test(input.summary)) ||
    !INTERACTIVE_HINTS.some((pattern) => pattern.test(input.summary));

  if (registry.dispatchMode === 'telegram_only') {
    return registry.hasTelegramWake(input.lane)
      ? { mode: 'telegram_wake', reason: 'telegram_only' }
      : { mode: 'bridge_handoff', reason: 'telegram_only_missing_recipient' };
  }

  if (registry.dispatchMode === 'durable_only') {
    return durableMode(registry, 'durable_only');
  }

  // hybrid
  if (!durablePreferred && registry.hasTelegramWake(input.lane)) {
    return { mode: 'telegram_wake', reason: 'interactive_wake' };
  }
  if (durablePreferred || !registry.hasTelegramWake(input.lane)) {
    return durableMode(registry, durablePreferred ? 'durable_signal' : 'no_telegram_recipient');
  }
  return { mode: 'telegram_wake', reason: 'interactive_wake' };
}

function durableMode(
  registry: FleetLaneRegistry,
  reason: string,
): FleetDispatchDecision {
  if (registry.hasBridge()) {
    return { mode: 'hybrid_durable', reason };
  }
  return { mode: 'paperclip', reason: `${reason}_paperclip_only` };
}
