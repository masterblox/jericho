import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { VoicePresetPreference } from '@jericho/shared';

import { VOICES } from './voices.js';

export const DEFAULT_FALLBACK_VOICE = 'Algieba';
export const VOICE_AUDITION_SENTENCE =
  'Hello, sir. Jericho systems are online and at your disposal.';
export const VOICE_PREVIEW_TIMEOUT_MS = 8_000;

export function isSupportedVoice(voice: string): boolean {
  return (VOICES as readonly string[]).includes(voice);
}

/** Load a confirmed presentation voice preset, or undefined when unset. */
export function loadVoicePreset(path: string | undefined): VoicePresetPreference | undefined {
  if (!path) return undefined;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<VoicePresetPreference>;
    if (
      typeof parsed.voice !== 'string' ||
      !isSupportedVoice(parsed.voice) ||
      typeof parsed.confirmedAt !== 'string'
    ) {
      return undefined;
    }
    return { voice: parsed.voice, confirmedAt: parsed.confirmedAt };
  } catch {
    return undefined;
  }
}

/** Persist only the preset name and confirmation timestamp. */
export function saveVoicePreset(
  path: string | undefined,
  voice: string,
  confirmedAt: string,
): VoicePresetPreference {
  if (!isSupportedVoice(voice)) throw new Error('unsupported_voice');
  const preference: VoicePresetPreference = { voice, confirmedAt };
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(preference)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  return preference;
}

export function resolvePresentationVoice(options: {
  preferencePath?: string;
  configuredVoice?: string;
}): string {
  const saved = loadVoicePreset(options.preferencePath)?.voice;
  if (saved) return saved;
  if (options.configuredVoice && isSupportedVoice(options.configuredVoice)) {
    return options.configuredVoice;
  }
  return DEFAULT_FALLBACK_VOICE;
}
