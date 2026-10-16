(function () {
  'use strict';

  /* ---------- small helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const THUMBS_KEY = 'rainbow-rub-thumbs-v3';

  const CRAYONS = [
    '#e63946', '#ff7a1a', '#ffb703', '#ffe066', '#c7e86b', '#9ad56b', '#3fae5a', '#1b7f4b',
    '#2ec4b6', '#8fd3f4', '#3a86ff', '#1d3a8a', '#8e5be8', '#c77dff', '#ff8fab', '#f06292',
    '#f4a6a6', '#ffd6a5', '#c97a2b', '#8d5a33', '#e9c88f', '#ffffff', '#9ca3af', '#222222'
  ];
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
    tool: 'brush', color: '#e63946', color32: toColor32('#e63946'), size: 18, neat: true,
    undo: [], cur: null, drawing: false, region: 0, last: null, dirty: null, unsaved: false, saveTimer: 0,
    refCanvas: null, loadToken: 0
  };
  const paintCv = $('#paintCv'), lineCv = $('#lineCv'), stage = $('#stage');
  const paintCtx = paintCv.getContext('2d');
  const lineCtx = lineCv.getContext('2d');

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

  /* ---------- colors ---------- */
  function buildPalette() {
    const pal = $('#palette');
    pal.innerHTML = '';
    CRAYONS.forEach(c => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.setProperty('--c', c);
      b.dataset.color = c;
      b.setAttribute('aria-label', 'Crayon ' + c);
      b.addEventListener('click', () => selectColor(c));
      pal.appendChild(b);
    });
  }
  function buildGuideColors() {
    const box = $('#guideColors');
    box.innerHTML = '';
    S.pic.colors.forEach(c => {
      const b = document.createElement('button');
      b.className = 'gc';
      b.style.setProperty('--c', c);
      b.dataset.color = c;
      b.setAttribute('aria-label', 'Picture color ' + c);
      b.addEventListener('click', () => selectColor(c));
      box.appendChild(b);
    });
  }
  function selectColor(hex) {
    hex = hex.toLowerCase();
    S.color = hex;
    S.color32 = toColor32(hex);
    if (S.tool === 'erase') setTool('brush');
    $$('.swatch, .gc').forEach(s => s.classList.toggle('active', s.dataset.color.toLowerCase() === hex));
    $('#currentSwatch').style.setProperty('--c', hex);
    try { $('#customColor').value = hex; } catch (e) { /* ignore */ }
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

  async function openPicture(id) {
    const pic = PICTURES.find(p => p.id === id);
    if (!pic) { location.hash = '#/'; return; }
    const token = ++S.loadToken;
    S.pic = pic;
    S.ready = false;
    S.undo = [];
    S.cur = null;
    S.drawing = false;
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
    buildGuideColors();
    selectColor(S.color);

    let data;
    try { data = await loadData(id); } catch (e) { toast('Could not load this picture.'); return; }
    if (token !== S.loadToken) return;

    const artImg = await loadImage(data.art);
    if (token !== S.loadToken) return;
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

    // line layer: dark pixels opaque, white pixels transparent
    paintCv.width = lineCv.width = W;
    paintCv.height = lineCv.height = H;
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

    S.paint = paintCtx.createImageData(W, H);
    S.p32 = new Uint32Array(S.paint.data.buffer);
    S.touched = new Uint32Array(N);
    S.strokeId = 0;
    S.dirty = null;
    S.unsaved = false;

    // bring back saved coloring
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
      } catch (e) { /* ignore broken save */ }
    }
    paintCtx.putImageData(S.paint, 0, 0);

    // color guide picture
    $('#refImg').src = data.ref;
    S.refCanvas = null;
    loadImage(data.ref).then(im => {
      if (token !== S.loadToken) return;
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0);
      S.refCanvas = c;
    }).catch(() => {});

    layout();
    S.ready = true;
    $('#loading').classList.add('hide');
    updateButtons();
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
    if (region === 0) return;
    const { W, H, lab, p32, touched } = S;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    const r2 = r * r;
    const nv = S.tool === 'erase' ? 0 : S.color32;
    const cur = S.cur;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * W + x;
        if (region !== -1 && lab[i] !== region) continue;
        const ov = p32[i];
        if (ov === nv) continue;
        if (touched[i] !== S.strokeId) { touched[i] = S.strokeId; cur.idx.push(i); cur.val.push(ov); }
        p32[i] = nv;
      }
    }
    markDirty(x0, y0, x1, y1);
  }

  function strokeTo(p) {
    const a = S.last, r = S.size;
    const dist = Math.hypot(p.x - a.x, p.y - a.y);
    const step = Math.max(1, r * 0.4);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let k = 1; k <= n; k++) {
      stamp(a.x + (p.x - a.x) * k / n, a.y + (p.y - a.y) * k / n, r, S.region);
    }
    S.last = p;
  }

  function beginStroke() {
    S.strokeId++;
    S.cur = { idx: [], val: [] };
  }
  function endStroke() {
    flush();
    const c = S.cur;
    S.cur = null;
    if (c && c.idx.length) {
      S.undo.push({ idx: Int32Array.from(c.idx), val: Uint32Array.from(c.val) });
      if (S.undo.length > 30) S.undo.shift();
      scheduleSave();
      updateButtons();
    }
  }

  function doFill(p) {
    const region = regionAt(p.x, p.y, 14);
    if (!region) return;
    const { lab, p32 } = S;
    const nv = S.color32;
    const idx = [], val = [];
    for (let i = 0; i < lab.length; i++) {
      if (lab[i] === region && p32[i] !== nv) { idx.push(i); val.push(p32[i]); p32[i] = nv; }
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
    if (S.tool === 'fill') { doFill(p); S.drawing = false; endStroke(); return; }
    S.region = S.neat ? regionAt(p.x, p.y, S.size + 12) : -1;
    S.last = p;
    stamp(p.x, p.y, S.size, S.region);
    flush();
  });
  lineCv.addEventListener('pointermove', e => {
    if (!S.drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (evs.length ? evs : [e]).forEach(ev => strokeTo(toImg(ev)));
    flush();
  });
  const stop = () => { if (S.drawing) { S.drawing = false; endStroke(); } };
  lineCv.addEventListener('pointerup', stop);
  lineCv.addEventListener('pointercancel', stop);

  /* ---------- tools ---------- */
  function applyPatch(patch) {
    // swap values so the same patch can undo and redo
    const { idx, val } = patch, p32 = S.p32;
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; const t = p32[i]; p32[i] = val[k]; val[k] = t; }
    paintCtx.putImageData(S.paint, 0, 0);
  }
  function undo() {
    const patch = S.undo.pop();
    if (!patch) return;
    applyPatch(patch);
    scheduleSave();
    updateButtons();
  }
  function clearAll() {
    const idx = [], val = [];
    for (let i = 0; i < S.p32.length; i++) if (S.p32[i] !== 0) { idx.push(i); val.push(S.p32[i]); S.p32[i] = 0; }
    if (!idx.length) return;
    S.undo.push({ idx: Int32Array.from(idx), val: Uint32Array.from(val) });
    paintCtx.putImageData(S.paint, 0, 0);
    scheduleSave();
    updateButtons();
    toast('Fresh page! Press Undo to get your coloring back.');
  }
  function magic() {
    const { lab, p32, W, H } = S;
    // the biggest region touching the border is the background: keep it white
    let bg = lab[0] || lab[W - 1] || lab[W * (H - 1)] || 0;
    const cols = S.pic.colors.map(toColor32);
    const pool = cols.length ? cols : CRAYONS.map(toColor32);
    const map = new Uint32Array(S.regions + 1);
    let n = Math.floor(Math.random() * pool.length);
    for (let r = 1; r <= S.regions; r++) { map[r] = pool[n % pool.length]; n += 1 + (r % 2); }
    const idx = [], val = [];
    for (let i = 0; i < lab.length; i++) {
      const r = lab[i];
      if (!r || r === bg) continue;
      const nv = map[r];
      if (p32[i] !== nv) { idx.push(i); val.push(p32[i]); p32[i] = nv; }
    }
    if (!idx.length) return;
    S.undo.push({ idx: Int32Array.from(idx), val: Uint32Array.from(val) });
    paintCtx.putImageData(S.paint, 0, 0);
    scheduleSave();
    updateButtons();
    toast('\u2728 Magic colors! Press it again for a new look.');
  }
  function updateButtons() { $('#undoBtn').disabled = S.undo.length === 0; }

  function pickFromRef(e) {
    const img = $('#refImg');
    if (!S.refCanvas) return;
    const r = img.getBoundingClientRect();
    const nw = S.refCanvas.width, nh = S.refCanvas.height;
    const sc = Math.min(r.width / nw, r.height / nh);
    const dw = nw * sc, dh = nh * sc;
    const ox = r.left + (r.width - dw) / 2, oy = r.top + (r.height - dh) / 2;
    const x = Math.floor((e.clientX - ox) / sc), y = Math.floor((e.clientY - oy) / sc);
    if (x < 0 || y < 0 || x >= nw || y >= nh) return;
    const d = S.refCanvas.getContext('2d').getImageData(x, y, 1, 1).data;
    selectColor(rgbToHex(d[0], d[1], d[2]));
    toast('Picked that color!');
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

  /* ---------- init ---------- */
  function init() {
    $('#countNote').textContent = `${PICTURES.length} pictures to color`;
    renderChips();
    buildPalette();
    renderGrid();

    $('#search').addEventListener('input', e => { S.query = e.target.value; renderGrid(); });
    $('#customColor').addEventListener('input', e => selectColor(e.target.value));
    $('#toolBrush').addEventListener('click', () => setTool('brush'));
    $('#toolFill').addEventListener('click', () => setTool('fill'));
    $('#toolErase').addEventListener('click', () => setTool('erase'));
    $('#size').addEventListener('input', e => { S.size = +e.target.value; });
    $('#neat').addEventListener('change', e => { S.neat = e.target.checked; });
    $('#undoBtn').addEventListener('click', undo);
    $('#clearBtn').addEventListener('click', clearAll);
    $('#magicBtn').addEventListener('click', magic);
    $('#saveBtn').addEventListener('click', savePng);
    $('#refBtn').addEventListener('click', pickFromRef);
    $('#prevBtn').addEventListener('click', () => step(-1));
    $('#nextBtn').addEventListener('click', () => step(1));
    $('#guideToggle').addEventListener('click', e => {
      const box = e.target.closest('.guide');
      const collapsed = box.classList.toggle('collapsed');
      e.target.textContent = collapsed ? 'Show' : 'Hide';
      e.target.setAttribute('aria-expanded', !collapsed);
    });
    document.addEventListener('keydown', e => {
      if (!S.pic) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });
    window.addEventListener('resize', layout);
    window.addEventListener('beforeunload', persistNow);
    window.addEventListener('hashchange', route);
    selectColor(S.color);
    route();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
