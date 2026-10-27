'use strict';

// One segment between two keys, as AE stores it: how much the value changes
// along it, and the value AE plays back at a time inside it. Keys are as the
// host's readSelection returns them: { time, value, inType, outType, inEase,
// outEase, inTangent?, outTangent? }, with eases as [{ speed, influence }].
//
// Kinds, from the property's value type in AE:
//   '1d'      one number (Opacity, Rotation, X Position, Time Remap)
//   'multi'   2 or 3 numbers with one ease each (Scale)
//   'spatial' a point moving along a bezier path by arc length, one ease
//             (Position, Anchor Point)
//   'colour'  RGBA moving along the straight line between the two colours,
//             one ease, speed in 0-255 units per second (measured in AE 26.5)

const aeEase = require('./aeEase');
const spatial = require('./spatial');

const COLOUR_SCALE = 255;

function distance(p, q) {
  let sum = 0;
  for (let i = 0; i < p.length; i++) sum += (q[i] - p[i]) * (q[i] - p[i]);
  return Math.sqrt(sum);
}

function controlPoints(a, b) {
  return spatial.controlPoints(a.value, a.outTangent, b.inTangent, b.value);
}

// The value change each ease entry refers to: one number per entry.
function change(kind, a, b) {
  switch (kind) {
    case '1d': return [b.value - a.value];
    case 'multi': return a.value.map((v, d) => b.value[d] - v);
    case 'spatial': return [spatial.arcLength(controlPoints(a, b))];
    case 'colour': return [COLOUR_SCALE * distance(a.value, b.value)];
    default: throw new Error(`Unknown kind: ${kind}`);
  }
}

// The value AE plays at time t (a.time <= t <= b.time), under the handle
// model phase 0 confirmed. AE reports eases for Linear sides too (the
// segment's average speed at influence 16.7%), and they fit the same model.
// A Hold out side keeps key A's value until key B.
function valueAt(kind, a, b, t) {
  if (a.outType === 'HOLD') return t < b.time ? a.value : b.value;
  if (kind === '1d') return aeEase.analyticValue(a.outEase[0], b.inEase[0], a.time, a.value, b.time, b.value, t);
  if (kind === 'multi') {
    return a.value.map((vA, d) => aeEase.analyticValue(a.outEase[d], b.inEase[d], a.time, vA, b.time, b.value[d], t));
  }
  const length = change(kind, a, b)[0];
  if (length === 0) return a.value;
  const f = aeEase.analyticValue(a.outEase[0], b.inEase[0], a.time, 0, b.time, length, t) / length;
  if (kind === 'colour') return a.value.map((vA, d) => vA + f * (b.value[d] - vA));
  return spatial.pointAtLengthFraction(controlPoints(a, b), f);
}

// The normalised curve per ease entry, read back from the stored eases.
function curves(kind, a, b) {
  const dt = b.time - a.time;
  return change(kind, a, b).map((dv, d) => aeEase.easesToCurve(a.outEase[d], b.inEase[d], dt, dv));
}

module.exports = { COLOUR_SCALE, change, valueAt, curves };
