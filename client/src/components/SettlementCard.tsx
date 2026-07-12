// MATCH_END wager settlement panel — makes the on-chain money movement
// unmissable: who paid, who got paid, each wallet's LIVE new total, and the
// payout transaction (linked to Solana Explorer). Renders a "settling…"
// placeholder until the SETTLEMENT broadcast lands (chain confirmation takes
// a few seconds after MATCH_END).
import { useGameStore } from '../state/gameStore.js';

export function SettlementCard() {
  const settlement = useGameStore((s) => s.settlement);
  const playerId = useGameStore((s) => s.playerId);

  if (!settlement) {
    return (
      <div className="panel" style={{ textAlign: 'center' }}>
        <h3>⛓️ Settling wager on-chain…</h3>
        <p className="muted">Confirming the SOL transfer on Solana devnet — a few seconds.</p>
      </div>
    );
  }

  const mine = settlement.players.find((p) => p.playerId === playerId);
  const explorerUrl = settlement.payoutSignature
    ? `https://explorer.solana.com/tx/${settlement.payoutSignature}?cluster=devnet`
    : null;

  return (
    <div className="panel">
      <h3>⛓️ Wager settled on-chain</h3>

      {settlement.players.map((p) => {
        const gained = p.deltaSol >= 0;
        const isMe = p.playerId === playerId;
        return (
          <div
            key={p.playerId}
            className="row"
            style={{
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '0.4rem 0',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div>
              <strong>{p.displayName}</strong>
              {isMe && <span className="muted"> (you)</span>}
              {p.walletAddress && (
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  {p.walletAddress.slice(0, 4)}…{p.walletAddress.slice(-4)}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={gained ? 'delta-win' : 'delta-lose'} style={{ fontSize: '1.2rem' }}>
                {gained ? '+' : '−'}{Math.abs(p.deltaSol)} SOL
              </div>
              <div className="muted">
                {p.newBalanceSol !== null
                  ? `new balance ${p.newBalanceSol.toFixed(4)} SOL`
                  : 'balance unavailable'}
              </div>
            </div>
          </div>
        );
      })}

      {mine && (
        <p style={{ marginTop: '0.75rem' }} className={mine.deltaSol >= 0 ? 'delta-win' : 'delta-lose'}>
          {mine.deltaSol >= 0
            ? `You won the ${settlement.potSol} SOL pot — up ${mine.deltaSol} SOL on the match.`
            : `Your ${settlement.betSol} SOL wager went to the winner.`}
        </p>
      )}

      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="muted"
          style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}
        >
          payout tx: {settlement.payoutSignature!.slice(0, 20)}… ↗ view on Solana Explorer
        </a>
      ) : (
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          No on-chain payout landed for this match (winner has no wallet on file, or the transfer failed).
        </p>
      )}
    </div>
  );
}
