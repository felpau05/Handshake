// Standalone test panel for the ElevenLabs integration — proves TTS and music
// generation work end to end through our server (the API key never reaches
// the browser). Rendered as a floating overlay toggled from anywhere in the
// app — see DevToolsToggle.tsx / main.tsx. Doesn't touch the game itself.
// Safe to delete once the integration is trusted.
import { useRef, useState } from 'react';

type RequestState = 'idle' | 'loading' | 'error';

async function fetchAudio(url: string, body: unknown): Promise<Blob> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return res.blob();
}

export function ElevenLabsTest({ onClose }: { onClose?: () => void }) {
  const [text, setText] = useState("Rock, paper, scissors — shoot! The gamemaster calls it!");
  const [ttsState, setTtsState] = useState<RequestState>('idle');
  const [ttsError, setTtsError] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const [prompt, setPrompt] = useState('Upbeat 8-bit victory jingle, playful and short');
  const [musicState, setMusicState] = useState<RequestState>('idle');
  const [musicError, setMusicError] = useState<string | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);

  async function handleSpeak() {
    setTtsState('loading');
    setTtsError(null);
    try {
      const blob = await fetchAudio('/api/test/tts', { text });
      const url = URL.createObjectURL(blob);
      if (ttsAudioRef.current) {
        ttsAudioRef.current.src = url;
        await ttsAudioRef.current.play();
      }
      setTtsState('idle');
    } catch (err) {
      setTtsState('error');
      setTtsError(err instanceof Error ? err.message : 'TTS request failed');
    }
  }

  async function handleGenerateMusic() {
    setMusicState('loading');
    setMusicError(null);
    try {
      // Music composition is slow (many seconds) — give it a generous timeout.
      const blob = await fetchAudio('/api/test/music', { prompt, lengthMs: 10_000 });
      const url = URL.createObjectURL(blob);
      if (musicAudioRef.current) {
        musicAudioRef.current.src = url;
        await musicAudioRef.current.play();
      }
      setMusicState('idle');
    } catch (err) {
      setMusicState('error');
      setMusicError(err instanceof Error ? err.message : 'Music generation request failed');
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="title" style={{ fontSize: '1.4rem', margin: 0 }}>
          ElevenLabs <span>test panel</span>
        </h1>
        {onClose && (
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', padding: '0.3rem 0.6rem' }}>
            ✕
          </button>
        )}
      </div>
      <p className="muted">
        Isolated dev panel — proves text-to-speech and music generation through the server.
        Doesn't touch the game.
      </p>

      <div className="panel">
        <h3>Text-to-speech</h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          style={{ width: '100%', marginBottom: '0.75rem' }}
        />
        <div className="row" style={{ gap: '0.75rem', alignItems: 'center' }}>
          <button onClick={handleSpeak} disabled={ttsState === 'loading' || !text.trim()}>
            {ttsState === 'loading' ? 'Speaking…' : 'Speak'}
          </button>
          <audio ref={ttsAudioRef} controls />
        </div>
        {ttsState === 'error' && <ErrorBanner message={ttsError} />}
      </div>

      <div className="panel">
        <h3>Music generation</h3>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ width: '100%', marginBottom: '0.75rem' }}
        />
        <div className="row" style={{ gap: '0.75rem', alignItems: 'center' }}>
          <button onClick={handleGenerateMusic} disabled={musicState === 'loading' || !prompt.trim()}>
            {musicState === 'loading' ? 'Generating… (can take up to a minute)' : 'Generate music'}
          </button>
          <audio ref={musicAudioRef} controls />
        </div>
        {musicState === 'error' && <ErrorBanner message={musicError} />}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  const notConfigured = message?.toLowerCase().includes('not configured');
  return (
    <p style={{ color: notConfigured ? 'var(--muted)' : 'var(--lose)', marginTop: '0.5rem' }}>
      {notConfigured ? '⚠️ ' : '❌ '}
      {message}
    </p>
  );
}
