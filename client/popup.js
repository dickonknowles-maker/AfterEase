'use strict';

// Phase 0 spike 2, route A: can a CEP modeless window move itself to a
// screen position? CEP has no placement API, so this tries window.moveTo
// and reports where the window actually is.

(function () {
  const cep = window.cep;
  const where = document.getElementById('where');

  document.getElementById('close').onclick = () => cep.closeThisExtension();

  cep.on('com.afterease.popup.place', p => {
    if (!p || typeof p.x !== 'number') return;
    const before = { x: window.screenX, y: window.screenY };
    // Screen pixels from the helper; moveTo takes CSS pixels.
    const dpr = window.devicePixelRatio || 1;
    window.moveTo(Math.round(p.x / dpr), Math.round(p.y / dpr));
    setTimeout(() => {
      const after = { x: window.screenX, y: window.screenY };
      where.textContent = `Asked ${p.x}, ${p.y}; now ${after.x}, ${after.y}`;
      cep.dispatch('com.afterease.popup.report', {
        requested: p, before, after, dpr,
        outer: { w: window.outerWidth, h: window.outerHeight },
      });
    }, 100);
  });

  cep.dispatch('com.afterease.popup.ready', { at: Date.now() });
}());
