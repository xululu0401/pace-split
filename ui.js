/* 先算配速再开跑 · 界面（经典脚本，依赖 window.AppCore） */
(function () {
  'use strict';
  var A = window.AppCore;
  var LS_KEY = 'pace-split-v1';
  var FILE_BASE = '先算配速再开跑';
  var CFG = A.defaults();
  var RES = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function num(v) { var n = Number(String(v === undefined || v === null ? '' : v).replace(/[,，\s]/g, '')); return isFinite(n) ? n : NaN; }
  function stamp() {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
  }
  function getPath(o, p) { var ps = p.split('.'), x = o; for (var i = 0; i < ps.length; i++) { if (x == null) return undefined; x = x[ps[i]]; } return x; }
  function setPath(o, p, v) { var ps = p.split('.'), x = o; for (var i = 0; i < ps.length - 1; i++) { if (x[ps[i]] == null) x[ps[i]] = {}; x = x[ps[i]]; } x[ps[ps.length - 1]] = v; }

  /* ── 表单 ↔ 配置 ── */
  function formToCfg() {
    var preset = chipVal('chips-target', CFG.target.preset);
    return {
      unit: chipVal('chips-unit', CFG.unit),
      known: { dist: num($('in-known-dist').value), time: $('in-known-time').value.trim() },
      target: { preset: preset, dist: preset === 'custom' ? num($('in-target-dist').value) : num($('in-target-dist').value) },
      k: num($('in-k').value),
      strategy: chipVal('chips-strategy', CFG.strategy),
      xPct: num($('in-x').value),
      splitEvery: num(chipVal('chips-split', String(CFG.splitEvery))),
      goal: { use: $('chk-goal').checked, time: $('in-goal').value.trim() }
    };
  }
  function cfgToForm(c) {
    CFG = A.normCfg(c);
    $('in-known-dist').value = trimNum(CFG.known.dist);
    $('in-known-time').value = CFG.known.time;
    $('in-target-dist').value = trimNum(CFG.target.dist);
    $('in-k').value = trimNum(CFG.k);
    $('in-x').value = trimNum(CFG.xPct);
    $('in-goal').value = CFG.goal.time;
    $('chk-goal').checked = !!CFG.goal.use;
    setChip('chips-unit', CFG.unit);
    setChip('chips-target', CFG.target.preset);
    setChip('chips-strategy', CFG.strategy);
    setChip('chips-split', String(CFG.splitEvery));
  }
  function trimNum(v) {
    if (typeof v !== 'number' || !isFinite(v)) return String(v == null ? '' : v);
    var s = Number(v.toFixed(6));
    return String(s);
  }
  function chipVal(id, fb) {
    var box = $(id); if (!box) return fb;
    var on = box.querySelector('[aria-pressed="true"]');
    return on ? on.getAttribute('data-v') : fb;
  }
  function setChip(id, v) {
    var box = $(id); if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-v]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(v)));
    });
  }
  function bindChips(id, onPick) {
    var box = $(id); if (!box) return;
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-v]'); if (!b) return;
      var before = chipVal(id, null);
      setChip(id, b.getAttribute('data-v'));
      var after = chipVal(id, null);
      if (onPick) onPick(after, before); else render();
    });
  }

  /* ── 选择器内容 ── */
  function buildChips() {
    var u = $('chips-unit');
    clear(u);
    [['km', '公里 / 分钟·公里'], ['mi', '英里 / 分钟·英里']].forEach(function (p) {
      var b = el('button', 'chip', p[1]); b.type = 'button'; b.setAttribute('data-v', p[0]); b.setAttribute('aria-pressed', 'false'); u.appendChild(b);
    });
    var t = $('chips-target');
    clear(t);
    A.PRESETS.forEach(function (p) {
      var b = el('button', 'chip', p.label + (p.km ? '（' + p.km + ' km）' : '')); b.type = 'button'; b.setAttribute('data-v', p.id); t.appendChild(b);
    });
    var s = $('chips-split');
    clear(s);
    A.LIMITS.splitChoices.forEach(function (n) {
      var b = el('button', 'chip', n + ' '); b.type = 'button'; b.setAttribute('data-v', String(n)); b.setAttribute('data-n', String(n)); s.appendChild(b);
    });
    var st = $('chips-strategy');
    clear(st);
    [['uniform', '匀速'], ['negative', '负分段（前慢后快）'], ['positive', '正分段（前快后慢）']].forEach(function (p) {
      var b = el('button', 'chip', p[1]); b.type = 'button'; b.setAttribute('data-v', p[0]); st.appendChild(b);
    });
    var sc = $('chips-scenarios');
    clear(sc);
    A.SCENARIOS.forEach(function (x) {
      var b = el('button', 'chip sm', x.label); b.type = 'button'; b.setAttribute('data-sc', x.id); sc.appendChild(b);
    });
    sc.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-sc]'); if (!b) return;
      var x = A.SCENARIOS.filter(function (y) { return y.id === b.getAttribute('data-sc'); })[0];
      if (!x) return;
      var c = A.defaults();
      Object.keys(x.patch).forEach(function (k) { setPath(c, k, x.patch[k]); });
      cfgToForm(c); syncUnitLabels(); render();
    });
  }
  function syncUnitLabels() {
    var unit = CFG.unit === 'mi' ? 'mi' : 'km';
    var d = unit === 'mi' ? '英里' : '公里';
    $('u-known').textContent = d; $('u-target').textContent = d; $('u-split').textContent = d;
    $('fb-unit').textContent = d;
    var sp = $('chips-split');
    Array.prototype.forEach.call(sp.querySelectorAll('[data-v]'), function (b) { b.textContent = b.getAttribute('data-n') + ' ' + d; });
  }

  /* ── 渲染 ── */
  function render() {
    CFG = formToCfg();
    RES = A.compute(CFG);
    syncUnitLabels();
    $('wrap-target-custom').classList.toggle('hidden', CFG.target.preset !== 'custom');
    $('wrap-x').classList.toggle('hidden', CFG.strategy === 'uniform');
    $('fb-sc').textContent = RES.fatal ? '—' : (RES.checks.length - RES.selfFail) + '/' + RES.checks.length;
    markBad();
    renderErr(RES);
    if (RES.fatal) {
      clear($('verdict')); clear($('axis')); clear($('split-body'));
      clear($('advice')); clear($('sens-k-body')); clear($('sens-p-body')); clear($('family-body'));
      clear($('rev-body')); clear($('self-body')); renderHow(null);
      save();
      return;
    }
    renderVerdict(RES);
    drawAxis(RES);
    renderSplits(RES);
    renderAdvice(RES);
    renderSens(RES);
    renderRev(RES);
    renderSelf(RES);
    renderHow(RES);
    save();
  }
  function markBad() {
    ['in-known-dist', 'in-known-time', 'in-target-dist', 'in-k', 'in-x', 'in-goal'].forEach(function (id) { $(id).classList.remove('bad'); });
    if (!RES || !RES.fatal) return;
    RES.errors.forEach(function (e) {
      var id = { 'known.dist': 'in-known-dist', 'known.time': 'in-known-time', 'target.dist': 'in-target-dist', 'k': 'in-k', 'xPct': 'in-x', 'goal.time': 'in-goal' }[e.field];
      if (id && $(id)) $(id).classList.add('bad');
    });
  }
  function renderErr(v) {
    var box = $('err');
    clear(box);
    if (!v || !v.fatal) return;
    var d = el('div', 'errbox');
    d.appendChild(el('h4', null, '还有 ' + v.errors.length + ' 处要改（改了就会自动重算）'));
    var ul = el('ul');
    var seen = {};
    v.errors.forEach(function (e) {
      if (seen[e.msg]) return; seen[e.msg] = 1;
      ul.appendChild(el('li', null, e.msg));
    });
    d.appendChild(ul);
    box.appendChild(d);
  }
  function renderVerdict(v) {
    var host = $('verdict');
    clear(host);
    var t = el('div', 'ticket');
    var r1 = el('div', 'row1');
    r1.appendChild(el('div', 'big', A.fmtHMS(v.T2Sec)));
    r1.appendChild(el('div', 'bigsub', '预测完赛时间'));
    t.appendChild(r1);
    var sub = el('div', 'bigsub');
    sub.textContent = '这是把 ' + A.fmtNum(v.D1, 4) + ' ' + A.unitLabel(v.unit) + ' 的 ' + A.fmtHMS(v.T1Sec) +
      '，按 k = ' + v.k + ' 放大到 ' + A.fmtNum(v.D2, 4) + ' ' + A.unitLabel(v.unit) +
      (v.unit === 'km' ? '' : '（= ' + A.fmtNum(v.D2Km, 4) + ' 公里）') + '的结果。';
    t.appendChild(sub);

    var kp = el('div', 'kpis');
    kp.appendChild(kpi('平均配速', A.fmtPace(v.p2Sec), '分钟/' + A.unitLabel(v.unit) + '（' + A.fmtNum(v.p2Sec, 3) + ' 秒）'));
    kp.appendChild(kpi('平均速度', A.fmtNum(v.vKmh, 2) + ' km/h', A.fmtNum(v.vMph, 2) + ' mph'));
    kp.appendChild(kpi('半程点累计', A.fmtHMS(v.halfSec), v.strategy === 'uniform' ? '匀速口径' : ('匀速时是 ' + A.fmtHMS(v.halfUniformSec) + '，多花 ' + A.fmtDelta(v.halfExtraSec))));
    kp.appendChild(kpi('分段', v.nSeg + ' 段', '每 ' + A.fmtNum(v.gDisplay, 4) + ' ' + A.unitLabel(v.unit) + (v.splits[v.nSeg - 1].partial ? '（末段 ' + A.fmtNum(v.splits[v.nSeg - 1].dist, 3) + '）' : '')));
    t.appendChild(kp);

    if (v.strategy !== 'uniform') {
      t.appendChild(el('div', 'note', (v.strategy === 'negative' ? '负分段' : '正分段') + '（' + v.xPct + '%）：前半程配速 ' +
        A.fmtPace(v.pASec) + '、后半程 ' + A.fmtPace(v.pBSec) + '，总时间与匀速完全相同 —— 前半程慢的每一秒，都要在后半程找回来。'));
    }
    if (v.ratio > 3) {
      t.appendChild(el('div', 'note', '注意：目标距离是已知成绩的 ' + A.fmtNum(v.ratio, 2) + ' 倍（> 3 倍），幂律外推在这种跨度上误差会放大，页面如实提示、不做修正。'));
    }
    if (v.rev && v.rev.use) {
      t.appendChild(el('div', 'note', '目标 ' + A.fmtHMS(v.rev.goalSec) + '：需要平均配速 ' + A.fmtPace(v.rev.needPaceSec) +
        ' 分钟/' + A.unitLabel(v.unit) + '（' + A.fmtNum(v.rev.needSpeedKmh, 2) + ' km/h），比上面这个预测每' + A.unitLabel(v.unit) +
        (v.rev.fasterPerKm >= 0 ? '快 ' : '慢 ') + A.fmtNum(Math.abs(v.rev.fasterPerKm), 2) + ' 秒。'));
    }
    host.appendChild(t);
  }
  function kpi(k, v, s) {
    var d = el('div', 'kpi');
    d.appendChild(el('div', 'k', k));
    d.appendChild(el('div', 'v', v));
    if (s) d.appendChild(el('div', 's', s));
    return d;
  }

  /* ── 赛程轴 ── */
  function drawAxis(v) {
    var host = $('axis');
    clear(host);
    var W = host.clientWidth || 760;
    var narrow = W < 620;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (!narrow) {
      var n = v.nSeg, VW = 1000, VH = 176;
      svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
      var x0 = 10, x1 = VW - 10, span = x1 - x0;
      var xs = function (km) { return x0 + span * (km / v.D2Km); };
      var minPace = Math.min.apply(null, v.splits.map(function (s) { return s.paceSec; }));
      var maxPace = Math.max.apply(null, v.splits.map(function (s) { return s.paceSec; }));
      var shade = function (p) {
        if (maxPace - minPace < 1e-9) return '#dce6f7';
        var t = (p - minPace) / (maxPace - minPace);
        var a = 0.16 + 0.5 * t;
        return 'rgba(43,79,158,' + a.toFixed(3) + ')';
      };
      var every = Math.max(1, Math.ceil(n / 8));
      v.splits.forEach(function (s, i) {
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        g.setAttribute('x', xs(s.fromKm).toFixed(2)); g.setAttribute('y', '52');
        g.setAttribute('width', Math.max(1, (xs(s.toKm) - xs(s.fromKm)) - 1.2).toFixed(2)); g.setAttribute('height', '44');
        g.setAttribute('rx', '4'); g.setAttribute('fill', shade(s.paceSec));
        svg.appendChild(g);
        var label = (i % every === 0 || i === n - 1);
        if (label) {
          var t1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          t1.setAttribute('x', ((xs(s.fromKm) + xs(s.toKm)) / 2).toFixed(2)); t1.setAttribute('y', '44');
          t1.setAttribute('text-anchor', 'middle'); t1.setAttribute('font-size', '17'); t1.setAttribute('fill', '#1b356f');
          t1.textContent = A.fmtPace(s.paceSec);
          svg.appendChild(t1);
          var t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          t2.setAttribute('x', ((xs(s.fromKm) + xs(s.toKm)) / 2).toFixed(2)); t2.setAttribute('y', '118');
          t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('font-size', '15'); t2.setAttribute('fill', '#4b5359');
          t2.textContent = A.fmtHMS(s.cumSec);
          svg.appendChild(t2);
        }
        if (i < n - 1) {   // 最后一段的起点刻度会与右下角的终点标签压在一起，跳过
          var t3 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          t3.setAttribute('x', xs(s.fromKm).toFixed(2)); t3.setAttribute('y', '146');
          t3.setAttribute('text-anchor', 'start'); t3.setAttribute('font-size', '13'); t3.setAttribute('fill', '#7b848a');
          t3.textContent = (Math.abs(s.from - Math.round(s.from)) < 1e-9 ? String(Math.round(s.from)) : A.fmtNum(s.from, 1));
          svg.appendChild(t3);
        }
      });
      var last = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      last.setAttribute('x', x1.toFixed(2)); last.setAttribute('y', '146'); last.setAttribute('text-anchor', 'end');
      last.setAttribute('font-size', '13'); last.setAttribute('fill', '#7b848a');
      last.textContent = A.fmtNum(v.D2, 3) + ' ' + A.unitLabel(v.unit);
      svg.appendChild(last);
      var mx = xs(v.D2Km / 2);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', mx.toFixed(2)); line.setAttribute('x2', mx.toFixed(2));
      line.setAttribute('y1', '46'); line.setAttribute('y2', '102');
      line.setAttribute('stroke', '#c8552b'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-dasharray', '6 5');
      svg.appendChild(line);
      var mt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      mt.setAttribute('x', mx.toFixed(2)); mt.setAttribute('y', '166'); mt.setAttribute('text-anchor', 'middle');
      mt.setAttribute('font-size', '14'); mt.setAttribute('fill', '#8f3a1c');
      mt.textContent = '半程 ' + A.fmtHMS(v.halfSec);
      svg.appendChild(mt);
      var t0 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t0.setAttribute('x', x0.toFixed(2)); t0.setAttribute('y', '166'); t0.setAttribute('text-anchor', 'start');
      t0.setAttribute('font-size', '13'); t0.setAttribute('fill', '#7b848a');
      t0.textContent = '出发';
      svg.appendChild(t0);
      host.appendChild(svg);
      var lg = el('div', 'axlegend');
      lg.innerHTML = '<span><i style="background:rgba(43,79,158,.2)"></i>浅＝这段配速快</span>' +
        '<span><i style="background:rgba(43,79,158,.66)"></i>深＝这段配速慢</span>' +
        '<span><i style="background:#c8552b"></i>虚线＝半程点</span>' +
        '<span>格子上方是段配速，格子下方是跑完这段的累计时间</span>';
      host.appendChild(lg);
    } else {
      var n2 = v.nSeg, VW2 = 420, rowH = 54, VH2 = n2 * rowH + 16;
      svg.setAttribute('viewBox', '0 0 ' + VW2 + ' ' + VH2);
      v.splits.forEach(function (s, i) {
        var y = i * rowH + 6;
        var isHalf = (s.fromKm <= v.D2Km / 2 && s.toKm > v.D2Km / 2);
        var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', '3'); bg.setAttribute('y', y.toFixed(1)); bg.setAttribute('width', String(VW2 - 6)); bg.setAttribute('height', String(rowH - 8));
        bg.setAttribute('rx', '7');
        bg.setAttribute('fill', isHalf ? '#fdeee8' : '#f4f7fc');
        if (isHalf) { bg.setAttribute('stroke', '#c8552b'); bg.setAttribute('stroke-width', '2'); }
        svg.appendChild(bg);
        var t1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t1.setAttribute('x', '14'); t1.setAttribute('y', (y + 21).toFixed(1)); t1.setAttribute('font-size', '19'); t1.setAttribute('fill', '#15181c');
        t1.textContent = '第 ' + s.i + ' 段 · ' + A.fmtNum(s.from, 3) + '–' + A.fmtNum(s.to, 3) + ' ' + A.unitLabel(v.unit);
        svg.appendChild(t1);
        var t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t2.setAttribute('x', '14'); t2.setAttribute('y', (y + 42).toFixed(1)); t2.setAttribute('font-size', '18'); t2.setAttribute('fill', '#1b356f');
        t2.textContent = '配速 ' + A.fmtPace(s.paceSec) + ' · 跑完累计 ' + A.fmtHMS(s.cumSec);
        svg.appendChild(t2);
      });
      host.appendChild(svg);
      var lg2 = el('div', 'axlegend');
      lg2.innerHTML = '<span>从上到下就是赛程顺序；每行右边是这段配速与跑完的累计时间</span><span><i style="background:#fdeee8;border:1px solid #c8552b"></i>含半程点的那一段</span>';
      host.appendChild(lg2);
    }
  }

  function renderSplits(v) {
    var b = $('split-body');
    clear(b);
    v.splits.forEach(function (s) {
      var tr = el('tr');
      if (s.fromKm <= v.D2Km / 2 && s.toKm > v.D2Km / 2) tr.className = 'half';
      tr.appendChild(td(String(s.i), 'num', '段'));
      tr.appendChild(td(A.fmtNum(s.from, 3) + ' – ' + A.fmtNum(s.to, 3) + ' ' + A.unitLabel(v.unit), '', '区间'));
      tr.appendChild(td(A.fmtNum(s.dist, 3), 'num', '段距离'));
      tr.appendChild(td(A.fmtPace(s.paceSec), 'num', '段配速'));
      tr.appendChild(td(A.fmtHMS(s.segSec), 'num', '段用时'));
      tr.appendChild(td(A.fmtHMS(s.cumSec), 'num', '累计时间'));
      b.appendChild(tr);
    });
    if (!v.splits.length) b.appendChild(el('tr', null, '没有分段'));
  }
  function td(txt, cls, label) {
    var d = el('td', cls || null, txt);
    if (label) d.setAttribute('data-l', label);
    return d;
  }

  function renderAdvice(v) {
    var host = $('advice');
    clear(host);
    /* 「每单位快 5 秒」不是一个能直接填进去的字段，但它等价于把 k 调小到某个值：
       p₂ = p₁·(D₂/D₁)^(k−1)  →  k = 1 + ln(p₂/p₁)/ln(D₂/D₁)。页面把解出来的 k 直接写进按钮文字，不做假承诺。 */
    var kFast = 1 + Math.log((v.p2Sec - 5) / v.p1Sec) / Math.log(v.ratio);
    var kFastOk = isFinite(kFast) && kFast >= A.LIMITS.kMin && kFast <= A.LIMITS.kMax && Math.abs(v.ratio - 1) > 1e-12;
    var list = [];
    if (v.strategy !== 'negative') list.push({ t: '改成负分段 5%（前慢后快）', patch: { strategy: 'negative', xPct: 5 } });
    if (v.strategy !== 'uniform') list.push({ t: '改回匀速', patch: { strategy: 'uniform' } });
    if (Math.abs(v.k - 1) > 1e-9) list.push({ t: '改成等速外推 k = 1.00', patch: { k: 1 } });
    if (Math.abs(v.k - 1.06) > 1e-9) list.push({ t: 'k 改回 1.06', patch: { k: 1.06 } });
    if (kFastOk) list.push({ t: '平均配速快 5 秒（把 k 调到 ' + kFast.toFixed(4) + '）', patch: { k: Number(kFast.toFixed(4)) } });
    if (v.rev && v.rev.use) list.push({ t: '目标时间改成 3:30:00', patch: { 'goal.use': true, 'goal.time': '3:30:00' } });
    if (v.cfg.target.preset !== 'half') list.push({ t: '目标换成半马', patch: { 'target.preset': 'half' } });
    if (v.cfg.target.preset !== 'full') list.push({ t: '目标换成全马', patch: { 'target.preset': 'full' } });
    list.push({ t: '每 1 ' + A.unitLabel(v.unit) + ' 一段（看细一点）', patch: { splitEvery: 1 } });
    if (v.nSeg > 3) list.push({ t: '改成每 10 ' + A.unitLabel(v.unit) + ' 一段', patch: { splitEvery: 10 } });
    if (v.cfg.unit === 'km') list.push({ t: '换成英里口径', patch: null, act: 'toMi' });
    else list.push({ t: '换回公里口径', patch: null, act: 'toKm' });

    list.forEach(function (x) {
      var b = el('button', 'chip sm', x.t);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (x.act === 'toMi' || x.act === 'toKm') {
          var c2 = formToCfg();
          var to = x.act === 'toMi' ? 'mi' : 'km';
          if (to !== c2.unit) {
            var f = A.MI_KM;
            c2.known.dist = to === 'mi' ? c2.known.dist / f : c2.known.dist * f;
            if (c2.target.preset === 'custom') c2.target.dist = to === 'mi' ? c2.target.dist / f : c2.target.dist * f;
            c2.unit = to;
            if (A.LIMITS.splitChoices.indexOf(c2.splitEvery) < 0) c2.splitEvery = 5;
          }
          cfgToForm(c2); render(); return;
        }
        var c3 = formToCfg();
        Object.keys(x.patch).forEach(function (k) { setPath(c3, k, x.patch[k]); });
        cfgToForm(c3); render();
      });
      host.appendChild(b);
    });
  }

  function renderSens(v) {
    var kb = $('sens-k-body'); clear(kb);
    v.sensK.forEach(function (s) {
      var tr = el('tr');
      if (Math.abs(s.k - v.k) < 1e-12) tr.className = 'base';
      tr.appendChild(td(s.k.toFixed(2), 'num', 'k'));
      tr.appendChild(td(A.fmtHMS(s.sec), 'num', '预测时间'));
      tr.appendChild(td(Math.abs(s.deltaSec) < 1e-9 ? '基准' : A.fmtDelta(s.deltaSec), 'num', '与当前的差'));
      tr.appendChild(td(A.fmtPace(s.sec / v.D2Km), 'num', '平均配速'));
      kb.appendChild(tr);
    });
    var pb = $('sens-p-body'); clear(pb);
    v.sensPace.forEach(function (s) {
      var tr = el('tr');
      if (s.delta === 0) tr.className = 'base';
      tr.appendChild(td((s.delta > 0 ? '+' : '') + s.delta + ' 秒/' + A.unitLabel(v.unit), '', '配速变化'));
      tr.appendChild(td(A.fmtPace(s.paceSec), 'num', '配速'));
      tr.appendChild(td(A.fmtHMS(s.sec), 'num', '预测时间'));
      tr.appendChild(td(s.delta === 0 ? '基准' : A.fmtDelta(s.deltaSec), 'num', '总时间差'));
      pb.appendChild(tr);
    });
    var fb = $('family-body'); clear(fb);
    v.family.forEach(function (f) {
      var tr = el('tr');
      if (f.isTarget) tr.className = 'base';
      tr.appendChild(td(f.label + '（' + A.fmtNum(f.dist, 4) + ' ' + A.unitLabel(v.unit) + '）' + (f.isTarget ? ' ← 当前目标' : ''), '', '距离'));
      tr.appendChild(td(A.fmtHMS(f.sec), 'num', '预测时间'));
      tr.appendChild(td(A.fmtPace(f.paceSec), 'num', '平均配速'));
      fb.appendChild(tr);
    });
  }

  function renderRev(v) {
    var host = $('rev-body');
    clear(host);
    if (!v.rev || !v.rev.use) {
      host.appendChild(el('div', 'note', '没有启用目标时间。勾上「目标时间」并填一个时间，这里会算出需要的配速与速度。'));
      return;
    }
    var t = el('div', 'ticket');
    var r1 = el('div', 'row1');
    r1.appendChild(el('div', 'big', A.fmtPace(v.rev.needPaceSec)));
    r1.appendChild(el('div', 'bigsub', '需要的平均配速（分钟/' + A.unitLabel(v.unit) + '）'));
    t.appendChild(r1);
    var kp = el('div', 'kpis');
    kp.appendChild(kpi('目标时间', A.fmtHMS(v.rev.goalSec), '你填的目标'));
    kp.appendChild(kpi('所需速度', A.fmtNum(v.rev.needSpeedKmh, 2) + ' km/h', A.fmtNum(v.rev.needSpeedKmh / A.MI_KM, 2) + ' mph'));
    kp.appendChild(kpi('比预测' + (v.rev.fasterTotalSec >= 0 ? '快' : '慢'), A.fmtDelta(Math.abs(v.rev.fasterTotalSec)), '每' + A.unitLabel(v.unit) + '要' + (v.rev.fasterPerKm >= 0 ? '快' : '慢') + ' ' + A.fmtNum(Math.abs(v.rev.fasterPerKm), 2) + ' 秒'));
    kp.appendChild(kpi('等价成绩', A.fmtHMS(v.rev.equivT1Sec), '在 ' + A.fmtNum(v.D1, 4) + ' ' + A.unitLabel(v.unit) + ' 上'));
    t.appendChild(kp);
    var n = el('div', 'note');
    n.innerHTML = '把同一份成绩按同一条幂律反解回去，得到的就是「要在这个距离上跑出目标时间，等价于在 ' +
      A.fmtNum(v.D1, 4) + ' ' + A.unitLabel(v.unit) + ' 上跑 <b>' + A.fmtHMS(v.rev.equivT1Sec) + '</b>」。' +
      '这一条同时是自检项：反解回代应当精确得到你填的成绩 ' + A.fmtHMS(v.T1Sec) + '。';
    t.appendChild(n);
    host.appendChild(t);
  }

  function renderSelf(v) {
    var host = $('self-body');
    clear(host);
    v.checks.forEach(function (c) {
      var d = el('div', 'selfrow');
      d.appendChild(el('span', c.ok ? 's-ok' : 's-no', c.ok ? '✓' : '✗'));
      var t = el('div', 's-t');
      t.appendChild(document.createTextNode(c.name));
      if (c.detail) t.appendChild(el('em', null, '　' + c.detail));
      d.appendChild(t);
      host.appendChild(d);
    });
  }

  function renderHow(v) {
    var host = $('how-body');
    clear(host);
    var L = [];
    L.push('**幂律外推**：T₂ = T₁ × (D₂ / D₁)^k。k = 1 时就是「配速不变、按距离线性放大」；k 越大，距离拉长带来的变慢越多。');
    L.push('**等价写法**：p₂ = p₁ × (D₂ / D₁)^(k−1)。两条式子必须给出同一个数（这是自检第 2 条）。');
    L.push('**平均配速 / 速度**：p = T ÷ D（秒/单位）；v = 3600 ÷ p（p 用秒/公里时 v 是 km/h）。');
    L.push('**分钟/英里**：p(mi) = p(km) × 1.609344；mph = km/h ÷ 1.609344。');
    L.push('**分段（每 g 一段，末段可不满）**：匀速时每段用时 = 段距离 × 平均配速；负分段时前半程配速 p_A = p̄(1+x)、后半程 p_B = p̄(1−x)，跨过半程的那一段按段内前后半各自的距离分别计时。');
    L.push('**恒等式**：(D₂/2)·p_A + (D₂/2)·p_B = T₂ —— 前后半程怎么分，总时间不变；半程点累计时间 = T₂(1+x)/2。');
    L.push('**反推**：目标时间 T目标 → 需要配速 p = T目标 ÷ D₂；同一条幂律反解回 D₁ 应当精确得到 T₁。');
    L.push('**「每公里快 5 秒」**：总时间减少 5 × D₂ 秒（与配速无关，只看距离）。');
    if (v) {
      L.push('**本次的数**：D₁ = ' + A.fmtNum(v.D1Km, 6) + ' 公里、T₁ = ' + A.fmtNum(v.T1Sec, 3) + ' 秒、D₂ = ' + A.fmtNum(v.D2Km, 6) +
        ' 公里、k = ' + v.k + '、D₂/D₁ = ' + A.fmtNum(v.ratio, 6) + '、T₂ = ' + A.fmtNum(v.T2Sec, 6) + ' 秒。');
      if (v.strategy !== 'uniform') L.push('**本次策略**：' + (v.strategy === 'negative' ? '负分段' : '正分段') + ' x = ' + v.xPct + '%，p_A = ' + A.fmtNum(v.pASec, 6) + ' 秒、p_B = ' + A.fmtNum(v.pBSec, 6) + ' 秒、p̄ = ' + A.fmtNum(v.p2Sec, 6) + ' 秒。');
    }
    var ul = el('ul', 'plain');
    L.forEach(function (s) {
      var li = el('li');
      li.innerHTML = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  /* ── 持久化 ── */
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, cfg: CFG, at: new Date().toISOString() }));
    } catch (e) { /* 隐私模式等：忽略 */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (o && o.cfg) return o.cfg;
    } catch (e) { }
    return null;
  }

  /* ── 导出 ── */
  function dl(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); } catch (e) { } URL.revokeObjectURL(url); }, 4000);
  }
  function dlCsv() { if (!RES || RES.fatal) return; dl(FILE_BASE + '-分段清单-' + stamp() + '.csv', '\ufeff' + A.toCSV(RES), 'text/csv;charset=utf-8'); }
  function dlMd() { if (!RES || RES.fatal) return; dl(FILE_BASE + '-笔记-' + stamp() + '.md', A.toMD(RES), 'text/markdown;charset=utf-8'); }
  function dlJson() {
    dl(FILE_BASE + '-备份-' + stamp() + '.json', JSON.stringify({ v: 1, at: new Date().toISOString(), cfg: CFG }, null, 2), 'application/json');
  }
  function drawCard(v) {
    var W = 1080, H = 1350, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#f1f3f6'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.fillRect(40, 40, W - 80, H - 80);
    g.strokeStyle = '#c6cfd6'; g.lineWidth = 2; g.strokeRect(40, 40, W - 80, H - 80);
    g.fillStyle = '#2b4f9e'; g.fillRect(40, 40, 8, H - 80);
    function TXT(t, x, y, s, col, bold, align) {
      g.fillStyle = col || '#15181c';
      g.font = (bold ? '700 ' : '') + s + 'px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      g.textAlign = align || 'left';
      g.fillText(t, x, y);
      g.textAlign = 'left';
    }
    TXT('先算配速再开跑', 84, 118, 46, '#15181c', true);
    TXT('一个成绩换到另一段距离 · 每段该跑到多少', 84, 160, 24, '#4b5359');
    g.strokeStyle = '#e1e6ea'; g.beginPath(); g.moveTo(84, 186); g.lineTo(W - 84, 186); g.stroke();

    TXT('预测完赛时间', 84, 254, 24, '#7b848a');
    TXT(A.fmtHMS(v.T2Sec), 84, 340, 92, '#1b356f', true);
    TXT(A.fmtNum(v.D2, 4) + ' ' + A.unitLabel(v.unit) + (v.unit === 'km' ? '' : '（= ' + A.fmtNum(v.D2Km, 4) + ' 公里）') + ' · k = ' + v.k, 84, 384, 24, '#4b5359');

    var yy = 424, colW = (W - 168 - 3 * 14) / 4;
    [['平均配速', A.fmtPace(v.p2Sec), '分钟/' + A.unitLabel(v.unit)],
    ['平均速度', A.fmtNum(v.vKmh, 2) + ' km/h', A.fmtNum(v.vMph, 2) + ' mph'],
    ['半程点累计', A.fmtHMS(v.halfSec), v.strategy === 'uniform' ? '匀速口径' : ('匀速 ' + A.fmtHMS(v.halfUniformSec))],
    ['分段', v.nSeg + ' 段', '每 ' + A.fmtNum(v.gDisplay, 3) + ' ' + A.unitLabel(v.unit)]
    ].forEach(function (p, i) {
      var x = 84 + i * (colW + 14);
      g.fillStyle = '#fafbfc'; g.fillRect(x, yy, colW, 118);
      g.strokeStyle = '#e1e6ea'; g.lineWidth = 1.5; g.strokeRect(x, yy, colW, 118);
      TXT(p[0], x + 14, yy + 32, 20, '#7b848a');
      TXT(p[1], x + 14, yy + 76, 30, '#15181c', true);
      TXT(p[2], x + 14, yy + 104, 19, '#7b848a');
    });

    if (v.strategy !== 'uniform') {
      TXT((v.strategy === 'negative' ? '负分段' : '正分段') + ' ' + v.xPct + '%：前半 ' + A.fmtPace(v.pASec) + ' / 后半 ' + A.fmtPace(v.pBSec) +
        '（总时间不变）', 84, 590, 24, '#8f3a1c');
    } else {
      TXT('匀速：每段配速都一样，段用时随段距离等比', 84, 590, 24, '#4b5359');
    }

    /* 迷你赛程轴 */
    var bx = 84, bw = W - 168, by = 636, bh = 74;
    var span = v.D2Km;
    var minP = Math.min.apply(null, v.splits.map(function (s) { return s.paceSec; }));
    var maxP = Math.max.apply(null, v.splits.map(function (s) { return s.paceSec; }));
    v.splits.forEach(function (s) {
      var x1 = bx + bw * (s.fromKm / span), x2 = bx + bw * (s.toKm / span);
      var t = (maxP - minP) < 1e-9 ? 0.3 : (s.paceSec - minP) / (maxP - minP);
      g.fillStyle = 'rgba(43,79,158,' + (0.18 + 0.5 * t).toFixed(3) + ')';
      g.fillRect(x1 + 1, by, Math.max(1, x2 - x1 - 2), bh);
    });
    var mx = bx + bw / 2;
    g.strokeStyle = '#c8552b'; g.lineWidth = 3; g.setLineDash([8, 6]);
    g.beginPath(); g.moveTo(mx, by - 12); g.lineTo(mx, by + bh + 12); g.stroke(); g.setLineDash([]);
    TXT('出发', bx, by + bh + 40, 20, '#7b848a');
    TXT('半程 ' + A.fmtHMS(v.halfSec), mx, by + bh + 40, 20, '#8f3a1c', false, 'center');
    TXT(A.fmtNum(v.D2, 3) + ' ' + A.unitLabel(v.unit), bx + bw, by + bh + 40, 20, '#7b848a', false, 'right');

    /* 分段前若干行 */
    TXT('分段（' + Math.min(5, v.nSeg) + ' / ' + v.nSeg + ' 段）', 84, 800, 26, '#15181c', true);
    var ry = 828;
    TXT('段', 84, ry, 21, '#7b848a'); TXT('区间', 150, ry, 21, '#7b848a');
    TXT('段配速', 470, ry, 21, '#7b848a'); TXT('段用时', 680, ry, 21, '#7b848a'); TXT('累计', 880, ry, 21, '#7b848a');
    ry += 14;
    g.strokeStyle = '#e1e6ea'; g.beginPath(); g.moveTo(84, ry); g.lineTo(W - 84, ry); g.stroke();
    var idxs = [];
    if (v.nSeg <= 5) { for (var i = 0; i < v.nSeg; i++) idxs.push(i); }
    else idxs = [0, 1, 2, Math.floor(v.nSeg / 2), v.nSeg - 1];
    idxs.forEach(function (i) {
      var s = v.splits[i]; ry += 44;
      TXT(String(s.i), 84, ry, 23, '#15181c');
      TXT(A.fmtNum(s.from, 2) + '–' + A.fmtNum(s.to, 2) + ' ' + A.unitLabel(v.unit), 150, ry, 23, '#15181c');
      TXT(A.fmtPace(s.paceSec), 470, ry, 23, '#1b356f', true);
      TXT(A.fmtHMS(s.segSec), 680, ry, 23, '#15181c');
      TXT(A.fmtHMS(s.cumSec), 880, ry, 23, '#15181c');
    });
    if (v.nSeg > 5) TXT('（中间段省略，完整分段看页面表格或导出 CSV）', 150, ry + 40, 20, '#7b848a');

    /* 底部 */
    var fy = H - 150;
    g.strokeStyle = '#e1e6ea'; g.beginPath(); g.moveTo(84, fy); g.lineTo(W - 84, fy); g.stroke();
    TXT('口径：距离按' + A.unitLabel(v.unit) + '、配速按分钟/' + A.unitLabel(v.unit) + '；1 英里 = 1.609344 公里；秒数四舍五入、累计按未取整值求和。', 84, fy + 40, 20, '#4b5359');
    TXT('自检 ' + (v.checks.length - v.selfFail) + '/' + v.checks.length + ' 通过 · 默认场景为虚构示例 · 页面不联网、不内置成绩库', 84, fy + 74, 20, '#4b5359');
    TXT('幂律指数 k 是可调旋钮，本页不引用任何研究或他人成绩来论证它。', 84, fy + 108, 20, '#7b848a');

    return c;
  }
  function dlPng() {
    if (!RES || RES.fatal) return;
    var c = drawCard(RES);
    var name = FILE_BASE + '-结果卡-' + stamp() + '.png';
    if (c.toBlob) {
      c.toBlob(function (b) {
        var url = URL.createObjectURL(b);
        var a = document.createElement('a'); a.href = url; a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function () { try { document.body.removeChild(a); } catch (e) { } URL.revokeObjectURL(url); }, 4000);
        var nt = $('dl-note'); if (nt) nt.textContent = '已导出：' + name;
      }, 'image/png');
    } else {
      var url2 = c.toDataURL('image/png');
      var a2 = document.createElement('a'); a2.href = url2; a2.download = name;
      document.body.appendChild(a2); a2.click();
      setTimeout(function () { try { document.body.removeChild(a2); } catch (e) { } }, 4000);
      var nt2 = $('dl-note'); if (nt2) nt2.textContent = '已导出：' + name;
    }
  }

  /* ── 绑定 ── */
  function bind() {
    ['in-known-dist', 'in-known-time', 'in-target-dist', 'in-k', 'in-x', 'in-goal'].forEach(function (id) {
      var n = $(id);
      n.addEventListener('input', render);
      n.addEventListener('change', render);
    });
    $('chk-goal').addEventListener('change', render);
    bindChips('chips-unit', function (after, before) {
      if (after === before) { render(); return; }
      var c = formToCfg(), f = A.MI_KM;
      c.unit = after;
      c.known.dist = after === 'mi' ? c.known.dist / f : c.known.dist * f;
      if (c.target.preset === 'custom') c.target.dist = after === 'mi' ? c.target.dist / f : c.target.dist * f;
      if (A.LIMITS.splitChoices.indexOf(c.splitEvery) < 0) c.splitEvery = 5;
      cfgToForm(c); render();
    });
    bindChips('chips-target');
    bindChips('chips-split');
    bindChips('chips-strategy');
    $('btn-calc').addEventListener('click', render);
    $('btn-calc2').addEventListener('click', render);
    $('btn-reset').addEventListener('click', function () { cfgToForm(A.defaults()); render(); });
    $('dl-csv').addEventListener('click', dlCsv);
    $('dl-md').addEventListener('click', dlMd);
    $('dl-json').addEventListener('click', dlJson);
    $('dl-png').addEventListener('click', dlPng);
    $('up-json').addEventListener('click', function () { $('file-json').click(); });
    $('file-json').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(String(fr.result));
          if (o && o.cfg) { cfgToForm(o.cfg); render(); var nt = $('dl-note'); if (nt) nt.textContent = '已导入备份：' + f.name; }
          else { var nt2 = $('dl-note'); if (nt2) nt2.textContent = '这个文件里没有 cfg 字段，没导入'; }
        } catch (e) {
          var nt3 = $('dl-note'); if (nt3) nt3.textContent = 'JSON 解析失败，没导入';
        }
        ev.target.value = '';
      };
      fr.readAsText(f);
    });
    var t = null;
    window.addEventListener('resize', function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () { if (RES && !RES.fatal) drawAxis(RES); }, 180);
    });
  }

  function boot() {
    buildChips();
    var saved = load();
    cfgToForm(saved || A.defaults());
    bind();
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
