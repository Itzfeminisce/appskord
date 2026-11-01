import { useCallback, useEffect, useRef, useState } from 'react';
import { HOSTS, requestHost, type HostAccess } from '../hostAccess';
import { getKey, getSettings, onSettingsChanged } from '../settings';
import type { Provider, Settings } from '../types';
import { chromeSiteSettingsUrl, joinResults, LEVEL_BARS, MIC_CHANNEL, micProblem, nextStep, SOUND_LEVEL, type MicMessage } from './listen';
import { createLocalRecognition, installLocal, localAvailability, type Recognition } from './local';
import { chooseVoicePath, type LocalAvailability, type SpeechProvider, type VoicePath } from './path';
import { transcribe, VoiceError } from './transcribe';

export type VoiceCard = 'voice-transcribing' | 'voice-transcribe-failed' | 'voice-mic-access' | 'voice-mic-blocked' | 'voice-no-mic' | 'voice-not-heard' | 'voice-getting-ready' | 'voice-unavailable';
export type VoiceUi =
  | { kind: 'idle' }
  | { kind: 'card'; card: VoiceCard; provider?: Provider }
  | { kind: 'listening'; settled: string; interim: string; ms: number; levels: number[] };


const QUIET = Array.from({ length: LEVEL_BARS }, () => 0);
type MicState = PermissionState | 'unknown';

/** Chrome's language, the default when Settings "Language" has not been chosen. */
export const voiceLanguage = (chosen?: string) => chosen || globalThis.navigator?.language || 'en-US';
/** "{language}": the language's own display name, e.g. "English (United States)". */
export function languageName(lang = voiceLanguage()): string {
  try { return new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang; } catch { return lang; }
}

/** Settings "Language" choices, code and name; the current one is always listed. */
export const VOICE_LANGUAGES = ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'it-IT', 'nl-NL', 'ja-JP', 'ko-KR', 'hi-IN', 'ar-SA'];
export function voiceLanguageOptions(current: string): [string, string][] {
  const codes = VOICE_LANGUAGES.includes(current) ? VOICE_LANGUAGES : [current, ...VOICE_LANGUAGES];
  return codes.map((c) => [c, c === 'en-US' ? 'English (US)' : languageName(c)]);
}

/** The path the footer and Settings line describe; recomputed when settings, keys or Chrome's answer change. */
export function useVoicePath(): { path: VoicePath; provider: Provider; enabled: boolean; lang: string } {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [local, setLocal] = useState<LocalAvailability>('unavailable');
  useEffect(() => {
    void getSettings().then(setSettings).catch(() => undefined);
    return onSettingsChanged(setSettings);
  }, []);
  const lang = voiceLanguage(settings?.voiceLang);
  useEffect(() => { void localAvailability(lang).then(setLocal); }, [lang]);
  const provider = settings?.provider ?? 'groq';
  useEffect(() => {
    const check = () => { void getKey(provider).then((k) => setHasKey(!!k)).catch(() => setHasKey(false)); };
    check();
    const onChange = (_c: unknown, area: string) => { if (area === 'session') check(); };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [provider]);
  return { path: chooseVoicePath({ local, ai: settings?.ai ?? 'cloud', provider, hasKey }), provider, enabled: settings?.voiceOn ?? true, lang };
}

interface Session { stop: (finish: boolean) => void }

/** One voice prompt at a time. `onWords` gets the heard text once the person is done; nothing is ever sent as a prompt from here. */
export function useVoice(onWords: (words: string) => void) {
  const { path, provider, enabled, lang: chosenLang } = useVoicePath();
  const langRef = useRef(chosenLang);
  langRef.current = chosenLang;
  const [ui, setUiState] = useState<VoiceUi>({ kind: 'idle' });
  const uiRef = useRef<VoiceUi>(ui);
  const setUi = useCallback((next: VoiceUi) => { uiRef.current = next; setUiState(next); }, []);
  const mic = useRef<MicState>('unknown');
  const session = useRef<Session>(undefined);
  const access = useRef<Promise<HostAccess>>(Promise.resolve('granted'));
  const pathRef = useRef(path);
  pathRef.current = path;
  const words = useRef(onWords);
  words.current = onWords;

  /** The recording of the last cloud prompt, held in memory only so "Try again" can send it again. */
  const held = useRef<{ blob: Blob; lang: string; provider: SpeechProvider } | undefined>(undefined);
  const sending = useRef<AbortController | undefined>(undefined);
  const sendHeld = useCallback(() => {
    const audio = held.current;
    if (!audio) return;
    const ac = new AbortController();
    sending.current = ac;
    setUi({ kind: 'card', card: 'voice-transcribing', provider: audio.provider });
    void (async () => {
      try {
        if ((await access.current) === 'denied') throw new VoiceError('failed');
        const key = await getKey(audio.provider);
        if (!key) throw new VoiceError('key');
        const said = await transcribe(audio.provider, key, audio.blob, { lang: audio.lang, signal: ac.signal });
        if (ac.signal.aborted) return;
        held.current = undefined;
        if (said) { setUi({ kind: 'idle' }); words.current(said); } else setUi({ kind: 'card', card: 'voice-not-heard' });
      } catch (error) {
        if (ac.signal.aborted) return;
        const code = error instanceof VoiceError ? error.code : 'failed';
        if (code !== 'cancelled') console.error('Motikord: could not turn speech into text', code);
        setUi({ kind: 'card', card: 'voice-transcribe-failed', provider: audio.provider });
      }
    })();
  }, [setUi]);
  const drop = useCallback(() => { sending.current?.abort(); held.current = undefined; }, []);

  const starting = useRef(false);
  const listen = useCallback(async () => {
    if (starting.current || session.current) return;
    const p = pathRef.current;
    if (p.kind === 'unavailable') { setUi({ kind: 'card', card: 'voice-unavailable' }); return; }
    let stream: MediaStream;
    starting.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setUi({ kind: 'card', card: micProblem((error as { name?: string })?.name) });
      return;
    } finally {
      starting.current = false;
    }
    const lang = langRef.current;
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const started = Date.now();
    let lastSound = started;
    let heard = false;
    let levels = QUIET;
    let text = { settled: '', interim: '' };
    let closed = false;
    let recognition: Recognition | undefined;
    let recorder: MediaRecorder | undefined;
    const chunks: Blob[] = [];
    const ac = new AbortController();
    let tick: ReturnType<typeof setInterval> | undefined;

    const release = () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      void audio.close().catch(() => undefined);
    };
    const end = (next: VoiceUi) => {
      if (closed) return;
      closed = true;
      session.current = undefined;
      release();
      setUi(next);
    };

    const draw = () => setUi({ kind: 'listening', settled: text.settled, interim: text.interim, ms: Date.now() - started, levels });

    if (p.kind === 'local') {
      recognition = createLocalRecognition(lang);
      if (!recognition) { end({ kind: 'card', card: 'voice-unavailable' }); return; }
      recognition.onresult = (e) => {
        text = joinResults(Array.from(e.results, (r) => ({ transcript: r[0]?.transcript ?? '', isFinal: r.isFinal })));
        if (text.settled || text.interim) { heard = true; lastSound = Date.now(); }
        draw();
      };
      recognition.onerror = (e) => {
        if (e.error === 'aborted') return;
        if (e.error === 'no-speech') end({ kind: 'card', card: 'voice-not-heard' });
        else if (e.error === 'not-allowed' || e.error === 'audio-capture') end({ kind: 'card', card: micProblem(e.error) });
        else end({ kind: 'card', card: 'voice-unavailable' });
      };
      recognition.onend = () => {
        const all = [text.settled, text.interim].filter(Boolean).join(' ');
        if (closed) return;
        if (all) { end({ kind: 'idle' }); words.current(all); } else end({ kind: 'card', card: 'voice-not-heard' });
      };
      recognition.start();
    } else {
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      recorder = new MediaRecorder(stream, { mimeType: type });
      // Audio stays in memory only for this one request.
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        if (closed) return;
        if (!heard) { end({ kind: 'card', card: 'voice-not-heard' }); return; }
        held.current = { blob: new Blob(chunks, { type }), lang, provider: p.provider };
        chunks.length = 0;
        end({ kind: 'idle' });
        sendHeld();
      };
      recorder.start(250);
    }

    tick = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      levels = [...levels.slice(1), level];
      const now = Date.now();
      if (p.kind === 'cloud' && level >= SOUND_LEVEL) { heard = true; lastSound = now; }
      draw();
      const step = nextStep({ elapsedMs: now - started, heard, sinceSoundMs: now - lastSound });
      if (step === 'not-heard') { recognition?.abort(); recorder?.stop(); end({ kind: 'card', card: 'voice-not-heard' }); }
      else if (step === 'finish') session.current?.stop(true);
    }, 100);

    session.current = {
      stop: (finish) => {
        if (finish) {
          recognition?.stop();
          if (recorder?.state === 'recording') recorder.stop();
          return;
        }
        ac.abort();
        recognition?.abort();
        if (recorder?.state === 'recording') recorder.stop();
        end({ kind: 'idle' });
      },
    };
    draw();
  }, [setUi, sendHeld]);

  // Mic permission, known before any click so the first tap can show voice-mic-access straight away.
  useEffect(() => {
    let status: PermissionStatus | undefined;
    // Chrome's answer from the mic tab: listen straight away if the person was waiting on voice-mic-access.
    const answered = (state: MicState) => {
      mic.current = state;
      const u = uiRef.current;
      if (u.kind !== 'card' || u.card !== 'voice-mic-access') return;
      if (state === 'granted') void listen();
      else if (state === 'denied') setUi({ kind: 'card', card: 'voice-mic-blocked' });
    };
    const onChange = () => answered(status?.state ?? 'unknown');
    void navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((s) => { status = s; mic.current = s.state; s.onchange = onChange; }).catch(() => undefined);
    const channel = new BroadcastChannel(MIC_CHANNEL);
    channel.onmessage = (e: MessageEvent<MicMessage>) => answered(e.data.granted ? 'granted' : 'denied');
    return () => { if (status) status.onchange = null; channel.close(); session.current?.stop(false); sending.current?.abort(); };
  }, [listen, setUi]);

  /** Call from the click: host access and the language download are asked before anything is awaited. */
  const start = useCallback(() => {
    if (session.current) return;
    const p = pathRef.current;
    if (p.kind === 'unavailable') { setUi({ kind: 'card', card: 'voice-unavailable' }); return; }
    access.current = p.kind === 'cloud' ? requestHost(HOSTS[p.provider]) : Promise.resolve('granted');
    if (mic.current === 'prompt') { setUi({ kind: 'card', card: 'voice-mic-access' }); return; }
    if (mic.current === 'denied') { setUi({ kind: 'card', card: 'voice-mic-blocked' }); return; }
    if (p.kind === 'local' && p.download) {
      setUi({ kind: 'card', card: 'voice-getting-ready' });
      void installLocal(langRef.current).then((ok) => {
        if (ok) { pathRef.current = { kind: 'local', download: false }; void listen(); } else setUi({ kind: 'card', card: 'voice-unavailable' });
      });
      return;
    }
    void listen();
  }, [listen, setUi]);

  return {
    ui, path, provider, enabled,
    start,
    /** "Done": stop listening and put the words in the box. */
    done: () => session.current?.stop(true),
    /** "Cancel": drop what was heard, keep what was typed. */
    cancel: () => { session.current?.stop(false); drop(); setUi({ kind: 'idle' }); },
    /** "Type instead" and dismissing a card. */
    dismiss: () => { drop(); setUi({ kind: 'idle' }); },
    /** "Allow microphone": a small Motikord tab shows Chrome's prompt, then closes itself. */
    allowMic: () => { void browser.tabs.create({ url: browser.runtime.getURL('/mic.html'), active: true }); },
    openChromeSettings: () => { void browser.tabs.create({ url: chromeSiteSettingsUrl(browser.runtime.id) }); },
    /** On voice-transcribe-failed it sends the same recording again; on the other cards it listens again. */
    tryAgain: () => {
      const u = uiRef.current;
      if (u.kind === 'card' && u.card === 'voice-transcribe-failed' && held.current) { sendHeld(); return; }
      setUi({ kind: 'idle' }); start();
    },
  };
}
