import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('script modulo di index.html senza errori di sintassi', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, 'script modulo non trovato');
  const f = join(mkdtempSync(join(tmpdir(), 'tki-')), 'game.mjs');
  writeFileSync(f, m[1]);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
