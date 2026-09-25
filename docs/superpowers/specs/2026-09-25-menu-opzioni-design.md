# Menu Opzioni — Design

Data: 2026-09-25
Sotto-progetto 1 di 4 (poi: contro il tempo + fantasma, nuovi oggetti + IA, split screen).

## Obiettivo
Pannello OPZIONI apribile da schermata titolo e menu pausa, con 4 schede (Audio, Grafica, Controlli, Gioco). Impostazioni salvate in `localStorage` e applicate subito.

## Approccio
Nuova sezione `SETTINGS` dentro `index.html` (il gioco è un unico modulo senza build). Nessun file separato.

## Dati
```js
const SETTINGS_DEFAULT = {
  audio: { master: 0.75, music: 0.3, sfx: 0.8 },
  gfx:   { quality: 'auto', fps: false },            // 'auto' | 'low' | 'medium' | 'high'
  keys:  {
    left:     ['ArrowLeft', 'KeyA'],
    right:    ['ArrowRight', 'KeyD'],
    throttle: ['ArrowUp', 'KeyW'],
    brake:    ['ArrowDown', 'KeyS'],
    drift:    ['Space', 'ShiftLeft'],
    item:     ['KeyE', 'KeyX'],
    look:     ['KeyQ', null],
  },
  game:  { steerSens: 1.0, cam: 'normal', shake: true }, // cam: 'near' | 'normal' | 'far'
};
```
- Chiave `localStorage`: `tki-settings`. Lettura/scrittura in `try/catch`; JSON mancante/corrotto → default. Merge profondo con i default (chiavi nuove future non rompono salvataggi vecchi).
- Esc / P (pausa) ed Enter (conferma) restano fissi, non rimappabili.
- Nota: oggi `ShiftRight`, `KeyK`, `ControlLeft` sono tasti extra per drift/oggetto; con 2 slot per azione vengono rimossi dai default (sostituiti dalla rimappatura).

## Applicazione
Funzione `applySettings(part)` chiamata al boot e a ogni modifica.

**Audio**
- `A.master/A.music/A.sfx.gain.value` = valori. Se `A.ctx` non esiste, `audioInit()` usa i valori di `SETTINGS` invece delle costanti.
- Opzioni aperte in pausa: `A.ctx.resume()` finché il pannello è aperto, poi di nuovo `suspend()` se ancora in pausa. Cursore effetti riproduce `sfx.tickR()` di anteprima.

**Grafica**

| Livello | Ombre | Mappa ombre | Bloom | MSAA | Pixel ratio max |
|---|---|---|---|---|---|
| low | off | – | off | 0 | 1.0 |
| medium | PCFShadowMap | 1024 | intensità ×0.5 | 0 | 1.25 |
| high | PCFSoftShadowMap | 2048 | ×1 | 4 | 1.75 |
| auto | come high + `adaptQuality` attivo | | | | |

- Livelli fissi: `adaptQuality` disattivato, pixel ratio = max del livello (limitato da `devicePixelRatio`).
- Bloom: `bloom.enabled = false` in low; altrimenti `bloom.strength = S.bloom[0] * mult` (anche dentro `setupTrack`, riga ~865).
- Cambio ombre: `renderer.shadowMap.enabled/type`, `sun.shadow.mapSize` + `sun.shadow.map?.dispose(); sun.shadow.map = null`, e `material.needsUpdate = true` su tutti i materiali della scena.
- Cambio MSAA: `rt.samples` + `rt.dispose()` (three ricrea al prossimo render).
- `PR` diventa `let` / limite letto da `gfxMaxPR()`; `adaptQuality` usa quello.
- FPS: `<div id="fps">` in alto a sinistra sotto l'itembox, media aggiornata ogni 0,5 s in `frame()`, visibile solo se `gfx.fps`.

**Controlli**
- `readInput()` e `G.lookBack` usano `keyDown(action)` = uno dei due codici di `SETTINGS.keys[action]` premuto.
- `preventDefault` sui tasti assegnati a un'azione (non solo frecce/Space).
- Rimappatura: click su slot → testo "premi un tasto…" → prossimo `keydown` assegna il codice (Esc annulla, Backspace svuota slot). Se il codice è già in un altro slot: scambio. Durante la cattura il keydown non arriva al gioco.

**Gioco**
- `steerSens` (0.5–1.5): moltiplica lo sterzo finale in `readInput()` prima del `clamp`.
- `cam`: fattore distanza su `8.6` (dietro) e `3.6` (altezza) in `chaseCam`: near ×0.8, normal ×1, far ×1.25.
- `shake` off: in `chaseCam` il termine di shake non viene applicato (G.shake continua a decadere).

## Interfaccia
- Bottone `OPZIONI` (classe `btn blue small`) nel titolo e nel box pausa.
- Overlay `#options` (classe `overlay`, `.box`): titolo, riga schede, contenuto scheda, bottoni `PREDEFINITI` (resetta solo scheda attiva) e `OK` (chiude).
- Salvataggio immediato a ogni modifica.
- Controlli per scheda:
  - Audio: 3 `input[type=range]` 0–100 con percentuale.
  - Grafica: selettore Auto/Bassa/Media/Alta (4 pulsanti tipo `.cc`), checkbox FPS.
  - Controlli: tabella azione × 2 slot.
  - Gioco: range sensibilità sterzo (50–150%), selettore telecamera Vicina/Normale/Lontana, checkbox scuotimento.
- Esc con opzioni aperte: chiude le opzioni (non la pausa). Enter non attiva `menuConfirm` mentre opzioni aperte.
- Online: impostazioni locali, nessuna sincronizzazione.

## Casi limite
- `localStorage` bloccato: gioco funziona coi default, modifiche valide solo per la sessione.
- Cambio qualità durante `loading`: non possibile (pannello non raggiungibile).
- Tasto rimappato su Esc/P/Enter: rifiutato.

## Verifica (manuale, nel browser)
1. Modifica ogni opzione → ricarica pagina → valori mantenuti.
2. Low/Medium/High: differenza visibile di ombre/bloom, FPS diversi col contatore.
3. Rimappa drift su `KeyJ` → funziona in gara, `Space` non più (se rimosso).
4. Volume musica 0 → musica muta, effetti udibili.
5. Camera lontana e shake off verificati in gara.
6. DevTools: `localStorage` con JSON rotto → gioco parte coi default.
