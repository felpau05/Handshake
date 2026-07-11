// A 3-2-1-Go countdown driven by the server's phaseDeadline for the CAPTURE
// phase, so both laptops count down in sync.
import { useEffect, useState } from 'react';

interface Props {
  deadline: number | null;
}

export function CaptureCountdown({ deadline }: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline]);

  if (secondsLeft === null) return null;
  return <div className="countdown">{secondsLeft > 0 ? secondsLeft : 'GO!'}</div>;
}
