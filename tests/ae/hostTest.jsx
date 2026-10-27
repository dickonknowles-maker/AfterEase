// Test-only host functions for tests/ae/roundtrip.mjs (ExtendScript, ES3):
// selecting keys, reading keys with samples, KeySnapshot round trips, undo.
// Loaded by the test runner, never by the panel.

(function (A) {
    var SAMPLES = 20;

    function read(prop) {
        var keys = [];
        var samples = [];
        var i;
        for (i = 1; i <= prop.numKeys; i += 1) {
            keys.push(A.keySnapshot.capture(prop, i));
        }
        for (i = 1; i < prop.numKeys; i += 1) {
            var tA = prop.keyTime(i);
            var tB = prop.keyTime(i + 1);
            var segment = [];
            for (var j = 0; j <= SAMPLES; j += 1) {
                var t = tA + (tB - tA) * j / SAMPLES;
                segment.push({ time: t, value: prop.valueAtTime(t, true) });
            }
            samples.push(segment);
        }
        return { matchName: prop.matchName, valueType: A.valueTypeName(prop.propertyValueType), keys: keys, samples: samples };
    }

    // args: { refs } -> every key of each property, and 21 samples per segment.
    A.functions.testRead = function (args) {
        var out = [];
        for (var i = 0; i < args.refs.length; i += 1) {
            out.push(read(A.resolve(args.refs[i])));
        }
        return out;
    };

    // args: { compId, select: [{ ref, keys: [1-based indices] }] }. Opens the
    // comp, clears the selection, then selects exactly those keys.
    A.functions.testSelect = function (args) {
        var comp = app.project.itemByID(args.compId);
        comp.openInViewer();
        var selected = comp.selectedProperties;
        var i;
        var j;
        for (i = 0; i < selected.length; i += 1) {
            var p = selected[i];
            if (p.propertyType === PropertyType.PROPERTY) {
                var keys = p.selectedKeys;
                for (j = 0; j < keys.length; j += 1) {
                    p.setSelectedAtKey(keys[j], false);
                }
            }
            p.selected = false;
        }
        for (i = 1; i <= comp.numLayers; i += 1) {
            comp.layer(i).selected = false;
        }
        for (i = 0; i < args.select.length; i += 1) {
            var prop = A.resolve(args.select[i].ref);
            for (j = 0; j < args.select[i].keys.length; j += 1) {
                prop.setSelectedAtKey(args.select[i].keys[j], true);
            }
        }
        return comp.selectedProperties.length;
    };

    // args: { ref }. For each key, last to first: capture every key, remove
    // this one, restore it, reapply the others. Returns the property before
    // and after each round trip.
    A.functions.testSnapshotRoundTrip = function (args) {
        var prop = A.resolve(args.ref);
        var results = [];
        for (var k = prop.numKeys; k >= 1; k -= 1) {
            var before = read(prop);
            var all = A.keySnapshot.captureAll(prop);
            prop.removeKey(k);
            var index = A.keySnapshot.restore(prop, all[k - 1]);
            all.splice(k - 1, 1);
            A.keySnapshot.reapply(prop, all);
            results.push({ key: k, index: index, before: before, after: read(prop) });
        }
        return results;
    };

    // Edit > Undo.
    A.functions.testUndo = function () {
        app.executeCommand(16);
        return 'undone';
    };
}(AfterEase));
