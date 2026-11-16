import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Moon, Sun } from 'lucide-react';
import type {
  ActivityLogEntry,
  ApprovalProposal,
  BrowserSnapshot,
  CallRecord,
  ChatMessage,
  DailyActivityOverview,
  DigitalEmployee,
  EmailSyncSummary,
  IntegrationCredentials,
  LlmConfig,
  MountedLaptopFile,
  QuickBooksExpense,
  QuickBooksInvoice,
  ScheduledMeeting,
  VoiceSettings,
  WhatsAppThread,
  WorkspaceTab,
  YouTubePlayerState,
} from './types';
import { DEFAULT_EMPLOYEES } from './data/defaultEmployees';
import {
  initAuth,
  googleSignIn,
  googleSignInDirectGis,
  setManualGmailToken,
  logoutGoogle,
  type GoogleAccountProfile,
} from './services/firebaseAuth';
import { LocalVoiceListener, speakLocal, stopSpeaking } from './services/voiceEngine';
import { runAgentTurn } from './services/llmClient';
import {
  deleteLaptopFile,
  sendOsBridgeSetting,
  triggerOsBridgeCall,
  writeLaptopFile,
  type LaptopDirectoryHandle,
} from './services/localLaptopBridge';
import { buildWhatsAppMeUrl, validateAndFormatWhatsAppPhone } from './utils/phoneValidation';
import { Sidebar } from './components/Sidebar';
import { CommandCenter } from './components/CommandCenter';
import { DailyOverviewView } from './components/DailyOverviewView';
import { EmployeesView } from './components/EmployeesView';
import { GmailView } from './components/GmailView';
import { CommsView } from './components/CommsView';
import { QuickBooksView } from './components/QuickBooksView';
import { BrowserView } from './components/BrowserView';
import { SystemControlView } from './components/SystemControlView';
import { ModelsConfigView } from './components/ModelsConfigView';
import { VoiceOnlyOverlay } from './components/VoiceOnlyOverlay';

const TAB_TITLES: Record<WorkspaceTab, string> = {
  command: 'Command Center',
  overview: 'Daily Overview & Check-Ups',
  employees: 'Digital Employees',
  gmail: 'Gmail Inbox',
  comms: 'WhatsApp & Calls',
  quickbooks: 'QuickBooks Ledger',
  browser: 'Web Browser Agent',
  system: 'Laptop & System Files',
  models: 'AI Providers & Local Voice',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('command');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [voiceOnlyMode, setVoiceOnlyMode] = useState<boolean>(false);

  // Workforce & Chat
  const [employees, setEmployees] = useState<DigitalEmployee[]>(DEFAULT_EMPLOYEES);
  const [activeEmployeeId, setActiveEmployeeId] = useState<string>(DEFAULT_EMPLOYEES[0].id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);

  // LLM & Voice Settings
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    ollamaDirectBrowser: true,
  });
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    autoSpeak: true,
    continuousListen: false,
    language: 'en-US',
    voiceURI: '',
    rate: 1.02,
    pitch: 1.0,
  });

  // Live Audio & Voice State
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [lastUserTranscript, setLastUserTranscript] = useState<string>('');
  const [lastAssistantReply, setLastAssistantReply] = useState<string>(
    'Hello. I am Maya, your Chief of Staff. Ask me to check Gmail, update QuickBooks, send WhatsApp messages, browse the web, or manage your laptop files.'
  );
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const listenerRef = useRef<LocalVoiceListener>(new LocalVoiceListener());
  const globalTelRef = useRef<HTMLAnchorElement>(null);

  // Google Auth / Gmail
  const [googleUser, setGoogleUser] = useState<GoogleAccountProfile | null>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [unreadGmailCount, setUnreadGmailCount] = useState<number>(0);

  // Integrations State
  const [credentials, setCredentials] = useState<IntegrationCredentials>({
    whatsappPhoneNumberId: '',
    whatsappAccessToken: '',
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioFromNumber: '',
    quickbooksRealmId: '',
    quickbooksAccessToken: '',
    quickbooksSandbox: true,
  });
  const [whatsappThreads, setWhatsappThreads] = useState<WhatsAppThread[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [invoices, setInvoices] = useState<QuickBooksInvoice[]>([]);
  const [expenses, setExpenses] = useState<QuickBooksExpense[]>([]);
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [overviewDate, setOverviewDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [dailyOverview, setDailyOverview] = useState<DailyActivityOverview | null>(null);
  const [autoCheckupPrompts, setAutoCheckupPrompts] = useState<boolean>(true);
  const queuedCheckupInvoiceIdsRef = useRef<Set<string>>(new Set());

  const [browserSnapshot, setBrowserSnapshot] = useState<BrowserSnapshot | null>(null);
  const [youtubePlayer, setYoutubePlayer] = useState<YouTubePlayerState | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const youtubeContainerRef = useRef<HTMLDivElement | null>(null);
  const [externalCallState, setExternalCallState] = useState<{
    callId?: string;
    contactName: string;
    phone: string;
    script: string;
    mode: string;
    twilioSid?: string;
    twilioStatus?: string;
  } | null>(null);

  const [autoReconcileEmail, setAutoReconcileEmail] = useState<boolean>(true);
  const [autoApplyPaidInvoices, setAutoApplyPaidInvoices] = useState<boolean>(true);
  const [emailSyncIntervalSec, setEmailSyncIntervalSec] = useState<number>(60);
  const [isScanningEmailQb, setIsScanningEmailQb] = useState<boolean>(false);
  const [lastEmailSync, setLastEmailSync] = useState<EmailSyncSummary | null>(null);
  const seenSyncEmailIdsRef = useRef<Set<string>>(new Set());

  const [laptopDirHandle, setLaptopDirHandle] = useState<LaptopDirectoryHandle | null>(null);
  const [mountedFiles, setMountedFiles] = useState<MountedLaptopFile[]>([]);
  const [mountedFolderName, setMountedFolderName] = useState<string | null>(null);

  // Track Fullscreen API state
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Apply Dark Mode class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Init Firebase Google Auth listener
  useEffect(() => {
    const unsub = initAuth(
      (user, token) => {
        setGoogleUser(user);
        if (token) setGmailToken(token);
      },
      () => {
        setGoogleUser(null);
        setGmailToken(null);
      }
    );
    return () => unsub();
  }, []);

  // Load initial WhatsApp, Calls, QuickBooks, Meetings, and Daily Overview data from server store
  const refreshIntegrationsData = useCallback(async () => {
    try {
      const [waRes, callRes, qbRes, mtgRes, ovRes] = await Promise.all([
        fetch('/api/whatsapp/threads'),
        fetch('/api/calls/history'),
        fetch('/api/quickbooks/ledger'),
        fetch('/api/meetings'),
        fetch(`/api/activity/overview?date=${encodeURIComponent(overviewDate)}`),
      ]);
      if (waRes.ok) {
        const d = (await waRes.json()) as { threads: WhatsAppThread[] };
        setWhatsappThreads(d.threads || []);
      }
      if (callRes.ok) {
        const d = (await callRes.json()) as { calls: CallRecord[] };
        setCalls(d.calls || []);
      }
      if (qbRes.ok) {
        const d = (await qbRes.json()) as { invoices: QuickBooksInvoice[]; expenses: QuickBooksExpense[] };
        setInvoices(d.invoices || []);
        setExpenses(d.expenses || []);
      }
      if (mtgRes.ok) {
        const d = (await mtgRes.json()) as { meetings: ScheduledMeeting[] };
        setMeetings(d.meetings || []);
      }
      if (ovRes.ok) {
        const d = (await ovRes.json()) as DailyActivityOverview;
        setDailyOverview(d);
      }
    } catch {
      // Ignore transient boot network error
    }
  }, [overviewDate]);

  useEffect(() => {
    refreshIntegrationsData();
  }, [refreshIntegrationsData]);

  const logClientActivity = useCallback(
    async (
      category: ActivityLogEntry['category'],
      title: string,
      detail = '',
      status: ActivityLogEntry['status'] = 'completed',
      employeeName = 'Maya Lin'
    ) => {
      try {
        await fetch('/api/activity/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, title, detail, status, employeeName }),
        });
        const ovRes = await fetch(`/api/activity/overview?date=${encodeURIComponent(overviewDate)}`);
        if (ovRes.ok) {
          setDailyOverview((await ovRes.json()) as DailyActivityOverview);
        }
      } catch {
        // Non-fatal logging error
      }
    },
    [overviewDate]
  );

  // Fetch unread Gmail count when token becomes available
  useEffect(() => {
    if (!gmailToken) {
      setUnreadGmailCount(0);
      return;
    }
    fetch('/api/gmail/messages?q=is:unread&maxResults=10', {
      headers: { Authorization: `Bearer ${gmailToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { messages?: unknown[] } | null) => {
        if (d?.messages) setUnreadGmailCount(d.messages.length);
      })
      .catch(() => {});
  }, [gmailToken]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const res = await googleSignIn();
      setGoogleUser(res.user);
      setGmailToken(res.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In cancelled or failed.';
      setAuthError(msg);
      setVoiceError(msg);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleSignInDirectGis = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const res = await googleSignInDirectGis();
      setGoogleUser(res.user);
      setGmailToken(res.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Direct Google OAuth failed.';
      setAuthError(msg);
      setVoiceError(msg);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleManualTokenSubmit = async (token: string) => {
    const res = await setManualGmailToken(token);
    setGoogleUser(res.user);
    setGmailToken(res.accessToken);
    setAuthError(null);
  };

  const handleGoogleSignOut = async () => {
    await logoutGoogle();
    setGoogleUser(null);
    setGmailToken(null);
  };

  // Speak helper
  const speakReply = useCallback(
    (text: string, forceSpeak = false) => {
      if (!forceSpeak && !voiceSettings.autoSpeak && !voiceOnlyMode) return;
      speakLocal(text, voiceSettings, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
      });
    },
    [voiceSettings, voiceOnlyMode]
  );

  // Periodic Email-to-QuickBooks Reconciliation
  const runEmailQuickBooksSync = useCallback(
    async (manual = false) => {
      if (!gmailToken) {
        if (manual) throw new Error('Connect Gmail first to scan emails for paid bills.');
        return;
      }
      setIsScanningEmailQb(true);
      try {
        const res = await fetch('/api/quickbooks/reconcile-emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${gmailToken}`,
          },
          body: JSON.stringify({
            maxResults: 15,
            autoApply: autoApplyPaidInvoices,
          }),
        });
        const data = (await res.json()) as EmailSyncSummary & {
          ok?: boolean;
          invoices?: QuickBooksInvoice[];
          expenses?: QuickBooksExpense[];
          error?: string;
        };
        if (!res.ok) {
          if (manual) throw new Error(data.error || 'Email reconciliation failed');
          return;
        }
        if (data.invoices) setInvoices(data.invoices);
        if (data.expenses) setExpenses(data.expenses);

        const summary: EmailSyncSummary = {
          lastScannedAt: data.lastScannedAt,
          scannedCount: data.scannedCount,
          matchedPaid: data.matchedPaid || [],
          detectedBills: data.detectedBills || [],
        };
        setLastEmailSync(summary);

        const freshMatches = summary.matchedPaid.filter(
          (m) => !seenSyncEmailIdsRef.current.has(`paid:${m.invoiceId}:${m.emailId}`)
        );
        const freshBills = summary.detectedBills.filter(
          (b) => !seenSyncEmailIdsRef.current.has(`bill:${b.emailId}`)
        );
        freshMatches.forEach((m) => seenSyncEmailIdsRef.current.add(`paid:${m.invoiceId}:${m.emailId}`));
        freshBills.forEach((b) => seenSyncEmailIdsRef.current.add(`bill:${b.emailId}`));

        if (freshMatches.length > 0 || freshBills.length > 0) {
          const parts: string[] = [];
          if (freshMatches.length > 0) {
            parts.push(
              `Marked ${freshMatches.length} paid invoice${freshMatches.length > 1 ? 's' : ''} from Gmail: ${freshMatches
                .map((m) => `${m.invoiceNumber} (${m.customerName} $${m.amount.toLocaleString()})`)
                .join(', ')}.`
            );
          }
          if (freshBills.length > 0) {
            parts.push(
              `Detected ${freshBills.length} vendor bill${freshBills.length > 1 ? 's' : ''}: ${freshBills
                .map((b) => `${b.vendor} ($${b.amount.toLocaleString()})`)
                .join(', ')}.`
            );
          }
          const note = parts.join(' ');
          const marcus = employees.find((e) => e.id === 'emp-marcus') || employees[0];
          setMessages((prev) => [
            ...prev,
            {
              id: `qbsync-${Date.now()}`,
              role: 'assistant',
              employeeId: marcus.id,
              employeeName: marcus.name,
              employeeAvatar: marcus.avatar,
              content: `QuickBooks Auto-Sync: ${note}`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
          speakReply(note);
        }
      } finally {
        setIsScanningEmailQb(false);
      }
    },
    [gmailToken, autoApplyPaidInvoices, employees, speakReply]
  );

  useEffect(() => {
    if (!gmailToken || !autoReconcileEmail) return;
    runEmailQuickBooksSync(false).catch(() => {});
    const timer = setInterval(() => {
      runEmailQuickBooksSync(false).catch(() => {});
    }, Math.max(15, emailSyncIntervalSec) * 1000);
    return () => clearInterval(timer);
  }, [gmailToken, autoReconcileEmail, emailSyncIntervalSec, runEmailQuickBooksSync]);

  // Fullscreen & App Media Control Helpers
  const applyFullscreenControl = useCallback(
    async (mode: 'on' | 'off' | 'toggle' | 'video' = 'toggle'): Promise<string> => {
      const currentlyFs = Boolean(document.fullscreenElement);
      const shouldExit = mode === 'off' || (mode === 'toggle' && currentlyFs);

      if (shouldExit) {
        if (document.fullscreenElement) {
          await document.exitFullscreen().catch(() => {});
        }
        sendOsBridgeSetting('fullscreen', 'off').catch(() => {});
        setIsFullscreen(false);
        return 'Exited full screen mode.';
      }

      const preferVideoEl =
        mode === 'video' || (activeTab === 'browser' && Boolean(youtubeContainerRef.current));
      const targetEl = preferVideoEl && youtubeContainerRef.current ? youtubeContainerRef.current : document.documentElement;
      let browserFsOk = false;
      if (targetEl && typeof targetEl.requestFullscreen === 'function') {
        try {
          await targetEl.requestFullscreen();
          browserFsOk = true;
          setIsFullscreen(true);
        } catch {
          // Browsers inside nested iframes or non-gesture calls may reject Fullscreen API
        }
      }

      const bridgeRes = await sendOsBridgeSetting('fullscreen', mode === 'video' ? 'video' : 'on').catch(() => ({
        ok: false,
      }));
      if (browserFsOk && bridgeRes.ok) return 'Switched both workstation and Chrome to full screen.';
      if (browserFsOk) return 'Entered full screen mode.';
      if (bridgeRes.ok) return 'Triggered Chrome full screen via Local OS Bridge.';
      return 'Full screen requested (click the Full Screen button if browser iframe policy blocks automatic fullscreen).';
    },
    [activeTab]
  );

  const launchChromeSearch = useCallback(async (query: string): Promise<string> => {
    const clean = query.trim();
    const isDirectUrl = /^https?:\/\//i.test(clean) || /^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(clean);
    const targetUrl = isDirectUrl
      ? /^https?:\/\//i.test(clean)
        ? clean
        : `https://${clean}`
      : `https://www.google.com/search?q=${encodeURIComponent(clean)}`;

    setActiveTab('browser');
    const bridgePromise = sendOsBridgeSetting('chrome_search', targetUrl);

    if (isDirectUrl) {
      fetch('/api/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { snapshot?: BrowserSnapshot } | null) => {
          if (d?.snapshot) setBrowserSnapshot(d.snapshot);
        })
        .catch(() => {});
    }

    const bridgeRes = await bridgePromise;
    logClientActivity('browser', `Chrome Search: ${clean}`, targetUrl, 'completed', 'Kael Sorensen');
    if (bridgeRes.ok) {
      return `Opened Google Chrome search for "${clean}".`;
    }
    const opened = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    if (opened) {
      return `Opened "${clean}" in a new Chrome browser tab.`;
    }
    return `Prepared Chrome search (${targetUrl}). Allow popups or run the Local Bridge to auto-launch Chrome.`;
  }, [logClientActivity]);

  const launchYouTubePlayback = useCallback(
    async (
      query: string,
      preResolved?: Partial<YouTubePlayerState>
    ): Promise<{ video: YouTubePlayerState; message: string }> => {
      let video: YouTubePlayerState;
      if (preResolved?.videoId && preResolved?.watchUrl && preResolved?.embedUrl) {
        video = {
          videoId: preResolved.videoId,
          title: preResolved.title || query,
          query,
          watchUrl: preResolved.watchUrl,
          embedUrl: preResolved.embedUrl,
          startedAt: new Date().toISOString(),
        };
      } else {
        const res = await fetch(`/api/browser/youtube-resolve?q=${encodeURIComponent(query)}`);
        const d = (await res.json()) as Partial<YouTubePlayerState> & { error?: string };
        if (!res.ok || !d.videoId || !d.watchUrl || !d.embedUrl) {
          throw new Error(d.error || 'Could not resolve YouTube video.');
        }
        video = {
          videoId: d.videoId,
          title: d.title || query,
          query,
          watchUrl: d.watchUrl,
          embedUrl: d.embedUrl,
          startedAt: new Date().toISOString(),
        };
      }

      setYoutubePlayer(video);
      setActiveTab('browser');
      const bridgeRes = await sendOsBridgeSetting('youtube_play', video.watchUrl).catch(() => ({ ok: false }));
      logClientActivity('browser', `Played YouTube: ${video.title}`, video.watchUrl, 'completed', 'Kael Sorensen');
      return {
        video,
        message: bridgeRes.ok
          ? `Playing "${video.title}" in Browser tab and Google Chrome.`
          : `Playing "${video.title}" in Azaris Browser tab. Say "make it full screen" anytime.`,
      };
    },
    [logClientActivity]
  );

  const sendWhatsAppDirect = useCallback(
    async (contactName: string, phone: string, message: string) => {
      const phoneCheck = validateAndFormatWhatsAppPhone(phone);
      if (!phoneCheck.valid) {
        throw new Error(phoneCheck.error);
      }
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        throw new Error('WhatsApp message text cannot be empty.');
      }

      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneCheck.e164,
          contactName,
          message: trimmedMessage,
          phoneNumberId: credentials.whatsappPhoneNumberId || undefined,
          accessToken: credentials.whatsappAccessToken || undefined,
        }),
      });
      const d = (await res.json()) as {
        delivery?: string;
        waLink?: string;
        fallbackReason?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error || 'WhatsApp dispatch failed');

      let popupOpened = false;
      let resolvedWaLink = d.waLink;

      // Secondary fallback strategy: open pre-filled https://wa.me/ URI when automated API delivery is not possible
      if (d.delivery === 'wa-link') {
        const linkCheck = buildWhatsAppMeUrl(phoneCheck.e164, trimmedMessage);
        if (!linkCheck.valid) {
          throw new Error(linkCheck.error);
        }
        resolvedWaLink = d.waLink || linkCheck.url;
        const opened = window.open(resolvedWaLink, '_blank', 'noopener,noreferrer');
        popupOpened = Boolean(opened);
      }

      await refreshIntegrationsData();
      return { ...d, waLink: resolvedWaLink, popupOpened };
    },
    [credentials.whatsappPhoneNumberId, credentials.whatsappAccessToken, refreshIntegrationsData]
  );

  const initiateCallDirect = useCallback(
    async (
      contactName: string,
      phone: string,
      script: string,
      options?: { invoiceId?: string; followUpWeeks?: number }
    ) => {
      const res = await fetch('/api/calls/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          contactName,
          script,
          invoiceId: options?.invoiceId,
          followUpWeeks: options?.followUpWeeks,
          accountSid: credentials.twilioAccountSid || undefined,
          authToken: credentials.twilioAuthToken || undefined,
          fromNumber: credentials.twilioFromNumber || undefined,
        }),
      });
      const d = (await res.json()) as {
        record?: CallRecord;
        telUri?: string;
        twilioSid?: string;
        twilioStatus?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error || 'Call initiation failed');
      await refreshIntegrationsData();
      return {
        recordId: d.record?.id,
        telUri: d.telUri,
        status: d.record?.status,
        twilioSid: d.twilioSid,
        twilioStatus: d.twilioStatus,
      };
    },
    [credentials.twilioAccountSid, credentials.twilioAuthToken, credentials.twilioFromNumber, refreshIntegrationsData]
  );

  // Execute an approved or direct proposal
  const executeProposalAction = useCallback(
    async (
      actionType: ApprovalProposal['actionType'],
      payload: Record<string, unknown>
    ): Promise<string> => {
      if (actionType === 'ui_mode' || actionType === 'laptop_setting') {
        const setting = String(payload.setting || '');
        const value = String(payload.value || '').toLowerCase();

        if (setting === 'theme') {
          setDarkMode(value === 'dark');
          return `Switched interface appearance to ${value} mode.`;
        }
        if (setting === 'voice_only_mode') {
          const next = value === 'on' || value === 'true';
          setVoiceOnlyMode(next);
          return next ? 'Entered Voice-Only Mode.' : 'Returned to standard workstation view.';
        }
        if (setting === 'auto_speak') {
          const next = value === 'on' || value === 'true';
          setVoiceSettings((vs) => ({ ...vs, autoSpeak: next }));
          return `Local spoken replies ${next ? 'enabled' : 'disabled'}.`;
        }
        if (setting === 'navigate_tab') {
          const validTabs: WorkspaceTab[] = [
            'command',
            'overview',
            'employees',
            'gmail',
            'comms',
            'quickbooks',
            'browser',
            'system',
            'models',
          ];
          const matched = validTabs.find((t) => value.includes(t));
          if (matched) setActiveTab(matched);
          return `Navigated to ${matched || value}.`;
        }
        if (setting === 'wake_lock') {
          const nav = navigator as unknown as {
            wakeLock?: { request: (type: 'screen') => Promise<unknown> };
          };
          if (nav.wakeLock) {
            await nav.wakeLock.request('screen');
            return 'Laptop Screen Wake Lock enabled.';
          }
          return 'Wake Lock API unavailable in this browser.';
        }

        const rawVal = String(payload.value || '').trim();
        const bridgeRes = await sendOsBridgeSetting(setting, rawVal);
        if (bridgeRes.ok) {
          return `Applied laptop OS setting (${setting} = ${rawVal}).`;
        }

        if (setting === 'open_app') {
          if (value.includes('gmail') || value.includes('mail')) {
            setActiveTab('gmail');
            return 'Opened Gmail Inbox in Azaris (Local Bridge offline for native mail app).';
          }
          if (value.includes('whatsapp') || value.includes('phone') || value.includes('call')) {
            setActiveTab('comms');
            return 'Opened WhatsApp & Calls in Azaris.';
          }
          if (value.includes('quickbooks')) {
            setActiveTab('quickbooks');
            return 'Opened QuickBooks Ledger in Azaris.';
          }
          if (value.includes('finder') || value.includes('explorer') || value.includes('files')) {
            setActiveTab('system');
            return 'Opened Laptop & System Files explorer.';
          }
          if (
            value.includes('chrome') ||
            value.includes('safari') ||
            value.includes('edge') ||
            value.includes('firefox') ||
            value.includes('browser')
          ) {
            setActiveTab('browser');
            return `Switched to Azaris Web Browser Agent (run azaris-local-bridge.mjs from Laptop & Files to launch native "${rawVal}" on your desktop).`;
          }
          if (/^https?:\/\//i.test(rawVal) || /^www\./i.test(rawVal)) {
            const targetUrl = /^https?:\/\//i.test(rawVal) ? rawVal : `https://${rawVal}`;
            const navRes = await fetch('/api/browser/navigate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: targetUrl }),
            });
            if (navRes.ok) {
              const snapData = (await navRes.json()) as { snapshot?: BrowserSnapshot };
              if (snapData.snapshot) setBrowserSnapshot(snapData.snapshot);
              setActiveTab('browser');
              return `Opened ${targetUrl} in Azaris Web Browser Agent.`;
            }
          }
        }

        throw new Error(
          bridgeRes.error ||
            `Local OS Companion Bridge is not running on port 43110. Download & run azaris-local-bridge.mjs from Laptop & Files to apply "${setting}".`
        );
      }

      if (actionType === 'gmail_send') {
        if (!gmailToken) {
          throw new Error('Please click "Sign in with Google" first to authorize sending via Gmail.');
        }
        const res = await fetch('/api/gmail/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${gmailToken}`,
          },
          body: JSON.stringify({
            to: payload.to,
            subject: payload.subject,
            body: payload.body,
          }),
        });
        const d = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(d.error || 'Failed sending Gmail');
        return `Email sent via Gmail to ${String(payload.to)}.`;
      }

      if (actionType === 'whatsapp_send') {
        const d = await sendWhatsAppDirect(
          String(payload.contactName || payload.phone || ''),
          String(payload.phone || ''),
          String(payload.message || payload.body || '')
        );
        if (d.delivery === 'sent') {
          return `WhatsApp message sent directly to ${String(payload.phone)} via linked WhatsApp Web.`;
        }
        if (d.delivery === 'cloud-api') {
          return `WhatsApp Cloud API message delivered to ${String(payload.phone)}.`;
        }
        return d.popupOpened
          ? `Automated delivery unavailable — opened pre-filled WhatsApp chat (${d.waLink}).`
          : `Automated delivery unavailable and popup was blocked. Open directly: ${d.waLink}`;
      }

      if (actionType === 'voice_call') {
        const phone = String(payload.phone || '');
        const contactName = String(payload.contactName || phone);
        const script = String(payload.script || '');
        const invoiceId = payload.invoiceId ? String(payload.invoiceId) : undefined;
        const followUpWeeks = payload.followUpWeeks ? Number(payload.followUpWeeks) : undefined;
        const d = await initiateCallDirect(contactName, phone, script, { invoiceId, followUpWeeks });

        if (d.status === 'twilio-dispatched') {
          setExternalCallState({
            callId: d.recordId,
            contactName,
            phone,
            script,
            mode: 'Twilio Ringing (Waiting for Pickup)',
            twilioSid: d.twilioSid,
            twilioStatus: d.twilioStatus || 'queued',
          });
          setActiveTab('comms');
          return `Twilio call ringing ${phone}. Waiting for recipient to answer before speaking script.${
            followUpWeeks ? ` Next check-up scheduled in ${followUpWeeks} week(s).` : ''
          }`;
        }

        const bridgeCall = await triggerOsBridgeCall(phone);
        if (!bridgeCall.ok && globalTelRef.current) {
          globalTelRef.current.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
          globalTelRef.current.click();
        }

        // Wait for recipient pickup instead of speaking immediately upon dialing
        setExternalCallState({
          callId: d.recordId,
          contactName,
          phone,
          script,
          mode: bridgeCall.ok
            ? 'OS Dialer Launched (Waiting for Pickup)'
            : 'Phone App Opened (Click Call & Wait for Pickup)',
        });
        setActiveTab('comms');

        const nextNote = followUpWeeks ? ` Next check-up scheduled in ${followUpWeeks} week(s).` : '';
        return bridgeCall.ok
          ? `Dialed ${phone} via Local Bridge. Waiting for pickup — click "Answered — Speak Script" once they pick up.${nextNote}`
          : `Opened phone app for ${phone}. Click Call in your dialer if needed, then click "Answered — Speak Script" once they pick up.${nextNote}`;
      }

      if (actionType === 'schedule_meeting') {
        const res = await fetch('/api/meetings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(gmailToken ? { Authorization: `Bearer ${gmailToken}` } : {}),
          },
          body: JSON.stringify({
            title: payload.title,
            contactName: payload.contactName,
            contactEmail: payload.contactEmail,
            contactPhone: payload.contactPhone,
            invoiceId: payload.invoiceId,
            invoiceNumber: payload.invoiceNumber,
            scheduledFor: payload.scheduledFor,
            durationMinutes: payload.durationMinutes || 30,
            notes: payload.notes || '',
          }),
        });
        const d = (await res.json()) as { meeting?: ScheduledMeeting; error?: string };
        if (!res.ok) throw new Error(d.error || 'Failed scheduling meeting');
        await refreshIntegrationsData();
        const whenStr = d.meeting?.scheduledFor
          ? new Date(d.meeting.scheduledFor).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : String(payload.scheduledFor || '');
        return `Scheduled meeting "${d.meeting?.title || String(payload.title)}" with ${String(
          payload.contactName
        )} for ${whenStr}.${d.meeting?.googleCalendarEventId ? ' Added to Google Calendar.' : ' Open Daily Overview for Calendar link.'}`;
      }

      if (actionType === 'app_media') {
        const mediaAction = String(payload.action || 'chrome_search');
        if (mediaAction === 'youtube_play') {
          const { message } = await launchYouTubePlayback(String(payload.query || ''), {
            videoId: payload.videoId ? String(payload.videoId) : undefined,
            title: payload.title ? String(payload.title) : undefined,
            watchUrl: payload.watchUrl ? String(payload.watchUrl) : undefined,
            embedUrl: payload.embedUrl ? String(payload.embedUrl) : undefined,
          });
          return message;
        }
        if (mediaAction === 'fullscreen') {
          const fsMode = (String(payload.fullscreenMode || 'on') as 'on' | 'off' | 'toggle' | 'video');
          return await applyFullscreenControl(fsMode);
        }
        return await launchChromeSearch(String(payload.query || payload.url || ''));
      }

      if (actionType === 'quickbooks_create_invoice') {
        const res = await fetch('/api/quickbooks/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = (await res.json()) as { invoice?: QuickBooksInvoice; error?: string };
        if (!res.ok) throw new Error(d.error || 'Failed creating invoice');
        await refreshIntegrationsData();
        return `Created QuickBooks invoice ${d.invoice?.invoiceNumber} for $${Number(payload.amount || 0).toLocaleString()}.`;
      }

      if (actionType === 'quickbooks_mark_paid') {
        const invoiceId = String(payload.invoiceId || payload.id || '');
        if (!invoiceId) throw new Error('Invoice ID is required.');
        const res = await fetch(`/api/quickbooks/invoices/${invoiceId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Paid' }),
        });
        if (!res.ok) throw new Error('Failed marking invoice Paid');
        await refreshIntegrationsData();
        return `Marked QuickBooks invoice as Paid.`;
      }

      if (actionType === 'quickbooks_add_expense') {
        const res = await fetch('/api/quickbooks/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(d.error || 'Failed logging expense');
        await refreshIntegrationsData();
        return `Logged $${Number(payload.amount || 0).toLocaleString()} expense for ${String(payload.vendor || 'Vendor')}.`;
      }

      if (actionType === 'file_write') {
        const filePath = String(payload.path || '');
        const content = String(payload.content || '');
        if (laptopDirHandle && !filePath.includes('/')) {
          await writeLaptopFile(laptopDirHandle, filePath, content);
          return `Wrote file "${filePath}" directly to mounted laptop folder "${laptopDirHandle.name}".`;
        }
        const res = await fetch('/api/system/workspace-files/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, content }),
        });
        const d = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(d.error || 'Failed writing system file');
        return `Saved "${filePath}" to workspace filesystem.`;
      }

      if (actionType === 'file_delete') {
        const filePath = String(payload.path || '');
        if (laptopDirHandle && !filePath.includes('/')) {
          await deleteLaptopFile(laptopDirHandle, filePath);
          return `Deleted "${filePath}" from mounted laptop folder.`;
        }
        const res = await fetch('/api/system/workspace-files/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath }),
        });
        const d = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(d.error || 'Failed deleting file');
        return `Removed "${filePath}".`;
      }

      return 'Action executed.';
    },
    [
      gmailToken,
      sendWhatsAppDirect,
      initiateCallDirect,
      refreshIntegrationsData,
      laptopDirHandle,
      launchYouTubePlayback,
      applyFullscreenControl,
      launchChromeSearch,
    ]
  );

  // Helper to attach a manual Approval Card from any UI view
  const queueManualProposal = useCallback(
    (
      employeeId: string,
      actionType: ApprovalProposal['actionType'],
      title: string,
      summary: string,
      payload: Record<string, unknown>,
      options?: { switchToCommand?: boolean; introText?: string }
    ) => {
      const emp = employees.find((e) => e.id === employeeId) || employees[0];
      const prop: ApprovalProposal = {
        id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        employeeId: emp.id,
        employeeName: emp.name,
        employeeAvatar: emp.avatar,
        actionType,
        title,
        summary,
        payload,
        status: 'pending',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          role: 'assistant',
          employeeId: emp.id,
          employeeName: emp.name,
          employeeAvatar: emp.avatar,
          content: options?.introText || `I have prepared "${title}" for your confirmation.`,
          timestamp: prop.createdAt,
          proposals: [prop],
        },
      ]);
      if (options?.switchToCommand !== false) {
        setActiveTab('command');
      }
    },
    [employees]
  );

  const proposeInvoiceCheckupCall = useCallback(
    (inv: QuickBooksInvoice, switchToCommand = true) => {
      const weeks = inv.followUpWeeks || 2;
      const phone = inv.customerPhone || '+14155550198';
      const script = `Hello, this is Azaris calling on behalf of the finance team to check in on ${inv.invoiceNumber} for $${inv.amount.toLocaleString()} (${inv.description}). Could you share a quick status update on when payment is expected?`;
      queueManualProposal(
        'emp-marcus',
        'voice_call',
        `Approve Invoice Check-Up Call: ${inv.customerName} (${inv.invoiceNumber})`,
        `${inv.status} invoice ($${inv.amount.toLocaleString()}) due ${inv.dueDate}. Needs your permission before calling — will schedule next check-up in ${weeks} week(s).`,
        {
          contactName: inv.customerName,
          phone,
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          followUpWeeks: weeks,
          script,
        },
        {
          switchToCommand,
          introText: `Asking your permission before calling ${inv.customerName} for ${inv.invoiceNumber} check-up (recurs every ${weeks} week${weeks > 1 ? 's' : ''}).`,
        }
      );
      logClientActivity(
        'approval',
        `Requested Call Permission: ${inv.invoiceNumber} (${inv.customerName})`,
        `Awaiting approval before calling ${phone}`,
        'pending_approval',
        'Marcus Vance'
      );
    },
    [queueManualProposal, logClientActivity]
  );

  const proposeInvoiceMeeting = useCallback(
    (inv: QuickBooksInvoice, customDateIso?: string) => {
      const tomorrow = new Date(Date.now() + 86400_000);
      tomorrow.setHours(10, 0, 0, 0);
      const localIso = customDateIso || `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(
        tomorrow.getDate()
      ).padStart(2, '0')}T10:00`;
      queueManualProposal(
        'emp-maya',
        'schedule_meeting',
        `Approve Meeting: ${inv.customerName} (${inv.invoiceNumber})`,
        `Asking permission before setting a 30-min invoice & payment update meeting with ${inv.customerName} (${inv.customerEmail || inv.customerPhone || 'contact'}).`,
        {
          title: `${inv.customerName} — ${inv.invoiceNumber} Check-Up Meeting`,
          contactName: inv.customerName,
          contactEmail: inv.customerEmail || '',
          contactPhone: inv.customerPhone || '',
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          scheduledFor: localIso,
          durationMinutes: 30,
          notes: `Check status on ${inv.invoiceNumber} ($${inv.amount.toLocaleString()}, ${inv.status}) and confirm follow-up timeline.`,
        },
        {
          switchToCommand: true,
          introText: `Asking your permission before setting a meeting with ${inv.customerName} regarding ${inv.invoiceNumber}.`,
        }
      );
      logClientActivity(
        'approval',
        `Requested Meeting Permission: ${inv.customerName} (${inv.invoiceNumber})`,
        `Proposed for ${localIso.replace('T', ' ')}`,
        'pending_approval',
        'Maya Lin'
      );
    },
    [queueManualProposal, logClientActivity]
  );

  const scanDueInvoiceCheckups = useCallback(
    async (switchToCommand = false): Promise<number> => {
      try {
        const res = await fetch('/api/quickbooks/checkups/due');
        if (!res.ok) return 0;
        const data = (await res.json()) as { dueInvoices?: QuickBooksInvoice[] };
        const due = data.dueInvoices || [];
        let queued = 0;
        for (const inv of due) {
          if (queuedCheckupInvoiceIdsRef.current.has(inv.id)) continue;
          queuedCheckupInvoiceIdsRef.current.add(inv.id);
          proposeInvoiceCheckupCall(inv, switchToCommand);
          queued++;
        }
        return queued;
      } catch {
        return 0;
      }
    },
    [proposeInvoiceCheckupCall]
  );

  // Automatically watch multi-week invoice check-up schedules and ask permission via Approval Cards
  useEffect(() => {
    if (!autoCheckupPrompts) return;
    const bootTimer = setTimeout(() => {
      scanDueInvoiceCheckups(false).catch(() => {});
    }, 1500);
    const interval = setInterval(() => {
      scanDueInvoiceCheckups(false).catch(() => {});
    }, 60_000);
    return () => {
      clearTimeout(bootTimer);
      clearInterval(interval);
    };
  }, [autoCheckupPrompts, scanDueInvoiceCheckups]);

  const handleApproveProposal = useCallback(
    async (proposalId: string, editedPayload?: Record<string, unknown>) => {
      let target: ApprovalProposal | null = null;
      for (const m of messages) {
        const found = m.proposals?.find((p) => p.id === proposalId);
        if (found) {
          target = found;
          break;
        }
      }
      if (!target) return;

      const finalPayload = editedPayload || target.payload;
      try {
        const resultMsg = await executeProposalAction(target.actionType, finalPayload);
        setMessages((prev) =>
          prev.map((m) => ({
            ...m,
            proposals: m.proposals?.map((p) =>
              p.id === proposalId
                ? { ...p, payload: finalPayload, status: 'executed', resultMessage: resultMsg }
                : p
            ),
          }))
        );
        logClientActivity(
          'approval',
          `Approved: ${target.title}`,
          resultMsg,
          'approved',
          target.employeeName
        );
        if (target.actionType !== 'voice_call') {
          speakReply(resultMsg);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Execution failed';
        setMessages((prev) =>
          prev.map((m) => ({
            ...m,
            proposals: m.proposals?.map((p) =>
              p.id === proposalId ? { ...p, status: 'failed', resultMessage: errMsg } : p
            ),
          }))
        );
        logClientActivity('approval', `Failed: ${target.title}`, errMsg, 'failed', target.employeeName);
      }
    },
    [messages, executeProposalAction, speakReply, logClientActivity]
  );

  const handleRejectProposal = useCallback(
    (proposalId: string) => {
      let target: ApprovalProposal | null = null;
      for (const m of messages) {
        const found = m.proposals?.find((p) => p.id === proposalId);
        if (found) {
          target = found;
          break;
        }
      }
      setMessages((prev) =>
        prev.map((m) => ({
          ...m,
          proposals: m.proposals?.map((p) =>
            p.id === proposalId
              ? { ...p, status: 'rejected', resultMessage: 'Cancelled by user.' }
              : p
          ),
        }))
      );
      if (target) {
        logClientActivity(
          'approval',
          `Declined Permission: ${target.title}`,
          'User rejected before execution',
          'rejected',
          target.employeeName
        );
      }
    },
    [messages, logClientActivity]
  );

  // Main Agent Command Handler
  const handleSendMessage = useCallback(
    async (rawText: string, overrideEmployeeId?: string) => {
      const text = rawText.trim();
      if (!text) return;
      setLastUserTranscript(text);

      const lower = text.toLowerCase();
      if (lower.includes('voice only mode') || lower.includes('voice-only mode') || lower === 'voice mode') {
        setVoiceOnlyMode(true);
        const reply = 'Switched to Voice-Only Mode. I am listening locally.';
        setLastAssistantReply(reply);
        speakReply(reply, true);
        return;
      }
      if (lower.includes('exit voice mode') || lower.includes('standard mode') || lower.includes('full ui')) {
        setVoiceOnlyMode(false);
        const reply = 'Returned to the full Azaris workstation.';
        setLastAssistantReply(reply);
        speakReply(reply);
        return;
      }

      // Immediate synchronous Fullscreen trigger to preserve browser user-gesture activation
      if (
        /^(please\s+)?(make\s+it\s+|go\s+|enter\s+|enable\s+)?full\s*screen(\s+please|\s+now)?$/i.test(text) ||
        /^(please\s+)?(exit|leave|close)\s+full\s*screen(\s+please|\s+now)?$/i.test(text)
      ) {
        const exiting = /\b(exit|leave|close)\b/i.test(text);
        const mode: 'on' | 'off' | 'video' = exiting ? 'off' : youtubePlayer ? 'video' : 'on';
        const reply = await applyFullscreenControl(mode);
        const emp = employees.find((e) => e.id === (overrideEmployeeId || activeEmployeeId)) || employees[0];
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setMessages((prev) => [
          ...prev,
          { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: now },
          {
            id: `a-${Date.now() + 1}`,
            role: 'assistant',
            employeeId: emp.id,
            employeeName: emp.name,
            employeeAvatar: emp.avatar,
            content: reply,
            timestamp: now,
          },
        ]);
        setLastAssistantReply(reply);
        speakReply(reply);
        return;
      }

      // Direct All-Day Overview, Invoice Check-Up Calls (Permission-First), and Meeting Scheduling Shortcuts
      const overviewMatch =
        /(?:overview|summary|report|recap|what.*did).*(?:all\s+day|today|daily|whole\s+day)/i.test(text) ||
        /^daily\s+(?:overview|summary|report)$/i.test(text);
      const invoiceCheckupMatch =
        /(?:call|check\s*ups?|follow\s*ups?).*(?:invoices?|unpaid|overdue|customers?)/i.test(text) ||
        /(?:invoices?|overdue).*(?:call|check\s*ups?)/i.test(text);
      const meetingRequestMatch =
        /(?:schedule|set|book|arrange)\s+(?:a\s+)?meeting/i.test(text);

      if (overviewMatch || invoiceCheckupMatch || meetingRequestMatch) {
        const emp = employees.find((e) => e.id === (overrideEmployeeId || activeEmployeeId)) || employees[0];
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: now }]);
        setIsThinking(true);
        try {
          if (overviewMatch) {
            const ovRes = await fetch(`/api/activity/overview?date=${encodeURIComponent(overviewDate)}`);
            const ov = (await ovRes.json()) as DailyActivityOverview;
            setDailyOverview(ov);
            const timelineLines = ov.entries
              .slice(0, 8)
              .map(
                (e) =>
                  `- [${new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${e.title}${
                    e.detail ? ` — ${e.detail}` : ''
                  }`
              )
              .join('\n');
            const reply = `${ov.narrative}${timelineLines ? `\n\nRecent Today:\n${timelineLines}` : ''}`;
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now() + 1}`,
                role: 'assistant',
                employeeId: emp.id,
                employeeName: emp.name,
                employeeAvatar: emp.avatar,
                content: reply,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              },
            ]);
            setLastAssistantReply(ov.narrative);
            speakReply(ov.narrative);
          } else if (invoiceCheckupMatch) {
            const unpaid = invoices.filter((i) => i.status !== 'Paid');
            if (unpaid.length === 0) {
              const reply = 'All QuickBooks invoices are currently marked Paid. No invoice check-up calls needed.';
              setMessages((prev) => [
                ...prev,
                {
                  id: `a-${Date.now() + 1}`,
                  role: 'assistant',
                  employeeId: emp.id,
                  employeeName: emp.name,
                  employeeAvatar: emp.avatar,
                  content: reply,
                  timestamp: now,
                },
              ]);
              speakReply(reply);
            } else {
              for (const inv of unpaid) {
                queuedCheckupInvoiceIdsRef.current.add(inv.id);
                proposeInvoiceCheckupCall(inv, false);
              }
              const reply = `I checked ${unpaid.length} unpaid invoice${unpaid.length > 1 ? 's' : ''} and queued permission Approval Cards below before calling. Each approved check-up automatically schedules the next follow-up call in 2 weeks.`;
              setLastAssistantReply(reply);
              speakReply(reply);
            }
          } else {
            const matchedInv =
              invoices.find(
                (i) =>
                  text.toLowerCase().includes(i.customerName.toLowerCase()) ||
                  text.toLowerCase().includes(i.invoiceNumber.toLowerCase())
              ) ||
              invoices.find((i) => i.status !== 'Paid') ||
              invoices[0];
            if (matchedInv) {
              proposeInvoiceMeeting(matchedInv);
              const reply = `Prepared a meeting Approval Card with ${matchedInv.customerName} (${matchedInv.invoiceNumber}) — approve below to confirm.`;
              setLastAssistantReply(reply);
              speakReply(reply);
            } else {
              queueManualProposal(
                'emp-maya',
                'schedule_meeting',
                'Approve Meeting Request',
                'Asking your permission before scheduling this meeting.',
                {
                  title: 'Customer Follow-Up Meeting',
                  contactName: 'Customer',
                  scheduledFor: new Date(Date.now() + 86400_000).toISOString().slice(0, 16),
                  durationMinutes: 30,
                  notes: text,
                },
                { switchToCommand: false }
              );
            }
          }
        } finally {
          setIsThinking(false);
        }
        return;
      }

      // Direct Chrome search, YouTube playback (+ optional fullscreen), and Gmail-to-QuickBooks bill scan shortcuts
      const ytDirectMatch =
        text.match(/^(?:please\s+)?play\s+(.+?)\s+(?:on|in)\s+youtube(?:\s+(?:and|in)\s+(?:make\s+it\s+)?full\s*screen)?$/i) ||
        text.match(/^(?:please\s+)?play\s+youtube\s+(?:video\s+)?(.+?)(?:\s+(?:and|in)\s+full\s*screen)?$/i);
      const chromeDirectMatch =
        text.match(/^(?:please\s+)?search\s+(?:on\s+|in\s+)?chrome\s+(?:for\s+)?(.+)$/i) ||
        text.match(/^(?:please\s+)?open\s+chrome\s+(?:and\s+)?search\s+(?:for\s+)?(.+)$/i);
      const emailQbDirectMatch =
        /(?:check|scan|sync|update)\s+(?:my\s+)?(?:e-?mails?|gmail|inbox).*(?:quickbooks|paid|bills?|invoices?)/i.test(text) ||
        /(?:update|sync)\s+quickbooks.*(?:e-?mails?|gmail|bills?|paid)/i.test(text);

      if (ytDirectMatch || chromeDirectMatch || emailQbDirectMatch) {
        const emp = employees.find((e) => e.id === (overrideEmployeeId || activeEmployeeId)) || employees[0];
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: now }]);
        setIsThinking(true);
        try {
          let reply = '';
          if (ytDirectMatch) {
            const wantsFs = /\bfull\s*screen\b/i.test(text);
            const rawQuery = ytDirectMatch[1].replace(/\s+and\s+make\s+it$/i, '').trim();
            const ytRes = await launchYouTubePlayback(rawQuery);
            reply = ytRes.message;
            if (wantsFs) {
              const fsReply = await applyFullscreenControl('video');
              reply = `${ytRes.message} ${fsReply}`;
            }
          } else if (chromeDirectMatch) {
            reply = await launchChromeSearch(chromeDirectMatch[1].trim());
          } else {
            if (!gmailToken) {
              reply = 'Gmail is not connected yet. Open the Gmail Inbox tab and click "Sign in with Google" so I can scan for paid bills.';
            } else {
              await runEmailQuickBooksSync(true);
              reply = 'Scanned Gmail for invoice payment confirmations and vendor bills, and refreshed your QuickBooks ledger.';
            }
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now() + 1}`,
              role: 'assistant',
              employeeId: emp.id,
              employeeName: emp.name,
              employeeAvatar: emp.avatar,
              content: reply,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
          setLastAssistantReply(reply);
          speakReply(reply);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Command execution failed.';
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              employeeId: emp.id,
              employeeName: emp.name,
              employeeAvatar: emp.avatar,
              content: msg,
              timestamp: now,
            },
          ]);
          setLastAssistantReply(msg);
        } finally {
          setIsThinking(false);
        }
        return;
      }

      const empId = overrideEmployeeId || activeEmployeeId;
      const emp = employees.find((e) => e.id === empId) || employees[0];
      const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: nowLabel,
      };
      const updatedHistory = [...messages, userMsg];
      setMessages(updatedHistory);
      setIsThinking(true);

      try {
        const mountedNames = mountedFiles.slice(0, 25).map((f) => f.path).join(', ');
        const systemInstruction = [
          emp.systemPrompt,
          `Persistent Memory:\n- ${emp.memory.join('\n- ')}`,
          `Active Context: Gmail connected=${Boolean(gmailToken)}, QuickBooks invoices=${invoices.length}, WhatsApp threads=${whatsappThreads.length}, YouTube active=${Boolean(youtubePlayer)}, Mounted laptop folder=${laptopDirHandle?.name || mountedFolderName || 'None (using workspace-files)'}${mountedNames ? ` [${mountedNames}]` : ''}.`,
          `Rules: Be concise and executive. ALWAYS use propose_voice_call or propose_schedule_meeting (Approval Cards) to ask permission before calling or setting a meeting—never claim a call or meeting was placed without approval. Use get_due_invoice_checkups for multi-week invoice follow-ups and get_daily_activity_overview when asked what Azaris did all day. Use reconcile_gmail_quickbooks to update QuickBooks from Gmail, and control_app_media for Chrome/YouTube/fullscreen.`,
        ].join('\n\n');

        const response = await runAgentTurn({
          config: llmConfig,
          systemInstruction,
          messages: updatedHistory.slice(-12).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          gmailToken,
        });

        if (response.browserSnapshot) {
          setBrowserSnapshot(response.browserSnapshot);
        }

        if ((response.toolTrace || []).some((t) => t.name === 'reconcile_gmail_quickbooks')) {
          refreshIntegrationsData().catch(() => {});
        }

        const builtProposals: ApprovalProposal[] = [];
        for (const p of response.proposals || []) {
          if ((p.actionType === 'ui_mode' || p.actionType === 'app_media') && p.payload.autoExecute) {
            await executeProposalAction(p.actionType as ApprovalProposal['actionType'], p.payload).catch(() => {});
            continue;
          }
          builtProposals.push({
            id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            employeeId: emp.id,
            employeeName: emp.name,
            employeeAvatar: emp.avatar,
            actionType: p.actionType as ApprovalProposal['actionType'],
            title: p.title,
            summary: p.summary,
            payload: p.payload,
            status: 'pending',
            createdAt: nowLabel,
          });
        }

        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          employeeId: emp.id,
          employeeName: emp.name,
          employeeAvatar: emp.avatar,
          content: response.text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          providerUsed: response.providerUsed,
          toolTrace: response.toolTrace,
          proposals: builtProposals,
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setLastAssistantReply(response.text);
        speakReply(response.text);
      } catch (err) {
        const errText = err instanceof Error ? err.message : 'Unable to reach LLM provider.';
        const errMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          role: 'assistant',
          employeeId: emp.id,
          employeeName: emp.name,
          employeeAvatar: emp.avatar,
          content: `Provider Error: ${errText}`,
          timestamp: nowLabel,
        };
        setMessages((prev) => [...prev, errMsg]);
        setLastAssistantReply(errText);
      } finally {
        setIsThinking(false);
      }
    },
    [
      activeEmployeeId,
      employees,
      messages,
      gmailToken,
      invoices,
      overviewDate,
      whatsappThreads.length,
      youtubePlayer,
      laptopDirHandle,
      mountedFolderName,
      mountedFiles,
      llmConfig,
      applyFullscreenControl,
      launchYouTubePlayback,
      launchChromeSearch,
      runEmailQuickBooksSync,
      refreshIntegrationsData,
      executeProposalAction,
      proposeInvoiceCheckupCall,
      proposeInvoiceMeeting,
      queueManualProposal,
      speakReply,
    ]
  );

  const sendRef = useRef(handleSendMessage);
  useEffect(() => {
    sendRef.current = handleSendMessage;
  }, [handleSendMessage]);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      listenerRef.current.stop();
      setIsListening(false);
      setAudioLevel(0);
      setInterimTranscript('');
      return;
    }

    setVoiceError(null);
    stopSpeaking();
    setIsSpeaking(false);
    setIsListening(true);

    await listenerRef.current.start({
      language: voiceSettings.language,
      continuous: voiceSettings.continuousListen || voiceOnlyMode,
      onInterim: (txt) => setInterimTranscript(txt),
      onFinal: (finalTxt) => {
        setInterimTranscript('');
        sendRef.current(finalTxt);
      },
      onAudioLevel: (lvl) => setAudioLevel(lvl),
      onError: (msg) => setVoiceError(msg),
      onStop: () => {
        setIsListening(false);
        setAudioLevel(0);
      },
    });
  }, [isListening, voiceSettings.language, voiceSettings.continuousListen, voiceOnlyMode]);

  const allPendingProposals = messages.flatMap((m) => (m.proposals || []).filter((p) => p.status === 'pending'));
  const pendingReceivables = invoices
    .filter((i) => i.status !== 'Paid')
    .reduce((acc, cur) => acc + cur.amount, 0);

  const providerBadge =
    llmConfig.provider === 'gemini'
      ? 'Gemini'
      : llmConfig.provider === 'ollama'
      ? `Ollama · ${llmConfig.model}`
      : llmConfig.provider === 'anthropic'
      ? 'Claude'
      : llmConfig.model;

  return (
    <div className="h-screen w-full flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      <a ref={globalTelRef} href="tel:" target="_top" className="hidden" aria-hidden="true">
        Dial
      </a>

      {voiceOnlyMode && (
        <VoiceOnlyOverlay
          employees={employees}
          activeEmployeeId={activeEmployeeId}
          onSelectEmployee={setActiveEmployeeId}
          isListening={isListening}
          isSpeaking={isSpeaking}
          isThinking={isThinking}
          audioLevel={audioLevel}
          interimTranscript={interimTranscript}
          lastUserTranscript={lastUserTranscript}
          lastAssistantReply={lastAssistantReply}
          providerLabel={providerBadge}
          pendingProposals={allPendingProposals}
          onToggleListen={toggleListening}
          onStopSpeaking={() => {
            stopSpeaking();
            setIsSpeaking(false);
          }}
          onExitVoiceOnly={() => setVoiceOnlyMode(false)}
          onApproveProposal={(id) => handleApproveProposal(id)}
          onRejectProposal={handleRejectProposal}
        />
      )}

      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        pendingApprovalCount={allPendingProposals.length}
        googleUser={googleUser}
        gmailConnected={Boolean(gmailToken)}
        onGoogleSignIn={handleGoogleSignIn}
        onGoogleSignOut={handleGoogleSignOut}
        isSigningIn={isSigningIn}
        providerLabel={providerBadge}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-400 dark:text-slate-500">Workstation</span>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <h1 className="font-display font-semibold text-slate-900 dark:text-slate-50 truncate">
              {TAB_TITLES[activeTab]}
            </h1>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle dark mode"
              className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setVoiceOnlyMode(true)}
              className="h-9 px-4 rounded-lg bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Mic className="w-3.5 h-3.5" />
              Voice-Only Mode
            </button>
          </div>
        </header>

        {voiceError && (
          <div className="mx-6 mt-4 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
            <span>{voiceError}</span>
            <button type="button" onClick={() => setVoiceError(null)} className="underline ml-4">
              Dismiss
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === 'command' && (
            <CommandCenter
              employees={employees}
              activeEmployeeId={activeEmployeeId}
              onSelectEmployee={setActiveEmployeeId}
              messages={messages}
              isThinking={isThinking}
              isListening={isListening}
              isSpeaking={isSpeaking}
              interimTranscript={interimTranscript}
              autoSpeak={voiceSettings.autoSpeak}
              onToggleAutoSpeak={() =>
                setVoiceSettings((vs) => ({ ...vs, autoSpeak: !vs.autoSpeak }))
              }
              onToggleListen={toggleListening}
              onSendMessage={(t) => handleSendMessage(t)}
              onApproveProposal={handleApproveProposal}
              onRejectProposal={handleRejectProposal}
              onQuickPrompt={(prompt, empId) => {
                if (empId) setActiveEmployeeId(empId);
                handleSendMessage(prompt, empId);
              }}
              pendingCount={allPendingProposals.length}
              unreadGmailCount={unreadGmailCount}
              overdueReceivables={pendingReceivables}
              whatsappCount={whatsappThreads.length}
              todayActionsCount={dailyOverview?.counts.total || 0}
              onOpenDailyOverview={() => setActiveTab('overview')}
            />
          )}

          {activeTab === 'overview' && (
            <DailyOverviewView
              overview={dailyOverview}
              selectedDate={overviewDate}
              onChangeDate={(dateKey) => setOverviewDate(dateKey)}
              onRefresh={refreshIntegrationsData}
              onSpeakSummary={(txt) => speakReply(txt, true)}
              meetings={meetings}
              onUpdateMeetingStatus={async (id, status) => {
                await fetch(`/api/meetings/${id}/status`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status }),
                });
                await refreshIntegrationsData();
              }}
              invoices={invoices}
              onProposeCheckupCall={(inv) => proposeInvoiceCheckupCall(inv, true)}
              onProposeMeeting={(inv) => proposeInvoiceMeeting(inv)}
            />
          )}

          {activeTab === 'employees' && (
            <EmployeesView
              employees={employees}
              onUpdateEmployee={(updated) =>
                setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
              }
              onAddEmployee={(created) => setEmployees((prev) => [...prev, created])}
              onChatWithEmployee={(id) => {
                setActiveEmployeeId(id);
                setActiveTab('command');
              }}
            />
          )}

          {activeTab === 'gmail' && (
            <GmailView
              gmailToken={gmailToken}
              onSignIn={handleGoogleSignIn}
              onSignInDirectGis={handleGoogleSignInDirectGis}
              onManualTokenSubmit={handleManualTokenSubmit}
              isSigningIn={isSigningIn}
              authError={authError}
              onProposeSendEmail={(to, subject, body) =>
                queueManualProposal(
                  'emp-maya',
                  'gmail_send',
                  `Send Email to ${to}`,
                  `Subject: ${subject}`,
                  { to, subject, body }
                )
              }
              onAskAgentSummarize={(subject, from, body) => {
                setActiveEmployeeId('emp-maya');
                setActiveTab('command');
                handleSendMessage(
                  `Draft a concise, professional reply to this email from ${from} with subject "${subject}". Content:\n${body.slice(
                    0,
                    2500
                  )}`,
                  'emp-maya'
                );
              }}
            />
          )}

          {activeTab === 'comms' && (
            <CommsView
              threads={whatsappThreads}
              calls={calls}
              credentials={credentials}
              onUpdateCredentials={setCredentials}
              onSendWhatsAppDirect={sendWhatsAppDirect}
              onProposeWhatsApp={(contactName, phone, message) =>
                queueManualProposal(
                  'emp-aria',
                  'whatsapp_send',
                  `Send WhatsApp to ${contactName}`,
                  message,
                  { contactName, phone, message }
                )
              }
              onInitiateCallDirect={initiateCallDirect}
              onRefreshThreads={refreshIntegrationsData}
              voiceSettings={voiceSettings}
              externalCallState={externalCallState}
              onClearExternalCall={() => setExternalCallState(null)}
            />
          )}

          {activeTab === 'quickbooks' && (
            <QuickBooksView
              invoices={invoices}
              expenses={expenses}
              credentials={credentials}
              onUpdateCredentials={setCredentials}
              onSyncQuickBooks={async () => {
                const res = await fetch('/api/quickbooks/sync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    realmId: credentials.quickbooksRealmId,
                    accessToken: credentials.quickbooksAccessToken,
                    sandbox: credentials.quickbooksSandbox,
                  }),
                });
                const d = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(d.error || 'QuickBooks sync failed');
                await refreshIntegrationsData();
              }}
              onProposeInvoice={(customerName, customerEmail, amount, description, customerPhone, followUpWeeks) =>
                queueManualProposal(
                  'emp-marcus',
                  'quickbooks_create_invoice',
                  `Create QuickBooks Invoice ($${amount.toLocaleString()})`,
                  `${customerName} — ${description}`,
                  { customerName, customerEmail, customerPhone, amount, description, followUpWeeks }
                )
              }
              onMarkPaid={async (id) => {
                await fetch(`/api/quickbooks/invoices/${id}/status`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'Paid' }),
                });
                await refreshIntegrationsData();
              }}
              onAddExpense={async (vendor, category, amount, status) => {
                const res = await fetch('/api/quickbooks/expenses', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ vendor, category, amount, status }),
                });
                if (!res.ok) throw new Error('Failed logging expense');
                await refreshIntegrationsData();
              }}
              onUpdateInvoiceFollowUp={async (id, updates) => {
                const res = await fetch(`/api/quickbooks/invoices/${id}/follow-up`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updates),
                });
                if (!res.ok) throw new Error('Failed updating invoice follow-up cadence');
                await refreshIntegrationsData();
              }}
              onProposeCheckupCall={(inv) => proposeInvoiceCheckupCall(inv, true)}
              onProposeMeeting={(inv) => proposeInvoiceMeeting(inv)}
              autoCheckupPrompts={autoCheckupPrompts}
              onToggleAutoCheckupPrompts={setAutoCheckupPrompts}
              onScanDueCheckups={() => scanDueInvoiceCheckups(false)}
              gmailConnected={Boolean(gmailToken)}
              autoReconcileEmail={autoReconcileEmail}
              onToggleAutoReconcile={setAutoReconcileEmail}
              autoApplyPaidInvoices={autoApplyPaidInvoices}
              onToggleAutoApplyPaid={setAutoApplyPaidInvoices}
              emailSyncIntervalSec={emailSyncIntervalSec}
              onChangeSyncInterval={setEmailSyncIntervalSec}
              isScanningEmailQb={isScanningEmailQb}
              lastEmailSync={lastEmailSync}
              onScanEmailsNow={() => runEmailQuickBooksSync(true)}
              onOpenGmailTab={() => setActiveTab('gmail')}
            />
          )}

          {activeTab === 'browser' && (
            <BrowserView
              snapshot={browserSnapshot}
              youtubePlayer={youtubePlayer}
              youtubeContainerRef={youtubeContainerRef}
              isFullscreen={isFullscreen}
              onNavigate={async (url) => {
                const res = await fetch('/api/browser/navigate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url }),
                });
                const d = (await res.json()) as { snapshot?: BrowserSnapshot; error?: string };
                if (!res.ok) throw new Error(d.error || 'Failed loading webpage');
                if (d.snapshot) setBrowserSnapshot(d.snapshot);
              }}
              onSearchChrome={async (query) => {
                await launchChromeSearch(query);
              }}
              onPlayYouTube={async (query) => {
                await launchYouTubePlayback(query);
              }}
              onCloseYouTube={() => setYoutubePlayer(null)}
              onToggleFullscreen={(mode) => {
                applyFullscreenControl(mode || 'toggle').catch(() => {});
              }}
              onAskAgentAnalyze={(snap) => {
                setActiveEmployeeId('emp-kael');
                setActiveTab('command');
                handleSendMessage(
                  `Summarize the key insights from ${snap.url} (${snap.title}):\n${snap.textContent.slice(0, 3000)}`,
                  'emp-kael'
                );
              }}
            />
          )}

          {activeTab === 'system' && (
            <SystemControlView
              darkMode={darkMode}
              onToggleDarkMode={setDarkMode}
              laptopDirHandle={laptopDirHandle}
              onMountLaptopDir={setLaptopDirHandle}
              mountedFiles={mountedFiles}
              mountedFolderName={mountedFolderName}
              onMountFilesList={(folderName, files) => {
                setMountedFolderName(folderName);
                setMountedFiles(files);
              }}
              onProposeWriteFile={(filePath, content) =>
                queueManualProposal(
                  'emp-kael',
                  'file_write',
                  `Write File: ${filePath}`,
                  `Save ${content.length} bytes to ${filePath}`,
                  { path: filePath, content }
                )
              }
              onProposeDeleteFile={(filePath) =>
                queueManualProposal(
                  'emp-kael',
                  'file_delete',
                  `Delete File: ${filePath}`,
                  `Remove ${filePath} from filesystem`,
                  { path: filePath }
                )
              }
            />
          )}

          {activeTab === 'models' && (
            <ModelsConfigView
              llmConfig={llmConfig}
              onUpdateLlmConfig={setLlmConfig}
              voiceSettings={voiceSettings}
              onUpdateVoiceSettings={setVoiceSettings}
            />
          )}
        </main>
      </div>
    </div>
  );
}
