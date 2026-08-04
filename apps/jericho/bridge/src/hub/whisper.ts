import type { HubWhisperProbeResult } from '@jericho/shared';

export interface LocalWhisperProbe {
  probe(): Promise<{ available: boolean; detail: string }>;
}

export interface WhisperApiFallback {
  configured: boolean;
  detail: string;
}

export interface WhisperProbeOptions {
  local: LocalWhisperProbe;
  apiFallback: WhisperApiFallback;
  now: () => string;
}

/** Prefer local Whisper; fall back to configured API. Never downloads models. */
export async function probeHubWhisper(
  options: WhisperProbeOptions,
): Promise<HubWhisperProbeResult> {
  const probedAt = options.now();
  const local = await options.local.probe();
  if (local.available) {
    return {
      backend: 'local',
      available: true,
      probedAt,
      detail: local.detail,
      fallbackConfigured: options.apiFallback.configured,
    };
  }
  if (options.apiFallback.configured) {
    return {
      backend: 'api_fallback',
      available: true,
      probedAt,
      detail: options.apiFallback.detail,
      fallbackConfigured: true,
    };
  }
  return {
    backend: 'unavailable',
    available: false,
    probedAt,
    detail: `${local.detail}; API fallback not configured`,
    fallbackConfigured: false,
  };
}
