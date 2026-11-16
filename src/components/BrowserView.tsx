import React, { useState } from 'react';
import {
  Globe,
  ArrowRight,
  ExternalLink,
  Sparkles,
  Play,
  Maximize2,
  Minimize2,
  Search,
  X,
} from 'lucide-react';
import type { BrowserSnapshot, YouTubePlayerState } from '../types';

interface BrowserViewProps {
  snapshot: BrowserSnapshot | null;
  youtubePlayer: YouTubePlayerState | null;
  youtubeContainerRef: React.RefObject<HTMLDivElement | null>;
  isFullscreen: boolean;
  onNavigate: (url: string) => Promise<void>;
  onSearchChrome: (query: string) => Promise<void>;
  onPlayYouTube: (query: string) => Promise<void>;
  onCloseYouTube: () => void;
  onToggleFullscreen: (mode?: 'on' | 'off' | 'toggle' | 'video') => void;
  onAskAgentAnalyze: (snapshot: BrowserSnapshot) => void;
}

export const BrowserView: React.FC<BrowserViewProps> = ({
  snapshot,
  youtubePlayer,
  youtubeContainerRef,
  isFullscreen,
  onNavigate,
  onSearchChrome,
  onPlayYouTube,
  onCloseYouTube,
  onToggleFullscreen,
  onAskAgentAnalyze,
}) => {
  const [urlInput, setUrlInput] = useState(snapshot?.url || 'https://news.ycombinator.com');
  const [mediaQuery, setMediaQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGo = async (targetUrl: string) => {
    if (!targetUrl.trim()) return;
    setLoading(true);
    setError(null);
    setUrlInput(targetUrl);
    try {
      await onNavigate(targetUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browser navigation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleChromeSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaQuery.trim()) return;
    setMediaLoading(true);
    setError(null);
    try {
      await onSearchChrome(mediaQuery.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chrome search failed');
    } finally {
      setMediaLoading(false);
    }
  };

  const handlePlayYt = async () => {
    if (!mediaQuery.trim()) return;
    setMediaLoading(true);
    setError(null);
    try {
      await onPlayYouTube(mediaQuery.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'YouTube playback failed');
    } finally {
      setMediaLoading(false);
    }
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
            Chrome, YouTube &amp; Autonomous Browser
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search on Google Chrome, play YouTube videos with fullscreen voice control, or extract live web pages.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleFullscreen(isFullscreen ? 'off' : youtubePlayer ? 'video' : 'on')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          </button>

          {snapshot && (
            <button
              type="button"
              onClick={() => onAskAgentAnalyze(snapshot)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Summarize Page with AI
            </button>
          )}
        </div>
      </div>

      {/* Chrome Search & YouTube Player Launcher */}
      <form
        onSubmit={handleChromeSearch}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex flex-wrap items-center gap-2"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={mediaQuery}
            onChange={(e) => setMediaQuery(e.target.value)}
            placeholder="Search Google Chrome or enter YouTube video name..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={mediaLoading || !mediaQuery.trim()}
          className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
        >
          <Search className="w-3.5 h-3.5" />
          Search Chrome
        </button>
        <button
          type="button"
          disabled={mediaLoading || !mediaQuery.trim()}
          onClick={handlePlayYt}
          className="h-9 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
        >
          <Play className="w-3.5 h-3.5" />
          {mediaLoading ? 'Finding Video...' : 'Play on YouTube'}
        </button>
      </form>

      {/* Embedded YouTube Player */}
      {youtubePlayer && (
        <div
          ref={youtubeContainerRef}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden shadow-sm"
        >
          <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{youtubePlayer.title}</div>
              <div className="text-[11px] font-mono text-slate-400 truncate">{youtubePlayer.watchUrl}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onToggleFullscreen(isFullscreen ? 'off' : 'video')}
                className="h-7 px-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-medium inline-flex items-center gap-1"
              >
                {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                {isFullscreen ? 'Exit Full Screen' : 'Make Full Screen'}
              </button>
              <a
                href={youtubePlayer.watchUrl}
                target="_blank"
                rel="noreferrer"
                className="h-7 px-2.5 rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 text-[11px] inline-flex items-center gap-1"
              >
                Open Chrome Tab
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={onCloseYouTube}
                aria-label="Close YouTube player"
                className="h-7 w-7 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="relative w-full aspect-video max-h-[420px] bg-black">
            <iframe
              key={youtubePlayer.videoId}
              src={youtubePlayer.embedUrl}
              title={youtubePlayer.title}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {/* Browser Address Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleGo(urlInput);
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Globe className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://example.com"
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="h-10 px-4 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          {loading ? 'Loading...' : 'Navigate'}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </form>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-500">Quick Targets:</span>
        {['https://news.ycombinator.com', 'https://stripe.com/pricing', 'https://ollama.com/library'].map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => handleGo(u)}
            className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono text-[11px]"
          >
            {u.replace('https://', '')}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {snapshot ? (
        <div className="grid lg:grid-cols-12 gap-4 flex-1 min-h-0">
          <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 overflow-y-auto space-y-4">
            <div className="pb-3 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {snapshot.title}
                </h3>
                <div className="text-xs font-mono text-slate-500 mt-0.5 break-all">{snapshot.url}</div>
              </div>
              <a
                href={snapshot.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0"
              >
                Open Tab
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {snapshot.description && (
              <p className="text-xs text-slate-600 dark:text-slate-300">{snapshot.description}</p>
            )}

            {snapshot.headings.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Key Headings</div>
                <ul className="list-disc pl-5 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                  {snapshot.headings.slice(0, 8).map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Extracted Page Text</div>
              <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                {snapshot.textContent}
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 overflow-y-auto space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Clickable Links ({snapshot.links.length})
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {snapshot.links.map((l, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleGo(l.href)}
                  className="w-full text-left py-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  <div className="text-xs font-medium truncate">{l.text}</div>
                  <div className="text-[11px] font-mono text-slate-400 truncate">{l.href}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        !youtubePlayer && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500">
            Search Chrome, play a YouTube video, or instruct Kael in the Command Center (e.g. &quot;play lofi beats on YouTube and make it full screen&quot;).
          </div>
        )
      )}
    </div>
  );
};
