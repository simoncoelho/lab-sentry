import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isClassifierDesign, classifierIssues, deckSlots, variationOptions } from './src/classifier.ts';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const strings = { type: 'array', items: string };
export const responseSchema = object({
  message: string,
  proposal: { anyOf: [{ type: 'null' }, object({
    name: string, objective: string, unit: { enum: ['frame', 'deck_slot'] }, mode: { enum: ['single', 'multiple'] },
    classes: { type: 'array', items: object({ id: string, name: string, description: string, exclude: string, color: string }) },
    slots: { type: 'array', items: { enum: deckSlots } },
    examplesPerClass: { type: 'integer' }, validationPercent: { type: 'integer' }, testPercent: { type: 'integer' },
    variations: { type: 'array', items: { enum: variationOptions } },
  })] },
});
export function validateRequest(body) {
  if (!isClassifierDesign(body?.design) || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 40 ||
    !body.messages.every(m => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string' && m.text.length <= 12000) ||
    body.messages.at(-1).role !== 'user' || !body.messages.at(-1).text.trim()) throw new Error('Invalid conversation. Start a new conversation if it is full.');
}

export async function askCodex(body, signal) {
  validateRequest(body);
  const cwd = await mkdtemp(join(tmpdir(), 'lab-sentry-copilot-'));
  const child = spawn(process.env.CODEX_BIN || 'codex', ['app-server', '--stdio'], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const pending = new Map();
  let sequence = 0, answer = '', finished;
  const completion = new Promise((resolve, reject) => { finished = { resolve, reject }; });
  // Attach immediately: startup failure can precede the awaited turn.
  completion.catch(() => {});
  const fail = error => { for (const p of pending.values()) p.reject(error); pending.clear(); finished.reject(error); };
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  const rpc = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); send({ id, method, params }); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && !msg.method) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message)); else p?.resolve(msg.result);
    } else if (msg.id !== undefined) {
      send({ id: msg.id, error: { code: -32601, message: 'Tools and approvals are unavailable in classifier design.' } });
    } else if (msg.method === 'item/completed' && msg.params.item.type === 'agentMessage') {
      answer = msg.params.item.text;
    } else if (msg.method === 'turn/completed') {
      const turn = msg.params.turn;
      if (turn.status === 'completed') finished.resolve(answer);
      else finished.reject(new Error(turn.error?.message || `Codex turn ${turn.status}`));
    }
  });
  child.on('error', () => fail(new Error('Cannot start Codex. Install Codex and run codex login.')));
  child.on('exit', () => fail(new Error('Codex server disconnected. Please retry.')));
  child.stdin.on('error', error => fail(error));
  const abort = () => { fail(new Error('Request cancelled.')); child.kill(); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { fail(new Error('Codex took too long. Please retry.')); child.kill(); }, 180000);
  try {
    if (signal?.aborted) throw new Error('Request cancelled.');
    await rpc('initialize', { clientInfo: { name: 'lab_sentry_classifier', version: '1.0.0' }, capabilities: null });
    send({ method: 'initialized' });
    const { thread } = await rpc('thread/start', {
      cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only',
      config: { web_search: 'disabled' },
      baseInstructions: 'You are the Lab Sentry classifier design copilot. Converse concisely with the user to design a vision classifier and dataset plan. Use only the provided conversation and approved draft. Do not use tools, read files, execute commands, access networks, or control hardware. Ask one focused question if needed; otherwise return a complete proposed definition. Never claim training or image generation has happened. Preserve existing class IDs where possible. Clearly distinguish empty slots from obscured or ambiguous views; ambiguous samples go to manual review. Split by capture session to avoid leakage. The user applies proposals explicitly; the supplied design is the current approved state. Respond using the output schema. proposal may be null when asking a question. Proposed definitions need at least two unique named classes with labeling rules, examplesPerClass 1..100000, validationPercent and testPercent each 1..40, colors as hex #RRGGBB, and unique IDs. Do not assume unmentioned hardware or labware is present.',
    });
    await rpc('turn/start', { threadId: thread.id, input: [{ type: 'text', text: JSON.stringify({ approvedDesign: body.design, conversation: body.messages }), text_elements: [] }], outputSchema: responseSchema });
    const result = JSON.parse(await completion);
    if (typeof result.message !== 'string' || !result.message.trim() || (result.proposal !== null && (!isClassifierDesign(result.proposal) || classifierIssues(result.proposal).length))) throw new Error('Codex returned an invalid draft. Please retry.');
    return result;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); child.kill(); lines.close();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

export function codexCopilot() {
  let active = 0;
  return { name: 'codex-classifier-copilot', configureServer(server) {
    server.middlewares.use('/classifier-api/chat', async (req, res) => {
      const origin = req.headers.origin;
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
      if (origin && origin !== `http://${req.headers.host}`) { res.writeHead(403).end(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
      if (active >= 2) { res.writeHead(429).end(JSON.stringify({ error: 'Codex is busy. Please retry shortly.' })); return; }
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      active++;
      try {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 250000) throw new Error('Conversation too large. Start a new conversation.'); }
        const body = JSON.parse(raw); validateRequest(body);
        const result = await askCodex(body, controller.signal);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      } catch (error) {
        if (!res.destroyed) res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
      } finally { active--; }
    });
  } };
}
