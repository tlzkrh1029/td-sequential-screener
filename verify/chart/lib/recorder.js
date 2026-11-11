// Canvas recorder and page instrumentation, installed before any script of the page runs (context.addInitScript).
// It knows nothing of the page's code: it keeps what reaches every canvas. Per canvas the calls since the last full
// wipe (a fillRect or clearRect over the whole canvas) are "the frame": exactly what is on that canvas now.
// Kept per call: the arguments, the styles in force, and for fillText the measured ink box of the text.
module.exports = function installRecorder() {
  if (window.__qa) return;
  const QA = (window.__qa = { opens: [], seq: 0, wipes: 0 });
  const P = CanvasRenderingContext2D.prototype;
  const norm = (c) => (typeof c === 'string' ? c.toLowerCase() : 'obj');
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const frameOf = (cv) => cv.__qaFrame || (cv.__qaFrame = { n: 0, calls: [] });
  const scaleOf = (ctx) => { const t = ctx.getTransform(); return [t.a, t.d, t.e, t.f]; };
  const st = (ctx) => ({ fs: norm(ctx.fillStyle), ss: norm(ctx.strokeStyle), al: r3(ctx.globalAlpha), lw: ctx.lineWidth, dash: ctx.getLineDash() });
  const push = (ctx, c) => { const f = frameOf(ctx.canvas); c.i = QA.seq++; const t = scaleOf(ctx); if (t[0] !== (window.devicePixelRatio || 1) || t[2] || t[3]) c.tr = t; f.calls.push(c); };
  const whole = (ctx, x, y, w, h) => { const t = scaleOf(ctx), cv = ctx.canvas; return x * t[0] + t[2] <= 0.5 && y * t[1] + t[3] <= 0.5 && (x + w) * t[0] + t[2] >= cv.width - 0.5 && (y + h) * t[1] + t[3] >= cv.height - 0.5; };
  for (const name of ['fillRect', 'clearRect', 'strokeRect']) {
    const orig = P[name];
    P[name] = function (x, y, w, h) {
      if (name !== 'strokeRect' && whole(this, x, y, w, h)) { const f = frameOf(this.canvas); f.n++; f.calls = []; QA.wipes++; }
      push(this, { op: name === 'fillRect' ? 'fr' : name === 'clearRect' ? 'cr' : 'sr', x, y, w, h, ...st(this) });
      return orig.call(this, x, y, w, h);
    };
  }
  for (const name of ['fillText', 'strokeText']) {
    const orig = P[name];
    P[name] = function (text, x, y, ...more) {
      const m = this.measureText(String(text));
      push(this, { op: name === 'fillText' ? 'ft' : 'stt', text: String(text), x, y, font: this.font, ta: this.textAlign, tb: this.textBaseline,
        mw: r3(m.width), bl: r3(m.actualBoundingBoxLeft), br: r3(m.actualBoundingBoxRight), ba: r3(m.actualBoundingBoxAscent), bd: r3(m.actualBoundingBoxDescent), ...st(this) });
      return orig.call(this, text, x, y, ...more);
    };
  }
  const paths = new WeakMap();
  const pathOf = (ctx) => { let p = paths.get(ctx); if (!p) paths.set(ctx, p = []); return p; };
  const wrap = (name, fn) => { const orig = P[name]; if (!orig) return; P[name] = function (...a) { fn(this, a); return orig.apply(this, a); }; };
  wrap('beginPath', (ctx) => paths.set(ctx, []));
  wrap('moveTo', (ctx, a) => pathOf(ctx).push(['M', a[0], a[1]]));
  wrap('lineTo', (ctx, a) => pathOf(ctx).push(['L', a[0], a[1]]));
  wrap('closePath', (ctx) => pathOf(ctx).push(['Z']));
  wrap('rect', (ctx, a) => pathOf(ctx).push(['R', a[0], a[1], a[2], a[3]]));
  wrap('roundRect', (ctx, a) => pathOf(ctx).push(['RR', a[0], a[1], a[2], a[3], typeof a[4] === 'number' ? a[4] : 0]));
  wrap('arc', (ctx, a) => pathOf(ctx).push(['A', a[0], a[1], a[2], a[3], a[4]]));
  for (const name of ['quadraticCurveTo', 'bezierCurveTo', 'arcTo', 'ellipse']) wrap(name, (ctx, a) => pathOf(ctx).push([name, ...a]));
  wrap('stroke', (ctx, a) => push(ctx, { op: 'st', path: a.length ? 'path2d' : pathOf(ctx).map((s) => s.slice()), ...st(ctx) }));
  wrap('fill', (ctx, a) => push(ctx, { op: 'fi', path: a.length && typeof a[0] === 'object' ? 'path2d' : pathOf(ctx).map((s) => s.slice()), ...st(ctx) }));
  for (const name of ['drawImage', 'putImageData', 'clip', 'save', 'restore', 'translate', 'scale', 'rotate', 'transform']) wrap(name, (ctx) => push(ctx, { op: 'x:' + name }));
  // a chart that is opened in a new tab: kept here, nothing is opened
  window.open = (url, target, features) => { QA.opens.push({ url: String(url), target: target || '', features: features || '' }); return null; };
  // the frame of a canvas, with the canvas' size in CSS px
  QA.frame = (cv) => { if (!cv) return null; const f = frameOf(cv), r = cv.getBoundingClientRect(); return { n: f.n, w: r.width, h: r.height, pw: cv.width, ph: cv.height, calls: f.calls }; };
};
