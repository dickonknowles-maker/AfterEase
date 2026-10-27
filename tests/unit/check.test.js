'use strict';

// The phase 1 round-trip checks (tests/ae/check.js) against a fake AE that
// plays back core/'s model exactly, and one that doesn't.

const test = require('node:test');
const assert = require('node:assert/strict');
const segment = require('../../core/segment');
const { planApply } = require('../../core/apply');
const { checkApply, compareReads } = require('../ae/check');

const CURVE = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

function linearKeys(times, values) {
  const speed = (i, j) => (values[j] - values[i]) / (times[j] - times[i]);
  return times.map((time, i) => ({
    time, value: values[i], selected: true, inType: 'LINEAR', outType: 'LINEAR',
    inEase: [{ speed: i > 0 ? speed(i - 1, i) : 0, influence: 100 / 6 }],
    outEase: [{ speed: i < times.length - 1 ? speed(i, i + 1) : 0, influence: 100 / 6 }],
    temporalContinuous: false, temporalAutoBezier: false,
  }));
}

// A testRead result for keys, sampled with play(kind, a, b, t).
function read(kind, keys, play = segment.valueAt) {
  const samples = keys.slice(0, -1).map((a, s) => {
    const b = keys[s + 1];
    return Array.from({ length: 21 }, (_, j) => {
      const t = a.time + (b.time - a.time) * j / 20;
      return { time: t, value: play(kind, a, b, t) };
    });
  });
  return { keys, samples };
}

function applied(keys, write) {
  const out = keys.map(k => ({ ...k }));
  for (const w of write.keys) Object.assign(out[w.index - 1], { inType: w.inType, outType: w.outType, inEase: w.inEase, outEase: w.outEase });
  return out;
}

test('a host that plays the model passes, one that eases linearly fails', () => {
  const keys = linearKeys([0, 1, 2.5], [0, 100, 20]);
  const sel = { comp: { id: 1 }, properties: [{ ref: {}, layerName: 'L', name: 'Opacity', valueType: 'OneD', keys }] };
  const plan = planApply(sel, CURVE);
  const after = applied(keys, plan.writes[0]);
  const good = checkApply({ kind: '1d', before: read('1d', keys), after: read('1d', after), written: plan.writes[0].segments, curve: CURVE });
  assert.ok(good.pass, JSON.stringify(good.rows));
  const linear = (kind, a, b, t) => a.value + (b.value - a.value) * (t - a.time) / (b.time - a.time);
  const bad = checkApply({ kind: '1d', before: read('1d', keys), after: read('1d', after, linear), written: plan.writes[0].segments, curve: CURVE });
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.rows[0].problems, ['model', 'pipeline']);
});

test('untouched segments must not change', () => {
  const keys = linearKeys([0, 1, 2], [0, 100, 20]);
  const nudged = (kind, a, b, t) => segment.valueAt(kind, a, b, t) + (a.time === 1 ? 0.01 : 0);
  const r = checkApply({ kind: '1d', before: read('1d', keys), after: read('1d', keys, nudged), written: [], curve: CURVE });
  assert.deepEqual(r.rows.map(x => x.problems), [[], ['changed']]);
});

test('compareReads finds every changed attribute', () => {
  const keys = linearKeys([0, 1], [0, 90]);
  const x = read('1d', keys);
  assert.deepEqual(compareReads(x, read('1d', keys)), []);
  const changed = keys.map(k => ({ ...k }));
  changed[1] = { ...changed[1], outType: 'HOLD', label: 3, inEase: [{ speed: 1, influence: 20 }] };
  const diffs = compareReads(x, read('1d', changed));
  assert.ok(diffs.some(d => d.startsWith('key 2 outType')));
  assert.ok(diffs.some(d => d.startsWith('key 2 label')));
  assert.ok(diffs.some(d => d.startsWith('key 2 in ease')));
  assert.ok(diffs.some(d => d.startsWith('segment 1 sample')));
});
