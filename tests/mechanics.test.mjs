import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('//  MECCANICHE (logica pura');
const end = html.indexOf('//  RENDERER / SCENE');
const code = start >= 0 ? html.slice(start, end) : 'throw new Error("sezione MECCANICHE (logica pura) mancante")';
const M = () => new Function(code + '\nreturn { ITEM_TABLES, itemTable, draftTarget, respawnIdx, isFallen, openSideAt };')();
const kart = (x, z) => ({ pos: { x, z } });

test('itemTable: pesi positivi in ogni fascia', () => {
  const { itemTable } = M();
  for (let r = 0; r < 12; r++) for (const [, w] of itemTable(r, 12)) assert.ok(w > 0);
});
test('itemTable: il primo non riceve blu, fulmine o pallottola', () => {
  const ids = M().itemTable(0, 12).map(x => x[0]);
  for (const bad of ['blue', 'bolt', 'bullet']) assert.ok(!ids.includes(bad), bad);
});
test('itemTable: pallottola solo nell\'ultimo terzo', () => {
  const { itemTable } = M();
  for (let r = 0; r < 12; r++) {
    const has = itemTable(r, 12).some(x => x[0] === 'bullet');
    assert.equal(has, r / 11 > 0.6, 'rank ' + r);
  }
});
test('itemTable: un solo kart', () => {
  assert.ok(M().itemTable(0, 1).length > 0);
});
test('draftTarget: davanti, dietro, di lato, lontano, se stesso, il più vicino', () => {
  const { draftTarget } = M();
  const me = kart(0, 0);
  assert.equal(draftTarget(0, 0, 0, [me, kart(0, 10)], me), 1);
  assert.equal(draftTarget(0, 0, 0, [me, kart(0, -10)], me), -1);
  assert.equal(draftTarget(0, 0, 0, [me, kart(Math.sin(0.52) * 10, Math.cos(0.52) * 10)], me), -1);
  assert.equal(draftTarget(0, 0, 0, [me, kart(0, 30)], me), -1);
  assert.equal(draftTarget(0, 0, 0, [me], me), -1);
  assert.equal(draftTarget(0, 0, 0, [me, kart(0, 18), kart(0, 8)], me), 2);
  assert.equal(draftTarget(0, 0, 0, [me, kart(0, 24)], me, 25), 1);
});
test('respawnIdx arretra di 8 con giro', () => {
  const { respawnIdx } = M();
  assert.equal(respawnIdx(3, 100), 95);
  assert.equal(respawnIdx(50, 100), 42);
});
test('isFallen', () => {
  const { isFallen } = M();
  assert.equal(isFallen(-13, 0, -60, false), true);
  assert.equal(isFallen(-11, 0, -60, false), false);
  assert.equal(isFallen(-2.2, 5, -2.3, true), true);
  assert.equal(isFallen(-2.2, 5, -2.3, false), false);
});
test('openSideAt', () => {
  const { openSideAt } = M();
  assert.equal(openSideAt([[0.2, 0.3, 1]], 0.25, 1), true);
  assert.equal(openSideAt([[0.2, 0.3, 1]], 0.25, -1), false);
  assert.equal(openSideAt([[0.2, 0.3, 1]], 0.35, 1), false);
  assert.equal(openSideAt([[0.2, 0.3, 0]], 0.25, -1), true);
  assert.equal(openSideAt([[0.95, 0.05, -1]], 0.01, -1), true);
  assert.equal(openSideAt([[0.95, 0.05, -1]], 0.5, -1), false);
  assert.equal(openSideAt([], 0.5, 1), false);
});
