// AfterEase host adapter (ExtendScript, ES3).
//
// The panel talks to After Effects only through AfterEase.call(name, json).
// Every call returns a JSON string: {"ok":true,"result":...} or
// {"ok":false,"error":"..."}. Host code reads and writes AE data and does no
// easing maths; that lives in core/.

// On $.global, not a plain var: main.jsx loads this file with $.evalFile inside
// a function, and there a var stays local to that function.
var AfterEase = $.global.AfterEase = $.global.AfterEase || {};

(function (A) {
    A.functions = A.functions || {};

    // Some AE errors throw again when turned into text (seen in AE 26.5), and
    // an error escaping into evalScript can leave a modal alert in AE.
    A.describeError = function (e) {
        try {
            return (e && e.message ? e.message : String(e)) + (e && e.line ? ' (line ' + e.line + ')' : '');
        } catch (e2) {
            return 'After Effects reported an error it could not describe';
        }
    };

    A.call = function (name, argsJson) {
        var fn = A.functions[name];
        if (!fn) {
            return JSON.stringify({ ok: false, error: 'Unknown host function: ' + name });
        }
        try {
            var args = argsJson ? JSON.parse(argsJson) : {};
            return JSON.stringify({ ok: true, result: fn(args) });
        } catch (e) {
            return JSON.stringify({ ok: false, error: A.describeError(e) });
        }
    };

    // Run fn inside one undo group, closed even when fn throws.
    A.undoGroup = function (label, fn) {
        app.beginUndoGroup(label);
        try {
            return fn();
        } finally {
            app.endUndoGroup();
        }
    };

    // Phase 0 round trip: echoes the payload and reports the host.
    A.functions.ping = function (args) {
        return {
            echo: args,
            appVersion: app.version,
            buildName: app.buildName,
            os: $.os,
            engine: $.engineName,
            extendScriptVersion: String($.version),
            hasNativeJSON: A.hasNativeJSON,
            projectName: app.project && app.project.file ? app.project.file.name : null
        };
    };

    // --- Names for AE's enums ----------------------------------------------

    var VALUE_TYPES = ['OneD', 'TwoD', 'ThreeD', 'TwoD_SPATIAL', 'ThreeD_SPATIAL', 'COLOR', 'CUSTOM_VALUE',
        'MARKER', 'LAYER_INDEX', 'MASK_INDEX', 'SHAPE', 'TEXT_DOCUMENT', 'NO_VALUE'];
    // Value types whose values are numbers or arrays of numbers.
    var NUMERIC = { OneD: true, TwoD: true, ThreeD: true, TwoD_SPATIAL: true, ThreeD_SPATIAL: true, COLOR: true };

    A.valueTypeName = function (t) {
        for (var i = 0; i < VALUE_TYPES.length; i += 1) {
            if (PropertyValueType[VALUE_TYPES[i]] === t) {
                return VALUE_TYPES[i];
            }
        }
        return 'UNKNOWN';
    };

    A.interpolation = function (name) {
        return KeyframeInterpolationType[name];
    };

    A.interpolationName = function (t) {
        if (t === KeyframeInterpolationType.BEZIER) {
            return 'BEZIER';
        }
        if (t === KeyframeInterpolationType.HOLD) {
            return 'HOLD';
        }
        return 'LINEAR';
    };

    // --- Finding properties again ------------------------------------------
    // A property is found again by its comp's id, its layer (index, checked
    // against the layer's id) and the property indices from the layer down,
    // each checked against its matchName.

    A.refOf = function (comp, prop) {
        var path = [];
        var p = prop;
        while (p.propertyDepth > 0) {
            path.unshift({ index: p.propertyIndex, matchName: p.matchName });
            p = p.parentProperty;
        }
        return { compId: comp.id, layerIndex: p.index, layerId: p.id, path: path };
    };

    A.resolve = function (ref) {
        var comp = app.project.itemByID(ref.compId);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error('Its composition is no longer in the project');
        }
        var layer = null;
        var i;
        if (ref.layerIndex <= comp.numLayers && comp.layer(ref.layerIndex).id === ref.layerId) {
            layer = comp.layer(ref.layerIndex);
        } else {
            for (i = 1; i <= comp.numLayers; i += 1) {
                if (comp.layer(i).id === ref.layerId) {
                    layer = comp.layer(i);
                    break;
                }
            }
        }
        if (!layer) {
            throw new Error('Its layer is no longer in the composition');
        }
        var p = layer;
        for (i = 0; i < ref.path.length; i += 1) {
            var step = ref.path[i];
            p = step.index <= p.numProperties ? p.property(step.index) : null;
            if (!p || p.matchName !== step.matchName) {
                throw new Error('The property is no longer where it was');
            }
        }
        return p;
    };

    // --- Reading keys ----------------------------------------------------------

    A.readEases = function (list) {
        var out = [];
        for (var i = 0; i < list.length; i += 1) {
            out.push({ speed: list[i].speed, influence: list[i].influence });
        }
        return out;
    };

    A.toEases = function (list) {
        var out = [];
        for (var i = 0; i < list.length; i += 1) {
            // AE refuses influences outside 0.1 to 100, and reports 0 for a side
            // it reset when the side was made Bezier.
            out.push(new KeyframeEase(list[i].speed, Math.min(100, Math.max(0.1, list[i].influence))));
        }
        return out;
    };

    // From the value type: AE 26.5 also says isSpatial for colours, which have
    // no spatial tangents.
    A.isSpatial = function (prop) {
        var t = prop.propertyValueType;
        return t === PropertyValueType.TwoD_SPATIAL || t === PropertyValueType.ThreeD_SPATIAL;
    };

    A.readKey = function (prop, i) {
        var k = {
            time: prop.keyTime(i),
            value: prop.keyValue(i),
            selected: prop.keySelected(i),
            inType: A.interpolationName(prop.keyInInterpolationType(i)),
            outType: A.interpolationName(prop.keyOutInterpolationType(i)),
            inEase: A.readEases(prop.keyInTemporalEase(i)),
            outEase: A.readEases(prop.keyOutTemporalEase(i)),
            temporalContinuous: prop.keyTemporalContinuous(i),
            temporalAutoBezier: prop.keyTemporalAutoBezier(i)
        };
        if (A.isSpatial(prop)) {
            k.inTangent = prop.keyInSpatialTangent(i);
            k.outTangent = prop.keyOutSpatialTangent(i);
            k.spatialContinuous = prop.keySpatialContinuous(i);
            k.spatialAutoBezier = prop.keySpatialAutoBezier(i);
            k.roving = prop.keyRoving(i);
        }
        return k;
    };

    // Everything core/ needs about a property. keys is null for value types
    // that can't be eased (paths, text, markers).
    A.describeProperty = function (comp, prop) {
        var layer = prop.propertyGroup(prop.propertyDepth);
        var info = {
            ref: A.refOf(comp, prop),
            layerName: layer.name,
            name: prop.name,
            matchName: prop.matchName,
            valueType: A.valueTypeName(prop.propertyValueType),
            expression: prop.canSetExpression && prop.expressionEnabled && prop.expression !== '',
            keys: null
        };
        if (NUMERIC[info.valueType]) {
            info.keys = [];
            for (var i = 1; i <= prop.numKeys; i += 1) {
                info.keys.push(A.readKey(prop, i));
            }
        }
        return info;
    };

    // --- Adapter functions from SPEC.md ------------------------------------

    // Every property in the active comp with selected keys, with all its keys.
    A.functions.readSelection = function () {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return { comp: null, properties: [] };
        }
        var selected = comp.selectedProperties;
        var properties = [];
        for (var i = 0; i < selected.length; i += 1) {
            var p = selected[i];
            if (p.propertyType === PropertyType.PROPERTY && p.numKeys > 0 && p.selectedKeys.length > 0) {
                properties.push(A.describeProperty(comp, p));
            }
        }
        return {
            comp: { id: comp.id, name: comp.name, frameDuration: comp.frameDuration, time: comp.time },
            properties: properties
        };
    };

    function writeKey(prop, k) {
        var i = k.index;
        prop.setTemporalAutoBezierAtKey(i, !!k.temporalAutoBezier);
        prop.setTemporalContinuousAtKey(i, !!k.temporalContinuous);
        // Writing eases makes both sides Bezier, so the types are set after.
        prop.setTemporalEaseAtKey(i, A.toEases(k.inEase), A.toEases(k.outEase));
        prop.setInterpolationTypeAtKey(i, A.interpolation(k.inType), A.interpolation(k.outType));
    }

    // plan: { undoName, writes: [{ ref, keys: [{ index, time, inType, outType,
    // inEase, outEase, temporalContinuous, temporalAutoBezier }] }] }, as
    // core/apply.js makes it. One undo group. A property whose keys have moved
    // since they were read is left alone and reported. Returns the keys as AE
    // stored them.
    A.functions.writeKeys = function (plan) {
        return A.undoGroup(plan.undoName || 'AfterEase: apply curve', function () {
            var results = [];
            for (var w = 0; w < plan.writes.length; w += 1) {
                var write = plan.writes[w];
                var result = { keys: [] };
                try {
                    var prop = A.resolve(write.ref);
                    var j;
                    for (j = 0; j < write.keys.length; j += 1) {
                        var k = write.keys[j];
                        if (k.index > prop.numKeys || Math.abs(prop.keyTime(k.index) - k.time) > 1e-6) {
                            throw new Error('Its keys have changed since they were read');
                        }
                    }
                    for (j = 0; j < write.keys.length; j += 1) {
                        writeKey(prop, write.keys[j]);
                    }
                    for (j = 0; j < write.keys.length; j += 1) {
                        result.keys.push(A.readKey(prop, write.keys[j].index));
                    }
                } catch (e) {
                    result.error = A.describeError(e);
                }
                results.push(result);
            }
            return { properties: results };
        });
    };

    // Later phases.
    function notYet(name, phase) {
        return function () {
            throw new Error(name + ' is not implemented yet (phase ' + phase + ')');
        };
    }
    A.functions.moveKeys = notYet('moveKeys', 5);
    A.functions.applyExpression = notYet('applyExpression', 5);
    A.functions.setLayerTimes = notYet('setLayerTimes', 5);
}(AfterEase));
