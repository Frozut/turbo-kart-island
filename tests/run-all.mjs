// Esegue tutti i test (Node + browser headless) e termina con errore se anche uno solo fallisce.
// Uso: node tests/run-all.mjs [--fast]   (--fast salta i test più lenti: telefono e piste)
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791, BASE = `http://127.0.0.1:${PORT}/`;
const fast = process.argv.includes('--fast');

async function up() { try { return (await fetch(BASE, { method: 'HEAD' })).ok; } catch { return false; } }
let server = null;
if (!(await up())) {
  server = spawn('python', ['serve.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise(r => setTimeout(r, 200));
}

const suites = [
  ['unit', ['--test', 'tests/settings.test.mjs', 'tests/mechanics.test.mjs', 'tests/syntax.test.mjs']],
  ['piste esistenti identiche', ['tests/track-fingerprint.mjs', BASE]],
  ['meccaniche', ['tests/smoke-mechanics.mjs', BASE]],
];
if (!fast) suites.push(
  ['pista otto', ['tests/smoke-tracks.mjs', BASE, 'otto']],
  ['pista jungle', ['tests/smoke-tracks.mjs', BASE, 'jungle']],
  ['telefono', ['tests/smoke-phone.mjs', BASE]],
);
for (const id of process.argv.slice(2).filter(a => a.startsWith('--map=')).map(a => a.slice(6))) suites.push(['pista ' + id, ['tests/smoke-tracks.mjs', BASE, id]]);

let failed = 0;
for (const [name, args] of suites) {
  const t = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 420000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  if (!ok) console.log((r.stdout + r.stderr).split('\n').filter(l => /FAIL|ERRORE|TIMEOUT|✖|Error/.test(l)).slice(0, 12).map(l => '      ' + l).join('\n'));
}
if (server) server.kill();
console.log(failed ? `\n${failed} suite fallite` : '\nTutto verde');
process.exit(failed ? 1 : 0);
