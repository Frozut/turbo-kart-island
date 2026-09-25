# Meccaniche stile Mario Kart — Design

Data: 2026-09-25
Coda progetti: [menu opzioni ✔] → **meccaniche MK** (assorbe "nuovi oggetti + IA") → piste più complicate → animazioni → contro il tempo + fantasma → split screen.

## Obiettivo
Quattro meccaniche nuove, integrate nel `Kart` esistente, compatibili con bot e online (PeerJS):
1. Scia (slipstream)
2. Deltaplano
3. Cadute + recupero
4. Cinque oggetti nuovi + uso da parte dei bot

## Vincoli
- Tutto in `index.html` (modulo unico). Logica pura in sezioni senza DOM/THREE, testabile con `node --test` (stesso schema di `tests/settings.test.mjs`).
- Online: autorità locale sul proprio kart (come oggi: `hit()` ignora i kart remoti). Nuovi campi di `netState()` solo in coda all'array; bit nuovi nel campo flag.
- Nessuna regressione su piste senza i nuovi campi mappa (`open`, rampe `glide`).
- Prestazioni: niente allocazioni per frame nei cicli nuovi (riusare vettori, pool come `PROJ_POOL`).

## 1. Scia
- Per ogni kart locale (giocatore + bot), ogni frame: cerca un kart `o` con distanza < 22, angolo tra direzione propria e vettore verso `o` < 12°, `speed > 0.6 * max`. Se trovato `draftT += dt`, altrimenti `draftT = max(0, draftT - 2*dt)`.
- `draftT >= 1.4` → `boost(1.2, DRAFT_COLS)`, `draftT = 0`, cooldown 1 s.
- Visual (solo giocatore): linee d'aria bianche (particelle FX sottili ai lati) mentre `draftT > 0.3`; suono fruscio al turbo.
- Funzione pura `draftTarget(self, others) -> index | -1` (input: posizioni/yaw/velocità come numeri).
- Bot: sui rettilinei (curvatura bassa) spostano `aiOff` verso la linea del kart davanti entro 25 m.

## 2. Deltaplano
- Rampa `{ ..., glide: true }` (anche in `auto.glides: n`): mesh arancione con frecce bianche, più lunga (len 12) e alta (h 3).
- Decollo da rampa glide → `gliding = true`, mesh deltaplano (ala a triangolo + aste) apre con animazione scala 0→1 in 0,3 s.
- Fisica in volo: gravità 12 (invece di 36); `vy` limitata a ≥ -6; velocità decade 4%/s; sterzo ×0,6; input su (throttle) → `vy -= 8*dt` e `+speed`; giù (brake) → `vy += 4*dt` (plana più a lungo).
- Atterraggio → chiusura ala, `gliding = false`; acrobazia (drift in aria) dà boost come oggi.
- Rete: bit flag 16 = gliding (per il mesh remoto).
- Piste: Isola (rampa esistente → glide), Canyon (1 glide sopra gola), Vulcano (1 glide sopra lava).

## 3. Cadute + recupero
- Mappa: `open: [[f0, f1, side]]` (frazioni di giro, side −1/1/0=entrambi). Nei tratti aperti: nessuna barriera `WALL` né staccionata su quel lato; terreno oltre `HW + 4` scende di 40 (dirupo) salvo acqua/lava già sotto.
- Caduta: `pos.y < roadY - 12` oppure (`pos.y < WL + 0.2` e mappa con acqua/lava) → `fallT` avvia recupero:
  1. dissolvenza (solo giocatore: overlay nero 0,4 s),
  2. drone (mesh semplice: corpo + 4 eliche + cavo) scende e riporta il kart all'ultimo `safeIdx` (ultimo indice con `onRoad && grounded`, arretrato di 8), `lat = 0`,
  3. velocità 0, `invulnT = 1.5`, perde 3 monete, oggetto mantenuto. Durata totale 1,5 s, input ignorati.
- Funzione pura `respawnIdx(safeIdx, N) -> idx` e `isFallen(y, roadY, WL, hasLiquid) -> bool`.
- Bot: dentro i tratti aperti limitano `|lat| <= HW - 2`; se cadono usano lo stesso recupero.
- Piste: Vulcano (lava, 2 tratti), Picco Glaciale (dirupo, 1 tratto), Canyon (gola, 1 tratto).
- Rete: bit flag 32 = in recupero (kart remoto nascosto durante il trasporto).

## 4. Oggetti nuovi

| id | icona | effetto |
|---|---|---|
| `blue` | 🔵 | Proiettile che segue la pista (indici P) a +6 m di quota, velocità 1,8× max, fino al kart in 1ª posizione; esplosione raggio 8 → `hit('flip')` a chiunque nel raggio (anche chi l'ha lanciata). |
| `bolt` | ⚡ | Evento rete `{ e: 'bolt', o }`: ogni client rimpicciolisce il proprio kart se non è `o` e non ha stella: `shrinkT = 3 + 3 * rank/(n-1)`, `speed max ×0.7`, oggetto perso, `hit('spin')` breve. Kart normale che tocca un kart rimpicciolito → quello rimpicciolito `hit('flip')`. Mesh scalato 0,55. |
| `gold` | 🍄 | `goldT = 7`: ogni pressione oggetto → `boost(1.0)`; finito il tempo l'oggetto sparisce. |
| `bullet` | 🚀 | `bulletT = 3`: guida automatica (sterzo dall'IA `aiSteer`), velocità 1,5× max, invincibile come stella; kart toccati → `hit('flip')`. Bit flag 64 in rete; ogni client controlla il contatto del proprio kart con kart remoti in modalità pallottola. |
| `fire` | 🔥 | `fireT = 8`: ogni pressione lancia `fire` (proiettile, vita 3 s, velocità 1,3× max, rimbalza sui muri come la verde) → `hit('spin')`. |

- Tabella probabilità (funzione pura `itemTable(rank, n)`), rank normalizzato `r = rank/(n-1)`:
  - 1°: banana 35, verde 30, moneta 25, fuoco 10
  - r ≤ 0.3: banana 20, verde 25, rossa 20, turbo 15, fuoco 15, fungo dorato 5
  - r ≤ 0.6: rossa 25, turbo 20, triplo 15, fungo dorato 15, fuoco 10, stella 8, blu 4, fulmine 3
  - resto: triplo 25, stella 18, fungo dorato 15, pallottola 15, rossa 12, blu 8, fulmine 7
- Bot (regole): fulmine/stella/pallottola appena ricevuti (pallottola se velocità > 0.5 max); fungo dorato: premi ogni 0,5 s; fuoco: lancia se kart davanti entro 30 m; blu: subito se non sono 1°.
- HUD: `ICON_CYCLE` e `ITEMS` aggiornati; timer circolare sull'itembox per oggetti a tempo (fungo dorato, fuoco).

## Test
- Node (`tests/mechanics.test.mjs`): `itemTable` (somme, nessun blu/fulmine/pallottola al 1°, pallottola solo in coda), `draftTarget` (davanti/dietro/fuori cono/troppo lontano), `respawnIdx`, `isFallen`.
- Headless Edge (script come smoke opzioni): gara Isola/Vulcano, via script: forza ogni oggetto al giocatore e usalo; teletrasporta fuori dal bordo aperto → recupero entro 2 s; salto dalla rampa glide → `gliding` vero poi falso; scia dietro un bot per 2 s → `boostT > 0`; 0 errori console.

## Fuori scopo
Anti-gravità, cannoni, sott'acqua, piste nuove (progetto successivo), bilanciamento fine dei bot.
