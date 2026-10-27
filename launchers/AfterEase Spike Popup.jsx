// Phase 0 spikes 1 and 2 together: the shortcut asks the panel to open the
// popup at the cursor, using whichever route is chosen in the panel.
(function () {
    try {
        new ExternalObject('lib:PlugPlugExternalObject');
    } catch (e) {
        alert('AfterEase: could not load PlugPlugExternalObject.\n' + e);
        return;
    }
    var ev = new CSXSEvent();
    ev.type = 'com.afterease.launcher';
    ev.data = '{"command":"popup","sentAt":' + new Date().getTime() + '}';
    ev.dispatch();
}());
