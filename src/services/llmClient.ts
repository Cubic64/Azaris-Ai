import type { BrowserSnapshot, ChatMessage, LlmConfig } from '../types';

export interface AgentTurnResponse {
  text: string;
  providerUsed: string;
  toolTrace: NonNullable<ChatMessage['toolTrace']>;
  proposals: Array<{
    actionType: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  }>;
  browserSnapshot?: BrowserSnapshot | null;
}

// Direct browser-to-localhost Ollama fallback so a user running Ollama on their laptop works even from Cloud Run
async function callOllamaDirectFromBrowser(params: {
  baseUrl: string;
  model: string;
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}): Promise<AgentTurnResponse> {
  const endpoint = (params.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const res = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.model || 'llama3.2',
      stream: false,
      messages: [
        {
          role: 'system',
          content:
            params.systemInstruction +
            '\nIf the user asks to perform an action (send email, send WhatsApp, place call, create invoice, write file, browse URL, search Chrome, play YouTube video, fullscreen, change dark/light mode or voice mode), respond clearly AND include a single JSON block ```azaris_action\n{"actionType":"...","title":"...","summary":"...","payload":{...}}\n``` (for Chrome/YouTube/fullscreen use actionType "app_media" with payload {"action":"chrome_search"|"youtube_play"|"fullscreen","query":"...","fullscreenMode":"on"|"off"|"toggle","autoExecute":true}).',
        },
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Local Ollama returned HTTP ${res.status}. Ensure OLLAMA_ORIGINS="*" is set if calling from browser.`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const rawText = data.message?.content || '';
  const proposals: AgentTurnResponse['proposals'] = [];

  const match = rawText.match(/```azaris_action\s*([\s\S]*?)```/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as {
        actionType: string;
        title: string;
        summary: string;
        payload: Record<string, unknown>;
      };
      if (parsed.actionType && parsed.payload) {
        proposals.push(parsed);
      }
    } catch {
      // Ignore malformed optional block
    }
  }

  return {
    text: rawText.replace(/```azaris_action[\s\S]*?```/g, '').trim() || 'Prepared response.',
    providerUsed: `Ollama Browser-Direct (${params.model})`,
    toolTrace: [],
    proposals,
  };
}

export async function runAgentTurn(params: {
  config: LlmConfig;
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  gmailToken: string | null;
}): Promise<AgentTurnResponse> {
  const { config, systemInstruction, messages, gmailToken } = params;

  if (config.provider === 'ollama' && config.ollamaDirectBrowser) {
    return await callOllamaDirectFromBrowser({
      baseUrl: config.baseUrl || 'http://localhost:11434',
      model: config.model || 'llama3.2',
      systemInstruction,
      messages,
    });
  }

  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(gmailToken ? { 'X-Gmail-Token': gmailToken } : {}),
    },
    body: JSON.stringify({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      systemInstruction,
      messages,
    }),
  });

  const data = (await res.json()) as AgentTurnResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `LLM request failed (${res.status})`);
  }
  return data;
}

export async function discoverOllamaModels(baseUrl: string, directBrowser: boolean): Promise<string[]> {
  const cleanBase = (baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  if (directBrowser) {
    const r = await fetch(`${cleanBase}/api/tags`);
    if (!r.ok) throw new Error(`Ollama returned ${r.status}`);
    const d = (await r.json()) as { models?: Array<{ name: string }> };
    return (d.models || []).map((m) => m.name);
  }
  const r = await fetch(`/api/llm/ollama/models?baseUrl=${encodeURIComponent(cleanBase)}`);
  const d = (await r.json()) as { models?: Array<{ name: string }>; error?: string };
  if (!r.ok) throw new Error(d.error || 'Could not reach Ollama');
  return (d.models || []).map((m) => m.name);
}
