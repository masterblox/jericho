import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// .env lives at the workspace root (apps/jarvis/.env), two levels up from src/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  geminiApiKey: required('GEMINI_API_KEY'),
  port: Number(process.env.PORT ?? 8787),
  model: process.env.LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-latest',
  paperclip: {
    url: process.env.PAPERCLIP_URL ?? '',
    key: process.env.PAPERCLIP_KEY ?? '',
    companyId: process.env.PAPERCLIP_COMPANY_ID ?? '',
    agentId: process.env.PAPERCLIP_AGENT_ID ?? '',
  },
  mode: {
    defaultMode: (process.env.DEFAULT_MODE ?? 'jarvis') as 'jarvis' | 'megatron',
    autoRevertMs: Number(process.env.AUTO_REVERT_MS ?? 120_000),
  },
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] missing required env ${name}`);
    process.exit(1);
  }
  return v;
}
