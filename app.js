(function () {
  'use strict';

  /* ---------- small helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const THUMBS_KEY = 'rainbow-rub-thumbs-v3';

  const CAT_COLORS = { animals: '#ffd6a5', birds: '#bde0fe', bugs: '#ffc6d9', fruits: '#fdffb6', vegetables: '#caffbf', houses: '#a0e7e5', vehicles: '#d0f4de', fishes: '#b9e6ff', stories: '#e0c3fc' };

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  const toColor32 = hex => { const [r, g, b] = hexToRgb(hex); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; };

  /* ---------- saved thumbnails (small previews of your coloring) ---------- */
  let thumbsMap = {};
  try { thumbsMap = JSON.parse(localStorage.getItem(THUMBS_KEY)) || {}; } catch (e) { thumbsMap = {}; }
  function saveThumbs() { try { localStorage.setItem(THUMBS_KEY, JSON.stringify(thumbsMap)); } catch (e) { /* storage full or blocked */ } }

  /* ---------- IndexedDB: keeps the painted layer of every picture ---------- */
  let dbPromise = null;
  function getDb() {
    if (!dbPromise) {
      dbPromise = new Promise(res => {
        try {
          const r = indexedDB.open('rainbow-coloring-v3', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('paint');
          r.onsuccess = () => res(r.result);
          r.onerror = () => res(null);
        } catch (e) { res(null); }
      });
    }
    return dbPromise;
  }
  async function dbGet(k) {
    const db = await getDb(); if (!db) return null;
    return new Promise(res => { try { const t = db.transaction('paint').objectStore('paint').get(k); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); } catch (e) { res(null); } });
  }
  async function dbPut(k, v) {
    const db = await getDb(); if (!db) return;
    return new Promise(res => { try { const t = db.transaction('paint', 'readwrite'); t.objectStore('paint').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); } catch (e) { res(); } });
  }
  async function dbDel(k) {
    const db = await getDb(); if (!db) return;
    return new Promise(res => { try { const t = db.transaction('paint', 'readwrite'); t.objectStore('paint').delete(k); t.oncomplete = () => res(); t.onerror = () => res(); } catch (e) { res(); } });
  }

  /* ---------- state ---------- */
  const S = {
    cat: 'all', query: '',
    pic: null, ready: false, W: 0, H: 0,
    lab: null, regions: 0, paint: null, p32: null, touched: null, strokeId: 0,
    tool: 'brush', sel: 0, size: 18, showNums: true,
    palette: [], num: null, area: null, painted: null, done: null, cx: null, cy: null, rad: null, totalArea: 0,
    hintNum: -1, hintUntil: 0, flashR: 0, flashUntil: 0, animating: false, celebrated: false, numCache: null,
    undo: [], cur: null, drawing: false, region: 0, last: null, dirty: null, unsaved: false, saveTimer: 0,
    refCanvas: null, loadToken: 0
  };
  const paintCv = $('#paintCv'), lineCv = $('#lineCv'), stage = $('#stage');
  const paintCtx = paintCv.getContext('2d');
  const lineCtx = lineCv.getContext('2d');
  const numCv = $('#numCv');
  const numCtx = numCv.getContext('2d');

  /* ---------- gallery ---------- */
  function renderChips() {
    const box = $('#chips');
    box.innerHTML = '';
    CATEGORIES.forEach(c => {
      const b = document.createElement('button');
      b.className = 'chip' + (S.cat === c.id ? ' active' : '');
      b.style.setProperty('--c', CAT_COLORS[c.id] || '#ffe08a');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', S.cat === c.id);
      b.textContent = `${c.icon} ${c.label}`;
      b.addEventListener('click', () => { S.cat = c.id; renderChips(); renderGrid(); });
      box.appendChild(b);
    });
  }

  function renderGrid() {
    const grid = $('#grid');
    grid.innerHTML = '';
    const q = S.query.trim().toLowerCase();
    const list = PICTURES.filter(p =>
      (S.cat === 'all' || p.cat === S.cat) &&
      (!q || p.name.toLowerCase().includes(q) || p.cat.includes(q)));
    $('#empty').hidden = list.length > 0;

    list.forEach(p => {
      const card = document.createElement('a');
      card.className = 'card';
      card.href = '#/' + p.id;
      card.setAttribute('aria-label', 'Color ' + p.name);

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      const img = document.createElement('img');
      img.src = thumbsMap[p.id] || `thumbs/${p.id}.png`;
      img.alt = p.name + ' coloring page';
      img.loading = 'lazy';
      thumb.appendChild(img);

      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.style.setProperty('--tag', CAT_COLORS[p.cat]);
      tag.textContent = p.cat === 'houses' ? 'fun houses' : p.cat;

      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = p.name;

      const sub = document.createElement('p');
      sub.className = 'card-sub';
      sub.textContent = p.story ? 'Story: ' + p.story[0] : p.fact;

      card.append(thumb, tag, title, sub);
      if (thumbsMap[p.id]) {
        const d = document.createElement('span');
        d.className = 'done';
        d.title = 'You started coloring this one!';
        d.textContent = '\uD83C\uDFA8';
        card.appendChild(d);
      }
      grid.appendChild(card);
    });
  }

  /* ---------- color names ---------- */
  const COLOR_NAMES = [
    ['Red', '#e63946'], ['Dark red', '#a4161a'], ['Orange', '#ff8c1a'], ['Yellow', '#ffd43b'], ['Light yellow', '#fff1a8'], ['Gold', '#f5b700'],
    ['Green', '#3fae5a'], ['Light green', '#9ad56b'], ['Dark green', '#2e7d32'], ['Olive', '#7a8b3a'], ['Teal', '#2ec4b6'],
    ['Sky blue', '#8fd3f4'], ['Light blue', '#cfeefc'], ['Blue', '#3a86ff'], ['Navy blue', '#1d3a8a'], ['Blue-gray', '#8da2b8'], ['Purple', '#8e5be8'],
    ['Pink', '#ff8fab'], ['Hot pink', '#f06292'], ['Peach', '#f4a6a6'], ['Brown', '#8d5a33'], ['Light brown', '#c97a2b'],
    ['Tan', '#e9c88f'], ['Cream', '#fff1cf'], ['White', '#ffffff'], ['Gray', '#9ca3af'], ['Dark gray', '#4b5563'], ['Black', '#222222']
  ];
  function colorName(hex) {
    const [r, g, b] = hexToRgb(hex);
    let best = COLOR_NAMES[0][0], bd = Infinity;
    for (const [name, h] of COLOR_NAMES) {
      const [r2, g2, b2] = hexToRgb(h);
      const d = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2;
      if (d < bd) { bd = d; best = name; }
    }
    return best;
  }
  function textOn(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#222222' : '#ffffff';
  }

  /* ---------- numbered palette ---------- */
  function buildPalette() {
    const pal = $('#palette'), gl = $('#guideList');
    pal.innerHTML = '';
    gl.innerHTML = '';
    S.palette.forEach((p, k) => {
      const b = document.createElement('button');
      b.className = 'num';
      b.dataset.k = k;
      b.style.setProperty('--c', p.hex);
      b.style.setProperty('--t', textOn(p.hex));
      b.setAttribute('aria-label', `Number ${k + 1}, ${p.name}`);
      b.innerHTML = `${k + 1}<span class="left"></span>`;
      b.addEventListener('click', () => selectNumber(k));
      pal.appendChild(b);

      const li = document.createElement('li');
      const g = document.createElement('button');
      g.className = 'guide-item';
      g.dataset.k = k;
      g.style.setProperty('--c', p.hex);
      g.style.setProperty('--t', textOn(p.hex));
      g.innerHTML = `<i>${k + 1}</i><span>${p.name}</span><em></em>`;
      g.addEventListener('click', () => selectNumber(k));
      li.appendChild(g);
      gl.appendChild(li);
    });
    updatePalette();
  }
  function remaining(k) {
    let n = 0;
    for (let r = 1; r < S.num.length; r++) if (S.num[r] === k && !S.tiny[r] && !S.done[r]) n++;
    return n;
  }
  function updatePalette() {
    if (!S.palette.length) return;
    $$('#palette .num').forEach(b => {
      const k = +b.dataset.k, left = remaining(k);
      b.classList.toggle('active', k === S.sel);
      b.classList.toggle('done', left === 0);
      $('.left', b).textContent = left === 0 ? '\u2713' : left;
    });
    $$('#guideList .guide-item').forEach(g => {
      const k = +g.dataset.k, left = remaining(k);
      g.classList.toggle('active', k === S.sel);
      g.classList.toggle('done', left === 0);
      $('em', g).textContent = left === 0 ? 'Done \u2713' : left + (left === 1 ? ' shape' : ' shapes');
    });
    let tot = 0, got = 0;
    for (let r = 1; r < S.num.length; r++) { if (S.num[r] < 0 || S.tiny[r]) continue; tot += S.area[r]; got += Math.min(S.painted[r], S.area[r]); }
    const pct = tot ? Math.round(100 * got / tot) : 0;
    $('#bar').style.width = pct + '%';
    $('#pct').textContent = pct + '%';
    $('#undoBtn').disabled = S.undo.length === 0;
  }
  function selectNumber(k) {
    S.sel = k;
    if (S.tool === 'erase') setTool('brush');
    updatePalette();
  }
  function setTool(t) {
    S.tool = t;
    [['toolBrush', 'brush'], ['toolFill', 'fill'], ['toolErase', 'erase']].forEach(([id, name]) => {
      const el = $('#' + id);
      el.classList.toggle('active', name === t);
      el.setAttribute('aria-pressed', name === t);
    });
  }

  /* ---------- picture loading ---------- */
  function loadData(id) {
    if (window.PIC_DATA && PIC_DATA[id]) return Promise.resolve(PIC_DATA[id]);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'data/' + id + '.js';
      s.onload = () => (PIC_DATA[id] ? res(PIC_DATA[id]) : rej(new Error('no data')));
      s.onerror = () => rej(new Error('load failed'));
      document.head.appendChild(s);
    });
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }

  // Splits the picture into closed areas. Small gaps in the outlines (up to ~2*GAP pixels) are
  // bridged automatically so the color does not leak out of a shape that has a tiny opening.
  const GAP = 7;
  function dilateBarrier(gray, W, H, R) {
    const N = W * H;
    const a = new Uint8Array(N), b = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = gray[i] < 150 ? 1 : 0;
    // horizontal pass
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let cnt = 0;
      for (let x = 0; x < Math.min(R, W); x++) cnt += a[row + x];
      for (let x = 0; x < W; x++) {
        if (x + R < W) cnt += a[row + x + R];
        if (x - R - 1 >= 0) cnt -= a[row + x - R - 1];
        b[row + x] = cnt > 0 ? 1 : 0;
      }
    }
    // vertical pass
    for (let x = 0; x < W; x++) {
      let cnt = 0;
      for (let y = 0; y < Math.min(R, H); y++) cnt += b[y * W + x];
      for (let y = 0; y < H; y++) {
        if (y + R < H) cnt += b[(y + R) * W + x];
        if (y - R - 1 >= 0) cnt -= b[(y - R - 1) * W + x];
        a[y * W + x] = cnt > 0 ? 1 : 0;
      }
    }
    return a;
  }

  function computeRegions(gray, W, H) {
    const N = W * H;
    const lab = new Int32Array(N);
    const stack = new Int32Array(N);
    const solid = dilateBarrier(gray, W, H, GAP);   // 1 = line (or bridged gap)
    let id = 0;
    for (let s = 0; s < N; s++) {
      if (lab[s] !== 0 || solid[s]) continue;
      id++;
      let sp = 0;
      stack[sp++] = s;
      lab[s] = id;
      while (sp) {
        const p = stack[--sp];
        const x = p % W;
        let q;
        if (x > 0) { q = p - 1; if (!lab[q] && !solid[q]) { lab[q] = id; stack[sp++] = q; } }
        if (x < W - 1) { q = p + 1; if (!lab[q] && !solid[q]) { lab[q] = id; stack[sp++] = q; } }
        if (p >= W) { q = p - W; if (!lab[q] && !solid[q]) { lab[q] = id; stack[sp++] = q; } }
        if (p < N - W) { q = p + W; if (!lab[q] && !solid[q]) { lab[q] = id; stack[sp++] = q; } }
      }
    }
    // give the white pixels next to the lines (that were closed off) to their neighbouring area,
    // then let each color slide a few pixels under the black lines (no white gaps next to outlines)
    const grow = (maxPasses, whiteOnly) => {
      for (let pass = 0; pass < maxPasses; pass++) {
        const nxt = lab.slice();
        let changed = false;
        for (let p = 0; p < N; p++) {
          if (lab[p]) continue;
          if (whiteOnly && gray[p] < 150) continue;
          const x = p % W;
          let v = 0;
          if (x > 0) v = lab[p - 1];
          if (!v && x < W - 1) v = lab[p + 1];
          if (!v && p >= W) v = lab[p - W];
          if (!v && p < N - W) v = lab[p + W];
          if (v) { nxt[p] = v; changed = true; }
        }
        lab.set(nxt);
        if (!changed) break;
      }
    };
    grow(GAP * 2 + 3, true);
    grow(3, false);
    return { lab, count: id };
  }

  /* ---------- reading the picture: shapes, numbers and their colors ---------- */
  const MIN_AREA = 90;               // shapes smaller than this are left uncolored
  const BG_PASTEL = { animals: '#d8f0c8', birds: '#d4ecff', bugs: '#e4f6cf', fruits: '#fff0c2', vegetables: '#fff0c2', houses: '#d4ecff' };
  const FLAT_CATS = ['vehicles', 'fishes', 'stories'];   // these are drawn in flat colors: copy them exactly

  // A few guide pictures are photos with busy backgrounds, so some big shapes are set by hand
  // (rank = position among the shapes, biggest first, not counting the background).
  const FIXES = {
    'elephant': { lightToHex: '#8da2b8' },
    'cherry': { 0: '#c4182b', 1: '#c4182b' },
    'apple-house': { 0: '#d62f2f', 2: '#4f9d3a' },
    'orange-house': { 0: '#f28c1a', 1: '#a0521d', 2: '#4f9d3a', 3: '#4f9d3a' },
    'pear-house': { 0: '#f7d51d', 2: '#4f9d3a' },
    'daisy-house': { 0: '#f4b41a' },
    'banana-house': { 1: '#ffe135' }
  };

  function d2(a, b) { return 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2; }

  function kmeans(pts, K) {
    K = Math.min(K, pts.length);
    pts.sort((a, b) => b.w - a.w);
    const cent = [pts[0].c.slice()];
    while (cent.length < K) {
      let best = -1, bv = -1;
      pts.forEach((p, i) => {
        let m = Infinity;
        cent.forEach(c => { m = Math.min(m, d2(p.c, c)); });
        const v = m * Math.sqrt(p.w);
        if (v > bv) { bv = v; best = i; }
      });
      cent.push(pts[best].c.slice());
    }
    const asg = new Array(pts.length).fill(0);
    for (let it = 0; it < 15; it++) {
      pts.forEach((p, i) => {
        let bi = 0, bd = Infinity;
        cent.forEach((c, k) => { const d = d2(p.c, c); if (d < bd) { bd = d; bi = k; } });
        asg[i] = bi;
      });
      const sum = cent.map(() => [0, 0, 0, 0]);
      pts.forEach((p, i) => { const s = sum[asg[i]]; s[0] += p.c[0] * p.w; s[1] += p.c[1] * p.w; s[2] += p.c[2] * p.w; s[3] += p.w; });
      sum.forEach((s, k) => { if (s[3] > 0) cent[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    }
    // merge centers that are almost the same color
    const alias = cent.map((_, i) => i);
    for (let i = 0; i < cent.length; i++) for (let j = i + 1; j < cent.length; j++) {
      if (alias[j] === j && alias[i] === i && d2(cent[i], cent[j]) < 2600) alias[j] = i;
    }
    return { cent, asg: asg.map(k => alias[k]) };
  }

  function median(a) { a.sort((x, y) => x - y); return a[a.length >> 1]; }

  // Works out which number (color) every shape gets. The finished picture next to the line art
  // is used as the guide: every shape takes the color found at the same spot of that picture.
  function analyze(pic, gray, lab, count, W, H) {
    const N = W * H;
    const flat = FLAT_CATS.includes(pic.cat);
    const area = new Int32Array(count + 1);
    const touch = new Uint8Array(count + 1);
    for (let i = 0; i < N; i++) { const r = lab[i]; if (r) area[r]++; }
    for (let x = 0; x < W; x++) { touch[lab[x]] = 1; touch[lab[(H - 1) * W + x]] = 1; }
    for (let y = 0; y < H; y++) { touch[lab[y * W]] = 1; touch[lab[y * W + W - 1]] = 1; }
    touch[0] = 0;

    // size of the drawing
    let ax0 = W, ay0 = H, ax1 = 0, ay1 = 0;
    for (let i = 0; i < N; i++) if (gray[i] < 150) { const x = i % W, y = (i / W) | 0; if (x < ax0) ax0 = x; if (x > ax1) ax1 = x; if (y < ay0) ay0 = y; if (y > ay1) ay1 = y; }
    if (flat || ax1 <= ax0) { ax0 = 0; ay0 = 0; ax1 = W - 1; ay1 = H - 1; }

    // the guide picture
    const rc = S.refCanvas;
    let rd = null, rw = 0, rh = 0, reach = null;
    let rx0 = 0, ry0 = 0, rx1 = 0, ry1 = 0;
    if (rc) {
      rw = rc.width; rh = rc.height;
      rd = rc.getContext('2d').getImageData(0, 0, rw, rh).data;
      reach = new Uint8Array(rw * rh);
      rx1 = rw - 1; ry1 = rh - 1;
      if (!flat) {
        const bg = [[], [], []];
        for (let x = 0; x < rw; x++) for (const y of [0, 1, 2, rh - 1, rh - 2, rh - 3]) { const o = (y * rw + x) * 4; bg[0].push(rd[o]); bg[1].push(rd[o + 1]); bg[2].push(rd[o + 2]); }
        for (let y = 0; y < rh; y++) for (const x of [0, 1, 2, rw - 1, rw - 2, rw - 3]) { const o = (y * rw + x) * 4; bg[0].push(rd[o]); bg[1].push(rd[o + 1]); bg[2].push(rd[o + 2]); }
        const bc = [median(bg[0]), median(bg[1]), median(bg[2])];
        const isBg = new Uint8Array(rw * rh);
        for (let i = 0; i < rw * rh; i++) isBg[i] = d2([rd[i * 4], rd[i * 4 + 1], rd[i * 4 + 2]], bc) < 2 * 40 * 40 * 3 ? 1 : 0;
        // background = plain pixels that are connected to the border
        const st = new Int32Array(rw * rh); let sp = 0;
        const push = i => { if (isBg[i] && !reach[i]) { reach[i] = 1; st[sp++] = i; } };
        for (let x = 0; x < rw; x++) { push(x); push((rh - 1) * rw + x); }
        for (let y = 0; y < rh; y++) { push(y * rw); push(y * rw + rw - 1); }
        while (sp) {
          const p = st[--sp], x = p % rw;
          if (x > 0) push(p - 1); if (x < rw - 1) push(p + 1); if (p >= rw) push(p - rw); if (p < rw * rh - rw) push(p + rw);
        }
        const cols = new Int32Array(rw), rows = new Int32Array(rh);
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (!reach[y * rw + x]) { cols[x]++; rows[y]++; }
        const tc = Math.max(2, rh * 0.012), tr = Math.max(2, rw * 0.012);
        rx0 = 0; while (rx0 < rw - 1 && cols[rx0] < tc) rx0++;
        rx1 = rw - 1; while (rx1 > rx0 && cols[rx1] < tc) rx1--;
        ry0 = 0; while (ry0 < rh - 1 && rows[ry0] < tr) ry0++;
        ry1 = rh - 1; while (ry1 > ry0 && rows[ry1] < tr) ry1--;
      }
    }

    // sample the guide picture inside every shape
    const samples = new Array(count + 1);
    for (let r = 1; r <= count; r++) samples[r] = { n: 0, bg: 0, c: [[], [], []], dark: [[], [], []] };
    if (rd) {
      const sx = (rx1 - rx0 + 1) / (ax1 - ax0 + 1), sy = (ry1 - ry0 + 1) / (ay1 - ay0 + 1);
      for (let y = 1; y < H; y += 4) for (let x = 1; x < W; x += 4) {
        const r = lab[y * W + x];
        if (!r || area[r] < MIN_AREA) continue;
        const smp = samples[r];
        smp.n++;
        let qx = Math.round(rx0 + (x - ax0) * sx), qy = Math.round(ry0 + (y - ay0) * sy);
        qx = Math.max(0, Math.min(rw - 1, qx)); qy = Math.max(0, Math.min(rh - 1, qy));
        const qi = qy * rw + qx;
        if (reach[qi]) { smp.bg++; continue; }
        const R = rd[qi * 4], G = rd[qi * 4 + 1], B = rd[qi * 4 + 2];
        const target = (0.299 * R + 0.587 * G + 0.114 * B) < 70 ? smp.dark : smp.c;
        target[0].push(R); target[1].push(G); target[2].push(B);
      }
    }

    // decide what every shape is
    const num = new Int16Array(count + 1).fill(-1);
    const bgLike = new Uint8Array(count + 1);
    const pts = [];
    const colorOf = new Array(count + 1);
    for (let r = 1; r <= count; r++) {
      if (area[r] < MIN_AREA) continue;
      const smp = samples[r];
      if (!flat && (touch[r] || (smp.n && smp.bg / smp.n > 0.65))) { bgLike[r] = 1; continue; }
      let src = smp.c;
      if (src[0].length < Math.max(4, smp.n * 0.3)) src = smp.dark[0].length ? smp.dark : smp.c;
      if (!src[0].length) { if (flat) continue; bgLike[r] = 1; continue; }
      const col = [median(src[0].slice()), median(src[1].slice()), median(src[2].slice())];
      colorOf[r] = col;
      pts.push({ r, c: col, w: area[r] });
    }

    const fix = FIXES[pic.id];
    if (fix) {
      const ranked = pts.slice().sort((a, b) => b.w - a.w);
      ranked.forEach((p, i) => {
        if (fix[i]) p.c = hexToRgb(fix[i]);
        else if (fix.lightToHex && p.w > 1500 && (0.299 * p.c[0] + 0.587 * p.c[1] + 0.114 * p.c[2]) > 215) p.c = hexToRgb(fix.lightToHex);
      });
    }

    const palette = [];
    let bgIndex = -1;
    if (!flat) {
      const hex = BG_PASTEL[pic.cat] || '#d4ecff';
      palette.push({ hex, rgb: hexToRgb(hex) });
      bgIndex = 0;
    }
    if (pts.length) {
      let asg, cent;
      if (flat) {
        // flat pictures: every distinct color becomes its own number
        const order = pts.map((p, i) => i).sort((a, b) => pts[b].w - pts[a].w);
        cent = []; asg = new Array(pts.length);
        order.forEach(i => {
          let bk = -1, bd = Infinity;
          cent.forEach((c, k) => { const d = d2(pts[i].c, c); if (d < bd) { bd = d; bk = k; } });
          if (bk === -1 || (bd > 1800 && cent.length < 16)) { cent.push(pts[i].c.slice()); bk = cent.length - 1; }
          asg[i] = bk;
        });
        var sortedPts = pts;
        var km = { cent, asg };
      } else {
        var km = kmeans(pts.map(p => ({ r: p.r, c: p.c, w: p.w })), 7);
        var sortedPts = pts.slice().sort((a, b) => b.w - a.w);
      }
      const weight = {};
      sortedPts.forEach((p, i) => { const k = km.asg[i]; weight[k] = (weight[k] || 0) + p.w; });
      const order = Object.keys(weight).map(Number).sort((a, b) => weight[b] - weight[a]);
      const slot = {};
      order.forEach(k => {
        slot[k] = palette.length;
        const c = km.cent[k].map(v => Math.max(0, Math.min(255, Math.round(v))));
        palette.push({ hex: rgbToHex(c[0], c[1], c[2]), rgb: c });
      });
      sortedPts.forEach((p, i) => { num[p.r] = slot[km.asg[i]]; });
    }
    if (bgIndex >= 0) for (let r = 1; r <= count; r++) if (bgLike[r]) num[r] = bgIndex;
    // never leave a palette color unused
    const used = new Set(); for (let r = 1; r <= count; r++) if (num[r] >= 0) used.add(num[r]);
    const keep = palette.map((p, i) => i).filter(i => used.has(i));
    const remap = {}; keep.forEach((o, n) => { remap[o] = n; });
    for (let r = 1; r <= count; r++) if (num[r] >= 0) num[r] = remap[num[r]];
    const pal = keep.map(i => palette[i]);
    pal.forEach(p => { p.name = colorName(p.hex); p.color32 = toColor32(p.hex); });
    return { num, area, palette: pal };
  }

  // finds a good spot (and size) for the number of every shape: the point farthest from its edges
  function numberSpots(lab, W, H, count) {
    const N = W * H;
    const INF = 1e9;
    const dist = new Float32Array(N);
    for (let p = 0; p < N; p++) {
      const l = lab[p];
      if (!l) { dist[p] = 0; continue; }
      const x = p % W;
      let edge = x === 0 || x === W - 1 || p < W || p >= N - W;
      if (!edge) edge = lab[p - 1] !== l || lab[p + 1] !== l || lab[p - W] !== l || lab[p + W] !== l;
      dist[p] = edge ? 0 : INF;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x; let d = dist[p]; if (d === 0) continue;
      if (x > 0) d = Math.min(d, dist[p - 1] + 3);
      if (y > 0) { d = Math.min(d, dist[p - W] + 3); if (x > 0) d = Math.min(d, dist[p - W - 1] + 4); if (x < W - 1) d = Math.min(d, dist[p - W + 1] + 4); }
      dist[p] = d;
    }
    const best = new Float32Array(count + 1), bx = new Int32Array(count + 1), by = new Int32Array(count + 1);
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x; let d = dist[p]; if (d === 0) continue;
      if (x < W - 1) d = Math.min(d, dist[p + 1] + 3);
      if (y < H - 1) { d = Math.min(d, dist[p + W] + 3); if (x < W - 1) d = Math.min(d, dist[p + W + 1] + 4); if (x > 0) d = Math.min(d, dist[p + W - 1] + 4); }
      dist[p] = d;
      const l = lab[p];
      if (d > best[l]) { best[l] = d; bx[l] = x; by[l] = y; }
    }
    const rad = new Float32Array(count + 1);
    for (let r = 1; r <= count; r++) rad[r] = best[r] / 3;
    return { cx: bx, cy: by, rad };
  }

  /* ---------- opening a picture ---------- */
  async function openPicture(id) {
    const pic = PICTURES.find(p => p.id === id);
    if (!pic) { location.hash = '#/'; return; }
    const token = ++S.loadToken;
    S.pic = pic;
    S.ready = false;
    S.undo = [];
    S.cur = null;
    S.drawing = false;
    S.celebrated = false;
    S.palette = [];
    S.num = new Int16Array(1);
    $('#loading').classList.remove('hide');

    $('#vName').textContent = pic.name;
    const tag = $('#vTag');
    tag.textContent = pic.cat === 'houses' ? 'fun houses' : pic.cat;
    tag.style.setProperty('--tag', CAT_COLORS[pic.cat]);
    $('#vFact').textContent = pic.fact || '';
    const story = $('#vStory');
    if (pic.story) {
      story.hidden = false;
      $('#vLines').innerHTML = pic.story.map(l => `<li>${l}</li>`).join('');
      $('#vMoral').textContent = pic.moral;
    } else {
      story.hidden = true;
    }
    document.title = `Color the ${pic.name} - Rainbow Coloring Book`;

    let data;
    try { data = await loadData(id); } catch (e) { toast('Could not load this picture.'); return; }
    if (token !== S.loadToken) return;

    const artImg = await loadImage(data.art);
    let refImg = null;
    try { refImg = await loadImage(data.ref); } catch (e) { refImg = null; }
    if (token !== S.loadToken) return;
    $('#refImg').src = data.ref;

    const W = artImg.naturalWidth, H = artImg.naturalHeight;
    S.W = W; S.H = H;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(artImg, 0, 0);
    const px = tctx.getImageData(0, 0, W, H).data;
    const N = W * H;
    const gray = new Uint8ClampedArray(N);
    for (let i = 0; i < N; i++) gray[i] = px[i * 4];

    paintCv.width = lineCv.width = numCv.width = W;
    paintCv.height = lineCv.height = numCv.height = H;
    const lineImg = lineCtx.createImageData(W, H);
    const ld = lineImg.data;
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, Math.min(255, Math.round((250 - gray[i]) * 255 / 230)));
      ld[i * 4] = 27; ld[i * 4 + 1] = 27; ld[i * 4 + 2] = 27; ld[i * 4 + 3] = a;
    }
    lineCtx.putImageData(lineImg, 0, 0);

    const reg = computeRegions(gray, W, H);
    S.lab = reg.lab;
    S.regions = reg.count;

    if (refImg) {
      const c = document.createElement('canvas');
      c.width = refImg.naturalWidth; c.height = refImg.naturalHeight;
      c.getContext('2d', { willReadFrequently: true }).drawImage(refImg, 0, 0);
      S.refCanvas = c;
    } else { S.refCanvas = null; }
    const an = analyze(pic, gray, S.lab, S.regions, W, H);
    S.num = an.num; S.area = an.area; S.palette = an.palette;
    const spots = numberSpots(S.lab, W, H, S.regions);
    S.cx = spots.cx; S.cy = spots.cy; S.rad = spots.rad;
    S.tiny = new Uint8Array(S.regions + 1);
    for (let r = 1; r <= S.regions; r++) if (S.num[r] >= 0 && S.rad[r] < 9) S.tiny[r] = 1;
    S.painted = new Int32Array(S.regions + 1);
    S.done = new Uint8Array(S.regions + 1);

    S.paint = paintCtx.createImageData(W, H);
    S.p32 = new Uint32Array(S.paint.data.buffer);
    S.touched = new Uint32Array(N);
    S.strokeId = 0;
    S.dirty = null;
    S.unsaved = false;

    const blob = await dbGet(id);
    if (token !== S.loadToken) return;
    if (blob) {
      try {
        const url = URL.createObjectURL(blob);
        const im = await loadImage(url);
        URL.revokeObjectURL(url);
        if (token !== S.loadToken) return;
        tctx.clearRect(0, 0, W, H);
        tctx.drawImage(im, 0, 0, W, H);
        const sd = tctx.getImageData(0, 0, W, H).data;
        S.p32.set(new Uint32Array(sd.buffer.slice(0)));
      } catch (e) { /* ignore a broken save */ }
    }
    paintCtx.putImageData(S.paint, 0, 0);
    recount();

    const first = S.palette.findIndex((p, k) => remaining(k) > 0);
    S.sel = first === -1 ? 0 : first;
    buildPalette();
    layout();
    S.ready = true;
    $('#loading').classList.add('hide');
    redrawNumbers();
  }

  function layout() {
    if (!S.pic || !S.W) return;
    const paper = $('#paper');
    const cs = getComputedStyle(paper);
    const avail = paper.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const maxH = Math.max(320, window.innerHeight * 0.68);
    const aspect = S.W / S.H;
    const w = Math.max(200, Math.min(avail, maxH * aspect));
    stage.style.width = w + 'px';
    stage.style.height = (w / aspect) + 'px';
  }

  /* ---------- progress bookkeeping ---------- */
  function recount() {
    S.painted.fill(0);
    const { p32, lab } = S;
    for (let i = 0; i < p32.length; i++) if (p32[i] !== 0) S.painted[lab[i]]++;
    for (let r = 1; r < S.num.length; r++) S.done[r] = (S.num[r] >= 0 && S.painted[r] >= S.area[r] * 0.97) ? 1 : 0;
  }
  function allDone() {
    for (let r = 1; r < S.num.length; r++) if (S.num[r] >= 0 && !S.tiny[r] && !S.done[r]) return false;
    return true;
  }
  function afterChange() {
    for (let r = 1; r < S.num.length; r++) S.done[r] = (S.num[r] >= 0 && S.painted[r] >= S.area[r] * 0.97) ? 1 : 0;
    const wasSel = S.sel;
    if (S.palette.length && remaining(S.sel) === 0) {
      const next = S.palette.findIndex((p, k) => remaining(k) > 0);
      if (next !== -1) { toast(`\u2713 Number ${wasSel + 1} is finished! Now try number ${next + 1}.`); S.sel = next; }
    }
    updatePalette();
    redrawNumbers();
    if (allDone() && !S.celebrated) { S.celebrated = true; toast('\uD83C\uDF89 Wow! Every shape is colored. Beautiful job!'); }
  }

  /* ---------- numbers on the picture ---------- */
  function redrawNumbers() {
    if (!S.ready && !S.pic) return;
    const g = document.createElement('canvas');
    g.width = S.W; g.height = S.H;
    const c = g.getContext('2d');
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (S.showNums) {
      for (let r = 1; r < S.num.length; r++) {
        if (S.num[r] < 0 || S.done[r] || S.tiny[r]) continue;
        const fs = Math.max(10, Math.min(34, S.rad[r] * 1.1));
        c.font = `800 ${fs}px "Trebuchet MS", Arial, sans-serif`;
        c.lineWidth = fs * 0.3; c.strokeStyle = 'rgba(255,255,255,.95)';
        c.strokeText(S.num[r] + 1, S.cx[r], S.cy[r]);
        c.fillStyle = '#34344a';
        c.fillText(S.num[r] + 1, S.cx[r], S.cy[r]);
      }
    }
    S.numCache = g;
    drawOverlay(performance.now());
  }
  function drawOverlay(now) {
    numCtx.clearRect(0, 0, S.W, S.H);
    const hintOn = now < S.hintUntil && (Math.floor(now / 220) % 2 === 0);
    if (hintOn) {
      numCtx.fillStyle = 'rgba(255,212,59,.9)';
      for (let r = 1; r < S.num.length; r++) {
        if (S.num[r] !== S.hintNum || S.done[r] || S.tiny[r]) continue;
        numCtx.beginPath(); numCtx.arc(S.cx[r], S.cy[r], Math.max(S.rad[r] * 0.8, 16), 0, 7); numCtx.fill();
      }
    }
    if (now < S.flashUntil && S.flashR) {
      numCtx.fillStyle = 'rgba(255,60,90,.75)';
      numCtx.beginPath(); numCtx.arc(S.cx[S.flashR], S.cy[S.flashR], Math.max(S.rad[S.flashR] * 0.85, 18), 0, 7); numCtx.fill();
    }
    if (S.numCache) numCtx.drawImage(S.numCache, 0, 0);
  }
  function animateOverlay() {
    if (S.animating) return;
    S.animating = true;
    (function loop(t) {
      drawOverlay(t);
      if (t < S.hintUntil || t < S.flashUntil) requestAnimationFrame(loop);
      else { S.animating = false; drawOverlay(t); }
    })(performance.now());
  }

  /* ---------- drawing ---------- */
  function toImg(e) {
    const r = lineCv.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) * S.W / r.width), y: Math.floor((e.clientY - r.top) * S.H / r.height) };
  }
  function inside(p) { return p.x >= 0 && p.y >= 0 && p.x < S.W && p.y < S.H; }

  function regionAt(x, y, rad) {
    const { W, H, lab } = S;
    x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y));
    const v = lab[y * W + x];
    if (v) return v;
    for (let d = 1; d <= rad; d++) {
      for (let dy = -d; dy <= d; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        const step = (dy === -d || dy === d) ? 1 : 2 * d;
        for (let dx = -d; dx <= d; dx += step) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const r = lab[yy * W + xx];
          if (r) return r;
        }
      }
    }
    return 0;
  }

  function markDirty(x0, y0, x1, y1) {
    const d = S.dirty;
    if (!d) S.dirty = { x0, y0, x1, y1 };
    else { d.x0 = Math.min(d.x0, x0); d.y0 = Math.min(d.y0, y0); d.x1 = Math.max(d.x1, x1); d.y1 = Math.max(d.y1, y1); }
  }
  function flush() {
    const d = S.dirty;
    if (!d) return;
    paintCtx.putImageData(S.paint, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
    S.dirty = null;
  }

  function stamp(cx, cy, r, region) {
    if (region <= 0) return;
    const { W, H, lab, p32, touched, painted } = S;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    const r2 = r * r;
    const erase = S.tool === 'erase';
    const nv = erase ? 0 : S.palette[S.num[region]].color32;
    const cur = S.cur;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * W + x;
        if (lab[i] !== region) continue;
        const ov = p32[i];
        if (ov === nv) continue;
        if (touched[i] !== S.strokeId) { touched[i] = S.strokeId; cur.idx.push(i); cur.val.push(ov); }
        p32[i] = nv;
        if (ov === 0) painted[region]++; else if (nv === 0) painted[region]--;
      }
    }
    markDirty(x0, y0, x1, y1);
  }

  function strokeTo(p) {
    const a = S.last, r = S.size;
    const dist = Math.hypot(p.x - a.x, p.y - a.y);
    const step = Math.max(1, r * 0.4);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let k = 1; k <= n; k++) stamp(a.x + (p.x - a.x) * k / n, a.y + (p.y - a.y) * k / n, r, S.region);
    S.last = p;
  }

  function beginStroke() { S.strokeId++; S.cur = { idx: [], val: [] }; }

  // when a shape is almost full, finish it so no little white bits are left
  function completeRegion(region) {
    const { lab, p32, painted } = S;
    const nv = S.palette[S.num[region]].color32;
    const cur = S.cur;
    for (let i = 0; i < lab.length; i++) {
      if (lab[i] !== region || p32[i] === nv) continue;
      if (S.touched[i] !== S.strokeId) { S.touched[i] = S.strokeId; cur.idx.push(i); cur.val.push(p32[i]); }
      if (p32[i] === 0) painted[region]++;
      p32[i] = nv;
    }
    paintCtx.putImageData(S.paint, 0, 0);
  }

  function autoFillTiny() {
    const { lab, p32, painted } = S;
    const cur = S.cur;
    if (!cur) return;
    const fillSet = new Set();
    for (let r = 1; r < S.num.length; r++) {
      if (!S.tiny[r] || S.num[r] < 0 || S.painted[r] >= S.area[r] * 0.97) continue;
      for (let r2 = 1; r2 < S.num.length; r2++) { /* find out whether the number is finished */ break; }
      let left = 0;
      for (let q = 1; q < S.num.length; q++) {
        if (S.num[q] === S.num[r] && !S.tiny[q] && S.painted[q] < S.area[q] * 0.97) { left++; break; }
      }
      if (!left) fillSet.add(r);
    }
    if (!fillSet.size) return;
    for (let i = 0; i < lab.length; i++) {
      const r = lab[i];
      if (!r || !fillSet.has(r)) continue;
      const nv = S.palette[S.num[r]].color32;
      if (p32[i] === nv) continue;
      if (S.touched[i] !== S.strokeId) { S.touched[i] = S.strokeId; cur.idx.push(i); cur.val.push(p32[i]); }
      if (p32[i] === 0) painted[r]++;
      p32[i] = nv;
    }
    paintCtx.putImageData(S.paint, 0, 0);
  }

  function endStroke() {
    flush();
    const c = S.cur;
    const region = S.region;
    if (c && region > 0 && S.tool !== 'erase' && S.num[region] >= 0 && !S.done[region] && S.painted[region] >= S.area[region] * 0.85) completeRegion(region);
    if (c && c.idx.length) { for (let r = 1; r < S.num.length; r++) S.done[r] = (S.num[r] >= 0 && S.painted[r] >= S.area[r] * 0.97) ? 1 : 0; autoFillTiny(); }
    S.cur = null;
    if (c && c.idx.length) {
      S.undo.push({ idx: Int32Array.from(c.idx), val: Uint32Array.from(c.val) });
      if (S.undo.length > 30) S.undo.shift();
      scheduleSave();
      S.celebrated = false;
      afterChange();
    }
    S.region = 0;
  }

  function wrongShape(region) {
    const k = S.num[region];
    S.flashR = region;
    S.flashUntil = performance.now() + 700;
    animateOverlay();
    const btn = $(`#palette .num[data-k="${k}"]`);
    if (btn) { btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse'); setTimeout(() => btn.classList.remove('pulse'), 1600); }
    toast(`That shape is number ${k + 1} (${S.palette[k].name}). Pick number ${k + 1}!`);
  }

  function doFill(region) {
    const { lab, p32, painted } = S;
    const nv = S.palette[S.num[region]].color32;
    const idx = [], val = [];
    for (let i = 0; i < lab.length; i++) {
      if (lab[i] === region && p32[i] !== nv) { idx.push(i); val.push(p32[i]); if (p32[i] === 0) painted[region]++; p32[i] = nv; }
    }
    S.cur.idx = idx; S.cur.val = val;
    paintCtx.putImageData(S.paint, 0, 0);
  }

  lineCv.addEventListener('pointerdown', e => {
    if (!S.ready || e.button > 0) return;
    e.preventDefault();
    try { lineCv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = toImg(e);
    if (!inside(p)) return;
    S.drawing = true;
    beginStroke();
    const region = regionAt(p.x, p.y, S.size + 12);
    S.region = 0;
    if (!region || S.num[region] < 0) return;
    if (S.tool !== 'erase' && S.num[region] !== S.sel) { wrongShape(region); return; }
    if (S.tool === 'fill') { S.region = region; doFill(region); S.drawing = false; endStroke(); return; }
    S.region = region;
    S.last = p;
    stamp(p.x, p.y, S.size, region);
    flush();
  });
  lineCv.addEventListener('pointermove', e => {
    if (!S.drawing || !S.region) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (evs.length ? evs : [e]).forEach(ev => strokeTo(toImg(ev)));
    flush();
  });
  const stop = () => { if (S.drawing) { S.drawing = false; endStroke(); } };
  lineCv.addEventListener('pointerup', stop);
  lineCv.addEventListener('pointercancel', stop);

  /* ---------- tools ---------- */
  function applyPatch(patch) {
    const { idx, val } = patch, p32 = S.p32;
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; const t = p32[i]; p32[i] = val[k]; val[k] = t; }
    paintCtx.putImageData(S.paint, 0, 0);
    recount();
  }
  function undo() {
    const patch = S.undo.pop();
    if (!patch) return;
    applyPatch(patch);
    S.celebrated = false;
    scheduleSave();
    afterChange();
  }
  function clearAll() {
    const idx = [], val = [];
    for (let i = 0; i < S.p32.length; i++) if (S.p32[i] !== 0) { idx.push(i); val.push(S.p32[i]); S.p32[i] = 0; }
    if (!idx.length) return;
    S.undo.push({ idx: Int32Array.from(idx), val: Uint32Array.from(val) });
    paintCtx.putImageData(S.paint, 0, 0);
    recount();
    S.celebrated = false;
    const first = S.palette.findIndex((p, k) => remaining(k) > 0);
    S.sel = first === -1 ? 0 : first;
    scheduleSave();
    afterChange();
    toast('Fresh page! Press Undo to get your coloring back.');
  }
  function showAnswer() {
    const { lab, p32 } = S;
    const idx = [], val = [];
    for (let i = 0; i < lab.length; i++) {
      const r = lab[i];
      if (!r || S.num[r] < 0) continue;
      const nv = S.palette[S.num[r]].color32;
      if (p32[i] !== nv) { idx.push(i); val.push(p32[i]); p32[i] = nv; }
    }
    if (!idx.length) return;
    S.undo.push({ idx: Int32Array.from(idx), val: Uint32Array.from(val) });
    paintCtx.putImageData(S.paint, 0, 0);
    recount();
    scheduleSave();
    afterChange();
    toast('\u2728 Here is the finished picture! Press Undo to go back.');
  }
  function hint() {
    if (remaining(S.sel) === 0) { toast(`Number ${S.sel + 1} is already finished!`); return; }
    S.hintNum = S.sel;
    S.hintUntil = performance.now() + 2200;
    animateOverlay();
  }

  /* ---------- saving ---------- */
  function scheduleSave() {
    S.unsaved = true;
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(persistNow, 700);
  }
  function persistNow() {
    clearTimeout(S.saveTimer);
    if (!S.pic || !S.unsaved || !S.p32) return;
    S.unsaved = false;
    const id = S.pic.id, W = S.W, H = S.H;
    let any = false;
    for (let i = 0; i < S.p32.length; i++) if (S.p32[i] !== 0) { any = true; break; }
    if (!any) {
      dbDel(id);
      delete thumbsMap[id];
      saveThumbs();
      return;
    }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').putImageData(S.paint, 0, 0);
    // small preview for the gallery (paint + lines on white)
    const sc = 320 / Math.max(W, H);
    const t = document.createElement('canvas');
    t.width = Math.round(W * sc); t.height = Math.round(H * sc);
    const tg = t.getContext('2d');
    tg.fillStyle = '#fff'; tg.fillRect(0, 0, t.width, t.height);
    tg.drawImage(c, 0, 0, t.width, t.height);
    tg.drawImage(lineCv, 0, 0, t.width, t.height);
    thumbsMap[id] = t.toDataURL('image/jpeg', 0.78);
    saveThumbs();
    c.toBlob(b => { if (b) dbPut(id, b); }, 'image/png');
  }

  function savePng() {
    const pic = S.pic;
    const cv = document.createElement('canvas');
    const cap = Math.round(S.H * 0.09);
    cv.width = S.W; cv.height = S.H + cap;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(paintCv, 0, 0);
    g.drawImage(lineCv, 0, 0);
    g.fillStyle = '#2b2b2b';
    g.font = `bold ${Math.round(cap * 0.55)}px "Trebuchet MS", Arial, sans-serif`;
    g.textAlign = 'center';
    g.fillText(pic.name, cv.width / 2, S.H + cap * 0.68);
    cv.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${pic.id}-my-coloring.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      toast('\u2B07 Saved! Check your downloads.');
    }, 'image/png');
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- routing ---------- */
  function route() {
    persistNow();
    const m = location.hash.match(/^#\/([\w-]+)/);
    if (m) {
      $('#gallery').hidden = true;
      $('#viewer').hidden = false;
      window.scrollTo({ top: 0 });
      openPicture(m[1]);
    } else {
      $('#viewer').hidden = true;
      $('#gallery').hidden = false;
      S.pic = null; S.ready = false; S.loadToken++;
      document.title = 'Rainbow Coloring Book - Rub, Color & Have Fun!';
      renderGrid();
    }
  }
  function step(dir) {
    if (!S.pic) return;
    const idx = PICTURES.findIndex(p => p.id === S.pic.id);
    location.hash = '#/' + PICTURES[(idx + dir + PICTURES.length) % PICTURES.length].id;
  }

  /* ---------- install as an app (PWA) ---------- */
  let deferredInstall = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isAndroid = () => /android/i.test(navigator.userAgent);
  const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|TikTok|Snapchat|; wv\)/i.test(navigator.userAgent);

  async function installHelp() {
    const steps = $('#installSteps');
    const ios = '<h3>iPhone / iPad (Safari)</h3><ol><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. The icon appears on your screen!</li></ol>';
    const android = '<h3>Android (Chrome)</h3><ol><li>Tap the <b>&#8942; menu</b> at the top right of Chrome.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>, then <b>Install</b>).</li><li>Open the app from the new rainbow icon.</li></ol>';
    const desktop = '<h3>Computer (Chrome or Edge)</h3><ol><li>Click the <b>install icon</b> at the right end of the address bar, or open the <b>&#8942; menu</b>.</li><li>Choose <b>Install Rainbow Coloring Book</b>.</li><li>Click <b>Install</b>. It opens in its own window.</li></ol>';

    // what could be stopping the install?
    let swOk = false;
    try { swOk = !!(navigator.serviceWorker && await navigator.serviceWorker.getRegistration()); } catch (err) { swOk = false; }
    const problems = [];
    if (location.protocol === 'file:') problems.push('You opened this from a <b>file</b>. An app can only be installed from a website link that starts with <b>https://</b> (for example your GitHub Pages link).');
    else if (!window.isSecureContext) problems.push('This page is opened with <b>http://</b>. Please open the <b>https://</b> link instead (a plain http address or an IP address like 192.168.x.x cannot be installed).');
    else if (!swOk) problems.push('The offline files are not ready yet. Wait a few seconds, refresh the page once, and try again.');
    if (inAppBrowser()) problems.push('You are inside another app\u2019s browser (Facebook, Messenger, Instagram&hellip;). Tap its menu and choose <b>Open in Chrome</b> first.');
    const warn = problems.length ? '<h3>&#9888;&#65039; Why the button may not work</h3><ul>' + problems.map(p => `<li>${p}</li>`).join('') + '</ul>' : '';
    const tip = (!problems.length && isAndroid()) ? '<p class="you">Chrome decides when to offer the install. If the install window did not open, use <b>&#8942; menu &rarr; Install app</b>. If you only see <b>Add to Home screen</b>, tap that, then <b>Install</b>.</p>' : '';
    const order = isIos() ? ios + android + desktop : (isAndroid() ? android + desktop + ios : desktop + android + ios);
    steps.innerHTML = warn + tip + order;
    $('#installModal').hidden = false;
  }

  function setupInstall() {
    const btn = $('#installBtn');
    if (isStandalone()) return;
    btn.hidden = false;      // always visible: it installs when the browser allows it, otherwise it shows how
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredInstall = e;
    });
    window.addEventListener('appinstalled', () => { deferredInstall = null; btn.hidden = true; toast('\uD83C\uDF89 Installed! Look for the rainbow icon.'); });
    btn.addEventListener('click', async () => {
      if (deferredInstall) {
        const ev = deferredInstall;
        deferredInstall = null;
        try { ev.prompt(); await ev.userChoice; } catch (err) { installHelp(); }
      } else {
        installHelp();
      }
    });
    $('#installClose').addEventListener('click', () => { $('#installModal').hidden = true; });
    $('#installModal').addEventListener('click', e => { if (e.target.id === 'installModal') $('#installModal').hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#installModal').hidden = true; });
  }

  /* ---------- init ---------- */
  function init() {
    setupInstall();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works without offline mode */ });
    }
    $('#countNote').textContent = `${PICTURES.length} pictures to color`;
    renderChips();
    renderGrid();

    $('#search').addEventListener('input', e => { S.query = e.target.value; renderGrid(); });
    $('#toolBrush').addEventListener('click', () => setTool('brush'));
    $('#toolFill').addEventListener('click', () => setTool('fill'));
    $('#toolErase').addEventListener('click', () => setTool('erase'));
    $('#size').addEventListener('input', e => { S.size = +e.target.value; });
    $('#showNums').addEventListener('change', e => { S.showNums = e.target.checked; if (S.pic && S.ready) redrawNumbers(); });
    $('#undoBtn').addEventListener('click', undo);
    $('#clearBtn').addEventListener('click', clearAll);
    $('#magicBtn').addEventListener('click', showAnswer);
    $('#hintBtn').addEventListener('click', hint);
    $('#saveBtn').addEventListener('click', savePng);
    $('#prevBtn').addEventListener('click', () => step(-1));
    $('#nextBtn').addEventListener('click', () => step(1));
    $('#guideToggle').addEventListener('click', e => {
      const box = e.target.closest('.guide');
      const collapsed = box.classList.toggle('collapsed');
      e.target.textContent = collapsed ? 'Show' : 'Hide';
      e.target.setAttribute('aria-expanded', !collapsed);
    });
    document.addEventListener('keydown', e => {
      if (!S.pic || !S.ready) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (/^[1-9]$/.test(e.key) && +e.key <= S.palette.length) selectNumber(+e.key - 1);
    });
    window.addEventListener('resize', layout);
    window.addEventListener('beforeunload', persistNow);
    window.addEventListener('hashchange', route);
    route();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
