// Loads the host layer into the panel's ExtendScript engine. The panel calls
// AfterEaseLoad(root) once at start-up with the extension's folder.

function AfterEaseLoad(root) {
    var hadJSON = typeof JSON === 'object' && typeof JSON.parse === 'function';
    var files = [
        'host/json2.jsx',
        'host/adapter.jsx',
        'host/keySnapshot.jsx',
        'host/spikes/easeModel.jsx',
        'host/spikes/popup.jsx'
    ];
    for (var i = 0; i < files.length; i += 1) {
        var f = new File(root + '/' + files[i]);
        if (!f.exists) {
            return 'missing: ' + f.fsName;
        }
        $.evalFile(f);
    }
    AfterEase.hasNativeJSON = hadJSON;
    return 'ok';
}
