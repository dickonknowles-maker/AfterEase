'use strict';

// Maths behind the phase 2 panel: the speed view, built-in presets, and
// reading a curve back from selected keys.

const test = require('node:test');
const assert = require('node:assert/strict');
const bezier = require('../../core/bezier');
const speed = require('../../core/speed');
const { BUILT_IN, reverse, isCurve } = require('../../core/presets');
const { planApply, readCurve } = require('../../core/apply');

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

const CURVE = { x1: 0.3, y1: 0.1, x2: 0.65, y2: 0.95 };

test('speed handles are the curve\'s end speeds, and dragging them keeps the other values', () => {
  close(speed.startSpeed(CURVE), 0.1 / 0.3);
  close(speed.endSpeed(CURVE), 0.05 / 0.35);
  // Dragging to where a handle already is changes nothing.
  const same = speed.withEnd(speed.withStart(CURVE, CURVE.x1, speed.startSpeed(CURVE)), CURVE.x2, speed.endSpeed(CURVE));
  for (const k of ['x1', 'y1', 'x2', 'y2']) close(same[k], CURVE[k], 1e-12);
  // A new influence keeps the speed: y follows x.
  const wider = speed.withStart(CURVE, 0.6, speed.startSpeed(CURVE));
  close(wider.y1 / wider.x1, speed.startSpeed(CURVE), 1e-12);
  assert.equal(wider.x2, CURVE.x2);
  // Influence stays inside AE's range.
  assert.equal(speed.withStart(CURVE, -1, 1).x1, speed.X_MIN);
  assert.equal(speed.withEnd(CURVE, 2, 1).x2, 1 - speed.X_MIN);
});

test('the sampled speed matches the curve and averages 1', () => {
  const s = speed.samples(CURVE, 400);
  close(s[0].speed, speed.startSpeed(CURVE), 1e-6);
  close(s[s.length - 1].speed, speed.endSpeed(CURVE), 1e-6);
  // Integrating speed over time gives the whole change, 1.
  let area = 0;
  for (let i = 1; i < s.length; i++) area += (s[i].speed + s[i - 1].speed) / 2 * (s[i].x - s[i - 1].x);
  close(area, 1, 1e-3);
});

test('built-in presets are valid AE curves with the right shapes', () => {
  assert.equal(BUILT_IN.length, 10);
  assert.equal(new Set(BUILT_IN.map(p => p.id)).size, BUILT_IN.length);
  for (const p of BUILT_IN) {
    assert.ok(isCurve(p.curve), p.id);
    assert.ok(p.curve.x1 >= speed.X_MIN && p.curve.x2 <= 1 - speed.X_MIN, p.id);
  }
  const by = id => BUILT_IN.find(p => p.id === id).curve;
  // Linear plays at constant speed.
  for (let i = 0; i <= 10; i++) close(bezier.valueAtX(by('linear'), i / 10), i / 10, 1e-6);
  // A slow start starts at rest, a slow end ends at rest, and both does both; stronger is slower to start.
  close(speed.startSpeed(by('start-medium')), 0);
  close(speed.endSpeed(by('end-medium')), 0);
  close(speed.startSpeed(by('both-strong')), 0);
  close(speed.endSpeed(by('both-strong')), 0);
  assert.ok(bezier.valueAtX(by('start-strong'), 0.3) < bezier.valueAtX(by('start-gentle'), 0.3));
  const twice = reverse(reverse(by('start-gentle')));
  for (const k of ['x1', 'y1', 'x2', 'y2']) close(twice[k], by('start-gentle')[k], 1e-12);
});

test('isCurve rejects what AE cannot store', () => {
  assert.ok(isCurve({ x1: 0.5, y1: -0.3, x2: 0.5, y2: 1.3 }));
  assert.ok(!isCurve({ x1: 0, y1: 0, x2: 0.5, y2: 1 }));
  assert.ok(!isCurve({ x1: 0.5, y1: 0, x2: 1, y2: 1 }));
  assert.ok(!isCurve({ x1: 0.5, y1: NaN, x2: 0.5, y2: 1 }));
  assert.ok(!isCurve(null));
});

function keys(times, values) {
  return times.map((time, i) => ({
    time, value: values[i], selected: false, inType: 'LINEAR', outType: 'LINEAR',
    inEase: [{ speed: 0, influence: 100 / 6 }], outEase: [{ speed: 0, influence: 100 / 6 }],
    temporalContinuous: false, temporalAutoBezier: false,
  }));
}

test('readCurve gives back an applied curve, preferring pairs', () => {
  const k = keys([0, 1, 2, 3], [0, 100, 20, 60]);
  [0, 1, 2, 3].forEach(i => { k[i].selected = true; });
  const selection = { comp: { id: 1 }, properties: [{ ref: {}, layerName: 'Box', name: 'Opacity', valueType: 'OneD', keys: k }] };
  const plan = planApply(selection, CURVE);
  for (const w of plan.writes[0].keys) Object.assign(k[w.index - 1], { inType: w.inType, outType: w.outType, inEase: w.inEase, outEase: w.outEase });
  const read = readCurve(selection);
  assert.equal(read.label, 'Box: Opacity, keys 1 to 2');
  for (const key of ['x1', 'y1', 'x2', 'y2']) close(read.curve[key], CURVE[key], 1e-12);
  // A lone key reads the segment before it; with nothing selected there is no curve.
  k.forEach((x, i) => { x.selected = i === 2; });
  assert.equal(readCurve(selection).label, 'Box: Opacity, keys 2 to 3');
  k.forEach(x => { x.selected = false; });
  assert.equal(readCurve(selection), null);
  assert.equal(readCurve({ comp: null }), null);
});
