'use strict';

// The AfterEase panel: a curve editor with value and speed views, presets,
// reading a curve from keys, and applying it to the selected keys with a
// scope. Each apply is one host read and one write, so one undo step; all the
// maths is in core/.

(function () {
  const $ = id => document.getElementById(id);
  const cep = window.cep;
  const host = window.host;

  function say(text, tone = '') {
    const el = $('status');
    el.textContent = text;
    el.title = text;
    el.className = `status ${tone}`;
  }

  if (!cep.available) {
    say('Open this panel in After Effects: Window > Extensions (Legacy) > AfterEase.');
    return;
  }

  const nodeRequire = cep.nodeRequire;
  const root = cep.extensionPath();
  const path = nodeRequire('path');
  const load = rel => nodeRequire(path.join(root, rel));
  const { planApply, readCurve, verifyWrite } = load('core/apply.js');
  const { BUILT_IN, isCurve } = load('core/presets.js');
  const speed = load('core/speed.js');
  const { createCurveEditor } = load('client/editor/curveEditor.js');
  const { drawThumbnail } = load('client/editor/thumbnail.js');
  const S = load('client/state/store.js');
  const store = S.createStore({
    fs: nodeRequire('fs'),
    path,
    dir: S.folder(process.env, process.platform, nodeRequire('os').homedir(), path),
  });

  let settings = store.loadSettings();
  let userPresets = store.loadPresets();
  let active = null; // the preset the curve came from, until it is edited
  const FIELDS = ['x1', 'y1', 'x2', 'y2'];
  const fallbackCurve = BUILT_IN.find(p => p.id === 'both-gentle').curve;

  function saveSettings(change) {
    settings = { ...settings, ...change };
    try {
      store.saveSettings(settings);
    } catch (e) {
      say(`Couldn't save settings to ${store.dir}: ${e.message}`, 'error');
    }
  }

  function savePresets(list) {
    userPresets = list;
    try {
      store.savePresets(list);
    } catch (e) {
      say(`Couldn't save presets to ${store.dir}: ${e.message}`, 'error');
    }
    renderPresets();
  }

  // --- Applying ----------------------------------------------------------------

  let busy = false;
  let queued = null;

  async function apply(curve, name) {
    if (busy) {
      queued = { curve, name };
      return;
    }
    busy = true;
    try {
      const selection = await host.call('readSelection');
      const plan = planApply(selection, curve, { scope: settings.scope, undoName: `AfterEase: ${name || 'apply curve'}` });
      if (!plan.writes.length) {
        say(plan.notices.join(' '), 'note');
        return;
      }
      const problems = verifyWrite(plan, await host.call('writeKeys', plan));
      const segments = plan.writes.reduce((n, w) => n + w.segments.length, 0);
      const props = plan.writes.length;
      const done = `Eased ${segments} ${segments === 1 ? 'segment' : 'segments'} on ${props} ${props === 1 ? 'property' : 'properties'}.`;
      say([done, ...plan.notices, ...problems].join(' '), problems.length ? 'warn' : plan.notices.length ? 'note' : 'ok');
    } catch (e) {
      say(`After Effects reported a problem: ${e.message}`, 'error');
    } finally {
      busy = false;
      if (queued) {
        const q = queued;
        queued = null;
        apply(q.curve, q.name);
      }
    }
  }

  // --- Curve, editor and numbers -------------------------------------------------

  const fmt = v => String(Math.round(v * 1000) / 1000);

  function showNumbers(curve) {
    for (const k of FIELDS) if (document.activeElement !== $(k)) $(k).value = fmt(curve[k]);
  }

  function markActive() {
    for (const t of document.querySelectorAll('.tile[data-id]')) t.classList.toggle('on', t.dataset.id === active);
  }

  // The curve changed and is final: remember it, and apply it if set to.
  function commit(curve, name) {
    saveSettings({ curve });
    if (settings.applyOnRelease) apply(curve, name);
  }

  let lastLive = 0;
  const editor = createCurveEditor($('curve'), {
    onInput(curve) {
      active = null;
      markActive();
      showNumbers(curve);
      if (settings.live && Date.now() - lastLive > 120) {
        lastLive = Date.now();
        apply(curve);
      }
    },
    onCommit(curve) {
      showNumbers(curve);
      commit(curve);
    },
    onView(view) {
      showView(view);
    },
  });

  function setCurve(curve, presetId) {
    editor.set(curve);
    active = presetId;
    markActive();
    showNumbers(editor.get());
  }

  for (const k of FIELDS) {
    $(k).addEventListener('keydown', e => {
      if (e.key === 'Enter') e.target.blur();
      if (e.key === 'Escape') {
        showNumbers(editor.get());
        e.target.blur();
      }
    });
    $(k).addEventListener('change', () => {
      const c = { ...editor.get() };
      const v = Number(String($(k).value).replace(',', '.'));
      if (!Number.isFinite(v)) {
        say(`${k} needs a number.`, 'note');
        showNumbers(c);
        return;
      }
      c[k] = v;
      const settled = speed.settle(c);
      if (settled[k] !== v) say(`${k} was kept between ${k === 'x1' ? '0.001 and 1' : '0 and 0.999'}, AE's influence range.`, 'note');
      setCurve(settled, null);
      commit(editor.get());
    });
  }

  // --- Views and scope -------------------------------------------------------------

  function showView(view) {
    for (const b of $('view').querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === view);
    if (settings.view !== view) saveSettings({ view });
  }

  $('view').addEventListener('click', e => {
    const v = e.target.dataset && e.target.dataset.view;
    if (!v) return;
    editor.setView(v);
    showView(v);
  });

  function showScope() {
    for (const b of $('scope').querySelectorAll('button')) b.classList.toggle('on', b.dataset.scope === settings.scope);
  }

  $('scope').addEventListener('click', e => {
    const s = e.target.dataset && e.target.dataset.scope;
    if (!s) return;
    saveSettings({ scope: s });
    showScope();
  });

  $('apply').addEventListener('click', () => apply(editor.get(), active ? presetName(active) : null));

  $('read').addEventListener('click', async () => {
    try {
      const found = readCurve(await host.call('readSelection'));
      if (!found) {
        say('Select two neighbouring keys to read their curve.', 'note');
        return;
      }
      setCurve(found.curve, null);
      saveSettings({ curve: editor.get() });
      say(`Read the curve from ${found.label}.`, 'ok');
    } catch (e) {
      say(`After Effects reported a problem: ${e.message}`, 'error');
    }
  });

  // --- Presets -----------------------------------------------------------------------

  const presetName = id => (BUILT_IN.find(p => p.id === id) || userPresets.find(p => p.id === id) || {}).name || null;

  function pick(p) {
    setCurve(p.curve, p.id);
    commit(editor.get(), p.group && p.group !== 'Linear' ? `${p.group}, ${p.name.toLowerCase()}` : p.name);
  }

  function tile(p, user) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.dataset.id = p.id;
    b.title = user ? `${p.name} (right-click to rename, replace or delete; drag to reorder)` : p.hint;
    const canvas = document.createElement('canvas');
    canvas.className = 'thumb';
    b.appendChild(canvas);
    if (user) {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      b.appendChild(name);
    }
    b.addEventListener('click', () => pick(p));
    if (user) wireUserTile(b, p);
    return { el: b, draw: () => drawThumbnail(canvas, p.curve) };
  }

  function renderPresets() {
    const box = $('presets');
    box.textContent = '';
    const drawn = [];
    const groups = [];
    for (const p of BUILT_IN) {
      let g = groups.find(x => x.name === p.group);
      if (!g) groups.push(g = { name: p.group, presets: [] });
      g.presets.push(p);
    }
    for (const g of groups) {
      const row = document.createElement('div');
      row.className = 'preset-row';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = g.name;
      row.appendChild(label);
      for (const p of g.presets) {
        const t = tile(p, false);
        row.appendChild(t.el);
        drawn.push(t);
      }
      box.appendChild(row);
    }
    const heading = document.createElement('div');
    heading.className = 'preset-heading';
    heading.textContent = 'My presets';
    box.appendChild(heading);
    const mine = document.createElement('div');
    mine.className = 'user-presets';
    for (const p of userPresets) {
      const t = tile(p, true);
      mine.appendChild(t.el);
      drawn.push(t);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tile add';
    add.textContent = '+';
    add.title = 'Save the current curve as a preset';
    add.addEventListener('click', () => {
      const id = `p${Date.now().toString(36)}`;
      savePresets(S.addPreset(userPresets, S.uniqueName(userPresets), editor.get(), id));
      active = id;
      markActive();
      rename(id);
    });
    mine.appendChild(add);
    box.appendChild(mine);
    // Thumbnails need their laid-out size.
    requestAnimationFrame(() => drawn.forEach(t => t.draw()));
    markActive();
  }

  // Inline rename: Enter or clicking away keeps it, Esc cancels.
  function rename(id) {
    const el = document.querySelector(`.user-presets .tile[data-id="${id}"] .name`);
    if (!el) return;
    const input = document.createElement('input');
    input.value = userPresets.find(p => p.id === id).name;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      if (keep) savePresets(S.renamePreset(userPresets, id, input.value));
      else renderPresets();
    };
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  let menuFor = null;

  function wireUserTile(b, p) {
    b.draggable = true;
    b.addEventListener('contextmenu', e => {
      e.preventDefault();
      menuFor = p.id;
      openMenu($('context'), e.clientX, e.clientY);
    });
    b.addEventListener('dblclick', e => {
      e.preventDefault();
      rename(p.id);
    });
    b.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', p.id);
      e.dataTransfer.effectAllowed = 'move';
      b.classList.add('dragging');
    });
    b.addEventListener('dragend', () => b.classList.remove('dragging'));
    b.addEventListener('dragover', e => {
      e.preventDefault();
      b.classList.add('drop-before');
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop-before'));
    b.addEventListener('drop', e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const to = userPresets.filter(q => q.id !== id).findIndex(q => q.id === p.id);
      if (id && id !== p.id) savePresets(S.movePreset(userPresets, id, to));
    });
  }

  // Dropping on the + tile moves a preset to the end.
  $('presets').addEventListener('dragover', e => {
    if (e.target.classList && e.target.classList.contains('add')) e.preventDefault();
  });
  $('presets').addEventListener('drop', e => {
    if (!(e.target.classList && e.target.classList.contains('add'))) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) savePresets(S.movePreset(userPresets, id, userPresets.length));
  });

  $('context').addEventListener('click', e => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act || !menuFor) return;
    closeMenus();
    if (act === 'rename') rename(menuFor);
    if (act === 'replace') {
      savePresets(S.replacePreset(userPresets, menuFor, editor.get()));
      active = menuFor;
      markActive();
    }
    if (act === 'delete') savePresets(S.removePreset(userPresets, menuFor));
  });

  // --- Menus ---------------------------------------------------------------------------

  function openMenu(menu, x, y) {
    closeMenus();
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  }

  function closeMenus() {
    $('settings').hidden = true;
    $('context').hidden = true;
  }

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.menu') && e.target.id !== 'menu-button') closeMenus();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenus();
  });

  $('menu-button').addEventListener('click', e => {
    if (!$('settings').hidden) {
      closeMenus();
      return;
    }
    const r = e.target.getBoundingClientRect();
    openMenu($('settings'), r.right - 220, r.bottom + 4);
  });
  $('opt-release').addEventListener('change', e => saveSettings({ applyOnRelease: e.target.checked }));
  $('opt-live').addEventListener('change', e => saveSettings({ live: e.target.checked }));

  // --- Theme and start-up ------------------------------------------------------------

  function applySkin() {
    const skin = cep.hostEnvironment().appSkinInfo;
    const c = skin && skin.panelBackgroundColor && skin.panelBackgroundColor.color;
    if (!c) return;
    const style = document.documentElement.style;
    const shade = d => `rgb(${[c.red, c.green, c.blue].map(v => Math.max(0, Math.min(255, Math.round(v + d)))).join(', ')})`;
    style.setProperty('--bg', shade(0));
    const light = (0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue) / 255 > 0.5;
    document.documentElement.classList.toggle('light', light);
    // On dark backgrounds, every tone is a step from AE's own panel colour.
    const tones = { '--well': -9, '--surface': 10, '--surface-hover': 20, '--surface-on': 36, '--border': 22, '--grid': 1, '--grid-strong': 30 };
    for (const [name, d] of Object.entries(tones)) {
      if (light) style.removeProperty(name); else style.setProperty(name, shade(d));
    }
    editor.draw();
    renderPresets();
  }

  async function start() {
    applySkin();
    cep.on('com.adobe.csxs.events.ThemeColorChanged', applySkin);
    setCurve(isCurve(settings.curve) ? settings.curve : fallbackCurve, null);
    editor.setView(settings.view);
    showView(settings.view);
    showScope();
    $('opt-release').checked = settings.applyOnRelease;
    $('opt-live').checked = settings.live;
    renderPresets();
    try {
      await host.load(root);
      say('Select keys, then pick a preset or shape the curve.');
    } catch (e) {
      say(`The panel couldn't reach After Effects: ${e.message}`, 'error');
    }
  }

  start();
}());
