// Plays the gamemaster's ElevenLabs narration audio when a new narration arrives,
// and always shows the narration text (so it works even when voice is stubbed).
// Must stay mounted ONCE across the whole match (see App.tsx) — remounting
// resets `lastPlayed` and destroys the <audio> element mid-sentence.
import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore.js';

export function VoicePlayer() {
  const narration = useGameStore((s) => s.narration);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayed = useRef<string | null>(null);
  const pendingUrl = useRef<string | null>(null);

  useEffect(() => {
    const url = narration?.audioUrl ?? null;
    if (url && url !== lastPlayed.current && audioRef.current) {
      lastPlayed.current = url;
      audioRef.current.src = url;
      audioRef.current.play().catch(() => {
        // Browser blocked autoplay pre-interaction — retry once on the
        // player's next click/keypress instead of losing the line silently.
        pendingUrl.current = url;
      });
    }
  }, [narration]);

  useEffect(() => {
    const retry = () => {
      if (pendingUrl.current && audioRef.current) {
        audioRef.current.play().catch(() => undefined);
        pendingUrl.current = null;
      }
    };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
    return () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
    };
  }, []);

  return (
    <div className="panel">
      <div className="phase-pill">🎙️ Gamemaster</div>
      <p className="narration">{narration?.text ?? 'Waiting for the gamemaster…'}</p>
      <audio ref={audioRef} hidden />
    </div>
  );
}
