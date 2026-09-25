# Menu Opzioni Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pannello OPZIONI (Audio / Grafica / Controlli / Gioco) apribile da titolo e pausa, salvato in `localStorage`, applicato subito.

**Architecture:** Tutto dentro `index.html` (unico modulo ES, niente build). Una sezione "OPZIONI (dati)" pura e testabile con Node, subito dopo UTIL; una sezione "OPZIONI (interfaccia)" prima di BOOT con UI e funzioni `apply*`. I punti del gioco che oggi usano costanti (gain audio, pixel ratio, bloom, ombre, tasti, camera) leggono `SETTINGS`.

**Tech Stack:** three.js 0.169 (CDN), Web Audio, DOM puro, `node --test` (Node 24) per la logica pura.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-09-25-menu-opzioni-design.md`.
- Chiave `localStorage`: `tki-settings`; ogni accesso in `try/catch`.
- Esc, P, Enter non rimappabili.
- Testi UI in italiano, stile esistente (`.box`, `.btn`, `.big`, `.stroke`).
- NON usare la classe `.cc` (usata da `refreshCC()` con `querySelectorAll('.cc')`).
- La cartella non è un repo git: niente commit; ogni task finisce con i test verdi.
- Numeri di riga indicativi (file ~3950 righe): cercare il testo citato.

---

### Task 1: Dati impostazioni (logica pura + test)

**Files:**
- Modify: `index.html` (nuova sezione tra UTIL e `//  RENDERER / SCENE`)
- Create: `tests/settings.test.mjs`, `tests/syntax.test.mjs`

**Interfaces:**
- Produces: `SETTINGS_DEFAULT`, `SETTINGS` (oggetto mutabile), `cloneJSON(o)`, `mergeSettings(def, saved)`, `loadSettings()`, `saveSettings()`, `keyLabel(code) -> string`, `RESERVED_KEYS`, `assignKey(map, action, slot, code) -> boolean`, `KEY_ACTIONS: [action, label][]`, `CAM_DIST: {near, normal, far}`.

- [ ] **Step 1: Scrivere i test**

`tests/settings.test.mjs`:
```js
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
  assert.equal(assignKey(map, 'b', 0, 'KeyA'), true);   // KeyA era in a[0] → scambio
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
```

`tests/syntax.test.mjs` (controlla che lo script modulo di `index.html` sia JS valido):
```js
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
```

- [ ] **Step 2: Eseguire i test, verificare che falliscano**

Run: `node --test tests/`
Expected: `syntax.test.mjs` PASS, `settings.test.mjs` FAIL con "sezione OPZIONI (dati) mancante".

- [ ] **Step 3: Implementare la sezione dati**

In `index.html`, subito prima del blocco:
```js
// =====================================================================
//  RENDERER / SCENE
```
inserire:
```js
// =====================================================================
//  OPZIONI (dati + salvataggio) — niente DOM/THREE qui: testata da tests/settings.test.mjs
// =====================================================================
const SETTINGS_DEFAULT = {
  audio: { master: 0.75, music: 0.3, sfx: 0.8 },
  gfx: { quality: 'auto', fps: false },            // 'auto' | 'low' | 'medium' | 'high'
  keys: {
    left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    throttle: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'],
    drift: ['Space', 'ShiftLeft'], item: ['KeyE', 'KeyX'], look: ['KeyQ', null],
  },
  game: { steerSens: 1, cam: 'normal', shake: true }, // cam: 'near' | 'normal' | 'far'
};
const KEY_ACTIONS = [['left', 'Sterza a sinistra'], ['right', 'Sterza a destra'], ['throttle', 'Accelera'], ['brake', 'Frena / Retro'], ['drift', 'Salto / Derapata'], ['item', 'Usa oggetto'], ['look', 'Guarda dietro']];
const CAM_DIST = { near: 0.8, normal: 1, far: 1.25 };
const RESERVED_KEYS = ['Escape', 'KeyP', 'Enter'];
const cloneJSON = o => JSON.parse(JSON.stringify(o));
// fonde il salvataggio sui default: tiene solo chiavi note e dello stesso tipo
function mergeSettings(def, saved) {
  const out = cloneJSON(def);
  if (!saved || typeof saved !== 'object') return out;
  for (const k in out) {
    const d = out[k], s = saved[k];
    if (s === undefined) continue;
    if (Array.isArray(d)) { if (Array.isArray(s) && s.length === d.length && s.every(v => v === null || typeof v === 'string')) out[k] = s.slice(); }
    else if (d && typeof d === 'object') out[k] = mergeSettings(d, s);
    else if (typeof s === typeof d) out[k] = s;
  }
  return out;
}
function loadSettings() {
  try { return mergeSettings(SETTINGS_DEFAULT, JSON.parse(localStorage.getItem('tki-settings'))); } catch (e) { return cloneJSON(SETTINGS_DEFAULT); }
}
function saveSettings() { try { localStorage.setItem('tki-settings', JSON.stringify(SETTINGS)); } catch (e) {} }
const SETTINGS = loadSettings();
const KEY_NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'SPAZIO', ShiftLeft: 'SHIFT SX', ShiftRight: 'SHIFT DX', ControlLeft: 'CTRL SX', ControlRight: 'CTRL DX', AltLeft: 'ALT', AltRight: 'ALT GR', Tab: 'TAB', Backspace: '⌫' };
const keyLabel = c => !c ? '—' : KEY_NAMES[c] || (/^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^Numpad/.test(c) ? 'NUM ' + c.slice(6) : c);
// assegna `code` allo slot [action][slot]; se il tasto era già usato altrove, l'altro slot prende il vecchio tasto
function assignKey(map, action, slot, code) {
  if (RESERVED_KEYS.includes(code)) return false;
  const old = map[action][slot];
  for (const a in map) map[a].forEach((c, i) => { if (c === code && !(a === action && i === slot)) map[a][i] = old; });
  map[action][slot] = code;
  return true;
}

```

- [ ] **Step 4: Eseguire i test**

Run: `node --test tests/`
Expected: tutti PASS.

---

### Task 2: Pannello opzioni + scheda Audio

**Files:**
- Modify: `index.html` — CSS (prima di `</style>`), HTML (menu titolo, box pausa, dopo `#pause`), `audioInit()` (~r.1351), listener `keydown` (~r.2824), `menuConfirm()`, `togglePause()`, nuova sezione prima di `//  BOOT`, inizio del `try` in BOOT.

**Interfaces:**
- Consumes: `SETTINGS`, `SETTINGS_DEFAULT`, `cloneJSON`, `saveSettings`, `keyLabel`, `assignKey`, `KEY_ACTIONS` (Task 1).
- Produces: `OPT = { open, tab, capture, wasSuspended }`, `openOptions()`, `closeOptions()`, `renderOptions()`, `OPT_TABS: { audio, gfx, keys, game }` (funzioni che ritornano array di celle), helper `el(tag, props, text)`, `rangeRow(label, obj, key, min, max, onChange, fmt?)`, `choiceRow(label, obj, key, choices, onChange)`, `checkRow(label, obj, key, onChange)`, `applyAudio()`, `applySettings()`. Task 3–5 aggiungono `applyGfx`, `renderControlsHelp` e riempiono le schede.

- [ ] **Step 1: CSS** — prima di `</style>`:
```css
  #options .box { max-width: 680px; }
  .otabs { display: flex; gap: 8px; margin-bottom: 18px; }
  .otab, .ochoice { flex: 1; text-align: center; padding: 10px 0 7px; border-radius: 12px; cursor: pointer; background: rgba(255,255,255,.1); font-family: 'Luckiest Guy', sans-serif; font-size: 18px; border: 3px solid transparent; }
  .ochoice { font-size: 16px; padding: 8px 0 5px; }
  .otab.sel, .ochoice.sel { border-color: #ffd000; background: rgba(255,208,0,.2); }
  .opane { display: grid; grid-template-columns: 180px 1fr 60px; gap: 12px 14px; align-items: center; text-align: left; font-weight: 800; min-height: 240px; align-content: start; }
  .opane.keys { grid-template-columns: 180px 1fr 1fr; }
  .opane input[type=range] { width: 100%; accent-color: #ffd000; }
  .opane input[type=checkbox] { width: 22px; height: 22px; accent-color: #ffd000; }
  .ochoices { display: flex; gap: 6px; grid-column: 2 / 4; }
  .ofull { grid-column: 1 / -1; }
  .okey { font: 900 15px 'Nunito', sans-serif; color: #222; background: #fff; border: 0; border-radius: 8px; padding: 7px 0; cursor: pointer; box-shadow: 0 2px 0 #999; }
  .okey.wait { background: #ffd000; }
  #fps { position: fixed; left: 24px; top: 136px; z-index: 25; font: 900 14px 'Nunito', monospace; color: #7aff5a; background: rgba(0,0,0,.45); padding: 3px 8px; border-radius: 8px; pointer-events: none; }
```

- [ ] **Step 2: HTML**

Nel `.menu` del titolo, dopo `btnPhone`:
```html
    <button class="btn blue" id="btnOptions">⚙ OPZIONI</button>
```
Nel box pausa, dopo `btnRestart`:
```html
      <button class="btn blue small" id="btnPauseOpt">⚙ OPZIONI</button>
```
Sul `<div class="controls">` del titolo aggiungere `id="ctrlHelp"` (il contenuto verrà generato nel Task 4; per ora resta quello statico).
Dopo la chiusura di `<div id="pause" ...>...</div>`:
```html
<div id="options" class="overlay" hidden>
  <div class="box">
    <h2 class="big stroke">OPZIONI</h2>
    <div class="otabs" id="optTabs">
      <div class="otab sel" data-tab="audio">AUDIO</div><div class="otab" data-tab="gfx">GRAFICA</div><div class="otab" data-tab="keys">CONTROLLI</div><div class="otab" data-tab="game">GIOCO</div>
    </div>
    <div class="opane" id="optPane"></div>
    <div class="row">
      <button class="btn small" id="btnOptReset">PREDEFINITI</button>
      <button class="btn green small" id="btnOptOk">OK</button>
    </div>
  </div>
</div>
<div id="fps" hidden></div>
```

- [ ] **Step 3: Audio usa SETTINGS** — in `audioInit()` sostituire i tre valori fissi:
```js
  A.master = ctx.createGain(); A.master.gain.value = SETTINGS.audio.master; A.master.connect(comp);
  A.music = ctx.createGain(); A.music.gain.value = SETTINGS.audio.music; A.music.connect(A.master);
```
e
```js
  A.sfx = ctx.createGain(); A.sfx.gain.value = SETTINGS.audio.sfx; A.sfx.connect(A.master);
```

- [ ] **Step 4: Sezione interfaccia** — prima del blocco `//  BOOT`:
```js
// =====================================================================
//  OPZIONI (interfaccia + applicazione)
// =====================================================================
const OPT = { open: false, tab: 'audio', capture: null, wasSuspended: false };
const el = (tag, props = {}, text) => { const e = Object.assign(document.createElement(tag), props); if (text != null) e.textContent = text; return e; };
function rangeRow(label, obj, key, min, max, onChange, fmt = v => Math.round(v * 100) + '%') {
  const out = el('span', {}, fmt(obj[key]));
  const inp = el('input', { type: 'range', min, max, step: (max - min) / 100, value: obj[key] });
  inp.oninput = () => { obj[key] = +inp.value; out.textContent = fmt(obj[key]); saveSettings(); onChange(); };
  return [el('span', {}, label), inp, out];
}
function choiceRow(label, obj, key, choices, onChange) {
  const wrap = el('div', { className: 'ochoices' });
  for (const [v, txt] of choices) {
    const c = el('div', { className: 'ochoice' + (obj[key] === v ? ' sel' : '') }, txt);
    c.onclick = () => { obj[key] = v; saveSettings(); onChange(); renderOptions(); sfx.tickR(); };
    wrap.appendChild(c);
  }
  return [el('span', {}, label), wrap];
}
function checkRow(label, obj, key, onChange) {
  const inp = el('input', { type: 'checkbox', checked: obj[key] });
  inp.onchange = () => { obj[key] = inp.checked; saveSettings(); onChange(); };
  return [el('span', {}, label), inp, el('span')];
}
function applyAudio() {
  if (!A.ctx) return;
  const a = SETTINGS.audio;
  A.master.gain.value = a.master; A.music.gain.value = a.music; A.sfx.gain.value = a.sfx;
}
const OPT_TABS = {
  audio: () => [
    rangeRow('Volume generale', SETTINGS.audio, 'master', 0, 1, applyAudio),
    rangeRow('Musica', SETTINGS.audio, 'music', 0, 1, applyAudio),
    rangeRow('Effetti', SETTINGS.audio, 'sfx', 0, 1, () => { applyAudio(); sfx.tickR(); }),
  ],
  gfx: () => [],
  keys: () => [],
  game: () => [],
};
function renderOptions() {
  document.querySelectorAll('#optTabs .otab').forEach(t => t.classList.toggle('sel', t.dataset.tab === OPT.tab));
  const pane = $('optPane');
  pane.className = 'opane' + (OPT.tab === 'keys' ? ' keys' : '');
  pane.replaceChildren(...OPT_TABS[OPT.tab]().flat());
}
function applySettings() { applyAudio(); }
function openOptions() {
  audioInit();
  for (const k in keys) keys[k] = false;
  OPT.open = true; OPT.capture = null; show('options'); renderOptions();
  // in pausa l'AudioContext è sospeso: lo riaccendo per sentire i cursori, col motore muto
  if (A.ctx && A.ctx.state === 'suspended') {
    OPT.wasSuspended = true;
    const t = A.ctx.currentTime;
    for (const g of [A.eG, A.dnG]) if (g) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t); }
    A.ctx.resume();
  }
}
function closeOptions() {
  OPT.open = false; OPT.capture = null; show('options', false);
  if (OPT.wasSuspended && G.paused && A.ctx) A.ctx.suspend();
  OPT.wasSuspended = false;
}
// tastiera mentre il pannello è aperto: niente arriva al gioco
function optionsKey(e) {
  e.preventDefault();
  if (OPT.capture) {
    const [a, i] = OPT.capture;
    if (e.code === 'Backspace') SETTINGS.keys[a][i] = null;
    else if (e.code !== 'Escape' && !assignKey(SETTINGS.keys, a, i, e.code)) return; // tasto riservato: continua ad aspettare
    OPT.capture = null; saveSettings(); applySettings(); renderOptions();
    return;
  }
  if (e.code === 'Escape') closeOptions();
}
$('optTabs').onclick = e => { const t = e.target.closest('.otab'); if (!t) return; OPT.tab = t.dataset.tab; OPT.capture = null; renderOptions(); };
$('btnOptions').onclick = openOptions;
$('btnPauseOpt').onclick = openOptions;
$('btnOptOk').onclick = closeOptions;
$('btnOptReset').onclick = () => { SETTINGS[OPT.tab] = cloneJSON(SETTINGS_DEFAULT[OPT.tab]); OPT.capture = null; saveSettings(); applySettings(); renderOptions(); };

```

- [ ] **Step 5: Agganci** 

Listener `keydown`: prima riga del corpo diventa
```js
addEventListener('keydown', e => {
  if (OPT.open) { optionsKey(e); return; }
  keys[e.code] = true;
```
`menuConfirm()`: prima riga
```js
  if (OPT.open) return;
```
`togglePause()`: prima riga
```js
  if (OPT.open) return;
```
BOOT: come prima istruzione dentro `try {` (prima del caricamento font):
```js
    applySettings();
```

- [ ] **Step 6: Test automatici**

Run: `node --test tests/`
Expected: tutti PASS.

- [ ] **Step 7: Verifica nel browser** (`python serve.py`, poi `http://localhost:8000/`)
- Titolo → ⚙ OPZIONI → scheda Audio con 3 cursori; Effetti fa "tic".
- Musica a 0 → musica muta; ricarica → cursore ancora a 0.
- In gara Esc → pausa → OPZIONI: la musica si sente, il motore no; Esc chiude solo le opzioni; RIPRENDI funziona e l'audio torna.
- Console senza errori.

---

### Task 3: Scheda Grafica + contatore FPS

**Files:**
- Modify: `index.html` — RENDERER (~r.334–351), `makeParticles`/uniform `uScale` (~r.1296), `setupTrack` bloom (~r.865), `QUALITY`/`adaptQuality` (~r.3784–3797), `frame()`, sezione OPZIONI (interfaccia).

**Interfaces:**
- Consumes: `SETTINGS.gfx`, `OPT_TABS`, `choiceRow`, `checkRow`, `applySettings` (Task 2).
- Produces: `GFX_LEVELS`, `gfxLevel()`, `gfxMaxPR()`, `BLOOM_BASE` (let), `applyGfx()`, `fpsTick(now)`.

- [ ] **Step 1: Livelli e pixel ratio** — sostituire
```js
const PR = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(PR);
```
con
```js
const GFX_LEVELS = {
  low:    { shadows: false, type: THREE.PCFShadowMap,     map: 1024, bloom: 0,   samples: 0, pr: 1 },
  medium: { shadows: true,  type: THREE.PCFShadowMap,     map: 1024, bloom: 0.5, samples: 0, pr: 1.25 },
  high:   { shadows: true,  type: THREE.PCFSoftShadowMap, map: 2048, bloom: 1,   samples: 4, pr: 1.75 },
};
const gfxLevel = () => GFX_LEVELS[SETTINGS.gfx.quality] || GFX_LEVELS.high; // 'auto' = alta + qualità adattiva
const gfxMaxPR = () => Math.min(window.devicePixelRatio || 1, gfxLevel().pr);
renderer.setPixelRatio(gfxMaxPR());
```
Nella riga di `rt`: `innerWidth * PR, innerHeight * PR` → `innerWidth * gfxMaxPR(), innerHeight * gfxMaxPR()`.
Dopo `const bloom = new UnrealBloomPass(...)` aggiungere:
```js
let BLOOM_BASE = 0.42; // intensità della pista corrente, scalata dal livello grafico
```
Uniform particelle (~r.1296): `innerHeight * PR / 2` → `innerHeight * renderer.getPixelRatio() / 2`.

- [ ] **Step 2: Bloom per pista** — in `setupTrack`, sostituire
```js
  bloom.strength = S.bloom[0]; bloom.radius = S.bloom[1]; bloom.threshold = S.bloom[2];
```
con
```js
  BLOOM_BASE = S.bloom[0]; bloom.strength = BLOOM_BASE * gfxLevel().bloom; bloom.radius = S.bloom[1]; bloom.threshold = S.bloom[2];
```

- [ ] **Step 3: Qualità adattiva solo in Auto** — `const QUALITY = { pr: PR, ...` → `{ pr: gfxMaxPR(), ...`. In `adaptQuality`, dopo la riga `QUALITY.hold = ...`:
```js
  if (SETTINGS.gfx.quality !== 'auto') { QUALITY.acc = QUALITY.n = 0; return; }
```
e nella riga `else if (avg < 1 / 57 && QUALITY.pr < PR ...` sostituire entrambi `PR` con `gfxMaxPR()`.
Verificare: `grep -n "\bPR\b" index.html` → nessun risultato.

- [ ] **Step 4: applyGfx + FPS** — nella sezione OPZIONI (interfaccia), dopo `applyAudio`:
```js
function applyGfx() {
  const L = gfxLevel();
  // ombre: cambiare castShadow cambia lo stato luci e i materiali si ricompilano da soli
  const typeChanged = renderer.shadowMap.type !== L.type;
  renderer.shadowMap.enabled = L.shadows; renderer.shadowMap.type = L.type; sun.castShadow = L.shadows;
  if (sun.shadow.mapSize.x !== L.map) { sun.shadow.mapSize.set(L.map, L.map); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (typeChanged) scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  bloom.enabled = L.bloom > 0; bloom.strength = BLOOM_BASE * L.bloom;
  for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples !== L.samples) { t.samples = L.samples; t.dispose(); }
  QUALITY.acc = QUALITY.n = 0; QUALITY.hold = 0;
  setRenderScale(gfxMaxPR());
  show('fps', SETTINGS.gfx.fps);
}
const FPS = { n: 0, t0: 0 };
function fpsTick(now) {
  if (!SETTINGS.gfx.fps) return;
  FPS.n++;
  if (now - FPS.t0 >= 500) { $('fps').textContent = Math.round(FPS.n * 1000 / (now - FPS.t0)) + ' FPS · ' + renderer.getPixelRatio().toFixed(2) + 'x'; FPS.n = 0; FPS.t0 = now; }
}
```
Scheda:
```js
  gfx: () => [
    choiceRow('Qualità', SETTINGS.gfx, 'quality', [['auto', 'AUTO'], ['low', 'BASSA'], ['medium', 'MEDIA'], ['high', 'ALTA']], applyGfx),
    checkRow('Mostra FPS', SETTINGS.gfx, 'fps', applyGfx),
    [el('span', { className: 'warn ofull' }, 'Auto: parte da Alta e abbassa la risoluzione se il PC non regge i 45 FPS.')],
  ],
```
`applySettings`: `function applySettings() { applyAudio(); applyGfx(); }`
In `frame(now)`, subito dopo `requestAnimationFrame(frame);`:
```js
  fpsTick(now);
```

- [ ] **Step 5: Test automatici** — `node --test tests/` → PASS.

- [ ] **Step 6: Verifica nel browser**
- Opzioni → Grafica → Mostra FPS: contatore in alto a sinistra.
- In gara (pausa → opzioni) passare Bassa/Media/Alta: Bassa senza ombre né bagliore, FPS più alti; Alta con ombre morbide; nessun errore in console, niente schermo nero.
- Livello fisso: il pixel ratio del contatore non cambia da solo. Auto: può scendere sotto il massimo.
- Ricarica pagina: livello mantenuto.

---

### Task 4: Scheda Controlli (rimappatura)

**Files:**
- Modify: `index.html` — `readInput()` (~r.2847), listener `keydown` (preventDefault), `G.lookBack` in `frame()`, sezione OPZIONI (interfaccia), `applySettings`.

**Interfaces:**
- Consumes: `SETTINGS.keys`, `KEY_ACTIONS`, `keyLabel`, `OPT.capture`, `optionsKey` (Task 1–2).
- Produces: `keyDown(action) -> boolean`, `renderControlsHelp()`.

- [ ] **Step 1: keyDown** — nella sezione INPUT, subito dopo `const keys = {};`:
```js
const keyDown = a => SETTINGS.keys[a].some(c => c && keys[c]);
```

- [ ] **Step 2: readInput** — sostituire:
```js
  if (keys.ArrowLeft || keys.KeyA) kt -= 1;
  if (keys.ArrowRight || keys.KeyD) kt += 1;
```
con
```js
  if (keyDown('left')) kt -= 1;
  if (keyDown('right')) kt += 1;
```
e
```js
  let throttle = !!(keys.ArrowUp || keys.KeyW), brake = !!(keys.ArrowDown || keys.KeyS);
  let drift = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight);
  let item = !!(keys.KeyE || keys.KeyK || keys.KeyX || keys.ControlLeft);
```
con
```js
  let throttle = keyDown('throttle'), brake = keyDown('brake');
  let drift = keyDown('drift');
  let item = keyDown('item');
```
In `frame()`: `G.lookBack = !!keys.KeyQ;` → `G.lookBack = keyDown('look');`

- [ ] **Step 3: preventDefault** — nel listener `keydown`, sostituire
```js
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
```
con (non blocca la digitazione nei campi nome/codice)
```js
  if (!(e.target && e.target.tagName === 'INPUT') && KEY_ACTIONS.some(([a]) => SETTINGS.keys[a].includes(e.code))) e.preventDefault();
```

- [ ] **Step 4: Scheda e aiuto nel titolo** — nella sezione OPZIONI (interfaccia):
```js
function keySlot(a, i) {
  const wait = OPT.capture && OPT.capture[0] === a && OPT.capture[1] === i;
  const b = el('button', { className: 'okey' + (wait ? ' wait' : '') }, wait ? 'premi un tasto…' : keyLabel(SETTINGS.keys[a][i]));
  b.onclick = () => { OPT.capture = [a, i]; renderOptions(); };
  return b;
}
function renderControlsHelp() {
  const kb = a => SETTINGS.keys[a].filter(Boolean).map(c => '<kbd>' + keyLabel(c) + '</kbd>').join('/') || '—';
  $('ctrlHelp').innerHTML = [
    [kb('throttle'), 'Accelera'], [kb('brake'), 'Frena / Retro'], [kb('left') + ' ' + kb('right'), 'Sterza'],
    [kb('drift'), 'Salto e derapata (tieni premuto)'], [kb('item'), 'Usa oggetto'], [kb('look'), 'Guarda dietro'],
    ['<kbd>ESC</kbd>/<kbd>P</kbd>', 'Pausa'],
  ].map(([k, t]) => `<span>${k}</span><span>${t}</span>`).join('');
}
```
Scheda:
```js
  keys: () => [
    ...KEY_ACTIONS.map(([a, label]) => [el('span', {}, label), keySlot(a, 0), keySlot(a, 1)]),
    [el('span', { className: 'warn ofull' }, 'Clic su un tasto e premi quello nuovo · ESC annulla · ⌫ svuota · ESC, P e INVIO sono fissi')],
  ],
```
`applySettings`: `function applySettings() { applyAudio(); applyGfx(); renderControlsHelp(); }`

- [ ] **Step 5: Test automatici** — `node --test tests/` → PASS; `grep -n "keys\.Key\|keys\.Arrow\|keys\.Space\|keys\.Shift\|keys\.Control" index.html` → nessun risultato.

- [ ] **Step 6: Verifica nel browser**
- Titolo: aiuto comandi mostra i tasti correnti (E/X per oggetto, non più K).
- Controlli → clic su "SPAZIO" (drift) → premi J → slot mostra J; in gara J fa derapata, Spazio no.
- Assegnare A a "Accelera" → "Sterza a sinistra" riceve il vecchio tasto (scambio).
- P durante la cattura: ignorato, resta "premi un tasto…". Esc: annulla. ⌫: slot "—".
- Online → campo nome: si possono scrivere W, A, S, D, E, Q e spazi.
- PREDEFINITI nella scheda Controlli ripristina i tasti.

---

### Task 5: Scheda Gioco (sterzo, camera, scuotimento)

**Files:**
- Modify: `index.html` — fine di `readInput()`, `chaseCam()` (~r.3765–3773), sezione OPZIONI (interfaccia).

**Interfaces:**
- Consumes: `SETTINGS.game`, `CAM_DIST`, `rangeRow`, `choiceRow`, `checkRow`.
- Produces: nulla di nuovo.

- [ ] **Step 1: Sensibilità sterzo** — in `readInput()`:
```js
  const inp = { steer: clamp(steer, -1, 1), throttle, ...
```
→
```js
  const inp = { steer: clamp(steer * SETTINGS.game.steerSens, -1, 1), throttle, ...
```
(resto della riga invariato).

- [ ] **Step 2: Camera** — in `chaseCam`, sostituire
```js
  camTarget.set(k.pos.x - fx * 8.6 * back, k.pos.y + 3.6, k.pos.z - fz * 8.6 * back);
```
con
```js
  const cd = CAM_DIST[SETTINGS.game.cam] || 1;
  camTarget.set(k.pos.x - fx * 8.6 * cd * back, k.pos.y + 3.6 * cd, k.pos.z - fz * 8.6 * cd * back);
```
e
```js
  if (G.shake > 0) { camera.position.x += rand(-1, 1) * G.shake; camera.position.y += rand(-1, 1) * G.shake * 0.6; G.shake = Math.max(0, G.shake - dt * 1.5); }
```
con
```js
  if (G.shake > 0) {
    if (SETTINGS.game.shake) { camera.position.x += rand(-1, 1) * G.shake; camera.position.y += rand(-1, 1) * G.shake * 0.6; }
    G.shake = Math.max(0, G.shake - dt * 1.5);
  }
```

- [ ] **Step 3: Scheda**:
```js
  game: () => [
    rangeRow('Sensibilità sterzo', SETTINGS.game, 'steerSens', 0.5, 1.5, () => {}),
    choiceRow('Telecamera', SETTINGS.game, 'cam', [['near', 'VICINA'], ['normal', 'NORMALE'], ['far', 'LONTANA']], () => {}),
    checkRow('Scuotimento schermo', SETTINGS.game, 'shake', () => {}),
  ],
```

- [ ] **Step 4: Test automatici** — `node --test tests/` → PASS.

- [ ] **Step 5: Verifica nel browser**
- Sterzo 50%: curve più larghe con tastiera e gamepad.
- Telecamera Lontana/Vicina: distanza diversa, anche con Q (guarda dietro).
- Scuotimento off: colpo di sfera o atterraggio senza vibrazione.
- Ricarica: valori mantenuti. DevTools → `localStorage.setItem('tki-settings','{rotto')` → ricarica → gioco parte coi default.
