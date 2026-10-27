'use strict';

// Checks for the phase 1 round trip in AE (tests/ae/roundtrip.mjs): compares
// what AE stored and plays back with core/'s model and with the curve that
// was asked for. Pure functions, tested in tests/unit/check.test.js.

const bezier = require('../../core/bezier');
const segment = require('../../core/segment');
const spatial = require('../../core/spatial');

const TOLERANCE = 0.001; // 0.1% of the segment's change; 0.001 on read-back curves
const asArray = v => (Array.isArray(v) ? v : [v]);

function distance(p, q) {
  let sum = 0;
  for (let i = 0; i < p.length; i++) sum += (p[i] - q[i]) * (p[i] - q[i]);
  return Math.sqrt(sum);
}

// Error between two values, relative to the segment's change. Dimensions
// with no change count their absolute error.
function relativeError(kind, a, b, got, want) {
  if (kind === 'spatial' || kind === 'colour') {
    const length = kind === 'spatial' ? segment.change(kind, a, b)[0] : distance(a.value, b.value);
    const d = distance(asArray(got), asArray(want));
    return length > 0 ? d / length : d;
  }
  const va = asArray(a.value);
  const vb = asArray(b.value);
  let worst = 0;
  va.forEach((v, d) => {
    const dv = Math.abs(vb[d] - v);
    const e = Math.abs(asArray(got)[d] - asArray(want)[d]);
    worst = Math.max(worst, dv > 0 ? e / dv : e);
  });
  return worst;
}

// The value the requested curve gives at time t.
function curveValue(kind, a, b, curve, t) {
  const f = bezier.valueAtX(curve, (t - a.time) / (b.time - a.time));
  if (kind === 'spatial') return spatial.pointAtLengthFraction(spatial.controlPoints(a.value, a.outTangent, b.inTangent, b.value), f);
  if (kind === '1d') return a.value + f * (b.value - a.value);
  return a.value.map((v, d) => v + f * (b.value[d] - v));
}

// Largest difference in the curve's handles, over ease entries whose value
// changes. sides picks the handles: out is (x1, y1), in is (x2, y2).
function handleError(kind, a, b, curve, sides) {
  const names = [...(sides.out ? ['x1', 'y1'] : []), ...(sides.in ? ['x2', 'y2'] : [])];
  const changes = segment.change(kind, a, b);
  let worst = 0;
  segment.curves(kind, a, b).forEach((back, d) => {
    if (changes[d] === 0) return;
    for (const n of names) worst = Math.max(worst, Math.abs(back[n] - curve[n]));
  });
  return worst;
}

const maxOf = list => list.reduce((m, v) => Math.max(m, v), 0);

// One property after an apply. before and after are testRead results;
// written is the plan's segments for the property ([] if none); curve is the
// curve asked for. exactCurve false skips the checks against the curve (for
// cases where core clipped it). Returns a row per segment and whether all pass.
function checkApply({ kind, before, after, written, curve, exactCurve = true, untouched = 1e-9 }) {
  const bySegment = new Map(written.map(s => [s.index, s.sides]));
  const rows = [];
  for (let s = 0; s < after.keys.length - 1; s++) {
    const a = after.keys[s];
    const b = after.keys[s + 1];
    const sides = bySegment.get(s);
    const samples = after.samples[s];
    const row = { segment: s + 1, written: !sides ? 'no' : sides.out && sides.in ? 'both' : sides.out ? 'out' : 'in', problems: [] };
    row.model = maxOf(samples.map(p => relativeError(kind, a, b, p.value, segment.valueAt(kind, a, b, p.time))));
    if (row.model > TOLERANCE) row.problems.push('model');
    if (sides && exactCurve) {
      row.readBack = handleError(kind, a, b, curve, sides);
      if (row.readBack > TOLERANCE) row.problems.push('read-back');
      if (sides.out && sides.in) {
        row.pipeline = maxOf(samples.map(p => relativeError(kind, a, b, p.value, curveValue(kind, a, b, curve, p.time))));
        if (row.pipeline > TOLERANCE) row.problems.push('pipeline');
      }
    }
    if (!sides) {
      const old = before.samples[s];
      row.unchanged = maxOf(samples.map((p, j) => relativeError(kind, a, b, p.value, old[j].value)));
      if (row.unchanged > untouched) row.problems.push('changed');
    }
    rows.push(row);
  }
  return { rows, pass: rows.every(r => r.problems.length === 0) };
}

// Differences between two testRead results of the same property: every key
// attribute and every sample. Returns a list of differences (empty if same).
function compareReads(x, y, tolerance = 1e-9) {
  const diffs = [];
  const near = (p, q) => Math.abs(p - q) <= tolerance * Math.max(1, Math.abs(q));
  const sameNumbers = (p, q) => asArray(p).length === asArray(q).length && asArray(p).every((v, i) => near(v, asArray(q)[i]));
  if (x.keys.length !== y.keys.length) return [`${x.keys.length} keys, then ${y.keys.length}`];
  x.keys.forEach((k, i) => {
    const m = y.keys[i];
    const where = `key ${i + 1}`;
    for (const f of ['time', 'value', 'inTangent', 'outTangent']) {
      if (k[f] !== undefined && !sameNumbers(k[f], m[f])) diffs.push(`${where} ${f}: ${JSON.stringify(k[f])} then ${JSON.stringify(m[f])}`);
    }
    for (const f of ['inType', 'outType', 'temporalContinuous', 'temporalAutoBezier', 'spatialContinuous', 'spatialAutoBezier', 'roving', 'label', 'selected']) {
      if (k[f] !== m[f]) diffs.push(`${where} ${f}: ${k[f]} then ${m[f]}`);
    }
    for (const side of ['in', 'out']) {
      k[`${side}Ease`].forEach((e, d) => {
        const f = m[`${side}Ease`][d];
        if (!near(e.speed, f.speed) || !near(e.influence, f.influence)) {
          diffs.push(`${where} ${side} ease ${d}: ${e.speed}/${e.influence} then ${f.speed}/${f.influence}`);
        }
      });
    }
  });
  x.samples.forEach((seg, s) => seg.forEach((p, j) => {
    if (!sameNumbers(p.value, y.samples[s][j].value)) diffs.push(`segment ${s + 1} sample ${j}: ${JSON.stringify(p.value)} then ${JSON.stringify(y.samples[s][j].value)}`);
  }));
  return diffs;
}

module.exports = { TOLERANCE, relativeError, curveValue, checkApply, compareReads };
