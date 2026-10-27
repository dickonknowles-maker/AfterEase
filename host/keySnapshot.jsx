// KeySnapshot (ExtendScript, ES3): capture everything a key holds, and put
// it all back after the key has been removed and added again. AE has no API
// for moving a key, so Mirror X, Align, Snap frames and pasted runs are all
// capture, remove (last to first, so indices stay valid), add, restore.
//
// Removing or adding a key changes the keys either side of it: AE 26.5
// rescales their influences and spatial tangents, and can turn a Linear side
// Bezier. So capture every key first, and after the keys are back, reapply
// the snapshots of the keys that stayed put.

(function (A) {
    var S = A.keySnapshot = {};

    S.capture = function (prop, i) {
        var k = A.readKey(prop, i);
        if (typeof prop.keyLabel === 'function') {
            k.label = prop.keyLabel(i);
        }
        return k;
    };

    // Sets every attribute of key i from a snapshot. One limit: a Bezier side
    // at influence 0 (what AE leaves when a script turns a Linear key Bezier)
    // comes back at 0.1, the lowest influence an ease can be set to. That is a
    // handle a thousandth of the segment long; no way back to 0 was found.
    S.apply = function (prop, i, snap) {
        prop.setTemporalAutoBezierAtKey(i, false);
        prop.setTemporalContinuousAtKey(i, false);
        prop.setTemporalEaseAtKey(i, A.toEases(snap.inEase), A.toEases(snap.outEase));
        prop.setInterpolationTypeAtKey(i, A.interpolation(snap.inType), A.interpolation(snap.outType));
        prop.setTemporalContinuousAtKey(i, snap.temporalContinuous);
        prop.setTemporalAutoBezierAtKey(i, snap.temporalAutoBezier);
        if (A.isSpatial(prop)) {
            prop.setSpatialAutoBezierAtKey(i, false);
            prop.setSpatialContinuousAtKey(i, false);
            prop.setSpatialTangentsAtKey(i, snap.inTangent, snap.outTangent);
            prop.setSpatialContinuousAtKey(i, snap.spatialContinuous);
            prop.setSpatialAutoBezierAtKey(i, snap.spatialAutoBezier);
            // Roving retimes the key, so it goes last.
            if (snap.roving) {
                prop.setRovingAtKey(i, true);
            }
        }
        if (snap.label !== undefined && typeof prop.setLabelAtKey === 'function') {
            prop.setLabelAtKey(i, snap.label);
        }
        prop.setSelectedAtKey(i, snap.selected);
    };

    S.captureAll = function (prop) {
        var out = [];
        for (var i = 1; i <= prop.numKeys; i += 1) {
            out.push(S.capture(prop, i));
        }
        return out;
    };

    // Adds a key at time (default: where it was) and restores the snapshot
    // onto it. Returns the new key's index.
    S.restore = function (prop, snap, time) {
        var t = time === undefined ? snap.time : time;
        prop.setValueAtTime(t, snap.value);
        var i = prop.nearestKeyIndex(t);
        S.apply(prop, i, snap);
        return i;
    };

    // Applies each snapshot to the key now at its time, if there is one.
    // Roving keys are found by order instead, since AE retimes them.
    S.reapply = function (prop, snaps) {
        for (var s = 0; s < snaps.length; s += 1) {
            var i = prop.nearestKeyIndex(snaps[s].time);
            if (Math.abs(prop.keyTime(i) - snaps[s].time) < 1e-6 || snaps[s].roving) {
                S.apply(prop, i, snaps[s]);
            }
        }
    };
}(AfterEase));
