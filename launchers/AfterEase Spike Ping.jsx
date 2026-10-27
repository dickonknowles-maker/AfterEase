// Phase 0 spike 1: put this file in AE's Scripts folder, bind it in
// Edit > Keyboard Shortcuts, press the shortcut with the AfterEase panel open.
// It sends a CSXS event; the panel logs it with the delay.
(function () {
    try {
        new ExternalObject('lib:PlugPlugExternalObject');
    } catch (e) {
        alert('AfterEase: could not load PlugPlugExternalObject.\n' + e);
        return;
    }
    var ev = new CSXSEvent();
    ev.type = 'com.afterease.launcher';
    ev.data = '{"command":"ping","sentAt":' + new Date().getTime() + '}';
    ev.dispatch();
}());
