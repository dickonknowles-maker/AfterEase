// Phase 0 spike 2, route B: a ScriptUI palette placed at a screen position
// the panel got from the cursor helper. ScriptUI windows accept a location,
// which CEP windows may not.

(function (A) {
    A.functions.spikeScriptUIPopup = function (args) {
        if ($.global.AfterEaseSpikePalette) {
            try {
                $.global.AfterEaseSpikePalette.close();
            } catch (e) {}
        }
        var w = new Window('palette', 'AfterEase', undefined, { borderless: !!args.borderless, closeButton: true });
        w.margins = 8;
        w.spacing = 6;
        w.add('statictext', undefined, 'Spike: placed at ' + args.x + ', ' + args.y);
        var row = w.add('group');
        row.add('button', undefined, 'Ease in');
        row.add('button', undefined, 'Ease out');
        var close = w.add('button', undefined, 'Close');
        close.onClick = function () {
            w.close();
        };
        w.layout.layout(true);
        // Put the window's top-left corner at the requested point.
        w.location = [args.x, args.y];
        w.show();
        $.global.AfterEaseSpikePalette = w;
        return {
            requested: [args.x, args.y],
            location: [w.location[0], w.location[1]],
            frameBounds: [w.frameBounds[0], w.frameBounds[1], w.frameBounds[2], w.frameBounds[3]]
        };
    };
}(AfterEase));
