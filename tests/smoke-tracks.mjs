// Prova delle piste nuove in Edge headless: ponte/incrocio, un giro in autopilota, recuperi e blocchi.
// Uso: python serve.py 8791   poi   node tests/smoke-tracks.mjs http://127.0.0.1:8791/ <idMappa> [cartella-screenshot]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.argv[2] || 'http://127.0.0.1:8791/';
const MAP = process.argv[3] || 'otto';
const OUT = process.argv[4] || null;
const PORT = 9340;
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'edge-')), '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [], errors = [];
const check = (name, ok, extra = '') => { const l = (ok ? 'OK   ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''); log.push(l); console.log(l); };
setTimeout(() => { console.log('TIMEOUT globale'); edge.kill(); process.exit(2); }, 330000);

let ws, id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(e.slice(0, 70) + ' → ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
const until = async (e, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(e).catch(() => false)) return true; await sleep(250); } return false; };
const shot = async f => { if (!OUT) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, f), Buffer.from(r.result.data, 'base64')); };

try {
  let u = null;
  for (let i = 0; i < 50 && !u; i++) { try { u = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!u) await sleep(200); }
  ws = new WebSocket(u); await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value ?? a.description).join(' ')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  check('titolo', await until(`window.__game && window.__game.G.state === 'title'`, 60000));
  await ev(`document.getElementById('btnPlay').click()`);
  await until(`window.__game.G.state === 'select'`, 10000);
  check('pista nel menu', await ev(`!!document.querySelector('.mapc[data-map=${MAP}]')`));
  await ev(`document.querySelector('.mapc[data-map=${MAP}]').click()`);
  await ev(`document.getElementById('btnStart').click()`);
  check('gara avviata', await until(`window.__game.G.state === 'race'`, 120000));

  // --- ponti: coppie di punti vicini in pianta ma a quote diverse
  const br = await ev(`(() => {
    const g = window.__game, P = g.P, N = g.N, B = g.BRIDGE; if (!B.some(v => v)) return null;
    let best = null;
    for (let i = 0; i < N; i += 2) { if (!B[i]) continue; for (let j = 0; j < N; j += 2) { if (B[j]) continue; const d = Math.hypot(P[i].x - P[j].x, P[i].z - P[j].z); if (d < 6 && (!best || d < best.d)) best = { i, j, d }; } }
    if (!best) return { none: true };
    const x = P[best.i].x, z = P[best.i].z;
    const up = g.groundInfo(x, z, best.i, {}), lo = g.groundInfo(x, z, best.j, {});
    return { i: best.i, j: best.j, up: +up.h.toFixed(2), upRoad: +P[best.i].y.toFixed(2), lo: +lo.h.toFixed(2), loRoad: +P[best.j].y.toFixed(2), terrain: +g.terrainY(x, z).toFixed(2) };
  })()`);
  if (br) {
    check('incrocio trovato', !br.none, JSON.stringify(br));
    if (!br.none) {
      check('sul ponte: quota del ponte', Math.abs(br.up - br.upRoad) < 0.5, `h ${br.up} strada ${br.upRoad}`);
      check('sotto: quota della strada bassa', Math.abs(br.lo - br.loRoad) < 0.5, `h ${br.lo} strada ${br.loRoad}`);
      check('dislivello ≥ 9 m', br.up - br.lo >= 9, (br.up - br.lo).toFixed(1));
      check('terreno sotto il ponte', br.terrain < br.up - 5, `terreno ${br.terrain}`);
      await ev(`(() => { const g = window.__game, P = g.P, G = g.G; G.paused = true; const a = P[${br.j}], b = P[${br.i}], c = g.camera; const sd = g.SD[${br.j}]; c.position.set(a.x + sd.x * 75, b.y + 22, a.z + sd.z * 75); c.lookAt(b.x, b.y - 5, b.z); c.fov = 60; c.updateProjectionMatrix(); })()`);
      await sleep(600); await shot(`track-${MAP}-bridge.png`);
      await ev(`window.__game.G.paused = false`);
    }
  }

  // --- un giro in autopilota: nessun blocco, pochi recuperi
  await ev(`(() => { const g = window.__game, G = g.G, p = G.player; G.autopilot = true; window.__resp = 0; const o = p.startRespawn.bind(p); p.startRespawn = () => { if (p.respawnT <= 0) window.__resp++; o(); }; window.__prog0 = p.progress; return true; })()`);
  await until(`window.__game.G.player.lap >= 1`, 30000); await sleep(500);
  await ev(`window.__prog0 = window.__game.G.player.progress, true`);
  const t0 = Date.now();
  const lapped = await until(`window.__game.G.player.progress >= window.__prog0 + window.__game.N || window.__game.G.player.finished`, 240000);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  check('giro completo in autopilota', lapped, `${secs} s reali, recuperi ${await ev('window.__resp')}`);
  check('recuperi ≤ 2 nel giro', (await ev('window.__resp')) <= 2);
  await shot(`track-${MAP}-race.png`);
  check('bot in movimento', await ev(`window.__game.G.karts.filter(k => !k.isPlayer).every(k => k.progress > 0)`));
} catch (e) {
  log.push('ERRORE ' + e.message); console.log('ERRORE ' + e.message);
} finally {
  console.log('errori/eccezioni: ' + errors.length); errors.slice(0, 8).forEach(e => console.log('  ' + String(e).slice(0, 300)));
  edge.kill();
  process.exit(log.some(l => /^(FAIL|ERRORE)/.test(l)) || errors.length ? 1 : 0);
}
