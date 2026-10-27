/* report.js: behaviour of the HTML report template.
   A page carries only content: <html data-doc-id>, <title>, report.css, this script and a <main>.
   This script builds the top bar, outline, collapsible sections, change marks since the last read (block and
   word diff against a baseline in localStorage), search, figure lightbox, code copy buttons, question controls
   and the review layer (text comments, element picker, general notes, answers, Markdown export (Cmd+Shift+X),
   Vim keys in every review text box, on by default, single-key shortcuts n c ? ] [ d and an in-page
   confirmation dialog).
   Vanilla JS, no dependencies; works from file:// and inlined by bundle.py.
   Load it from <head> without defer: the theme is then set before the first paint, and everything
   else waits for DOMContentLoaded anyway.
   ?theme=dark or ?theme=light in the URL forces a mode without storing it. */
(function () {
  'use strict';
  var root = document.documentElement;

  /* ---------- Theme before the first paint (when loaded without defer): ?theme= wins, then the stored toggle, then the OS ---------- */
  (function () {
    var t = null, src = 'os';
    try {
      var m = /[?&]theme=(light|dark)\b/.exec(location.search);
      if (m) { t = m[1]; src = 'url'; }
      else { t = localStorage.getItem('bn-theme'); if (t) src = 'stored'; }
    } catch (e) {}
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      src = 'os';
    }
    root.setAttribute('data-theme', t);
    root.setAttribute('data-theme-src', src);
  })();

  /* ---------- Shared helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function ui(n) { n.setAttribute('data-bn-ui', ''); return n; }
  /* Storage key of the page: data-doc-id, else the file path; the skeleton's placeholder never keys storage. */
  function docIdOf() {
    var path = location.pathname || '';
    var base = (decodeURIComponent(path.split('/').pop() || '') || 'document').replace(/\.x?html?$/i, '') || 'document';
    var id = root.getAttribute('data-doc-id');
    return (!id || id === 'report-slug') ? (path || base) : id;
  }
  function editable(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  }

  /* ---------- In-page dialog in place of window.confirm: palette styles, focus kept inside, Esc and a backdrop click cancel ---------- */
  var modal = null, dlgSeq = 0;
  function dialog(o) {
    if (modal) modal.close(o.cancel);
    var prev = document.activeElement, done = false;
    var wrap = ui(el('div', 'bn-modal'));
    var box = el('div', 'bn-dialog' + (o.cls ? ' ' + o.cls : ''));
    var id = 'bn-dlg-' + (++dlgSeq);
    box.setAttribute('role', o.role || 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', id + '-t');
    box.setAttribute('aria-describedby', id + '-b');
    var h = el('h2', 'bn-notoc bn-dialog-t', o.title);
    h.id = id + '-t';
    var body = el('div', 'bn-dialog-b');
    body.id = id + '-b';
    (o.body || []).forEach(function (n) { body.appendChild(typeof n === 'string' ? el('p', null, n) : n); });
    var row = el('div', 'bn-dialog-row'), btns = [], first = null;
    (o.buttons || [{ label: 'Close', value: o.cancel }]).forEach(function (b) {
      var x = el('button', 'anno-btn' + (b.cls ? ' ' + b.cls : ''), b.label);
      x.type = 'button';
      x.addEventListener('click', function () { close(b.value); });
      row.appendChild(x); btns.push(x);
      if (b.focus) first = x;
    });
    first = first || btns[0];
    box.appendChild(h); box.appendChild(body); box.appendChild(row);
    wrap.appendChild(box);
    function onKey(e) {
      /* Capture phase on document: no page shortcut or Vim key runs while the dialog is open. */
      e.stopPropagation();
      if (e.key === 'Escape' || (o.toggleKey && e.key === o.toggleKey)) { e.preventDefault(); close(o.cancel); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        var i = btns.indexOf(document.activeElement);
        var j = i === -1 ? (e.shiftKey ? btns.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length;
        btns[j].focus();
      }
    }
    function onFocus(e) { if (!box.contains(e.target)) first.focus({ preventScroll: true }); }
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) e.preventDefault(); });
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(o.cancel); });
    function close(v) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      modal = null;
      if (prev && prev !== document.body && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
      if (o.onClose) o.onClose(v);
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    document.body.appendChild(wrap);
    first.focus({ preventScroll: true });
    modal = { close: close, box: box, wrap: wrap, buttons: btns };
    return modal;
  }
  var ICON = {
    toc: '<svg class="i" viewBox="0 0 24 24"><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/></svg>',
    search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    up: '<svg class="i" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg class="i" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    fold: '<svg class="i" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    filter: '<svg class="i" viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>',
    sun: '<svg class="i sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    moon: '<svg class="i moon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    pick: '<svg class="i" viewBox="0 0 24 24"><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h2"/><path d="M14 3h1"/><path d="M3 9v1"/><path d="M21 9v2"/><path d="M3 14v1"/><path d="m12 12 4 10 1.7-4.3L22 16Z"/></svg>',
    comment: '<svg class="i" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    question: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    close: '<svg class="i" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    copy: '<svg class="i" viewBox="0 0 24 24"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M16 4h2a2 2 0 0 1 2 2v4"/><path d="M21 14H11"/><path d="m15 10-4 4 4 4"/></svg>',
    trash: '<svg class="i" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    diff: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/></svg>',
    read: '<svg class="i" viewBox="0 0 24 24"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg>'
  };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  /* Revision of a page: FNV-1a hash of <main> as written, taken before any decoration */
  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  ready(function () {
    var main = document.querySelector('main');
    if (!main || root.hasAttribute('data-bn-ready')) return;
    root.setAttribute('data-bn-ready', '');
    var rev = hashStr(main.innerHTML);
    buildChrome(main);
    var page = setupPage(main, rev);
    setupReview(main, page, rev);
  });

  /* ================= Chrome: skip link, top bar, layout, outline, lightbox ================= */
  function buildChrome(main) {
    var body = document.body;
    if (!main.id) main.id = 'content';
    main.classList.add('bn-main');
    var skip = ui(el('a', 'bn-skip', 'Skip to content'));
    skip.href = '#' + main.id;
    var bar = ui(el('header', 'bn-bar'));
    bar.id = 'top';
    bar.innerHTML =
      '<div class="bn-bar-in">' +
      '<button class="bn-btn bn-toc-btn" id="bn-toc-btn" type="button" aria-label="Contents" aria-expanded="false" title="Contents">' + ICON.toc + '</button>' +
      '<div class="bn-doc"><a class="bn-doc-title" id="bn-doc-title" href="#top" title="Back to top"></a><span class="bn-doc-sec" id="bn-doc-sec"></span></div>' +
      '<div class="bn-search" id="bn-search" role="search">' + ICON.search +
      '<input id="bn-q" type="search" placeholder="Search this page" autocomplete="off" spellcheck="false" aria-label="Search this page">' +
      '<kbd>/</kbd><span class="bn-q-ctl"><span class="bn-count" id="bn-count" aria-live="polite"></span>' +
      '<button class="bn-btn" id="bn-prev" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match">' + ICON.up + '</button>' +
      '<button class="bn-btn" id="bn-next" type="button" title="Next match (Enter)" aria-label="Next match">' + ICON.down + '</button>' +
      '<button class="bn-btn" id="bn-filter" type="button" aria-pressed="false" title="Show only matching rows and entries" aria-label="Filter to matches">' + ICON.filter + '</button>' +
      '</span></div>' +
      '<span class="bn-chg" id="bn-chg" hidden>' +
      '<button class="bn-btn bn-chg-tog" id="bn-chg-tog" type="button" aria-pressed="true" title="Show or hide the changes since you last read this page (d)">' + ICON.diff + '<span class="n" id="bn-chg-n"></span></button>' +
      '<button class="bn-btn bn-chg-step" id="bn-chg-prev" type="button" title="Previous change ([)" aria-label="Previous change">' + ICON.up + '</button>' +
      '<button class="bn-btn bn-chg-step" id="bn-chg-next" type="button" title="Next change (])" aria-label="Next change">' + ICON.down + '</button>' +
      '<button class="bn-btn bn-chg-read" id="bn-chg-read" type="button" title="Mark this version as read: the marks go away and the next revision is compared against this one" aria-label="Mark as read">' + ICON.read + '</button>' +
      '</span>' +
      '<button class="bn-btn bn-pick" id="bn-pick" type="button" aria-pressed="false" title="Comment on an element (Cmd+Shift+E)">' + ICON.pick + '<span class="lbl">Pick</span></button>' +
      '<button class="bn-btn bn-comments" id="bn-comments" type="button" aria-pressed="false" title="Comments, notes and export (c)">' + ICON.comment + '<span class="n" id="bn-comments-n">0</span><span class="bn-qcount" id="bn-q-wrap" hidden>' + ICON.question + '<span class="n" id="bn-q-n">0/0</span></span></button>' +
      '<button class="bn-btn bn-export" id="bn-export" type="button" aria-label="Export Markdown" title="Export comments, answers and notes as Markdown to the clipboard (Cmd+Shift+X)">' + ICON.copy + '</button>' +
      '<button class="bn-btn bn-clear" id="bn-clear" type="button" aria-label="Clear all" title="Clear all comments, answers and notes on this page">' + ICON.trash + '</button>' +
      '<button class="bn-btn bn-vim" id="bn-vim" type="button" aria-pressed="false" aria-label="Vim keys" title="Vim keys in comment boxes, answers and general notes">Vim</button>' +
      '<button class="bn-btn bn-theme" id="bn-theme" type="button" title="Toggle light or dark mode" aria-label="Toggle light or dark mode">' + ICON.sun + ICON.moon + '</button>' +
      '</div>';
    var layout = ui(el('div', 'bn-layout'));
    var toc = ui(el('nav', 'bn-toc'));
    toc.id = 'bn-toc';
    toc.setAttribute('aria-label', 'Contents');
    toc.innerHTML = '<p class="bn-toc-h">Contents</p><ol id="bn-toc-list"></ol>';
    main.parentNode.insertBefore(layout, main);
    layout.appendChild(toc);
    layout.appendChild(main);
    body.insertBefore(bar, body.firstChild);
    body.insertBefore(skip, bar);
    var lb = ui(el('div', 'bn-lightbox'));
    lb.id = 'bn-lightbox';
    lb.hidden = true;
    body.appendChild(lb);
  }

  /* ================= Changes since the last read: block and word diff against a stored baseline ================= */
  /* The baseline is the page text as last read in this browser (an export or Mark read); a first visit stores one
     silently. Every paragraph, list item, row and similar block is compared with it: a changed block marks inserted
     words and shows deleted ones struck through, a new block gets a green bar, removed blocks a red chip. Deleted
     text sits in data-bn-ui elements and insertions in inline marks, so the revision hash, comment anchors and the
     export still see the page as written. Runs on the clean page, before setupPage adds wrappers and controls. */
  function setupChanges(main, rev, links, nav) {
    var BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, tr, pre, blockquote, figcaption, summary, caption, label, ' +
      '.kpi, .callout, .card, div, section, details, figure';
    var SKIPTXT = 'script, style, svg, textarea, noscript, [data-bn-ui], .bn-del';
    var BKEY = 'bn-read:' + docIdOf(), LKEY = 'bn-read-lru', KEEP = 40;
    var WORD = /[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu, WORDONLY = /[\p{L}\p{N}_]+/gu;
    var body = document.body, group = $('bn-chg'), tog = $('bn-chg-tog'), cnt = $('bn-chg-n');
    var stops = [], cur = -1, on = true, items = [], marked = [], pop = null, collapse = false;

    /* ---------- Storage: one baseline per page, the 40 most recently opened kept ---------- */
    function readJson(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
    function lru() { var l = readJson(LKEY); return (l && typeof l === 'object') ? l : {}; }
    function evictOldest(l) {
      var ids = Object.keys(l).filter(function (k) { return 'bn-read:' + k !== BKEY; });
      if (!ids.length) return false;
      ids.sort(function (a, b) { return l[a] - l[b]; });
      try { localStorage.removeItem('bn-read:' + ids[0]); } catch (e) {}
      delete l[ids[0]];
      return true;
    }
    function touch() {
      var l = lru();
      l[BKEY.slice(8)] = Date.now();
      while (Object.keys(l).length > KEEP && evictOldest(l)) {}
      try { localStorage.setItem(LKEY, JSON.stringify(l)); } catch (e) {}
    }
    function saveBase(v) {
      var s = JSON.stringify(v), l = lru();
      for (var k = 0; k < 12; k++) {
        try { localStorage.setItem(BKEY, s); break; } catch (e) { if (!evictOldest(l)) break; }
      }
      try { localStorage.setItem(LKEY, JSON.stringify(l)); } catch (e) {}
      touch();
    }

    /* ---------- Blocks: own text of each block, whitespace collapsed, with a map back to the text nodes ---------- */
    var inl = new Map();
    function boxOf(n, b) {
      while (n && n !== b) {
        var d = inl.get(n);
        if (d === undefined) { d = /^inline/.test(getComputedStyle(n).display); inl.set(n, d); }
        if (!d) return n;
        n = n.parentNode;
      }
      return b;
    }
    function feed(m, t) {
      var s = t.nodeValue, box = boxOf(t.parentNode, m.el), i, ch;
      if (m.last && box !== m.last && !m.sp) { m.str += ' '; m.nodes.push(null); m.offs.push(0); m.sp = true; }
      m.last = box;
      for (i = 0; i < s.length; i++) {
        ch = s.charAt(i);
        if (/\s/.test(ch)) { if (m.sp) continue; m.str += ' '; m.sp = true; }
        else { m.str += ch; m.sp = false; }
        m.nodes.push(t); m.offs.push(i);
      }
    }
    function extract() {
      var out = [], byEl = new Map(), t, p, sk, b, m;
      var w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null, false);
      while ((t = w.nextNode())) {
        p = t.parentNode;
        if (!p || !p.closest) continue;
        sk = p.closest(SKIPTXT);
        if (sk && main.contains(sk)) continue;
        b = p.closest(BLOCK);
        if (!b || !main.contains(b)) b = main;
        m = byEl.get(b);
        if (!m) {
          m = { el: b, tag: b.tagName.toLowerCase(), str: '', nodes: [], offs: [], sp: true, last: null };
          byEl.set(b, m); out.push(m);
        }
        feed(m, t);
      }
      return out.filter(function (x) {
        while (x.str.charAt(x.str.length - 1) === ' ') { x.str = x.str.slice(0, -1); x.nodes.pop(); x.offs.pop(); }
        return !!x.str;
      });
    }
    function tokens(s) {
      var out = [], m;
      WORD.lastIndex = 0;
      while ((m = WORD.exec(s))) out.push({ t: m[0], s: m.index, e: m.index + m[0].length });
      return out;
    }

    /* ---------- Diff: LCS with common prefix and suffix trimmed; null middle when it would be too large ---------- */
    function lcs(a, b, limit) {
      var n = a.length, m = b.length, s = 0, head = [], tail = [], mid = [], e1 = n, e2 = m, i, j;
      while (s < n && s < m && a[s] === b[s]) { head.push([s, s]); s++; }
      while (e1 > s && e2 > s && a[e1 - 1] === b[e2 - 1]) { e1--; e2--; tail.unshift([e1, e2]); }
      var N = e1 - s, M = e2 - s, big = false;
      if (N && M) {
        if (N * M > limit) big = true;
        else {
          var W = M + 1, dp = new Uint16Array((N + 1) * W);
          for (i = N - 1; i >= 0; i--) {
            for (j = M - 1; j >= 0; j--) {
              dp[i * W + j] = a[s + i] === b[s + j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
            }
          }
          i = 0; j = 0;
          while (i < N && j < M) {
            if (a[s + i] === b[s + j]) { mid.push([s + i, s + j]); i++; j++; }
            else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
            else j++;
          }
        }
      }
      return { pairs: head.concat(mid, tail), big: big, s: s, e1: e1, e2: e2 };
    }
    function interner() {
      var ids = new Map();
      return function (k) { var v = ids.get(k); if (!v) { v = ids.size + 1; ids.set(k, v); } return v; };
    }
    function bag(s) {
      var m = new Map(), n = 0;
      (s.toLowerCase().match(WORDONLY) || []).forEach(function (w) { m.set(w, (m.get(w) || 0) + 1); n++; });
      return { m: m, n: n };
    }
    function dice(x, y) {
      var A = bag(x), B = bag(y), c = 0;
      if (!A.n || !B.n) return x === y ? 1 : 0;
      A.m.forEach(function (v, k) { var u = B.m.get(k); if (u) c += Math.min(u, v); });
      return 2 * c / (A.n + B.n);
    }
    /* Block alignment of any size: exact LCS while the middle stays small, else patience anchors (blocks that
       occur once on each side, longest increasing run) and the same again between consecutive anchors. */
    function align(a, b, s1, e1, s2, e2, out) {
      while (s1 < e1 && s2 < e2 && a[s1] === b[s2]) { out.push([s1, s2]); s1++; s2++; }
      var tail = [];
      while (e1 > s1 && e2 > s2 && a[e1 - 1] === b[e2 - 1]) { e1--; e2--; tail.unshift([e1, e2]); }
      if (e1 > s1 && e2 > s2) {
        if ((e1 - s1) * (e2 - s2) <= 4e6) {
          lcs(a.slice(s1, e1), b.slice(s2, e2), Infinity).pairs.forEach(function (p) { out.push([p[0] + s1, p[1] + s2]); });
        } else {
          var ca = new Map(), cb = new Map(), at = new Map(), x, j;
          for (x = s1; x < e1; x++) { ca.set(a[x], (ca.get(a[x]) || 0) + 1); at.set(a[x], x); }
          for (j = s2; j < e2; j++) cb.set(b[j], (cb.get(b[j]) || 0) + 1);
          var cand = [];
          for (j = s2; j < e2; j++) if (ca.get(b[j]) === 1 && cb.get(b[j]) === 1) cand.push([at.get(b[j]), j]);
          /* longest run of candidates increasing on the old side, patience sorting */
          var piles = [], back = [];
          cand.forEach(function (c, k) {
            var lo = 0, hi = piles.length;
            while (lo < hi) { var mid = (lo + hi) >> 1; if (cand[piles[mid]][0] < c[0]) lo = mid + 1; else hi = mid; }
            back[k] = lo ? piles[lo - 1] : -1;
            piles[lo] = k;
          });
          var chain = [];
          for (var k = piles.length ? piles[piles.length - 1] : -1; k >= 0; k = back[k]) chain.unshift(cand[k]);
          var px = s1, py = s2;
          chain.forEach(function (c) {
            align(a, b, px, c[0], py, c[1], out);
            out.push(c);
            px = c[0] + 1; py = c[1] + 1;
          });
          /* no anchor left: the gap stays unaligned and its blocks show as removed and new */
          if (chain.length) align(a, b, px, e1, py, e2, out);
        }
      }
      tail.forEach(function (p) { out.push(p); });
      return out;
    }
    /* Block level: status[j] is 'mod' or 'new' (else unchanged); removed groups sit after a new block index. */
    function diffBlocks(old, now) {
      var id = interner(), status = [], oldOf = [], removed = [];
      var a = old.map(function (o) { return id(o[0] + '|' + o[1]); });
      var b = now.map(function (c) { return id(c.tag + '|' + c.str); });
      var pairs = align(a, b, 0, a.length, 0, b.length, []);
      function gap(o0, o1, n0, n1) {
        var k = o0, rem = [], j, x, hit;
        var pairing = (o1 - o0) * (n1 - n0) <= 40000;
        for (j = n0; j < n1; j++) {
          hit = -1;
          if (pairing) {
            for (x = k; x < o1; x++) {
              if (old[x][0] === now[j].tag && dice(old[x][1], now[j].str) >= 0.4) { hit = x; break; }
            }
          }
          if (hit < 0) { status[j] = 'new'; continue; }
          for (x = k; x < hit; x++) rem.push(x);
          if (rem.length) { removed.push({ after: j - 1, items: rem }); rem = []; }
          status[j] = 'mod'; oldOf[j] = hit; k = hit + 1;
        }
        for (x = k; x < o1; x++) rem.push(x);
        if (rem.length) removed.push({ after: n1 - 1, items: rem });
      }
      var pi = -1, pj = -1;
      pairs.concat([[a.length, b.length]]).forEach(function (p) {
        gap(pi + 1, p[0], pj + 1, p[1]);
        pi = p[0]; pj = p[1];
      });
      return { status: status, oldOf: oldOf, removed: removed };
    }
    /* Word level inside a changed block: inserted ranges and deleted runs, positions in the new block string. */
    function wordOps(oldStr, m) {
      var to = tokens(oldStr), tn = tokens(m.str), id = interner();
      var r = lcs(to.map(function (t) { return id(t.t); }), tn.map(function (t) { return id(t.t); }), 1e6);
      var ops = [], pi = -1, pj = -1;
      r.pairs.concat([[to.length, tn.length]]).forEach(function (p) {
        var o0 = pi + 1, o1 = p[0], n0 = pj + 1, n1 = p[1];
        pi = p[0]; pj = p[1];
        if (n1 > n0) ops.push({ k: 'ins', at: tn[n0].s, e: tn[n1 - 1].e });
        if (o1 <= o0) return;
        var txt = oldStr.slice(to[o0].s, to[o1 - 1].e);
        /* next to an insertion: before it, or after it when the insertion clings to the previous word ("Kim, and") */
        if (n1 > n0 && n0 > 0 && tn[n0 - 1].e === tn[n0].s) ops.push({ k: 'del', at: tn[n1 - 1].e, txt: txt, pre: true });
        else if (n1 > n0) ops.push({ k: 'del', at: tn[n0].s, txt: txt, post: true });
        else if (o0 > 0 && n0 > 0 && to[o0 - 1].e === to[o0].s) ops.push({ k: 'del', at: tn[n0 - 1].e, txt: txt });
        else if (n1 < tn.length) ops.push({ k: 'del', at: tn[n1].s, txt: txt, post: true });
        else ops.push({ k: 'del', at: m.str.length, txt: txt, pre: true });
      });
      return ops;
    }

    /* ---------- Decoration ---------- */
    function wrapIns(m, s, e) {
      var segs = [], j = s;
      while (j < e) {
        var n = m.nodes[j];
        if (!n) { j++; continue; }
        var a = m.offs[j], z = a;
        while (j + 1 < e && m.nodes[j + 1] === n) { j++; z = m.offs[j]; }
        segs.push([n, a, z + 1]); j++;
      }
      for (var g = segs.length - 1; g >= 0; g--) {
        var node = segs[g][0], mid = node;
        if (segs[g][1] > 0) mid = node.splitText(segs[g][1]);
        if (mid.nodeValue.length > segs[g][2] - segs[g][1]) mid.splitText(segs[g][2] - segs[g][1]);
        var mk = el('mark', 'bn-ins');
        mid.parentNode.insertBefore(mk, mid);
        mk.appendChild(mid);
      }
    }
    function insertDel(m, p, op) {
      var d = ui(el('del', 'bn-del')), t = null, o = 0, k;
      if (op.pre) d.appendChild(document.createTextNode(' '));
      d.appendChild(el('span', 'bn-del-t', op.txt));
      if (op.post) d.appendChild(document.createTextNode(' '));
      if (p >= m.nodes.length) {
        for (k = m.nodes.length - 1; k >= 0 && !t; k--) { if (m.nodes[k]) { t = m.nodes[k]; o = m.offs[k] + 1; } }
      } else {
        for (k = p; k < m.nodes.length && !t; k++) { if (m.nodes[k]) { t = m.nodes[k]; o = m.offs[k]; } }
      }
      if (!t) { m.el.appendChild(d); return; }
      var par = t.parentNode;
      if (o <= 0) {
        /* the node itself moved into an insertion mark: the deletion goes before that mark */
        if (par.classList && par.classList.contains('bn-ins') && par.firstChild === t) par.parentNode.insertBefore(d, par);
        else par.insertBefore(d, t);
      } else if (o >= t.nodeValue.length) par.insertBefore(d, t.nextSibling);
      else par.insertBefore(d, t.splitText(o));
    }
    function decorate(m, ops) {
      ops.sort(function (x, y) { return y.at - x.at || (x.k === 'ins' ? -1 : 1); });
      ops.forEach(function (op) { if (op.k === 'ins') wrapIns(m, op.at, op.e); else insertDel(m, op.at, op); });
    }

    /* ---------- Gutter: bars beside changed and new blocks, chips where blocks were removed ---------- */
    var gutter = ui(el('div', 'bn-chgbars'));
    body.appendChild(gutter);
    function bar(e, kind) {
      var d = el('div', 'bn-chgbar ' + kind);
      gutter.appendChild(d);
      items.push({ el: e, d: d, kind: kind });
      marked.push(e);
    }
    function chip(anchor, below, texts) {
      var b = el('button', 'bn-chgrm', '\u2212');
      b.type = 'button';
      b.title = texts.length === 1 ? 'Removed text: click to read it' : texts.length + ' removed blocks: click to read them';
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', function (e) { e.stopPropagation(); if (pop && pop._for === b) closePop(); else openPop(b, texts); });
      gutter.appendChild(b);
      items.push({ el: anchor, d: b, kind: 'rm', below: below });
      marked.push(anchor);
      return b;
    }
    function place() {
      if (!items.length) return;
      var sx = window.pageXOffset, sy = window.pageYOffset, x = main.getBoundingClientRect().left + sx - 8;
      items.forEach(function (it) {
        var show = on && it.el.getClientRects().length > 0;
        it.d.hidden = !show;
        if (!show) return;
        var r = it.el.getBoundingClientRect();
        if (it.kind === 'rm') {
          it.d.style.left = (x - 6) + 'px';
          it.d.style.top = ((it.below ? r.bottom : r.top) + sy - 7) + 'px';
        } else {
          it.d.style.left = x + 'px';
          it.d.style.top = (r.top + sy) + 'px';
          it.d.style.height = Math.max(r.height, 6) + 'px';
        }
      });
      if (pop) placePop();
    }
    var placing = false;
    function schedule() {
      if (placing) return;
      placing = true;
      requestAnimationFrame(function () { placing = false; place(); });
    }
    function openPop(b, texts) {
      closePop();
      pop = ui(el('div', 'bn-chg-pop'));
      pop._for = b;
      pop.appendChild(el('p', 'h', texts.length === 1 ? 'Removed' : 'Removed, ' + texts.length + ' blocks'));
      texts.forEach(function (t) { pop.appendChild(el('p', 'x', clip(t, 800))); });
      body.appendChild(pop);
      placePop();
    }
    function placePop() {
      var r = pop._for.getBoundingClientRect(), sx = window.pageXOffset, sy = window.pageYOffset;
      var vw = document.documentElement.clientWidth, w = pop.offsetWidth;
      pop.style.left = Math.max(sx + 8, Math.min(r.right + sx + 6, sx + vw - w - 8)) + 'px';
      pop.style.top = (r.bottom + sy + 4) + 'px';
    }
    function closePop() { if (pop) { pop.parentNode.removeChild(pop); pop = null; } }

    /* ---------- Stops, outline counts, navigation, toggle ---------- */
    function linkFor(n) {
      var best = null;
      for (var i = 0; i < links.length; i++) {
        var h = links[i]._head, pos = h.compareDocumentPosition(n);
        if (h === n || (pos & 4) || (pos & 16)) best = links[i]; else break;
      }
      return best;
    }
    function counts() {
      links.forEach(function (a) { a._chg = 0; });
      stops.forEach(function (s) { var a = linkFor(s.el); if (a) a._chg++; });
      links.forEach(function (a) {
        var c = a.querySelector('.c');
        if (!a._chg) { if (c) c.parentNode.removeChild(c); return; }
        if (!c) { c = el('span', 'c'); a.insertBefore(c, a.lastChild); }
        c.textContent = String(a._chg);
        c.title = a._chg + (a._chg === 1 ? ' change' : ' changes') + ' since your last read';
      });
    }
    function render() {
      group.hidden = !stops.length;
      tog.setAttribute('aria-pressed', on ? 'true' : 'false');
      cnt.textContent = (on && cur >= 0 ? (cur + 1) + '/' : '') + stops.length;
      tog.setAttribute('aria-label', (on ? 'Hide' : 'Show') + ' ' + stops.length + (stops.length === 1 ? ' change' : ' changes') + ' since your last read');
    }
    function setOn(v) {
      on = !!v;
      body.classList.toggle('bn-diff-off', !on);
      if (!on) closePop();
      render(); place();
    }
    function go(i) {
      if (!stops.length) return;
      if (!on) setOn(true);
      cur = (i + stops.length) % stops.length;
      var s = stops[cur], t = s.el;
      var det = t.closest('details');
      while (det) { det.open = true; det = det.parentNode.closest ? det.parentNode.closest('details') : null; }
      nav.reveal(t);
      t.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (s.els || [t]).concat(s.chip ? [s.chip] : []).forEach(function (e) {
        e.classList.remove('bn-chg-flash'); void e.offsetWidth; e.classList.add('bn-chg-flash');
      });
      render(); place();
    }
    function clear() {
      closePop();
      [].slice.call(main.querySelectorAll('del.bn-del')).forEach(function (d) { d.parentNode.removeChild(d); });
      [].slice.call(main.querySelectorAll('mark.bn-ins')).forEach(function (mk) {
        var p = mk.parentNode;
        while (mk.firstChild) p.insertBefore(mk.firstChild, mk);
        p.removeChild(mk);
      });
      [].slice.call(main.querySelectorAll('.bn-chg-mod, .bn-chg-new')).forEach(function (e) { e.classList.remove('bn-chg-mod', 'bn-chg-new'); });
      gutter.textContent = '';
      items = []; marked = []; stops = []; cur = -1; collapse = false;
      body.classList.remove('bn-diff-off'); on = true;
      counts(); render();
    }

    tog.addEventListener('click', function () { setOn(!on); });
    $('bn-chg-next').addEventListener('click', function () { go(cur + 1); });
    $('bn-chg-prev').addEventListener('click', function () { go(cur < 0 ? -1 : cur - 1); });
    $('bn-chg-read').addEventListener('click', function () { api.markRead(); });
    document.addEventListener('keydown', function (e) {
      if (!stops.length || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || editable(e.target)) return;
      if (e.key === ']') { e.preventDefault(); go(cur + 1); }
      else if (e.key === '[') { e.preventDefault(); go(cur < 0 ? -1 : cur - 1); }
      else if (e.key === 'd') { e.preventDefault(); if (!e.repeat) setOn(!on); }
      else if (e.key === 'Escape') closePop();
    });
    document.addEventListener('mousedown', function (e) {
      if (pop && !pop.contains(e.target) && e.target !== pop._for) closePop();
    });
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', function (e) { if (e.target !== document) schedule(); }, true);
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(main);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

    var now = extract();
    var nowBlocks = now.map(function (m) { return [m.tag, m.str]; });
    var api = {
      place: place,
      /* true when the baseline was a real read and a section without changes should open collapsed */
      collapseUnchanged: function () { return collapse; },
      touches: function (nodes) {
        return marked.some(function (e) { return nodes.some(function (n) { return n === e || n.contains(e); }); });
      },
      markRead: function () { saveBase({ rev: rev, at: Date.now(), src: 'read', blocks: nowBlocks }); clear(); },
      next: function () { go(cur + 1); },
      prev: function () { go(cur < 0 ? -1 : cur - 1); },
      show: setOn,
      state: function () {
        return { stops: stops.map(function (s) { return s.kind; }), cur: cur, on: on, collapse: collapse,
                 base: (readJson(BKEY) || {}).src || null };
      }
    };
    var base = readJson(BKEY);
    if (!base || !(base.blocks instanceof Array)) {
      saveBase({ rev: rev, at: Date.now(), src: 'first', blocks: nowBlocks });
      render();
      return api;
    }
    touch();
    if (base.rev === rev) { render(); return api; }

    var old = base.blocks, d = diffBlocks(old, now), rmAt = {};
    d.removed.forEach(function (g) { (rmAt[g.after] = rmAt[g.after] || []).push(g); });
    function pushRemoved(after) {
      (rmAt[after] || []).forEach(function (g) {
        var below = after >= 0, anchor = below ? now[after].el : (now[0] ? now[0].el : main);
        var texts = g.items.map(function (x) { return old[x][1]; });
        stops.push({ kind: 'removed', el: anchor, chip: chip(anchor, below, texts) });
      });
    }
    pushRemoved(-1);
    now.forEach(function (m, j) {
      var st = d.status[j];
      if (st === 'mod') {
        var ops = wordOps(old[d.oldOf[j]][1], m);
        if (ops.length) {
          decorate(m, ops);
          m.el.classList.add('bn-chg-mod');
          bar(m.el, 'mod');
          stops.push({ kind: 'changed', el: m.el });
        }
      } else if (st === 'new') {
        m.el.classList.add('bn-chg-new');
        bar(m.el, 'new');
        var last = stops[stops.length - 1];
        if (last && last.kind === 'new' && last.end === j - 1) { last.els.push(m.el); last.end = j; }
        else stops.push({ kind: 'new', el: m.el, els: [m.el], end: j });
      }
      pushRemoved(j);
    });
    collapse = base.src === 'read' && stops.length > 0;
    counts(); render(); place();
    return api;
  }

  /* ================= Page: theme toggle, outline, tables, code, figures, search ================= */
  function setupPage(main, rev) {
    function textOf(e) {
      var c = e.cloneNode(true);
      [].slice.call(c.querySelectorAll('.badge, [data-bn-ui]')).forEach(function (b) { b.parentNode.removeChild(b); });
      return norm(c.textContent);
    }

    /* Theme */
    $('bn-theme').addEventListener('click', function () {
      var t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', t);
      root.setAttribute('data-theme-src', 'stored');
      try { localStorage.setItem('bn-theme', t); } catch (e) {}
    });
    if (window.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: dark)');
      var onOs = function () {
        if (root.getAttribute('data-theme-src') === 'os') root.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onOs); else if (mq.addListener) mq.addListener(onOs);
    }

    /* Title in the bar, doubling as the back-to-top link */
    var h1 = main.querySelector('h1');
    $('bn-doc-title').textContent = norm(document.title) || (h1 ? textOf(h1) : 'Top');

    /* Heading ids */
    var used = {};
    [].slice.call(document.querySelectorAll('[id]')).forEach(function (e) { used[e.id] = true; });
    function slug(s) {
      var b = s.toLowerCase();
      if (b.normalize) b = b.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      b = b.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
      var id = b, k = 2;
      while (used[id]) id = b + '-' + (k++);
      used[id] = true;
      return id;
    }
    var heads = [].slice.call(main.querySelectorAll('h2, h3')).filter(function (h) {
      return !h.closest('.callout, .kpi, figure, .card, details, .question, .bn-notoc') && !h.classList.contains('bn-notoc');
    });
    heads.forEach(function (h) { if (!h.id) h.id = slug(textOf(h)); });

    /* Outline */
    var tocList = $('bn-toc-list'), toc = $('bn-toc'), links = [], linkOf = {};
    var curLi = null, curSub = null;
    heads.forEach(function (h) {
      var li = el('li'), a = el('a');
      a.href = '#' + h.id;
      a.appendChild(el('span', 't', textOf(h)));
      a.appendChild(el('span', 'h'));
      li.appendChild(a);
      if (h.tagName === 'H2' || !curLi) { tocList.appendChild(li); curLi = li; curSub = null; }
      else {
        if (!curSub) { curSub = el('ol'); curLi.appendChild(curSub); }
        curSub.appendChild(li);
      }
      a._head = h; a._li = li; a._top = curLi;
      links.push(a); linkOf[h.id] = a;
    });
    if (!links.length) toc.hidden = true;

    /* Changes since the last read: on the clean page, before wrappers and controls go in */
    var changes = setupChanges(main, rev, links, { reveal: function (n) { return reveal(n); } });

    var tocBtn = $('bn-toc-btn');
    function tocOpen(open) {
      document.body.classList.toggle('bn-toc-open', open);
      tocBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    tocBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      tocOpen(!document.body.classList.contains('bn-toc-open'));
    });
    toc.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a) return;
      if (a._head) reveal(a._head);
      tocOpen(false);
    });
    document.addEventListener('click', function (e) {
      if (document.body.classList.contains('bn-toc-open') && !toc.contains(e.target)) tocOpen(false);
    });

    /* Scroll spy */
    var secLabel = $('bn-doc-sec'), active = null, ticking = false;
    function barH() { var b = document.querySelector('.bn-bar'); return b ? b.offsetHeight : 56; }
    function spy() {
      ticking = false;
      if (!links.length) return;
      var y = barH() + 32, pick = null;
      for (var i = 0; i < links.length; i++) {
        if (!links[i]._head.getClientRects().length) continue; /* inside a collapsed section */
        if (links[i]._head.getBoundingClientRect().top <= y) pick = links[i]; else break;
      }
      if ((window.innerHeight + window.pageYOffset) >= document.documentElement.scrollHeight - 4) pick = links[links.length - 1];
      if (pick === active) return;
      if (active) { active.classList.remove('active'); active._top.classList.remove('in'); }
      active = pick;
      if (!active) { secLabel.textContent = ''; return; }
      active.classList.add('active');
      active._top.classList.add('in');
      secLabel.textContent = textOf(active._top.firstChild._head);
      var tr = toc.getBoundingClientRect(), ar = active.getBoundingClientRect();
      if (ar.top < tr.top + 30 || ar.bottom > tr.bottom - 30) toc.scrollTop += (ar.top - tr.top) - tr.height / 3;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(spy); }
    }, { passive: true });
    window.addEventListener('resize', spy);

    /* Tables: thead from a first row of th, wrapper, wide detection */
    var wraps = [];
    [].slice.call(main.querySelectorAll('table')).forEach(function (t) {
      if (!t.tHead) {
        var first = t.rows[0];
        if (first && first.cells.length && [].every.call(first.cells, function (c) { return c.tagName === 'TH'; })) {
          var th = t.createTHead();
          th.setAttribute('data-bn-thead', '');
          th.appendChild(first);
        }
      }
      var w = t.parentNode;
      if (!w.classList || !w.classList.contains('bn-table')) {
        w = el('div', 'bn-table');
        w.setAttribute('data-bn-wrap', '');
        t.parentNode.insertBefore(w, t);
        w.appendChild(t);
      }
      wraps.push(w);
    });
    function measure() {
      wraps.forEach(function (w) {
        w.classList.remove('is-wide');
        var t = w.querySelector('table');
        if (t && t.scrollWidth > w.clientWidth + 1) w.classList.add('is-wide');
      });
    }
    measure();
    window.addEventListener('resize', measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

    /* Code blocks: copy button */
    [].slice.call(main.querySelectorAll('pre')).forEach(function (pre) {
      if (pre.parentNode.classList && pre.parentNode.classList.contains('bn-code')) return;
      var w = el('div', 'bn-code');
      w.setAttribute('data-bn-wrap', '');
      pre.parentNode.insertBefore(w, pre);
      w.appendChild(pre);
      var b = ui(el('button', 'bn-btn bn-copy', 'Copy'));
      b.type = 'button';
      b.addEventListener('click', function () {
        copyText(pre.innerText.replace(/\n$/, ''), function (ok) {
          b.textContent = ok ? 'Copied' : 'Copy failed';
          setTimeout(function () { b.textContent = 'Copy'; }, 1400);
        });
      });
      w.appendChild(b);
    });

    /* Collapsible sections: a chevron in the gutter of each outline heading hides what follows it, up to
       the next heading of the same or a higher level. Nothing is wrapped, so comment selectors and the
       revision hash still describe the page as written. Built after the table and code wrappers, so a
       section holds the wrappers rather than the elements moved into them. The state is kept per page
       until its revision changes: a revised page opens fully expanded. */
    var FKEY = 'bn-fold:' + docIdOf(), folds = [], foldOf = {};
    function levelOf(n) { var m = /^H([1-6])$/.exec(n.tagName); return m ? +m[1] : 0; }
    heads.forEach(function (h) {
      var lv = levelOf(h), items = [], n = h.nextElementSibling, l;
      while (n) {
        l = levelOf(n);
        if (l && l <= lv) break;
        if (!n.hasAttribute('data-bn-ui')) items.push(n);
        n = n.nextElementSibling;
      }
      if (!items.length) return;
      var b = ui(el('button', 'bn-fold'));
      b.type = 'button';
      b.innerHTML = ICON.fold;
      b.title = 'Collapse or expand this section (Alt+click: every section at this level)';
      h.insertBefore(b, h.firstChild);
      var f = { h: h, b: b, items: items, lv: lv, shut: false };
      folds.push(f); foldOf[h.id] = f;
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var shut = !f.shut;
        if (e.altKey) folds.forEach(function (g) { if (g.lv === lv) g.shut = shut; });
        else f.shut = shut;
        applyFolds(); saveFolds();
      });
    });
    function applyFolds() {
      [].forEach.call(main.querySelectorAll('.bn-fold-hide'), function (n) { n.classList.remove('bn-fold-hide'); });
      folds.forEach(function (f) {
        f.h.classList.toggle('bn-folded', f.shut);
        f.b.setAttribute('aria-expanded', f.shut ? 'false' : 'true');
        f.b.setAttribute('aria-label', (f.shut ? 'Expand' : 'Collapse') + ' section');
        if (linkOf[f.h.id]) linkOf[f.h.id].classList.toggle('folded', f.shut);
        if (f.shut) f.items.forEach(function (n) { n.classList.add('bn-fold-hide'); });
      });
      measure();
      spy();
      changes.place();
    }
    function saveFolds() {
      var ids = folds.filter(function (f) { return f.shut; }).map(function (f) { return f.h.id; });
      try {
        if (ids.length) localStorage.setItem(FKEY, JSON.stringify({ rev: rev, ids: ids }));
        else localStorage.removeItem(FKEY);
      } catch (e) {}
    }
    /* Opens every collapsed section that holds the node; true when something opened. */
    function reveal(n) {
      var opened = false;
      folds.forEach(function (f) {
        if (f.shut && f.items.some(function (it) { return it === n || it.contains(n); })) { f.shut = false; opened = true; }
      });
      if (opened) { applyFolds(); saveFolds(); }
      return opened;
    }
    function setAll(shut) { folds.forEach(function (f) { f.shut = shut; }); applyFolds(); saveFolds(); }
    try {
      var savedFolds = JSON.parse(localStorage.getItem(FKEY) || 'null');
      if (savedFolds && savedFolds.rev === rev) savedFolds.ids.forEach(function (id) { if (foldOf[id]) foldOf[id].shut = true; });
      else if (savedFolds) localStorage.removeItem(FKEY);
    } catch (e) {}
    /* A revised page you had read: sections without a change open collapsed (not saved, so a reload recomputes). */
    if (!(savedFolds && savedFolds.rev === rev) && changes.collapseUnchanged()) {
      folds.forEach(function (f) { f.shut = !changes.touches([f.h].concat(f.items)); });
    }
    function revealHash() {
      var id = location.hash.slice(1), t;
      try { t = id && document.getElementById(decodeURIComponent(id)); } catch (e) { t = null; }
      if (t && main.contains(t) && reveal(t)) t.scrollIntoView();
    }
    if (folds.length) {
      applyFolds();
      revealHash();
      window.addEventListener('hashchange', revealHash);
    }

    /* Figures: click to enlarge */
    var lb = $('bn-lightbox');
    function closeLb() { lb.hidden = true; lb.textContent = ''; }
    main.addEventListener('click', function (e) {
      var fig = e.target.closest('figure.fig');
      if (!fig || e.target.closest('figcaption, a, mark.anno')) return;
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      var media = fig.querySelector(':scope > img, :scope > svg, :scope > .fig-body');
      if (!media) return;
      lb.textContent = '';
      var x = el('button', 'bn-btn lb-x');
      x.type = 'button'; x.setAttribute('aria-label', 'Close');
      x.innerHTML = ICON.close;
      var body = el('div', 'lb-body');
      var clone = media.cloneNode(true);
      clone.removeAttribute('width'); clone.removeAttribute('height');
      body.appendChild(clone);
      lb.appendChild(x); lb.appendChild(body);
      var cap = fig.querySelector('figcaption');
      if (cap) lb.appendChild(el('p', 'lb-cap', norm(cap.textContent)));
      lb.hidden = false;
    });
    lb.addEventListener('click', closeLb);

    /* Search */
    var box = $('bn-search'), input = $('bn-q'), countEl = $('bn-count'), filterBtn = $('bn-filter');
    var groups = [], cur = -1, timer = null, lastQ = '', filtering = false, MAXHITS = 1500;
    var SKIP = 'script, style, textarea, svg, noscript, .bn-copy, .bn-nosearch, .q-meta, .q-foot, .bn-del';
    function fold(ch) {
      var c = ch.normalize ? ch.normalize('NFD').charAt(0) : ch;
      return c.toLowerCase().charAt(0);
    }
    function clearHits() {
      var ms = main.querySelectorAll('mark.bn-hit'), i, m, p;
      for (i = ms.length - 1; i >= 0; i--) {
        m = ms[i]; p = m.parentNode;
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        p.removeChild(m); p.normalize();
      }
      [].slice.call(main.querySelectorAll('.bn-out')).forEach(function (e) { e.classList.remove('bn-out'); });
      groups = []; cur = -1;
    }
    function scanText() {
      var w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentNode;
          return (p && p.closest && p.closest(SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }, false);
      var text = '', nodes = [], offs = [], prev = true, node, s, i, ch;
      while ((node = w.nextNode())) {
        s = node.nodeValue;
        for (i = 0; i < s.length; i++) {
          ch = s.charAt(i);
          if (/\s/.test(ch)) { if (prev) continue; text += ' '; prev = true; }
          else { text += fold(ch); prev = false; }
          nodes.push(node); offs.push(i);
        }
      }
      return { text: text, nodes: nodes, offs: offs };
    }
    function wrapSeg(node, s, e, id) {
      var mid = node;
      if (s > 0) mid = node.splitText(s);
      if (mid.nodeValue.length > e - s) mid.splitText(e - s);
      var m = el('mark', 'bn-hit');
      m.setAttribute('data-hit', id);
      mid.parentNode.insertBefore(m, mid); m.appendChild(mid);
      return m;
    }
    function run(qRaw) {
      clearHits();
      var q = '', prev = true, i, ch;
      qRaw = String(qRaw).trim();
      for (i = 0; i < qRaw.length; i++) {
        ch = qRaw.charAt(i);
        if (/\s/.test(ch)) { if (!prev) { q += ' '; prev = true; } } else { q += fold(ch); prev = false; }
      }
      q = q.trim();
      lastQ = q;
      box.classList.toggle('has-q', !!q);
      if (!q) { updateToc(); render(); return; }
      var d = scanText(), starts = [], at = 0;
      while ((at = d.text.indexOf(q, at)) !== -1 && starts.length < MAXHITS) { starts.push(at); at += q.length; }
      for (var k = starts.length - 1; k >= 0; k--) {
        var a = starts[k], b = a + q.length - 1, segs = [], j = a;
        while (j <= b) {
          var n = d.nodes[j], s0 = d.offs[j], e0 = s0;
          while (j + 1 <= b && d.nodes[j + 1] === n) { j++; e0 = d.offs[j]; }
          segs.push([n, s0, e0 + 1]); j++;
        }
        var marks = [];
        for (var g = segs.length - 1; g >= 0; g--) marks.unshift(wrapSeg(segs[g][0], segs[g][1], segs[g][2], k));
        groups[k] = marks;
      }
      if (filtering) applyFilter();
      updateToc();
      var y = barH();
      cur = 0;
      for (i = 0; i < groups.length; i++) {
        if (groups[i][0].getBoundingClientRect().top >= y) { cur = i; break; }
      }
      if (groups.length) go(cur, true); else render();
    }
    function applyFilter() {
      var items = main.querySelectorAll('tbody > tr, section.entry, [data-filter-item], .question');
      [].forEach.call(items, function (it) {
        it.classList.toggle('bn-out', !!lastQ && !it.querySelector('mark.bn-hit'));
      });
    }
    function render() {
      if (!lastQ) { countEl.textContent = ''; countEl.classList.remove('none'); return; }
      countEl.textContent = groups.length ? (cur + 1) + '/' + groups.length + (groups.length >= MAXHITS ? '+' : '') : '0';
      countEl.classList.toggle('none', !groups.length);
    }
    function go(i, quiet) {
      if (!groups.length) { render(); return; }
      if (cur >= 0 && groups[cur]) groups[cur].forEach(function (m) { m.classList.remove('current'); });
      cur = (i + groups.length) % groups.length;
      groups[cur].forEach(function (m) { m.classList.add('current'); });
      var m0 = groups[cur][0];
      var det = m0.closest('details');
      while (det) { det.open = true; det = det.parentNode.closest ? det.parentNode.closest('details') : null; }
      reveal(m0);
      m0.scrollIntoView({ block: 'center', behavior: quiet ? 'auto' : 'smooth' });
      render();
    }
    function updateToc() {
      toc.classList.toggle('searching', !!lastQ);
      links.forEach(function (a) { a.classList.remove('hits', 'sub-hits'); a.lastChild.textContent = ''; a._n = 0; });
      if (!lastQ) return;
      var seq = main.querySelectorAll('h2, h3, mark.bn-hit'), curA = null, seen = {};
      [].forEach.call(seq, function (e) {
        if (e.tagName !== 'MARK') { if (linkOf[e.id] && linkOf[e.id]._head === e) curA = linkOf[e.id]; return; }
        var id = e.getAttribute('data-hit');
        if (seen[id] || !curA) return;
        seen[id] = true; curA._n++;
      });
      links.forEach(function (a) {
        if (a._n) { a.classList.add('hits'); a.lastChild.textContent = String(a._n); a._top.firstChild.classList.add('sub-hits'); }
      });
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { timer = null; run(input.value); }, 140);
    });
    function flush() { if (timer) { clearTimeout(timer); timer = null; run(input.value); return true; } return false; }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (flush()) return;
        go(cur + (e.shiftKey ? -1 : 1));
      } else if (e.key === 'Escape') {
        input.value = ''; flush(); run(''); input.blur();
      }
    });
    $('bn-next').addEventListener('click', function () { flush(); go(cur + 1); });
    $('bn-prev').addEventListener('click', function () { flush(); go(cur - 1); });
    filterBtn.addEventListener('click', function () {
      filtering = !filtering;
      filterBtn.setAttribute('aria-pressed', filtering ? 'true' : 'false');
      if (filtering) applyFilter();
      else [].slice.call(main.querySelectorAll('.bn-out')).forEach(function (e) { e.classList.remove('bn-out'); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target)) {
        e.preventDefault(); input.focus(); input.select();
      } else if (e.key === 'Escape') {
        tocOpen(false);
        if (!lb.hidden) closeLb();
      }
    });
    var api = {
      run: run,
      next: function () { go(cur + 1); },
      prev: function () { go(cur - 1); },
      filter: function (on) { if (!!on !== filtering) filterBtn.click(); },
      state: function () { return { q: lastQ, n: groups.length, cur: cur, filtering: filtering }; }
    };
    window.bnSearch = api;
    var foldApi = {
      collapseAll: function () { setAll(true); },
      expandAll: function () { setAll(false); },
      reveal: reveal,
      state: function () { return folds.filter(function (f) { return f.shut; }).map(function (f) { return f.h.id; }); }
    };
    window.bnFold = foldApi;
    window.bnChanges = changes;
    spy();
    changes.place();
    return { barH: barH, search: api, reveal: reveal, changes: changes,
             outline: function () { return links.map(function (a) { return a.firstChild.textContent; }); } };
  }

  /* ================= Vim keys for review textareas (on by default) ================= */
  function makeVim(isOn) {
    function cls(c) { return /\s/.test(c) ? 0 : /\w/.test(c) ? 1 : 2; }
    function lineStart(v, p) { return v.lastIndexOf('\n', p - 1) + 1; }
    function lineEnd(v, p) { var i = v.indexOf('\n', p); return i === -1 ? v.length : i; }
    function firstNonBlank(v, p) {
      var s = lineStart(v, p), e = lineEnd(v, p);
      while (s < e && /[ \t]/.test(v.charAt(s))) s++;
      return s;
    }
    function wordNext(v, p) {
      var n = v.length;
      if (p >= n) return n;
      var c = cls(v.charAt(p));
      if (c) while (p < n && cls(v.charAt(p)) === c) p++;
      while (p < n && cls(v.charAt(p)) === 0) p++;
      return p;
    }
    function wordPrev(v, p) {
      if (p <= 0) return 0;
      p--;
      while (p > 0 && cls(v.charAt(p)) === 0) p--;
      var c = cls(v.charAt(p));
      while (p > 0 && cls(v.charAt(p - 1)) === c) p--;
      return p;
    }
    function wordEnd(v, p) {
      var n = v.length;
      if (p >= n - 1) return Math.max(0, n - 1);
      p++;
      while (p < n - 1 && cls(v.charAt(p)) === 0) p++;
      var c = cls(v.charAt(p));
      while (p < n - 1 && cls(v.charAt(p + 1)) === c) p++;
      return p;
    }

    function attach(ta, ind) {
      var st = { mode: 'insert', pend: '', reg: '', line: false, undo: null };
      function show() {
        var on = isOn();
        ind.hidden = !on;
        ind.textContent = st.mode === 'normal' ? 'NORMAL' + (st.pend ? ' ' + st.pend : '') : 'INSERT';
        ind.classList.toggle('normal', st.mode === 'normal');
      }
      function pos() { return ta.selectionStart; }
      function put(p) {
        var v = ta.value;
        p = Math.max(0, Math.min(p, v.length));
        ta.setSelectionRange(p, (st.mode === 'normal' && p < lineEnd(v, p)) ? p + 1 : p);
      }
      function edit(s, e, text) {
        var v = ta.value;
        ta.value = v.slice(0, s) + text + v.slice(e);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      function snap() { st.undo = { v: ta.value, p: pos() }; }
      function insert(p, noSnap) {
        if (!noSnap) snap();
        st.mode = 'insert'; show();
        ta.setSelectionRange(p, p);
      }
      function normalAt(p) {
        var v = ta.value, ls = lineStart(v, p), le = lineEnd(v, p);
        st.mode = 'normal'; show();
        put(Math.max(ls, Math.min(p, le - 1)));
      }
      function cut(s, e, ins) {
        snap();
        st.reg = ta.value.slice(s, e); st.line = false;
        edit(s, e, '');
        if (ins) insert(s, true); else normalAt(s);
      }
      function cmd(k) {
        var v = ta.value, p = pos(), ls = lineStart(v, p), le = lineEnd(v, p), t;
        if (st.pend === 'g') { st.pend = ''; if (k === 'g') put(0); show(); return; }
        if (st.pend === 'd' || st.pend === 'c') {
          var op = st.pend; st.pend = '';
          if (k === 'd' && op === 'd') {
            snap();
            st.reg = v.slice(ls, le); st.line = true;
            if (le < v.length) edit(ls, le + 1, '');
            else if (ls > 0) { edit(ls - 1, le, ''); ls = lineStart(ta.value, ls - 1); }
            else edit(0, le, '');
            normalAt(firstNonBlank(ta.value, ls));
          } else if (k === 'w') {
            if (op === 'c' && cls(v.charAt(p)) !== 0) {
              t = p; while (t + 1 < v.length && cls(v.charAt(t + 1)) === cls(v.charAt(p))) t++;
              t++;
            } else {
              t = wordNext(v, p);
              if (v.slice(p, t).indexOf('\n') !== -1) t = le;
            }
            cut(p, t, op === 'c');
          } else show();
          return;
        }
        switch (k) {
          case 'h': put(Math.max(ls, p - 1)); break;
          case 'l': put(Math.min(Math.max(ls, le - 1), p + 1)); break;
          case 'j':
            if (le < v.length) { t = lineEnd(v, le + 1); put(Math.min(le + 1 + (p - ls), Math.max(le + 1, t - 1))); }
            break;
          case 'k':
            if (ls > 0) { t = lineStart(v, ls - 1); put(Math.min(t + (p - ls), Math.max(t, ls - 2))); }
            break;
          case 'w': put(Math.min(wordNext(v, p), Math.max(0, v.length - 1))); break;
          case 'b': put(wordPrev(v, p)); break;
          case 'e': put(wordEnd(v, p)); break;
          case '0': put(ls); break;
          case '^': put(firstNonBlank(v, p)); break;
          case '$': put(Math.max(ls, le - 1)); break;
          case 'G': put(lineStart(v, v.length)); break;
          case 'g': case 'd': case 'c': st.pend = k; break;
          case 'i': insert(p); break;
          case 'a': insert(Math.min(p + 1, le)); break;
          case 'I': insert(firstNonBlank(v, p)); break;
          case 'A': insert(le); break;
          case 'o': snap(); edit(le, le, '\n'); insert(le + 1, true); break;
          case 'O': snap(); edit(ls, ls, '\n'); insert(ls, true); break;
          case 'x':
            if (p < le) { snap(); st.reg = v.charAt(p); st.line = false; edit(p, p + 1, ''); normalAt(p); }
            break;
          case 'D': cut(p, le, false); break;
          case 'C': cut(p, le, true); break;
          case 'u':
            if (st.undo) { var u = st.undo; snap(); edit(0, ta.value.length, u.v); normalAt(u.p); }
            break;
          case 'p':
            if (!st.reg) break;
            snap();
            if (st.line) { edit(le, le, '\n' + st.reg); normalAt(firstNonBlank(ta.value, le + 1)); }
            else { t = p < le ? p + 1 : p; edit(t, t, st.reg); normalAt(t + st.reg.length - 1); }
            break;
        }
        show();
      }
      ta.addEventListener('keydown', function (e) {
        if (!isOn() || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        var k = e.key;
        if (st.mode === 'insert') {
          if (k !== 'Escape') return;
          e.preventDefault(); e.stopImmediatePropagation();
          var p = pos(), v = ta.value;
          normalAt(p > lineStart(v, p) ? p - 1 : p);
          return;
        }
        if (k === 'Escape') {
          if (st.pend) { e.preventDefault(); e.stopImmediatePropagation(); st.pend = ''; show(); }
          return; /* a bare Esc in normal mode is left to the box that owns the textarea */
        }
        if (k.length > 1 && k !== 'Enter' && k !== 'Backspace' && k !== 'Delete') return; /* arrows, Tab, Home... */
        e.preventDefault(); e.stopImmediatePropagation();
        cmd(k);
      });
      ta.addEventListener('mouseup', function () {
        if (isOn() && st.mode === 'normal' && ta.selectionStart === ta.selectionEnd) put(ta.selectionStart);
      });
      show();
      return {
        show: show,
        mode: function () { return isOn() ? st.mode : 'off'; },
        reset: function () { st.mode = 'insert'; st.pend = ''; show(); },
        normal: function () {
          if (!isOn() || st.mode === 'normal') return;
          st.pend = '';
          var p = pos(), v = ta.value;
          normalAt(p > lineStart(v, p) ? p - 1 : p);
        }
      };
    }
    return { attach: attach };
  }

  /* ================= Review layer: questions, comments, picker, notes, export ================= */
  function setupReview(main, page, rev) {
    var path = location.pathname || '';
    var filePath = decodeURIComponent(path);
    var base = (decodeURIComponent(path.split('/').pop() || '') || 'document').replace(/\.x?html?$/i, '') || 'document';
    var docId = docIdOf();
    var KEY = 'anno:' + docId, AKEY = KEY + ':answers', NKEY = KEY + ':notes', VKEY = 'bn-vim';
    var FILE = base + '-comments.md', MAXQ = 400, SNIP = 120;
    var PICK = 'p, li, td, th, tr, table, h1, h2, h3, h4, h5, h6, figure, img, pre, blockquote, dt, dd, dl, details, .callout, .card, .kpi, .kpis, .question';

    var ls = null;
    try { ls = window.localStorage; ls.getItem(KEY); } catch (e) { ls = null; }
    function load(k, d) {
      if (!ls) return d;
      try { var v = JSON.parse(ls.getItem(k)); return v == null ? d : v; } catch (e) { return d; }
    }
    function put(k, v) {
      if (!ls) return;
      try { if (v == null) ls.removeItem(k); else ls.setItem(k, JSON.stringify(v)); } catch (e) {}
    }
    var store = load(KEY, []);
    if (!(store instanceof Array)) store = [];
    var answers = load(AKEY, {});
    if (!answers || typeof answers !== 'object' || answers instanceof Array) answers = {};
    var notes = load(NKEY, '');
    if (typeof notes !== 'string') notes = '';

    /* Review rounds: an export records what it sent; once the page content changes (the agent revised it),
       everything sent and not edited since is swept into a one-level archive that Restore brings back. */
    var RKEY = KEY + ':round', PKEY = KEY + ':prev';
    var round = load(RKEY, null), swept = null;
    if (!round || typeof round !== 'object') round = {};
    function sig(a) { return JSON.stringify([(a && a.choice) || [], ((a && a.text) || '').trim(), ((a && a.note) || '').trim()]); }
    function snapshot() {
      var s = { c: {}, a: {}, n: notes.trim() };
      store.forEach(function (c) { s.c[c.id] = c.body || ''; });
      Object.keys(answers).forEach(function (id) { s.a[id] = sig(answers[id]); });
      return s;
    }
    function markSent() { round = { rev: rev, sent: snapshot() }; put(RKEY, round); page.changes.markRead(); }
    function sweep(sent) {
      var gone = { at: Date.now(), comments: [], answers: {}, notes: '' }, n = 0;
      store = store.filter(function (c) {
        var hit = sent.c && Object.prototype.hasOwnProperty.call(sent.c, c.id) && sent.c[c.id] === (c.body || '');
        if (hit) gone.comments.push(c);
        return !hit;
      });
      Object.keys(answers).forEach(function (id) {
        if (sent.a && sent.a[id] === sig(answers[id])) { gone.answers[id] = answers[id]; delete answers[id]; n++; }
      });
      var s = (sent.n || '').trim(), t = notes.trim();
      if (s && t.indexOf(s) === 0) { gone.notes = s; notes = t.slice(s.length).replace(/^\s+/, ''); }
      if (!gone.comments.length && !n && !gone.notes) return null;
      put(KEY, store.length ? store : null);
      put(AKEY, Object.keys(answers).length ? answers : null);
      put(NKEY, notes.trim() ? notes : null);
      put(PKEY, gone);
      var items = [];
      if (gone.comments.length) items.push(gone.comments.length + (gone.comments.length === 1 ? ' comment' : ' comments'));
      if (n) items.push(n + (n === 1 ? ' answer' : ' answers'));
      if (gone.notes) items.push('the general notes');
      return items;
    }
    if (round.rev !== rev) {
      if (round.rev && round.sent) swept = sweep(round.sent);
      round = { rev: rev };
      put(RKEY, round);
    }
    var vimOn = load(VKEY, true) !== false; /* on unless turned off explicitly */
    var vim = makeVim(function () { return vimOn; });

    var questions = [], qVims = [], anchors = {}, orphan = {}, pop = null, popVim = null;
    var heads = [].slice.call(main.querySelectorAll('h1, h2, h3, h4, h5, h6'));

    function save() { put(KEY, store.length ? store : null); }
    function saveAnswers() { put(AKEY, Object.keys(answers).length ? answers : null); }
    function isAnswered(a) { return !!a && ((a.choice && a.choice.length) || (a.text && a.text.trim())); }
    function byId(id) {
      for (var i = 0; i < store.length; i++) { if (store[i].id === id) return store[i]; }
      return null;
    }

    /* Section of a node: the last heading at or before it */
    function elementOf(node) { return node.nodeType === 1 ? node : node.parentNode; }
    function headingFor(node) {
      var e = elementOf(node), best = null;
      for (var i = 0; i < heads.length; i++) {
        var pos = heads[i].compareDocumentPosition(e);
        if (heads[i] === e || (pos & 4) || (pos & 16)) best = heads[i];
        else break;
      }
      return best;
    }
    /* Section label for the panel and export: empty when it is the page title (h1) or the top of the page */
    function secLabel(t) {
      var h1 = main.querySelector('h1');
      return (!t || t === 'Document' || (h1 && t === headingTitle(h1))) ? '' : t;
    }
    function headingTitle(h) {
      if (!h) return 'Document';
      var c = h.cloneNode(true);
      [].slice.call(c.querySelectorAll('.badge, [data-bn-ui]')).forEach(function (b) { b.parentNode.removeChild(b); });
      return norm(c.textContent);
    }

    /* ---------- Text anchors: quote plus occurrence index inside an optional section.entry ---------- */
    function scan(scope) {
      var w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentNode;
          return (p && p.closest && p.closest('.bn-copy, .bn-del, script, style')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }, false);
      var text = '', nodes = [], offs = [], prev = true, node, s, i, ch;
      while ((node = w.nextNode())) {
        s = node.nodeValue;
        for (i = 0; i < s.length; i++) {
          ch = s.charAt(i);
          if (/\s/.test(ch)) {
            if (prev) continue;
            text += ' '; nodes.push(node); offs.push(i); prev = true;
          } else { text += ch; nodes.push(node); offs.push(i); prev = false; }
        }
      }
      return { text: text, nodes: nodes, offs: offs };
    }
    function countBefore(hay, needle) {
      var k = 0, at = 0;
      while ((at = hay.indexOf(needle, at)) !== -1) { k++; at++; }
      return k;
    }
    function findRange(c) {
      var needle = norm(c.quote);
      if (needle.length < 2) return null;
      var data = scan((c.scopeId && document.getElementById(c.scopeId)) || main);
      var want = c.occ || 0, at = 0, k = 0, idx = -1, first = -1;
      while ((at = data.text.indexOf(needle, at)) !== -1) {
        if (first === -1) first = at;
        if (k === want) { idx = at; break; }
        k++; at++;
      }
      if (idx === -1) idx = first;
      if (idx === -1) return null;
      var end = idx + needle.length - 1;
      if (end >= data.nodes.length) return null;
      var r = document.createRange();
      try {
        r.setStart(data.nodes[idx], data.offs[idx]);
        r.setEnd(data.nodes[end], data.offs[end] + 1);
      } catch (e) { return null; }
      return r;
    }
    function wrapRange(range, id) {
      var rt = range.commonAncestorContainer, list = [], w, t;
      if (rt.nodeType === 3) list.push(rt);
      else {
        w = document.createTreeWalker(rt, NodeFilter.SHOW_TEXT, null, false);
        while ((t = w.nextNode())) { if (range.intersectsNode(t)) list.push(t); }
      }
      var sc = range.startContainer, so = range.startOffset, ec = range.endContainer, eo = range.endOffset;
      var made = [];
      list.forEach(function (tn) {
        if (!tn.parentNode || (tn.parentNode.closest && tn.parentNode.closest('textarea, .bn-copy, .bn-del'))) return;
        var s = (tn === sc) ? so : 0;
        var e = (tn === ec) ? eo : tn.nodeValue.length;
        if (e <= s || !/\S/.test(tn.nodeValue.slice(s, e))) return;
        var node = tn;
        if (s > 0) node = node.splitText(s);
        if (node.nodeValue.length > e - s) node.splitText(e - s);
        var m = el('mark', 'anno');
        m.setAttribute('data-anno', id);
        node.parentNode.insertBefore(m, node);
        m.appendChild(node);
        made.push(m);
      });
      if (made.length) made[0].setAttribute('data-first', '1');
      return made;
    }
    function contextOf(range) {
      var e = elementOf(range.startContainer);
      var sec = e && e.closest ? e.closest('section.entry') : null;
      var head = headingFor(range.startContainer);
      var quote = clip(norm(plain(range)), MAXQ);
      var pre = document.createRange();
      pre.selectNodeContents(sec || main);
      try { pre.setEnd(range.startContainer, range.startOffset); } catch (x) {}
      return {
        kind: 'text', quote: quote,
        scopeId: (sec && sec.id) ? sec.id : '',
        sectionId: (head && head.id) ? head.id : '',
        sectionTitle: headingTitle(head),
        occ: countBefore(norm(plain(pre)), quote)
      };
    }
    /* Text of a range without the struck-through words of the change view, which are not part of the page */
    function plain(range) {
      var f = range.cloneContents();
      [].slice.call(f.querySelectorAll('.bn-del')).forEach(function (d) { d.parentNode.removeChild(d); });
      return f.textContent;
    }

    /* ---------- Element anchors: selector path written against the page source, plus a text snippet ---------- */
    function isWrap(n) { return n.nodeType === 1 && n.hasAttribute('data-bn-wrap'); }
    function isUi(n) { return n.nodeType === 1 && n.hasAttribute('data-bn-ui'); }
    /* A header row that setupPage moved into a new <thead> still counts as the first row of the tbody. */
    function movedHead(t) { return t.tHead && t.tHead.hasAttribute('data-bn-thead') ? t.tHead : null; }
    function kids(p) {
      var out = [], t = p.parentNode;
      if (p.tagName === 'TBODY' && movedHead(t) && t.tBodies[0] === p) out = [].slice.call(t.tHead.rows);
      [].forEach.call(p.children, function (c) {
        if (isUi(c) || c.hasAttribute('data-bn-thead')) return;
        if (isWrap(c)) out.push.apply(out, kids(c)); else out.push(c);
      });
      return out;
    }
    function parentOf(n) {
      var p = n.parentElement;
      if (p && p.hasAttribute('data-bn-thead') && p.parentNode.tBodies[0]) return p.parentNode.tBodies[0];
      while (p && p !== main && isWrap(p)) p = p.parentElement;
      return p;
    }
    function tagOf(n) { return n.tagName.toLowerCase(); }
    function esc(id) { return window.CSS && CSS.escape ? CSS.escape(id) : id; }
    function selectorOf(t) {
      var parts = [], n = t;
      while (n && n !== main) {
        if (n.id && !/^bn-/.test(n.id)) { parts.unshift(tagOf(n) + '#' + esc(n.id)); return parts.join(' > '); }
        var p = parentOf(n);
        if (!p) return '';
        var tag = tagOf(n);
        var sib = kids(p).filter(function (c) { return tagOf(c) === tag; });
        parts.unshift(sib.length > 1 ? tag + ':nth-of-type(' + (sib.indexOf(n) + 1) + ')' : tag);
        n = p;
      }
      parts.unshift('main');
      return parts.join(' > ');
    }
    function resolve(sel) {
      if (!sel) return null;
      var parts = sel.split(' > '), n, i = 1, m;
      if (parts[0] === 'main') n = main;
      else {
        m = /^[a-z0-9]*#(.+)$/i.exec(parts[0]);
        n = m ? document.getElementById(m[1].replace(/\\(.)/g, '$1')) : null;
        if (!n || !main.contains(n)) return null;
      }
      for (; i < parts.length; i++) {
        m = /^([a-z0-9-]+)(?::nth-of-type\((\d+)\))?$/i.exec(parts[i]);
        if (!m) return null;
        var tag = m[1].toLowerCase();
        n = kids(n).filter(function (c) { return tagOf(c) === tag; })[(m[2] ? +m[2] : 1) - 1];
        if (!n) return null;
      }
      return n;
    }
    /* Visible text of an element, a space at every block boundary, without injected controls. */
    function cleanText(n) {
      var out = '', x, w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: function (k) {
          return k.nodeType === 1 && (isUi(k) || /^(STYLE|SCRIPT|TEXTAREA)$/.test(k.tagName) || k.classList.contains('bn-copy'))
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }, false);
      while ((x = w.nextNode())) {
        if (x.nodeType === 3) out += x.nodeValue;
        else if (x.tagName === 'BR' || !/^inline/.test(getComputedStyle(x).display)) out += ' ';
      }
      return norm(out);
    }
    function textFor(t) {
      var tag = tagOf(t), s;
      if (tag === 'img') return 'image: ' + (t.getAttribute('alt') || (t.getAttribute('src') || '').split('/').pop().slice(0, 60));
      if (tag === 'tr') return norm([].map.call(t.cells, cleanText).join(' | '));
      if (tag === 'figure') {
        var cap = t.querySelector('figcaption');
        if (cap) return 'figure: ' + cleanText(cap);
      }
      s = cleanText(t);
      if (!s) {
        var im = t.querySelector('img[alt], svg[aria-label]');
        if (im) s = 'image: ' + (im.getAttribute('alt') || im.getAttribute('aria-label'));
      }
      return s;
    }
    function pickTarget(node) {
      var e = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!e || !main.contains(e)) return null;
      var t = e.closest(PICK);
      return (t && t !== main && main.contains(t)) ? t : null;
    }
    function elementContext(t) {
      var h = headingFor(t);
      return {
        kind: 'el', selector: selectorOf(t), snippet: textFor(t).slice(0, SNIP), tag: tagOf(t),
        sectionId: (h && h.id) ? h.id : '', sectionTitle: headingTitle(h)
      };
    }
    function anchorEl(c) {
      var t = resolve(c.selector), probe = (c.snippet || '').slice(0, 40);
      if (t && textFor(t).slice(0, 40) === probe) return { el: t };
      if (probe) {
        var cands = main.querySelectorAll(c.tag || '*');
        for (var i = 0; i < cands.length; i++) {
          if (!cands[i].closest('[data-bn-ui]') && textFor(cands[i]).slice(0, SNIP) === c.snippet) return { el: cands[i] };
        }
      }
      return t ? { el: t, changed: true } : null;
    }

    /* ---------- Marks, pins and document order ---------- */
    var pins = ui(el('div', 'bn-pins'));
    document.body.appendChild(pins);
    function clearMarks() {
      var ms = main.querySelectorAll('mark.anno'), i, m, p;
      for (i = ms.length - 1; i >= 0; i--) {
        m = ms[i]; p = m.parentNode;
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        p.removeChild(m); p.normalize();
      }
      [].forEach.call(main.querySelectorAll('.bn-pinned'), function (e) { e.classList.remove('bn-pinned', 'active'); });
      pins.textContent = '';
    }
    var ordered = [];
    function renderMarks() {
      clearMarks();
      orphan = {}; anchors = {};
      var nodes = [];
      store.forEach(function (c) {
        var node = null;
        if (c.kind === 'el') {
          var a = anchorEl(c);
          if (a) { anchors[c.id] = a; a.el.classList.add('bn-pinned'); node = a.el; }
        } else {
          var r = findRange(c), made = r ? wrapRange(r, c.id) : [];
          if (made.length) node = made[0];
        }
        if (node) nodes.push({ c: c, n: node }); else orphan[c.id] = true;
      });
      nodes.sort(function (a, b) {
        if (a.n === b.n) return 0;
        var p = a.n.compareDocumentPosition(b.n);
        return (p & 4) || (p & 16) ? -1 : 1;
      });
      ordered = nodes.map(function (x) { return x.c; });
      store.forEach(function (c) { if (orphan[c.id]) ordered.push(c); });
      ordered.forEach(function (c, i) {
        c.num = i + 1;
        if (c.kind === 'el' && anchors[c.id]) {
          var b = el('button', 'bn-pin', String(i + 1));
          b.type = 'button';
          b.title = 'Comment ' + (i + 1);
          b.setAttribute('data-anno', c.id);
          pins.appendChild(b);
          anchors[c.id].pin = b;
        } else {
          [].forEach.call(main.querySelectorAll('mark.anno[data-anno="' + c.id + '"]'), function (m) { m.setAttribute('data-n', i + 1); });
        }
      });
      placePins();
    }
    function placePins() {
      var sx = window.pageXOffset, sy = window.pageYOffset, vw = document.documentElement.clientWidth;
      Object.keys(anchors).forEach(function (id) {
        var a = anchors[id];
        if (!a.pin) return;
        var r = a.el.getBoundingClientRect();
        a.pin.hidden = !(r.width || r.height);
        a.pin.style.left = Math.max(4, Math.min(r.right + sx - 10, sx + vw - 28)) + 'px';
        a.pin.style.top = (r.top + sy - 10) + 'px';
      });
    }
    var placing = false;
    function schedulePins() {
      if (placing) return;
      placing = true;
      requestAnimationFrame(function () { placing = false; placePins(); });
    }
    window.addEventListener('resize', schedulePins);
    document.addEventListener('scroll', function (e) { if (e.target !== document) schedulePins(); }, true);
    if (window.ResizeObserver) new ResizeObserver(schedulePins).observe(main);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedulePins);

    /* ---------- Panel ---------- */
    var trigger = $('bn-comments'), trigN = $('bn-comments-n'), pickBtn = $('bn-pick');
    var drawer = ui(el('aside', 'anno-drawer'));
    drawer.setAttribute('aria-label', 'Comments');
    var head = el('div', 'anno-head');
    var title = el('h2', 'bn-notoc');
    var headCount = el('span', 'n', '0');
    var headAns = el('span', 'anno-head-ans'), headAnsN = el('span', 'n', '0');
    title.appendChild(document.createTextNode('Comments'));
    title.appendChild(headCount);
    headAns.appendChild(el('span', 'sep', '\u00b7'));
    headAns.appendChild(document.createTextNode('Answers'));
    headAns.appendChild(headAnsN);
    title.appendChild(headAns);
    var btnClose = el('button', 'bn-btn x');
    btnClose.type = 'button';
    btnClose.setAttribute('aria-label', 'Close comments');
    btnClose.innerHTML = ICON.close;
    title.appendChild(btnClose);
    var notesLabel = el('label', 'anno-notes-l', 'General notes');
    var notesWrap = el('div', 'anno-notes-wrap');
    var notesTa = el('textarea');
    notesTa.id = 'bn-notes';
    notesLabel.htmlFor = 'bn-notes';
    notesTa.placeholder = 'Anything not tied to one place in the page';
    notesTa.value = notes;
    var notesInd = el('span', 'vim-mode');
    var notesFoot = el('div', 'anno-foot');
    notesFoot.appendChild(notesInd);
    notesFoot.appendChild(el('span', 'hint', 'Saved as you type \u00b7 Cmd+Enter done'));
    notesWrap.appendChild(notesTa); notesWrap.appendChild(notesFoot);
    var actions = el('div', 'anno-actions');
    var btnExport = el('button', 'anno-btn primary', 'Export Markdown');
    var btnDownload = el('button', 'anno-btn', 'Download .md');
    var btnClear = el('button', 'anno-btn danger anno-clear', 'Clear all');
    btnClear.title = 'Delete all comments, answers and notes on this page';
    [btnExport, btnDownload, btnClear].forEach(function (b) { b.type = 'button'; actions.appendChild(b); });
    var status = el('p', 'anno-status', '');
    var minor = el('div', 'anno-actions minor');
    var vimLabel = el('label', 'anno-vim');
    var vimBox = el('input');
    vimBox.type = 'checkbox';
    vimLabel.appendChild(vimBox);
    vimLabel.appendChild(document.createTextNode('Vim keys'));
    minor.appendChild(vimLabel);
    var restoreBtn = el('button', 'anno-link');
    restoreBtn.type = 'button';
    restoreBtn.title = 'Bring back the comments, answers and notes that the last revision cleared after your export';
    minor.appendChild(restoreBtn);
    var keysLine = el('p', 'anno-keys');
    keysLine.innerHTML = '<kbd>n</kbd> notes \u00b7 <kbd>c</kbd> panel \u00b7 <kbd>/</kbd> search \u00b7 ' +
      '<kbd>\u2318\u21e7M</kbd> comment \u00b7 <kbd>\u2318\u21e7E</kbd> pick \u00b7 <kbd>\u2318\u21e7X</kbd> export \u00b7 ';
    var keysBtn = el('button', 'anno-link');
    keysBtn.type = 'button';
    keysBtn.innerHTML = '<kbd>?</kbd> all keys';
    keysLine.appendChild(keysBtn);
    [title, notesLabel, notesWrap, actions, status, minor, keysLine].forEach(function (n) { head.appendChild(n); });
    /* Scrolling body in the export order: comments, then answers (the general notes sit above, in the head). */
    var panelBody = el('div', 'anno-body');
    var listL = el('p', 'anno-sec', 'Comments');
    var list = el('ul', 'anno-list');
    var ansL = el('p', 'anno-sec', 'Answers'), ansSum = el('span', 'sum');
    ansL.appendChild(ansSum);
    var ansList = el('ul', 'anno-list anno-answers');
    [listL, list, ansL, ansList].forEach(function (n) { panelBody.appendChild(n); });
    drawer.appendChild(head); drawer.appendChild(panelBody);
    var addBtn = ui(el('button', 'anno-add', 'Add comment'));
    addBtn.type = 'button';
    addBtn.hidden = true;
    document.body.appendChild(drawer);
    document.body.appendChild(addBtn);
    var notesVim = vim.attach(notesTa, notesInd);

    /* Notes grow with their content up to half the window; a height dragged by hand becomes the floor. */
    var notesFloor = 0, notesSet = 0;
    function fitNotes() {
      if (notesSet && Math.abs(notesTa.offsetHeight - notesSet) > 1) notesFloor = notesTa.offsetHeight;
      var max = Math.max(notesFloor, Math.round(window.innerHeight * 0.5));
      notesTa.style.height = 'auto';
      var h = notesTa.scrollHeight + (notesTa.offsetHeight - notesTa.clientHeight);
      notesTa.style.height = Math.min(Math.max(h, notesFloor), max) + 'px';
      notesSet = notesTa.offsetHeight;
    }
    notesTa.addEventListener('input', function () {
      notes = notesTa.value;
      put(NKEY, notes.trim() ? notes : null);
      fitNotes();
    });
    notesTa.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        notes = notesTa.value;
        put(NKEY, notes.trim() ? notes : null);
        notesVim.normal();
        notesTa.blur();
        say(notes.trim() ? 'Notes saved.' : '');
      }
    });
    window.addEventListener('resize', fitNotes);

    /* Vim keys: one setting in localStorage, shown by the top-bar button and the panel checkbox. */
    var vimTop = $('bn-vim');
    function showVim() {
      vimBox.checked = vimOn;
      vimTop.setAttribute('aria-pressed', vimOn ? 'true' : 'false');
      vimTop.title = 'Vim keys in comment boxes, answers and general notes: ' + (vimOn ? 'on' : 'off');
    }
    function setVim(on) {
      vimOn = !!on;
      put(VKEY, vimOn);
      showVim();
      notesVim.reset();
      if (popVim) popVim.reset();
      qVims.forEach(function (v) { v.reset(); });
    }
    vimBox.addEventListener('change', function () { setVim(vimBox.checked); });
    vimTop.addEventListener('click', function () { setVim(!vimOn); });
    showVim();

    /* Status line in the panel; with the panel closed (top bar buttons), the same message shows as a toast under the bar. */
    var toast = ui(el('div', 'bn-toast'));
    toast.setAttribute('role', 'status');
    toast.hidden = true;
    document.body.appendChild(toast);
    function say(msg, ms) {
      status.textContent = msg || '';
      if (msg) setTimeout(function () { if (status.textContent === msg) status.textContent = ''; }, Math.max(ms || 0, 4000));
      if (!msg || drawer.classList.contains('open')) { toast.hidden = true; return; }
      toast.textContent = msg;
      toast.hidden = false;
      setTimeout(function () { if (toast.textContent === msg) toast.hidden = true; }, ms || 3000);
    }
    function answeredCount() {
      return questions.filter(function (q) { return isAnswered(answers[q.id]); }).length;
    }
    /* A saved answer is anything Clear all would delete: a choice, a text or a note. */
    function hasContent(a) { return !!(isAnswered(a) || (a && a.note && a.note.trim())); }
    function onPage(id) { return questions.some(function (q) { return q.id === id; }); }
    function savedAnswers() { return Object.keys(answers).filter(function (id) { return hasContent(answers[id]); }); }
    function respondedCount() { return questions.filter(function (q) { return hasContent(answers[q.id]); }).length; }
    function renderAnswers() {
      ansList.textContent = '';
      var stale = savedAnswers().filter(function (id) { return !onPage(id); }).length;
      ansL.hidden = ansList.hidden = !questions.length && !stale;
      ansSum.textContent = questions.length ? answeredCount() + ' of ' + questions.length + ' answered' : '';
      questions.forEach(function (q) {
        var a = answers[q.id], li;
        if (!hasContent(a)) {
          li = el('li', 'anno-open');
          li.appendChild(el('span', 'meta', 'Question ' + q.num + ', open'));
          li.appendChild(el('span', 'q', clip(q.text, 80)));
        } else {
          var full = isAnswered(a);
          li = el('li', 'anno-ans' + (full ? '' : ' partial'));
          li.appendChild(el('span', 'meta', 'Question ' + q.num + (secLabel(q.section) ? ' \u00b7 ' + clip(q.section, 44) : '') + (full ? '' : ' \u00b7 no choice yet')));
          li.appendChild(el('p', 'quote', clip(q.text, 140)));
          if (q.type === 'text') li.appendChild(el('p', 'body', a.text.trim()));
          else (a.choice || []).forEach(function (v) { li.appendChild(el('p', 'choice', q.plain(v))); });
          if (q.type !== 'text' && a.note && a.note.trim()) li.appendChild(el('p', 'body note', a.note.trim()));
        }
        li.setAttribute('data-q', q.id);
        li.title = 'Show question ' + q.num + ' in the page';
        ansList.appendChild(li);
      });
      if (stale) ansList.appendChild(el('li', 'anno-empty', stale + (stale === 1 ? ' saved answer belongs to a question' : ' saved answers belong to questions') + ' no longer on the page.'));
    }
    function renderPanel() {
      trigN.textContent = String(store.length);
      var qWrap = $('bn-q-wrap');
      if (qWrap) { qWrap.hidden = !questions.length; $('bn-q-n').textContent = answeredCount() + '/' + questions.length; }
      trigger.setAttribute('aria-label', store.length + ' comments' + (questions.length ? ', ' + answeredCount() + ' of ' + questions.length + ' questions answered' : ''));
      headCount.textContent = String(store.length);
      headAns.hidden = !questions.length;
      headAnsN.textContent = String(respondedCount());
      renderAnswers();
      list.textContent = '';
      if (!ordered.length) {
        list.appendChild(el('li', 'anno-empty', 'Select text and choose Add comment (Cmd+Shift+M), or press Pick (Cmd+Shift+E) and click an element.'));
        return;
      }
      ordered.forEach(function (c) {
        var bad = orphan[c.id] ? ' \u00b7 not found' : (anchors[c.id] && anchors[c.id].changed ? ' \u00b7 text changed' : '');
        var li = el('li', orphan[c.id] ? 'orphan' : null);
        li.setAttribute('data-anno', c.id);
        li.appendChild(el('span', 'meta', c.num + (secLabel(c.sectionTitle) ? ' \u00b7 ' + clip(c.sectionTitle, 60) : '') + (c.kind === 'el' ? ' \u00b7 ' + (c.tag || 'element') : '') + bad));
        li.appendChild(el('p', 'quote', clip(norm(c.kind === 'el' ? c.snippet : c.quote), 140)));
        li.appendChild(el('p', 'body', c.body || ''));
        list.appendChild(li);
      });
    }
    function refresh() { renderMarks(); renderPanel(); }
    function openDrawer(open) {
      if (open === undefined) open = !drawer.classList.contains('open');
      drawer.classList.toggle('open', open);
      trigger.setAttribute('aria-pressed', open ? 'true' : 'false');
      if (open) fitNotes();
    }
    trigger.addEventListener('click', function () { openDrawer(); });
    btnClose.addEventListener('click', function () { openDrawer(false); });
    function focusNotes() {
      openDrawer(true);
      notesVim.reset();
      notesTa.focus({ preventScroll: true });
      var n = notesTa.value.length;
      notesTa.setSelectionRange(n, n);
      notesTa.scrollTop = notesTa.scrollHeight;
    }
    function togglePanel() {
      var open = !drawer.classList.contains('open');
      if (!open && drawer.contains(document.activeElement)) document.activeElement.blur();
      openDrawer(open);
    }
    var KEYS = [
      ['<kbd>n</kbd>', 'Open the panel with the cursor in General notes'],
      ['<kbd>c</kbd>', 'Open or close the panel'],
      ['<kbd>/</kbd>', 'Search the page; <kbd>Enter</kbd> and <kbd>Shift</kbd> <kbd>Enter</kbd> step through the matches'],
      ['<kbd>?</kbd>', 'This list'],
      ['<kbd>Cmd</kbd> <kbd>Shift</kbd> <kbd>M</kbd>', 'Comment on the selected text'],
      ['<kbd>Cmd</kbd> <kbd>Shift</kbd> <kbd>E</kbd>', 'Pick an element; <kbd>\u2191</kbd> <kbd>\u2193</kbd> widen or narrow, <kbd>Enter</kbd> comments'],
      ['<kbd>Cmd</kbd> <kbd>Shift</kbd> <kbd>X</kbd>', 'Export comments, answers and notes as Markdown to the clipboard'],
      ['<kbd>Cmd</kbd> <kbd>Enter</kbd>', 'Save a comment, or leave the general notes or an answer box'],
      ['<kbd>Alt</kbd> click', 'On a section chevron: collapse or expand every section at that level'],
      ['<kbd>]</kbd> <kbd>[</kbd>', 'Next or previous change since your last read'],
      ['<kbd>d</kbd>', 'Show or hide the changes since your last read'],
      ['<kbd>Esc</kbd>', 'Leave pick mode, the search, a comment box or the panel']
    ];
    function showKeys() {
      if (modal) return null;
      var dl = el('dl', 'bn-keys');
      KEYS.forEach(function (k) {
        var dt = el('dt'), dd = el('dd');
        dt.innerHTML = k[0]; dd.innerHTML = k[1];
        dl.appendChild(dt); dl.appendChild(dd);
      });
      return dialog({
        title: 'Keyboard shortcuts', cls: 'bn-dialog-keys', toggleKey: '?',
        body: [dl, 'The single keys work while no text box has focus; Ctrl stands in for Cmd outside macOS.'],
        buttons: [{ label: 'Close', cls: 'primary' }]
      });
    }
    keysBtn.addEventListener('click', showKeys);

    function anchorNode(c) {
      if (c.kind === 'el') return anchors[c.id] ? anchors[c.id].el : null;
      return main.querySelector('mark.anno[data-anno="' + c.id + '"]');
    }
    function openFor(c) {
      var n = anchorNode(c);
      if (n) {
        page.reveal(n);
        var r = n.getBoundingClientRect();
        if (r.top < page.barH() || r.top > window.innerHeight - 120) n.scrollIntoView({ block: 'center' });
        openEditor(c, null, n.getBoundingClientRect());
      }
      else openEditor(c, null, null);
    }
    list.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-anno]');
      var c = li && byId(li.getAttribute('data-anno'));
      if (c) openFor(c);
    });
    /* An answer card scrolls to its question and flashes it. */
    function showQuestion(q) {
      page.reveal(q.box);
      q.box.scrollIntoView({ block: 'center' });
      q.box.classList.remove('bn-flash');
      void q.box.offsetWidth; /* restart the animation */
      q.box.classList.add('bn-flash');
      clearTimeout(q.flashT);
      q.flashT = setTimeout(function () { q.box.classList.remove('bn-flash'); }, 1800);
    }
    ansList.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-q]'), id = li && li.getAttribute('data-q');
      var q = id && questions.filter(function (x) { return x.id === id; })[0];
      if (q) showQuestion(q);
    });
    pins.addEventListener('click', function (e) {
      var b = e.target.closest('.bn-pin');
      var c = b && byId(b.getAttribute('data-anno'));
      if (c) openFor(c);
    });

    /* ---------- Export ---------- */
    function lines(s) {
      return String(s || '').split('\n').map(function (l) { return l.replace(/\s+$/, ''); })
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function markdown() {
      var out = [];
      var n = store.length, nq = questions.length;
      out.push('# Comments on ' + (norm(document.title) || base));
      out.push('');
      out.push('File: `' + filePath + '`');
      out.push(n + (n === 1 ? ' comment' : ' comments') + (nq ? ', ' + answeredCount() + ' of ' + nq + ' questions answered' : '') + '.');
      out.push('');
      if (notes.trim()) {
        out.push('## General notes', '', lines(notes), '');
      }
      ordered.forEach(function (c) {
        out.push('## Comment ' + c.num + (secLabel(c.sectionTitle) ? ', ' + c.sectionTitle : ''), '');
        out.push('> ' + clip(norm(c.kind === 'el' ? c.snippet : c.quote), 300));
        if (c.kind === 'el') out.push('', 'Element: `' + c.selector + '`');
        if (orphan[c.id]) out.push('', '(Anchor not found on the current page.)');
        else if (anchors[c.id] && anchors[c.id].changed) out.push('', '(Element text changed since the comment.)');
        out.push('', lines(c.body), '');
      });
      questions.forEach(function (q) {
        var a = answers[q.id] || {};
        out.push('## Answer ' + q.id + (secLabel(q.section) ? ', ' + q.section : ''), '', '> ' + q.text, '');
        if (q.type === 'text') out.push(isAnswered(a) ? lines(a.text) : 'No answer.');
        else if (!isAnswered(a)) out.push('No choice.');
        else if (q.type === 'multi') {
          out.push('Selected:');
          a.choice.forEach(function (v) { out.push('- ' + q.label(v)); });
        } else out.push('Selected: ' + q.label(a.choice[0]));
        if (q.type !== 'text' && a.note && a.note.trim()) out.push('', 'Note: ' + lines(a.note));
        out.push('');
      });
      return out.join('\n').replace(/\n+$/, '\n');
    }
    function exportable() { return store.length || savedAnswers().length || notes.trim(); }
    /* The top bar button falls back to a download when the clipboard is blocked, since Download .md sits in the closed panel. */
    function exportMd(fromBar) {
      if (!exportable()) { say('Nothing to export yet.'); return; }
      copyText(markdown(), function (ok) {
        if (ok) { markSent(); say('Copied to clipboard as Markdown.'); }
        else if (fromBar) { download(); markSent(); say('Copy blocked, downloaded ' + FILE + ' instead.'); }
        else say('Copy blocked, use Download .md.');
      });
    }
    btnExport.addEventListener('click', function () { exportMd(false); });
    $('bn-export').addEventListener('click', function () { exportMd(true); });
    function download() {
      var url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }));
      var a = el('a');
      a.href = url; a.download = FILE;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
    }
    btnDownload.addEventListener('click', function () {
      if (!exportable()) { say('Nothing to export yet.'); return; }
      download();
      markSent();
      say('Downloaded ' + FILE + '.');
    });
    /* What Clear all deletes: every comment, every saved answer (a choice, a text or a note), the general notes. */
    function clearItems() {
      var n = store.length, na = savedAnswers().length, items = [];
      if (n) items.push(n + (n === 1 ? ' comment' : ' comments'));
      if (na) items.push(na + (na === 1 ? ' answer' : ' answers'));
      if (notes.trim()) items.push('the general notes');
      return items;
    }
    function clearAll(items) {
      store = []; answers = {}; notes = '';
      notesTa.value = '';
      fitNotes();
      put(KEY, null); put(AKEY, null); put(NKEY, null); put(PKEY, null);
      round = { rev: rev }; put(RKEY, round);
      questions.forEach(function (q) { q.load(); });
      closePop();
      refresh();
      say('Cleared ' + items.join(', ') + '.');
    }
    /* Restore: merge the archive of the last sweep back; current items win on a clash. */
    function prevArchive() {
      var p = load(PKEY, null);
      return p && typeof p === 'object' && ((p.comments && p.comments.length) || Object.keys(p.answers || {}).length || p.notes) ? p : null;
    }
    function showRestore() {
      var p = prevArchive();
      restoreBtn.hidden = !p;
      if (p) restoreBtn.textContent = 'Restore cleared round';
    }
    function restorePrev() {
      var p = prevArchive();
      if (!p) { say('Nothing to restore.'); return; }
      (p.comments || []).forEach(function (c) { if (!byId(c.id)) store.push(c); });
      Object.keys(p.answers || {}).forEach(function (id) { if (!hasContent(answers[id])) answers[id] = p.answers[id]; });
      if (p.notes) notes = p.notes + (notes.trim() ? '\n\n' + notes : '');
      notesTa.value = notes;
      fitNotes();
      save(); saveAnswers(); put(NKEY, notes.trim() ? notes : null); put(PKEY, null);
      questions.forEach(function (q) { q.load(); });
      refresh(); showRestore();
      say('Restored the cleared round.');
    }
    restoreBtn.addEventListener('click', restorePrev);
    btnClear.addEventListener('click', askClear);
    $('bn-clear').addEventListener('click', askClear);
    function askClear() {
      var items = clearItems();
      if (!items.length) { say('Nothing to clear.'); return; }
      var ul = el('ul', 'bn-dialog-list');
      items.forEach(function (t) { ul.appendChild(el('li', null, t.charAt(0).toUpperCase() + t.slice(1))); });
      dialog({
        title: 'Clear all comments?', role: 'alertdialog', cancel: false,
        body: ['This deletes, on this page:', ul, 'It cannot be undone.'],
        buttons: [{ label: 'Cancel', value: false, focus: true }, { label: 'Clear all', value: true, cls: 'danger solid' }],
        onClose: function (yes) { if (yes) clearAll(items); }
      });
    }

    /* ---------- Editor popover ---------- */
    function setActive(c) {
      [].forEach.call(main.querySelectorAll('mark.anno.active, .bn-pinned.active'), function (m) { m.classList.remove('active'); });
      [].forEach.call(pins.querySelectorAll('.active'), function (m) { m.classList.remove('active'); });
      if (!c) return;
      if (c.kind === 'el') {
        var a = anchors[c.id];
        if (a) { a.el.classList.add('active'); if (a.pin) a.pin.classList.add('active'); }
      } else {
        [].forEach.call(main.querySelectorAll('mark.anno[data-anno="' + c.id + '"]'), function (m) { m.classList.add('active'); });
      }
    }
    var picked = null;
    function closePop() {
      if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
      pop = null; popVim = null;
      if (picked) { picked.classList.remove('bn-picked'); picked = null; }
      setActive(null);
    }
    function addComment(data, body) {
      var c = { id: 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), body: body, created: Date.now() };
      Object.keys(data).forEach(function (k) { c[k] = data[k]; });
      store.push(c);
      save(); refresh();
      return c;
    }
    function openEditor(existing, ctx, rect) {
      closePop();
      var data = existing || ctx;
      if (!data) return null;
      if (existing) setActive(existing);
      pop = ui(el('div', 'anno-pop'));
      pop.appendChild(el('p', 'quote', clip(norm(data.kind === 'el' ? data.snippet : data.quote), 180) || '(no text)'));
      if (data.kind === 'el') pop.appendChild(el('p', 'sel', data.selector));
      var ta = el('textarea');
      var initial = existing ? (existing.body || '') : '';
      ta.value = initial;
      ta.setAttribute('aria-label', 'Comment');
      ta.placeholder = data.kind === 'el' ? 'Comment on this element' : 'Comment on the selected text';
      pop.appendChild(ta);
      var row = el('div', 'row');
      var ok = el('button', 'anno-btn primary', 'Save');
      var cancel = el('button', 'anno-btn', 'Cancel');
      ok.type = 'button'; cancel.type = 'button';
      row.appendChild(ok); row.appendChild(cancel);
      if (existing) {
        var del = el('button', 'anno-btn danger', 'Delete');
        del.type = 'button';
        row.appendChild(del);
        del.addEventListener('click', function () {
          store = store.filter(function (c) { return c.id !== existing.id; });
          save(); closePop(); refresh();
        });
      }
      var foot = el('div', 'anno-foot');
      var ind = el('span', 'vim-mode');
      var hintEl = el('span', 'hint', 'Cmd+Enter saves');
      foot.appendChild(ind); foot.appendChild(hintEl);
      pop.appendChild(foot);
      pop.appendChild(row);
      document.body.appendChild(pop);
      popVim = vim.attach(ta, ind);

      /* Below the anchor if it fits, else above it, else below and let the page scroll. */
      var sx = window.pageXOffset, sy = window.pageYOffset, vh = window.innerHeight;
      var w = pop.offsetWidth || 340, h = pop.offsetHeight || 220;
      var top = page.barH() + 8, x = sx + window.innerWidth / 2 - w / 2, y;
      if (rect) {
        x = rect.left + sx;
        if (rect.bottom + 8 + h <= vh || rect.top - 8 - h < top) y = rect.bottom + 8;
        else y = rect.top - 8 - h;
      } else y = top + 60;
      pop.style.left = Math.max(sx + 8, Math.min(x, sx + document.documentElement.clientWidth - w - 16)) + 'px';
      pop.style.top = (Math.max(top, y) + sy) + 'px';
      ta.focus({ preventScroll: true });

      function commit() {
        var body = ta.value.trim();
        if (!body) { closePop(); return; }
        if (existing) { existing.body = body; save(); closePop(); refresh(); }
        else { closePop(); addComment(data, body); }
      }
      ok.addEventListener('click', commit);
      cancel.addEventListener('click', closePop);
      ta.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commit(); return; }
        if (e.key === 'Escape') {
          e.stopPropagation();
          /* With Vim keys on, a bare Esc in normal mode closes only an unchanged box. */
          if (vimOn && ta.value !== initial) {
            hintEl.textContent = 'Changed: Cmd+Enter saves, Cancel discards';
            hintEl.classList.add('warn');
            return;
          }
          closePop();
        }
      });
      return { pop: pop, textarea: ta, commit: commit };
    }

    /* ---------- Text selection ---------- */
    function liveRange() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      var r = sel.getRangeAt(0);
      if (!main.contains(r.commonAncestorContainer)) return null;
      if (norm(r.toString()).length < 2) return null;
      return r;
    }
    function showAdd() {
      var r = picking ? null : liveRange();
      if (!r) { addBtn.hidden = true; return; }
      var rect = r.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) { addBtn.hidden = true; return; }
      addBtn.hidden = false;
      addBtn.style.top = (rect.bottom + window.pageYOffset + 6) + 'px';
      addBtn.style.left = Math.max(8, rect.left + window.pageXOffset) + 'px';
    }
    function startText(range) {
      var ctx = contextOf(range), rect = range.getBoundingClientRect();
      addBtn.hidden = true;
      var ed = openEditor(null, ctx, rect);
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      return ed;
    }
    addBtn.addEventListener('click', function () { var r = liveRange(); if (r) startText(r); });
    document.addEventListener('mousedown', function (e) {
      if (e.target === addBtn) return;
      addBtn.hidden = true;
      if (pop && !pop.contains(e.target) && !e.target.closest('mark.anno, .bn-pin') && !picking) closePop();
    });
    document.addEventListener('mouseup', function (e) {
      if (drawer.contains(e.target) || (pop && pop.contains(e.target)) || e.target === addBtn) return;
      setTimeout(showAdd, 10);
    });
    document.addEventListener('keyup', function (e) {
      if (e.shiftKey || e.key === 'Shift') setTimeout(showAdd, 10);
    });
    main.addEventListener('click', function (e) {
      var m = e.target.closest('mark.anno');
      if (!m || !window.getSelection().isCollapsed) return;
      var c = byId(m.getAttribute('data-anno'));
      if (c) openEditor(c, null, m.getBoundingClientRect());
    });

    /* ---------- Element picker ---------- */
    var picking = false, pickCur = null, pickBase = null;
    var hl = ui(el('div', 'bn-pick-hl')), hlLabel = el('span');
    hl.appendChild(hlLabel); hl.hidden = true;
    var hint = ui(el('div', 'bn-pick-hint', 'Click an element to comment on it \u00b7 \u2191 \u2193 widen or narrow \u00b7 Esc exits'));
    hint.hidden = true;
    document.body.appendChild(hl); document.body.appendChild(hint);
    function describe(t) {
      var c = t.classList;
      var kind = ['callout', 'card', 'kpi', 'kpis', 'question'].filter(function (k) { return c.contains(k); })[0];
      return tagOf(t) + (kind ? '.' + kind : '') + ' \u00b7 ' + clip(textFor(t), 48);
    }
    function showHl(t) {
      pickCur = t;
      if (!t) { hl.hidden = true; return; }
      var r = t.getBoundingClientRect();
      hl.style.left = (r.left - 3) + 'px'; hl.style.top = (r.top - 3) + 'px';
      hl.style.width = (r.width + 6) + 'px'; hl.style.height = (r.height + 6) + 'px';
      hlLabel.textContent = describe(t);
      hl.hidden = false;
    }
    function setPick(on) {
      picking = !!on;
      document.body.classList.toggle('bn-picking', picking);
      pickBtn.setAttribute('aria-pressed', picking ? 'true' : 'false');
      hint.hidden = !picking;
      pickCur = pickBase = null;
      hl.hidden = true;
      if (picking) { closePop(); addBtn.hidden = true; var s = window.getSelection(); if (s) s.removeAllRanges(); }
    }
    function startElement(t) {
      var ed = openEditor(null, elementContext(t), t.getBoundingClientRect());
      picked = t;
      t.classList.add('bn-picked');
      return ed;
    }
    pickBtn.addEventListener('click', function () { setPick(!picking); });
    document.addEventListener('mousemove', function (e) {
      if (!picking) return;
      var t = pickTarget(e.target);
      if (t !== pickBase) { pickBase = t; showHl(t); }
    }, true);
    document.addEventListener('mousedown', function (e) {
      if (picking && main.contains(e.target)) e.preventDefault();
    }, true);
    document.addEventListener('click', function (e) {
      if (!picking || !main.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      var t = (pickCur && pickCur.contains(e.target)) ? pickCur : pickTarget(e.target);
      if (!t) return;
      setPick(false);
      startElement(t);
    }, true);
    window.addEventListener('scroll', function () { if (picking && pickCur) showHl(pickCur); }, { passive: true });

    document.addEventListener('keydown', function (e) {
      var k = e.key;
      /* Single keys, GitHub style: only while no text box has focus, so Vim keys and typing never reach them. */
      if ((k === 'n' || k === 'c' || k === '?') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing && !editable(e.target)) {
        e.preventDefault();
        if (e.repeat) return;
        if (picking) setPick(false);
        if (k === 'n') focusNotes(); else if (k === 'c') togglePanel(); else showKeys();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (k === 'e' || k === 'E' || e.code === 'KeyE')) {
        e.preventDefault(); setPick(!picking); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (k === 'x' || k === 'X' || e.code === 'KeyX')) {
        e.preventDefault();
        if (!e.repeat) exportMd(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (k === 'm' || k === 'M' || e.code === 'KeyM')) {
        var r = liveRange();
        if (r) { e.preventDefault(); startText(r); }
        return;
      }
      if (picking) {
        if (k === 'Escape') { e.preventDefault(); setPick(false); return; }
        if (k === 'ArrowUp' && pickCur) {
          e.preventDefault();
          var up = pickCur.parentElement && pickTarget(pickCur.parentElement);
          if (up) { up._bnDown = pickCur; showHl(up); }
          return;
        }
        if (k === 'ArrowDown' && pickCur && pickCur._bnDown) {
          e.preventDefault(); showHl(pickCur._bnDown); return;
        }
        if (k === 'Enter' && pickCur) { e.preventDefault(); var t = pickCur; setPick(false); startElement(t); return; }
      }
      if (k === 'Escape' && !editable(e.target)) {
        closePop(); addBtn.hidden = true;
        if (drawer.classList.contains('open')) openDrawer(false);
      } else if (k === 'Escape' && e.target === notesTa) openDrawer(false);
    });

    /* ---------- Questions: div.question[data-id][data-type=single|multi|text] with .q-text and a <ul> of options ---------- */
    [].slice.call(main.querySelectorAll('.question')).forEach(function (box, qi) {
      var type = box.getAttribute('data-type') || 'single';
      if (type !== 'multi' && type !== 'text') type = 'single';
      var id = box.getAttribute('data-id') || ('q' + (qi + 1));
      var textEl = box.querySelector('.q-text') || box.querySelector('p');
      if (textEl) textEl.classList.add('q-text');
      var q = { id: id, num: qi + 1, type: type, box: box, text: textEl ? norm(textEl.textContent) : id, section: headingTitle(headingFor(box)) };
      var meta = ui(el('div', 'q-meta'));
      var opts = box.querySelector(':scope > ul, :scope > ol');
      if (type !== 'text' && !opts) type = q.type = 'text';
      meta.appendChild(el('span', 'q-kind', type === 'multi' ? 'select all that apply' : type === 'single' ? 'select one' : 'free text'));
      var chip = el('span', 'badge');
      meta.appendChild(chip);
      box.insertBefore(meta, box.firstChild);
      var inputs = [], ta = null, note = null, labels = {};
      q.label = function (v) { return labels[v] && labels[v] !== v ? labels[v] + ' [' + v + ']' : v; };
      q.plain = function (v) { return labels[v] || v; };
      if (type !== 'text') {
        [].slice.call(opts.children).forEach(function (li) {
          var value = li.getAttribute('data-value') || norm(li.textContent);
          labels[value] = norm(li.textContent);
          var inp = el('input');
          inp.type = type === 'multi' ? 'checkbox' : 'radio';
          inp.name = 'bnq-' + id;
          inp.value = value;
          var label = el('label'), span = el('span');
          while (li.firstChild) span.appendChild(li.firstChild);
          label.appendChild(inp); label.appendChild(span);
          li.appendChild(label);
          inputs.push(inp);
        });
        note = ui(el('textarea', 'q-note'));
        note.rows = 1;
        note.placeholder = 'Note (optional)';
        note.setAttribute('aria-label', 'Note on question ' + id);
        box.appendChild(note);
      } else {
        ta = ui(el('textarea', 'q-input'));
        ta.placeholder = 'Your answer';
        ta.setAttribute('aria-label', 'Answer to question ' + id);
        box.appendChild(ta);
      }
      /* Vim keys as in the comment box; the mode line shows only while its box has focus.
         Cmd+Enter, or Esc in normal mode (or with Vim keys off), leaves the box so the single keys work again. */
      [ta, note].forEach(function (t) {
        if (!t) return;
        var foot = ui(el('div', 'anno-foot q-foot')), ind = el('span', 'vim-mode');
        foot.appendChild(ind); foot.appendChild(el('span', 'hint', 'Cmd+Enter done'));
        t.parentNode.insertBefore(foot, t.nextSibling);
        var v = vim.attach(t, ind);
        qVims.push(v);
        t.addEventListener('keydown', function (e) {
          if (((e.metaKey || e.ctrlKey) && e.key === 'Enter') || (e.key === 'Escape' && !e.isComposing)) {
            e.preventDefault(); e.stopPropagation();
            v.normal(); t.blur();
          }
        });
      });
      function state() {
        var done = isAnswered(answers[id]);
        box.classList.toggle('answered', !!done);
        chip.className = 'badge ' + (done ? 'ok' : 'accent');
        chip.textContent = done ? 'answered' : 'open';
      }
      function storeOne() {
        var a = { at: Date.now() };
        if (ta) a.text = ta.value;
        else {
          a.choice = inputs.filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
          a.note = note ? note.value : '';
        }
        if (!isAnswered(a) && !(a.note && a.note.trim())) delete answers[id]; else answers[id] = a;
        saveAnswers(); state(); renderPanel();
      }
      q.load = function () {
        var a = answers[id] || {};
        if (ta) ta.value = a.text || '';
        inputs.forEach(function (i) { i.checked = !!(a.choice && a.choice.indexOf(i.value) !== -1); });
        if (note) note.value = a.note || '';
        state();
      };
      inputs.forEach(function (i) { i.addEventListener('change', storeOne); });
      [ta, note].forEach(function (t) { if (t) t.addEventListener('input', storeOne); });
      q.load();
      questions.push(q);
    });

    refresh();
    showRestore();
    if (swept) say('Page revised: cleared ' + swept.slice(0, -1).join(', ') + (swept.length > 1 ? ' and ' : '') + swept[swept.length - 1] + ' from your last export.', 8000);

    /* Hooks for tests and for agents driving the page headlessly */
    window.bn = window.bn || {};
    window.bn.search = page.search;
    window.bn.outline = page.outline;
    window.bn.review = {
      markdown: markdown,
      comments: function () { return JSON.parse(JSON.stringify(store)); },
      answers: function () { return JSON.parse(JSON.stringify(answers)); },
      notes: function () { return notes; },
      rev: function () { return rev; },
      round: function () { return JSON.parse(JSON.stringify(round)); },
      restore: restorePrev,
      setNotes: function (s) { notesTa.value = s; notesTa.dispatchEvent(new Event('input')); },
      notesBox: function () { return notesTa; },
      addForRange: function (range, body) { return addComment(contextOf(range), body); },
      addForElement: function (t, body) { return addComment(elementContext(t), body); },
      selectorOf: selectorOf,
      resolve: resolve,
      pick: setPick,
      picking: function () { return picking; },
      editor: function () { return pop; },
      vim: function (on) { if (on !== undefined) setVim(on); return vimOn; },
      open: openDrawer,
      isOpen: function () { return drawer.classList.contains('open'); },
      dialog: function () { return modal; },
      keys: showKeys
    };
  }
})();
