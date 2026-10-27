'use strict';

// Checks the spike 3 harness itself, with fake hosts standing in for AE.

const test = require('node:test');
const assert = require('node:assert/strict');
const aeEase = require('../../core/aeEase');
const spatial = require('../../core/spatial');
const spike = require('../../client/spikes/easeModelSpike');

// A fake AE that stores eases unchanged and samples the analytic model.
// byParameter: move along spatial paths by curve parameter, not arc length.
function fakeHost(plan, { byParameter = false } = {}) {
  return {
    cases: plan.cases.map(c => {
      const keys = c.keys.map((k, i) => ({
        time: k.time, value: k.value, inTangent: k.inTangent, outTangent: k.outTangent,
        inEase: c.eases[i].inEase, outEase: c.eases[i].outEase, temporalContinuous: false,
      }));
      const samples = [];
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i];
        const b = keys[i + 1];
        const seg = [];
        for (let j = 0; j <= c.samplesPerSegment; j++) {
          const t = a.time + (b.time - a.time) * j / c.samplesPerSegment;
          let value;
          if (c.kind === 'spatial') {
            const cp = spatial.controlPoints(a.value, a.outTangent, b.inTangent, b.value);
            const L = spatial.arcLength(cp);
            const f = aeEase.analyticValue(a.outEase[0], b.inEase[0], a.time, 0, b.time, L, t) / L;
            value = byParameter ? spatial.pointAt(cp, f) : spatial.pointAtLengthFraction(cp, f);
          } else if (Array.isArray(a.value)) {
            value = a.value.map((vA, d) => aeEase.analyticValue(a.outEase[d], b.inEase[d], a.time, vA, b.time, b.value[d], t));
          } else {
            value = aeEase.analyticValue(a.outEase[0], b.inEase[0], a.time, a.value, b.time, b.value, t);
          }
          seg.push({ time: t, value });
        }
        samples.push(seg);
      }
      return { name: c.name, kind: c.kind, errors: [], keys, samples };
    }),
  };
}

test('every frame rate builds a plan with frame-aligned keys', () => {
  for (const [label, fps] of Object.entries(spike.FRAME_RATES)) {
    const plan = spike.buildPlan(label);
    for (const c of plan.cases) {
      for (const k of c.keys) assert.ok(Math.abs(k.time * fps - Math.round(k.time * fps)) < 1e-9);
      for (const e of c.eases) {
        const dims = c.kind === 'multi' ? 3 : 1;
        assert.equal(e.inEase.length, dims);
        assert.equal(e.outEase.length, dims);
      }
    }
  }
});

test('a host that matches the model passes', () => {
  for (const label of Object.keys(spike.FRAME_RATES)) {
    const plan = spike.buildPlan(label);
    const analysis = spike.analyse(plan, fakeHost(plan));
    assert.equal(analysis.pass, true, spike.formatReport(analysis));
  }
});

test('moving by curve parameter on spatial paths is caught', () => {
  const plan = spike.buildPlan('25');
  const analysis = spike.analyse(plan, fakeHost(plan, { byParameter: true }));
  const spatialCases = analysis.cases.filter(c => c.kind === 'spatial');
  assert.ok(spatialCases.every(c => !c.pass));
  assert.ok(analysis.cases.filter(c => c.kind !== 'spatial').every(c => c.pass));
});

test('a clamped ease is reported', () => {
  const plan = spike.buildPlan('25');
  const host = fakeHost(plan);
  const k = host.cases[2].keys[0];
  k.outEase = [{ speed: 0, influence: k.outEase[0].influence }];
  const analysis = spike.analyse(plan, host);
  assert.equal(analysis.cases[2].pass, false);
  assert.match(spike.formatReport(analysis), /AE changed out\[0\] speed/);
});
