export const VOICES = [
  'Fenrir', 'Charon', 'Orus', 'Iapetus', 'Sulafat',
  'Enceladus', 'Erinome', 'Algieba', 'Algenib', 'Kratos',
] as const;

export type GeminiVoiceName = (typeof VOICES)[number];
