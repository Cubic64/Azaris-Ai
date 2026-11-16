import React, { useState, useEffect } from 'react';
import { RefreshCw, Volume2, CheckCircle2 } from 'lucide-react';
import type { LlmConfig, LlmProviderId, VoiceSettings } from '../types';
import { discoverOllamaModels } from '../services/llmClient';
import { getLocalVoices, speakLocal } from '../services/voiceEngine';

interface ModelsConfigViewProps {
  llmConfig: LlmConfig;
  onUpdateLlmConfig: (cfg: LlmConfig) => void;
  voiceSettings: VoiceSettings;
  onUpdateVoiceSettings: (vs: VoiceSettings) => void;
}

const PROVIDERS: Array<{ id: LlmProviderId; label: string; subtitle: string }> = [
  { id: 'gemini', label: 'Gemini', subtitle: 'Built-in server-side intelligence' },
  { id: 'ollama', label: 'Ollama (Local)', subtitle: 'Run private local models on your laptop' },
  { id: 'anthropic', label: 'Claude', subtitle: 'Anthropic API key' },
  { id: 'openai', label: 'OpenAI / Custom Key', subtitle: 'OpenAI, OpenRouter, Groq, LM Studio' },
];

export const ModelsConfigView: React.FC<ModelsConfigViewProps> = ({
  llmConfig,
  onUpdateLlmConfig,
  voiceSettings,
  onUpdateVoiceSettings,
}) => {
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => setVoices(getLocalVoices());
    loadVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const handleDiscoverOllama = async () => {
    setDiscovering(true);
    setOllamaStatus(null);
    try {
      const models = await discoverOllamaModels(
        llmConfig.baseUrl || 'http://localhost:11434',
        Boolean(llmConfig.ollamaDirectBrowser)
      );
      setOllamaModels(models);
      if (models.length > 0 && !models.includes(llmConfig.model)) {
        onUpdateLlmConfig({ ...llmConfig, model: models[0] });
      }
      setOllamaStatus(`Discovered ${models.length} local Ollama model(s).`);
    } catch (err) {
      setOllamaStatus(
        err instanceof Error
          ? err.message
          : 'Could not connect to Ollama. Make sure Ollama is running and CORS is allowed (OLLAMA_ORIGINS="*").'
      );
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
          AI Providers & Local Voice Engine
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Switch seamlessly between built-in Gemini, local Ollama models, Anthropic Claude, or any custom OpenAI-compatible API key.
        </p>
      </div>

      {/* Provider Selector Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PROVIDERS.map((p) => {
          const active = llmConfig.provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                const defaultModel =
                  p.id === 'gemini'
                    ? 'gemini-4-hydrogen'
                    : p.id === 'ollama'
                    ? 'llama3.2'
                    : p.id === 'anthropic'
                    ? 'claude-sonnet-4-20250514'
                    : 'gpt-4o-mini';
                onUpdateLlmConfig({
                  ...llmConfig,
                  provider: p.id,
                  model: defaultModel,
                  baseUrl:
                    p.id === 'ollama'
                      ? llmConfig.baseUrl || 'http://localhost:11434'
                      : p.id === 'openai' || p.id === 'custom'
                      ? llmConfig.baseUrl || 'https://api.openai.com/v1'
                      : undefined,
                });
              }}
              className={`text-left p-4 rounded-xl border transition-colors ${
                active
                  ? 'border-slate-900 dark:border-blue-500 bg-white dark:bg-slate-900'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{p.label}</span>
                {active && <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{p.subtitle}</p>
            </button>
          );
        })}
      </div>

      {/* Provider-Specific Configuration */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        {llmConfig.provider === 'gemini' && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Gemini Server-Side Configuration
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Powered automatically via server-side environment credentials with native tool calling across Gmail, WhatsApp, Calls, QuickBooks, Browser, and Files.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Model</label>
              <select
                value={llmConfig.model}
                onChange={(e) => onUpdateLlmConfig({ ...llmConfig, model: e.target.value })}
                className="h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm"
              >
                <option value="gemini-4-hydrogen">gemini-4-hydrogen (Fast Agentic Default)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra-Low Latency)</option>
              </select>
            </div>
          </div>
        )}

        {llmConfig.provider === 'ollama' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ollama Local LLM</h3>
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(llmConfig.ollamaDirectBrowser)}
                  onChange={(e) =>
                    onUpdateLlmConfig({ ...llmConfig, ollamaDirectBrowser: e.target.checked })
                  }
                />
                Connect directly from browser to laptop localhost:11434
              </label>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Ollama Endpoint URL
                </label>
                <input
                  type="text"
                  value={llmConfig.baseUrl || 'http://localhost:11434'}
                  onChange={(e) => onUpdateLlmConfig({ ...llmConfig, baseUrl: e.target.value })}
                  className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Local Model Name
                </label>
                {ollamaModels.length > 0 ? (
                  <select
                    value={llmConfig.model}
                    onChange={(e) => onUpdateLlmConfig({ ...llmConfig, model: e.target.value })}
                    className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm"
                  >
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={llmConfig.model}
                    onChange={(e) => onUpdateLlmConfig({ ...llmConfig, model: e.target.value })}
                    placeholder="llama3.2, qwen2.5, mistral..."
                    className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDiscoverOllama}
                disabled={discovering}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${discovering ? 'animate-spin' : ''}`} />
                Discover Local Models
              </button>
              {ollamaStatus && <span className="text-xs text-slate-500">{ollamaStatus}</span>}
            </div>
          </div>
        )}

        {llmConfig.provider === 'anthropic' && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Anthropic Claude</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Claude API Key
                </label>
                <input
                  type="password"
                  value={llmConfig.apiKey || ''}
                  onChange={(e) => onUpdateLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Claude Model
                </label>
                <select
                  value={llmConfig.model}
                  onChange={(e) => onUpdateLlmConfig({ ...llmConfig, model: e.target.value })}
                  className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm"
                >
                  <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</option>
                  <option value="claude-3-7-sonnet-latest">claude-3-7-sonnet-latest</option>
                  <option value="claude-3-5-haiku-latest">claude-3-5-haiku-latest</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {(llmConfig.provider === 'openai' || llmConfig.provider === 'custom') && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              OpenAI / Any OpenAI-Compatible API Key
            </h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Base URL</label>
                <input
                  type="text"
                  value={llmConfig.baseUrl || 'https://api.openai.com/v1'}
                  onChange={(e) => onUpdateLlmConfig({ ...llmConfig, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">API Key</label>
                <input
                  type="password"
                  value={llmConfig.apiKey || ''}
                  onChange={(e) => onUpdateLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Model ID</label>
                <input
                  type="text"
                  value={llmConfig.model}
                  onChange={(e) => onUpdateLlmConfig({ ...llmConfig, model: e.target.value })}
                  placeholder="gpt-4o-mini, deepseek-chat..."
                  className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Local STT & TTS Voice Engine */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              100% Local Speech-to-Text & Text-to-Speech
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Runs locally on your device using Web Speech API & native OS Speech Synthesis with zero cloud audio transfer.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              speakLocal('Azaris local voice synthesis is active and ready.', voiceSettings)
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Test Voice
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Local Voice</label>
            <select
              value={voiceSettings.voiceURI}
              onChange={(e) => onUpdateVoiceSettings({ ...voiceSettings, voiceURI: e.target.value })}
              className="w-full h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
            >
              <option value="">System Default Voice</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Speech Rate ({voiceSettings.rate.toFixed(2)}x)
            </label>
            <input
              type="range"
              min="0.7"
              max="1.5"
              step="0.05"
              value={voiceSettings.rate}
              onChange={(e) =>
                onUpdateVoiceSettings({ ...voiceSettings, rate: parseFloat(e.target.value) })
              }
              className="w-full mt-2"
            />
          </div>

          <div className="flex flex-col justify-center space-y-2 pt-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={voiceSettings.autoSpeak}
                onChange={(e) =>
                  onUpdateVoiceSettings({ ...voiceSettings, autoSpeak: e.target.checked })
                }
              />
              Auto-speak agent replies locally
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={voiceSettings.continuousListen}
                onChange={(e) =>
                  onUpdateVoiceSettings({ ...voiceSettings, continuousListen: e.target.checked })
                }
              />
              Continuous hands-free listening
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
