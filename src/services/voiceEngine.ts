import type { VoiceSettings } from '../types';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isLocalSttSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor());
}

export function isLocalTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function getLocalVoices(): SpeechSynthesisVoice[] {
  if (!isLocalTtsSupported()) return [];
  return window.speechSynthesis.getVoices();
}

export function stopSpeaking(): void {
  if (isLocalTtsSupported()) {
    window.speechSynthesis.cancel();
  }
}

export function speakLocal(
  text: string,
  settings: VoiceSettings,
  callbacks?: { onStart?: () => void; onEnd?: () => void }
): void {
  if (!isLocalTtsSupported()) {
    callbacks?.onEnd?.();
    return;
  }
  const cleanText = text
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/[*_`#>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) {
    callbacks?.onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = settings.language || 'en-US';
  utterance.rate = settings.rate || 1.02;
  utterance.pitch = settings.pitch || 1.0;

  if (settings.voiceURI) {
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find((v) => v.voiceURI === settings.voiceURI);
    if (match) utterance.voice = match;
  }

  utterance.onstart = () => callbacks?.onStart?.();
  utterance.onend = () => callbacks?.onEnd?.();
  utterance.onerror = () => callbacks?.onEnd?.();

  window.speechSynthesis.speak(utterance);
}

export class LocalVoiceListener {
  private recognition: SpeechRecognitionLike | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private rafId: number | null = null;
  private shouldKeepListening = false;

  async start(options: {
    language: string;
    continuous: boolean;
    onInterim: (text: string) => void;
    onFinal: (text: string) => void;
    onAudioLevel: (level: number) => void;
    onError: (msg: string) => void;
    onStop: () => void;
  }): Promise<void> {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      options.onError('Local Speech Recognition is not supported in this browser. Try Chrome or Edge.');
      options.onStop();
      return;
    }

    this.shouldKeepListening = options.continuous;

    // Start real microphone acoustic meter via Web Audio API
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 128;
      source.connect(this.analyser);

      const freqData = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i];
        const avg = sum / freqData.length / 255;
        options.onAudioLevel(Math.min(1, avg * 2.2));
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    } catch {
      // SpeechRecognition can still attempt mic capture or surface permission error
      options.onAudioLevel(0);
    }

    const recognition = new Ctor();
    recognition.lang = options.language || 'en-US';
    recognition.continuous = options.continuous;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0]?.transcript || '';
        if (res.isFinal) {
          finalChunk += transcript + ' ';
        } else {
          interim += transcript;
        }
      }
      if (interim.trim()) options.onInterim(interim.trim());
      if (finalChunk.trim()) {
        // Barge-in: stop local TTS immediately when user finishes speaking
        stopSpeaking();
        options.onInterim('');
        options.onFinal(finalChunk.trim());
      }
    };

    recognition.onerror = (event) => {
      const errCode = event.error || 'unknown';
      if (errCode !== 'no-speech' && errCode !== 'aborted') {
        options.onError(`Microphone error: ${errCode}`);
      }
    };

    recognition.onend = () => {
      if (this.shouldKeepListening) {
        try {
          recognition.start();
          return;
        } catch {
          // Fall through to stop
        }
      }
      this.cleanupAudio();
      options.onStop();
    };

    this.recognition = recognition;
    recognition.start();
  }

  stop(): void {
    this.shouldKeepListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore already stopped
      }
      this.recognition = null;
    }
    this.cleanupAudio();
  }

  private cleanupAudio(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
  }
}
