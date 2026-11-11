// Bird eye study, market view, variant A: 픽셀 매트릭스.
// The whole market on one screen. One row per coin, one cell per timeframe; the upper half of a cell is the sell side
// and the lower half the buy side. The rows stand in column blocks side by side, so that every coin is visible at once
// on a desktop screen: many coins signalling on one timeframe show as a vertical stripe, one coin signalling on many
// timeframes as a horizontal streak. A strip above the matrix counts the stripes per timeframe.
// Everything drawn comes from BE.side(c, j, dir): the labels of the build summary, the active countdowns and the
// next-bar triggers with their distances (td-view.js fire). Nothing here counts anything of TD.
//
// A half cell shows, by priority: a 13 completed on the bars of the chosen period (the family color, filled; two or
// three families side by side), else a 9 (gray, a repeated 9 lighter; a smaller mark than a 13, so that the 13s lead
// the picture), else a 13 waiting at 12 (a frame in the family color: filled lighter when it is met at the current
// price, empty when its price is within the 임박 threshold).
// A cell without a confirmed bar has no ground at all. With one side chosen (방향), that side takes the whole cell, which
// doubles every mark: the stripes read much stronger then.
// The picture is canvas (a sticky header and the rows, in tiles that no browser refuses); the strip, the crosshair,
// the cursor cell and the search marks are DOM over it. The tooltip is a magnifier: the coin's 20 timeframes drawn
// larger with the same code, and the cell's labels, counts and next-bar conditions in words.
(() => {
  'use strict';
  const { TFS, FAMS, FAM_NAME, FAM_COLOR, SELL, BUY, SIDE, ARROW, el, esc, iso, fmtPrice, fmtPct } = BE;
  const ID = 'market-a', COINS = BE.WITH_DATA, NT = TFS.length;
  const DIRS = [SELL, BUY];                                       // half 0 = upper = sell side, half 1 = lower = buy side
  const GROUP_START = ['8D', '1M'].map((tf) => TFS.indexOf(tf)).filter((j) => j > 0);   // as the screener: 1D…1W | 8D…3W | 1M…12M
  const ANCHOR = ['1D', '1W', '2W', '1M', '12M'].map((tf) => TFS.indexOf(tf)).filter((j) => j >= 0);   // named above every block
  const EXS = ['U', 'B', 'N'], EX_NAME = { U: '업비트', B: '빗썸', N: '바이낸스' };
  const WIN_NAME = { 0: '마지막 봉', 3: '최근 4봉' };
  const MONO = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
  const A_TINT = 0.4, A_REP = 0.45;                               // opacity of the inside of a waiting 13 that is met now, and of a repeated 9
  const MIN_CONTRAST = 2.3;                                       // of a 13 against the ground of its cell
  const RH_ALL = 8, RH_MIN = 7, RH_MAX = 12, RH_FREE = 9, RH_TOUCH = 11, RH_FINGER = 10;   // row heights (CSS px), see computeLayout
  const CW_MAX = 16, TILE_PX = 4000;                              // widest cell (CSS px); tallest canvas (device px)

  // The last confirmed bar of each timeframe: the start day most coins have. A coin TradingView stopped serving has an
  // older last bar, and its tooltip says so.
  const REF_LS = TFS.map((tf, j) => {
    const seen = new Map(); let best = null, top = 0;
    for (const c of COINS) { const T = c.t[j]; if (!T) continue; const n = (seen.get(T.ls) || 0) + 1; seen.set(T.ls, n); if (n > top || (n === top && T.ls > best)) { top = n; best = T.ls; } }
    return best;
  });
  const LATE = COINS.map((c) => !!c.t[0] && c.t[0].ls !== REF_LS[0]);   // no daily bar on the last closed day: the symbol gets a dotted line

  // ---------- settings (BE.vstate) ----------
  // S is this variant's own. G is what the two market variants share (the period, the 임박 threshold, the exchanges),
  // so that switching between A and B shows the same market; each variant reads it again when it is mounted.
  const DEFAULTS = { sort: 'mcap', tf: 0, show: 'both', side: 'both' }, SHARED = { win: 3, thr: 5, ex: [] };
  let S = null, G = null;
  // the halves that are drawn: both sides (sell above, buy below), or one side over the whole cell
  const halves = () => (S.side === 'sell' ? [0] : S.side === 'buy' ? [1] : [0, 1]);
  function readSettings() {
    S = BE.vstate(ID, DEFAULTS); G = BE.vstate('market', SHARED);
    if (!['mcap', 'n13', 'near', 'tf'].includes(S.sort)) S.sort = DEFAULTS.sort;
    if (!(Number.isInteger(S.tf) && S.tf >= 0 && S.tf < NT)) { S.tf = 0; if (S.sort === 'tf') S.sort = DEFAULTS.sort; }
    if (![0, 3].includes(G.win)) G.win = SHARED.win;
    if (!['both', '13', 'near'].includes(S.show)) S.show = DEFAULTS.show;
    if (!['both', 'sell', 'buy'].includes(S.side)) S.side = DEFAULTS.side;
    if (![3, 5, 10].includes(G.thr)) G.thr = SHARED.thr;
    G.ex = EXS.filter((x) => Array.isArray(G.ex) && G.ex.includes(x));
  }

  // ---------- facts: what every half cell holds under the current settings ----------
  // FACT.cell[(i * NT + j) * 2 + half] for coin i (index into COINS, market-cap order), timeframe j, half 0 sell / 1 buy:
  //   bits 0-3    families with a 13 completed on the bars of the chosen period
  //   bit 4, 5    a 9 there, a repeated 9 there
  //   bits 6-9    families whose 13 appears if the bar in progress closes where it is (fire.now)
  //   bits 10-13  families whose 13 is within the 임박 threshold of the current price (and not met now)
  //   bit 15      the coin has no confirmed bar on this timeframe
  // Per side h and coin i: FACT.n13[h][i] half cells with a completed 13, FACT.nNow[h][i] half cells met now,
  // FACT.near[h][i] the smallest distance of a waiting 13 from the current price (0 when one is met now, Infinity
  // when none waits).
  const DONE = 15, NINE = 1 << 4, REP = 1 << 5, NOW = 6, NEAR = 10, WAIT = 255 << NOW, NOBAR = 1 << 15;
  const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  let FACT = { key: null };
  function computeFacts() {
    let fm = 0; for (const f of FAMS) if (BE.famOn(f)) fm |= 1 << f;
    const key = `${G.win}|${G.thr}|${fm}`;
    if (FACT.key === key) return;
    const n = COINS.length, thr = G.thr / 100;
    const cell = new Uint16Array(n * NT * 2), n13 = [new Uint16Array(n), new Uint16Array(n)], nNow = [new Uint16Array(n), new Uint16Array(n)];
    const near = [new Float64Array(n).fill(Infinity), new Float64Array(n).fill(Infinity)];
    for (let i = 0; i < n; i++) {
      const c = COINS[i];
      for (let j = 0; j < NT; j++) for (let h = 0; h < 2; h++) {
        const s = BE.side(c, j, DIRS[h]), k = (i * NT + j) * 2 + h;
        if (!s) { cell[k] = NOBAR; continue; }
        let v = 0;
        for (const L of s.labels) {
          if (L.ago > G.win) continue;
          if (L.kind === 'C') { if ((fm >> L.f) & 1) v |= 1 << L.f; }
          else if (L.kind === 'S') v |= L.rep ? REP : NINE;
        }
        for (const x of s.trigs) {
          if (x.k !== 'C13' || !x.fire || !((fm >> x.f) & 1)) continue;
          const a = x.fire.now ? 0 : Math.abs(x.fire.pct);
          if (a < near[h][i]) near[h][i] = a;
          if (x.fire.now) v |= 1 << (NOW + x.f); else if (a <= thr) v |= 1 << (NEAR + x.f);
        }
        v &= ~(((v >> NOW) & 15) << NEAR);                          // a family that is met now is not also "near"
        if (v & DONE) n13[h][i]++;
        if ((v >> NOW) & 15) nNow[h][i]++;
        cell[k] = v;
      }
    }
    FACT = { key, cell, n13, nNow, near };
  }
  // What a half cell shows, by priority: 3 a completed 13, 2 a 9, 1 a 13 waiting at 12, 0 nothing. The display mode
  // decides whether 9s and waiting 13s are shown at all.
  function kindOf(v) {
    if (v & NOBAR) return 0;
    if (v & DONE) return 3;
    if (S.show === 'both' && (v & (NINE | REP))) return 2;
    if (S.show === 'near' && (v & WAIT)) return 1;
    return 0;
  }

  // ---------- the coins shown and their order ----------
  let order = [], posOf = new Int32Array(COINS.length);
  // the place of a coin when the coins are sorted by one timeframe: sell 13, buy 13, sell 9, buy 9, sell 임박, buy 임박
  function tfKey(i, j) {
    let best = 0;
    for (const h of halves()) {
      const v = FACT.cell[(i * NT + j) * 2 + h], k = kindOf(v);
      if (v & NOBAR) return -1;
      if (!k) continue;
      const fine = k === 3 ? POP[v & DONE] : k === 2 ? (v & NINE ? 1 : 0) : (v >> NOW) & 15 ? 1 : 0;
      best = Math.max(best, k * 1000 + (h === 0 ? 500 : 0) + fine);
    }
    return best;
  }
  function computeOrder() {
    const list = [];
    for (let i = 0; i < COINS.length; i++) if (G.ex.every((x) => COINS[i].x.includes(x))) list.push(i);
    // over the sides that are drawn; an index into COINS is also the market-cap order
    const hs = halves(), n13 = (i) => hs.reduce((a, h) => a + FACT.n13[h][i], 0), nNow = (i) => hs.reduce((a, h) => a + FACT.nNow[h][i], 0);
    const near = (i) => hs.reduce((a, h) => Math.min(a, FACT.near[h][i]), Infinity);
    if (S.sort === 'n13') { const k = list.map(n13); sortBy(list, (a, b) => k[b] - k[a]); }
    else if (S.sort === 'near') { const d = list.map(near), k = list.map(nNow); sortBy(list, (a, b) => (d[a] === d[b] ? k[b] - k[a] : d[a] - d[b])); }
    else if (S.sort === 'tf') { const k = list.map((i) => tfKey(i, S.tf)); sortBy(list, (a, b) => k[b] - k[a]); }
    order = list; posOf.fill(-1); list.forEach((i, p) => { posOf[i] = p; });
  }
  // sorts a list in place by cmp(a, b) over the places in the list (keys are arrays aligned with it); ties keep the list's order
  function sortBy(list, cmp) {
    const idx = list.map((_, q) => q).sort((a, b) => cmp(a, b) || a - b), copy = list.slice();
    idx.forEach((q, p) => { list[p] = copy[q]; });
  }

  // ---------- totals per timeframe and side, over the coins shown ----------
  // c13 / c9 / cw: coins with a 13, a 9 (rep: only a repeated one), a waiting 13 within the threshold (now: met now);
  // n13[f]: coins with a 13 of family f; f13 / fnow / fnear: the same coins shared out by family, a coin with two
  // families counting half for each, as its half cell is split in two stripes (the bars are the sum of the stripes).
  let TOT = null;
  function computeTotals() {
    const mk = () => ({ c13: 0, c9: 0, rep: 0, cw: 0, now: 0, n13: [0, 0, 0, 0], f13: [0, 0, 0, 0], fnow: [0, 0, 0, 0], fnear: [0, 0, 0, 0] });
    const T = [TFS.map(mk), TFS.map(mk)];
    for (const i of order) for (let j = 0; j < NT; j++) for (let h = 0; h < 2; h++) {
      const v = FACT.cell[(i * NT + j) * 2 + h], t = T[h][j];
      if (v & NOBAR) continue;
      const done = v & DONE, now = (v >> NOW) & 15, any = now | ((v >> NEAR) & 15);
      if (done) { t.c13++; for (const f of FAMS) if ((done >> f) & 1) { t.n13[f]++; t.f13[f] += 1 / POP[done]; } }
      if (v & (NINE | REP)) { t.c9++; if (!(v & NINE)) t.rep++; }
      if (any) { t.cw++; if (now) t.now++; for (const f of FAMS) if ((any >> f) & 1) ((now >> f) & 1 ? t.fnow : t.fnear)[f] += 1 / POP[any]; }
    }
    TOT = T;
  }
  const second = (t) => (S.show === 'both' ? t.c9 : S.show === 'near' ? t.cw : 0);   // the count under the 13 in the strip

  // ---------- palette: the canvas colors of the theme, also handed to the CSS (legend, strip) as --bma-* ----------
  const probe = document.createElement('canvas').getContext('2d');
  function rgb(color) {
    probe.fillStyle = '#000000'; probe.fillStyle = color;
    const s = String(probe.fillStyle);
    if (s[0] === '#') return [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16));
    return (s.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  }
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const over = (a, b, t) => a.map((v, k) => v * t + b[k] * (1 - t));          // color a at opacity t on color b
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = lum(a) + 0.05, y = lum(b) + 0.05; return x > y ? x / y : y / x; };
  // a mark has to stand out from its ground: a color too close to it (the Combo purple on a dark page) is moved
  // towards the text color until it does
  function lifted(c, ground, fg) { let t = 0; while (t < 0.6 && contrast(over(fg, c, t), ground) < MIN_CONTRAST) t += 0.04; return over(fg, c, t); }
  let PAL = null, STRIPES = new Map();
  function readPalette() {
    const C = BE.C, surface = rgb(C.surface), fg = rgb(C.fg), setup = rgb(BE.SETUP_COLOR);
    const dark = surface[0] + surface[1] + surface[2] < fg[0] + fg[1] + fg[2];
    const ground = over(fg, surface, dark ? 0.085 : 0.06);                    // a cell with a bar and no signal
    PAL = { ground: hex(ground), nine: hex(setup), rep: hex(over(setup, ground, A_REP)), fam: [], tint: [],
      text: C.muted, faint: C.faint, fg: C.fg, surface: C.surface, g10: hex(over(fg, surface, 0.14)), g50: hex(over(fg, surface, 0.4)) };
    for (let f = 0; f < 4; f++) {
      const c = lifted(rgb(FAM_COLOR[f]), ground, fg);
      PAL.fam[f] = hex(c); PAL.tint[f] = hex(over(c, ground, A_TINT));
    }
    STRIPES = new Map();
    const st = dom.root.style;
    st.setProperty('--bma-ground', PAL.ground); st.setProperty('--bma-rep', PAL.rep);
    for (const f of FAMS) { st.setProperty('--bma-f' + f, PAL.fam[f]); st.setProperty('--bma-tint' + f, PAL.tint[f]); }
  }
  // The stripes of one half cell from left to right, null when nothing is drawn on its ground. A stripe is [color] for
  // a filled one (a 13, a 9) or [color, inside] for a 13 that is waiting: a frame in the family color around the ground
  // (within the threshold) or around a lighter fill (met now). A 9 is marked small: it is drawn smaller than the half.
  function stripesOf(v) {
    let s = STRIPES.get(v);
    if (s !== undefined) return s;
    const k = kindOf(v);
    if (k === 3) s = FAMS.filter((f) => (v >> f) & 1).map((f) => [PAL.fam[f]]);
    else if (k === 2) { s = [[v & NINE ? PAL.nine : PAL.rep]]; s.small = true; }
    else if (k === 1) { const now = (v >> NOW) & 15, any = now | ((v >> NEAR) & 15); s = FAMS.filter((f) => (any >> f) & 1).map((f) => [PAL.fam[f], (now >> f) & 1 ? PAL.tint[f] : PAL.ground]); }
    else s = null;
    STRIPES.set(v, s);
    return s;
  }
  // One half cell as rectangles: put(color, x, y, w, h) for the stripes, then, for a waiting 13, inside(...) for what
  // lies within the frame of thickness t (the whole half is one frame, its border and its inside striped by family).
  // A 9 is one rectangle in the middle of the half, about a third of its area, so that the 13s lead the picture.
  function paintHalf(st, x, y, w, h, t, put, inside) {
    if (st.small) { const ix = Math.max(1, Math.round(w / 6)), iy = Math.floor(h / 4); put(st[0][0], x + ix, y + iy, w - 2 * ix, h - 2 * iy); return; }
    const n = st.length, wi = w - 2 * t, hi = h - 2 * t;
    for (let q = 0; q < n; q++) { const xa = Math.round(q * w / n), xb = Math.round((q + 1) * w / n); put(st[q][0], x + xa, y, xb - xa, h); }
    if (st[0].length < 2 || wi <= 0 || hi <= 0) return;
    for (let q = 0; q < n; q++) { const xa = Math.round(q * wi / n), xb = Math.round((q + 1) * wi / n); if (xb > xa) inside(st[q][1], x + t + xa, y + t, xb - xa, hi); }
  }

  // ---------- layout: blocks, cells and rows in device pixels, so every edge is sharp ----------
  let LAY = null;
  function computeLayout(W, n, roomAll, roomMatrix) {
    const dpr = Math.max(1, window.devicePixelRatio || 1), d = (v) => Math.max(1, Math.round(v * dpr));
    const narrow = W < 560, coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const G = d(narrow ? 8 : 12), LAB = d(narrow ? 36 : 40), GG = d(narrow ? 2 : 3), Wd = Math.floor(W * dpr), groups = GROUP_START.length;
    const cwOf = (B) => Math.floor((Math.floor((Wd + G) / B) - G - LAB - groups * GG) / NT);
    const cwMin = (narrow ? 5.2 : 6) * dpr;
    let Bmax = 1; while (Bmax < 24 && cwOf(Bmax + 1) >= cwMin) Bmax++;
    // The tallest rows (up to RH_MAX) with which the strip and the matrix fit the window together; when those would be
    // lower than RH_ALL, the tallest with which the matrix alone fits; when those would be lower than RH_MIN, rows of a
    // fixed height in as many blocks as the width holds (the page then scrolls down). A finger needs taller rows.
    // Of the block counts that give rows within half a pixel of the tallest, the smallest one (the widest cells) wins.
    const rhOf = (B, room) => Math.min(RH_MAX, room / Math.ceil(n / B));
    const fit = (room) => { let top = 0; for (let B = 1; B <= Bmax; B++) top = Math.max(top, rhOf(B, room)); for (let B = 1; B <= Bmax; B++) if (rhOf(B, room) >= top - 0.5) return { B, rh: rhOf(B, room) }; return { B: 1, rh: 0 }; };
    let pick = fit(roomAll);
    if (pick.rh < (coarse ? RH_FINGER : RH_ALL)) pick = fit(roomMatrix);
    if (pick.rh < (coarse ? RH_FINGER : RH_MIN)) pick = { B: Bmax, rh: narrow || coarse ? RH_TOUCH : RH_FREE };
    const B = pick.B, rows = Math.ceil(n / B), rhD = Math.floor(pick.rh * dpr), halfD = Math.floor((rhD - d(1)) / 2);
    const pitchMax = Math.floor((Wd + G) / B);
    let cw = cwOf(B), lab = LAB, pitch;
    if (cw > d(CW_MAX)) { cw = d(CW_MAX); pitch = LAB + NT * cw + groups * GG + G; }
    else { pitch = pitchMax; lab = pitch - G - groups * GG - NT * cw; }       // the symbol column takes what is left over
    const colX = new Int32Array(NT);
    for (let j = 0; j < NT; j++) colX[j] = lab + j * cw + GG * GROUP_START.filter((g) => g <= j).length;
    const gx = cw >= 7 * dpr ? d(1) : Math.max(1, Math.round(dpr / 2));        // gap between two cells of a row
    const font = Math.max(7, Math.min(narrow ? 9 : 10, Math.floor(rhD / dpr * 2) / 2));
    return { dpr, W, n, B, rows, pitch, G, lab, cw, gx, colX, rhD, halfD, HH: narrow ? 15 : 16, narrow, font, labGap: d(4) };
  }
  // the cell under a point of the matrix body (CSS px from its top left corner): { p: place in `order`, j: timeframe,
  // -1 on the symbol }, null outside the rows. The gaps belong to the cell before them.
  function hit(x, y) {
    const L = LAY; if (!L || x < 0 || y < 0) return null;
    const X = x * L.dpr, b = Math.floor(X / L.pitch), r = Math.floor(y * L.dpr / L.rhD);
    if (b >= L.B || r >= L.rows) return null;
    const p = b * L.rows + r, xin = X - b * L.pitch;
    if (p >= L.n) return null;
    if (xin < L.lab - L.labGap / 2) return { p, j: -1 };
    let j = 0; while (j < NT - 1 && xin >= L.colX[j + 1]) j++;
    return { p, j };
  }
  // the rectangle of a row or of one of its cells inside the matrix body, in CSS px
  function rowBox(p) { const L = LAY, k = 1 / L.dpr, b = Math.floor(p / L.rows); return { x: b * L.pitch * k, y: (p % L.rows) * L.rhD * k, w: (L.pitch - L.G) * k, h: 2 * L.halfD * k, b }; }
  function cellBox(p, j) { const L = LAY, k = 1 / L.dpr, r = rowBox(p); return { x: (r.b * L.pitch + L.colX[j]) * k, y: r.y, w: (L.cw - L.gx) * k, h: r.h }; }

  // ---------- drawing ----------
  let dom = null;
  function drawHead() {
    const L = LAY, k = 1 / L.dpr, ctx = BE.setupCanvas(dom.headCv, L.W, L.HH), fs = L.narrow ? 8.5 : 9, ticks = [], tick = Math.max(1, Math.round(L.dpr));
    ctx.textBaseline = 'alphabetic';
    for (let b = 0; b < L.B && b * L.rows < L.n; b++) {
      const bx = b * L.pitch;
      ctx.font = `500 ${fs}px ${MONO}`; ctx.fillStyle = PAL.faint; ctx.textAlign = 'right';
      ctx.fillText(`${b * L.rows + 1}~${Math.min(L.n, (b + 1) * L.rows)}`, (bx + L.lab - L.labGap) * k, L.HH - 5, (L.lab - L.labGap) * k);
      ctx.fillStyle = PAL.text;
      for (const j of ANCHOR) {
        const x0 = (bx + L.colX[j]) * k, w = (L.cw - L.gx) * k;
        if (j === 0) { ctx.textAlign = 'left'; ctx.fillText(TFS[j], x0, L.HH - 5); }
        else if (j === NT - 1) { ctx.textAlign = 'right'; ctx.fillText(TFS[j], x0 + w, L.HH - 5); }
        else { ctx.textAlign = 'center'; ctx.fillText(TFS[j], x0 + w / 2, L.HH - 5); }
        ticks.push(bx + L.colX[j] + Math.floor((L.cw - L.gx - tick) / 2));
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);                              // the ticks under the names, in device pixels
    for (const x of ticks) ctx.fillRect(x, Math.round((L.HH - 3) * L.dpr), tick, Math.round(3 * L.dpr));
  }
  function drawBody() {
    const L = LAY, per = Math.max(1, Math.floor(TILE_PX / L.rhD)), nTiles = Math.ceil(L.rows / per);
    while (dom.tiles.length > nTiles) dom.tiles.pop().remove();
    while (dom.tiles.length < nTiles) { const cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true'); dom.body.insertBefore(cv, dom.marks); dom.tiles.push(cv); }
    dom.tiles.forEach((cv, t) => drawTile(cv, t * per, Math.min(L.rows, (t + 1) * per)));
  }
  // rows r0 .. r1 - 1 of every block on one canvas; rectangles are collected by color and filled in device pixels
  function drawTile(cv, r0, r1) {
    const L = LAY, k = 1 / L.dpr, ctx = BE.setupCanvas(cv, L.W, (r1 - r0) * L.rhD * k);
    const batch = new Map([[PAL.ground, []]]), batch2 = new Map();     // fills, then the insides of frames
    const into = (m) => (color, x, y, w, h) => { let a = m.get(color); if (!a) m.set(color, a = []); a.push(x, y, w, h); };
    const put = into(batch), inside = into(batch2);
    const w = L.cw - L.gx, h2 = L.halfD, gap = L.rhD - 2 * h2, line = Math.min(gap, Math.max(1, Math.round(L.dpr))), frame = Math.max(1, Math.round(L.dpr));
    const one = S.side === 'both' ? -1 : halves()[0];             // the side that takes the whole cell
    ctx.font = `500 ${L.font}px ${MONO}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = PAL.text;
    for (let b = 0; b < L.B; b++) {
      const bx = b * L.pitch;
      for (let r = r0; r < r1; r++) {
        const p = b * L.rows + r; if (p >= L.n) break;
        const i = order[p], y = (r - r0) * L.rhD;
        ctx.fillText(COINS[i].s, (bx + L.lab - L.labGap) * k, (y + h2) * k + 0.5, (L.lab - L.labGap - 1) * k);
        if (LATE[i]) {
          const x1 = bx + L.lab - L.labGap, tw = Math.min(L.lab - L.labGap - 1, Math.ceil(ctx.measureText(COINS[i].s).width * L.dpr)), u = Math.max(1, Math.round(L.dpr));
          for (let x = x1 - tw; x < x1; x += 2 * u) put(PAL.text, x, y + 2 * h2 - u, u, u);
        }
        for (let j = 0; j < NT; j++) {
          const v0 = FACT.cell[(i * NT + j) * 2], x = bx + L.colX[j];
          if (v0 & NOBAR) continue;                                 // no bar: no ground, the panel shows through
          put(PAL.ground, x, y, w, 2 * h2);
          if (one < 0) for (let h = 0; h < 2; h++) { const st = stripesOf(h ? FACT.cell[(i * NT + j) * 2 + 1] : v0); if (st) paintHalf(st, x, y + h * h2, w, h2, frame, put, inside); }
          else { const st = stripesOf(FACT.cell[(i * NT + j) * 2 + one]); if (st) paintHalf(st, x, y, w, 2 * h2, frame, put, inside); }
        }
        // a line under every 10th row of a block, a stronger one under every 50th
        if ((r + 1) % 10 === 0 && p + 1 < L.n && r + 1 < L.rows) put((r + 1) % 50 === 0 ? PAL.g50 : PAL.g10, bx, y + 2 * h2 + Math.floor((gap - line) / 2), L.pitch - L.G, line);
      }
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const m of [batch, batch2]) for (const [color, a] of m) { ctx.fillStyle = color; ctx.beginPath(); for (let q = 0; q < a.length; q += 4) ctx.rect(a[q], a[q + 1], a[q + 2], a[q + 3]); ctx.fill(); }
    ctx.restore();
  }

  // ---------- the strip of totals (DOM: 20 buttons, one tab stop, the arrow keys move between them) ----------
  let stripCols = 0, stripStop = 0;
  function buildStrip(cols, compact) {
    stripCols = cols; dom.tf = []; dom.keys = [];
    dom.strip.replaceChildren(); dom.strip.classList.toggle('cmp', compact);
    for (let a = 0; a < NT; a += cols) {
      const row = el('div', 'bma-srow'), key = el('div', 'bma-key'); key.setAttribute('aria-hidden', 'true');
      row.style.setProperty('--bma-n', String(Math.min(cols, NT - a)));
      key.innerHTML = '<span class="r1">종목 수</span><span class="r2"></span><span class="r3"></span><span class="r5"></span><span class="r6"></span>';
      dom.keys.push(key); row.append(key);
      for (let j = a; j < Math.min(NT, a + cols); j++) {
        const b = el('button', 'bma-tf' + (GROUP_START.includes(j) && j !== a ? ' gs' : '')); b.type = 'button'; b.dataset.j = String(j); b.tabIndex = j === stripStop ? 0 : -1;
        b.innerHTML = `<span class="tfn">${esc(TFS[j])}</span><span class="bz up"><i></i><i></i></span><span class="bz dn"><i></i><i></i></span>` +
          '<span class="n n13 r2"></span><span class="n r3"></span><span class="n r5"></span><span class="n n13 r6"></span>';
        dom.tf[j] = b; row.append(b);
      }
      dom.strip.append(row);
    }
  }
  function renderStrip(W) {
    // one row of 20 timeframes, or two rows of 10 on a narrow page; columns under 50 px get the compact marks
    const keyW = W < 720 ? 42 : 48, cols = (W - keyW) / NT >= 29 ? NT : Math.ceil(NT / 2), per = (W - keyW) / cols, compact = per < 50;
    if (cols !== stripCols || dom.strip.classList.contains('cmp') !== compact) buildStrip(cols, compact);
    dom.strip.style.setProperty('--bma-key', keyW + 'px'); dom.strip.style.setProperty('--bma-bar', (per < 26 ? 2 : per < 30 ? 3 : compact ? 4 : 10) + 'px');
    dom.strip.classList.toggle('xs', per < 26);
    dom.strip.classList.toggle('sell', S.side === 'sell'); dom.strip.classList.toggle('buy', S.side === 'buy');
    const two = S.show === 'both' ? '9' : S.show === 'near' ? '임박' : '';
    for (const key of dom.keys) { const s = key.children; s[1].textContent = '매도 13'; s[2].textContent = two && '매도 ' + two; s[3].textContent = two && '매수 ' + two; s[4].textContent = '매수 13'; }
    let max = 1; for (let h = 0; h < 2; h++) for (const t of TOT[h]) max = Math.max(max, t.c13, second(t));
    const ZONE = 20, px = (v) => (v > 0 ? Math.max(1.5, Math.round(v / max * ZONE * 2) / 2) : 0);
    // a bar of `total` px shared out by weights; a part with a frame color is drawn as the waiting 13 of the matrix
    const seg = (v, color, frame) => (v > 0 ? `<b style="height:${v}px;background:${color}${frame ? `;box-shadow:inset 0 0 0 1px ${frame}` : ''}"></b>` : '');
    const stack = (total, parts) => { const sum = parts.reduce((a, x) => a + x[0], 0); return sum > 0 ? parts.map(([v, color, frame]) => seg(total * v / sum, color, frame)).join('') : ''; };
    for (let j = 0; j < NT; j++) {
      const b = dom.tf[j], n = b.querySelectorAll('.n'), say = [];
      for (let h = 0; h < 2; h++) {
        const t = TOT[h][j], bars = b.children[1 + h].children, v2 = second(t);
        bars[0].innerHTML = stack(px(t.c13), FAMS.map((f) => [t.f13[f], `var(--bma-f${f})`]));
        bars[1].innerHTML = S.show === 'both' ? stack(px(t.c9), [[t.c9 - t.rep, 'var(--setup)'], [t.rep, 'var(--bma-rep)']])
          : S.show === 'near' ? stack(px(t.cw), [...FAMS.map((f) => [t.fnow[f], `var(--bma-tint${f})`, `var(--bma-f${f})`]), ...FAMS.map((f) => [t.fnear[f], 'transparent', `var(--bma-f${f})`])]) : '';
        const n13 = n[h ? 3 : 0], n2 = n[h ? 2 : 1];
        n13.textContent = String(t.c13); n13.classList.toggle('z', !t.c13);
        n2.textContent = two ? String(v2) : ''; n2.classList.toggle('z', !v2);
        say.push(`${SIDE[DIRS[h]]} 쪽 13 ${t.c13}종목` + (two ? `, ${two} ${v2}종목` : ''));
      }
      b.setAttribute('aria-pressed', String(S.sort === 'tf' && S.tf === j));
      b.setAttribute('aria-label', `${TFS[j]}. ${say.join('. ')}. ${pressHint(j)}`);
    }
  }
  const pressHint = (j) => (S.sort === 'tf' && S.tf === j ? '누르면 정렬을 시가총액 순으로 되돌립니다.' : '누르면 이 타임프레임에 신호가 있는 종목을 앞에 모읍니다.');
  function stripTip(j) {
    const fams = FAMS.filter(BE.famOn), two = S.show === 'both' ? '9' : S.show === 'near' ? '임박' : '';
    let h = `<div class="bma-tip"><div class="h1">${esc(TFS[j])} · ${WIN_NAME[G.win]}</div><div class="m">그려진 ${order.length}종목 가운데 신호가 있는 종목 수</div>`;
    for (let k = 0; k < 2; k++) {
      const t = TOT[k][j];
      h += `<div class="sec"><b>${SIDE[DIRS[k]]} 쪽 ${ARROW[DIRS[k]]}</b><div class="row"><span>13 완성 ${t.c13}종목</span>` +
        (t.c13 ? `<span class="m">${fams.map((f) => `${FAM_NAME[f]} ${t.n13[f]}`).join(' · ')}</span>` : '') + '</div>';
      if (two === '9') h += `<div class="row"><span>9 ${t.c9}종목</span>${t.rep ? `<span class="m">그중 반복 9만 있는 종목 ${t.rep}</span>` : ''}</div>`;
      if (two === '임박') h += `<div class="row"><span>13 임박 ${t.cw}종목</span>${t.cw ? `<span class="m">지금 값으로 충족 ${t.now} · 조건가까지 ${G.thr}% 이내 ${t.cw - t.now}</span>` : ''}</div>`;
      h += '</div>';
    }
    return h + `<div class="m bma-foot">${fams.length > 1 ? '한 종목에 두 계열의 13이 함께 있으면 계열마다 셉니다. ' : ''}${pressHint(j)}</div></div>`;
  }

  // ---------- marks over the canvases: crosshair, cursor cell, timeframe tags, search hits ----------
  const cur = { on: false, i: -1, j: 0, by: '' };                 // the cell pointed at: coin (index into COINS), timeframe (-1 = its symbol)
  let hotTf = -1;                                                  // the timeframe pointed at in the strip
  let found = [];                                                  // coins marked by the search (indices into COINS)
  const show = (x, on) => x.classList.toggle('on', !!on);
  function placeMarks() {
    if (!dom) return;
    const L = LAY, ok = L && order.length > 0, k = ok ? 1 / L.dpr : 1;
    const p = ok && cur.on ? posOf[cur.i] : -1, jc = p >= 0 ? cur.j : hotTf;
    // per block: the column pointed at (in the matrix or in the strip) and, more faintly, the column the coins are sorted by
    const js = S.sort === 'tf' ? S.tf : -1;
    while (dom.cols.length < (ok ? L.B : 0) * 2) {
      const sorted = dom.cols.length % 2 === 1, c = el('div', 'bma-o tint' + (sorted ? ' sorted' : '')), t = el('div', 'bma-o tag' + (sorted ? ' sorted' : ''));
      dom.marks.append(c); dom.head.append(t); dom.cols.push(c); dom.tags.push(t);
    }
    dom.cols.forEach((c, q) => {
      const b = q >> 1, j = q % 2 ? js : jc, on = ok && j >= 0 && b < L.B && b * L.rows < L.n && !(q % 2 && js === jc); show(c, on); show(dom.tags[q], on);
      if (!on) return;
      const x = (b * L.pitch + L.colX[j]) * k, w = (L.cw - L.gx) * k, rows = Math.min(L.rows, L.n - b * L.rows);
      c.style.cssText = `left:${x}px;top:0;width:${w}px;height:${(rows * L.rhD - (L.rhD - 2 * L.halfD)) * k}px`;
      const t = dom.tags[q]; t.textContent = TFS[j]; t.style.left = Math.max(12, Math.min(L.W - 12, x + w / 2)) + 'px';
    });
    dom.tf.forEach((b, j) => b.classList.toggle('hot', j === jc && hotTf < 0));
    show(dom.rowhl, p >= 0); show(dom.sym, p >= 0); show(dom.cell, p >= 0 && cur.j >= 0);
    if (p >= 0) {
      const r = rowBox(p);
      dom.rowhl.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
      // the symbol again, bold, over the one on the canvas; a long one is squeezed into the symbol column
      const sym = COINS[cur.i].s, room = (L.lab - L.labGap) * k;
      probe.font = `700 ${L.font}px ${MONO}`;
      const need = probe.measureText(sym).width + 4;
      dom.sym.textContent = sym;
      dom.sym.style.cssText = `right:${L.W - (r.b * L.pitch + L.lab - L.labGap) * k}px;top:${r.y}px;height:${r.h}px;line-height:${r.h}px;font-size:${L.font}px` + (need > room ? `;transform:scaleX(${(room / need).toFixed(3)})` : '');
      if (cur.j >= 0) { const c = cellBox(p, cur.j); dom.cell.style.cssText = `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`; }
    }
    const hits = ok ? found.filter((i) => posOf[i] >= 0) : [];
    while (dom.finds.length < hits.length) { const f = el('div', 'bma-o find'); dom.marks.append(f); dom.finds.push(f); }
    dom.finds.forEach((f, q) => {
      show(f, q < hits.length); if (q >= hits.length) return;
      const r = rowBox(posOf[hits[q]]); f.style.cssText = `left:${r.x - 2}px;top:${r.y - 1}px;width:${r.w + 4}px;height:${r.h + 2}px`;
    });
  }

  // ---------- the tooltip: a magnifier of one coin ----------
  const tipBox = el('div', 'bma-tip'), magCv = document.createElement('canvas');
  let tipKey = '';
  // the coin's 20 timeframes with the encoding of the matrix, larger
  function drawMag(i, jHot) {
    const vw = document.documentElement.clientWidth, cw = Math.max(11, Math.min(16, Math.floor((Math.min(380, vw - 16) - 30) / NT)));
    const gg = 4, h2 = 10, W = NT * cw + GROUP_START.length * gg, H = 2 * h2 + 15, ctx = BE.setupCanvas(magCv, W, H);
    const fill = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (let j = 0; j < NT; j++) {
      const x = j * cw + gg * GROUP_START.filter((g) => g <= j).length, w = cw - 2, v0 = FACT.cell[(i * NT + j) * 2];
      if (!(v0 & NOBAR)) {
        fill(PAL.ground, x, 1, w, 2 * h2);
        if (S.side === 'both') for (let h = 0; h < 2; h++) { const st = stripesOf(FACT.cell[(i * NT + j) * 2 + h]); if (st) paintHalf(st, x, 1 + h * h2, w, h2, 2, fill, fill); }
        else { const st = stripesOf(FACT.cell[(i * NT + j) * 2 + halves()[0]]); if (st) paintHalf(st, x, 1, w, 2 * h2, 2, fill, fill); }
      }
      if (j === jHot) { ctx.strokeStyle = PAL.fg; ctx.lineWidth = 1.5; ctx.strokeRect(x - 0.25, 0.75, w + 0.5, 2 * h2 + 0.5); }
      ctx.font = `${j === jHot ? 700 : 500} ${cw >= 15 ? 8 : 7}px ${MONO}`; ctx.fillStyle = j === jHot ? PAL.fg : PAL.text;
      ctx.fillText(TFS[j], x + w / 2, H - 3, cw - 1);
    }
  }
  const labelName = (L) => (L.kind === 'C' ? `${FAM_NAME[L.f]} 13 완성` : L.kind === 'I' ? `${FAM_NAME[L.f]} 13 미뤄짐` : L.rep ? '반복 9' : L.text === '9*' ? '셋업 9 (퍼펙트)' : '셋업 9');
  // where the bar in progress stands against one trigger (td-view.js fire): [the price it has to reach, what holds after that].
  // A strict level (fire's pc / qc: the label appears only beyond it, as for a waiting 9) is named with 초과 or 미만,
  // never as a price at which the bar may close.
  function fireText(f) {
    if (!f) return ['가격이 한 번 움직여서는 충족되지 않음', ''];
    if (f.now) return ['<b>지금 값으로 충족</b>', ''];
    const strict = (c) => !!(c && c.strict);
    const at = (c, p, pct) => `<span class="num nb">${strict(c) ? `${fmtPrice(c.v)} ${c.op === '>' ? '초과' : '미만'}` : fmtPrice(p)} (${fmtPct(pct)})</span>`;
    return [`조건가 ${at(f.pc, f.p, f.pct)}`,
      f.q === f.p ? (strict(f.pc) ? `이 값보다 ${f.pc.op === '>' ? '높게' : '낮게'} 마감하면 충족` : '이 값에서 마감하면 충족')
        : f.qpct === 0 ? '닿은 뒤 지금 가격에서 마감해도 충족' : `닿은 뒤 ${at(f.qc, f.q, f.qpct)}에서 마감해도 충족`];
  }
  const fireKey = (x) => (!x.fire ? Infinity : x.fire.now ? -1 : Math.abs(x.fire.pct));
  // one side of one timeframe: the labels on the bars of the chosen period, the counts that are running, the next-bar conditions
  function sideHTML(c, j, dir) {
    const s = BE.side(c, j, dir), rows = [];
    const labels = s.labels.filter((L) => L.ago <= G.win && (L.kind === 'S' || BE.famOn(L.f))).sort((a, b) => a.ago - b.ago);
    for (const L of labels) rows.push(`<div class="row">${BE.chipHTML(L.kind, L.text, L.f)}<span>${labelName(L)}</span><span class="m">${BE.agoText(L.ago)}</span></div>`);
    if (!labels.length) rows.push(`<div class="m">${WIN_NAME[G.win]}에 나온 신호 없음</div>`);
    const runs = s.runs.filter((r) => BE.famOn(r.f));
    if (runs.length) rows.push(`<div class="row"><span class="m">카운트다운의 가장 높은 카운트</span>${runs.map((r) => `<span class="fam"><i class="dot" style="background:var(--f${r.f})"></i>${FAM_NAME[r.f]} <b class="num">${r.hi}</b></span>`).join('')}</div>`);
    if (s.raw > 0) rows.push(`<div class="m">셋업 카운트 ${s.raw}${s.to9 != null ? ` · 다음 9까지 ${s.to9}봉` : ''}</div>`);
    const trigs = s.trigs.filter((x) => x.k !== 'C13' || BE.famOn(x.f)).sort((a, b) => fireKey(a) - fireKey(b));
    if (trigs.length) rows.push('<div class="sub">다음 봉 조건</div>');
    for (const x of trigs) {
      const is13 = x.k === 'C13', [first, then] = fireText(x.fire);
      rows.push(`<div class="trig"><b class="pc${is13 ? '' : ' p9'}"${is13 ? ` style="--c:var(--f${x.f})"` : ''}>${is13 ? '13' : '9'}</b>` +
        `<div>${is13 ? FAM_NAME[x.f] : x.k === 'S9r' ? '반복 9' : '셋업 9'}${is13 && x.o != null ? `<span class="m nb"> · 출발 봉 ${iso(x.o)}</span>` : ''}<div>${first}</div>${then ? `<div class="m">${then}</div>` : ''}</div></div>`);
    }
    return `<div class="side"><b>${SIDE[dir]} 쪽 ${ARROW[dir]}</b>${rows.join('')}</div>`;
  }
  // every timeframe of the coin with a signal, by side (shown when the symbol is pointed at)
  function coinHTML(i) {
    let out = '';
    for (let h = 0; h < 2; h++) {
      const g = [[], [], []];
      for (let j = 0; j < NT; j++) { const v = FACT.cell[(i * NT + j) * 2 + h]; if (v & NOBAR) continue; if (v & DONE) g[0].push(TFS[j]); if (v & (NINE | REP)) g[1].push(TFS[j]); if (v & WAIT) g[2].push(TFS[j]); }
      const rows = ['13 완성', '9', '13 임박'].map((name, q) => (g[q].length ? `<div class="row"><span class="m">${name}</span><span class="num">${g[q].join(' · ')}</span></div>` : '')).join('');
      out += `<div class="side"><b>${SIDE[DIRS[h]]} 쪽 ${ARROW[DIRS[h]]}</b>${rows || `<div class="m">${WIN_NAME[G.win]}에 나온 신호와 임박한 13 없음</div>`}</div>`;
    }
    return out;
  }
  function fillTip(how) {
    const key = `${cur.i}|${cur.j}|${how}|${FACT.key}|${S.show}|${S.side}`;
    if (key === tipKey) return;
    tipKey = key;
    const i = cur.i, j = cur.j, c = COINS[i], T = j >= 0 ? c.t[j] : null;
    let h = `<div class="h1">${c.r}위 · ${esc(c.s)}</div><div>${esc(c.k ? `${c.k} · ${c.n}` : c.n)}</div>` +
      `<div class="m">시가총액 ${BE.fmtCap(c.mc)} · 최근 종가 <span class="num">${fmtPrice(c.lc)}</span></div><div class="mag"></div><div class="sec">`;
    if (j < 0) h += `<div class="row"><b>신호가 있는 타임프레임</b><span class="m">${WIN_NAME[G.win]} · 임박 기준 ${G.thr}%</span></div>` + coinHTML(i);
    else if (!T) h += `<div class="row"><b class="num">${esc(TFS[j])}</b></div><div class="m">${esc(TFS[j])} 확정 봉이 아직 없습니다.</div>`;
    else h += `<div class="row"><b class="num">${esc(TFS[j])}</b><span class="m nb">마지막 확정 봉 ${iso(T.ls)}${T.le !== T.ls ? ` ~ ${iso(T.le)}` : ''}</span></div>` +
      (T.ls !== REF_LS[j] ? `<div class="warn">이 종목은 TradingView에 ${iso(T.le)} 뒤의 봉이 없습니다. 다른 종목의 마지막 확정 봉은 ${iso(REF_LS[j])}에 시작합니다.</div>` : '') + sideHTML(c, j, SELL) + sideHTML(c, j, BUY);
    h += `</div><div class="m bma-foot">${how === 'touch' ? '한 번 더 누르면 이 종목의 화면이 열립니다.' : '누르거나 Enter를 치면 이 종목의 화면이 열립니다.'}</div>`;
    tipBox.innerHTML = h;
    drawMag(i, j);
    tipBox.querySelector('.mag').append(magCv);
  }
  // what the cursor cell holds, in words (for the live region)
  function sayCell() {
    const c = COINS[cur.i], j = cur.j, parts = [`${c.r}위 ${c.s}`];
    if (j >= 0) {
      parts.push(TFS[j]);
      for (let h = 0; h < 2; h++) {
        const v = FACT.cell[(cur.i * NT + j) * 2 + h], fam = (m) => FAMS.filter((f) => (m >> f) & 1).map((f) => FAM_NAME[f]).join(', ');
        if (v & NOBAR) { parts.push('확정 봉 없음'); break; }
        const now = (v >> NOW) & 15, any = now | ((v >> NEAR) & 15), say = [];
        if (v & DONE) say.push(`13 완성 ${fam(v & DONE)}`);
        if (v & (NINE | REP)) say.push(v & NINE ? '9' : '반복 9');
        if (any) say.push(`13 임박 ${fam(any)}${now ? ' 지금 값으로 충족' : ''}`);
        parts.push(`${SIDE[DIRS[h]]} 쪽 ${say.join(', ') || '신호 없음'}`);
      }
    }
    dom.live.textContent = parts.join('. ');
  }

  // ---------- pointer, keyboard, search ----------
  let lastPointer = 'mouse', raf = 0;
  const bodyPoint = (e) => { const rc = dom.body.getBoundingClientRect(); return hit(e.clientX - rc.left, e.clientY - rc.top); };
  function setCur(p, j, by) { cur.on = true; cur.i = order[p]; cur.j = j; cur.by = by; hotTf = -1; placeMarks(); }
  function clearCur() { if (!dom || (!cur.on && hotTf < 0)) return; cur.on = false; hotTf = -1; tipKey = ''; BE.tip.hide(); placeMarks(); }
  // the tooltip next to the cursor cell (keyboard, touch); the cell is brought into the window first
  function tipAtCursor(how) {
    const p = posOf[cur.i]; if (p < 0) return;
    const b = cur.j >= 0 ? cellBox(p, cur.j) : rowBox(p), rc = dom.body.getBoundingClientRect();
    const top = rc.top + b.y, low = (parseFloat(dom.root.style.getPropertyValue('--bma-top')) || 0) + LAY.HH + 6;
    if (top < low || top + b.h > innerHeight - 6) window.scrollBy(0, top - Math.max(low, (innerHeight - b.h) / 2));
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => {      // after the scroll event, which hides the tooltip
      if (!dom || !cur.on || posOf[cur.i] !== p) return;
      const r2 = dom.body.getBoundingClientRect();
      fillTip(how); BE.tip.show(r2.left + b.x + b.w - 4, r2.top + b.y + b.h - 4, [tipBox]);
    }); });
  }
  function openCoin() { BE.tip.hide(); BE.openCoin(COINS[cur.i].slug); }
  function onKey(e) {
    if (e.altKey || e.metaKey || !LAY || !order.length) return;
    const L = LAY, n = order.length;
    let p = cur.on && posOf[cur.i] >= 0 ? posOf[cur.i] : 0, j = cur.on && cur.j >= 0 ? cur.j : 0;
    switch (e.key) {
      case 'ArrowRight': if (j < NT - 1) j++; else if (p + L.rows < n) { p += L.rows; j = 0; } break;
      case 'ArrowLeft': if (j > 0) j--; else if (p - L.rows >= 0) { p -= L.rows; j = NT - 1; } break;
      case 'ArrowDown': p = Math.min(n - 1, p + 1); break;
      case 'ArrowUp': p = Math.max(0, p - 1); break;
      case 'PageDown': p = Math.min(n - 1, p + 10); break;
      case 'PageUp': p = Math.max(0, p - 10); break;
      case 'Home': if (e.ctrlKey) p = 0; j = 0; break;
      case 'End': if (e.ctrlKey) p = n - 1; j = NT - 1; break;
      case 'Enter': case ' ': e.preventDefault(); if (cur.on && posOf[cur.i] >= 0) openCoin(); return;
      case 'Escape': BE.tip.hide(); return;
      default: return;
    }
    e.preventDefault();
    setCur(p, j, 'key'); sayCell(); tipAtCursor('key');
  }
  // the coins a search text means: the coin of that symbol or name when there is one, otherwise every coin whose symbol
  // starts with it or whose name holds it
  function searchCoins(text) {
    const q = text.trim().toLowerCase(); if (!q) return null;
    const low = (s) => String(s || '').toLowerCase(), out = [];
    COINS.forEach((c, i) => { if (low(c.s) === q || low(c.k) === q || low(c.n) === q) out.push(i); });
    if (!out.length) COINS.forEach((c, i) => { if (low(c.s).startsWith(q) || (q.length > 1 && (low(c.k).includes(q) || low(c.n).includes(q)))) out.push(i); });
    return out;
  }
  function runSearch(scroll) {
    const text = dom.q.value, hits = searchCoins(text);
    found = hits || [];
    const here = found.filter((i) => posOf[i] >= 0), names = (l) => l.slice(0, 3).map((i) => COINS[i].s).join(', ') + (l.length > 3 ? ` 외 ${l.length - 3}종목` : '');
    dom.qmsg.textContent = !hits ? '' : !hits.length ? `“${text.trim()}”에 맞는 종목이 없습니다.`
      : !here.length ? `${names(found)}: 거래소 조건에 맞지 않아 그려지지 않았습니다.`
        : `${names(here)}: 노란 테두리로 표시했습니다.`;
    placeMarks();
    if (scroll && here.length && LAY) {
      const r = rowBox(posOf[here[0]]), top = dom.body.getBoundingClientRect().top + r.y;
      if (top < 120 || top + r.h > innerHeight - 20) window.scrollBy(0, top - innerHeight / 2);
    }
    return here;
  }
  function wire() {
    const mx = dom.mx;
    mx.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; });
    mx.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const x = bodyPoint(e); if (!x) { if (cur.by !== 'key') clearCur(); return; }
      if (!cur.on || posOf[cur.i] !== x.p || cur.j !== x.j) setCur(x.p, x.j, 'mouse');
      cur.by = 'mouse'; fillTip('mouse'); BE.tip.show(e.clientX, e.clientY, [tipBox]);
    });
    mx.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && cur.by !== 'key') clearCur(); });
    mx.addEventListener('click', (e) => {
      const x = bodyPoint(e); if (!x) return;
      // a finger has no hover: the first touch shows the details, the second one on the same coin opens it
      if (lastPointer !== 'mouse' && !(cur.on && cur.by === 'touch' && cur.i === order[x.p])) {
        setCur(x.p, x.j, 'touch'); sayCell(); fillTip('touch'); BE.tip.show(e.clientX, e.clientY, [tipBox]);
        return;
      }
      setCur(x.p, x.j, cur.by || 'mouse'); openCoin();
    });
    mx.addEventListener('keydown', onKey);
    mx.addEventListener('focus', () => {
      if (!mx.matches(':focus-visible') || !order.length) return;
      setCur(cur.i >= 0 && posOf[cur.i] >= 0 ? posOf[cur.i] : 0, Math.max(0, cur.j), 'key'); sayCell(); tipAtCursor('key');
    });
    mx.addEventListener('blur', () => { if (cur.by === 'key') clearCur(); });

    const tfOf = (e) => { const b = e.target.closest && e.target.closest('.bma-tf'); return b ? Number(b.dataset.j) : -1; };
    dom.strip.addEventListener('click', (e) => {
      const j = tfOf(e); if (j < 0) return;
      if (S.sort === 'tf' && S.tf === j) S.sort = 'mcap'; else { S.sort = 'tf'; S.tf = j; }
      BE.save(); update();
      if (hotTf >= 0) BE.tip.show(e.clientX, e.clientY, stripTip(j));
    });
    dom.strip.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const j = tfOf(e); if (j < 0) { if (hotTf >= 0) clearCur(); return; }
      if (hotTf !== j || cur.on) { cur.on = false; hotTf = j; placeMarks(); }
      BE.tip.show(e.clientX, e.clientY, stripTip(j));
    });
    dom.strip.addEventListener('pointerleave', () => { if (hotTf >= 0) clearCur(); });
    dom.strip.addEventListener('keydown', (e) => {
      const j = tfOf(e); if (j < 0 || e.altKey || e.metaKey || e.ctrlKey) return;
      const to = e.key === 'ArrowRight' ? j + 1 : e.key === 'ArrowLeft' ? j - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? NT - 1 : -1;
      if (to < 0 || to >= NT) return;
      e.preventDefault(); dom.tf[to].focus();
    });
    dom.strip.addEventListener('focusin', (e) => {
      const j = tfOf(e); if (j < 0) return;
      dom.tf[stripStop].tabIndex = -1; stripStop = j; dom.tf[j].tabIndex = 0;
      if (!e.target.matches(':focus-visible')) return;
      cur.on = false; hotTf = j; placeMarks();
      const rc = e.target.getBoundingClientRect(); BE.tip.show(rc.left + rc.width / 2, rc.bottom - 6, stripTip(j));
    });
    dom.strip.addEventListener('focusout', () => { if (hotTf >= 0) clearCur(); });

    let qt = 0;
    dom.q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { if (dom) runSearch(true); }, 140); });
    dom.q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      clearTimeout(qt);
      const here = runSearch(true); if (!here.length) return;
      e.preventDefault(); cur.i = here[0]; cur.j = Math.max(0, cur.j); cur.on = false;
      mx.focus({ preventScroll: true });                           // the cursor goes to the coin: Enter again opens it
      if (!cur.on) { setCur(posOf[here[0]], cur.j, 'key'); sayCell(); tipAtCursor('key'); }
    });
  }
  function onDocDown(e) { if (dom && cur.on && cur.by === 'touch' && !(e.target instanceof Node && dom.mx.contains(e.target))) clearCur(); }
  let rt = 0, lastH = 0;
  function onResize() {                                            // a change of height alone: the rows are fitted to the window
    clearTimeout(rt);
    rt = setTimeout(() => { if (!dom || innerHeight === lastH || dom.narrow) return; update(); }, 200);
  }

  // ---------- legend, hint, the whole picture ----------
  const SORT_NAME = { mcap: '시가총액 순', n13: '13이 많은 순', near: '임박한 13의 조건가가 가까운 순' };
  function renderLegend() {
    const lg = dom.legend, f0 = FAMS.find(BE.famOn), f1 = FAMS.find((f) => f !== f0 && BE.famOn(f));
    const add = (nodes, text) => { const s = el('span'); s.append(...nodes, document.createTextNode(text)); lg.append(s); };
    const sw = (cls, bg) => { const i = el('i', 'bma-sw' + (cls ? ' ' + cls : '')); if (bg) i.style.background = bg; return i; };
    lg.replaceChildren();
    if (S.side === 'both') { add([sw('up')], '칸의 위쪽 반은 매도 쪽'); add([sw('dn')], '아래쪽 반은 매수 쪽'); }
    else add([sw('', 'var(--muted)')], `칸 전체가 ${SIDE[DIRS[halves()[0]]]} 쪽`);
    if (f0 != null) add(FAMS.filter(BE.famOn).map((f) => sw('', `var(--bma-f${f})`)), '13 완성 (계열 색)');
    if (f1 != null) add([sw('', `linear-gradient(90deg, var(--bma-f${f0}) 50%, var(--bma-f${f1}) 50%)`)], '두 계열이 함께 완성');
    if (S.show === 'both') { add([sw('sm', 'var(--setup)')], '9'); add([sw('sm', 'var(--bma-rep)')], '반복 9'); }
    if (S.show === 'near' && f0 != null) {
      const fr = (bg) => { const i = sw('', bg); i.style.boxShadow = `inset 0 0 0 2px var(--bma-f${f0})`; return i; };
      add([fr(`var(--bma-tint${f0})`)], '13 임박, 지금 값으로 충족'); add([fr('var(--bma-ground)')], `13 임박, 조건가까지 ${G.thr}% 이내`);
    }
    add([sw('', 'var(--bma-ground)')], '신호 없음'); add([sw('hole')], '확정 봉 없음');
    if (order.some((i) => LATE[i])) add([el('span', 'bma-late', '종목')], 'TradingView에 최근 봉이 없는 종목');
    add([sw('g10'), sw('g50')], '10줄마다 선, 50줄마다 진한 선');
  }
  function renderHint() {
    const n = order.length, none = BE.COINS.length - COINS.length, touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
    const from = G.ex.length ? `${G.ex.map((x) => EX_NAME[x]).join(', ')}에 ${G.ex.length > 1 ? '모두 ' : ''}상장한 ${n}종목` : `데이터가 있는 ${n}종목`;
    const one = S.side === 'both' ? '' : SIDE[DIRS[halves()[0]]], parts = [];
    if (S.sort === 'tf') {
      const kinds = ['13', ...(S.show === 'both' ? ['9'] : S.show === 'near' ? ['임박'] : [])].flatMap((k) => halves().map((h) => `${SIDE[DIRS[h]]} ${k}`)).join(', ');
      parts.push(`${from} 가운데 ${TFS[S.tf]}에 신호가 있는 종목을 앞에 놓았습니다. 앞에서부터 ${kinds} 순이고, 신호가 같으면 시가총액 순입니다. 같은 타임프레임을 다시 누르면 시가총액 순으로 돌아갑니다.`);
    } else parts.push(`${from}을 ${SORT_NAME[S.sort]}으로, 위에서 아래로 그리고 왼쪽 블록에서 오른쪽 블록으로 놓았습니다.`);
    if (!G.ex.length && none > 0) parts.push(`TradingView USD 티커가 없는 ${none}종목은 그리지 않았습니다.`);
    if (one) parts.push(`지금은 ${one} 쪽만 그려서 칸 전체를 쓰고, 정렬도 ${one} 쪽 신호만 봅니다.`);
    // a cell shows the strongest signal only; the numbers above the matrix count every coin that has the signal
    if (S.show === 'both') parts.push('칸에는 고른 기간 안에서 가장 강한 신호 하나를 그립니다. 13 완성과 9가 함께 있으면 13 완성만 그리고, 위쪽 숫자는 가려진 9까지 셉니다.');
    if (S.show === 'near') parts.push(`13 임박은 카운트다운이 12에서 13을 기다리는 칸 가운데, 최근 종가에서 조건가까지의 거리가 ${G.thr}% 이하인 칸입니다. 13 완성이 있는 칸에는 13 완성만 그리고, 위쪽 숫자는 가려진 13 임박까지 셉니다.`);
    if (!FAMS.some(BE.famOn)) parts.push('계열을 모두 껐기 때문에 13은 보이지 않습니다.');
    dom.hint.textContent = parts.join(' ');
    dom.use.textContent = (touch ? '칸을 한 번 누르면 그 종목의 20개 타임프레임과 그 칸의 신호, 다음 봉 조건이 나오고, 같은 종목을 한 번 더 누르면 그 종목의 화면이 열립니다.'
      : '칸에 마우스를 올리거나 방향키로 옮기면 그 종목의 20개 타임프레임과 그 칸의 신호, 다음 봉 조건이 나오고, 누르거나 Enter를 치면 그 종목의 화면이 열립니다.') +
      (S.sort !== 'tf' ? ' 위쪽 막대의 타임프레임을 누르면 그 타임프레임에 신호가 있는 종목이 앞으로 모입니다.' : '') +
      (one ? '' : ' 방향에서 한쪽만 고르면 칸 전체를 그쪽에 써서 표시가 두 배로 커집니다.');
  }
  function update() {
    if (!dom) return;
    BE.tip.hide(); tipKey = '';
    computeFacts(); computeOrder(); computeTotals(); readPalette();
    for (const c of dom.ctl) c.sync();
    const n = order.length, W = dom.strip.clientWidth;             // the width inside the picture panel
    dom.empty.hidden = n > 0; dom.mx.hidden = n === 0;
    renderStrip(W);
    if (n) {
      const bar = document.querySelector('.appbar'), top = bar ? bar.offsetHeight + (parseFloat(getComputedStyle(bar).top) || 0) : 0;
      dom.root.style.setProperty('--bma-top', top + 'px');
      const HH = W < 560 ? 15 : 16; dom.head.style.height = HH + 'px';
      // what the picture panel holds besides the rows, and the same without the strip
      const pic = dom.pic.getBoundingClientRect().height - dom.body.getBoundingClientRect().height, strip = dom.strip.getBoundingClientRect().height;
      lastH = innerHeight;
      LAY = computeLayout(W, n, innerHeight - top - 12 - pic, innerHeight - top - 12 - (pic - strip));
      dom.narrow = LAY.narrow;
      drawHead(); drawBody();
    } else LAY = null;
    if (cur.on && posOf[cur.i] < 0) cur.on = false;
    if (dom.q.value.trim()) runSearch(false); else placeMarks();
    renderLegend(); renderHint();
  }

  function addCss() {
    if (document.getElementById('be-market-a-css')) return;
    const s = document.createElement('style'); s.id = 'be-market-a-css';
    s.textContent = `
.bma-ctl .bma-q { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 5px 10px; width: 150px; max-width: 100%; }
.bma-ctl .bma-find { flex: 1 1 420px; }
.bma-ctl .bma-qmsg { font-weight: 400; }
.bma-pic { padding: 7px 10px 8px; display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
.bma-strip { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); padding-bottom: 5px; border-bottom: 1px solid var(--line); }
.bma-srow { display: grid; grid-template-columns: var(--bma-key, 48px) repeat(var(--bma-n, 20), minmax(0, 1fr)); }
.bma-key, .bma-tf { position: relative; display: grid; grid-template-rows: 14px 10px 10px 5px 10px 10px; }
.bma-key::after, .bma-tf::after { content: ""; position: absolute; left: 0; right: 0; top: 36px; height: 1px; background: var(--line); pointer-events: none; }
.bma-key span { font-size: 10.5px; line-height: 10px; color: var(--muted); white-space: nowrap; }
.bma-key .r1 { line-height: 14px; color: var(--faint); }
.bma-strip .r1 { grid-row: 1; } .bma-strip .r2 { grid-row: 2; } .bma-strip .r3 { grid-row: 3; } .bma-strip .r5 { grid-row: 5; } .bma-strip .r6 { grid-row: 6; }
.bma-tf { border: 0; background: none; margin: 0; padding: 0 1px; border-radius: 6px; cursor: pointer; min-width: 0; grid-template-columns: auto auto; justify-content: center; column-gap: 5px; color: var(--fg); font: inherit; }
.bma-tf:hover, .bma-tf.hot { background: var(--sunken); }
.bma-tf[aria-pressed="true"] { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
.bma-tf:focus-visible { outline-offset: -2px; }
.bma-tf.gs { margin-left: 6px; }
.bma-tf .tfn { grid-area: 1 / 1 / 2 / 3; font: 600 11px/14px var(--font-mono); text-align: center; }
.bma-tf .bz { grid-column: 1; display: flex; gap: 1px; }
.bma-tf .bz.up { grid-row: 2 / 4; align-items: flex-end; }
.bma-tf .bz.dn { grid-row: 5 / 7; align-items: flex-start; }
.bma-tf .bz i { display: flex; width: var(--bma-bar, 10px); }
.bma-tf .bz.up i { flex-direction: column-reverse; }
.bma-tf .bz.dn i { flex-direction: column; }
.bma-tf .bz b { display: block; flex: none; }
.bma-tf .n { grid-column: 2; min-width: 3ch; font: 500 10.5px/10px var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; color: var(--setup-ink); }
.bma-tf .n.n13 { color: var(--fg); font-weight: 600; }
.bma-tf .n.z { color: var(--faint); font-weight: 400; }
.bma-strip.sell .r5, .bma-strip.sell .r6, .bma-strip.sell .bz.dn, .bma-strip.buy .r2, .bma-strip.buy .r3, .bma-strip.buy .bz.up { opacity: .32; }
.bma-strip.cmp .bma-key span { font-size: 9.5px; }
.bma-strip.cmp .bma-tf { column-gap: 2px; padding: 0; }
.bma-strip.cmp .bma-tf.gs { margin-left: 3px; }
.bma-strip.cmp .bma-tf .n { font-size: 9.5px; min-width: 0; }
.bma-strip.xs .bma-tf { column-gap: 1px; }
.bma-strip.xs .bma-tf .n { font-size: 9px; letter-spacing: -.2px; }
.bma-mx { position: relative; cursor: pointer; border-radius: 3px; max-width: 100%; -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
.bma-mx:focus-visible { outline-offset: 3px; }
.bma-mx canvas { display: block; max-width: 100%; }
.bma-head { position: sticky; top: var(--bma-top, 53px); z-index: 3; background: var(--surface); }
.bma-body { position: relative; overflow-x: clip; overflow-clip-margin: 3px; }
.bma-o { position: absolute; pointer-events: none; display: none; }
.bma-o.on { display: block; }
.bma-o.tint { background: var(--accent); opacity: .16; }
.bma-o.tint.sorted { opacity: .1; }
.bma-o.cell { z-index: 2; box-shadow: 0 0 0 1px var(--surface), 0 0 0 2.5px var(--fg); }
.bma-o.sym { z-index: 1; padding-left: 4px; background: var(--surface); background: color-mix(in srgb, var(--accent) 16%, var(--surface)); color: var(--fg); font-family: var(--font-mono); font-weight: 700; white-space: nowrap; transform-origin: 100% 50%; }
.bma-o.find { z-index: 1; border-radius: 2px; box-shadow: 0 0 0 2px var(--hl); }
.bma-o.find::after { content: ""; position: absolute; inset: 0; background: var(--hl); opacity: .2; }
.bma-o.tag { top: 0; bottom: 0; transform: translateX(-50%); padding: 0 3px; border-radius: 3px; background: var(--fg); color: var(--surface); font: 600 10px/16px var(--font-mono); white-space: nowrap; }
.bma-o.tag.sorted { background: var(--accent-soft); color: var(--fg); box-shadow: inset 0 0 0 1px var(--accent); }
.bma-sw { display: inline-block; width: 11px; height: 11px; border-radius: 2px; flex: none; }
.bma-sw.sm { box-shadow: inset 0 0 0 3px var(--bma-ground); }
.bma-late { font: 500 10px var(--font-mono); text-decoration: underline dotted; text-underline-offset: 2px; }
.bma-sw.up { background: linear-gradient(180deg, var(--muted) 50%, var(--bma-ground) 50%); }
.bma-sw.dn { background: linear-gradient(180deg, var(--bma-ground) 50%, var(--muted) 50%); }
.bma-sw.hole { background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); }
.bma-sw.g10, .bma-sw.g50 { width: 14px; height: 1px; border-radius: 0; background: var(--fg); opacity: .14; }
.bma-sw.g50 { opacity: .4; }
.bma-tip { display: grid; gap: 2px; min-width: 0; }
.bma-tip .mag { margin-top: 6px; }
.bma-tip .mag canvas { display: block; }
.bma-tip .side { display: grid; gap: 3px; }
.bma-tip .side + .side { margin-top: 5px; }
.bma-tip .side > b, .bma-tip .sec > b { font-size: 11.5px; }
.bma-tip .dot { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 4px; }
.bma-tip .fam, .bma-tip .nb { white-space: nowrap; }
.bma-tip .sub { margin-top: 2px; font-size: 11.5px; color: var(--muted); }
.bma-tip .trig { display: flex; gap: 6px; align-items: flex-start; }
.bma-tip .trig .pc { margin-top: 2px; }
.bma-tip .pc { flex: none; padding: 0 3px; border: 1px solid var(--c); border-radius: 4px; background: color-mix(in srgb, var(--c) 14%, transparent); font: 600 11px/13px var(--font-mono); }
.bma-tip .pc.p9 { --c: var(--setup); border-style: dashed; background: none; color: var(--setup-ink); }
.bma-tip .warn { padding: 2px 6px; border-radius: 5px; background: var(--warn-bg); color: var(--warn-fg); }
.bma-tip .bma-foot { margin-top: 6px; font-size: 11px; }
@media (max-width: 720px) {
  .bma-pic { padding: 8px 7px 9px; }
  .bma-ctl .bma-find { flex-basis: 100%; }
  .bma-ctl .bma-q { width: 100%; }
}`;
    document.head.append(s);
  }

  // a group of buttons of which any number can be on, with the markup of BE.seg
  function toggles(id, label, options, has, flip) {
    const wrap = el('div', 'ctl'), lb = el('span', null, label), g = el('div', 'seg'); lb.id = id;
    g.setAttribute('role', 'group'); g.setAttribute('aria-labelledby', lb.id);
    wrap.sync = () => g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(has(b.dataset.v))));
    for (const [v, text] of options) { const b = el('button', null, text); b.type = 'button'; b.dataset.v = v; b.addEventListener('click', () => flip(v)); g.append(b); }
    wrap.append(lb, g); wrap.sync();
    return wrap;
  }

  BE.register({
    view: 'market', key: 'a', name: '픽셀 매트릭스',
    blurb: `데이터가 있는 ${COINS.length}종목의 20개 타임프레임을 한 화면에 모두 그립니다. 한 줄이 한 종목이고 한 칸이 한 타임프레임이며, 칸의 위쪽 반은 매도 쪽, 아래쪽 반은 매수 쪽입니다. ` +
      '계열 색으로 채운 칸은 13 완성을, 작은 회색 점은 9를 뜻하고, 같은 타임프레임에서 많은 종목이 함께 신호를 내면 세로 줄무늬로 보입니다.',
    good: ['시장 전체의 쏠림이 한눈에 보임', '모든 종목이 한 화면에 들어옴', '타임프레임별 종목 수를 막대와 숫자로 함께 확인'],
    weak: ['칸이 작아서 자세한 내용은 마우스를 올리거나 눌러야 보임', '13x2, 9* 같은 라벨 글자는 칸에 쓰지 않음', '휴대폰에서는 세로로 길어짐'],
    mount(root) {
      addCss(); readSettings();
      dom = { root, tiles: [], cols: [], tags: [], finds: [], tf: [], keys: [], ctl: [], narrow: false };
      const set = (k) => (v) => { S[k] = v; BE.save(); update(); };
      const ctl = el('div', 'panel controls bma-ctl'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', '픽셀 매트릭스 설정');
      dom.ctl.push(
        BE.seg('정렬', [['mcap', '시가총액'], ['n13', '13 많은 순'], ['near', '임박 가까운 순']], () => S.sort, (v) => { S.sort = v; if (v === 'near') S.show = 'near'; BE.save(); update(); }),
        BE.seg('기간', [[0, '마지막 봉'], [3, '최근 4봉']], () => G.win, (v) => { G.win = v; BE.save(); update(); }),
        BE.seg('표시', [['both', '9와 13'], ['13', '13만'], ['near', '13과 임박']], () => S.show, set('show')),
        BE.seg('방향', [['buy', '매수 쪽'], ['sell', '매도 쪽'], ['both', '양쪽']], () => S.side, set('side')),
        BE.seg('임박 기준', [[3, '3%'], [5, '5%'], [10, '10%']], () => G.thr, (v) => { G.thr = v; S.show = 'near'; BE.save(); update(); }),
        toggles('bma-lb-ex', '거래소', EXS.map((x) => [x, EX_NAME[x]]), (x) => G.ex.includes(x), (x) => { G.ex = EXS.filter((y) => (y === x ? !G.ex.includes(y) : G.ex.includes(y))); BE.save(); update(); }));
      const find = el('div', 'ctl bma-find'), lb = el('span', null, '종목 찾기'); lb.id = 'bma-lb-q';
      dom.q = el('input', 'bma-q'); dom.q.type = 'search'; dom.q.placeholder = '심볼이나 이름'; dom.q.autocomplete = 'off'; dom.q.spellcheck = false; dom.q.setAttribute('aria-labelledby', lb.id);
      dom.qmsg = el('span', 'bma-qmsg'); dom.qmsg.setAttribute('role', 'status');
      find.append(lb, dom.q, dom.qmsg);
      ctl.append(...dom.ctl, find);

      dom.pic = el('div', 'panel bma-pic');
      dom.strip = el('div', 'bma-strip'); dom.strip.setAttribute('role', 'toolbar');
      dom.strip.setAttribute('aria-label', '타임프레임별로 신호가 있는 종목 수. 좌우 방향키로 타임프레임을 옮기고, 누르면 그 타임프레임에 신호가 있는 종목을 앞에 모읍니다.');
      dom.mx = el('div', 'bma-mx'); dom.mx.tabIndex = 0; dom.mx.setAttribute('role', 'application');
      dom.mx.setAttribute('aria-label', '종목별, 타임프레임별 TD 신호 매트릭스. 방향키로 칸을 옮기고 Enter로 종목 화면을 엽니다.');
      dom.head = el('div', 'bma-head'); dom.headCv = document.createElement('canvas'); dom.headCv.setAttribute('aria-hidden', 'true'); dom.head.append(dom.headCv);
      dom.body = el('div', 'bma-body'); dom.marks = el('div');
      dom.rowhl = el('div', 'bma-o tint'); dom.sym = el('div', 'bma-o sym'); dom.cell = el('div', 'bma-o cell');
      dom.marks.append(dom.rowhl, dom.sym, dom.cell); dom.body.append(dom.marks);
      dom.mx.append(dom.head, dom.body);
      dom.empty = el('div', 'empty', '거래소 조건에 맞는 종목이 없습니다.'); dom.empty.hidden = true;
      dom.pic.append(dom.strip, dom.mx, dom.empty);
      dom.legend = el('div', 'legend'); dom.legend.setAttribute('aria-label', '표시 방법');
      dom.hint = el('p', 'hint'); dom.use = el('p', 'hint');
      dom.live = el('p', 'sr-only'); dom.live.setAttribute('aria-live', 'polite');
      root.append(ctl, dom.pic, dom.legend, dom.hint, dom.use, dom.live);
      stripCols = 0; stripStop = 0; cur.on = false; cur.i = -1; cur.j = 0; hotTf = -1; found = [];
      wire();
      document.addEventListener('pointerdown', onDocDown, true);
      addEventListener('resize', onResize);
    },
    render() { update(); },
    unmount() {
      clearTimeout(rt); cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onDocDown, true);
      removeEventListener('resize', onResize);
      BE.tip.hide();
      dom = null; LAY = null; tipKey = '';
    },
  });
})();
