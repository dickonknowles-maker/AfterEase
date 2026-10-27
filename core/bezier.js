'use strict';

// Normalised cubic bezier with fixed ends (0, 0) and (1, 1), as in CSS:
// curve = { x1, y1, x2, y2 }. Pure functions only: no host calls.

function axis(p1, p2, s) {
  const u = 1 - s;
  return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s;
}

function axisDerivative(p1, p2, s) {
  const u = 1 - s;
  return 3 * u * u * p1 + 6 * u * s * (p2 - p1) + 3 * s * s * (1 - p2);
}

function point(curve, s) {
  return { x: axis(curve.x1, curve.x2, s), y: axis(curve.y1, curve.y2, s) };
}

// Curve parameter s where x(s) = x. Newton first, bisection if it strays.
// Assumes x(s) is monotonic, i.e. 0 <= x1, x2 <= 1.
function solveX(curve, x, epsilon = 1e-9) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let s = x;
  for (let i = 0; i < 8; i++) {
    const err = axis(curve.x1, curve.x2, s) - x;
    if (Math.abs(err) < epsilon) return s;
    const d = axisDerivative(curve.x1, curve.x2, s);
    if (Math.abs(d) < 1e-12) break;
    s -= err / d;
    if (s < 0 || s > 1) break;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 100; i++) {
    const err = axis(curve.x1, curve.x2, s) - x;
    if (Math.abs(err) < epsilon) break;
    if (err > 0) hi = s; else lo = s;
    s = (lo + hi) / 2;
  }
  return s;
}

// Normalised value (0 at key A, 1 at key B) at normalised time x.
function valueAtX(curve, x) {
  return axis(curve.y1, curve.y2, solveX(curve, x));
}

// d(value)/d(time) in normalised units: multiply by the average speed of
// the segment to get property units per second. This is the speed view.
function slopeAtX(curve, x) {
  const s = solveX(curve, x);
  const dx = axisDerivative(curve.x1, curve.x2, s);
  const dy = axisDerivative(curve.y1, curve.y2, s);
  return dx === 0 ? (dy === 0 ? 0 : Infinity * Math.sign(dy)) : dy / dx;
}

// De Casteljau split of a general cubic given by four points [[x, y], ...].
function splitPoints(p, s) {
  const lerp = (a, b) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  const p01 = lerp(p[0], p[1]);
  const p12 = lerp(p[1], p[2]);
  const p23 = lerp(p[2], p[3]);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const mid = lerp(p012, p123);
  return [[p[0], p01, p012, mid], [mid, p123, p23, p[3]]];
}

module.exports = { point, solveX, valueAtX, slopeAtX, splitPoints };
