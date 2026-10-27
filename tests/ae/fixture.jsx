// Phase 1 fixture (ExtendScript, ES3). Builds one comp at a given frame rate
// with a layer per test case, covering SPEC.md's fixture list: Opacity, Scale,
// 2D and 3D Position, separated Position, colour, hold keys, roving keys,
// keys under an expression, Time Remap. Keys sit on whole frames of the
// comp's own grid. Loaded by tests/ae/roundtrip.mjs, never by the panel.

(function (A) {
    var LINEAR = KeyframeInterpolationType.LINEAR;
    var BEZIER = KeyframeInterpolationType.BEZIER;
    var HOLD = KeyframeInterpolationType.HOLD;

    A.functions.testBuildFixture = function (args) {
        var comp = app.project.items.addComp('AfterEase fixture ' + args.label + ' fps', 1920, 1080, 1, 10, args.fps);
        var f = comp.frameDuration;
        var items = [];

        function layer(name, threeD) {
            var l = comp.layers.addNull(comp.duration);
            l.name = name;
            if (threeD) {
                l.threeDLayer = true;
            }
            return l;
        }
        function transform(l, matchName) {
            return l.property('ADBE Transform Group').property(matchName);
        }
        // keys: [[frame, value], ...]
        function keyed(name, prop, keys) {
            for (var i = 0; i < keys.length; i += 1) {
                prop.setValueAtTime(keys[i][0] * f, keys[i][1]);
            }
            items.push({ name: name, ref: A.refOf(comp, prop) });
            return prop;
        }
        // tangents: [[in, out], ...] per key
        function tangents(prop, list) {
            for (var i = 0; i < list.length; i += 1) {
                prop.setSpatialAutoBezierAtKey(i + 1, false);
                prop.setSpatialContinuousAtKey(i + 1, false);
                prop.setSpatialTangentsAtKey(i + 1, list[i][0], list[i][1]);
            }
        }
        function colour(name) {
            var solid = comp.layers.addSolid([1, 1, 1], name, 100, 100, 1, comp.duration);
            return solid.property('ADBE Effect Parade').addProperty('ADBE Fill').property('ADBE Fill-0002');
        }
        var opacityKeys = [[0, 0], [24, 100], [60, 20], [84, 60]];
        var p;

        // Each kind, every key selected.
        p = keyed('Opacity', transform(layer('Opacity'), 'ADBE Opacity'), opacityKeys);
        p.setLabelAtKey(2, 3);
        keyed('Rotation', transform(layer('Rotation'), 'ADBE Rotate Z'), [[0, 0], [30, 270], [54, -90]]);
        keyed('Scale', transform(layer('Scale'), 'ADBE Scale'), [[0, [100, 100, 100]], [24, [40, 180, 100]], [48, [120, 120, 100]]]);
        p = keyed('Position 2D', transform(layer('Position 2D'), 'ADBE Position'), [[0, [200, 540]], [24, [960, 200]], [54, [1700, 800]]]);
        // AE wants 3-value tangents even on a 2D layer.
        tangents(p, [[[0, 0, 0], [300, -300, 0]], [[-300, 0, 0], [300, 0, 0]], [[-100, -350, 0], [0, 0, 0]]]);
        p = keyed('Position 3D', transform(layer('Position 3D', true), 'ADBE Position'),
            [[0, [960, 540, 0]], [34, [1400, 300, -900]], [60, [600, 700, 200]]]);
        tangents(p, [[[0, 0, 0], [200, 0, -300]], [[0, 200, 200], [-100, 0, 100]], [[0, -150, 0], [0, 0, 0]]]);
        var separated = layer('Separated');
        transform(separated, 'ADBE Position').dimensionsSeparated = true;
        keyed('X Position', transform(separated, 'ADBE Position_0'), [[0, 200], [24, 900], [48, 500]]);
        keyed('Y Position', transform(separated, 'ADBE Position_1'), [[0, 300], [30, 700], [48, 540]]);
        keyed('Colour', colour('Colour'), [[0, [1, 0, 0, 1]], [24, [0, 0.5, 1, 1]], [48, [0.2, 0.9, 0.1, 0.5]]]);

        // Hold, roving, expression, Time Remap, continuous.
        p = keyed('Hold', transform(layer('Hold'), 'ADBE Opacity'), [[0, 0], [24, 100], [48, 30], [72, 80]]);
        p.setInterpolationTypeAtKey(2, LINEAR, HOLD);
        p = keyed('Roving', transform(layer('Roving'), 'ADBE Position'), [[0, [100, 100]], [24, [500, 200]], [48, [900, 600]], [72, [1500, 500]]]);
        p.setRovingAtKey(3, true);
        p = keyed('Expression', transform(layer('Expression'), 'ADBE Rotate Z'), [[0, 0], [24, 180], [48, 90]]);
        p.expression = 'value + 10';
        var precomp = app.project.items.addComp('AfterEase fixture precomp ' + args.label, 1920, 1080, 1, 10, args.fps);
        var remapped = comp.layers.add(precomp);
        remapped.name = 'Time Remap';
        remapped.timeRemapEnabled = true;
        // AE adds keys at the layer's start and end; add two more.
        keyed('Time Remap', remapped.property('ADBE Time Remapping'), [[24, 2], [60, 1]]);
        p = keyed('Continuous', transform(layer('Continuous'), 'ADBE Rotate Z'), [[0, 0], [24, 90], [48, 0]]);
        p.setInterpolationTypeAtKey(2, BEZIER, BEZIER);
        p.setTemporalContinuousAtKey(2, true);
        p.setTemporalAutoBezierAtKey(2, true);

        // Partial selections, scopes, overshoot, undo.
        keyed('Pair', transform(layer('Pair'), 'ADBE Opacity'), opacityKeys);
        keyed('Lone', transform(layer('Lone'), 'ADBE Opacity'), opacityKeys);
        keyed('Scope in', transform(layer('Scope in'), 'ADBE Rotate Z'), [[0, 0], [24, 90], [48, 0]]);
        keyed('Scope out', transform(layer('Scope out'), 'ADBE Rotate Z'), [[0, 0], [24, 90], [48, 0]]);
        keyed('Overshoot 1D', transform(layer('Overshoot 1D'), 'ADBE Rotate Z'), [[0, 0], [24, 90]]);
        keyed('Overshoot path', transform(layer('Overshoot path'), 'ADBE Position'), [[0, [200, 540]], [24, [1700, 540]]]);
        keyed('Overshoot colour', colour('Overshoot colour'), [[0, [0, 0, 1, 1]], [24, [1, 1, 0, 1]]]);
        // Bezier sides AE reset to influence 0, as scripts often leave them.
        p = keyed('Bezier zero', transform(layer('Bezier zero'), 'ADBE Rotate Z'), [[0, 0], [24, 45], [48, 10]]);
        for (var i = 1; i <= p.numKeys; i += 1) {
            p.setInterpolationTypeAtKey(i, BEZIER, BEZIER);
        }
        keyed('Undo', transform(layer('Undo'), 'ADBE Opacity'), [[0, 10], [24, 90], [48, 40]]);

        return { compId: comp.id, frameDuration: f, items: items };
    };
}(AfterEase));
