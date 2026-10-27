'use strict';

// The speed view: the same curve plotted as speed over time, with 1 as the
// segment's average speed. Its handles sit at the curve's influences (x1 and
// x2) and at the speeds the curve starts and ends with, so dragging one edits
// the same (x, y) handles through y / x, and the editor can switch views
// mid-drag without changing the curve.

const bezier = require('./bezier');

// AE's influence range, 0.1% to 100%, as limits on x1 and x2.
const X_MIN = 0.001;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A curve AE can store: x1 and x2 inside the influence range.
function settle(curve) {
  return { x1: clamp(curve.x1, X_MIN, 1), y1: curve.y1, x2: clamp(curve.x2, 0, 1 - X_MIN), y2: curve.y2 };
}

function startSpeed(curve) {
  return curve.y1 / curve.x1;
}

function endSpeed(curve) {
  return (1 - curve.y2) / (1 - curve.x2);
}

// The start handle dragged to influence x and speed s in the speed view.
function withStart(curve, x, s) {
  const x1 = clamp(x, X_MIN, 1);
  return { ...curve, x1, y1: s * x1 };
}

// The end handle dragged to x (from the left) and speed s.
function withEnd(curve, x, s) {
  const x2 = clamp(x, 0, 1 - X_MIN);
  return { ...curve, x2, y2: 1 - s * (1 - x2) };
}

// Speed at n + 1 evenly spaced times, for drawing.
function samples(curve, n = 120) {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: i / n, speed: bezier.slopeAtX(curve, i / n) }));
}

module.exports = { X_MIN, settle, startSpeed, endSpeed, withStart, withEnd, samples };
