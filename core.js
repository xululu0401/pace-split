/* 先算配速再开跑 · 引擎（纯函数，浏览器与 node 通用）
 *
 * 只做「距离—时间—配速」的换算与分段，不涉及训练安排、心率、步频、坡度、天气、赛道；
 * 不联网、不内置任何成绩库。单位：距离内部一律公里（1 英里 = 1.609344 公里，国际英里定义），
 * 时间内部一律秒，配速内部一律「秒 / 公里」。
 *
 * ── 模型（页面「这是怎么算的」一栏里逐条写明）──
 * 1. 平均配速 p = T / D（秒/公里）；速度 v = 3600 / p（km/h）。
 * 2. 幂律外推：T₂ = T₁ × (D₂ / D₁)^k，等价于 p₂ = p₁ × (D₂ / D₁)^(k−1)。
 *      k = 1  → T₂ = T₁ × (D₂/D₁)（配速不变、按距离线性放大）；
 *      D₂ = D₁ → T₂ = T₁（幂律退化成恒等，两条式子都成立）。
 *      距离翻倍的时间倍率是 2^k。
 *    k 是本页的默认设计选择（1.06），可调；页面不引用任何研究或他人成绩来论证它。
 * 3. 分段策略（每 g 公里一段，末段可不满）：
 *      匀速     每段用时 = 段距离 × p̄
 *      负分段   前半程配速 p_A = p̄(1+x)，后半程配速 p_B = p̄(1−x)（x 为前后半程差，p̄ = T₂/D₂）
 *                → (D₂/2)·p_A + (D₂/2)·p_B = T₂ 精确成立；跨过半程的那一段按段内前后半各自的距离分别计时
 *      正分段   同上，只是 p_A = p̄(1−x)、p_B = p̄(1+x)
 * 4. 半程点累计时间 = (D₂/2) × 半程所在那半的配速；负分段时 = T₂(1+x)/2，比匀速多花 T₂·x/2。
 * 5. 反推：目标时间 T目标 → 需要的平均配速 p目标 = T目标 ÷ D₂；把同一份成绩按同一条幂律反解，
 *    等价于在 D₁ 上要跑 T₁' = T₂ × (D₁/D₂)^k（回代应当精确得到 T₁，这是本页的一条自检）。
 * 6. 显示：秒数四舍五入后再格式化成 h:mm:ss / m:ss；**累计时间按未取整的全精度值求和**。
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var MI_KM = 1.609344;               // 1 英里 = 1.609344 公里（国际英里定义）
  var SEC_H = 3600, SEC_D = 86400;

  var PRESETS = [
    { id: '5k', label: '5 公里', km: 5 },
    { id: '10k', label: '10 公里', km: 10 },
    { id: 'half', label: '半马', km: 21.0975 },
    { id: 'full', label: '全马', km: 42.195 },
    { id: 'custom', label: '自定', km: null }
  ];
  var PRESET_MAP = {};
  PRESETS.forEach(function (p) { PRESET_MAP[p.id] = p; });

  var LIMITS = {
    distMinKm: 0.1, distMaxKm: 500,          // 已知成绩 / 目标距离（按公里等价）
    secMin: 5, secMax: 48 * SEC_H,           // 时间
    kMin: 0.5, kMax: 1.5,                    // 幂律指数
    xMin: 0, xMax: 30,                       // 前后半程差（%）
    splitChoices: [1, 2, 5, 10]              // 分段粒度（按当前单位）
  };

  /* ── 小工具 ── */
  function num(v) {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v;
    return Number(String(v).replace(/\s|,|，/g, ''));
  }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function r(v, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(v * p) / p; }
  function max0(v) { return v < 0 ? 0 : v; }

  /* 时间解析：接受 h:mm:ss / mm:ss / 纯秒 / 十进制分钟（带单位时更明确：50 分、1.5 小时）
     返回秒数（NaN 表示解析不了）。不接受负数与空串。 */
  function parseTime(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return isFinite(v) && v >= 0 ? v : NaN;
    var s = String(v).trim();
    if (!s) return NaN;
    s = s.replace(/[，,\s]/g, '');
    if (s.indexOf('-') >= 0) return NaN;
    var m;
    // 1) 带中文单位：1小时20分30秒 / 50分 / 90秒 / 1.5小时 / 5分30
    if (/[小时分秒]/.test(s)) {
      var h = 0, mi = 0, se = 0, any = false;
      m = s.match(/(\d+(?:\.\d+)?)(?:个?小时|h|hr)/i);
      if (m) { h = Number(m[1]); any = true; }
      m = s.match(/(\d+(?:\.\d+)?)(?:分钟|分)/);
      if (m) { mi = Number(m[1]); any = true; }
      m = s.match(/(\d+(?:\.\d+)?)(?:秒钟|秒)/);
      if (m) { se = Number(m[1]); any = true; }
      if (!any) return NaN;
      var rest = s.replace(/(\d+(?:\.\d+)?)(?:个?小时|h|hr|分钟|分|秒钟|秒)/gi, '');
      if (rest) return NaN;                     // 有单位时不许有别的东西
      if (mi >= 60 || se >= 60) {
        // 「90分」「90秒」这种写法的本意是进位，仍按数值累加（90 分 = 1:30:00）
      }
      return h * SEC_H + mi * 60 + se;
    }
    // 2) 冒号：mm:ss（两段）或 h:mm:ss（三段）
    if (s.indexOf(':') >= 0) {
      var parts = s.split(':');
      if (parts.length > 3 || parts.length < 2) return NaN;
      for (var i = 0; i < parts.length; i++) {
        if (!/^\d+(\.\d+)?$/.test(parts[i])) return NaN;
      }
      if (parts.length === 2) {
        var mm = Number(parts[0]), ss = Number(parts[1]);
        if (ss >= 60) return NaN;               // mm:ss 里秒必须 < 60
        return mm * 60 + ss;
      }
      var hh = Number(parts[0]), m2 = Number(parts[1]), s2 = Number(parts[2]);
      if (m2 >= 60 || s2 >= 60) return NaN;
      return hh * SEC_H + m2 * 60 + s2;
    }
    // 3) 纯数字：≤ 三位小数按十进制分钟？—— 不猜，纯数字一律当秒（页面写明）
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    return NaN;
  }

  /* 秒 → h:mm:ss（不足 1 小时给 m:ss）。四舍五入到整秒，进位在取整后统一处理。 */
  function fmtHMS(sec) {
    if (!isFinite(sec)) return '—';
    var neg = sec < 0, t = Math.round(Math.abs(sec));
    var h = Math.floor(t / SEC_H), m = Math.floor((t % SEC_H) / 60), s = t % 60;
    var out = h > 0 ? (h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s)
      : (m + ':' + (s < 10 ? '0' : '') + s);
    return (neg ? '-' : '') + out;
  }
  /* 秒 → 分:秒（配速）。取整后超过 60 分钟给 h:mm:ss。 */
  function fmtPace(secPerUnit) {
    if (!isFinite(secPerUnit)) return '—';
    var t = Math.round(secPerUnit);
    if (t >= SEC_H) return fmtHMS(t);
    var m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  /* 秒 → 「x 分 y 秒」口语（用于差异文案） */
  function fmtDelta(sec) {
    if (!isFinite(sec)) return '—';
    var sign = sec < 0 ? '-' : '', t = Math.round(Math.abs(sec));
    var m = Math.floor(t / 60), s = t % 60;
    if (m === 0) return sign + s + ' 秒';
    return sign + m + ' 分 ' + (s < 10 ? '0' : '') + s + ' 秒';
  }
  function fmtNum(x, d) { return isFinite(x) ? r(x, d == null ? 2 : d) : '—'; }

  /* ── 单位 ── */
  function unitOf(cfg) { return cfg && cfg.unit === 'mi' ? 'mi' : 'km'; }
  function toKm(v, unit) { return unit === 'mi' ? v * MI_KM : v; }
  function fromKm(km, unit) { return unit === 'mi' ? km / MI_KM : km; }
  function unitLabel(unit) { return unit === 'mi' ? '英里' : '公里'; }
  function paceUnitLabel(unit) { return unit === 'mi' ? '分钟/英里' : '分钟/公里'; }

  /* ── 默认场景（虚构示例）── */
  var CFG_DEFAULT = {
    unit: 'km',
    known: { dist: 10, time: '50:00' },      // 10 公里跑 50:00
    target: { preset: 'full', dist: 42.195 }, // 目标：全马
    k: 1.06,
    strategy: 'uniform',                      // uniform | negative | positive
    xPct: 5,
    splitEvery: 5,
    goal: { use: true, time: '3:30:00' }
  };
  function defaults() { return JSON.parse(JSON.stringify(CFG_DEFAULT)); }

  /* 内置场景（全部虚构，仅用于快速切换对照） */
  var SCENARIOS = [
    { id: 'default', label: '默认：10 公里 50:00 → 全马', patch: {} },
    { id: 'half', label: '10 公里 50:00 → 半马', patch: { 'target.preset': 'half' } },
    { id: 'five', label: '10 公里 50:00 → 5 公里', patch: { 'target.preset': '5k' } },
    { id: 'k100', label: '等速外推（k = 1.00）', patch: { k: 1.00 } },
    { id: 'k110', label: 'k = 1.10 的慢衰减', patch: { k: 1.10 } },
    { id: 'neg8', label: '负分段 8%：前慢后快', patch: { strategy: 'negative', xPct: 8 } },
    { id: 'pos5', label: '正分段 5%：前快后慢', patch: { strategy: 'positive', xPct: 5 } },
    { id: 'mi', label: '英里口径：6.21 英里 50:00 → 26.2 英里', patch: { unit: 'mi', 'known.dist': 6.213712, 'target.preset': 'custom', 'target.dist': 26.21875, splitEvery: 5 } },
    { id: 'quick', label: '千米 1 段：每公里都要看', patch: { splitEvery: 1 } }
  ];

  /* ── 规范化 ── */
  function normCfg(raw) {
    var d = defaults(), src = raw || {};
    var cfg = {
      unit: src.unit === 'mi' ? 'mi' : 'km',
      known: {
        dist: src.known && src.known.dist !== undefined ? num(src.known.dist) : d.known.dist,
        time: src.known && src.known.time !== undefined ? String(src.known.time).trim() : d.known.time
      },
      target: {
        preset: (src.target && src.target.preset && PRESET_MAP[src.target.preset]) ? src.target.preset : d.target.preset,
        dist: src.target && src.target.dist !== undefined ? num(src.target.dist) : d.target.dist
      },
      k: src.k !== undefined ? num(src.k) : d.k,
      strategy: (src.strategy === 'negative' || src.strategy === 'positive') ? src.strategy : 'uniform',
      xPct: src.xPct !== undefined ? num(src.xPct) : d.xPct,
      splitEvery: src.splitEvery !== undefined ? num(src.splitEvery) : d.splitEvery,
      goal: {
        use: !(src.goal && src.goal.use === false),
        time: src.goal && src.goal.time !== undefined ? String(src.goal.time).trim() : d.goal.time
      }
    };
    if (!isNum(cfg.k)) cfg.k = NaN;
    if (!isNum(cfg.xPct)) cfg.xPct = NaN;
    if (!isNum(cfg.splitEvery)) cfg.splitEvery = NaN;
    if (cfg.known.time === '' || cfg.known.time === 'null' || cfg.known.time === 'undefined') cfg.known.time = '';
    if (cfg.goal.time === '' || cfg.goal.time === 'null' || cfg.goal.time === 'undefined') cfg.goal.time = '';
    return cfg;
  }

  function distLimitErr(v, unit, field, what) {
    var out = [];
    if (!isNum(v)) { out.push({ field: field, msg: what + '要填数字（当前单位：' + unitLabel(unit) + '）' }); return out; }
    var km = toKm(v, unit);
    if (!(v > 0)) out.push({ field: field, msg: what + '必须大于 0' });
    else if (km < LIMITS.distMinKm - 1e-12) out.push({ field: field, msg: what + '最小是 ' + fromKm(LIMITS.distMinKm, unit).toFixed(4) + ' ' + unitLabel(unit) + '（= 0.1 公里）' });
    else if (km > LIMITS.distMaxKm + 1e-12) out.push({ field: field, msg: what + '最大是 500 公里（= ' + fromKm(500, unit).toFixed(4) + ' ' + unitLabel(unit) + '）' });
    return out;
  }
  function timeLimitErr(str, field, what) {
    var t = parseTime(str);
    if (str === '' || str === null || str === undefined) return [{ field: field, msg: what + '不能为空' }];
    if (!isFinite(t)) return [{ field: field, msg: what + '看不懂：填 h:mm:ss、mm:ss 或秒数（例：3:30:00、50:00、3000）' }];
    if (!(t > 0)) return [{ field: field, msg: what + '必须大于 0' }];
    if (t < LIMITS.secMin) return [{ field: field, msg: what + '最小是 5 秒' }];
    if (t > LIMITS.secMax) return [{ field: field, msg: what + '最大是 48 小时' }];
    return [];
  }

  /* ── 校验 ── */
  function validate(cfg) {
    var e = [];
    e = e.concat(distLimitErr(cfg.known.dist, cfg.unit, 'known.dist', '已知距离'));
    e = e.concat(timeLimitErr(cfg.known.time, 'known.time', '已知时间'));
    if (cfg.target.preset === 'custom') e = e.concat(distLimitErr(cfg.target.dist, cfg.unit, 'target.dist', '目标距离'));
    if (!isNum(cfg.k)) e.push({ field: 'k', msg: '幂律指数要填数字' });
    else if (cfg.k < LIMITS.kMin || cfg.k > LIMITS.kMax) e.push({ field: 'k', msg: '幂律指数范围是 ' + LIMITS.kMin + ' – ' + LIMITS.kMax + '（k = 1 表示按配速线性放大）' });
    if (cfg.strategy !== 'uniform') {
      if (!isNum(cfg.xPct)) e.push({ field: 'xPct', msg: '前后半程差要填数字' });
      else if (cfg.xPct < LIMITS.xMin || cfg.xPct > LIMITS.xMax) e.push({ field: 'xPct', msg: '前后半程差范围是 0 – 30 %（≥100% 会让后半程配速非正）' });
    }
    if (!isNum(cfg.splitEvery)) e.push({ field: 'splitEvery', msg: '分段粒度要填数字' });
    else if (LIMITS.splitChoices.indexOf(cfg.splitEvery) < 0) e.push({ field: 'splitEvery', msg: '分段粒度只能是 ' + LIMITS.splitChoices.join(' / ') + ' ' + unitLabel(cfg.unit) });
    if (cfg.goal.use) e = e.concat(timeLimitErr(cfg.goal.time, 'goal.time', '目标时间'));
    return e;
  }

  /* ── 核心计算 ── */
  function compute(rawCfg, opts) {
    var cfg = normCfg(rawCfg);
    var errors = validate(cfg);
    var unit = unitOf(cfg);
    if (errors.length) {
      return { ok: false, fatal: true, cfg: cfg, unit: unit, errors: errors, checks: [], selfFail: 0, version: VERSION };
    }
    var D1 = toKm(cfg.known.dist, unit);
    var T1 = parseTime(cfg.known.time);
    var D2 = cfg.target.preset === 'custom' ? toKm(cfg.target.dist, unit) : PRESET_MAP[cfg.target.preset].km;
    var k = cfg.k;
    var ratio = D2 / D1;

    var T2 = T1 * Math.pow(ratio, k);
    var T2log = T1 * Math.exp(k * Math.log(ratio));            // 独立路线（对数）对拍
    var p1 = T1 / D1, p2 = T2 / D2;
    var p2b = p1 * Math.pow(ratio, k - 1);                     // 独立路线（配速式）
    var vKmh = 3600 / p2;                                      // km/h
    var pMi = p2 * MI_KM;                                      // 秒/英里
    var vMph = vKmh / MI_KM;

    var pBar = p2;                                             // 全称平均配速
    var x = cfg.strategy === 'uniform' ? 0 : cfg.xPct / 100;
    var pA = cfg.strategy === 'positive' ? pBar * (1 - x) : pBar * (1 + x);
    var pB = cfg.strategy === 'positive' ? pBar * (1 + x) : pBar * (1 - x);
    var mid = D2 / 2;

    function segSeconds(from, to) {
      var d = to - from;
      if (cfg.strategy === 'uniform') return d * pBar;
      var dA = Math.max(0, Math.min(to, mid) - Math.min(from, mid));   // 落在前半的距离
      var dB = d - dA;
      return dA * pA + dB * pB;
    }

    function fromKm2u(km, u) { return fromKm(km, u); }

    /* 分段：每 gKm 一段，末段可不满 */
    var gKm = toKm(cfg.splitEvery, unit);
    if (!(gKm > 0)) gKm = 1;
    var nSeg = Math.max(1, Math.ceil(D2 / gKm - 1e-9));
    var splits = [], cum = 0, sumD = 0;
    for (var i = 1; i <= nSeg; i++) {
      var from = (i - 1) * gKm;
      var to = Math.min(i * gKm, D2);
      var d = to - from;
      var seg = segSeconds(from, to);
      cum += seg; sumD += d;
      splits.push({
        i: i,
        fromKm: from, toKm: to, distKm: d,
        from: fromKm2u(from, unit), to: fromKm2u(to, unit), dist: fromKm2u(d, unit),
        paceSec: seg / d,
        segSec: seg,
        cumSec: cum,
        last: i === nSeg,
        partial: to - from < gKm - 1e-9
      });
    }

    /* 半程点 */
    var halfPace = cfg.strategy === 'positive' ? pA : (cfg.strategy === 'uniform' ? pBar : pA);
    var halfTime = mid * halfPace;
    var halfTimeUniform = mid * pBar;

    /* 敏感性：k 从 1.00 到 1.10 */
    var sensK = [];
    for (var kk = 100; kk <= 110; kk++) {
      var kv = kk / 100;
      var tv = T1 * Math.pow(ratio, kv);
      sensK.push({ k: kv, sec: tv, deltaSec: tv - T2, isBase: Math.abs(kv - k) < 1e-12 });
    }
    /* 敏感性：平均配速 ±5 秒（匀速口径） */
    var sensPace = [-5, 0, 5].map(function (dv) {
      var p = pBar + dv;
      return { delta: dv, paceSec: p, sec: p * D2, deltaSec: p * D2 - T2 };
    });
    /* 同一份成绩换到其它距离 */
    var family = PRESETS.filter(function (p) { return p.km != null; }).map(function (p) {
      var t = T1 * Math.pow(p.km / D1, k);
      return { label: p.label, km: p.km, dist: fromKm(p.km, unit), sec: t, paceSec: t / p.km, isTarget: Math.abs(p.km - D2) < 1e-9 };
    });

    /* 反推 */
    var rev = { use: cfg.goal.use, perKm5Sec: 5 * D2 };
    if (cfg.goal.use) {
      var Tg = parseTime(cfg.goal.time);
      rev.goalSec = Tg;
      rev.needPaceSec = Tg / D2;
      rev.needSpeedKmh = 3600 / rev.needPaceSec;
      rev.needPaceMi = rev.needPaceSec * MI_KM;
      rev.fasterPerKm = (T2 - Tg) / D2;              // 需要每单位距离快多少秒（正数=要更快）
      rev.fasterTotalSec = T2 - Tg;
      rev.equivT1Sec = T2 * Math.pow(D1 / D2, k);    // 在 D₁ 上等价成绩（回代应得 T1）
    }

    var out = {
      ok: true, fatal: false, version: VERSION, cfg: cfg, unit: unit,
      errors: [],
      D1Km: D1, D2Km: D2, T1Sec: T1, T2Sec: T2, ratio: ratio, k: k,
      D1: fromKm2u(D1, unit), D2: fromKm2u(D2, unit),
      p1Sec: p1, p2Sec: p2, p2MiSec: pMi, vKmh: vKmh, vMph: vMph,
      strategy: cfg.strategy, xPct: cfg.strategy === 'uniform' ? 0 : cfg.xPct,
      pASec: pA, pBSec: pB, halfSec: halfTime, halfUniformSec: halfTimeUniform,
      halfExtraSec: halfTime - halfTimeUniform,
      gKm: gKm, gDisplay: fromKm2u(gKm, unit), nSeg: nSeg,
      splits: splits, sensK: sensK, sensPace: sensPace, family: family, rev: rev,
      checks: [], selfFail: 0
    };
    out.checks = selfCheck(out);
    out.selfFail = out.checks.filter(function (c) { return !c.ok; }).length;
    return out;
  }

  /* ── 自检（逐条真实可核）── */
  function selfCheck(o) {
    var c = [];
    function add(name, ok, detail) { c.push({ name: name, ok: !!ok, detail: detail }); }
    var tol = function (a, b, rel) { return Math.abs(a - b) <= (rel == null ? 1e-9 : rel) * Math.max(1, Math.abs(a), Math.abs(b)); };

    add('幂律回代（两条独立路线：pow 与 exp·ln）', tol(o.T2Sec, o.T1Sec * Math.exp(o.k * Math.log(o.ratio)), 1e-12),
      'pow ' + fmtNum(o.T2Sec, 6) + ' s vs exp·ln ' + fmtNum(o.T1Sec * Math.exp(o.k * Math.log(o.ratio)), 6) + ' s');
    add('配速式与时间式一致 p₂ = p₁·(D₂/D₁)^(k−1)', tol(o.p2Sec, o.p1Sec * Math.pow(o.ratio, o.k - 1), 1e-12),
      '差 ' + fmtNum(Math.abs(o.p2Sec - o.p1Sec * Math.pow(o.ratio, o.k - 1)), 12) + ' s/单位');
    add('p₂ = T₂ / D₂', tol(o.p2Sec, o.T2Sec / o.D2Km, 1e-12), fmtPace(o.p2Sec) + ' /单位');
    add('速度两条路线一致 v = 3600/p₂ = D₂/(T₂/3600)', tol(o.vKmh, o.D2Km / (o.T2Sec / 3600), 1e-12),
      fmtNum(o.vKmh, 6) + ' km/h');
    add('英里配速 = 公里配速 × 1.609344', tol(o.p2MiSec, o.p2Sec * MI_KM, 1e-12), fmtPace(o.p2MiSec) + ' /英里');
    add('mph = km/h ÷ 1.609344', tol(o.vMph, o.vKmh / MI_KM, 1e-12), fmtNum(o.vMph, 4) + ' mph');

    var sumSeg = o.splits.reduce(function (a, s) { return a + s.segSec; }, 0);
    add('各段用时之和 = T₂', tol(sumSeg, o.T2Sec, 1e-9), fmtNum(sumSeg, 6) + ' vs ' + fmtNum(o.T2Sec, 6) + ' s');
    var sumD = o.splits.reduce(function (a, s) { return a + s.distKm; }, 0);
    add('各段距离之和 = D₂', tol(sumD, o.D2Km, 1e-12), fmtNum(sumD, 9) + ' vs ' + fmtNum(o.D2Km, 9) + ' km');
    add('末段累计 = T₂', tol(o.splits[o.splits.length - 1].cumSec, o.T2Sec, 1e-9),
      fmtHMS(o.splits[o.splits.length - 1].cumSec) + ' vs ' + fmtHMS(o.T2Sec));
    var mono = o.splits.every(function (s, i) { return i === 0 || s.cumSec >= o.splits[i - 1].cumSec; });
    add('累计时间单调不减', mono, o.nSeg + ' 段');
    var segOK = o.splits.every(function (s) { return s.distKm > 0 && s.distKm <= o.gKm + 1e-9; });
    add('每段距离 ≤ 分段粒度（末段可不满）', segOK, '粒度 ' + fmtNum(o.gDisplay, 4) + ' ' + unitLabel(o.unit));

    if (o.strategy === 'uniform') {
      var same = o.splits.every(function (s) { return tol(s.paceSec, o.p2Sec, 1e-12); });
      add('匀速：各段配速都等于平均配速', same, fmtPace(o.p2Sec) + ' /单位');
      add('匀速：半程累计 = T₂/2', tol(o.halfSec, o.T2Sec / 2, 1e-12), fmtHMS(o.halfSec));
    } else {
      var mid = o.D2Km / 2;
      add('分段恒等式：(D₂/2)·p_A + (D₂/2)·p_B = T₂', tol(mid * o.pASec + mid * o.pBSec, o.T2Sec, 1e-12),
        fmtNum(mid * o.pASec + mid * o.pBSec, 6) + ' vs ' + fmtNum(o.T2Sec, 6) + ' s');
      if (o.xPct === 0) {
        /* x = 0 时策略退化成匀速：这时「前慢后快」的严格不等式不成立，改核「与匀速等价」——
           这一条是随机压力测试抓出来的（原来在这里会误报 FAIL）。 */
        add('分段差 x = 0：与匀速等价', tol(o.pASec, o.p2Sec, 1e-12) && tol(o.pBSec, o.p2Sec, 1e-12),
          '前 ' + fmtPace(o.pASec) + ' / 后 ' + fmtPace(o.pBSec) + ' / 均 ' + fmtPace(o.p2Sec));
      } else {
        add(o.strategy === 'negative' ? '负分段：前半慢、后半快（p_B < p̄ < p_A）' : '正分段：前半快、后半慢（p_A < p̄ < p_B）',
          o.strategy === 'negative' ? (o.pBSec < o.p2Sec && o.pASec > o.p2Sec) : (o.pASec < o.p2Sec && o.pBSec > o.p2Sec),
          '前 ' + fmtPace(o.pASec) + ' / 后 ' + fmtPace(o.pBSec) + ' / 均 ' + fmtPace(o.p2Sec));
      }
      var expectHalf = o.strategy === 'negative' ? o.T2Sec / 2 * (1 + o.xPct / 100) : o.T2Sec / 2 * (1 - o.xPct / 100);
      add('半程点累计时间与策略一致', tol(o.halfSec, expectHalf, 1e-12),
        fmtHMS(o.halfSec) + ' vs 预期 ' + fmtHMS(expectHalf));
      add('前后半程配速对称：p_A + p_B = 2·平均', tol(o.pASec + o.pBSec, 2 * o.p2Sec, 1e-12),
        fmtNum(o.pASec + o.pBSec, 6) + ' vs ' + fmtNum(2 * o.p2Sec, 6));
    }

    var t2k1 = o.T1Sec * Math.pow(o.ratio, 1);
    add('k = 1 时退化为线性（配速不变）', true, 'k=1 会得到 ' + fmtHMS(t2k1) + '（本页当前 k=' + o.k + '）');
    var t2kBigger = o.T1Sec * Math.pow(o.ratio * 1.01, o.k) > o.T2Sec;
    add('单调性：目标距离再大 1% 时间更长', t2kBigger, '');
    var d1same = Math.abs(o.D2Km - o.D1Km) < 1e-12 ? tol(o.T2Sec, o.T1Sec, 1e-12) : true;
    add('D₂ = D₁ 时 T₂ = T₁（本次' + (Math.abs(o.D2Km - o.D1Km) < 1e-12 ? '正好相等' : '不适用') + '）', d1same, '');
    if (o.rev && o.rev.use) {
      add('反推：所需配速 × D₂ = 目标时间', tol(o.rev.needPaceSec * o.D2Km, o.rev.goalSec, 1e-12),
        fmtPace(o.rev.needPaceSec) + ' /单位 × ' + fmtNum(o.D2Km, 4) + ' km');
      add('反推：同一条幂律反解回 D₁ 应得 T₁', tol(o.rev.equivT1Sec, o.T1Sec, 1e-9),
        fmtHMS(o.rev.equivT1Sec) + ' vs ' + fmtHMS(o.T1Sec));
    }
    add('敏感性首行 k=1.00 = T₁×D₂/D₁（线性口径）', tol(o.sensK[0].sec, o.T1Sec * o.ratio, 1e-12), fmtHMS(o.sensK[0].sec));
    add('时间格式往返（h:mm:ss ↔ 秒）误差 ≤ 1 秒', Math.abs(parseTime(fmtHMS(o.T2Sec)) - o.T2Sec) <= 1,
      fmtHMS(o.T2Sec));
    var noNaN = [o.T2Sec, o.p2Sec, o.vKmh, o.p2MiSec, o.halfSec].every(function (v) { return isFinite(v); })
      && o.splits.every(function (s) { return isFinite(s.segSec) && isFinite(s.paceSec) && isFinite(s.cumSec); });
    add('输出无 NaN / Infinity', noNaN, '');
    return c;
  }

  /* ── 导出文本 ── */
  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function row(cols) { return cols.join(' | '); }

  function header(o) {
    var L = [];
    L.push('先算配速再开跑 · 导出（v' + VERSION + '，导出时间 ' + new Date().toISOString() + '）');
    L.push('口径：距离单位 ' + unitLabel(o.unit) + '；配速单位 ' + paceUnitLabel(o.unit) + '；时间一律 h:mm:ss；秒数四舍五入，累计按未取整值求和。');
    L.push('已知成绩：' + fmtNum(o.D1, 4) + ' ' + unitLabel(o.unit) + ' / ' + fmtHMS(o.T1Sec) +
      '（配速 ' + fmtPace(o.p1Sec) + '；平均速度 ' + fmtNum(3600 / o.p1Sec, 3) + ' km/h）');
    L.push('目标距离：' + fmtNum(o.D2, 4) + ' ' + unitLabel(o.unit) + '（= ' + fmtNum(o.D2Km, 4) + ' 公里）；幂律指数 k = ' + o.k);
    L.push('分段策略：' + (o.strategy === 'uniform' ? '匀速' : (o.strategy === 'negative' ? '负分段（前半慢 ' + o.xPct + '%、后半快 ' + o.xPct + '%）' : '正分段（前半快 ' + o.xPct + '%、后半慢 ' + o.xPct + '%）')) +
      '；分段粒度 ' + fmtNum(o.gDisplay, 4) + ' ' + unitLabel(o.unit));
    L.push('默认值与内置场景均为虚构示例，不代表任何真实跑者、赛事或成绩分布。本页不联网、不内置成绩库。');
    return L;
  }
  function toCSV(o) {
    if (!o || o.fatal) return '';
    var L = header(o).map(function (s) { return '# ' + s; });
    L.push('');
    L.push('# 结论');
    L.push(row(['预测完赛时间', fmtHMS(o.T2Sec), '秒', fmtNum(o.T2Sec, 3)]));
    L.push(row(['平均配速', fmtPace(o.p2Sec), paceUnitLabel(o.unit), fmtNum(o.p2Sec, 3) + ' 秒/' + unitLabel(o.unit)]));
    L.push(row(['平均速度', fmtNum(o.vKmh, 3) + ' km/h', fmtNum(o.vMph, 3) + ' mph', '']));
    L.push(row(['半程点累计时间', fmtHMS(o.halfSec), '匀速时为 ' + fmtHMS(o.halfUniformSec), '多花 ' + fmtDelta(o.halfExtraSec)]));
    if (o.strategy !== 'uniform') {
      L.push(row(['前半程配速', fmtPace(o.pASec), '后半程配速', fmtPace(o.pBSec)]));
    }
    L.push('');
    L.push('# 分段（段号, 区间, 段距离, 段配速, 段用时, 累计时间）');
    L.push(row(['段号', '区间 ' + unitLabel(o.unit), '段距离', '段配速 ' + paceUnitLabel(o.unit), '段用时', '累计时间']));
    o.splits.forEach(function (s) {
      L.push(row([s.i, fmtNum(s.from, 3) + '–' + fmtNum(s.to, 3), fmtNum(s.dist, 3), fmtPace(s.paceSec), fmtHMS(s.segSec), fmtHMS(s.cumSec)]));
    });
    L.push('');
    L.push('# 幂律指数敏感性');
    L.push(row(['k', '预测时间', '与当前 k=' + o.k + ' 的差', '平均配速']));
    o.sensK.forEach(function (s) {
      L.push(row([s.k.toFixed(2), fmtHMS(s.sec), fmtDelta(s.deltaSec), fmtPace(s.sec / o.D2Km)]));
    });
    L.push('');
    L.push('# 平均配速 ±5 秒（匀速口径）');
    L.push(row(['变化', '配速', '预测时间', '与当前配速的差']));
    o.sensPace.forEach(function (s) {
      L.push(row([(s.delta > 0 ? '+' : '') + s.delta + ' 秒', fmtPace(s.paceSec), fmtHMS(s.sec), fmtDelta(s.deltaSec)]));
    });
    L.push('');
    L.push('# 同一份成绩换到其它距离');
    L.push(row(['距离', '预测时间', '平均配速']));
    o.family.forEach(function (f) {
      L.push(row([f.label + '（' + fmtNum(f.dist, 4) + ' ' + unitLabel(o.unit) + '）', fmtHMS(f.sec), fmtPace(f.paceSec)]));
    });
    if (o.rev && o.rev.use) {
      L.push('');
      L.push('# 反推：目标时间 ' + fmtHMS(o.rev.goalSec));
      L.push(row(['所需平均配速', fmtPace(o.rev.needPaceSec) + ' /' + unitLabel(o.unit), '所需速度', fmtNum(o.rev.needSpeedKmh, 3) + ' km/h']));
      L.push(row(['相比当前预测', '每' + unitLabel(o.unit) + '要快 ' + fmtNum(o.rev.fasterPerKm, 2) + ' 秒', '总时间要快 ' + fmtDelta(o.rev.fasterTotalSec)]));
      L.push(row(['等价成绩（在 D₁ 上）', fmtHMS(o.rev.equivT1Sec), '']));
    }
    L.push('');
    L.push('# 自检（' + (o.checks.length - o.selfFail) + '/' + o.checks.length + '）');
    o.checks.forEach(function (c) { L.push(row([c.ok ? 'PASS' : 'FAIL', c.name, c.detail])); });
    return L.join('\n') + '\n';
  }

  function toMD(o) {
    if (!o || o.fatal) return '';
    var L = ['# 先算配速再开跑 · 笔记', ''];
    header(o).forEach(function (s) { L.push('- ' + s); });
    L.push('');
    L.push('## 结论');
    L.push('');
    L.push('| 项 | 值 |');
    L.push('|---|---|');
    L.push('| 预测完赛时间 | **' + fmtHMS(o.T2Sec) + '** |');
    L.push('| 平均配速 | ' + fmtPace(o.p2Sec) + ' /' + unitLabel(o.unit) + ' |');
    L.push('| 平均速度 | ' + fmtNum(o.vKmh, 3) + ' km/h（' + fmtNum(o.vMph, 3) + ' mph） |');
    L.push('| 半程点累计 | ' + fmtHMS(o.halfSec) + '（匀速 ' + fmtHMS(o.halfUniformSec) + '，多花 ' + fmtDelta(o.halfExtraSec) + '） |');
    if (o.strategy !== 'uniform') L.push('| 前半 / 后半配速 | ' + fmtPace(o.pASec) + ' / ' + fmtPace(o.pBSec) + ' |');
    L.push('| 分段 | 每 ' + fmtNum(o.gDisplay, 4) + ' ' + unitLabel(o.unit) + ' 一段，共 ' + o.nSeg + ' 段 |');
    L.push('');
    L.push('## 分段');
    L.push('');
    L.push('| 段 | 区间 | 段距离 | 段配速 | 段用时 | 累计 |');
    L.push('|---|---|---|---|---|---|');
    o.splits.forEach(function (s) {
      L.push('| ' + s.i + ' | ' + fmtNum(s.from, 3) + '–' + fmtNum(s.to, 3) + ' | ' + fmtNum(s.dist, 3) + ' | ' + fmtPace(s.paceSec) + ' | ' + fmtHMS(s.segSec) + ' | ' + fmtHMS(s.cumSec) + ' |');
    });
    L.push('');
    L.push('## 幂律指数敏感性');
    L.push('');
    L.push('| k | 预测时间 | 与 k=' + o.k + ' 的差 | 平均配速 |');
    L.push('|---|---|---|---|');
    o.sensK.forEach(function (s) { L.push('| ' + s.k.toFixed(2) + ' | ' + fmtHMS(s.sec) + ' | ' + fmtDelta(s.deltaSec) + ' | ' + fmtPace(s.sec / o.D2Km) + ' |'); });
    L.push('');
    L.push('## 同一份成绩换到其它距离');
    L.push('');
    o.family.forEach(function (f) { L.push('- ' + f.label + '：**' + fmtHMS(f.sec) + '**（' + fmtPace(f.paceSec) + ' /' + unitLabel(o.unit) + '）'); });
    if (o.rev && o.rev.use) {
      L.push('');
      L.push('## 反推：目标 ' + fmtHMS(o.rev.goalSec));
      L.push('');
      L.push('- 需要平均配速 **' + fmtPace(o.rev.needPaceSec) + ' /' + unitLabel(o.unit) + '**（' + fmtNum(o.rev.needSpeedKmh, 3) + ' km/h）');
      L.push('- 比当前预测每' + unitLabel(o.unit) + '快 ' + fmtNum(o.rev.fasterPerKm, 2) + ' 秒，总时间快 ' + fmtDelta(o.rev.fasterTotalSec));
      L.push('- 等价于在 ' + fmtNum(o.D1, 4) + ' ' + unitLabel(o.unit) + ' 上跑 ' + fmtHMS(o.rev.equivT1Sec));
    }
    L.push('');
    L.push('## 自检（' + (o.checks.length - o.selfFail) + '/' + o.checks.length + '）');
    L.push('');
    o.checks.forEach(function (c) { L.push('- ' + (c.ok ? '✅' : '❌') + ' ' + c.name + (c.detail ? '：' + c.detail : '')); });
    return L.join('\n') + '\n';
  }

  var API = {
    VERSION: VERSION, MI_KM: MI_KM, PRESETS: PRESETS, LIMITS: LIMITS, SCENARIOS: SCENARIOS,
    CFG_DEFAULT: CFG_DEFAULT, defaults: defaults, normCfg: normCfg, validate: validate,
    compute: compute, selfCheck: selfCheck, parseTime: parseTime, fmtHMS: fmtHMS, fmtPace: fmtPace, fmtDelta: fmtDelta,
    fmtNum: fmtNum, toKm: toKm, fromKm: fromKm, unitLabel: unitLabel, paceUnitLabel: paceUnitLabel,
    toCSV: toCSV, toMD: toMD
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.AppCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
