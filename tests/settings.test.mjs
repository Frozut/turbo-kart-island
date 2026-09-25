import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('//  OPZIONI (dati');
const end = html.indexOf('//  RENDERER / SCENE');
const code = start >= 0 ? html.slice(start, end) : 'throw new Error("sezione OPZIONI (dati) mancante")';
const load = storage => new Function('localStorage', code +
  '\nreturn { SETTINGS_DEFAULT, SETTINGS, mergeSettings, loadSettings, saveSettings, keyLabel, assignKey, KEY_ACTIONS, CAM_DIST };')(storage);
const mem = (init = {}) => ({ d: { ...init }, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = String(v); } });

test('storage vuoto: default', () => {
  const m = load(mem());
  assert.deepEqual(m.SETTINGS, m.SETTINGS_DEFAULT);
  assert.notEqual(m.SETTINGS, m.SETTINGS_DEFAULT);
});
test('JSON corrotto: default', () => {
  const m = load(mem({ 'tki-settings': '{rotto' }));
  assert.deepEqual(m.SETTINGS, m.SETTINGS_DEFAULT);
});
test('storage che lancia eccezioni: default', () => {
  const m = load({ getItem() { throw new Error('bloccato'); }, setItem() { throw new Error('bloccato'); } });
  assert.deepEqual(m.SETTINGS, m.SETTINGS_DEFAULT);
  assert.doesNotThrow(() => m.saveSettings());
});
test('salvataggio parziale fuso coi default', () => {
  const m = load(mem({ 'tki-settings': JSON.stringify({ audio: { music: 0.1 }, extra: 1 }) }));
  assert.equal(m.SETTINGS.audio.music, 0.1);
  assert.equal(m.SETTINGS.audio.master, m.SETTINGS_DEFAULT.audio.master);
  assert.equal(m.SETTINGS.extra, undefined);
});
test('tipi sbagliati ignorati', () => {
  const m = load(mem({ 'tki-settings': JSON.stringify({ audio: { music: 'forte' }, keys: { left: 'KeyA', drift: ['KeyJ', 5] } }) }));
  assert.equal(m.SETTINGS.audio.music, m.SETTINGS_DEFAULT.audio.music);
  assert.deepEqual(m.SETTINGS.keys.left, m.SETTINGS_DEFAULT.keys.left);
  assert.deepEqual(m.SETTINGS.keys.drift, m.SETTINGS_DEFAULT.keys.drift);
});
test('salva e ricarica', () => {
  const s = mem(), a = load(s);
  a.SETTINGS.gfx.quality = 'low'; a.SETTINGS.keys.item = ['KeyJ', null]; a.saveSettings();
  const b = load(s);
  assert.equal(b.SETTINGS.gfx.quality, 'low');
  assert.deepEqual(b.SETTINGS.keys.item, ['KeyJ', null]);
});
test('keyLabel', () => {
  const { keyLabel } = load(mem());
  assert.equal(keyLabel('KeyA'), 'A');
  assert.equal(keyLabel('Digit7'), '7');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('Space'), 'SPAZIO');
  assert.equal(keyLabel('Numpad4'), 'NUM 4');
  assert.equal(keyLabel(null), '—');
  assert.equal(keyLabel('Backslash'), 'Backslash');
});
test('assignKey: assegna, scambia, rifiuta riservati', () => {
  const { assignKey } = load(mem());
  const map = { a: ['KeyA', 'KeyB'], b: ['KeyC', null] };
  assert.equal(assignKey(map, 'b', 1, 'KeyZ'), true);
  assert.deepEqual(map.b, ['KeyC', 'KeyZ']);
  assert.equal(assignKey(map, 'b', 0, 'KeyA'), true); // KeyA era in a[0] → scambio
  assert.deepEqual(map.a, ['KeyC', 'KeyB']);
  assert.deepEqual(map.b, ['KeyA', 'KeyZ']);
  assert.equal(assignKey(map, 'a', 0, 'Escape'), false);
  assert.equal(assignKey(map, 'a', 0, 'KeyP'), false);
  assert.equal(assignKey(map, 'a', 0, 'Enter'), false);
  assert.deepEqual(map.a, ['KeyC', 'KeyB']);
});
test('ogni azione ha 2 slot e un\'etichetta', () => {
  const { SETTINGS_DEFAULT, KEY_ACTIONS } = load(mem());
  assert.deepEqual(KEY_ACTIONS.map(x => x[0]).sort(), Object.keys(SETTINGS_DEFAULT.keys).sort());
  for (const a in SETTINGS_DEFAULT.keys) assert.equal(SETTINGS_DEFAULT.keys[a].length, 2);
});
