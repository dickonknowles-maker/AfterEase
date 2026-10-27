'use strict';

// core/segment.js and core/apply.js against hand-made selections shaped like
// the host's readSelection result.

const test = require('node:test');
const assert = require('node:assert/strict');
const aeEase = require('../../core/aeEase');
const bezier = require('../../core/bezier');
const segment = require('../../core/segment');
const { targetSegments, planApply, verifyWrite } = require('../../core/apply');

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

const CURVE = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
const OVERSHOOT = { x1: 0.4, y1: -0.4, x2: 0.6, y2: 1.4 };

// Keys as AE reports Linear keys: each side's speed is its segment's average
// speed, at influence 16.7%.
function linearKeys(times, values, extra = {}) {
  const dims = Array.isArray(values[0]) ? values[0].length : 1;
  const flat = v => (Array.isArray(v) ? v : [v]);
  const speed = (i, j) => flat(values[j]).map((v, d) => (v - flat(values[i])[d]) / (times[j] - times[i]));
  return times.map((time, i) => ({
    time,
    value: values[i],
    selected: false,
    inType: 'LINEAR',
    outType: 'LINEAR',
    inEase: Array.from({ length: dims }, (_, d) => ({ speed: i > 0 ? speed(i - 1, i)[d] : 0, influence: 100 / 6 })),
    outEase: Array.from({ length: dims }, (_, d) => ({ speed: i < times.length - 1 ? speed(i, i + 1)[d] : 0, influence: 100 / 6 })),
    temporalContinuous: false,
    temporalAutoBezier: false,
    ...extra,
  }));
}

function selection(props) {
  return {
    comp: { id: 1, name: 'Comp', frameDuration: 0.04, time: 0 },
    properties: props.map((p, i) => ({ ref: { compId: 1, layerIndex: i + 1, layerId: i + 10, path: [] }, layerName: `Layer ${i + 1}`, expression: false, ...p })),
  };
}

const select = (keys, indices) => keys.forEach((k, i) => { k.selected = indices.includes(i); });

// Stores a plan's writes the way AE does, for round trips.
function store(prop, write) {
  const keys = prop.keys.map(k => ({ ...k }));
  for (const w of write.keys) Object.assign(keys[w.index - 1], { inType: w.inType, outType: w.outType, inEase: w.inEase, outEase: w.outEase });
  return keys;
}

test('target segments: runs, lone keys and scope', () => {
  const keys = Array.from({ length: 7 }, () => ({ selected: false }));
  [1, 2, 3, 5].forEach(i => { keys[i].selected = true; });
  const plain = map => Object.fromEntries([...map].map(([s, v]) => [s, `${v.out ? 'out' : ''}${v.in ? 'in' : ''}`]));
  assert.deepEqual(plain(targetSegments(keys)), { 1: 'outin', 2: 'outin', 4: 'in', 5: 'out' });
  assert.deepEqual(plain(targetSegments(keys, 'in')), { 1: 'in', 2: 'in', 4: 'in' });
  assert.deepEqual(plain(targetSegments(keys, 'out')), { 1: 'out', 2: 'out', 5: 'out' });
  // A lone first or last key has one side only.
  const ends = Array.from({ length: 3 }, (_, i) => ({ selected: i !== 1 }));
  assert.deepEqual(plain(targetSegments(ends)), { 0: 'out', 1: 'in' });
});

test('segment change per kind, colour in 0-255 units over RGBA', () => {
  const k = (value, extra) => ({ value, ...extra });
  assert.deepEqual(segment.change('1d', k(10), k(-30)), [-40]);
  assert.deepEqual(segment.change('multi', k([100, 100, 100]), k([40, 180, 100])), [-60, 80, 0]);
  // Values AE reported for Linear colour keys in AE 26.5 (speed = change per second).
  close(segment.change('colour', k([1, 0, 0, 1]), k([0, 0.5, 1, 1]))[0], 382.5);
  close(segment.change('colour', k([1, 0, 0, 1]), k([1, 0, 0, 0.5]))[0], 127.5);
  close(segment.change('colour', k([0, 0, 0, 1]), k([3, 4, 0, 1]))[0], 1275);
  const straight = segment.change('spatial', k([0, 0, 0], { outTangent: [0, 0, 0] }), k([300, 400, 0], { inTangent: [0, 0, 0] }));
  close(straight[0], 500, 1e-6);
});

test('value at a time: linear sides, hold, colour line, spatial ends', () => {
  const [a, b] = linearKeys([1, 3], [10, 50]);
  close(segment.valueAt('1d', a, b, 2), 30, 1e-9);
  close(segment.valueAt('1d', { ...a, outType: 'HOLD' }, b, 2.9), 10);
  const [c, d] = linearKeys([0, 1], [[1, 0, 0, 1], [0, 0.5, 1, 0.5]]).map(k => ({ ...k, inEase: [k.inEase[0]], outEase: [k.outEase[0]] }));
  c.outEase = [{ speed: 0, influence: 50 }];
  d.inEase = [{ speed: 0, influence: 50 }];
  const mid = segment.valueAt('colour', c, d, 0.5);
  mid.forEach((v, i) => close(v, [0.5, 0.25, 0.5, 0.75][i], 1e-6));
  const p = { time: 0, value: [0, 0], outTangent: [100, 0], outType: 'BEZIER', outEase: [{ speed: 0, influence: 33 }] };
  const q = { time: 2, value: [200, 100], inTangent: [0, -100], inType: 'BEZIER', inEase: [{ speed: 0, influence: 33 }] };
  segment.valueAt('spatial', p, q, 0).forEach((v, i) => close(v, p.value[i], 1e-6));
  segment.valueAt('spatial', p, q, 2).forEach((v, i) => close(v, q.value[i], 1e-6));
});

test('a pair on 1D keys round-trips, and untouched sides keep their type', () => {
  const keys = linearKeys([0, 1, 2.5, 3], [0, 100, 20, 60]);
  select(keys, [1, 2]);
  const sel = selection([{ name: 'Opacity', valueType: 'OneD', keys }]);
  const plan = planApply(sel, CURVE);
  assert.deepEqual(plan.notices, []);
  const [w] = plan.writes;
  assert.deepEqual(w.keys.map(k => [k.index, k.inType, k.outType]), [[2, 'LINEAR', 'BEZIER'], [3, 'BEZIER', 'LINEAR']]);
  const stored = store(sel.properties[0], w);
  const [back] = segment.curves('1d', stored[1], stored[2]);
  for (const key of ['x1', 'y1', 'x2', 'y2']) close(back[key], CURVE[key], 1e-12);
  // The written segment plays the curve.
  for (let i = 0; i <= 10; i++) {
    const t = 1 + 1.5 * i / 10;
    close(segment.valueAt('1d', stored[1], stored[2], t), 100 - 80 * bezier.valueAtX(CURVE, i / 10), 1e-6);
  }
});

test('multi-dimensional and colour properties', () => {
  const scale = linearKeys([0, 1], [[100, 100, 100], [40, 180, 100]]);
  select(scale, [0, 1]);
  const colourKeys = linearKeys([0, 1], [[1, 0, 0, 1], [0, 0.5, 1, 1]]).map(k => ({ ...k, inEase: [{ speed: 382.5, influence: 100 / 6 }], outEase: [{ speed: 382.5, influence: 100 / 6 }] }));
  select(colourKeys, [0, 1]);
  const plan = planApply(selection([
    { name: 'Scale', valueType: 'ThreeD', keys: scale },
    { name: 'Color', valueType: 'COLOR', keys: colourKeys },
  ]), CURVE);
  assert.deepEqual(plan.notices, []);
  const [s, c] = plan.writes;
  assert.equal(s.keys[0].outEase.length, 3);
  assert.equal(s.keys[0].outEase[2].speed, 0);
  assert.equal(c.keys[0].outEase.length, 1);
  const curves = segment.curves('multi', ...store({ keys: scale }, s));
  for (const d of [0, 1]) close(curves[d].x1, CURVE.x1, 1e-12);
  const [colourBack] = segment.curves('colour', ...store({ keys: colourKeys }, c));
  for (const key of ['x1', 'y1', 'x2', 'y2']) close(colourBack[key], CURVE[key], 1e-12);
});

test('spatial properties use arc length and clip overshoot', () => {
  const keys = linearKeys([0, 2], [[0, 0, 0], [300, 400, 0]]).map(k => ({ ...k, inEase: [k.inEase[0]], outEase: [k.outEase[0]], inTangent: [0, 0, 0], outTangent: [0, 0, 0] }));
  select(keys, [0, 1]);
  const sel = selection([{ name: 'Position', valueType: 'ThreeD_SPATIAL', keys }]);
  const plain = planApply(sel, { x1: 0.25, y1: 0.5, x2: 0.75, y2: 1 });
  close(plain.writes[0].keys[0].outEase[0].speed, 250 * 0.5 / 0.25, 1e-3);
  const over = planApply(sel, OVERSHOOT);
  assert.match(over.notices.join(' '), /paths can't overshoot/);
  assert.equal(over.writes[0].keys[0].outEase[0].speed, 0);
  assert.equal(over.writes[0].keys[1].inEase[0].speed, 0);
});

test('hold, roving, unsupported and expression notices', () => {
  const held = linearKeys([0, 1, 2], [0, 50, 100]);
  held[1].outType = 'HOLD';
  select(held, [0, 1, 2]);
  const roving = linearKeys([0, 1, 2, 3], [[0, 0, 0], [1, 1, 0], [2, 0, 0], [3, 1, 0]]).map(k => ({ ...k, inEase: [k.inEase[0]], outEase: [k.outEase[0]], inTangent: [0, 0, 0], outTangent: [0, 0, 0], roving: false }));
  roving[2].roving = true;
  select(roving, [0, 1, 2, 3]);
  const expr = linearKeys([0, 1], [0, 90]);
  select(expr, [0, 1]);
  const plan = planApply(selection([
    { name: 'Opacity', valueType: 'OneD', keys: held },
    { name: 'Position', valueType: 'ThreeD_SPATIAL', keys: roving },
    { name: 'Path', valueType: 'SHAPE', keys: null },
    { name: 'Rotation', valueType: 'OneD', keys: expr, expression: true },
  ]), CURVE);
  const text = plan.notices.join('\n');
  assert.match(text, /Opacity: held segments were left as is/);
  assert.match(text, /Position: segments next to roving keys were left as is/);
  assert.match(text, /Path: Paths can't be eased/);
  assert.match(text, /Rotation: has an expression/);
  // Held segment 1 to 2 is skipped; 0 to 1 is written.
  assert.deepEqual(plan.writes[0].segments.map(s => s.index), [0]);
  assert.equal(plan.writes[0].keys.find(k => k.index === 2).outType, 'HOLD');
  // Roving key 3: only segment 0 to 1 is written.
  assert.deepEqual(plan.writes[1].segments.map(s => s.index), [0]);
});

test('continuous keys stay continuous only when speeds still match', () => {
  const keys = linearKeys([0, 1, 2], [0, 100, 200], { temporalContinuous: true, temporalAutoBezier: true });
  select(keys, [1]);
  // A lone key in the middle of a straight line: both sides get the same speed.
  const plan = planApply(selection([{ name: 'Rotation', valueType: 'OneD', keys }]), { x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 });
  const k = plan.writes[0].keys[0];
  assert.equal(k.temporalContinuous, true);
  assert.equal(k.temporalAutoBezier, false);
  const uneven = planApply(selection([{ name: 'Rotation', valueType: 'OneD', keys }]), { x1: 0.2, y1: 0.5, x2: 0.6, y2: 1 });
  assert.equal(uneven.writes[0].keys[0].temporalContinuous, false);
});

test('influences are clamped and untouched influences made settable', () => {
  const keys = linearKeys([0, 1, 2], [0, 10, 20]);
  keys[2].inType = 'BEZIER';
  keys[2].inEase = [{ speed: 0, influence: 0 }];
  select(keys, [0, 1]);
  const plan = planApply(selection([{ name: 'Opacity', valueType: 'OneD', keys }]), { x1: 0, y1: 0, x2: 1, y2: 1 });
  assert.match(plan.notices.join(' '), /clamped/);
  const w = plan.writes[0].keys;
  close(w[0].outEase[0].influence, aeEase.MIN_INFLUENCE);
  close(w[1].inEase[0].influence, aeEase.MIN_INFLUENCE);
  assert.equal(planApply({ comp: null }, CURVE).notices[0], 'Open a composition and select some keys first.');
});

test('verifyWrite reports what AE changed or refused', () => {
  const keys = linearKeys([0, 1], [0, 90]);
  select(keys, [0, 1]);
  const plan = planApply(selection([{ name: 'Rotation', valueType: 'OneD', keys }]), CURVE);
  const echo = { properties: [{ keys: plan.writes[0].keys.map(k => ({ ...k })) }] };
  assert.deepEqual(verifyWrite(plan, echo), []);
  echo.properties[0].keys[0].outEase = [{ speed: 1, influence: 42 }];
  echo.properties[0].keys[1].inType = 'LINEAR';
  const notices = verifyWrite(plan, echo);
  assert.equal(notices.length, 2);
  assert.match(notices.join(' '), /different out ease/);
  assert.deepEqual(verifyWrite(plan, { properties: [{ error: 'Its keys have changed since they were read' }] }),
    ['Layer 1: Rotation: not changed. Its keys have changed since they were read']);
});
