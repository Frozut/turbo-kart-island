// Impronta delle piste esistenti: forma, strada, terreno e muri campionati per ogni mappa.
// Uso: python serve.py 8791   poi
//   node tests/track-fingerprint.mjs http://127.0.0.1:8791/ --save    (registra tests/track-baseline.json)
//   node tests/track-fingerprint.mjs http://127.0.0.1:8791/           (confronta con la baseline)
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = process.argv[2] || 'http://127.0.0.1:8791/';
const SAVE = process.argv.includes('--save');
const FILE = new URL('./track-baseline.json', import.meta.url);
const MAPS = ['island', 'canyon', 'neon', 'ice', 'volcano'];
const PORT = 9339;
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'edge-')), 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('TIMEOUT'); edge.kill(); process.exit(2); }, 200000);

let code = 1;
try {
  let u = null;
  for (let i = 0; i < 50 && !u; i++) { try { u = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!u) await sleep(200); }
  const ws = new WebSocket(u); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
  await send('Page.navigate', { url: BASE });
  for (let t = 0; t < 300 && await ev(`window.__game?.G.state`).catch(() => null) !== 'title'; t++) await sleep(300);
  const out = {};
  for (const id of MAPS) {
    out[id] = await ev(`(() => {
      const g = window.__game, m = g.MAPS.find(m => m.id === '${id}');
      g.setupTrack(m);
      const P = g.P, SD = g.SD, N = g.N, r = v => Math.round(v * 1000) / 1000, o = { N, P: [], G: [] };
      for (let i = 0; i < N; i += 25) o.P.push([r(P[i].x), r(P[i].y), r(P[i].z)]);
      for (let i = 0; i < N; i += 37) for (const lat of [-45, -30, -21, -13, -8, 0, 8, 13, 21, 30, 45]) {
        const x = P[i].x + SD[i].x * lat, z = P[i].z + SD[i].z * lat, gi = g.groundInfo(x, z, i, {});
        o.G.push([gi.idx, r(gi.lat), r(gi.h), r(g.terrainY(x, z)), g.isOpenAt ? g.isOpenAt(gi.idx, gi.lat) : 0]);
      }
      return o;
    })()`);
  }
  if (SAVE) { writeFileSync(FILE, JSON.stringify(out)); console.log('baseline salvata'); code = 0; }
  else {
    const base = JSON.parse(readFileSync(FILE, 'utf8'));
    let diffs = 0;
    for (const id of MAPS) {
      const a = base[id], b = out[id];
      if (a.N !== b.N) { console.log(`FAIL ${id}: N ${a.N} → ${b.N}`); diffs++; continue; }
      const bad = [];
      a.P.forEach((p, i) => { if (JSON.stringify(p) !== JSON.stringify(b.P[i])) bad.push('P' + i); });
      a.G.forEach((p, i) => { if (JSON.stringify(p.slice(0, 4)) !== JSON.stringify(b.G[i].slice(0, 4))) bad.push('G' + i + ' ' + JSON.stringify(p) + ' → ' + JSON.stringify(b.G[i])); });
      if (bad.length) { console.log(`FAIL ${id}: ${bad.length} differenze, es. ${bad.slice(0, 3).join(' | ')}`); diffs++; }
      else console.log(`OK   ${id}: identica (${a.G.length} campioni)`);
    }
    code = diffs ? 1 : 0;
  }
} catch (e) { console.log('ERRORE ' + e.message); }
edge.kill(); process.exit(code);
