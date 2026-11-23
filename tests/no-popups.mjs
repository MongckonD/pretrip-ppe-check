/**
 * Build guard: the app must never use browser pop-ups — window.confirm / alert / prompt.
 * Some browsers (e.g. embedded / in-app browsers) block them and answer "no" without showing anything, so a button
 * that asks with a pop-up silently does nothing there (this is how "จบงาน" could not be pressed).
 * Use <ConfirmButton> (src/components/ConfirmButton.tsx: tap twice) or a box on the page instead.
 *
 * Runs before every build (npm run build / npm run deploy); exits 1 and lists the lines when it finds one.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');
const BAD = /\b(?:window\.)?(confirm|alert|prompt)\s*\(/;

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}

const hits = [];
for (const f of files(SRC)) {
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').trim(); // ignore // comments
    if (!code || code.startsWith('*') || code.startsWith('/*')) return; // ignore block-comment lines
    // `onConfirm(` / `xConfirm(` etc. are fine: only the bare names (or window.x) count
    const m = code.match(BAD);
    if (m && !/[A-Za-z0-9_$]$/.test(code.slice(0, m.index).replace(/window\.$/, ''))) hits.push(`${relative(ROOT, f)}:${i + 1}  ${line.trim()}`);
  });
}

if (hits.length) {
  console.error('ห้ามใช้ป๊อปอัปของเบราว์เซอร์ (window.confirm / alert / prompt) — ใช้ <ConfirmButton> แทน:\n' + hits.map((h) => '  ' + h).join('\n'));
  process.exit(1);
}
console.log('no browser pop-ups in src ✓');
