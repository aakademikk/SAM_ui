/**
 * POST /api/chat — streaming chat with SAM.
 *
 * Proxies to an Anthropic-compatible API (Claude, DeepSeek, etc.)
 * configured via ANTHROPIC_* environment variables.
 *
 * Streams the response as SSE so the client renders SAM mid-sentence.
 *
 * Requires a valid session cookie (read-level auth).
 */

import { requireSession } from '@/lib/server/auth/guard';
import { failure } from '@/lib/server/respond';
import { buildContext } from '@/lib/server/chat/context';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60s timeout for streaming responses

const BASE_URL = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
const API_KEY = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '';
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  if (!API_KEY) {
    return failure('No LLM API key configured. Set ANTHROPIC_AUTH_TOKEN in the environment.', 500);
  }

  let body: { messages?: { role: string; content: string }[] };
  try {
    body = await request.json();
  } catch {
    return failure('Invalid JSON body.', 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return failure('messages array is required.', 400);
  }

  // Build system prompt with real-time vault search for this message.
  // Use the last user message as the search query.
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const systemPrompt = await buildContext(lastUserMsg);

  // Build Anthropic-format messages
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content.slice(0, 4096), // cap per message
    })),
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: string) => controller.enqueue(encoder.encode(data));

      try {
        const response = await fetch(`${BASE_URL}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 2048,
            stream: true,
            messages: apiMessages,
          }),
          signal: request.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          enqueue(`event: error\ndata: ${JSON.stringify({ error: `LLM API error ${response.status}: ${errText.slice(0, 200)}` })}\n\n`);
          controller.close();
          return;
        }

        if (!response.body) {
          enqueue(`event: error\ndata: ${JSON.stringify({ error: 'No response body' })}\n\n`);
          controller.close();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              // Anthropic streaming format
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                enqueue(`event: delta\ndata: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
              } else if (parsed.type === 'message_stop') {
                enqueue(`event: done\ndata: {}\n\n`);
              }
            } catch {
              // skip unparseable lines
            }
          }
        }

        enqueue(`event: done\ndata: {}\n\n`);
        controller.close();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          enqueue(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-cache, must-revalidate',
      connection: 'keep-alive',
    },
  });
}
