'use strict';

// The curve editor: a canvas showing the curve and its two handles, either as
// value (progress over time) or as speed (speed over time, 1 = the segment's
// average). Both views edit the same { x1, y1, x2, y2 }, so Tab can switch
// views mid-drag without changing the curve. Dragging calls onInput; letting
// go calls onCommit. Colours come from the canvas's CSS custom properties.

const bezier = require('../../core/bezier');
const speed = require('../../core/speed');

const DOT = 5; // handle radius, CSS pixels
const GRAB = 12; // how near a press must be to grab a handle
const PAD = { left: 12, right: 12, top: 14, bottom: 14 };
const SPEED_CAP = 8; // the speed view shows at most 8 times the average speed

function createCurveEditor(canvas, { onInput = () => {}, onCommit = () => {}, onView = () => {} } = {}) {
  const win = canvas.ownerDocument.defaultView;
  const ctx = canvas.getContext('2d');
  let curve = { x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1 };
  let view = 'value';
  let drag = null; // 'start' or 'end'
  let hover = null;
  let frozen = null; // the y range is kept while dragging, so the scale doesn't run away

  function yRange() {
    if (frozen) return frozen;
    if (view === 'value') {
      return { lo: Math.min(0, curve.y1, curve.y2) - 0.25, hi: Math.max(1, curve.y1, curve.y2) + 0.25 };
    }
    const speeds = speed.samples(curve, 60).map(p => p.speed)
      .concat([speed.startSpeed(curve), speed.endSpeed(curve)])
      .filter(Number.isFinite)
      .map(s => Math.max(-SPEED_CAP, Math.min(SPEED_CAP, s)));
    const lo = Math.min(0, ...speeds);
    const hi = Math.max(1.5, ...speeds);
    const pad = (hi - lo) * 0.12;
    return { lo: lo - pad, hi: hi + pad };
  }

  function frame() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const r = yRange();
    const left = PAD.left;
    const right = w - PAD.right;
    const top = PAD.top;
    const bottom = h - PAD.bottom;
    return {
      w, h, left, right, top, bottom, r,
      px: x => left + x * (right - left),
      py: v => bottom - (Math.max(r.lo, Math.min(r.hi, v)) - r.lo) / (r.hi - r.lo) * (bottom - top),
      fx: px => (px - left) / (right - left),
      fy: py => r.lo + (bottom - py) / (bottom - top) * (r.hi - r.lo),
    };
  }

  // Each handle in the current view: its dot (x, y) and where its line starts.
  function handles() {
    if (view === 'value') {
      return { start: { x: curve.x1, y: curve.y1, ax: 0, ay: 0 }, end: { x: curve.x2, y: curve.y2, ax: 1, ay: 1 } };
    }
    const s0 = speed.startSpeed(curve);
    const s1 = speed.endSpeed(curve);
    return { start: { x: curve.x1, y: s0, ax: 0, ay: s0 }, end: { x: curve.x2, y: s1, ax: 1, ay: s1 } };
  }

  function hit(px, py) {
    const f = frame();
    const hs = handles();
    let best = null;
    let nearest = GRAB;
    for (const name of ['start', 'end']) {
      const d = Math.hypot(f.px(hs[name].x) - px, f.py(hs[name].y) - py);
      if (d <= nearest) {
        best = name;
        nearest = d;
      }
    }
    return best;
  }

  function moveHandle(name, px, py) {
    const f = frame();
    const x = f.fx(px);
    const y = Math.max(f.r.lo, Math.min(f.r.hi, f.fy(py)));
    if (view === 'value') {
      curve = speed.settle(name === 'start' ? { ...curve, x1: x, y1: y } : { ...curve, x2: x, y2: y });
    } else {
      curve = name === 'start' ? speed.withStart(curve, x, y) : speed.withEnd(curve, x, y);
    }
  }

  function colours() {
    const css = win.getComputedStyle(canvas);
    const c = name => css.getPropertyValue(name).trim();
    return { grid: c('--grid'), axis: c('--grid-strong'), curve: c('--curve'), handle: c('--handle'), line: c('--handle-line'), text: c('--muted') };
  }

  function draw() {
    const dpr = win.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const f = frame();
    const col = colours();
    const crisp = v => Math.round(v) + 0.5;
    const line = (x0, y0, x1, y1, colour, dash = []) => {
      ctx.strokeStyle = colour;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Grid: quarters of the segment's time; value 0 and 1, or speed 0 and the average.
    ctx.lineWidth = 1;
    for (const x of [0.25, 0.5, 0.75]) line(crisp(f.px(x)), f.top, crisp(f.px(x)), f.bottom, col.grid);
    for (const x of [0, 1]) line(crisp(f.px(x)), f.top, crisp(f.px(x)), f.bottom, col.axis);
    line(f.left, crisp(f.py(0)), f.right, crisp(f.py(0)), col.axis);
    line(f.left, crisp(f.py(1)), f.right, crisp(f.py(1)), view === 'value' ? col.axis : col.grid, view === 'value' ? [] : [3, 3]);
    ctx.fillStyle = col.text;
    ctx.font = '10px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    if (view === 'speed') ctx.fillText('average', f.right - 3, f.py(1) - 2);
    if (view === 'value') line(f.px(0), f.py(0), f.px(1), f.py(1), col.grid, [2, 4]);

    // The curve, clipped to the plot.
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.left - 3, f.top - 3, f.right - f.left + 6, f.bottom - f.top + 6);
    ctx.clip();
    ctx.strokeStyle = col.curve;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (view === 'value') {
      for (let i = 0; i <= 120; i++) {
        const p = bezier.point(curve, i / 120);
        const X = f.px(p.x);
        const Y = f.py(p.y);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
    } else {
      speed.samples(curve, 160).forEach((p, i) => {
        const X = f.px(p.x);
        const Y = f.py(p.speed);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
    }
    ctx.stroke();
    ctx.restore();

    // Handles.
    const hs = handles();
    ctx.lineWidth = 1.5;
    for (const name of ['start', 'end']) {
      const hd = hs[name];
      line(f.px(hd.ax), f.py(hd.ay), f.px(hd.x), f.py(hd.y), col.line);
    }
    for (const name of ['start', 'end']) {
      const hd = hs[name];
      const big = drag === name || hover === name;
      ctx.fillStyle = col.handle;
      ctx.beginPath();
      ctx.arc(f.px(hd.x), f.py(hd.y), big ? DOT + 1.5 : DOT, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col.line;
      ctx.fillRect(f.px(hd.ax) - 2.5, f.py(hd.ay) - 2.5, 5, 5);
    }
  }

  function local(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', e => {
    const p = local(e);
    const name = hit(p.x, p.y);
    if (!name) return;
    drag = name;
    frozen = yRange();
    canvas.setPointerCapture(e.pointerId);
    canvas.focus();
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    draw();
  });
  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    if (drag) {
      moveHandle(drag, p.x, p.y);
      draw();
      onInput(get());
      return;
    }
    const near = hit(p.x, p.y);
    if (near !== hover) {
      hover = near;
      canvas.style.cursor = near ? 'grab' : '';
      draw();
    }
  });
  const release = e => {
    if (!drag) return;
    drag = null;
    frozen = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    canvas.style.cursor = hover ? 'grab' : '';
    draw();
    onCommit(get());
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (!drag && hover) {
      hover = null;
      canvas.style.cursor = '';
      draw();
    }
  });
  canvas.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    setView(view === 'value' ? 'speed' : 'value');
    onView(view);
  });
  if (win.ResizeObserver) new win.ResizeObserver(() => draw()).observe(canvas);

  function get() {
    return { ...curve };
  }

  function set(c) {
    curve = speed.settle(c);
    draw();
  }

  // Mid-drag, the new view gets its own fixed scale.
  function setView(v) {
    view = v;
    frozen = null;
    if (drag) frozen = yRange();
    draw();
  }

  return { get, set, setView, getView: () => view, draw, isDragging: () => !!drag };
}

module.exports = { createCurveEditor };
