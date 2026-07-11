// Always-on floating entry point to the isolated ElevenLabs test panel — a
// small fixed button in the corner, on top of whatever phase the game is in.
// Renders as a sibling overlay in main.tsx, never inside App.tsx, so it can't
// interfere with LOBBY→SHOP→PLAY and needs no room/join to reach.
import { useState } from 'react';
import { ElevenLabsTest } from './ElevenLabsTest.js';

export function DevToolsToggle() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'fixed',
          bottom: '1rem',
          right: '1rem',
          zIndex: 1000,
          borderRadius: '999px',
          padding: '0.6rem 1rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}
      >
        🎙️ ElevenLabs test
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="panel"
            style={{ maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <ElevenLabsTest onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
