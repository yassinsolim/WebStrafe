// compares two animation audit reports scenario by scenario
//   node tools/qa/animation-audit-compare.mjs <before report.json> <after report.json>
import { readFileSync } from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('usage: node tools/qa/animation-audit-compare.mjs <before.json> <after.json>');
const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));
const KINDS = ['pops', 'jolts', 'hitches', 'fingerSnaps', 'flickers'];
const key = (r) => `${r.target} ${r.name}`;
const old = new Map(before.results.map((r) => [key(r), r]));
const sums = { before: Object.fromEntries(KINDS.map((k) => [k, 0])), after: Object.fromEntries(KINDS.map((k) => [k, 0])) };
for (const r of after.results) {
  const b = old.get(key(r));
  if (!b) continue;
  const cells = KINDS.map((k) => {
    sums.before[k] += b.summary[k];
    sums.after[k] += r.summary[k];
    const delta = r.summary[k] - b.summary[k];
    return `${k.slice(0, 6)} ${String(b.summary[k]).padStart(3)}>${String(r.summary[k]).padEnd(3)}${delta > 0 ? '!' : ' '}`;
  });
  console.log(key(r).padEnd(34), cells.join(' '));
}
console.log('before', JSON.stringify(sums.before));
console.log('after ', JSON.stringify(sums.after));
