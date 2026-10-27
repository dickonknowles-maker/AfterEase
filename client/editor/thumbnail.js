'use strict';

// A preset's curve, drawn small: progress over time, with room for overshoot.
// Colours come from the canvas's CSS custom properties.

const bezier = require('../../core/bezier');

function drawThumbnail(canvas, curve) {
  const win = canvas.ownerDocument.defaultView;
  const dpr = win.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = win.getComputedStyle(canvas);
  const lo = Math.min(0, curve.y1, curve.y2);
  const hi = Math.max(1, curve.y1, curve.y2);
  const pad = 4;
  const px = x => pad + x * (w - 2 * pad);
  const py = v => h - pad - (v - lo) / (hi - lo) * (h - 2 * pad);
  ctx.strokeStyle = css.getPropertyValue('--grid').trim();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(0), Math.round(py(0)) + 0.5);
  ctx.lineTo(px(1), Math.round(py(0)) + 0.5);
  ctx.moveTo(px(0), Math.round(py(1)) + 0.5);
  ctx.lineTo(px(1), Math.round(py(1)) + 0.5);
  ctx.stroke();
  ctx.strokeStyle = css.getPropertyValue('--curve').trim();
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const p = bezier.point(curve, i / 40);
    if (i === 0) ctx.moveTo(px(p.x), py(p.y)); else ctx.lineTo(px(p.x), py(p.y));
  }
  ctx.stroke();
}

module.exports = { drawThumbnail };
