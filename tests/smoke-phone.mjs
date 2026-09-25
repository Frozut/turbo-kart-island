// Prova PC + telefono in due schede di Edge headless collegate via PeerJS (serve internet).
// Uso: python serve.py 8791   poi   node tests/smoke-phone.mjs http://127.0.0.1:8791/ [cartella-screenshot]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.argv[2] || 'http://127.0.0.1:8791/';
const OUT = process.argv[3] || null;
const PORT = 9338;
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'edge-')), '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [], errors = [];
const check = (name, ok, extra = '') => { const l = (ok ? 'OK   ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''); log.push(l); console.log(l); };
setTimeout(() => { console.log('TIMEOUT globale'); edge.kill(); process.exit(2); }, 240000);

async function tab(wsUrl, name) {
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(name + ': ' + d.params.args.map(a => a.value ?? a.description).join(' ')); if (d.method === 'Runtime.exceptionThrown') errors.push(name + ': ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(name + ': ' + expr.slice(0, 60) + ' → ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
  const until = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
  const shot = async f => { if (!OUT) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, f), Buffer.from(r.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  return { ws, send, ev, until, shot };
}

try {
  let first = null;
  for (let i = 0; i < 50 && !first; i++) { try { first = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!first) await sleep(200); }
  const pc = await tab(first.webSocketDebuggerUrl, 'PC');
  await pc.send('Page.navigate', { url: BASE });
  check('PC: titolo', await pc.until(`window.__game && window.__game.G.state === 'title'`, 60000));
  await pc.ev(`document.getElementById('btnPhone').click()`);
  check('PC: codice telefono', await pc.until(`/^[A-Z0-9]{5}$/.test(document.getElementById('padCode').textContent)`, 20000));
  const code = await pc.ev(`document.getElementById('padCode').textContent`);

  const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + 'controller.html#' + code)}`, { method: 'PUT' })).json();
  const ph = await tab(nt.webSocketDebuggerUrl, 'TEL');
  await ph.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 400, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await ph.until(`document.readyState === 'complete' && !!window.Peer`, 15000);
  await ph.ev(`document.getElementById('go').click()`);
  check('TEL: collegato', await ph.until(`!document.getElementById('pad').hidden`, 20000));
  check('PC: telefono visto', await pc.until(`window.__game.NET.pads.size > 0`, 10000));
  await pc.send('Page.bringToFront'); // come nella realtà: la pagina del PC è quella in primo piano
  check('TEL: telecomando menu', await ph.until(`document.getElementById('pad').classList.contains('menu')`, 5000));
  check('TEL: auto-accelerazione di default', await ph.ev(`document.getElementById('pad').classList.contains('auto')`));
  await ph.shot('phone-menu.png');

  const press = d => ph.ev(`(() => { const b = document.querySelector('[data-d=${d}], [data-nav=${d}]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  const focus = () => pc.ev(`(() => { const all = [...document.querySelectorAll('.padfocus')]; if (all.length > 1) console.error('padfocus multipli: ' + all.map(e => e.id || e.className).join(',')); const e = all[0]; return e ? (e.id || e.className + ':' + e.textContent.trim().slice(0, 14)) : null; })()`);

  check('PC: evidenziato sul pannello telefono', await pc.until(`!!document.querySelector('#phone .padfocus')`, 3000), await focus());
  await press('ok'); await sleep(400);
  check('OK chiude il pannello telefono', await pc.ev(`document.getElementById('phone').hidden`));
  check('titolo: evidenziato GIOCA', await pc.until(`document.querySelector('.padfocus')?.id === 'btnPlay'`, 3000), await focus());
  await press('right'); await sleep(250);
  const f1 = await focus();
  check('freccia destra sposta', f1 && f1 !== 'btnPlay', f1);
  await press('left'); await sleep(250);
  await press('ok');
  check('OK su GIOCA → scelta pilota', await pc.until(`window.__game.G.state === 'select'`, 5000));
  check('selezione: evidenziato VIA', await pc.until(`document.querySelector('.padfocus')?.id === 'btnStart'`, 3000), await focus());
  await press('up'); await sleep(250);
  const f2 = await focus(); check('freccia su nella scelta pilota', f2 && f2 !== 'btnStart', f2);
  await pc.shot('pc-select-focus.png');
  await press('back');
  check('INDIETRO → titolo', await pc.until(`window.__game.G.state === 'title'`, 5000));
  await pc.until(`document.querySelector('.padfocus')?.id === 'btnPlay'`, 3000); await press('ok');
  await pc.until(`window.__game.G.state === 'select'`, 5000);
  check('di nuovo su VIA', await pc.until(`document.querySelector('.padfocus')?.id === 'btnStart'`, 3000), await focus());
  await press('ok');
  check('OK su VIA → gara', await pc.until(`['intro','countdown','race'].includes(window.__game.G.state)`, 60000));
  check('TEL: comandi di guida in gara', await ph.until(`!document.getElementById('pad').classList.contains('menu')`, 20000));
  await ph.shot('phone-drive.png');
  check('auto-accelerazione: il kart parte da solo', await pc.until(`window.__game.G.state === 'race' && window.__game.G.player.speed > 15`, 20000), await pc.ev(`window.__game.G.player.speed.toFixed(1)`));
  check('niente motore ingolfato', await pc.ev(`window.__game.G.player.spinT <= 0`));
  await ph.ev(`document.getElementById('bPause').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`);
  check('⏸ dal telefono mette in pausa', await pc.until(`window.__game.G.paused`, 3000));
  check('TEL: telecomando in pausa', await ph.until(`document.getElementById('pad').classList.contains('menu')`, 3000));
  await press('down'); await sleep(250);
  await pc.shot('pc-pause-focus.png');
  await press('back');
  check('INDIETRO riprende la gara', await pc.until(`!window.__game.G.paused`, 3000));
} catch (e) {
  log.push('ERRORE ' + e.message); console.log('ERRORE ' + e.message);
} finally {
  console.log('errori/eccezioni: ' + errors.length); errors.slice(0, 8).forEach(e => console.log('  ' + String(e).slice(0, 300)));
  edge.kill();
  process.exit(log.some(l => /^(FAIL|ERRORE)/.test(l)) || errors.length ? 1 : 0);
}
