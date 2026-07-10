import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, type Session } from '@google/genai';
import { config } from './config.js';
import { PERSONAS, type PersonaMode } from './personas.js';
import { FUNCTION_DECLARATIONS, execute } from './tools.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const wss = new WebSocketServer({ port: config.port });

// deep/male Gemini voices to audition for the JARVIS rasp.
export const VOICES = [
  'Fenrir',     // gravelly/deepest — Megatron combat mode default
  'Charon',     // deep, informative
  'Orus',       // firm
  'Iapetus',    // deep
  'Sulafat',    // low
  'Enceladus',  // breathy
  'Erinome',    // low
  'Algieba',    // deep — JARVIS default
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
  let currentMode: PersonaMode = config.mode.defaultMode;
  let currentVoice = PERSONAS[currentMode].voice;
  let inChunks = 0;
  let outChunks = 0;

  // Deferred mode swap: set by the LLM's switch_voice_mode tool call,
  // flushed when the current turn completes (so audio isn't cut mid-sentence).
  let pendingMode: PersonaMode | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  // Safety auto-revert: if stuck in megatron with no interaction, revert to jarvis.
  let revertTimer: ReturnType<typeof setTimeout> | null = null;

  const reporter = setInterval(() => {
    if (inChunks || outChunks) {
      console.log(`[flow] mode=${currentMode} in=${inChunks} out=${outChunks}`);
    }
    inChunks = 0;
    outChunks = 0;
  }, 3000);

  function clearTimers() {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    if (revertTimer) { clearTimeout(revertTimer); revertTimer = null; }
  }

  function armRevert() {
    if (revertTimer) clearTimeout(revertTimer);
    if (currentMode === 'megatron') {
      revertTimer = setTimeout(() => {
        console.log('[bridge] safety auto-revert: megatron → jarvis (idle timeout)');
        openSession('jarvis');
      }, config.mode.autoRevertMs);
    }
  }

  function scheduleModeSwap(mode: PersonaMode) {
    if (mode === currentMode) return;
    pendingMode = mode;
    ws.send(JSON.stringify({ type: 'mode_pending', mode, name: PERSONAS[mode].name }));
    console.log(`[bridge] mode swap queued: ${currentMode} → ${mode} (waiting for turnComplete)`);

    // Safety fallback: if turnComplete never fires (e.g. interrupted), swap after 5s
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (pendingMode && pendingMode !== currentMode) {
        console.log(`[bridge] mode swap fallback timer: ${currentMode} → ${pendingMode}`);
        flushPendingMode();
      }
    }, 5000);
  }

  function flushPendingMode() {
    if (!pendingMode) return;
    const mode = pendingMode;
    pendingMode = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }

    // Brief delay so the last audio chunk finishes playing on the client
    // before the new session's audio starts.
    setTimeout(() => openSession(mode, undefined, { silent: true }), 400);
  }

  function openSession(mode: PersonaMode, voiceOverride?: string, opts?: { silent?: boolean }) {
    const persona = PERSONAS[mode];
    currentMode = mode;
    currentVoice = voiceOverride ?? persona.voice;
    clearTimers();
    try {
      session?.close();
    } catch {
      /* noop */
    }
    session = null;
    ws.send(JSON.stringify({ type: 'voice_switching', voice: currentVoice }));
    ws.send(JSON.stringify({ type: 'mode_change', mode, name: persona.name }));
    console.log(`[bridge] opening session mode=${mode} voice=${currentVoice} silent=${!!opts?.silent}`);

    let heardAudio = false;
    const failTimer = setTimeout(() => {
      if (!heardAudio) {
        console.log(`[bridge] voice ${currentVoice} produced NO audio — unsupported`);
        ws.send(JSON.stringify({ type: 'voice_failed', voice: currentVoice }));
      }
    }, 3500);

    ai.live
      .connect({
        model: config.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: persona.systemInstruction,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: currentVoice } } },
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS as any }],
        },
        callbacks: {
          onopen: () => ws.send(JSON.stringify({ type: 'ready', voice: currentVoice })),
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
        console.log('[bridge] live session open:', config.model, 'mode:', mode, 'voice:', currentVoice);
        // Only play a greeting on initial connect or manual UI toggle — NOT on LLM-driven silent swaps
        if (!opts?.silent) {
          try {
            s.sendClientContent({ turns: persona.greeting, turnComplete: true });
          } catch (err) {
            console.error('[bridge] greeting failed', err);
          }
        } else {
          armRevert();
        }
      })
      .catch((err) => {
        console.error('[bridge] live connect failed', err);
        ws.send(JSON.stringify({ type: 'error', message: String(err?.message ?? err) }));
      });
  }

  async function handleServerMessage(e: any, ws: WebSocket) {
    const sc = e.serverContent;

    // 1. Forward audio + text to the client
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

    // 2. Handle tool calls (including switch_voice_mode)
    const calls: ToolCall[] | undefined = e.toolCall?.functionCalls;
    if (calls?.length && session) {
      const responses = [];
      for (const c of calls) {
        ws.send(JSON.stringify({ type: 'tool_start', name: c.name, args: c.args }));

        let result: Record<string, unknown>;
        if (c.name === 'switch_voice_mode') {
          // LLM-driven qualification: the model decided this task is heavy enough
          // (or light enough to stand down). Queue the swap — it fires at turnComplete.
          const targetMode = (c.args?.mode as PersonaMode) ?? 'jarvis';
          result = { acknowledged: true, mode: targetMode };
          scheduleModeSwap(targetMode);
        } else {
          result = await execute(c.name, c.args ?? {});
        }

        ws.send(JSON.stringify({ type: 'tool_result', name: c.name, result }));
        responses.push({ id: c.id, name: c.name, response: result });
      }
      try {
        session.sendToolResponse({ functionResponses: responses as any });
      } catch (err) {
        console.error('[bridge] sendToolResponse failed', err);
      }
    }

    // 3. After everything in this message is processed, check for turn completion.
    // This is the natural swap point — audio has been forwarded, tools are handled.
    if (sc?.turnComplete && pendingMode) {
      flushPendingMode();
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────
  openSession(currentMode);
  ws.send(JSON.stringify({ type: 'voices', voices: VOICES, active: currentVoice }));
  ws.send(JSON.stringify({ type: 'mode_change', mode: currentMode, name: PERSONAS[currentMode].name }));
  ws.send(JSON.stringify({ type: 'armed', armed: true }));

  // ── Client messages ────────────────────────────────────────────────
  ws.on('message', (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'audio' && msg.data && session) {
      inChunks++;
      try {
        session.sendRealtimeInput({
          media: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } as any,
        });
      } catch (err) {
        console.error('[bridge] sendRealtimeInput failed', err);
      }
    } else if (msg.type === 'wake') {
      const prompt =
        currentMode === 'megatron'
          ? 'Acknowledge the master with a brief commanding word, then await orders.'
          : "Acknowledge the user with a brief 'Yes, sir.' then wait for their request.";
      try {
        session?.sendClientContent({ turns: prompt, turnComplete: true });
      } catch {
        /* session not ready yet */
      }
    } else if (msg.type === 'set_voice' && msg.voice) {
      openSession(currentMode, msg.voice);
    } else if (msg.type === 'set_mode' && msg.mode) {
      // Manual UI toggle — plays a greeting so the user hears the new voice
      openSession(msg.mode as PersonaMode);
    }
  });

  ws.on('close', () => {
    console.log('[bridge] browser disconnected');
    clearInterval(reporter);
    clearTimers();
    try {
      session?.close();
    } catch {
      /* noop */
    }
  });
});

console.log(`[bridge] listening on ws://localhost:${config.port} (model: ${config.model})`);
