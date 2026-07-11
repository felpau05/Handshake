// Plays the gamemaster's ElevenLabs narration audio when a new narration arrives,
// and always shows the narration text (so it works even when voice is stubbed).
import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore.js';

export function VoicePlayer() {
  const narration = useGameStore((s) => s.narration);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayed = useRef<string | null>(null);

  useEffect(() => {
    const url = narration?.audioUrl ?? null;
    if (url && url !== lastPlayed.current && audioRef.current) {
      lastPlayed.current = url;
      audioRef.current.src = url;
      audioRef.current.play().catch(() => undefined); // autoplay may be blocked pre-interaction
    }
  }, [narration]);

  return (
    <div className="panel">
      <div className="phase-pill">🎙️ Gamemaster</div>
      <p className="narration">{narration?.text ?? 'Waiting for the gamemaster…'}</p>
      <audio ref={audioRef} hidden />
    </div>
  );
}
