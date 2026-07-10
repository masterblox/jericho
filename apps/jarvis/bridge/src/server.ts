import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, type Session } from '@google/genai';
import { config } from './config.js';
import { FUNCTION_DECLARATIONS, execute } from './tools.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const wss = new WebSocketServer({ port: config.port });

// deep/male Gemini voices to audition for the JARVIS rasp.
// ordered by rasp likelihood; invalid ones auto-grey out in the UI at runtime.
export const VOICES = [
  'Fenrir',     // gravelly/deepest — top rasp candidate
  'Charon',     // deep, informative
  'Orus',       // firm
  'Iapetus',    // deep
  'Sulafat',    // low
  'Enceladus',  // breathy
  'Erinome',    // low
  'Algieba',    // deep
  'Algenib',    // deep
  'Kratos',     // deep (may be unsupported → will grey out)
];

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

wss.on('connection', (ws: WebSocket) => {
  console.log('[bridge] browser connected');
  let session: Session | null = null;
  let currentVoice = config.voice;
  let inChunks = 0;
  let outChunks = 0;

  const reporter = setInterval(() => {
    if (inChunks || outChunks) {
      console.log(`[flow] in=${inChunks} out=${outChunks}`);
    }
    inChunks = 0;
    outChunks = 0;
  }, 3000);

  function openSession(voice: string) {
    currentVoice = voice;
    try {
      session?.close();
    } catch {
      /* noop */
    }
    session = null;
    ws.send(JSON.stringify({ type: 'voice_switching', voice }));
    console.log(`[bridge] opening session voice=${voice}`);

    let heardAudio = false;
    // detect unsupported voices: if no audio within 3.5s, mark as failed
    const failTimer = setTimeout(() => {
      if (!heardAudio) {
        console.log(`[bridge] voice ${voice} produced NO audio — unsupported`);
        ws.send(JSON.stringify({ type: 'voice_failed', voice }));
      }
    }, 3500);

    ai.live
      .connect({
        model: config.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: config.systemInstruction,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS as any }],
        },
        callbacks: {
          onopen: () => ws.send(JSON.stringify({ type: 'ready', voice })),
          onmessage: (e: any) => {
            if (e.serverContent?.modelTurn?.parts?.some((p: any) => p.inlineData?.data)) {
              heardAudio = true;
              clearTimeout(failTimer);
            }
            handleServerMessage(e, ws);
          },
          onerror: (ev: any) => {
            console.error('[bridge] live error', ev?.message);
            ws.send(JSON.stringify({ type: 'error', message: ev?.message ?? 'live error' }));
          },
          onclose: () => {
            clearTimeout(failTimer);
            ws.send(JSON.stringify({ type: 'closed' }));
          },
        },
      })
      .then((s) => {
        session = s;
        console.log('[bridge] live session open:', config.model, 'voice:', voice);
        // audition: play a greeting in the new voice
        try {
          s.sendClientContent({
            turns: 'Greet the user in one short sentence as JARVIS: online and ready, sir.',
            turnComplete: true,
          });
        } catch (err) {
          console.error('[bridge] greeting failed', err);
        }
      })
      .catch((err) => {
        console.error('[bridge] live connect failed', err);
        ws.send(JSON.stringify({ type: 'error', message: String(err?.message ?? err) }));
      });
  }

  async function handleServerMessage(e: any, ws: WebSocket) {
    const sc = e.serverContent;
    if (sc?.modelTurn?.parts) {
      for (const p of sc.modelTurn.parts) {
        if (p.inlineData?.data) {
          outChunks++;
          ws.send(
            JSON.stringify({
              type: 'audio',
              mimeType: p.inlineData.mimeType ?? 'audio/pcm;rate=24000',
              data: p.inlineData.data,
            }),
          );
        }
        if (p.text) ws.send(JSON.stringify({ type: 'text', text: p.text }));
      }
    }
    if (sc?.interrupted) ws.send(JSON.stringify({ type: 'interrupt' }));

    const calls: ToolCall[] | undefined = e.toolCall?.functionCalls;
    if (calls?.length && session) {
      const responses = [];
      for (const c of calls) {
        ws.send(JSON.stringify({ type: 'tool_start', name: c.name, args: c.args }));
        const result = await execute(c.name, c.args ?? {});
        ws.send(JSON.stringify({ type: 'tool_result', name: c.name, result }));
        responses.push({ id: c.id, name: c.name, response: result });
      }
      try {
        session.sendToolResponse({ functionResponses: responses as any });
      } catch (err) {
        console.error('[bridge] sendToolResponse failed', err);
      }
    }
  }

  // open the first session with the default voice
  openSession(currentVoice);
  // tell the browser which voices are available + which is active
  ws.send(JSON.stringify({ type: 'voices', voices: VOICES, active: currentVoice }));
  // always-on: the client streams mic audio continuously; Gemini's system
  // instruction gates the wake word. Tell the UI it's listening.
  ws.send(JSON.stringify({ type: 'armed', armed: true }));

  ws.on('message', (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'audio' && msg.data && session) {
      // ALWAYS forward — Gemini's system instruction handles the wake-word gate
      inChunks++;
      try {
        session.sendRealtimeInput({
          media: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } as any,
        });
      } catch (err) {
        console.error('[bridge] sendRealtimeInput failed', err);
      }
    } else if (msg.type === 'wake') {
      // manual nudge (click-to-talk): prompt JARVIS to acknowledge
      try {
        session?.sendClientContent({
          turns: "Acknowledge the user with a brief 'Yes, sir.' then wait for their request.",
          turnComplete: true,
        });
      } catch {
        /* session not ready yet */
      }
    } else if (msg.type === 'set_voice' && msg.voice) {
      openSession(msg.voice); // hot-swap session to audition the new voice
    }
  });

  ws.on('close', () => {
    console.log('[bridge] browser disconnected');
    clearInterval(reporter);
    try {
      session?.close();
    } catch {
      /* noop */
    }
  });
});

console.log(`[bridge] listening on ws://localhost:${config.port} (model: ${config.model})`);
