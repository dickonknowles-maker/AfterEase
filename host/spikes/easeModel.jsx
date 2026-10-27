// Phase 0 spike 3: does valueAtTime match the analytic cubic?
//
// The panel computes the eases (core/aeEase.js) and sends a plan. This file
// only builds a throwaway comp, writes the keys and eases exactly as given,
// reads back what AE stored and samples valueAtTime. The comparison happens
// in the panel.
//
// plan = {
//   fps, duration,
//   cases: [{
//     name, kind: '1d' | 'multi' | 'spatial',
//     property: transform matchName, e.g. 'ADBE Rotate Z', threeD: bool,
//     keys: [{ time, value, inTangent?, outTangent? }],
//     eases: [{ inEase: [{speed, influence}], outEase: [...] }],   // one per key
//     samplesPerSegment
//   }]
// }

(function (A) {
    function toEases(list) {
        var out = [];
        for (var i = 0; i < list.length; i += 1) {
            out.push(new KeyframeEase(list[i].speed, list[i].influence));
        }
        return out;
    }

    function fromEases(list) {
        var out = [];
        for (var i = 0; i < list.length; i += 1) {
            out.push({ speed: list[i].speed, influence: list[i].influence });
        }
        return out;
    }

    // AE keeps Position as 3 values even on a 2D layer ([x, y, 0]), and
    // setSpatialTangentsAtKey rejects tangents with fewer.
    function padTo(list, n) {
        var out = list.slice(0);
        while (out.length < n) {
            out.push(0);
        }
        return out;
    }

    function runCase(comp, c) {
        var result = { name: c.name, kind: c.kind, errors: [], keys: [], samples: [] };
        var layer = comp.layers.addNull(comp.duration);
        layer.name = c.name;
        if (c.threeD) {
            layer.threeDLayer = true;
        }
        var prop = layer.property('ADBE Transform Group').property(c.property);
        var i, j;

        for (i = 0; i < c.keys.length; i += 1) {
            prop.setValueAtTime(c.keys[i].time, c.keys[i].value);
        }
        for (i = 1; i <= prop.numKeys; i += 1) {
            var key = c.keys[i - 1];
            var ease = c.eases[i - 1];
            try {
                prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                prop.setTemporalContinuousAtKey(i, false);
                prop.setTemporalAutoBezierAtKey(i, false);
                if (prop.isSpatial) {
                    prop.setSpatialContinuousAtKey(i, false);
                    prop.setSpatialAutoBezierAtKey(i, false);
                    prop.setSpatialTangentsAtKey(i, padTo(key.inTangent, prop.value.length), padTo(key.outTangent, prop.value.length));
                }
                prop.setTemporalEaseAtKey(i, toEases(ease.inEase), toEases(ease.outEase));
            } catch (e) {
                result.errors.push('key ' + i + ': ' + String(e));
            }
        }

        for (i = 1; i <= prop.numKeys; i += 1) {
            var stored = {
                time: prop.keyTime(i),
                value: prop.keyValue(i),
                inEase: fromEases(prop.keyInTemporalEase(i)),
                outEase: fromEases(prop.keyOutTemporalEase(i)),
                temporalContinuous: prop.keyTemporalContinuous(i)
            };
            if (prop.isSpatial) {
                stored.inTangent = prop.keyInSpatialTangent(i);
                stored.outTangent = prop.keyOutSpatialTangent(i);
            }
            result.keys.push(stored);
        }

        for (i = 1; i < prop.numKeys; i += 1) {
            var tA = prop.keyTime(i);
            var tB = prop.keyTime(i + 1);
            var segment = [];
            for (j = 0; j <= c.samplesPerSegment; j += 1) {
                var t = tA + (tB - tA) * j / c.samplesPerSegment;
                segment.push({ time: t, value: prop.valueAtTime(t, true) });
            }
            result.samples.push(segment);
        }
        return result;
    }

    A.functions.spikeEaseModel = function (plan) {
        return A.undoGroup('AfterEase spike: ease model', function () {
            var comp = app.project.items.addComp('AfterEase spike - ease model ' + plan.fps + ' fps',
                1920, 1080, 1, plan.duration, plan.fps);
            var results = [];
            for (var i = 0; i < plan.cases.length; i += 1) {
                try {
                    results.push(runCase(comp, plan.cases[i]));
                } catch (e) {
                    results.push({ name: plan.cases[i].name, kind: plan.cases[i].kind, errors: [String(e)], keys: [], samples: [] });
                }
            }
            return { compName: comp.name, frameDuration: comp.frameDuration, cases: results };
        });
    };
}(AfterEase));
