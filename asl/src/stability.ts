// Turns a noisy per-frame prediction stream into clean, intentional letter
// events. A frame-by-frame classifier flickers and repeats; this state machine
// commits a letter only once it's been held steady, then requires a "release"
// before the SAME letter can fire again (so "LL" still works via a deliberate gap).

export interface StabilityConfig {
  minConfidence: number;
  holdMs: number;
  releaseMs: number;
}

export class StabilityFilter {
  private candidate: string | null = null;
  private candidateSince = 0;
  private lastEmitted: string | null = null;
  private armed = true;
  private lowSince: number | null = null;

  constructor(private cfg: StabilityConfig) {}

  /**
   * Feed the current prediction each frame. Pass letter=null when no hand is
   * visible. Returns a letter ONLY at the instant it should be emitted, else null.
   */
  update(letter: string | null, confidence: number, now: number): string | null {
    // No hand, or too unsure → count toward a release.
    if (letter === null || confidence < this.cfg.minConfidence) {
      if (this.lowSince === null) this.lowSince = now;
      if (now - this.lowSince >= this.cfg.releaseMs) {
        // Released: allow the next letter (even a repeat of the last one).
        this.armed = true;
        this.lastEmitted = null;
      }
      this.candidate = null;
      return null;
    }

    this.lowSince = null;

    // Switched to a different letter → restart the hold timer. Moving to a
    // letter other than the one we just emitted re-arms us, so distinct letters
    // in a row don't need a hand-removal gap between them.
    if (letter !== this.candidate) {
      this.candidate = letter;
      this.candidateSince = now;
      if (letter !== this.lastEmitted) this.armed = true;
      return null;
    }

    // Same letter held long enough → commit it once.
    if (this.armed && now - this.candidateSince >= this.cfg.holdMs) {
      this.armed = false;
      this.lastEmitted = letter;
      return letter;
    }
    return null;
  }

  reset(): void {
    this.candidate = null;
    this.lastEmitted = null;
    this.armed = true;
    this.lowSince = null;
  }
}
