'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bezier = require('../../core/bezier');
const aeEase = require('../../core/aeEase');
const spatial = require('../../core/spatial');

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

const curves = [
  { x1: 0.33, y1: 0, x2: 0.67, y2: 1 },
  { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  { x1: 0.1, y1: 0.6, x2: 0.3, y2: 1 },
  { x1: 0.25, y1: 1.4, x2: 0.5, y2: 1 },
  { x1: 0.4, y1: -0.3, x2: 0.8, y2: 1.2 },
  { x1: 0.8, y1: 0.2, x2: 0.2, y2: 0.9 },
];

test('solveX inverts x(s)', () => {
  for (const c of curves) {
    for (let i = 0; i <= 20; i++) {
      const x = i / 20;
      close(bezier.point(c, bezier.solveX(c, x)).x, x, 1e-8);
    }
  }
});

test('linear curve gives linear value', () => {
  const linear = { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 };
  for (let i = 0; i <= 10; i++) close(bezier.valueAtX(linear, i / 10), i / 10, 1e-8);
  close(bezier.slopeAtX(linear, 0.3), 1, 1e-8);
});

test('split keeps the curve', () => {
  const p = [[0, 0], [0.2, 0.7], [0.9, 0.1], [1, 1]];
  const [left, right] = bezier.splitPoints(p, 0.4);
  const at = (q, s) => {
    const u = 1 - s;
    return [0, 1].map(i => u * u * u * q[0][i] + 3 * u * u * s * q[1][i] + 3 * u * s * s * q[2][i] + s * s * s * q[3][i]);
  };
  for (let i = 0; i <= 10; i++) {
    const s = i / 10;
    const a = at(left, s);
    const b = at(p, 0.4 * s);
    close(a[0], b[0]); close(a[1], b[1]);
    const c = at(right, s);
    const d = at(p, 0.4 + 0.6 * s);
    close(c[0], d[0]); close(c[1], d[1]);
  }
});

test('curve to eases and back round-trips', () => {
  for (const c of curves) {
    for (const [dt, dv] of [[1, 100], [0.5, -40], [2.002, 3.5]]) {
      const e = aeEase.curveToEases(c, dt, dv);
      assert.equal(e.clamped, false);
      const back = aeEase.easesToCurve(e.out, e.in, dt, dv);
      for (const k of ['x1', 'y1', 'x2', 'y2']) close(back[k], c[k], 1e-12);
    }
  }
});

test('influence is clamped to 0.1 to 100', () => {
  const e = aeEase.curveToEases({ x1: 0, y1: 0, x2: 1, y2: 1 }, 1, 10);
  assert.equal(e.clamped, true);
  assert.equal(e.out.influence, 0.1);
  assert.equal(e.in.influence, 0.1);
});

test('no value change gives zero speeds and linear read-back', () => {
  const e = aeEase.curveToEases(curves[0], 1, 0);
  assert.equal(e.out.speed, 0);
  assert.equal(e.in.speed, 0);
  const back = aeEase.easesToCurve(e.out, e.in, 1, 0);
  close(back.x1, curves[0].x1);
});

test('analytic value matches the normalised curve', () => {
  for (const c of curves) {
    const tA = 1.2, tB = 2.7, vA = 30, vB = -15;
    const e = aeEase.curveToEases(c, tB - tA, vB - vA);
    for (let i = 0; i <= 20; i++) {
      const x = i / 20;
      const expected = vA + bezier.valueAtX(c, x) * (vB - vA);
      close(aeEase.analyticValue(e.out, e.in, tA, vA, tB, vB, tA + x * (tB - tA)), expected, 1e-7);
    }
  }
});

test('arc length of known paths', () => {
  const straight = spatial.controlPoints([0, 0], [10, 0], [-10, 0], [30, 40]);
  // Tangents along x then -x do not stay on the chord, so check a true line.
  const line = spatial.controlPoints([0, 0], [10, 0], [-10, 0], [60, 0]);
  close(spatial.arcLength(line), 60, 1e-9);
  const line3d = spatial.controlPoints([0, 0, 0], [0, 0, 0], [0, 0, 0], [3, 4, 12]);
  close(spatial.arcLength(line3d), 13, 1e-9);
  assert.ok(spatial.arcLength(straight) > 50);
  // Quarter circle of radius 100 approximated by the usual 0.5523 handles.
  const k = 0.5522847498 * 100;
  const quarter = spatial.controlPoints([100, 0], [0, k], [k, 0], [0, 100]);
  close(spatial.arcLength(quarter), Math.PI * 50, 0.05);
});

test('point at length fraction walks the path evenly', () => {
  const line = spatial.controlPoints([0, 0], [40, 0], [-5, 0], [100, 0]);
  for (let i = 0; i <= 10; i++) {
    close(spatial.pointAtLengthFraction(line, i / 10)[0], i * 10, 1e-3);
  }
});
