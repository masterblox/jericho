import {
  HubWhisperBackend,
  type HubWhisperProbeResult,
} from '@jericho/shared';

/** Injected local Whisper probe — never shells out from Hub tests. */
export interface LocalWhisperProbe {
  probe(): Promise<{ available: boolean; detail: string }>;
}

/** Injected configured API fallback status. */
export interface WhisperApiFallback {
  configured: boolean;
  detail: string;
}

export interface WhisperProbeOptions {
  local: LocalWhisperProbe;
  apiFallback: WhisperApiFallback;
  now: () => string;
}

/**
 * Prefer local Whisper; fall back to a configured API only when local is down.
 * Never performs live network calls — adapters are injected.
 */
export async function probeHubWhisper(
  options: WhisperProbeOptions,
): Promise<HubWhisperProbeResult> {
  const probedAt = options.now();
  const local = await options.local.probe();
  if (local.available) {
    return {
      backend: HubWhisperBackend.Local,
      available: true,
      probedAt,
      detail: local.detail,
      fallbackConfigured: options.apiFallback.configured,
    };
  }

  if (options.apiFallback.configured) {
    return {
      backend: HubWhisperBackend.ApiFallback,
      available: true,
      probedAt,
      detail: options.apiFallback.detail,
      fallbackConfigured: true,
    };
  }

  return {
    backend: HubWhisperBackend.Unavailable,
    available: false,
    probedAt,
    detail: `${local.detail}; API fallback not configured`,
    fallbackConfigured: false,
  };
}
