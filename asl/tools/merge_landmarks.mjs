// Merge a collect-tool download (landmarks.json) into the master training set.
//
// Default is APPEND: new samples are added on top of what's already there for
// that letter. Pass --replace A,B,C to first DELETE those labels from the
// master set (use when re-recording a letter whose old samples were bad).
//
// Always writes a timestamped .bak of the master file first.
//
// Usage (from the asl/ dir):
//   node tools/merge_landmarks.mjs data/landmarks.json
//   node tools/merge_landmarks.mjs data/landmarks.json --replace O,C
import fs from 'node:fs';

const MASTER = 'data/dataset_merged.json';

const args = process.argv.slice(2);
const replaceIdx = args.indexOf('--replace');
const replaceLabels = replaceIdx !== -1 ? args[replaceIdx + 1].split(',').map((s) => s.trim().toUpperCase()) : [];
const inputs = args.filter((a, i) => a !== '--replace' && (replaceIdx === -1 || i !== replaceIdx + 1));

if (!inputs.length) {
  console.error('Usage: node tools/merge_landmarks.mjs <landmarks.json> [more.json ...] [--replace A,B,C]');
  process.exit(1);
}

const counts = (arr) => {
  const c = {};
  for (const s of arr) c[s.label] = (c[s.label] ?? 0) + 1;
  return c;
};

let master = JSON.parse(fs.readFileSync(MASTER, 'utf8'));
console.log(`master: ${master.length} samples`);

if (replaceLabels.length) {
  const before = master.length;
  master = master.filter((s) => !replaceLabels.includes(s.label));
  console.log(`--replace ${replaceLabels.join(',')}: removed ${before - master.length} old samples`);
}

let added = 0;
for (const f of inputs) {
  const part = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`+ ${f}: ${part.length} samples ->`, counts(part));
  master.push(...part);
  added += part.length;
}

const bak = `${MASTER}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(MASTER, bak);
fs.writeFileSync(MASTER, JSON.stringify(master));
console.log(`\nWrote ${master.length} samples (${added} new) -> ${MASTER}`);
console.log(`Backup of previous master: ${bak}`);
console.log('Final per-label counts:', counts(master));
