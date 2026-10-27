'use strict';

// Spatial segments: the path between two keys of Position, Anchor Point and
// other spatial properties. Points are arrays of 2 or 3 numbers. AE stores
// tangents relative to their key: the path's control points are
// A, A + outTangentA, B + inTangentB, B.

function controlPoints(a, outTangentA, inTangentB, b) {
  const add = (p, q) => p.map((v, i) => v + (q[i] || 0));
  return [a, add(a, outTangentA), add(b, inTangentB), b];
}

function pointAt(cp, s) {
  const u = 1 - s;
  const w = [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s];
  return cp[0].map((_, i) => w[0] * cp[0][i] + w[1] * cp[1][i] + w[2] * cp[2][i] + w[3] * cp[3][i]);
}

function distance(p, q) {
  let sum = 0;
  for (let i = 0; i < p.length; i++) sum += (p[i] - q[i]) * (p[i] - q[i]);
  return Math.sqrt(sum);
}

// Cumulative arc length table from dense sampling. Simple and accurate
// enough for spike work; phase 1 may switch to Gauss-Legendre.
function lengthTable(cp, steps = 2000) {
  const table = [0];
  let prev = pointAt(cp, 0);
  for (let i = 1; i <= steps; i++) {
    const p = pointAt(cp, i / steps);
    table.push(table[i - 1] + distance(prev, p));
    prev = p;
  }
  return table;
}

function arcLength(cp, steps) {
  const table = lengthTable(cp, steps);
  return table[table.length - 1];
}

// The point at a fraction (0 to 1) of the path's length.
function pointAtLengthFraction(cp, fraction, table = lengthTable(cp)) {
  const steps = table.length - 1;
  const target = fraction * table[steps];
  let lo = 0;
  let hi = steps;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < target) lo = mid; else hi = mid;
  }
  const segment = table[hi] - table[lo];
  const local = segment === 0 ? 0 : (target - table[lo]) / segment;
  return pointAt(cp, (lo + local) / steps);
}

module.exports = { controlPoints, pointAt, arcLength, lengthTable, pointAtLengthFraction };
