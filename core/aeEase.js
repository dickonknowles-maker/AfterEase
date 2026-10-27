'use strict';

// Conversion between a normalised curve { x1, y1, x2, y2 } and After Effects'
// per-key temporal ease (speed in property units per second, influence in
// percent of the segment). See SPEC.md, "Easing maths".

const bezier = require('./bezier');

const MIN_INFLUENCE = 0.1;
const MAX_INFLUENCE = 100;

function clampInfluence(i) {
  return Math.min(MAX_INFLUENCE, Math.max(MIN_INFLUENCE, i));
}

// dt: seconds between key A and key B. dv: value change along the segment
// (per dimension, or arc length for spatial properties).
// Returns { out: ease for key A, in: ease for key B, clamped }.
function curveToEases(curve, dt, dv) {
  const vbar = dv / dt;
  const rawOut = 100 * curve.x1;
  const rawIn = 100 * (1 - curve.x2);
  const outInfluence = clampInfluence(rawOut);
  const inInfluence = clampInfluence(rawIn);
  return {
    out: { speed: vbar * curve.y1 * 100 / outInfluence, influence: outInfluence },
    in: { speed: vbar * (1 - curve.y2) * 100 / inInfluence, influence: inInfluence },
    clamped: outInfluence !== rawOut || inInfluence !== rawIn,
  };
}

// Reverse of curveToEases. With dv = 0 the y values are undefined; they
// come back as the linear defaults so the caller still gets a usable curve.
function easesToCurve(outEase, inEase, dt, dv) {
  const vbar = dv / dt;
  const x1 = outEase.influence / 100;
  const x2 = 1 - inEase.influence / 100;
  if (vbar === 0) return { x1, y1: x1, x2, y2: x2 };
  return {
    x1,
    y1: outEase.speed * x1 / vbar,
    x2,
    y2: 1 - inEase.speed * (1 - x2) / vbar,
  };
}

// The value AE should produce at time t inside the segment, under the
// standard handle model (handles at influence * dt in time and
// speed * influence * dt in value). Phase 0 checks this against valueAtTime.
function analyticValue(outEase, inEase, tA, vA, tB, vB, t) {
  const dt = tB - tA;
  const p = [
    [tA, vA],
    [tA + outEase.influence / 100 * dt, vA + outEase.speed * outEase.influence / 100 * dt],
    [tB - inEase.influence / 100 * dt, vB - inEase.speed * inEase.influence / 100 * dt],
    [tB, vB],
  ];
  // Solve the time axis for the curve parameter, then evaluate the value axis.
  const span = dt === 0 ? 1 : dt;
  const curveX = { x1: (p[1][0] - tA) / span, x2: (p[2][0] - tA) / span, y1: 0, y2: 0 };
  const s = bezier.solveX(curveX, (t - tA) / span);
  const u = 1 - s;
  return u * u * u * p[0][1] + 3 * u * u * s * p[1][1] + 3 * u * s * s * p[2][1] + s * s * s * p[3][1];
}

module.exports = { MIN_INFLUENCE, MAX_INFLUENCE, curveToEases, easesToCurve, analyticValue };
