#!/usr/bin/env node
/**
 * SAM — Gemini proxy for samui chat.
 *
 * The chat spawns the `claude` CLI, which only speaks the Anthropic Messages
 * API. Gemini has no Anthropic-compatible endpoint, so this zero-dependency
 * server implements the slice of `/v1/messages` the CLI actually uses and
 * translates it to Gemini `generateContent` — so a Gemini chat tier is just
 * another `ANTHROPIC_BASE_URL` with a model name in front of it.
 *
 * Deliberately small and blunt:
 *   - one endpoint: POST /v1/messages (anything else → 404)
 *   - binds to 127.0.0.1 only — local chat traffic, no auth on the wire
 *   - Gemini call is non-streaming; the full reply is buffered and replayed
 *     as the Anthropic SSE event sequence, so the CLI sees a normal stream
 *     and the tool-call round-trip stays deterministic (no streaming
 *     function-call ambiguity).
 *   - `GEMINI_API_KEY` is read from process env, falling back to a small
 *     `.env.local` parse so the systemd unit needs no EnvironmentFile quirks.
 *
 * No credential values are ever logged.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.SAM_GEMINI_PROXY_PORT ?? 8788);
const ENV_PATH = process.env.SAM_UI_ENV_FILE ?? '/home/col/SAM_ui/.env.local';

/* ── Env ─────────────────────────────────────────────────────────────────── */

/** process env wins; otherwise pull KEY=VALUE lines out of .env.local. */
function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(ENV_PATH, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let [, key, value] = m;
      value = value.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in env)) env[key] = value;
    }
  } catch {
    /* file missing — rely on the process environment alone */
  }
  return env;
}

const env = loadEnv();
const GEMINI_API_KEY = env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('[gemini-proxy] GEMINI_API_KEY not found in env or ' + ENV_PATH);
  process.exit(1);
}

/* ── Anthropic tool_use id → Gemini call identity ──────────────────────────
   The CLI names a tool call by our `toolu_...` id; Gemini names its function
   call by a model-generated id. Every time we emit a tool_use block we record
   the pair, so a later tool_result can be matched with the right call_id and
   name. Bounded below — a very long session just starts dropping old entries,
   which only breaks tool round-trips for turns before the drop. */
const toolMap = new Map();
const TOOL_MAP_MAX = 500;

function rememberTool(tooluId, geminiName, geminiCallId) {
  if (toolMap.size >= TOOL_MAP_MAX) {
    const oldest = toolMap.keys().next().value;
    toolMap.delete(oldest);
  }
  toolMap.set(tooluId, { name: geminiName, callId: geminiCallId });
}

/* ── Anthropic → Gemini translation ─────────────────────────────────────── */

function systemToInstruction(system) {
  if (system == null) return undefined;
  const parts = Array.isArray(system) ? system : [{ type: 'text', text: system }];
  const text = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  return text ? { parts: [{ text }] } : undefined;
}

function contentBlockToParts(block) {
  switch (block.type) {
    case 'text':
      return [{ text: block.text }];
    case 'image': {
      const src = block.source ?? {};
      if (src.type === 'base64') {
        return [{ inlineData: { mimeType: src.media_type, data: src.data } }];
      }
      return [];
    }
    case 'tool_use': {
      const entry = toolMap.get(block.id);
      const part = { functionCall: { name: block.name, args: block.input ?? {} } };
      if (entry) part.functionCall.id = entry.callId;
      return [part];
    }
    case 'tool_result': {
      const entry = toolMap.get(block.tool_use_id);
      const response = {
        content: block.content ?? '',
        is_error: Boolean(block.is_error),
      };
      const part = { functionResponse: { name: entry?.name ?? 'unknown', response } };
      if (entry?.callId) part.functionResponse.call_id = entry.callId;
      return [part];
    }
    default:
      return [];
  }
}

function anthropicMessageToGemini(msg) {
  const raw = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
  const parts = raw.flatMap(contentBlockToParts);
  return { role: msg.role === 'assistant' ? 'model' : 'user', parts };
}

/** Keys Gemini's Schema accepts. Anything else in the CLI's JSON-Schema
    tool declarations (`$schema`, `additionalProperties`, `const`, `anyOf`, …)
    makes the whole request fail, so we strip to this subset and recurse. */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
]);

function sanitizeSchema(schema) {
  if (schema == null || typeof schema !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties') {
      out.properties = {};
      for (const [pkey, pval] of Object.entries(value)) {
        if (pval && typeof pval === 'object') out.properties[pkey] = sanitizeSchema(pval);
      }
    } else if (key === 'items') {
      // Tuples aren't supported — take the first branch, else fall back to `{}`.
      out.items = sanitizeSchema(Array.isArray(value) ? value[0] : value);
    } else if (key === 'enum') {
      out.enum = Array.isArray(value) ? value : [value];
    } else if (key === 'required') {
      out.required = Array.isArray(value) ? value.filter((s) => typeof s === 'string') : [];
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toolsToDeclarations(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const declarations = tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    parameters: sanitizeSchema(t.input_schema ?? {}),
  }));
  return [{ functionDeclarations: declarations }];
}

/* ── Gemini → Anthropic translation ─────────────────────────────────────── */

function finishReasonToStop(finish) {
  if (finish === 'MAX_TOKENS') return 'max_tokens';
  if (finish === 'SAFETY' || finish === 'RECITATION' || finish === 'PROHIBITED_CONTENT') {
    return 'refusal';
  }
  return 'end_turn';
}

function buildAnthropicBody(model, geminiJson) {
  const candidate = geminiJson.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const usage = geminiJson.usageMetadata ?? {};

  const content = [];
  for (const part of parts) {
    if (part.text) {
      content.push({ type: 'text', text: part.text });
    } else if (part.functionCall) {
      const id = `toolu_${randomBytes(6).toString('hex')}`;
      rememberTool(id, part.functionCall.name, part.functionCall.id);
      content.push({
        type: 'tool_use',
        id,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      });
    }
  }

  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? 0;
  return {
    model,
    content,
    stop_reason: finishReasonToStop(candidate?.finishReason),
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/* ── Gemini request ─────────────────────────────────────────────────────── */

function geminiRequest(model, body) {
  const contents = (body.messages ?? []).map(anthropicMessageToGemini);
  const systemInstruction = systemToInstruction(body.system);
  const tools = toolsToDeclarations(body.tools);

  // `thinkingConfig` is only valid on models that support thinking; 2.5-flash
  // and the 3.x family do, lite models do not.
  const supportsThinking = /^(gemini-2\.5|gemini-3)/.test(model);
  const generationConfig = {
    maxOutputTokens: Math.min(body.max_tokens ?? 4096, 65536),
  };
  if (supportsThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const payload = { contents, generationConfig };
  if (systemInstruction) payload.systemInstruction = systemInstruction;
  if (tools) payload.tools = tools;

  return payload;
}

/* ── HTTP handling ──────────────────────────────────────────────────────── */

/** Anthropic `/v1/models` — the CLI validates the requested model against
    this list before it will send a message, so it must advertise whatever
    `SAM_GEMINI_MODEL` points at. The list is advisory; Gemini itself is the
    real gate. */
function handleModels(res) {
  const ids = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.7-flash'];
  const configured = env.SAM_GEMINI_MODEL;
  if (configured && !ids.includes(configured)) ids.push(configured);
  const data = ids.map((id) => ({
    type: 'model',
    id,
    display_name: id,
    created_at: '2026-01-01T00:00:00Z',
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data }));
}

/** Health/diagnosis — verifies the key against Gemini without exposing it.
    Returns shape facts (prefix class, length) plus the API's status/error. */
async function diagnose(res) {
  const result = { startsWithAiza: GEMINI_API_KEY.startsWith('AIza'), length: GEMINI_API_KEY.length };
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': GEMINI_API_KEY },
    });
    const body = await r.text();
    let message = '';
    try {
      message = JSON.parse(body)?.error?.message ?? '';
    } catch {
      /* non-JSON body */
    }
    result.status = r.status;
    result.message = message.slice(0, 300);
  } catch (err) {
    result.status = 'network-error';
    result.message = err.message;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result, null, 2));
}

async function callGemini(model, body) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
    ':generateContent';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify(geminiRequest(model, body)),
  });

  const text = await res.text();
  if (!res.ok) {
    let message = `Gemini ${res.status}`;
    try {
      const err = JSON.parse(text);
      message = err?.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    const type = res.status >= 400 && res.status < 500 ? 'invalid_request_error' : 'api_error';
    throw new Error(JSON.stringify({ status: res.status, type, message }));
  }
  return JSON.parse(text);
}

/** Anthropic SSE event frame for a streamed response. */
function sse(frames) {
  return frames.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

function handleMessages(req, res, body) {
  const model = body.model ?? 'gemini-2.5-flash';

  callGemini(model, body)
    .then((geminiJson) => {
      const message = buildAnthropicBody(model, geminiJson);
      message.id = `msg_${randomBytes(6).toString('hex')}`;
      message.type = 'message';
      message.role = 'assistant';
      message.model = model;

      if (body.stream === false) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(message));
        return;
      }

      const frames = [];
      frames.push({ event: 'message_start', data: { type: 'message_start', message: { ...message, content: [] } } });

      let index = 0;
      for (const block of message.content) {
        if (block.type === 'text') {
          frames.push({
            event: 'content_block_start',
            data: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
          });
          frames.push({
            event: 'content_block_delta',
            data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
          });
        } else {
          frames.push({
            event: 'content_block_start',
            data: {
              type: 'content_block_start',
              index,
              content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
            },
          });
          frames.push({
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
            },
          });
        }
        frames.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
        index += 1;
      }

      frames.push({
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: message.stop_reason, stop_sequence: null },
          usage: { output_tokens: message.usage.output_tokens },
        },
      });
      frames.push({ event: 'message_stop', data: { type: 'message_stop' } });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.end(sse(frames));
    })
    .catch((err) => {
      let status = 500;
      let type = 'api_error';
      let message = String(err.message);
      try {
        const parsed = JSON.parse(err.message);
        status = parsed.status;
        type = parsed.type;
        message = parsed.message;
      } catch {
        /* not our structured error — pass through */
      }
      const payload = { type: 'error', error: { type, message } };
      if (body.stream !== false) {
        res.writeHead(status, { 'Content-Type': 'text/event-stream' });
        res.end(sse([{ event: 'error', data: payload }]));
      } else {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      }
    });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = createServer((req, res) => {
  // The CLI sends query strings (`?beta=true`, `?limit=…`); route on path only.
  const pathname = new URL(req.url, 'http://localhost').pathname;
  console.log(`[gemini-proxy] ${req.method} ${req.url}`);
  if (req.method === 'GET' && pathname === '/diagnose') {
    diagnose(res);
    return;
  }
  if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
    handleModels(res);
    return;
  }
  if (req.method !== 'POST' || pathname !== '/v1/messages') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'Not found' } }));
    return;
  }
  readJson(req)
    .then((body) => handleMessages(req, res, body))
    .catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: err.message } }),
      );
    });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gemini-proxy] listening on http://127.0.0.1:${PORT}/v1/messages`);
});
