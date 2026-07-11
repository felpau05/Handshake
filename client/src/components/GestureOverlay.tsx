// Debug overlay: draws the detected hand landmarks + current move on a canvas
// sized over the camera video. Purely diagnostic — safe to hide in the final UI.
import { useEffect, useRef } from 'react';
import type { Move } from '@app/shared';
import type { Landmark } from '../lib/gestureClassifier.js';

interface Props {
  landmarks: Landmark[] | null;
  move: Move | null;
}

export function GestureOverlay({ landmarks, move }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    if (!landmarks) return;

    ctx.fillStyle = '#ffcf3f';
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [landmarks]);

  return (
    <>
      <canvas ref={canvasRef} width={640} height={480} />
      {move && <div className="move-badge">✋ {move}</div>}
    </>
  );
}
