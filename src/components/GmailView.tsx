import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Search, Send, Archive, MailOpen, Sparkles, KeyRound, ExternalLink } from 'lucide-react';
import type { GmailMessageItem } from '../types';

interface GmailViewProps {
  gmailToken: string | null;
  onSignIn: () => void;
  onSignInDirectGis: () => void;
  onManualTokenSubmit: (token: string) => Promise<void>;
  isSigningIn: boolean;
  authError: string | null;
  onProposeSendEmail: (to: string, subject: string, body: string) => void;
  onAskAgentSummarize: (subject: string, from: string, body: string) => void;
}

export const GmailView: React.FC<GmailViewProps> = ({
  gmailToken,
  onSignIn,
  onSignInDirectGis,
  onManualTokenSubmit,
  isSigningIn,
  authError,
  onProposeSendEmail,
  onAskAgentSummarize,
}) => {
  const [messages, setMessages] = useState<GmailMessageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBody, setSelectedBody] = useState<string>('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');

  const loadInbox = useCallback(async () => {
    if (!gmailToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gmail/messages?q=${encodeURIComponent(query)}&maxResults=15`, {
        headers: { Authorization: `Bearer ${gmailToken}` },
      });
      const data = (await res.json()) as { messages?: GmailMessageItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed loading Gmail messages');
      setMessages(data.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed loading Gmail');
    } finally {
      setLoading(false);
    }
  }, [gmailToken, query]);

  useEffect(() => {
    if (gmailToken) {
      loadInbox();
    }
  }, [gmailToken, loadInbox]);

  const handleSelectEmail = async (msg: GmailMessageItem) => {
    setSelectedId(msg.id);
    setSelectedBody(msg.snippet);
    if (!gmailToken) return;
    try {
      const res = await fetch(`/api/gmail/messages/${msg.id}`, {
        headers: { Authorization: `Bearer ${gmailToken}` },
      });
      if (res.ok) {
        const d = (await res.json()) as { body?: string };
        setSelectedBody(d.body || msg.snippet);
      }
      if (msg.unread) {
        await fetch(`/api/gmail/messages/${msg.id}/modify`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${gmailToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
        });
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, unread: false } : m)));
      }
    } catch {
      // Keep snippet fallback
    }
  };

  const handleConfirmArchive = async (id: string) => {
    if (!gmailToken) return;
    try {
      const res = await fetch(`/api/gmail/messages/${id}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gmailToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== id));
        if (selectedId === id) setSelectedId(null);
      }
    } finally {
      setConfirmArchiveId(null);
    }
  };

  const handleQueueCompose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim()) return;
    onProposeSendEmail(to.trim(), subject.trim(), body);
    setComposeOpen(false);
    setTo('');
    setSubject('');
    setBody('');
  };

  const handleTokenFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    setError(null);
    try {
      await onManualTokenSubmit(manualToken);
      setManualToken('');
      setShowManualToken(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid token');
    }
  };

  if (!gmailToken) {
    return (
      <div className="max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-5">
        <div className="space-y-2">
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
            Connect your Gmail Account
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Sign in with Google to allow Maya and your digital employees to read, search, archive, and draft replies
            from your live Gmail inbox. Outbound emails always require your confirmation via an Approval Card.
          </p>
        </div>

        {(authError || error) && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
            <p className="font-medium">{authError || error}</p>
            <p className="text-[11px] opacity-90">
              Running locally? Make sure you open <code className="font-mono">http://localhost:3000</code> (not{' '}
              <code className="font-mono">127.0.0.1</code> or <code className="font-mono">0.0.0.0</code>), add your domain in
              Firebase Console → Authentication → Authorized domains, or paste an OAuth token below.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onSignIn} disabled={isSigningIn} className="gsi-material-button">
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
              </div>
              <span className="gsi-material-button-contents">
                {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={onSignInDirectGis}
            disabled={isSigningIn}
            className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            Direct Google OAuth
          </button>

          <a
            href={typeof window !== 'undefined' ? window.location.href : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in New Tab
          </a>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShowManualToken((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <KeyRound className="w-3.5 h-3.5" />
            {showManualToken ? 'Hide manual OAuth token' : 'Or connect with an existing Gmail OAuth token'}
          </button>

          {showManualToken && (
            <form onSubmit={handleTokenFormSubmit} className="mt-3 flex gap-2">
              <input
                type="password"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Paste ya29.... Gmail OAuth2 access token"
                className="flex-1 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
              />
              <button
                type="submit"
                className="h-9 px-3.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
              >
                Verify & Connect
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const activeEmail = messages.find((m) => m.id === selectedId) || null;

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadInbox();
          }}
          className="flex items-center gap-2 flex-1 min-w-[260px]"
        >
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Gmail (e.g. is:unread, from:stripe)..."
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </form>

        <button
          type="button"
          onClick={() => setComposeOpen((v) => !v)}
          className="h-10 px-4 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          Compose Email
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {composeOpen && (
        <form
          onSubmit={handleQueueCompose}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
        >
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Draft New Email (Queues an Approval Card before sending)
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              type="email"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Recipient email"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm"
            />
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-sm"
            />
          </div>
          <textarea
            rows={4}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your email body..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium"
            >
              Queue Approval Card
            </button>
            <button
              type="button"
              onClick={() => setComposeOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid lg:grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {messages.length === 0 && !loading && (
            <div className="p-6 text-sm text-slate-500 dark:text-slate-400">No messages found.</div>
          )}
          {messages.map((msg) => (
            <button
              key={msg.id}
              type="button"
              onClick={() => handleSelectEmail(msg)}
              className={`w-full text-left p-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                selectedId === msg.id ? 'bg-slate-100 dark:bg-slate-800' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={`truncate ${msg.unread ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                  {msg.from.replace(/<.*>/, '').trim() || msg.from}
                </span>
                <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                  {msg.unread ? 'Unread' : 'Read'}
                </span>
              </div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate mt-0.5">
                {msg.subject}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{msg.snippet}</div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 overflow-y-auto">
          {activeEmail ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
                    {activeEmail.subject}
                  </h3>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    From: {activeEmail.from} · {activeEmail.date}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onAskAgentSummarize(activeEmail.subject, activeEmail.from, selectedBody)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Draft Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmArchiveId(activeEmail.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium whitespace-nowrap"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Archive
                  </button>
                </div>
              </div>

              {confirmArchiveId === activeEmail.id && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-amber-900 dark:text-amber-200">
                    Archive &ldquo;{activeEmail.subject}&rdquo; out of your Gmail Inbox?
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleConfirmArchive(activeEmail.id)}
                      className="px-3 py-1 rounded bg-slate-900 text-white text-xs font-medium"
                    >
                      Confirm Archive
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmArchiveId(null)}
                      className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                {selectedBody}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 space-y-2 py-16">
              <MailOpen className="w-8 h-8" />
              <p className="text-sm">Select an email thread to read or draft an AI reply.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
