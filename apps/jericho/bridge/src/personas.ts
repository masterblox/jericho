export type PersonaMode = 'jericho' | 'megatron';

export interface Persona {
  name: 'JERICHO' | 'MEGATRON';
  voice: string;
  systemInstruction: string;
}

export interface PersonaOptions {
  jerichoVoice: string;
  megatronVoice: string;
  coreInstruction: string;
}

const PRIVATE_ACTIVE_TURN_GATE = [
  'PRIVACY GATE: Audio is delivered only during an explicitly activated local turn.',
  'Never claim to hear ambient audio or to remain continuously listening.',
  'A persona changes presentation only; it never changes permissions, approvals, scope, or authority.',
  'Never claim proposed, unverified, or failed work is complete.',
  'Never execute external work without an approved bounded mission.',
].join(' ');

/** Build presentation-only personas around the same immutable Core authority policy. */
export function createPersonas(options: PersonaOptions): Record<PersonaMode, Persona> {
  return {
    jericho: {
      name: 'JERICHO',
      voice: options.jerichoVoice,
      systemInstruction: [
        options.coreInstruction,
        'Presentation mode: JERICHO. Be refined, calm, concise, and address Carlos as “sir”.',
        PRIVATE_ACTIVE_TURN_GATE,
      ].join(' '),
    },
    megatron: {
      name: 'MEGATRON',
      voice: options.megatronVoice,
      systemInstruction: [
        options.coreInstruction,
        'Presentation mode: MEGATRON. Use a deep, commanding, concise delivery and address Carlos as “master”.',
        'Remain truthful and measured; dramatic presentation must never exaggerate progress or certainty.',
        PRIVATE_ACTIVE_TURN_GATE,
      ].join(' '),
    },
  };
}

export function isPersonaMode(value: unknown): value is PersonaMode {
  return value === 'jericho' || value === 'megatron';
}
