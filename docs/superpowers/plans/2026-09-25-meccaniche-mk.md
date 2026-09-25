# Meccaniche MK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scia, deltaplano, cadute con recupero e 5 oggetti nuovi, integrati nel `Kart`, bot e online.

**Architecture:** Logica pura in una nuova sezione `//  MECCANICHE (logica pura)` tra OPZIONI (dati) e RENDERER, testata con Node. Il resto estende `Kart.update/updateVisual/useItem/hit`, `aiInput`, `updateRaceObjects`, `setupTrack/autoLayout/groundInfo/terrainY`, fence e rete (`netState/netApply/netApplyEvent`).

**Tech Stack:** three.js 0.169, PeerJS, `node --test`, Edge headless via CDP per smoke test.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-09-25-meccaniche-mk-design.md`.
- Autorità locale: effetti applicati solo a kart `!remote`; `hit()` già ignora i remoti.
- `netState`: nuovi bit nel flag (16 glide, 32 recupero, 64 pallottola, 128 piccolo) e 2 campi in coda (`bulletT`, `shrinkT`); `netApply` legge i nuovi campi con `?? 0`.
- Niente allocazioni per frame nei cicli nuovi.
- Test: `node --test "tests/*.test.mjs"` sempre verde a fine task.
- Commit locale a fine task, niente push senza ok dell'utente.

---

### Task 1: Logica pura + test

**Files:** Modify `index.html` (nuova sezione prima di `//  RENDERER / SCENE`), Create `tests/mechanics.test.mjs`.

**Produces:** `ITEM_TABLES`, `itemTable(rank, n) -> [id, weight][]`, `draftTarget(x, z, yaw, list, self, maxD = 22) -> index | -1` (list: oggetti con `.pos.x/.pos.z`), `respawnIdx(safeIdx, n) -> idx`, `isFallen(y, roadY, wl, liquid) -> bool`, `openSideAt(open, f, side) -> bool`.

- [ ] Step 1: test `tests/mechanics.test.mjs` (estrae la sezione tra `//  MECCANICHE (logica pura` e `//  RENDERER / SCENE` con `new Function`):
  - `itemTable`: pesi positivi; 1° senza `blue/bolt/bullet`; `bullet` solo con `r > 0.6`; `n = 1` non esplode.
  - `draftTarget`: kart davanti a 10 m → indice; dietro → -1; di lato a 30° → -1; a 30 m → -1; se stesso ignorato; sceglie il più vicino.
  - `respawnIdx(3, 100) === 95`, `respawnIdx(50, 100) === 42`.
  - `isFallen`: `y = roadY - 13` → true; `-11` → false; liquido `y < wl + 0.2` → true; senza liquido → false.
  - `openSideAt([[0.2, 0.3, 1]], 0.25, 1)` true, lato -1 false, `0.35` false; `side 0` = entrambi; tratto a cavallo `[[0.95, 0.05, -1]]` con `f = 0.01` → true.
- [ ] Step 2: `node --test "tests/*.test.mjs"` → FAIL (sezione mancante).
- [ ] Step 3: sezione:
```js
// =====================================================================
//  MECCANICHE (logica pura) — niente DOM/THREE: testata da tests/mechanics.test.mjs
// =====================================================================
const ITEM_TABLES = [
  [0,   [['banana', 35], ['green', 30], ['coin', 25], ['fire', 10]]],
  [0.3, [['banana', 20], ['green', 25], ['red', 20], ['turbo', 15], ['fire', 15], ['gold', 5]]],
  [0.6, [['red', 25], ['turbo', 20], ['triple', 15], ['gold', 15], ['fire', 10], ['star', 8], ['blue', 4], ['bolt', 3]]],
  [1,   [['triple', 25], ['star', 18], ['gold', 15], ['bullet', 15], ['red', 12], ['blue', 8], ['bolt', 7]]],
];
function itemTable(rank, n) {
  if (rank <= 0) return ITEM_TABLES[0][1];
  const r = n > 1 ? rank / (n - 1) : 0;
  for (let i = 1; i < ITEM_TABLES.length; i++) if (r <= ITEM_TABLES[i][0]) return ITEM_TABLES[i][1];
  return ITEM_TABLES[ITEM_TABLES.length - 1][1];
}
const DRAFT_COS = Math.cos(12 * Math.PI / 180);
// indice in `list` del kart più vicino davanti entro maxD e ±12°, -1 se nessuno
function draftTarget(x, z, yaw, list, self, maxD = 22) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best = -1, bd = maxD * maxD;
  for (let i = 0; i < list.length; i++) {
    const o = list[i]; if (o === self) continue;
    const dx = o.pos.x - x, dz = o.pos.z - z, d2 = dx * dx + dz * dz;
    if (d2 >= bd || d2 < 4) continue;
    if ((dx * fx + dz * fz) / Math.sqrt(d2) < DRAFT_COS) continue;
    best = i; bd = d2;
  }
  return best;
}
const respawnIdx = (safeIdx, n) => ((safeIdx - 8) % n + n) % n;
const isFallen = (y, roadY, wl, liquid) => y < roadY - 12 || (liquid && y < wl + 0.2);
// tratto aperto (senza barriera) sul lato `side` alla frazione di giro f
function openSideAt(open, f, side) {
  for (const [a, b, s] of open) {
    if (s !== 0 && s !== side) continue;
    if (a <= b ? f >= a && f <= b : f >= a || f <= b) return true;
  }
  return false;
}

```
- [ ] Step 4: test → PASS. Commit `feat: logica pura meccaniche MK + test`.

---

### Task 2: Scia

**Files:** Modify `index.html`: costanti colori (vicino a `TRICK_COLS`), costruttore `Kart`, `Kart.update`, `Kart.updateVisual`, `aiInput`.

- [ ] Step 1: dopo la riga con `TRICK_COLS`:
```js
const DRAFT_COLS = [C(0xffffff), C(0xbfefff), C(0x8fdcff)];
```
- [ ] Step 2: costruttore, dopo `this.moveYaw = this.yaw; this.steerIn = 0;`:
```js
    this.draftT = 0; this.draftCd = 0;
```
- [ ] Step 3: `update`, subito prima di `// pads`:
```js
    // scia: dietro a un kart per 1,4 s → turbo
    if (this.draftCd > 0) { this.draftCd -= dt; this.draftT = 0; }
    else if (this.grounded && this.speed > 0.6 * cc.max && draftTarget(this.pos.x, this.pos.z, this.yaw, G.karts, this) >= 0) {
      this.draftT += dt;
      if (this.draftT >= 1.4) { this.boost(1.2, DRAFT_COLS); this.draftT = 0; this.draftCd = 1; }
    } else this.draftT = Math.max(0, this.draftT - 2 * dt);
```
- [ ] Step 4: `updateVisual`, prima di `if (!this.onRoad && this.grounded ...` (particelle): linee d'aria solo giocatore
```js
    if (this.isPlayer && this.draftT > 0.3) {
      for (let k = 0; k < 2; k++) {
        const [x, y, z] = wp(rand(-1.8, 1.8), rand(0.4, 1.8), rand(1, 3));
        FX.emit(x, y, z, -fx * 30, 0, -fz * 30, DRAFT_COLS[0], 0.25, 0.12, 0);
      }
    }
```
- [ ] Step 5: `aiInput`, subito prima di `off = clamp(off, -HW + 2, HW - 2);`:
```js
  // rettilineo: mettiti in scia al kart davanti
  if (Math.abs(wrapA(ANG[wrapI(k.idx + 30)] - ANG[k.idx])) < 0.15) { const j = draftTarget(k.pos.x, k.pos.z, k.yaw, G.karts, k, 25); if (j >= 0) off = lerp(off, G.karts[j].lat, 0.7); }
```
- [ ] Step 6: test → PASS. Commit `feat: scia`.

---

### Task 3: Deltaplano

**Files:** Modify `index.html`: `groundInfo`, `autoLayout`, mappe (isola `ramps`, canyon/vulcano `auto.glides`), `placeGameObjects` (texture rampe glide), costruttore/`update`/`land`/`updateVisual` del `Kart`, `netState/netApply`.

- [ ] Step 1: `groundInfo`: registra la rampa sotto al kart. Sostituire il ciclo `for (const R of RAMPS)` e la riga `out.idx = ...` con:
```js
  let onRamp = null;
  for (const R of RAMPS) {
    let di = best - R.idx; if (di > N / 2) di -= N; if (di < -N / 2) di += N;
    if (di < -12 || di > 12) continue;
    const a = di * SP + al;
    if (a > -R.len / 2 && a < R.len / 2 && Math.abs(lat - R.lat) < R.w / 2) { h += (a + R.len / 2) / R.len * R.h; onRamp = R; }
  }
  out.idx = best; out.lat = lat; out.h = h; out.roadY = roadY; out.al = al; out.ramp = onRamp;
```
- [ ] Step 2: mappe: Isola `ramps: [{ near: [15, -192], h: 2.0, len: 8, w: 12, lat: 0 }]` → `ramps: [{ near: [15, -192], h: 2.6, len: 10, w: 12, lat: 0, glide: true }]`. Canyon `auto: { ramps: 2, ...` → `auto: { ramps: 1, glides: 1, ...`. Vulcano `auto: { ramps: 2, ...` → `auto: { ramps: 1, glides: 1, ...`.
- [ ] Step 3: `autoLayout`, dopo la riga `map.ramps = pick(A.ramps ...)`:
```js
  for (const f of pick(A.glides || 0, 0.1, 0.2, 0.85)) map.ramps.push({ f: r3(f), h: 3, len: 12, w: 13, lat: 0, glide: true });
```
e in `placeGameObjects` la creazione di `R` diventa `const R = { idx: best, len: r.len, w: r.w, h: r.h, lat: r.lat || 0, glide: !!r.glide };`.
- [ ] Step 4: texture arancione per le glide: dopo `const rampTop = ...`:
```js
  const glideTex = PM(canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; for (let k = 0; k < 3; k++) { const y = 40 + k * 70; g.beginPath(); g.moveTo(w / 2, y); g.lineTo(w / 2 + 70, y + 50); g.lineTo(w / 2 + 40, y + 50); g.lineTo(w / 2, y + 22); g.lineTo(w / 2 - 40, y + 50); g.lineTo(w / 2 - 70, y + 50); g.fill(); } }));
  const glideTop = new THREE.MeshStandardMaterial({ map: glideTex, roughness: 0.5, emissive: 0x552200 });
```
e nel `new THREE.Mesh(rg, [...])` usare `R.glide ? glideTop : rampTop` al posto di `rampTop`.
- [ ] Step 5: modello deltaplano (prima di `class Kart`):
```js
const gliderGeo = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1.6, -3.4, 0, -1.2, 3.4, 0, -1.2], 3)); g.computeVertexNormals(); return g; })();
const gliderStrut = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5);
function makeGlider(color) {
  const g = new THREE.Group();
  const wing = new THREE.Mesh(gliderGeo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6 })); wing.position.y = 2.9; g.add(wing);
  for (const s of [-1, 1]) { const st = new THREE.Mesh(gliderStrut, MAT.dark); st.position.set(s * 0.5, 2.1, -0.2); st.rotation.z = s * 0.3; g.add(st); }
  g.userData.glider = true; g.visible = false; g.scale.setScalar(0.01);
  return g;
}
```
(`disposeKartInstance` non tocca geometrie condivise: il materiale dell'ala si libera con `g.children[0].material.dispose()` in `clearRace` — vedi Task 4 Step 7.)
- [ ] Step 6: costruttore: `this.gliding = false; this.rampRef = null; this.rampRefT = 0; this.glider = makeGlider(ch.color); this.mesh.add(this.glider);`
- [ ] Step 7: `update`: dopo `const h = g.h;`:
```js
    if (g.ramp) { this.rampRef = g.ramp; this.rampRefT = 0.3; } else this.rampRefT -= dt;
```
nel ramo decollo `else { this.grounded = false; if (this.vy > 4) { this.rampAir = true; this.vy += 5; } this.airT = 0; }` →
```js
      else { this.grounded = false; if (this.vy > 4) { this.rampAir = true; this.vy += 5; if (this.rampRefT > 0 && this.rampRef && this.rampRef.glide) { this.gliding = true; if (this.isPlayer) sfx.trick(); } } this.airT = 0; }
```
blocco in aria `this.vy -= 36 * dt; this.pos.y += this.vy * dt;` →
```js
      if (this.gliding) {
        const up = inp.throttle && !inp.brake, dn = inp.brake;
        this.vy -= 12 * dt; this.vy = Math.max(this.vy, dn ? -3.5 : up ? -10 : -6);
        if (up) this.speed += 6 * dt;
        this.speed *= Math.exp(-0.04 * dt);
      } else this.vy -= 36 * dt;
      this.pos.y += this.vy * dt;
```
sterzo in aria: nella riga `this.yaw -= s * rate * dt * (this.speed < 0 ? -1 : 1) * (this.grounded ? 1 : 0.35);` → `(this.grounded ? 1 : this.gliding ? 0.6 : 0.35)`.
- [ ] Step 8: `land`: prima riga `this.gliding = false;` dopo `this.grounded = true; this.vy = 0;`.
- [ ] Step 9: `updateVisual`, dopo `this.body.position.y = hopY;`:
```js
    const gv = this.gliding ? 1 : 0;
    this.glideVis = lerp(this.glideVis || 0, gv, 1 - Math.exp(-10 * dt));
    this.glider.visible = this.glideVis > 0.02; this.glider.scale.setScalar(Math.max(0.01, this.glideVis));
```
- [ ] Step 10: rete: nel flag di `netState` aggiungere `| (this.gliding ? 16 : 0)`; in `netApply` dopo `this.onRoad = ...`: `this.gliding = !!(f & 16);`.
- [ ] Step 11: test → PASS. Commit `feat: deltaplano`.

---

### Task 4: Cadute + recupero

**Files:** Modify `index.html`: HTML/CSS overlay `#fade`, `setupTrack` (`OPEN_L/OPEN_R`), `autoLayout` (`auto.open`), mappe, `groundInfo`, `terrainY`, fence, `Kart` (costruttore/update/updateVisual/nuovi metodi), `aiInput`, `clearRace`, rete.

- [ ] Step 1: CSS `#fade { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; z-index: 12; transition: opacity .35s; }`; HTML dopo `<div id="fps" hidden></div>`: `<div id="fade"></div>`.
- [ ] Step 2: stato tracciato: accanto a `let RAMPS = [];`: `let OPEN_L = new Uint8Array(0), OPEN_R = new Uint8Array(0), LIQUID = false;`. In `setupTrack`, dopo `if (map.auto && !map.ramps) autoLayout(map);`:
```js
  OPEN_L = new Uint8Array(N); OPEN_R = new Uint8Array(N);
  const op = map.open || [];
  for (let i = 0; i < N; i++) { OPEN_L[i] = openSideAt(op, i / N, -1) ? 1 : 0; OPEN_R[i] = openSideAt(op, i / N, 1) ? 1 : 0; }
  LIQUID = !!(map.water && (map.water.kind === 'lava' || map.water.kind === 'water'));
```
e helper globale:
```js
const isOpen = (i, lat) => (lat < 0 ? OPEN_L : OPEN_R)[i] === 1;
// dirupo oltre il bordo dei tratti aperti
const openDrop = (i, lat) => isOpen(i, lat) ? -40 * smooth(HW + 4, HW + 16, Math.abs(lat)) : 0;
```
- [ ] Step 3: `autoLayout`, dopo la riga `map.ramps = ...`/glide:
```js
  if (A.open) map.open = pick(A.open.n, 0.12, 0.25, 0.85).map((f, k) => [r3(f), r3(f + A.open.len), k % 2 ? 1 : -1]);
```
mappe: Canyon `auto` + `open: { n: 1, len: 0.04 }`; Picco Glaciale `auto` + `open: { n: 1, len: 0.04 }`; Vulcano `auto` + `open: { n: 2, len: 0.035 }`.
- [ ] Step 4: `groundInfo`: `let h = blendH(roadY, Math.abs(lat), x, z);` → `let h = blendH(roadY, Math.abs(lat), x, z) + openDrop(best, lat);`
  `terrainY`: ultima riga `return nr.d < HW + 2.5 ? ry - 0.2 : blendH(ry, nr.d, x, z);` →
```js
  if (nr.d < HW + 2.5) return ry - 0.2;
  const lat = (x - p.x) * SD[nr.i].x + (z - p.z) * SD[nr.i].z;
  return blendH(ry, nr.d, x, z) + openDrop(nr.i, lat);
```
- [ ] Step 5: fence: nel ciclo `for (const i of segs) for (const s of [-1, 1]) {` prima riga `if (isOpen(i, s)) continue;` (le istanze non scritte restano a matrice zero = invisibili; impostare `posts.count = pi; rails.count = ri;` dopo il ciclo).
- [ ] Step 6: barriera in `update`: `if (Math.abs(g.lat) > WALL) {` → `if (Math.abs(g.lat) > WALL && !isOpen(g.idx, g.lat)) {`.
- [ ] Step 7: `Kart`: costruttore `this.respawnT = 0; this.respawnTo = 0; this.safeIdx = idx; this.drone = null;`.
  In `update`, subito dopo il blocco `if (this.roulette > 0) { ... }`:
```js
    if (this.respawnT > 0) { this.updateRespawn(dt); return; }
```
  prima di `// pads`:
```js
    if (this.grounded && Math.abs(g.lat) < HW) this.safeIdx = this.idx;
    if (isFallen(this.pos.y, g.roadY, WL, LIQUID)) this.startRespawn();
```
  nuovi metodi (dopo `land`):
```js
  startRespawn() {
    if (this.respawnT > 0) return;
    if (this.drifting) this.endDrift(false);
    this.respawnT = 1.5; this.respawnTo = respawnIdx(this.safeIdx, N); this.gliding = false; this.boostT = 0; this.draftT = 0;
    this.coins = Math.max(0, this.coins - 3);
    if (this.isPlayer) { $('fade').style.opacity = 0.85; setTimeout(() => { $('fade').style.opacity = 0; }, 450); sfx.hit(); }
  }
  updateRespawn(dt) {
    const t0 = 1.5 - this.respawnT; this.respawnT -= dt;
    const t = 1.5 - this.respawnT, i = this.respawnTo;
    if (t < 0.4) { this.vy -= 36 * dt; this.pos.y += this.vy * dt; return; }
    if (t0 < 0.4) { const di = i - this.idx; if (di > N / 2) this.lap--; else if (di < -N / 2) this.lap++; this.idx = i; this.progress = this.lap * N + i; }
    const q = clamp((t - 0.4) / 1.0, 0, 1);
    this.pos.set(P[i].x, P[i].y + 7 * (1 - q), P[i].z); this.yaw = this.moveYaw = ANG[i]; this.lat = 0; this.vy = 0; this.speed = 0; this.ext.set(0, 0, 0);
    if (this.respawnT <= 0) { this.respawnT = 0; this.grounded = true; this.invulnT = 1.5; this.pos.y = P[i].y; }
  }
```
  `updateVisual`, dopo `this.mesh.visible = ...`:
```js
    const carried = this.respawnT > 0 && this.respawnT < 1.1;
    if (carried && !this.drone) { this.drone = makeDrone(); scene.add(this.drone); }
    if (this.drone) { this.drone.visible = carried; if (carried) { this.drone.position.set(this.pos.x, this.pos.y + 3.4, this.pos.z); for (const r of this.drone.userData.rotors) r.rotation.y += dt * 40; } }
```
  modello (prima di `class Kart`):
```js
const droneBody = new THREE.BoxGeometry(1.6, 0.5, 1.6), droneRotor = new THREE.BoxGeometry(1.4, 0.05, 0.18), droneCable = new THREE.CylinderGeometry(0.04, 0.04, 3, 4);
const droneMat = new THREE.MeshStandardMaterial({ color: 0xffd000, roughness: 0.4, metalness: 0.3 });
function makeDrone() {
  const g = new THREE.Group(); g.add(new THREE.Mesh(droneBody, droneMat));
  const rotors = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const r = new THREE.Mesh(droneRotor, MAT.dark); r.position.set(x * 0.9, 0.35, z * 0.9); g.add(r); rotors.push(r); }
  const c = new THREE.Mesh(droneCable, MAT.dark); c.position.y = -1.6; g.add(c);
  g.userData.rotors = rotors;
  return g;
}
```
  `clearRace`, dentro il primo ciclo: `for (const k of G.karts) { if (k.drone) scene.remove(k.drone); k.glider.children[0].material.dispose(); scene.remove(k.mesh); disposeKartInstance(k.v); }`.
- [ ] Step 8: rete: flag `| (this.respawnT > 0 ? 32 : 0)`; `netApply`: `this.respawnT = f & 32 ? Math.max(this.respawnT, 0.9) : 0;`; `updateRemote` lista timer + `'respawnT'`.
- [ ] Step 9: `aiInput`: il clamp `off = clamp(off, -HW + 2, HW - 2)` tiene già i bot in strada: nessuna modifica. Il blocco "bloccato" non deve scattare durante il recupero: condizione `if (Math.abs(k.speed) < 4 && k.spinT <= 0 && k.flipT <= 0 && k.respawnT <= 0 && G.state !== 'countdown')`.
- [ ] Step 10: test → PASS. Commit `feat: tratti aperti, cadute e recupero col drone`.

---

### Task 5: Oggetti nuovi

**Files:** Modify `index.html`: `ITEMS/ICON_CYCLE/rollItem`, materiali/pool proiettili, `Kart` (costruttore, `hit`, `useItem`, `update`, `updateVisual`, rete), `aiInput`, `updateRaceObjects` (collisioni, sfere), `netApplyEvent`, HUD (CSS + `updateHUD`), loop gara (input pallottola).

- [ ] Step 1: oggetti:
```js
const ITEMS = {
  turbo: { icon: '⚡', name: 'Turbo' }, triple: { icon: '⚡', name: 'Triplo Turbo' }, banana: { icon: '🍌', name: 'Buccia' },
  green: { icon: '🟢', name: 'Sfera Rimbalzina' }, red: { icon: '🔴', name: 'Sfera Cercatrice' }, star: { icon: '⭐', name: 'Super Stella' }, coin: { icon: '🪙', name: 'Monete' },
  blue: { icon: '🔵', name: 'Sfera Blu' }, bolt: { icon: '🌩️', name: 'Fulmine' }, gold: { icon: '🍄', name: 'Fungo Dorato' }, bullet: { icon: '🚀', name: 'Pallottola' }, fire: { icon: '🔥', name: 'Fiore di Fuoco' },
};
const ICON_CYCLE = ['⚡', '🍌', '🟢', '🔴', '⭐', '🪙', '🔵', '🌩️', '🍄', '🚀', '🔥'];
function rollItem(rank, n) {
  const tbl = itemTable(rank, n);
  let r = Math.random() * tbl.reduce((s, x) => s + x[1], 0);
  for (const [id, w] of tbl) { r -= w; if (r <= 0) return id; }
  return tbl[0][0];
}
```
  chiamata in `updateRaceObjects`: `rollItem(k.rank)` → `rollItem(k.rank, G.karts.length)`.
- [ ] Step 2: proiettili: `shellMat` aggiunge `blue: MeshStandardMaterial({ color: 0x2a6bff, roughness: 0.25, metalness: 0.2, emissive: 0x1030a0, emissiveIntensity: 0.9 })` e `fire: MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff4a00, emissiveIntensity: 1.6, roughness: 0.4 })`. `PROJ_POOL = { banana: [], green: [], red: [], blue: [], fire: [] }`. In `getProj`, ramo `else`: se `kind === 'fire'` solo sfera scala 0.55 senza anello (`s.scale.setScalar(0.55)`), altrimenti come oggi. In `spawnProjectile` `life: d.k === 'red' ? 14 : d.k === 'blue' ? 25 : d.k === 'fire' ? 3 : 9` e aggiungere `f: d.i ?? 0` all'oggetto shell.
- [ ] Step 3: stato kart (costruttore): `this.goldT = 0; this.fireT = 0; this.bulletT = 0; this.shrinkT = 0; this.shrinkVis = 1;`.
  `hit`: prima riga `if (this.remote || this.starT > 0 || this.bulletT > 0 || this.invulnT > 0 || this.respawnT > 0) return false;`.
  `update`, dopo i decrementi dei timer:
```js
    this.bulletT = Math.max(0, this.bulletT - dt); this.shrinkT = Math.max(0, this.shrinkT - dt);
    if (this.goldT > 0 && (this.goldT -= dt) <= 0 && this.item === 'gold') { this.item = null; this.itemCount = 0; }
    if (this.fireT > 0 && (this.fireT -= dt) <= 0 && this.item === 'fire') { this.item = null; this.itemCount = 0; }
```
  velocità: dopo `if (this.starT > 0) top *= 1.12;`: `if (this.shrinkT > 0) top *= 0.7;`; dopo `if (this.boostT > 0) top = Math.max(...)`: `if (this.bulletT > 0) { top = cc.max * st.speed * 1.5; this.speed = lerp(this.speed, top, 1 - Math.exp(-4 * dt)); }` e la catena `if (stunned) ... else if (this.boostT > 0)` diventa `if (this.bulletT > 0) {} else if (stunned) ...`.
  fine pallottola: dopo il decremento `if (this.bulletT > 0 && this.bulletT <= dt) this.invulnT = 1;` (prima del decremento, controllando il valore vecchio).
- [ ] Step 4: `useItem`, nuovi case:
```js
      case 'blue': {
        const tg = G.ranking[0];
        const d = { k: 'blue', id: this.id + '_' + (++projSeq), o: this.id, x: this.pos.x + fx * 2, y: this.pos.y + 6, z: this.pos.z + fz * 2, dx: fx, dz: fz, i: this.idx, tg: tg ? tg.id : null, sp: this.cfg.max * 1.8 };
        spawnProjectile(d); netSend({ t: 'ev', e: 'spawn', d }); consume(); if (this.isPlayer) sfx.throw(); break;
      }
      case 'bolt': consume(); netSend({ t: 'ev', e: 'bolt', o: this.id }); applyBolt(this.id); break;
      case 'gold': if (this.goldT <= 0) this.goldT = 7; this.boost(1.0); break;
      case 'bullet': this.bulletT = 3; consume(); if (this.isPlayer) sfx.boost(); break;
      case 'fire': {
        if (this.fireT <= 0) this.fireT = 8;
        const d = { k: 'fire', id: this.id + '_' + (++projSeq), o: this.id, x: this.pos.x + fx * 3, y: this.pos.y + 0.8, z: this.pos.z + fz * 3, dx: fx, dz: fz, i: this.idx, tg: null, sp: this.cfg.max * 1.3 };
        spawnProjectile(d); netSend({ t: 'ev', e: 'spawn', d }); if (this.isPlayer) sfx.throw(); break;
      }
```
  funzione (dopo la classe `Kart`):
```js
// fulmine: ogni client rimpicciolisce i propri kart (tranne chi l'ha usato)
function applyBolt(ownerId) {
  flash(); sfx.boom();
  const n = G.karts.length;
  for (const k of G.karts) {
    if (k.remote || k.id === ownerId || k.starT > 0 || k.bulletT > 0 || k.respawnT > 0) continue;
    k.shrinkT = 3 + 3 * (n > 1 ? k.rank / (n - 1) : 0);
    k.item = null; k.itemCount = 0; k.roulette = 0; k.goldT = 0; k.fireT = 0;
    if (k.drifting) k.endDrift(false);
    k.spinT = Math.max(k.spinT, 0.5); k.speed *= 0.6;
  }
}
```
  `netApplyEvent`: `else if (d.e === 'bolt') applyBolt(d.o);`.
- [ ] Step 5: collisioni tra kart (`updateRaceObjects`): sostituire
```js
      if (a.starT > 0 && b.starT <= 0) b.hit('flip');
      if (b.starT > 0 && a.starT <= 0) a.hit('flip');
```
con
```js
      const inv = k => k.starT > 0 || k.bulletT > 0;
      if (inv(a) && !inv(b)) b.hit('flip');
      if (inv(b) && !inv(a)) a.hit('flip');
      if (a.shrinkT > 0 && b.shrinkT <= 0) a.hit('flip');
      if (b.shrinkT > 0 && a.shrinkT <= 0) b.hit('flip');
```
- [ ] Step 6: sfere (`updateRaceObjects`), all'inizio del corpo del ciclo dopo `let dead = s.life <= 0, hitSent = false;`:
```js
    if (s.type === 'blue') { if (updateBlue(s, dt) || dead) { shellBurst(s); freeProj('blue', s.g); G.shells.splice(i, 1); } continue; }
```
  colpo generico `k.hit('flip')` → `k.hit(s.type === 'fire' ? 'spin' : 'flip')`; particelle: `if (s.type === 'fire' && Math.random() < 0.8) FX.emit(s.pos.x, s.pos.y, s.pos.z, rand(-1, 1), rand(0, 2), rand(-1, 1), C(0xff8a1a), 0.7, 0.3, 0);`.
  funzione:
```js
// sfera blu: vola sopra la pista fino al primo, poi picchia e esplode (raggio 8)
function updateBlue(s, dt) {
  if (!s.target || s.target.finished) s.target = G.ranking[0] || null;
  const tg = s.target; if (!tg) return true;
  s.g.rotation.y += dt * 12; if (s.g.scale.x < 1) s.g.scale.setScalar(Math.min(1, s.g.scale.x + dt * 8));
  let gap = tg.idx - Math.floor(s.f); if (gap < 0) gap += N;
  if (gap > 25) {
    s.f = (s.f + s.speed * dt / SP) % N; const i = Math.floor(s.f);
    s.pos.set(P[i].x, P[i].y + 6, P[i].z); s.idx = i;
  } else {
    const dx = tg.pos.x - s.pos.x, dy = tg.pos.y + 1 - s.pos.y, dz = tg.pos.z - s.pos.z, d = Math.hypot(dx, dy, dz);
    if (d < 1.5) {
      for (const k of G.karts) if (!k.remote && k.pos.distanceTo(s.pos) < 8) k.hit('flip');
      for (let q = 0; q < 60; q++) FX.emit(s.pos.x, s.pos.y, s.pos.z, rand(-16, 16), rand(0, 16), rand(-16, 16), C(q % 2 ? 0x2a6bff : 0xffffff), rand(0.8, 1.6), 0.7, 10);
      return true;
    }
    const st = Math.min(d, s.speed * 0.8 * dt);
    s.pos.x += dx / d * st; s.pos.y += dy / d * st; s.pos.z += dz / d * st;
  }
  s.g.position.copy(s.pos);
  if (FX && Math.random() < 0.8) FX.emit(s.pos.x, s.pos.y, s.pos.z, rand(-1, 1), rand(0, 1), rand(-1, 1), C(0x4a8bff), 0.7, 0.3, 0);
  return false;
}
```
- [ ] Step 7: pallottola = input IA. Loop gara: `const ki = (k.isPlayer && G.state === 'race' && !G.autopilot) ? inp : aiInput(k, sdt);` → `const ki = (k.isPlayer && G.state === 'race' && !G.autopilot && k.bulletT <= 0) ? inp : aiInput(k, sdt);`. In `aiInput` il blocco oggetti: `if (k.item && k.roulette <= 0) {` → `if (k.item && k.roulette <= 0 && !k.isPlayer) {` e regole nuove dentro `if (k.itemT <= 0) { let use = true; ...`:
```js
      else if (k.item === 'fire') use = G.karts.some(o => o !== k && o.pos.distanceTo(k.pos) < 30 && Math.abs(wrapA(Math.atan2(o.pos.x - k.pos.x, o.pos.z - k.pos.z) - k.yaw)) < 0.3) || k.itemT < -3;
      else if (k.item === 'blue') use = k.rank > 0 || k.itemT < -6;
      else if (k.item === 'bullet') use = k.speed > 0.5 * k.cfg.max;
      if (use) { inp.itemPressed = true; k.itemT = k.item === 'gold' ? 0.5 : k.item === 'fire' ? rand(0.4, 1.2) : rand(0.6, 3); }
```
  (sostituisce la riga `if (use) { inp.itemPressed = true; k.itemT = rand(0.6, 3); }`).
- [ ] Step 8: visual: `updateVisual`, dopo il blocco deltaplano:
```js
    this.shrinkVis = lerp(this.shrinkVis, this.shrinkT > 0 ? 0.55 : 1, 1 - Math.exp(-10 * dt));
    this.mesh.scale.setScalar(this.shrinkVis);
```
  pallottola: nella riga stella `if (this.starT > 0) { this.paint.emissive.setHSL(...` aggiungere prima `if (this.bulletT > 0) { this.paint.emissive.setRGB(0.05, 0.05, 0.08); this.paint.emissiveIntensity = 1; } else ` (e il ramo `else if (this.paint.emissiveIntensity !== 0)` resta); particelle turbo anche con `this.bulletT > 0`: `if (this.boostT > 0 || this.bulletT > 0) {`.
- [ ] Step 9: rete: flag `| (this.bulletT > 0 ? 64 : 0) | (this.shrinkT > 0 ? 128 : 0)`; coda array `, r(this.bulletT), r(this.shrinkT)`; `netApply`: `this.bulletT = s[23] ?? 0; this.shrinkT = s[24] ?? 0;`; `updateRemote` timer + `'bulletT', 'shrinkT'`.
- [ ] Step 10: HUD timer: CSS `#itembox.timed { background: conic-gradient(rgba(255,208,0,.55) calc(var(--t) * 1turn), rgba(10,10,30,.45) 0); }`; `updateHUD`, dopo `setHud('rolling', ...)`:
```js
  const tm = p.goldT > 0 ? p.goldT / 7 : p.fireT > 0 ? p.fireT / 8 : 0;
  setHud('timed', tm > 0, v => ib.classList.toggle('timed', v));
  if (tm > 0) ib.style.setProperty('--t', tm.toFixed(3));
```
- [ ] Step 11: test → PASS. Commit `feat: sfera blu, fulmine, fungo dorato, pallottola, fiore di fuoco`.

---

### Task 6: Smoke test headless

**Files:** Create `tests/smoke-mechanics.mjs` (non parte di `node --test`: richiede server + Edge). Script CDP come quello delle opzioni:
1. Avvia gara su Vulcano (via `window.__game` + click UI), attende `race`.
2. Per ogni oggetto `['blue','bolt','gold','bullet','fire']`: assegna `G.player.item`, `itemCount = 1`, invoca `G.player.useItem()`; attende 0,5 s; verifica: blu in `G.shells`, bot `shrinkT > 0` dopo fulmine, `goldT > 0`, `bulletT > 0`, proiettile `fire`.
3. Recupero: sposta il giocatore a `lat = HW + 20` su un indice aperto, attende 2 s → `respawnT === 0` e `|lat| < HW`.
4. Deltaplano: posiziona il giocatore 30 m prima di una rampa glide a velocità max → entro 2 s `gliding === true`, poi `false` entro 8 s.
5. Scia: posiziona un bot 10 m davanti, stessa direzione, entrambi a velocità 0,8 max per 2 s → `boostT > 0` o `draftCd > 0`.
6. 0 errori console.

Richiede di esporre in `window.__game` anche `get RAMPS()`, `get OPEN_L()`, `get OPEN_R()`, `HW`, `SD`, `ANG`. Commit `test: smoke meccaniche MK`.
