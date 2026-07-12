import { AgentLane } from '@jericho/shared';

/** How Jericho Core wakes or queues a fleet lane. */
export type FleetDispatchMode = 'telegram_wake' | 'bridge_handoff' | 'paperclip' | 'hybrid_durable';

export interface FleetLaneTarget {
  lane: AgentLane;
  /** Human label (PA vs Angela enum). */
  label: string;
  /** Hermes Telegram bot recipient / chat id when interactive wake is configured. */
  telegramRecipient?: string;
  /** Paperclip title tag, e.g. `[DevOps]`. */
  paperclipTag: string;
  /** Subdir under bridge outbox for durable handoffs. */
  bridgeHandoffDir: string;
}

export interface FleetLaneRegistryConfig {
  telegramRecipients?: Partial<Record<AgentLane, string>>;
  bridgeRoot?: string;
  dispatchMode?: 'hybrid' | 'telegram_only' | 'durable_only';
}

export interface FleetLaneRegistry {
  readonly bridgeRoot?: string;
  readonly dispatchMode: 'hybrid' | 'telegram_only' | 'durable_only';
  target(lane: AgentLane): FleetLaneTarget | undefined;
  targets(): FleetLaneTarget[];
  hasTelegramWake(lane: AgentLane): boolean;
  hasBridge(): boolean;
}

const PAPERCLIP_TAGS: Record<AgentLane, string> = {
  [AgentLane.Dev]: '[DevOps]',
  [AgentLane.Angela]: '[Ops]',
  [AgentLane.Donald]: '[Sales]',
  [AgentLane.Iris]: '[Design]',
  [AgentLane.Researcher]: '[Research]',
  [AgentLane.Analyst]: '[Analysis]',
};

const LABELS: Record<AgentLane, string> = {
  [AgentLane.Dev]: 'DEV',
  [AgentLane.Angela]: 'PA',
  [AgentLane.Donald]: 'Donald',
  [AgentLane.Iris]: 'Iris',
  [AgentLane.Researcher]: 'Researcher',
  [AgentLane.Analyst]: 'Analyst',
};

const BRIDGE_DIRS: Record<AgentLane, string> = {
  [AgentLane.Dev]: 'jericho-handoffs',
  [AgentLane.Angela]: 'jericho-handoffs',
  [AgentLane.Donald]: 'jericho-handoffs',
  [AgentLane.Iris]: 'iris-consults',
  [AgentLane.Researcher]: 'jericho-handoffs',
  [AgentLane.Analyst]: 'jericho-handoffs',
};

const COMMANDABLE_LANES: readonly AgentLane[] = [
  AgentLane.Dev,
  AgentLane.Angela,
  AgentLane.Donald,
  AgentLane.Iris,
  AgentLane.Researcher,
  AgentLane.Analyst,
];

export function createFleetLaneRegistry(config: FleetLaneRegistryConfig = {}): FleetLaneRegistry {
  const recipients = config.telegramRecipients ?? {};
  const bridgeRoot = optionalPath(config.bridgeRoot);
  const dispatchMode = config.dispatchMode ?? 'hybrid';
  const byLane = new Map<AgentLane, FleetLaneTarget>();

  for (const lane of COMMANDABLE_LANES) {
    const telegramRecipient = optionalPath(recipients[lane]);
    byLane.set(lane, {
      lane,
      label: LABELS[lane],
      ...(telegramRecipient ? { telegramRecipient } : {}),
      paperclipTag: PAPERCLIP_TAGS[lane],
      bridgeHandoffDir: BRIDGE_DIRS[lane],
    });
  }

  return {
    ...(bridgeRoot ? { bridgeRoot } : {}),
    dispatchMode,
    target(lane) {
      return byLane.get(lane);
    },
    targets() {
      return [...byLane.values()];
    },
    hasTelegramWake(lane) {
      return Boolean(byLane.get(lane)?.telegramRecipient);
    },
    hasBridge() {
      return Boolean(bridgeRoot);
    },
  };
}

/** Parse `JERICHO_FLEET_TELEGRAM_RECIPIENTS` JSON map keyed by AgentLane values. */
export function parseFleetTelegramRecipients(
  value: string | undefined,
): Partial<Record<AgentLane, string>> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('JERICHO_FLEET_TELEGRAM_RECIPIENTS must be a JSON object of lane→recipient');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JERICHO_FLEET_TELEGRAM_RECIPIENTS must be a JSON object of lane→recipient');
  }
  const validLanes = new Set(Object.values(AgentLane));
  const result: Partial<Record<AgentLane, string>> = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!validLanes.has(key as AgentLane)) {
      throw new Error(`JERICHO_FLEET_TELEGRAM_RECIPIENTS contains unknown lane "${key}"`);
    }
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new Error(`JERICHO_FLEET_TELEGRAM_RECIPIENTS.${key} must be a non-empty string`);
    }
    result[key as AgentLane] = raw.trim();
  }
  return result;
}

export function parseFleetDispatchMode(
  value: string | undefined,
): 'hybrid' | 'telegram_only' | 'durable_only' {
  const mode = value?.trim() || 'hybrid';
  if (mode !== 'hybrid' && mode !== 'telegram_only' && mode !== 'durable_only') {
    throw new Error('JERICHO_FLEET_DISPATCH_MODE must be hybrid, telegram_only, or durable_only');
  }
  return mode;
}

export function paperclipTitleForLane(lane: AgentLane | string, taskTitle: string): string {
  const tag = PAPERCLIP_TAGS[lane as AgentLane];
  const trimmed = taskTitle.trim();
  if (!tag) return trimmed;
  if (trimmed.startsWith(tag)) return trimmed;
  return `${tag} ${trimmed}`;
}

function optionalPath(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
