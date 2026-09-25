# Piste più complesse — Design

Data: 2026-09-25. Approvato in chat.

## Obiettivo
Motore piste con **larghezza variabile**, **ponti/incroci** e **bivi/scorciatoie**; poi **3 piste nuove** lunghe (~2× Isola) che li usano. Le 5 piste esistenti restano identiche (test di non regressione).

## Fasi (ognuna chiude con gioco funzionante + test)

### Fase 0 — Test di non regressione
Script headless che per ogni mappa esistente chiama `setupTrack` e campiona `groundInfo`/`terrainY` su una griglia + `P`, `SD`, `N`; salva un'impronta (`tests/track-baseline.json`). Dopo ogni fase l'impronta deve essere identica.

### Fase 1 — Larghezza variabile
- Punto di controllo opzionale 4° valore: `[x, y, z, w]` = mezza larghezza (default `HW = 12`).
- `HWA: Float32Array(N)` interpolato come la curva (Catmull-Rom sui valori `w`, clamp 7..22).
- `hw(i)` e `wall(i) = hw(i) + 11.5` sostituiscono `HW`/`WALL` dove dipendono dalla posizione: ribbon strada/cordoli/marciapiedi (lat funzione di `i`), `groundInfo` (onRoad, muro, `openDrop`), `terrainY`/`blendH` (BLEND relativo a hw), staccionata, `skirt`, piloni, linea del traguardo, `aiInput` (clamp), `placeGameObjects` (box, monete, pad), `autoLayout` (geyser lat), muri dei proiettili, `isOpen/openDrop`, respawn/`safeIdx`, smoke test.

### Fase 2 — Ponti e incroci
- Mappa: `deck: [[f0, f1]]` tratti sopraelevati (piloni, bordi, marciapiede come Neon ma locali).
- `nearestGlobal` / `terrainY` / scatter: ignorano gli indici `deck` (il terreno segue la strada sotto, non il ponte); la strada sopraelevata non modifica il terreno.
- `groundInfo(x, z, hint)` con `hint < 0` (ricerca globale) usa distanza 3D se viene passata una `y` (nuovo parametro opzionale).
- Staccionata sui deck = muretto continuo; `openDrop` non si applica ai deck (il bordo è sempre chiuso se non `open`).
- Requisito di progetto piste: tratti che si incrociano separati da ≥ 9 m di quota.

### Fase 3 — Bivi e scorciatoie
- Mappa: `branches: [{ from: f, to: f, cp: [[x,y,z,w?]...], kind: 'offroad' | 'road', ramps, open }]`: curva aperta da `P[from]` a `P[to]`.
- `PATHS[0]` = pista principale (alias delle globali attuali `P, T, SD, ANG, SLOPE, HWA, N, SP`); `PATHS[k]` = rami con gli stessi campi + `from`, `to` (indici principali).
- Kart: `path` (0 = principale) + `idx` sul percorso. `groundInfo` con hint `(path, idx)` cerca nel percorso corrente e, vicino a imbocco/uscita (±40 indici), anche nell'altro percorso; vince il centro strada più vicino (con quota).
- Progresso: su un ramo `mainIdx = from + (to - from) * j / (n - 1)`. Giri e traguardo solo sul principale.
- Contromano, respawn (`safePath/safeIdx`), rampe/tratti aperti/deltaplano, proiettili (`s.path`), telecamera: path-aware.
- IA: all'imbocco sceglie il ramo con probabilità `skill` per `kind: 'offroad'` (0.3–0.9), 0.5 per `road`; segue il percorso scelto.
- Minimappa: disegna anche i rami.
- `offroad`: tratto sterrato (grip e velocità ridotte se senza turbo/stella: come fuori strada ma meno penalizzante, top × 0.8).

### Fase 4 — Piste nuove
1. **Autodromo 8** (città-stadio notturno): otto con ponte all'incrocio, rettilinei larghi (w 18), chicane strette (w 8).
2. **Giungla Perduta** (giungla): ~2× Isola, bivio strada/scorciatoia fuoristrada con salto sul fiume, rampa deltaplano sulla cascata, tratti aperti sul fiume.
3. **Castello di Nuvole** (cielo): strada sospesa, molti tratti `open` sul vuoto, spirale che passa sopra sé stessa (deck), due strade parallele (bivio `road`), rampe deltaplano.
- Nuova coppa **Coppa Fulmine** con le 3 piste.
- Decor e atmosfera: riuso dei sistemi esistenti (terreno 'island'/'city', decor esistenti) con palette nuove; niente asset esterni.

## Test
- Impronta di non regressione (Fase 0) dopo ogni fase.
- Node: logica pura nuova (interpolazione larghezze, proiezione ramo→principale, scelta ramo IA).
- Headless: smoke meccaniche + telefono su pista vecchia; per le nuove piste: giro completo del bot giocatore in autopilota senza cadute infinite né blocchi (≤ 2 recuperi/giro), passaggio sotto/sopra il ponte, uso della scorciatoia.
