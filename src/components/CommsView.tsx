import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  PhoneCall,
  PhoneOff,
  ExternalLink,
  Settings2,
  Volume2,
  QrCode,
  Unlink,
  RefreshCw,
} from 'lucide-react';
import type {
  CallRecord,
  IntegrationCredentials,
  VoiceSettings,
  WhatsAppQrState,
  WhatsAppThread,
} from '../types';
import { speakLocal, stopSpeaking } from '../services/voiceEngine';
import { triggerOsBridgeCall, triggerOsBridgeHangup } from '../services/localLaptopBridge';
import { buildWhatsAppMeUrl, validateAndFormatWhatsAppPhone } from '../utils/phoneValidation';

interface CommsViewProps {
  threads: WhatsAppThread[];
  calls: CallRecord[];
  credentials: IntegrationCredentials;
  onUpdateCredentials: (creds: IntegrationCredentials) => void;
  onSendWhatsAppDirect: (
    contactName: string,
    phone: string,
    message: string
  ) => Promise<{ delivery?: string; waLink?: string; popupOpened?: boolean; fallbackReason?: string }>;
  onProposeWhatsApp: (contactName: string, phone: string, message: string) => void;
  onInitiateCallDirect: (
    contactName: string,
    phone: string,
    script: string
  ) => Promise<{ recordId?: string; telUri?: string; status?: string; twilioSid?: string; twilioStatus?: string }>;
  onRefreshThreads: () => Promise<void>;
  voiceSettings: VoiceSettings;
  externalCallState?: {
    callId?: string;
    contactName: string;
    phone: string;
    script: string;
    mode: string;
    twilioSid?: string;
    twilioStatus?: string;
  } | null;
  onClearExternalCall?: () => void;
}

export const CommsView: React.FC<CommsViewProps> = ({
  threads,
  calls,
  credentials,
  onUpdateCredentials,
  onSendWhatsAppDirect,
  onProposeWhatsApp,
  onInitiateCallDirect,
  onRefreshThreads,
  voiceSettings,
  externalCallState,
  onClearExternalCall,
}) => {
  const [selectedThreadId, setSelectedThreadId] = useState(threads[0]?.id || '');
  const [waPhone, setWaPhone] = useState('');
  const [waName, setWaName] = useState('');
  const [waText, setWaText] = useState('');
  const [waFeedback, setWaFeedback] = useState<{ type: 'ok' | 'error'; text: string; waLink?: string } | null>(null);
  const [sendingWa, setSendingWa] = useState(false);

  // WhatsApp QR & Pairing Code State
  const [qrState, setQrState] = useState<WhatsAppQrState>({ status: 'disconnected' });
  const [showQrPanel, setShowQrPanel] = useState(false);
  const [pairPhone, setPairPhone] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

  // Call State
  const [dialPhone, setDialPhone] = useState('+14155550142');
  const [dialName, setDialName] = useState('Sarah Jenkins');
  const [dialScript, setDialScript] = useState(
    'Hi Sarah, this is Azaris calling on behalf of the founder to confirm our noon Q4 onboarding sync.'
  );
  const [activeCall, setActiveCall] = useState<{
    id?: string;
    contactName: string;
    phone: string;
    script: string;
    seconds: number;
    mode: string;
    answered: boolean;
    twilioSid?: string;
    twilioStatus?: string;
    isSpeakingScript?: boolean;
    scriptDelivered?: boolean;
    hangupCountdownSec?: number | null;
    silenceSeconds?: number;
  } | null>(null);
  const [listenOnPickup, setListenOnPickup] = useState(false);
  const [autoHangupAfterScript, setAutoHangupAfterScript] = useState(true);
  const [silenceTimeoutSec, setSilenceTimeoutSec] = useState<number>(15);
  const [callFeedback, setCallFeedback] = useState<string | null>(null);
  const [showCreds, setShowCreds] = useState(false);
  const telAnchorRef = useRef<HTMLAnchorElement>(null);
  const pickupRecRef = useRef<{ stop: () => void } | null>(null);
  const activeCallRef = useRef(activeCall);
  activeCallRef.current = activeCall;
  const hangingUpRef = useRef(false);
  const scriptHangupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAudioActivityRef = useRef<number>(Date.now());
  const autoHangupAfterScriptRef = useRef(autoHangupAfterScript);
  autoHangupAfterScriptRef.current = autoHangupAfterScript;

  const activeThread = threads.find((t) => t.id === selectedThreadId) || threads[0];
  const effectiveWaPhone = waPhone.trim() || activeThread?.phone || '';
  const livePhoneValidation = effectiveWaPhone ? validateAndFormatWhatsAppPhone(effectiveWaPhone) : null;

  const clearScriptHangupCountdown = () => {
    if (scriptHangupTimerRef.current) {
      clearInterval(scriptHangupTimerRef.current);
      scriptHangupTimerRef.current = null;
    }
    setActiveCall((prev) => (prev ? { ...prev, hangupCountdownSec: null } : null));
  };

  const hangUpCall = async (
    reason: 'script_delivered' | 'silence_timeout' | 'manual' | 'twilio_ended',
    detail?: string
  ) => {
    const snap = activeCallRef.current;
    if (!snap || hangingUpRef.current) return;
    hangingUpRef.current = true;

    if (scriptHangupTimerRef.current) {
      clearInterval(scriptHangupTimerRef.current);
      scriptHangupTimerRef.current = null;
    }
    stopSpeaking();
    if (pickupRecRef.current) {
      try {
        pickupRecRef.current.stop();
      } catch {}
      pickupRecRef.current = null;
    }

    setActiveCall(null);
    onClearExternalCall?.();

    const messageByReason =
      reason === 'script_delivered'
        ? `Auto-hung up call with ${snap.contactName}: script delivered successfully.`
        : reason === 'silence_timeout'
        ? `Auto-hung up call with ${snap.contactName} after ${silenceTimeoutSec}s of continuous silence.`
        : reason === 'twilio_ended'
        ? `Twilio call with ${snap.contactName} ended (${detail || 'completed'}).`
        : `Call with ${snap.contactName} ended (${snap.seconds}s).`;
    setCallFeedback(messageByReason);

    try {
      if (!snap.twilioSid) {
        await triggerOsBridgeHangup().catch(() => ({ ok: false }));
      }
      await fetch('/api/calls/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: snap.id,
          twilioSid: snap.twilioSid,
          accountSid: credentials.twilioAccountSid || undefined,
          authToken: credentials.twilioAuthToken || undefined,
          durationSeconds: snap.seconds,
          reason,
        }),
      });
      await onRefreshThreads();
    } catch {
      // Ignore transient refresh/hangup errors after local cleanup
    } finally {
      hangingUpRef.current = false;
    }
  };

  const hangUpCallRef = useRef(hangUpCall);
  hangUpCallRef.current = hangUpCall;

  const speakCallScript = (scriptText: string) => {
    if (!scriptText.trim()) return;
    clearScriptHangupCountdown();
    lastAudioActivityRef.current = Date.now();
    setActiveCall((prev) =>
      prev
        ? {
            ...prev,
            answered: true,
            isSpeakingScript: true,
            scriptDelivered: false,
            hangupCountdownSec: null,
            silenceSeconds: 0,
            mode: 'Connected — Speaking Script',
          }
        : null
    );

    speakLocal(scriptText, voiceSettings, {
      onStart: () => {
        lastAudioActivityRef.current = Date.now();
        setActiveCall((prev) =>
          prev ? { ...prev, isSpeakingScript: true, silenceSeconds: 0 } : null
        );
      },
      onEnd: () => {
        lastAudioActivityRef.current = Date.now();
        const shouldAutoHangup = autoHangupAfterScriptRef.current;
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                isSpeakingScript: false,
                scriptDelivered: true,
                silenceSeconds: 0,
                hangupCountdownSec: shouldAutoHangup ? 2 : null,
                mode: shouldAutoHangup
                  ? 'Script Delivered — Auto-Hanging Up'
                  : 'Script Delivered (Call Open)',
              }
            : null
        );
        if (shouldAutoHangup && activeCallRef.current) {
          let remaining = 2;
          scriptHangupTimerRef.current = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
              if (scriptHangupTimerRef.current) {
                clearInterval(scriptHangupTimerRef.current);
                scriptHangupTimerRef.current = null;
              }
              hangUpCallRef.current('script_delivered');
            } else {
              setActiveCall((prev) =>
                prev ? { ...prev, hangupCountdownSec: remaining } : null
              );
            }
          }, 1000);
        }
      },
    });
  };

  // Poll WhatsApp QR session status
  useEffect(() => {
    let active = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/whatsapp/qr/status');
        if (res.ok && active) {
          const data = (await res.json()) as WhatsAppQrState;
          setQrState(data);
        }
      } catch {
        // Ignore transient network issue
      }
    };
    fetchStatus();
    const interval = setInterval(() => {
      if (showQrPanel || qrState.status === 'connecting' || qrState.status === 'qr_ready') {
        fetchStatus();
      }
    }, 1800);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [showQrPanel, qrState.status]);

  // Sync calls initiated via Command Center approval cards into active call banner
  useEffect(() => {
    if (!externalCallState) return;
    hangingUpRef.current = false;
    lastAudioActivityRef.current = Date.now();
    setActiveCall({
      id: externalCallState.callId,
      contactName: externalCallState.contactName,
      phone: externalCallState.phone,
      script: externalCallState.script,
      seconds: 0,
      mode: externalCallState.mode,
      answered: false,
      twilioSid: externalCallState.twilioSid,
      twilioStatus: externalCallState.twilioStatus,
      isSpeakingScript: false,
      scriptDelivered: false,
      hangupCountdownSec: null,
      silenceSeconds: 0,
    });
  }, [externalCallState]);

  const hasActiveCall = Boolean(activeCall);
  const activeCallWaitingPickup = Boolean(activeCall && !activeCall.answered && !activeCall.twilioSid);
  const activeCallScriptRef = useRef('');
  activeCallScriptRef.current = activeCall?.script || '';

  // Active Softphone Call Timer
  useEffect(() => {
    if (!hasActiveCall) return;
    const timer = setInterval(() => {
      setActiveCall((prev) => (prev ? { ...prev, seconds: prev.seconds + 1 } : null));
    }, 1000);
    return () => clearInterval(timer);
  }, [hasActiveCall]);

  // Continuous Silence Monitor: detects sustained silence via mic audio level + inactivity fallback and auto-hangs up
  useEffect(() => {
    if (!hasActiveCall || silenceTimeoutSec <= 0) return;
    lastAudioActivityRef.current = Date.now();

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let rafId: number | null = null;

    const startAudioMonitor = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);

        const sample = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          let sumSq = 0;
          for (let i = 0; i < data.length; i++) {
            const norm = (data[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / data.length);
          if (rms > 0.025) {
            lastAudioActivityRef.current = Date.now();
          }
          rafId = requestAnimationFrame(sample);
        };
        rafId = requestAnimationFrame(sample);
      } catch {
        // Microphone unavailable or blocked in iframe; fallback timer still tracks inactivity
      }
    };

    startAudioMonitor();

    const checker = setInterval(() => {
      const curr = activeCallRef.current;
      if (!curr || hangingUpRef.current) return;
      if (curr.isSpeakingScript || curr.hangupCountdownSec != null) {
        lastAudioActivityRef.current = Date.now();
        setActiveCall((prev) => (prev && prev.silenceSeconds ? { ...prev, silenceSeconds: 0 } : prev));
        return;
      }
      const silentSec = Math.floor((Date.now() - lastAudioActivityRef.current) / 1000);
      setActiveCall((prev) =>
        prev && prev.silenceSeconds !== silentSec ? { ...prev, silenceSeconds: silentSec } : prev
      );
      if (silentSec >= silenceTimeoutSec) {
        hangUpCallRef.current('silence_timeout');
      }
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(checker);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
    };
  }, [hasActiveCall, silenceTimeoutSec]);

  // Poll Twilio call state (queued -> ringing -> in-progress -> completed)
  useEffect(() => {
    const sid = activeCall?.twilioSid;
    if (!sid || !credentials.twilioAccountSid || !credentials.twilioAuthToken) return;
    const terminal = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled']);
    if (activeCall?.twilioStatus && terminal.has(activeCall.twilioStatus)) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/calls/twilio/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sid,
            accountSid: credentials.twilioAccountSid,
            authToken: credentials.twilioAuthToken,
          }),
        });
        if (!res.ok) return;
        const d = (await res.json()) as { status?: string };
        if (d.status) {
          if (terminal.has(d.status)) {
            hangUpCallRef.current('twilio_ended', d.status);
            return;
          }
          setActiveCall((prev) =>
            prev
              ? {
                  ...prev,
                  twilioStatus: d.status,
                  answered: d.status === 'in-progress' || prev.answered,
                  mode:
                    d.status === 'in-progress'
                      ? 'Twilio Connected (Speaking Script)'
                      : d.status === 'ringing'
                      ? 'Twilio Ringing (Waiting for Pickup)'
                      : `Twilio (${d.status})`,
                }
              : null
          );
        }
      } catch {
        // Ignore polling hiccup
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeCall?.twilioSid, activeCall?.twilioStatus, credentials.twilioAccountSid, credentials.twilioAuthToken]);

  // Optional local speakerphone pickup detector: waits silently until the recipient speaks ("Hello?") before speaking script
  useEffect(() => {
    if (!activeCallWaitingPickup || !listenOnPickup) {
      if (pickupRecRef.current) {
        try {
          pickupRecRef.current.stop();
        } catch {}
        pickupRecRef.current = null;
      }
      return;
    }

    const w = window as unknown as {
      SpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: (ev: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: (ev: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void;
        start: () => void;
        stop: () => void;
      };
    };
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Rec) return;

    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = voiceSettings.language || 'en-US';
    rec.onresult = (ev) => {
      const latest = ev.results[ev.results.length - 1]?.[0]?.transcript?.trim();
      if (!latest) return;
      lastAudioActivityRef.current = Date.now();
      try {
        rec.stop();
      } catch {}
      setActiveCall((prev) =>
        prev
          ? { ...prev, answered: true, mode: 'Pickup Detected — Speaking Script' }
          : null
      );
      if (activeCallScriptRef.current) {
        speakCallScript(activeCallScriptRef.current);
      }
    };
    try {
      rec.start();
      pickupRecRef.current = rec;
    } catch {
      // Ignore microphone busy error
    }
    return () => {
      try {
        rec.stop();
      } catch {}
      pickupRecRef.current = null;
    };
  }, [activeCallWaitingPickup, listenOnPickup, voiceSettings]);

  const handleStartQr = async () => {
    setShowQrPanel(true);
    setPairingError(null);
    setQrState({ status: 'connecting' });
    const res = await fetch('/api/whatsapp/qr/start', { method: 'POST' });
    if (res.ok) {
      setQrState((await res.json()) as WhatsAppQrState);
    }
  };

  const handleResetQr = async () => {
    setShowQrPanel(true);
    setPairingError(null);
    setQrState({ status: 'connecting' });
    const res = await fetch('/api/whatsapp/qr/reset', { method: 'POST' });
    if (res.ok) {
      setQrState((await res.json()) as WhatsAppQrState);
    }
  };

  const handleRequestPairingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairingError(null);
    const check = validateAndFormatWhatsAppPhone(pairPhone);
    if (!check.valid) {
      setPairingError(check.error);
      return;
    }
    setPairingBusy(true);
    try {
      const res = await fetch('/api/whatsapp/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: check.e164 }),
      });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!res.ok) {
        setPairingError(data.error || 'Failed generating pairing code.');
        return;
      }
      setQrState((prev) => ({ ...prev, pairingCode: data.code || null }));
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : 'Failed generating pairing code.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleDisconnectQr = async () => {
    const res = await fetch('/api/whatsapp/qr/disconnect', { method: 'POST' });
    if (res.ok) {
      setQrState((await res.json()) as WhatsAppQrState);
    }
  };

  const handleOpenWhatsAppFallback = () => {
    const linkResult = buildWhatsAppMeUrl(effectiveWaPhone, waText);
    if (!linkResult.valid) {
      setWaFeedback({ type: 'error', text: linkResult.error });
      return;
    }
    const opened = window.open(linkResult.url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      setWaFeedback({
        type: 'error',
        text: 'Browser popup blocked. Use the direct WhatsApp link below to open your chat.',
        waLink: linkResult.url,
      });
    } else {
      setWaFeedback({
        type: 'ok',
        text: `Opened WhatsApp Web for ${linkResult.e164}.`,
        waLink: linkResult.url,
      });
    }
  };

  const handleSendDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    setWaFeedback(null);

    const phoneCheck = validateAndFormatWhatsAppPhone(effectiveWaPhone);
    if (!phoneCheck.valid) {
      setWaFeedback({ type: 'error', text: phoneCheck.error });
      return;
    }

    if (!waText.trim()) {
      setWaFeedback({ type: 'error', text: 'Enter a message before sending.' });
      return;
    }

    const name = waName.trim() || activeThread?.contactName || phoneCheck.e164;

    setSendingWa(true);
    try {
      const result = await onSendWhatsAppDirect(name, phoneCheck.e164, waText.trim());
      setWaText('');
      if (result.delivery === 'sent') {
        setWaFeedback({
          type: 'ok',
          text: `Delivered directly via linked WhatsApp (${qrState.phoneNumber || 'Active Session'}).`,
        });
      } else if (result.delivery === 'cloud-api') {
        setWaFeedback({ type: 'ok', text: 'Delivered via Meta WhatsApp Cloud API.' });
      } else {
        setWaFeedback({
          type: result.popupOpened ? 'ok' : 'error',
          text: result.popupOpened
            ? `Automated delivery unavailable — opened pre-filled chat in WhatsApp (${phoneCheck.e164}).`
            : 'Automated delivery unavailable and popup was blocked. Click "Open Pre-filled WhatsApp" below.',
          waLink: result.waLink,
        });
      }
    } catch (err) {
      setWaFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed sending WhatsApp message',
      });
    } finally {
      setSendingWa(false);
    }
  };

  const handleCallNow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialPhone.trim()) return;
    setCallFeedback(null);
    stopSpeaking();

    try {
      const res = await onInitiateCallDirect(
        dialName.trim() || dialPhone.trim(),
        dialPhone.trim(),
        dialScript.trim()
      );

      // Trigger Local OS Bridge dialer if running on laptop (when not using Twilio)
      const bridgeRes =
        res.status === 'twilio-dispatched' ? { ok: false } : await triggerOsBridgeCall(dialPhone.trim());

      // Trigger OS tel: URI anchor as well if not using Twilio
      if (res.status !== 'twilio-dispatched' && !bridgeRes.ok && telAnchorRef.current) {
        telAnchorRef.current.href = `tel:${dialPhone.replace(/[^\d+]/g, '')}`;
        telAnchorRef.current.click();
      }

      hangingUpRef.current = false;
      lastAudioActivityRef.current = Date.now();
      setActiveCall({
        id: res.recordId,
        contactName: dialName.trim() || dialPhone.trim(),
        phone: dialPhone.trim(),
        script: dialScript.trim(),
        seconds: 0,
        answered: false,
        twilioSid: res.twilioSid,
        twilioStatus: res.twilioStatus,
        isSpeakingScript: false,
        scriptDelivered: false,
        hangupCountdownSec: null,
        silenceSeconds: 0,
        mode:
          res.status === 'twilio-dispatched'
            ? 'Twilio Ringing (Waiting for Pickup)'
            : bridgeRes.ok
            ? 'OS Dialer Launched (Waiting for Pickup)'
            : 'Phone App Opened (Waiting for Pickup)',
      });

      setCallFeedback(
        res.status === 'twilio-dispatched'
          ? `Twilio is calling ${dialPhone} and will speak only after the recipient answers (auto-hangup enabled).`
          : bridgeRes.ok
          ? `Dialed ${dialPhone} via Laptop Bridge. Once they answer, click "Answered — Speak Script" (it will NOT speak early).`
          : `Opened system dialer for ${dialPhone}. Press Call in your phone app, then click "Answered — Speak Script" when they pick up.`
      );
    } catch (err) {
      setCallFeedback(err instanceof Error ? err.message : 'Failed placing call');
    }
  };

  const handleMarkCallAnswered = () => {
    if (!activeCall) return;
    if (activeCall.script) {
      speakCallScript(activeCall.script);
    } else {
      setActiveCall((prev) =>
        prev ? { ...prev, answered: true, mode: 'Connected' } : null
      );
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="space-y-6">
      <a ref={telAnchorRef} href="tel:" target="_top" className="hidden" aria-hidden="true">
        Dial
      </a>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-50">
            WhatsApp & Voice Call Center
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link your real WhatsApp account via QR code, or connect Meta Cloud API and Twilio Voice.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {qrState.status === 'connected' ? (
            <button
              type="button"
              onClick={handleDisconnectQr}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium whitespace-nowrap"
            >
              <Unlink className="w-3.5 h-3.5" />
              WhatsApp Linked ({qrState.phoneNumber})
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartQr}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium whitespace-nowrap"
            >
              <QrCode className="w-3.5 h-3.5" />
              Link WhatsApp via QR
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCreds((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium whitespace-nowrap shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {showCreds ? 'Hide Cloud APIs' : 'Twilio / Meta Keys'}
          </button>
        </div>
      </div>

      {/* Live WhatsApp QR & Pairing Code Panel */}
      {showQrPanel && qrState.status !== 'connected' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col lg:flex-row items-start lg:items-center gap-6">
          <div className="w-48 h-48 rounded-xl border border-slate-200 dark:border-slate-700 bg-white flex items-center justify-center shrink-0 overflow-hidden">
            {qrState.qrDataUrl ? (
              <img src={qrState.qrDataUrl} alt="WhatsApp Link QR Code" className="w-full h-full object-contain p-2" />
            ) : (
              <div className="text-xs text-slate-600 text-center px-4 space-y-1">
                <div className="font-medium">
                  {qrState.status === 'connecting'
                    ? 'Connecting to WhatsApp...'
                    : qrState.status === 'error'
                    ? 'Connection Interrupted'
                    : 'Preparing QR'}
                </div>
                {qrState.error && <div className="text-[11px] text-rose-600">{qrState.error}</div>}
              </div>
            )}
          </div>
          <div className="space-y-3 flex-1 w-full">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
                Link Your Real WhatsApp Account
              </h3>
              <ol className="list-decimal pl-4 text-xs text-slate-600 dark:text-slate-300 space-y-1 mt-1.5">
                <li>Open <strong>WhatsApp</strong> on your phone.</li>
                <li>Go to <strong>Settings → Linked Devices → Link a Device</strong>.</li>
                <li>Point your camera at the QR code (or link with phone number below).</li>
              </ol>
            </div>

            {qrState.pairingCode && (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-3.5 py-2.5 flex items-center justify-between gap-4">
                <span className="text-xs text-emerald-800 dark:text-emerald-200">
                  Enter this code in WhatsApp → Link with phone number:
                </span>
                <span className="font-mono text-base font-bold tracking-widest text-emerald-700 dark:text-emerald-300">
                  {qrState.pairingCode}
                </span>
              </div>
            )}

            <form onSubmit={handleRequestPairingCode} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={pairPhone}
                onChange={(e) => setPairPhone(e.target.value)}
                placeholder="Or pair by phone: +14155550142"
                className="h-8 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-mono"
              />
              <button
                type="submit"
                disabled={pairingBusy}
                className="h-8 px-3 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium disabled:opacity-50"
              >
                {pairingBusy ? 'Generating...' : 'Get 8-Digit Code'}
              </button>
              {pairingError && <span className="text-[11px] text-rose-600">{pairingError}</span>}
            </form>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleStartQr}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh QR
              </button>
              <button
                type="button"
                onClick={handleResetQr}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs font-medium"
              >
                Reset Auth & New QR
              </button>
              <button
                type="button"
                onClick={() => setShowQrPanel(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreds && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Meta WhatsApp Cloud API (Optional)
            </h3>
            <input
              type="text"
              value={credentials.whatsappPhoneNumberId}
              onChange={(e) =>
                onUpdateCredentials({ ...credentials, whatsappPhoneNumberId: e.target.value })
              }
              placeholder="WhatsApp Phone Number ID"
              className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
            />
            <input
              type="password"
              value={credentials.whatsappAccessToken}
              onChange={(e) =>
                onUpdateCredentials({ ...credentials, whatsappAccessToken: e.target.value })
              }
              placeholder="Meta Permanent Access Token"
              className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Twilio Voice API (Real Outbound Phone Calls)
            </h3>
            <input
              type="text"
              value={credentials.twilioAccountSid}
              onChange={(e) => onUpdateCredentials({ ...credentials, twilioAccountSid: e.target.value })}
              placeholder="Twilio Account SID"
              className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="password"
                value={credentials.twilioAuthToken}
                onChange={(e) => onUpdateCredentials({ ...credentials, twilioAuthToken: e.target.value })}
                placeholder="Twilio Auth Token"
                className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
              />
              <input
                type="text"
                value={credentials.twilioFromNumber}
                onChange={(e) => onUpdateCredentials({ ...credentials, twilioFromNumber: e.target.value })}
                placeholder="From Number (+1...)"
                className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
              />
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        {/* WhatsApp Panel */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">WhatsApp Threads</span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                {qrState.status === 'connected'
                  ? 'WhatsApp Web Connected'
                  : credentials.whatsappPhoneNumberId
                  ? 'Cloud API Live'
                  : 'Link QR or use wa.me'}
              </span>
              <button
                type="button"
                onClick={onRefreshThreads}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Refresh threads"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-12 flex-1 min-h-[380px]">
            <div className="sm:col-span-5 border-r border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              {threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedThreadId(t.id);
                    setWaPhone('');
                    setWaName('');
                  }}
                  className={`w-full text-left p-3.5 transition-colors ${
                    activeThread?.id === t.id ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{t.contactName}</span>
                    <span className="text-slate-400 tabular-nums">{t.lastTimestamp}</span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">{t.phone}</div>
                  <div className="text-xs text-slate-500 truncate mt-1">
                    {t.messages[t.messages.length - 1]?.text}
                  </div>
                </button>
              ))}
            </div>

            <div className="sm:col-span-7 flex flex-col justify-between p-4 space-y-4">
              <div className="space-y-3 overflow-y-auto max-h-[260px]">
                {activeThread?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.direction === 'outbound' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                        m.direction === 'outbound'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {m.text}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 tabular-nums">
                      {m.timestamp} · {m.delivery}
                    </span>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendDirect} className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                {waFeedback && (
                  <div
                    className={`text-[11px] font-medium flex flex-wrap items-center gap-2 ${
                      waFeedback.type === 'error'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    <span>{waFeedback.text}</span>
                    {waFeedback.waLink && (
                      <a
                        href={waFeedback.waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open Pre-filled WhatsApp
                      </a>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={waName}
                    onChange={(e) => setWaName(e.target.value)}
                    placeholder={activeThread ? `To: ${activeThread.contactName}` : 'Contact name'}
                    className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs"
                  />
                  <input
                    type="text"
                    value={waPhone}
                    onChange={(e) => {
                      setWaPhone(e.target.value);
                      setWaFeedback(null);
                    }}
                    placeholder={activeThread ? activeThread.phone : '+14155550100'}
                    className={`h-8 rounded-lg border bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-mono ${
                      waPhone.trim() && livePhoneValidation && !livePhoneValidation.valid
                        ? 'border-rose-400 dark:border-rose-700'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  />
                </div>
                {waPhone.trim() && livePhoneValidation && !livePhoneValidation.valid && (
                  <div className="text-[11px] text-rose-600 dark:text-rose-400">{livePhoneValidation.error}</div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={waText}
                    onChange={(e) => setWaText(e.target.value)}
                    placeholder="Type WhatsApp message..."
                    className="flex-1 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={sendingWa}
                    className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sendingWa ? 'Sending...' : 'Send'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const check = validateAndFormatWhatsAppPhone(effectiveWaPhone);
                      if (!check.valid) {
                        setWaFeedback({ type: 'error', text: check.error });
                        return;
                      }
                      if (!waText.trim()) {
                        setWaFeedback({ type: 'error', text: 'Enter a message before queuing.' });
                        return;
                      }
                      const name = waName.trim() || activeThread?.contactName || check.e164;
                      onProposeWhatsApp(name, check.e164, waText.trim());
                      setWaText('');
                    }}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium shrink-0"
                  >
                    Queue AI
                  </button>
                </div>
                {effectiveWaPhone && (
                  <button
                    type="button"
                    onClick={handleOpenWhatsAppFallback}
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open in WhatsApp Web / Desktop (wa.me fallback)
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>

        {/* Outbound Voice Call Softphone */}
        <div className="lg:col-span-5 space-y-4">
          {activeCall && (
            <div className="rounded-xl border border-emerald-500/40 bg-slate-900 text-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-emerald-400 font-medium">{activeCall.mode}</div>
                  <div className="text-sm font-semibold mt-0.5">
                    {activeCall.contactName} ({activeCall.phone})
                  </div>
                  <div className="font-mono text-xs text-slate-300 tabular-nums mt-0.5 flex flex-wrap items-center gap-2">
                    <span>{formatDuration(activeCall.seconds)}</span>
                    {activeCall.twilioStatus ? <span>· Twilio: {activeCall.twilioStatus}</span> : null}
                    {silenceTimeoutSec > 0 && !activeCall.isSpeakingScript && activeCall.hangupCountdownSec == null && (
                      <span className="text-slate-400">
                        · Silence: {activeCall.silenceSeconds || 0}s / {silenceTimeoutSec}s
                      </span>
                    )}
                    {activeCall.scriptDelivered && (
                      <span className="text-emerald-300">· Script Confirmed</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => hangUpCall('manual')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shrink-0"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  Hang Up
                </button>
              </div>

              {activeCall.hangupCountdownSec != null && (
                <div className="rounded-lg bg-emerald-950/60 border border-emerald-700/60 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <span className="text-emerald-200">
                    Script delivered — hanging up automatically in {activeCall.hangupCountdownSec}s...
                  </span>
                  <button
                    type="button"
                    onClick={clearScriptHangupCountdown}
                    className="px-2 py-1 rounded border border-emerald-500/50 text-emerald-200 hover:bg-emerald-900/50 text-[11px] font-medium"
                  >
                    Keep Open
                  </button>
                </div>
              )}

              {!activeCall.twilioSid && (
                <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleMarkCallAnswered}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    {activeCall.answered ? 'Replay Script' : 'Answered — Speak Script'}
                  </button>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={listenOnPickup}
                      onChange={(e) => setListenOnPickup(e.target.checked)}
                    />
                    Auto-speak when recipient says &ldquo;Hello&rdquo;
                  </label>
                </div>
              )}
            </div>
          )}

          <form
            onSubmit={handleCallNow}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Outbound Voice Dialer</h3>
              <span className="text-xs text-slate-500">
                {credentials.twilioAccountSid ? 'Twilio Auto-Answer Ready' : 'OS Dialer (Wait for Pickup)'}
              </span>
            </div>

            {!credentials.twilioAccountSid && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Without Twilio keys, Windows Phone Link / macOS FaceTime opens with the number dialed—confirm Call in the phone app if prompted, then click <strong>Answered — Speak Script</strong> when they pick up. Add <strong>Twilio</strong> keys above for fully automated calling &amp; pickup detection.
              </p>
            )}

            {callFeedback && (
              <div className="text-xs text-blue-600 dark:text-blue-400 font-medium">{callFeedback}</div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                value={dialName}
                onChange={(e) => setDialName(e.target.value)}
                placeholder="Contact Name"
                className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs"
              />
              <input
                type="text"
                required
                value={dialPhone}
                onChange={(e) => setDialPhone(e.target.value)}
                placeholder="+14155550142"
                className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Spoken Agent Script (plays after pickup)</label>
              <textarea
                rows={3}
                value={dialScript}
                onChange={(e) => setDialScript(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs"
              />
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <label className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoHangupAfterScript}
                  onChange={(e) => setAutoHangupAfterScript(e.target.checked)}
                />
                Auto-hangup after script delivered
              </label>
              <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span>Silence timeout:</span>
                <select
                  value={silenceTimeoutSec}
                  onChange={(e) => setSilenceTimeoutSec(Number(e.target.value))}
                  className="h-7 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 text-xs"
                >
                  <option value={0}>Off</option>
                  <option value={10}>10s</option>
                  <option value={15}>15s</option>
                  <option value={20}>20s</option>
                  <option value={30}>30s</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium whitespace-nowrap"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                Call Now
              </button>
              <button
                type="button"
                onClick={() => speakLocal(dialScript, voiceSettings)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium whitespace-nowrap"
              >
                <Volume2 className="w-3.5 h-3.5" />
                Preview Voice
              </button>
              <a
                href={`tel:${dialPhone.replace(/[^\d+]/g, '')}`}
                target="_top"
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline px-2"
              >
                System Dialer
              </a>
            </div>
          </form>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recent Call Log</h4>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[220px] overflow-y-auto">
              {calls.map((c) => (
                <div key={c.id} className="py-2.5 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-900 dark:text-slate-100">{c.contactName}</span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {c.timestamp} · {c.durationSeconds}s
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{c.scriptOrSummary}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
