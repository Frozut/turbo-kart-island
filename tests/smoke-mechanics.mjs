// Smoke test delle meccaniche MK con Edge headless (CDP). Non fa parte di `node --test`.
// Uso: python serve.py 8791   poi   node tests/smoke-mechanics.mjs http://127.0.0.1:8791/ [cartella-screenshot]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL_ = process.argv[2] || 'http://127.0.0.1:8791/';
const OUT = process.argv[3] || null;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9336', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'edge-')), '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pend = new Map(); const errors = []; const log = [];
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
const until = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
const check = (name, ok, extra = '') => { const l = (ok ? 'OK   ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''); log.push(l); console.log(l); };
setTimeout(() => { console.log('TIMEOUT globale'); edge.kill(); process.exit(2); }, 240000);
const shot = async name => { if (!OUT) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64')); };
const key = (code, type) => ev(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true })), true`);
// helper nella pagina: piazza un kart su un indice di pista
const HELP = `window.__place = (k, i, lat, sp) => { const g = window.__game, P = g.P, SD = g.SD, A = g.ANG; k.pos.set(P[i].x + SD[i].x * lat, P[i].y + 0.05, P[i].z + SD[i].z * lat); k.yaw = k.moveYaw = A[i]; k.idx = i; k.speed = sp; k.vy = 0; k.grounded = true; k.ext.set(0, 0, 0); k.spinT = k.flipT = 0; };`;

try {
  let wsUrl = null;
  for (let i = 0; i < 50 && !wsUrl; i++) { try { const l = await (await fetch('http://127.0.0.1:9336/json/list')).json(); const p = l.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(200); }
  ws = new WebSocket(wsUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value ?? a.description).join(' ')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  check('titolo', await until(`window.__game && window.__game.G.state === 'title'`, 60000));
  await ev(`document.getElementById('btnPlay').click()`);
  await until(`window.__game.G.state === 'select'`, 10000);
  await ev(`document.querySelector('.mapc[data-map=volcano]').click()`);
  await ev(`document.getElementById('btnStart').click()`);
  check('gara Vulcano', await until(`window.__game.G.state === 'race'`, 90000));
  await ev(HELP);
  check('mappa: rampa glide e tratti aperti', await ev(`window.__game.RAMPS.some(r => r.glide) && window.__game.OPEN_L.some(v => v) + window.__game.OPEN_R.some(v => v) > 0`));

  // --- oggetti
  const use = it => ev(`(() => { const p = window.__game.G.player; p.invulnT = 0; p.item = '${it}'; p.itemCount = 1; p.roulette = 0; p.useItem(); return true; })()`);
  await use('blue'); await sleep(300);
  check('sfera blu lanciata', await ev(`window.__game.G.shells.some(s => s.type === 'blue')`));
  // controllo nello stesso istante del lancio: in griglia la palla può colpire subito il kart davanti
  check('fiore: palla di fuoco', await ev(`(() => { const G = window.__game.G, p = G.player; p.item = 'fire'; p.itemCount = 1; p.roulette = 0; p.useItem(); return G.shells.some(s => s.type === 'fire') && p.fireT > 0; })()`));
  await use('gold'); await sleep(200);
  check('fungo dorato attivo', await ev(`window.__game.G.player.goldT > 0 && window.__game.G.player.boostT > 0`));
  await use('bolt'); await sleep(300);
  check('fulmine: avversari piccoli', await ev(`window.__game.G.karts.filter(k => k !== window.__game.G.player && k.shrinkT > 0).length >= 3`), await ev(`window.__game.G.karts.map(k => k.shrinkT.toFixed(1)).join(' ')`));
  await use('bullet'); await sleep(500);
  check('pallottola: guida automatica e velocità', await ev(`(() => { const p = window.__game.G.player; return p.bulletT > 0 && p.speed > p.cfg.max; })()`), await ev(`window.__game.G.player.speed.toFixed(1)`));
  await shot('mk-bullet.png');
  check('sfera blu arriva ed esplode', await until(`!window.__game.G.shells.some(s => s.type === 'blue')`, 20000));
  await sleep(3500);

  // --- recupero
  const openIdx = await ev(`(() => { const g = window.__game; for (let i = 0; i < g.N; i++) { if (g.OPEN_L[i]) return [i, -1]; if (g.OPEN_R[i]) return [i, 1]; } return null; })()`);
  await ev(`(() => { const p = window.__game.G.player; p.invulnT = 0; p.item = null; __place(p, ${openIdx[0]}, ${openIdx[1]} * (window.__game.HW + 22), 0); p.grounded = false; p.pos.y += 1; return true; })()`);
  const fell = await until(`window.__game.G.player.respawnT > 0`, 3000);
  check('caduta nel tratto aperto', fell);
  await sleep(1100); await shot('mk-drone.png');
  check('drone creato', await ev(`!!window.__game.G.player.drone`));
  check('riportato in pista', await until(`(() => { const p = window.__game.G.player; return p.respawnT === 0 && Math.abs(p.lat) < window.__game.HW; })()`, 3000), await ev(`window.__game.G.player.lat.toFixed(1)`));

  // --- deltaplano
  const R = await ev(`(() => { const r = window.__game.RAMPS.find(r => r.glide); return [r.idx, r.lat]; })()`);
  await key('KeyW', 'keydown');
  await ev(`(() => { const p = window.__game.G.player; __place(p, (${R[0]} - 25 + window.__game.N) % window.__game.N, ${R[1]}, p.cfg.max); return true; })()`);
  const glided = await until(`window.__game.G.player.gliding`, 4000);
  check('deltaplano aperto', glided);
  await sleep(500); await shot('mk-glide.png');
  check('deltaplano chiuso all\'atterraggio', await until(`!window.__game.G.player.gliding && window.__game.G.player.grounded`, 12000));
  await key('KeyW', 'keyup');

  // --- scia: rettilineo, un bot 10 m davanti
  const st = await ev(`(() => { const g = window.__game, A = g.ANG, N = g.N; let best = 0, bc = 9; for (let i = 0; i < N; i += 5) { if (g.RAMPS.some(r => { const d = (i - r.idx + N) % N; return d < 120 || d > N - 40; })) continue; let c = 0; for (let k = 0; k < 60; k += 5) c += Math.abs(((A[(i + k + 5) % N] - A[(i + k) % N]) + 9.42) % 6.28 - 3.14); if (c < bc) { bc = c; best = i; } } return best; })()`);
  await key('KeyW', 'keydown');
  await ev(`(() => { const g = window.__game, G = g.G, p = G.player, b = G.karts.find(k => k !== p && !k.remote); p.draftCd = 0; p.draftT = 0; p.boostT = 0; p.invulnT = 5; b.invulnT = 5; b.shrinkT = 0; __place(b, (${st} + 7) % g.N, 0, p.cfg.max * 0.8); __place(p, ${st}, 0, p.cfg.max * 0.8); window.__draftIv = setInterval(() => { b.pos.set(p.pos.x + Math.sin(p.yaw) * 10, p.pos.y, p.pos.z + Math.cos(p.yaw) * 10); b.yaw = b.moveYaw = p.yaw; b.speed = p.speed; }, 16); return true; })()`);
  const drafted = await until(`window.__game.G.player.draftCd > 0`, 4000);
  check('scia → turbo', drafted, await ev(`'draftT=' + window.__game.G.player.draftT.toFixed(2)`));
  await ev(`clearInterval(window.__draftIv), true`);
  await key('KeyW', 'keyup');
} catch (e) {
  log.push('ERRORE ' + e.message);
} finally {
  log.push('errori console/eccezioni: ' + errors.length);
  errors.slice(0, 10).forEach(e => log.push('  ' + String(e).slice(0, 300)));
  console.log(log.join('\n'));
  try { ws?.close(); } catch {}
  edge.kill();
  process.exit(log.some(l => l.startsWith('FAIL') || l.startsWith('ERRORE')) || errors.length ? 1 : 0);
}
