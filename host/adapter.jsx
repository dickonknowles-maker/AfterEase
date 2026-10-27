// AfterEase host adapter (ExtendScript, ES3).
//
// The panel talks to After Effects only through AfterEase.call(name, json).
// Every call returns a JSON string: {"ok":true,"result":...} or
// {"ok":false,"error":"..."}. Host code reads and writes AE data and does no
// easing maths; that lives in core/.

var AfterEase = AfterEase || {};

(function (A) {
    A.functions = A.functions || {};

    A.call = function (name, argsJson) {
        var fn = A.functions[name];
        if (!fn) {
            return JSON.stringify({ ok: false, error: 'Unknown host function: ' + name });
        }
        try {
            var args = argsJson ? JSON.parse(argsJson) : {};
            return JSON.stringify({ ok: true, result: fn(args) });
        } catch (e) {
            return JSON.stringify({ ok: false, error: String(e) + (e.line ? ' (line ' + e.line + ')' : '') });
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

    // Adapter functions from SPEC.md. Implemented in phase 1 onwards.
    function notYet(name) {
        return function () {
            throw new Error(name + ' is not implemented yet (phase 1)');
        };
    }
    A.functions.readSelection = notYet('readSelection');
    A.functions.writeKeys = notYet('writeKeys');
    A.functions.moveKeys = notYet('moveKeys');
    A.functions.applyExpression = notYet('applyExpression');
    A.functions.setLayerTimes = notYet('setLayerTimes');
}(AfterEase));
