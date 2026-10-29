/* plano-viz.js - camada visual da tela Plano: grade de bolhas e potes com fisica simples.
 * So desenho e interacao. Nenhuma regra de negocio: tudo entra por opts e sai pelos callbacks.
 * ES5, expoe window.PlanoViz = { grade, potes, realcar }.
 * Estilo todo por atributos SVG (tokens via var(--...)); nenhuma classe CSS e obrigatoria. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var FONT = 'DM Sans, sans-serif';

  var reg = { grade: null, potes: null };   // svgs desenhados (para realcar)
  var jarState = null;                       // {svg, jars, base, k, gap} do ultimo potes()
  var bodies = {};                           // chave+':'+id -> corpo fisico
  var simLeft = 0, running = false;
  var gridPrev = {};                         // id -> {x,y} da grade anterior
  var spawnHint = null;                      // {id,x,y} do ultimo solte
  var uid = 0;

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag), k;
    if (attrs) { for (k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]); } }
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function still(opts) { return !!(opts && opts.semAnimacao) || reduced(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return String(v); }

  function tween(ms, fn, done) {
    var t0 = performance.now();
    function f(t) {
      var p = clamp((t - t0) / ms, 0, 1);
      fn(1 - Math.pow(1 - p, 3));
      if (p < 1) requestAnimationFrame(f); else if (done) done();
    }
    requestAnimationFrame(f);
  }

  /* ---------- destaque (hover) ---------- */
  function hlEl(e, on) {
    if (on) {
      if (e._hl) return;
      e._hl = { s: e.getAttribute('stroke'), w: e.getAttribute('stroke-width'), d: e.getAttribute('stroke-dasharray') };
      e.setAttribute('stroke', '#fff'); e.setAttribute('stroke-width', 2.5); e.removeAttribute('stroke-dasharray');
    } else if (e._hl) {
      var o = e._hl; e._hl = null;
      if (o.s == null) e.removeAttribute('stroke'); else e.setAttribute('stroke', o.s);
      if (o.w == null) e.removeAttribute('stroke-width'); else e.setAttribute('stroke-width', o.w);
      if (o.d == null) e.removeAttribute('stroke-dasharray'); else e.setAttribute('stroke-dasharray', o.d);
    }
  }
  function realcar(id, on) {
    var key = str(id), s, list, i, j, ref = [reg.grade, reg.potes];
    for (j = 0; j < ref.length; j++) {
      s = ref[j]; if (!s) continue;
      list = s.querySelectorAll('[data-id]');
      for (i = 0; i < list.length; i++) { if (list[i].getAttribute('data-id') === key) hlEl(list[i], !!on); }
    }
  }

  /* ---------- arrasto ---------- */
  function toSvg(svg, cx, cy) {
    var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    if (!r.width || !vb || !vb.width) return null;
    if (cy < r.top || cy > r.bottom || cx < r.left || cx > r.right) return null;
    var sc = r.width / vb.width;
    return { x: (cx - r.left) / sc, y: (cy - r.top) / sc };
  }
  function jarAt(cx, cy) {
    if (!jarState || !jarState.svg.parentNode) return null;
    var p = toSvg(jarState.svg, cx, cy), i, g;
    if (!p) return null;
    for (i = 0; i < jarState.jars.length; i++) {
      g = jarState.jars[i];
      if (p.x >= g.x - jarState.gap / 2 && p.x <= g.x + g.w + jarState.gap / 2) return { g: g, p: p };
    }
    return null;
  }
  function setOver(g, on) {
    if (!g || !g.body) return;
    var b = g.body;
    if (on) {
      if (!b._ov) { b._ov = { s: b.getAttribute('stroke'), w: b.getAttribute('stroke-width') }; }
      b.setAttribute('stroke', 'var(--accent)'); b.setAttribute('stroke-width', 3);
    } else if (b._ov) {
      b.setAttribute('stroke', b._ov.s); b.setAttribute('stroke-width', b._ov.w); b._ov = null;
    }
  }
  function startDrag(id, cor, src, e, opts) {
    if (e.button > 0) return;
    e.preventDefault();
    var x0 = e.clientX, y0 = e.clientY, moved = false, ghost = null, over = null, drag = !!opts.podeArrastar;
    function cleanup() {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      src.style.opacity = '';
      if (over) setOver(over, false);
    }
    function mv(ev) {
      if (!moved && Math.sqrt(Math.pow(ev.clientX - x0, 2) + Math.pow(ev.clientY - y0, 2)) < 5) return;
      moved = true;
      if (!drag) return;
      if (!ghost) {
        var sz = clamp((+src.getAttribute('r') || 7) * 2, 14, 48);
        ghost = document.createElement('div');
        ghost.style.cssText = 'position:fixed;border-radius:50%;pointer-events:none;z-index:70;opacity:.9;' +
          'box-shadow:0 0 20px var(--accent);width:' + sz + 'px;height:' + sz + 'px;margin-left:' + (-sz / 2) + 'px;margin-top:' + (-sz / 2) + 'px;' +
          'background:' + (cor || 'var(--accent)');
        document.body.appendChild(ghost);
        src.style.opacity = '0.25';
        if (opts.aoPassar) opts.aoPassar(id, false, ev);
      }
      ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
      var h = jarAt(ev.clientX, ev.clientY), ng = h ? h.g : null;
      if (ng !== over) { if (over) setOver(over, false); over = ng; if (over) setOver(over, true); }
    }
    function up(ev) {
      var wasMoved = moved, dragged = !!ghost, alvo = null, h;
      if (dragged) {
        h = jarAt(ev.clientX, ev.clientY);
        if (h) {
          var span = h.g.cap * jarState.k;
          alvo = { chave: h.g.chave, fracao: span > 0 ? clamp((jarState.base - h.p.y) / span, 0, 1) : 0 };
          spawnHint = { id: str(id), x: h.p.x, y: h.p.y };
        }
      }
      cleanup();
      if (dragged) { if (opts.aoSoltar) opts.aoSoltar(id, alvo); }
      else if (!wasMoved) { if (opts.aoClicar) opts.aoClicar(id); }
    }
    function cancel() { cleanup(); }
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }
  function wireBubble(c, id, cor, opts) {
    c.setAttribute('data-id', str(id));
    c.setAttribute('tabindex', 0);
    c.setAttribute('role', 'button');
    c.style.cursor = opts.podeArrastar ? 'grab' : 'pointer';
    c._cor = cor;
    c.addEventListener('pointerdown', function (ev) { startDrag(id, cor, c, ev, opts); });
    c.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && opts.aoClicar) opts.aoClicar(id); });
    c.addEventListener('mouseenter', function (ev) { realcar(id, true); if (opts.aoPassar) opts.aoPassar(id, true, ev); });
    c.addEventListener('mouseleave', function (ev) { realcar(id, false); if (opts.aoPassar) opts.aoPassar(id, false, ev); });
  }

  /* ---------- grade ---------- */
  function raioGrade(h) { return h > 0 ? 5 + 19 * Math.sqrt(Math.min(h, 340) / 340) : 5; }

  function grade(svg, opts) {
    opts = opts || {};
    reg.grade = svg; clear(svg);
    var G = { l: 122, t: 46, cw: 212, ch: 96, gap: 7 };
    var L = opts.linhas || [], C = opts.colunas || [], B = opts.bolhas || [];
    var W = G.l + C.length * (G.cw + G.gap) - G.gap + 2, H = G.t + L.length * (G.ch + G.gap) - G.gap + 2;
    var i, j, k, a, b, ri, ci;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var still_ = still(opts);

    function rect(r, c) { return { x: G.l + c * (G.cw + G.gap), y: G.t + r * (G.ch + G.gap), w: G.cw, h: G.ch }; }
    function idx(list, key) { for (var q = 0; q < list.length; q++) { if (list[q].chave === key) return q; } return -1; }

    var layCells = el('g', {}, svg), layDots = el('g', {}, svg);
    var dest = opts.destaque || null;
    var counts = {};
    for (i = 0; i < B.length; i++) {
      if (B[i].apagada) continue;
      k = B[i].linha + '\u0001' + B[i].coluna; counts[k] = (counts[k] || 0) + 1;
    }

    for (ci = 0; ci < C.length; ci++) {
      var R0 = rect(0, ci);
      el('text', { x: R0.x + 4, y: 18, fill: 'var(--text)', 'font-size': 12.5, 'font-weight': 600, 'font-family': FONT }, layCells).textContent = C[ci].titulo || '';
      el('text', { x: R0.x + 4, y: 34, fill: 'var(--hint)', 'font-size': 11, 'font-family': FONT }, layCells).textContent = C[ci].sub || '';
    }
    for (ri = 0; ri < L.length; ri++) {
      var RL = rect(ri, 0);
      el('text', { x: 4, y: RL.y + RL.h / 2 - 2, fill: L[ri].cor || 'var(--text)', 'font-size': 12.5, 'font-weight': 600, 'font-family': FONT }, layCells).textContent = L[ri].titulo || '';
      el('text', { x: 4, y: RL.y + RL.h / 2 + 14, fill: 'var(--hint)', 'font-size': 11, 'font-family': FONT }, layCells).textContent = L[ri].sub || '';
      for (ci = 0; ci < C.length; ci++) {
        var R = rect(ri, ci), best = !!dest && dest.linha === L[ri].chave && dest.coluna === C[ci].chave;
        el('rect', {
          x: R.x, y: R.y, width: R.w, height: R.h, rx: 10,
          fill: best ? 'var(--accent)' : 'var(--card)', 'fill-opacity': best ? 0.1 : 1,
          stroke: best ? 'var(--accent)' : 'var(--border)', 'stroke-opacity': best ? 0.5 : 1
        }, layCells);
        if (best && dest.texto) el('text', { x: R.x + 9, y: R.y + 14, fill: '#b4acfb', 'font-size': 11, 'font-weight': 500, 'font-family': FONT }, layCells).textContent = dest.texto;
        var n = counts[L[ri].chave + '\u0001' + C[ci].chave];
        el('text', { x: R.x + R.w - 9, y: R.y + 14, 'text-anchor': 'end', fill: 'var(--hint)', 'font-size': 11, 'font-family': FONT }, layCells).textContent = n ? String(n) : '';
      }
    }

    // agrupa por celula e empacota
    var groups = {}, order = [], items = [];
    for (i = 0; i < B.length; i++) {
      ri = idx(L, B[i].linha); ci = idx(C, B[i].coluna);
      if (ri < 0 || ci < 0) continue;
      var it = { b: B[i], r: raioGrade(+B[i].horas || 0), ri: ri, ci: ci };
      items.push(it);
      k = ri + ',' + ci;
      if (!has(groups, k)) { groups[k] = []; order.push(k); }
      groups[k].push(it);
    }
    for (var gi = 0; gi < order.length; gi++) {
      var list = groups[order[gi]], first = list[0], RR = rect(first.ri, first.ci);
      var cx = RR.x + RR.w / 2, cy = RR.y + RR.h / 2 + 7;
      for (i = 0; i < list.length; i++) {
        var an = i * 2.4, rr = 7 * Math.sqrt(i);
        list[i].x = cx + Math.cos(an) * rr * 1.6; list[i].y = cy + Math.sin(an) * rr * 0.5;
      }
      for (var iter = 0; iter < 220; iter++) {
        for (i = 0; i < list.length; i++) { list[i].x += (cx - list[i].x) * 0.015; list[i].y += (cy - list[i].y) * 0.05; }
        for (i = 0; i < list.length; i++) {
          for (j = i + 1; j < list.length; j++) {
            a = list[i]; b = list[j];
            var dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 0.01, m = a.r + b.r + 2;
            if (dist < m) {
              var p = (m - dist) / 2, ux = dx / dist, uy = dy / dist;
              a.x -= ux * p; a.y -= uy * p; b.x += ux * p; b.y += uy * p;
            }
          }
        }
        for (i = 0; i < list.length; i++) {
          list[i].x = clamp(list[i].x, RR.x + list[i].r + 4, RR.x + RR.w - list[i].r - 4);
          list[i].y = clamp(list[i].y, RR.y + list[i].r + 17, RR.y + RR.h - list[i].r - 4);
        }
      }
    }

    var prev = gridPrev; gridPrev = {};
    var delay = 0;
    for (i = 0; i < items.length; i++) {
      (function (it, n) {
        var d = it.b, cor = d.cor || 'var(--accent)', ring = !!d.anel, dash = !!d.tracejada;
        var c = el('circle', { cx: it.x, cy: it.y, r: still_ ? it.r : 0 }, layDots);
        c.setAttribute('fill', ring ? 'var(--surface)' : cor);
        c.setAttribute('stroke', ring ? cor : (dash ? '#ffffff55' : 'none'));
        c.setAttribute('stroke-width', ring ? 2 : 1);
        c.setAttribute('stroke-dasharray', dash && !ring ? '2 2' : '');
        if (d.apagada) c.setAttribute('opacity', 0.1);
        wireBubble(c, d.id, cor, opts);
        c.setAttribute('aria-label', str(d.rotulo || d.id));
        var key = str(d.id), old = has(prev, key) ? prev[key] : null;
        gridPrev[key] = { x: it.x, y: it.y };
        if (still_) return;
        if (old) {
          c.setAttribute('r', it.r);
          if (old.x !== it.x || old.y !== it.y) {
            c.setAttribute('cx', old.x); c.setAttribute('cy', old.y);
            tween(500, function (e) { c.setAttribute('cx', old.x + (it.x - old.x) * e); c.setAttribute('cy', old.y + (it.y - old.y) * e); });
          }
        } else {
          setTimeout(function () { tween(380, function (e) { c.setAttribute('r', e * it.r); }); }, 80 + Math.min(n, 60) * 6);
        }
      })(items[i], delay++);
    }
  }

  /* ---------- potes ---------- */
  function potes(svg, wrap, opts) {
    opts = opts || {};
    reg.potes = svg; clear(svg);
    var P = opts.potes || [], still_ = still(opts), i, j, p;
    var J = { top: 64, H: 250, pileW: 170 };
    var hasPapel = false;
    for (i = 0; i < P.length; i++) { if (P[i].tipo === 'papel') hasPapel = true; }
    var jw = hasPapel ? 190 : 150, jgap = hasPapel ? 70 : 34;

    // posicoes
    var pos = [], x = 10, lastSem = false;
    for (i = 0; i < P.length; i++) {
      if (P[i].tipo === 'sem') { pos.push({ x: x + 10, w: J.pileW - 20 }); x += J.pileW; lastSem = true; }
      else { pos.push({ x: x, w: jw }); x += jw + jgap; lastSem = false; }
    }
    var totalW = (lastSem ? x : x - jgap) + 10;
    if (P.length === 0) totalW = 20;
    var totalH = J.top + J.H + 56, base = J.top + J.H;
    svg.setAttribute('viewBox', '0 0 ' + totalW + ' ' + totalH);
    /* tamanho natural (1 unidade = 1px); o wrap rola na horizontal se nao couber */
    svg.style.width = totalW + 'px';
    svg.style.minWidth = totalW + 'px';
    svg.style.height = 'auto';

    var maxV = 40;
    for (i = 0; i < P.length; i++) {
      maxV = Math.max(maxV, +P[i].capacidade || 0, +P[i].usado || 0);
      if (P[i].acima > 0) maxV = Math.max(maxV, (+P[i].capacidade || 0) + P[i].acima);
    }
    var k = J.H / maxV;

    uid++;
    var defs = el('defs', {}, svg);
    var hatchId = 'pvh' + uid, glassId = 'pvg' + uid;
    var hatch = el('pattern', { id: hatchId, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 8, height: 8, fill: '#4a1616' }, hatch);
    el('rect', { width: 3, height: 8, fill: '#6d2626' }, hatch);
    var gl = el('linearGradient', { id: glassId, x1: 0, x2: 1 }, defs);
    var stops = [['0', '#ffffff12'], ['.2', '#ffffff03'], ['.8', '#ffffff00'], ['1', '#ffffff0e']];
    for (i = 0; i < stops.length; i++) el('stop', { offset: stops[i][0], 'stop-color': stops[i][1] }, gl);
    var lay = { glass: el('g', {}, svg), liq: el('g', {}, svg), mar: el('g', {}, svg), top: el('g', {}, svg) };

    var firstRun = true, bk;
    for (bk in bodies) { if (has(bodies, bk)) { firstRun = false; break; } }
    var live = {}, jars = [];
    var hint = spawnHint; spawnHint = null;

    for (i = 0; i < P.length; i++) {
      (function (pt, g, pi) {
        var isSem = pt.tipo === 'sem', cap = Math.max(0, +pt.capacidade || 0), used = Math.max(0, +pt.usado || 0);
        var real = Math.max(0, +pt.realizado || 0), acima = +pt.acima > 0 ? +pt.acima : 0;
        var gx = g.x, w = g.w, rimY = isSem ? J.top : base - cap * k;
        var corLiq = pt.corTampa || 'var(--accent)';
        var cx = gx + w / 2, tt, ci;

        tt = el('text', { x: cx, y: 20, 'text-anchor': 'middle', fill: isSem ? 'var(--red)' : 'var(--text)', 'font-size': 14, 'font-weight': 600, 'font-family': FONT }, lay.top);
        tt.textContent = pt.titulo || '';
        if (pt.tituloClicavel && !isSem) {
          tt.style.cursor = 'pointer'; tt.style.textDecoration = 'underline dotted'; tt.style.textUnderlineOffset = '4px';
          tt.setAttribute('tabindex', 0); tt.setAttribute('role', 'button');
          tt.addEventListener('click', function () { if (opts.aoTitulo) opts.aoTitulo(pt.chave); });
          tt.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && opts.aoTitulo) opts.aoTitulo(pt.chave); });
        }
        if (pt.sub != null) el('text', { x: cx, y: 37, 'text-anchor': 'middle', fill: pt.subCor || 'var(--hint)', 'font-size': 11, 'font-family': FONT }, lay.top).textContent = pt.sub;

        var bodyH = Math.max(base - rimY, 6);
        var stroke = pt.corBorda || (isSem ? 'rgba(245,101,101,.45)' : (acima > 0.05 ? 'rgba(245,101,101,.6)' : 'var(--border2)'));
        var body = el('rect', { x: gx - 4, y: base - bodyH - 2, width: w + 8, height: bodyH + 5, rx: 14, fill: '#121215', stroke: stroke, 'stroke-width': 2 }, lay.glass);
        if (isSem) body.setAttribute('stroke-dasharray', '6 5');

        var fill = Math.min(used, cap);
        if (fill > 0 && !isSem) {
          var ly = base - fill * k;
          el('rect', { x: gx, y: ly, width: w, height: fill * k, rx: 4, fill: corLiq, opacity: 0.16 }, lay.liq);
          if (real > 0) el('rect', { x: gx, y: base - Math.min(real, fill) * k, width: w, height: Math.min(real, fill) * k, fill: 'var(--green)', opacity: 0.16 }, lay.liq);
          var cp = 'pvc' + uid + '_' + pi;
          el('rect', { x: gx, y: ly - 6, width: w, height: 12 }, el('clipPath', { id: cp }, defs));
          var d = 'M' + (gx - 40) + ' ' + ly, xx;
          for (xx = gx - 40; xx <= gx + w + 40; xx += 20) d += ' Q' + (xx + 10) + ' ' + (ly + ((((xx - gx) / 20) % 2) ? 2.5 : -2.5)) + ' ' + (xx + 20) + ' ' + ly;
          var wave = el('path', { d: d, fill: 'none', stroke: '#9a90fa', opacity: 0.7, 'stroke-width': 1.5 }, el('g', { 'clip-path': 'url(#' + cp + ')' }, lay.liq));
          if (!still_) {
            el('animateTransform', { attributeName: 'transform', type: 'translate', from: '0 0', to: '-40 0', dur: '2.8s', repeatCount: 'indefinite' }, wave);
          }
        }
        if (acima > 0.05) {
          el('rect', { x: gx, y: rimY - acima * k, width: w, height: acima * k, rx: 4, fill: 'var(--red)', opacity: 0.22 }, lay.liq);
          el('line', { x1: gx - 8, x2: gx + w + 8, y1: rimY, y2: rimY, stroke: 'var(--red)', 'stroke-dasharray': '4 4' }, lay.top);
        }
        el('rect', { x: gx, y: rimY, width: w, height: Math.max(base - rimY, 0), rx: 11, fill: 'url(#' + glassId + ')', 'pointer-events': 'none' }, lay.top);

        jars.push({ chave: pt.chave, x: gx, w: w, cap: cap, rimY: rimY, body: body });

        // bolhas
        var A = w * k * 0.52, itens = pt.itens || [], q;
        for (q = 0; q < itens.length; q++) {
          (function (e, idx) {
            var hh = +e.horas || 0, key = pt.chave + ':' + e.id, bd, r;
            live[key] = 1;
            r = clamp(Math.sqrt(A * hh / Math.PI), 5, Math.max(5, w / 2 - 4));
            bd = has(bodies, key) ? bodies[key] : null;
            if (!bd) {
              var sx = cx + ((idx % 7) - 3) * 6, sy = rimY - 30 - r;
              if (firstRun) sy = J.top - 30 - idx * 30;
              if (hint && hint.id === str(e.id)) { sx = clamp(hint.x, gx + r, gx + w - r); sy = Math.min(hint.y, rimY - r); }
              bd = { x: sx, y: sy, px: sx, py: sy };
              bodies[key] = bd;
            }
            bd.r = r; bd.x0 = gx; bd.x1 = gx + w; bd.floor = base; bd.jar = pt.chave;
            var cor = e.cor || 'var(--accent)';
            var c = el('circle', { r: r, fill: isSem ? 'url(#' + hatchId + ')' : cor, 'stroke-width': 1.5 }, lay.mar);
            c.setAttribute('stroke', e.dividida ? '#ffffffaa' : 'none');
            if (e.dividida) c.setAttribute('stroke-dasharray', '4 3');
            wireBubble(c, e.id, cor, opts);
            bd.el = c; bd.arc = null; bd.txt = null;
            if (+e.realizado > 0 && hh > 0) {
              bd.arc = el('circle', { r: r - 1.5, fill: 'none', stroke: 'var(--green)', 'stroke-width': 3, pathLength: 100, 'stroke-dasharray': Math.min(100, e.realizado / hh * 100) + ' 100', 'pointer-events': 'none' }, lay.mar);
            }
            if (r >= 17) {
              bd.txt = el('text', { 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 600, 'font-family': FONT, 'pointer-events': 'none' }, lay.mar);
              bd.txt.textContent = Math.round(hh) + 'h';
            }
          })(itens[q], q);
        }

        // tampa
        if (pt.editavel && !isSem) {
          var lid = el('g', { tabindex: 0, role: 'slider', 'aria-label': 'Horas de ' + (pt.titulo || ''), 'aria-valuenow': cap, 'aria-valuemin': 0 }, lay.top);
          lid.style.cursor = 'ns-resize';
          el('rect', { x: gx - 10, y: rimY - 11, width: w + 20, height: 10, rx: 5, fill: corLiq }, lid);
          el('rect', { x: gx + w / 2 - 14, y: rimY - 18, width: 28, height: 7, rx: 3.5, fill: '#e0dcff' }, lid);
          bindLid(lid, pt.chave, cap, k, svg, opts);
        }

        if (pt.rodape != null) el('text', { x: cx, y: base + 22, 'text-anchor': 'middle', fill: pt.rodapeCor || 'var(--text)', 'font-size': 15, 'font-weight': 800, 'font-family': FONT }, lay.top).textContent = pt.rodape;
        if (pt.rodape2 != null) el('text', { x: cx, y: base + 38, 'text-anchor': 'middle', fill: pt.rodape2Cor || 'var(--muted)', 'font-size': 11, 'font-family': FONT }, lay.top).textContent = pt.rodape2;
      })(P[i], pos[i], i);
    }
    el('line', { x1: 0, x2: totalW, y1: base + 3, y2: base + 3, stroke: 'var(--border)' }, lay.top);

    for (bk in bodies) { if (has(bodies, bk) && !has(live, bk)) delete bodies[bk]; }
    jarState = { svg: svg, jars: jars, base: base, k: k, gap: jgap };
    kick(still_);
  }

  function bindLid(lid, chave, cap0, k, svg, opts) {
    function step(n, final) { if (opts.aoTampa) opts.aoTampa(chave, n, final); }
    lid.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var y0 = e.clientY, vb = svg.viewBox.baseVal, last = cap0;
      var sc = svg.getBoundingClientRect().height / vb.height || 1;
      function mv(ev) {
        var n = Math.max(0, Math.round((cap0 + (y0 - ev.clientY) / sc / k) / 5) * 5);
        if (n !== last) { last = n; step(n, false); }
      }
      function up() {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        step(last, true);
      }
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    lid.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(Math.max(0, cap0 + (e.key === 'ArrowUp' ? 5 : -5)), true);
      }
    });
  }

  /* ---------- fisica ---------- */
  function stepSim() {
    var byJar = {}, key, b, vx, vy, j, L, i, q, a, c, it;
    for (key in bodies) {
      if (!has(bodies, key)) continue;
      b = bodies[key];
      vx = clamp((b.x - b.px) * 0.97, -12, 12); vy = clamp((b.y - b.py) * 0.97, -12, 12);
      b.px = b.x; b.py = b.y; b.x += vx; b.y += vy + 0.32;
      (byJar[b.jar] = byJar[b.jar] || []).push(b);
    }
    for (it = 0; it < 3; it++) {
      for (j in byJar) {
        if (!has(byJar, j)) continue;
        L = byJar[j];
        for (i = 0; i < L.length; i++) {
          for (q = i + 1; q < L.length; q++) {
            a = L[i]; c = L[q];
            var dx = c.x - a.x, dy = c.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 0.01, m = a.r + c.r + 1;
            if (dist < m) {
              var ov = m - dist, wa = c.r * c.r / (a.r * a.r + c.r * c.r), ux = dx / dist, uy = dy / dist;
              a.x -= ux * ov * wa; a.y -= uy * ov * wa; c.x += ux * ov * (1 - wa); c.y += uy * ov * (1 - wa);
            }
          }
        }
        for (i = 0; i < L.length; i++) {
          b = L[i];
          b.x = clamp(b.x, b.x0 + b.r, b.x1 - b.r);
          if (b.y > b.floor - b.r) b.y = b.floor - b.r;
        }
      }
    }
  }
  function paintBodies() {
    var key, b;
    for (key in bodies) {
      if (!has(bodies, key)) continue;
      b = bodies[key];
      if (!b.el) continue;
      b.el.setAttribute('cx', b.x); b.el.setAttribute('cy', b.y);
      if (b.arc) { b.arc.setAttribute('cx', b.x); b.arc.setAttribute('cy', b.y); b.arc.setAttribute('transform', 'rotate(-90 ' + b.x + ' ' + b.y + ')'); }
      if (b.txt) { b.txt.setAttribute('x', b.x); b.txt.setAttribute('y', b.y + 4); }
    }
  }
  function loop() {
    for (var s = 0; s < 3; s++) stepSim();
    paintBodies();
    if (--simLeft > 0) requestAnimationFrame(loop); else running = false;
  }
  function kick(settle) {
    var i;
    if (settle) { for (i = 0; i < 900; i++) stepSim(); paintBodies(); return; }
    simLeft = 420; paintBodies();
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  window.PlanoViz = { grade: grade, potes: potes, realcar: realcar };
})();
