/* 先算配速再开跑 · 核心测试（node --test tests/core.test.cjs）
 *
 * 覆盖：手算锚点、两条独立路线的对拍、分段守恒与恒等式、单位三角、时间解析/格式化与进位、
 * 阈值两侧、退化、30+ 条非法输入逐条核字段、单调性与不变量、随机压力、自检「会红」、
 * 确定性/纯函数、输出契约、导出契约。
 *
 * 手算锚点一律在断言里写死数值（不是拿引擎自己对自己）；独立对拍另走对数/配速/求和路线。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const A = require(path.join(__dirname, '..', 'core.js'));

const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol) * Math.max(1, Math.abs(a), Math.abs(b));
const D = () => A.defaults();

/* ───────────────────────── A. 手算锚点（默认场景） ───────────────────────── */
test('A1 默认场景：10 公里 50:00 → 全马 42.195 公里，k=1.06', () => {
  const r = A.compute(D());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  // 手算：50 分 = 3000 s；D₂/D₁ = 4.2195；4.2195^1.06 = 4.599852944572933（独立算：exp(1.06·ln 4.2195)）
  const ratio = 42.195 / 10;
  const ratioK = Math.exp(1.06 * Math.log(ratio));
  const T2 = 3000 * ratioK;
  assert.ok(near(r.T2Sec, T2, 1e-12), `${r.T2Sec} vs ${T2}`);
  assert.ok(Math.abs(r.T2Sec - 13800.597999769759) < 1e-6, `锚点 ${r.T2Sec}`);
  assert.equal(A.fmtHMS(r.T2Sec), '3:50:01');
  // 配速 327.067 s/km → 5:27；速度 11.0069 km/h
  assert.ok(Math.abs(r.p2Sec - 327.0671406510193) < 1e-9);
  assert.equal(A.fmtPace(r.p2Sec), '5:27');
  assert.ok(Math.abs(r.vKmh - 11.0069143382435) < 1e-9);
  assert.equal(A.fmtPace(r.p2MiSec), '8:46');
  assert.ok(near(r.p2MiSec, r.p2Sec * 1.609344, 1e-12));
});

test('A2 同一份成绩换到别的距离（手算四个锚点）', () => {
  const r = A.compute(D());
  const tbl = {};
  r.family.forEach((f) => { tbl[f.label] = f; });
  assert.ok(Math.abs(tbl['5 公里'].sec - 1438.896179) < 1e-5, String(tbl['5 公里'].sec));
  assert.equal(A.fmtHMS(tbl['5 公里'].sec), '23:59');
  assert.equal(A.fmtHMS(tbl['10 公里'].sec), '50:00');            // D₂ = D₁ 必须回原值
  assert.ok(Math.abs(tbl['10 公里'].sec - 3000) < 1e-9);
  assert.equal(A.fmtHMS(tbl['半马'].sec), '1:50:19');
  assert.ok(Math.abs(tbl['半马'].sec - 6619.20924320557) < 1e-6);
  assert.equal(A.fmtHMS(tbl['全马'].sec), '3:50:01');
  assert.equal(tbl['全马'].isTarget, true);
});

test('A3 k = 1 退化为线性：配速不变、时间按距离比放大', () => {
  const r = A.compute(Object.assign(D(), { k: 1 }));
  assert.ok(near(r.T2Sec, 3000 * 4.2195, 1e-12));
  assert.ok(Math.abs(r.T2Sec - 12658.5) < 1e-9);
  assert.equal(A.fmtHMS(r.T2Sec), '3:30:59');
  assert.ok(near(r.p2Sec, r.p1Sec, 1e-12));
  // 与默认 k=1.06 的差：19 分 02 秒
  const base = A.compute(D());
  assert.equal(A.fmtDelta(base.T2Sec - r.T2Sec), '19 分 02 秒');
});

test('A4 负分段 5%：一半一半配速、总时间不变、半程点晚到', () => {
  const r = A.compute(Object.assign(D(), { strategy: 'negative', xPct: 5 }));
  const pBar = r.T2Sec / r.D2Km;
  assert.ok(near(r.pASec, pBar * 1.05, 1e-12));
  assert.ok(near(r.pBSec, pBar * 0.95, 1e-12));
  assert.equal(A.fmtPace(r.pASec), '5:43');
  assert.equal(A.fmtPace(r.pBSec), '5:11');
  assert.ok(near((r.D2Km / 2) * r.pASec + (r.D2Km / 2) * r.pBSec, r.T2Sec, 1e-12));
  // 半程点 = T₂(1+x)/2 → 比匀速多花 T₂·x/2 = 345.01 s
  assert.ok(near(r.halfSec, r.T2Sec * 1.05 / 2, 1e-12));
  assert.ok(Math.abs(r.halfExtraSec - r.T2Sec * 0.05 / 2) < 1e-9);
  assert.equal(A.fmtDelta(r.halfExtraSec), '5 分 45 秒');
});

test('A5 正分段 5%：前半更快的镜像', () => {
  const r = A.compute(Object.assign(D(), { strategy: 'positive', xPct: 5 }));
  assert.ok(near(r.pASec, r.p2Sec * 0.95, 1e-12));
  assert.ok(near(r.pBSec, r.p2Sec * 1.05, 1e-12));
  assert.ok(near(r.halfSec, r.T2Sec * 0.95 / 2, 1e-12));
  assert.ok(r.halfExtraSec < 0);
});

/* ───────────────────────── B. 两条独立路线对拍 ───────────────────────── */
test('B1 pow 与 exp·ln 两条路线逐点一致（21 个配置）', () => {
  const ks = [0.5, 0.8, 1, 1.02, 1.06, 1.1, 1.3, 1.5];
  const ds = [5, 10, 21.0975, 42.195, 100];
  let n = 0;
  ks.forEach((k) => ds.forEach((d) => {
    const r = A.compute({ known: { dist: 12.5, time: '1:02:30' }, target: { preset: 'custom', dist: d }, k, unit: 'km', splitEvery: 5 });
    const T2 = 3750 * Math.pow(d / 12.5, k);
    assert.ok(near(r.T2Sec, T2, 1e-13), `k=${k} d=${d}`);
    n++;
  }));
  assert.equal(n, 40);
});

test('B2 时间式与配速式一致：p₂ = p₁·(D₂/D₁)^(k−1)', () => {
  [1, 1.03, 1.06, 1.2].forEach((k) => {
    const r = A.compute(Object.assign(D(), { k }));
    const p2 = r.p1Sec * Math.pow(r.ratio, k - 1);
    assert.ok(near(r.p2Sec, p2, 1e-12), `k=${k}: ${r.p2Sec} vs ${p2}`);
  });
});

test('B3 分段求和与逐段独立重算一致（含跨中点段）', () => {
  [[5, 'uniform'], [5, 'negative'], [1, 'negative'], [2, 'positive'], [10, 'negative']].forEach(([g, st]) => {
    const r = A.compute(Object.assign(D(), { splitEvery: g, strategy: st, xPct: 7 }));
    let sum = 0;
    r.splits.forEach((s) => {
      const dA = Math.max(0, Math.min(s.toKm, r.D2Km / 2) - Math.min(s.fromKm, r.D2Km / 2));
      const dB = s.distKm - dA;
      const seg = st === 'uniform' ? s.distKm * r.p2Sec : dA * r.pASec + dB * r.pBSec;
      assert.ok(near(s.segSec, seg, 1e-13), `g=${g} seg ${s.i}`);
      assert.ok(near(s.paceSec, seg / s.distKm, 1e-13));
      sum += seg;
    });
    assert.ok(near(sum, r.T2Sec, 1e-12), `g=${g}: Σ段 ${sum} vs T₂ ${r.T2Sec}`);
  });
});

test('B4 半程点落在哪一段：该段用时按段内前后半距离分别计', () => {
  const r = A.compute(Object.assign(D(), { splitEvery: 5, strategy: 'negative', xPct: 5 }));
  const half = r.D2Km / 2;                                  // 21.0975
  const seg = r.splits.filter((s) => s.fromKm <= half && s.toKm > half)[0];
  assert.equal(seg.i, 5);                                   // 20–25 公里那一段
  const dA = half - 20, dB = 25 - half;
  assert.ok(near(seg.segSec, dA * r.pASec + dB * r.pBSec, 1e-13));
  // 该段的等效配速介于两个半程配速之间
  assert.ok(seg.paceSec > r.pBSec && seg.paceSec < r.pASec);
});

/* ───────────────────────── C. 分段守恒 ───────────────────────── */
test('C1 段距离之和 = D₂、累计单调、末段累计 = T₂、每段 ≤ 粒度', () => {
  [[1, 'uniform'], [2, 'negative'], [5, 'positive'], [10, 'uniform']].forEach(([g, st]) => {
    const r = A.compute(Object.assign(D(), { splitEvery: g, strategy: st, xPct: 4 }));
    const sumD = r.splits.reduce((a, s) => a + s.distKm, 0);
    assert.ok(near(sumD, r.D2Km, 1e-12), `g=${g}`);
    assert.ok(near(r.splits[r.splits.length - 1].cumSec, r.T2Sec, 1e-12));
    r.splits.forEach((s, i) => {
      assert.ok(s.distKm > 0 && s.distKm <= r.gKm + 1e-12, `g=${g} 段 ${s.i} 距离 ${s.distKm}`);
      if (i) assert.ok(s.cumSec >= r.splits[i - 1].cumSec);
    });
    assert.equal(r.splits.length, Math.ceil(r.D2Km / r.gKm - 1e-9));
  });
});

test('C2 末段不满一个粒度时按实际距离算', () => {
  const r = A.compute(Object.assign(D(), { splitEvery: 10 }));
  assert.equal(r.splits.length, 5);                     // 42.195 → 10,10,10,10,2.195
  assert.ok(near(r.splits[4].distKm, 2.195, 1e-12));
  assert.equal(r.splits[4].partial, true);
  assert.equal(r.splits[0].partial, false);
});

/* ───────────────────────── D. 单位 ───────────────────────── */
test('D1 英里口径：6.213712 英里 = 10 公里，两个口径算出同一个秒数', () => {
  const km = A.compute(D());
  const mi = A.compute({ unit: 'mi', known: { dist: 10 / 1.609344, time: '50:00' }, target: { preset: 'custom', dist: 42.195 / 1.609344 }, k: 1.06, splitEvery: 5 });
  assert.ok(near(mi.T2Sec, km.T2Sec, 1e-12), `${mi.T2Sec} vs ${km.T2Sec}`);
  assert.ok(near(A.toKm(10 / 1.609344, 'mi'), 10, 1e-15));
  assert.ok(near(A.toKm(6.213712, 'mi'), 10, 3e-6), '6.213712 英里是 10 公里的近似写法');
  assert.ok(near(mi.p2MiSec, mi.p2Sec * 1.609344, 1e-12));
  assert.ok(near(mi.vMph, mi.vKmh / 1.609344, 1e-12));
  assert.equal(A.unitLabel('mi'), '英里');
});

test('D2 距离与配速的显示值随单位互换', () => {
  const km = A.compute(D());
  const mi = A.compute({ unit: 'mi', known: { dist: 10 / 1.609344, time: '50:00' }, target: { preset: 'full' }, k: 1.06, splitEvery: 5 });
  assert.ok(near(mi.D2, A.fromKm(42.195, 'mi'), 1e-12));
  assert.equal(mi.gDisplay, 5);                        // 粒度按当前单位解释
  assert.ok(near(mi.gKm, 5 * 1.609344, 1e-12));
  assert.equal(mi.splits.length, Math.ceil(42.195 / (5 * 1.609344)));
  assert.ok(near(km.T2Sec, mi.T2Sec, 1e-12));
});

/* ───────────────────────── E. 时间解析与格式化 ───────────────────────── */
test('E1 解析各种写法（冒号/中文单位/秒数）', () => {
  assert.equal(A.parseTime('50:00'), 3000);            // mm:ss
  assert.equal(A.parseTime('3:30:00'), 12600);         // h:mm:ss
  assert.equal(A.parseTime('0:50:00'), 3000);
  assert.equal(A.parseTime('3000'), 3000);             // 纯数字＝秒
  assert.equal(A.parseTime('1小时20分'), 4800);
  assert.equal(A.parseTime('50分'), 3000);
  assert.equal(A.parseTime('90秒'), 90);
  assert.equal(A.parseTime('1.5小时'), 5400);
  assert.equal(A.parseTime(' 1:02:03 '), 3723);
  assert.equal(A.parseTime(725), 725);
});

test('E2 解析必须拒绝的东西', () => {
  ['', '  ', 'abc', '50:99', '1:2:3:4', '1：2', '-5:00', '50分30', '1小时2公里', '::', '1e3', 'NaN', '五十分钟'].forEach((s) => {
    assert.ok(!isFinite(A.parseTime(s)), `不该解析成功：${JSON.stringify(s)} → ${A.parseTime(s)}`);
  });
  assert.ok(!isFinite(A.parseTime(null)));
  assert.ok(!isFinite(A.parseTime(undefined)));
  assert.ok(!isFinite(A.parseTime(-30)));
});

test('E3 格式化进位：59.6 秒不许出现 :60', () => {
  assert.equal(A.fmtHMS(3599.6), '1:00:00');
  assert.equal(A.fmtHMS(59.6), '1:00');
  assert.equal(A.fmtPace(59.6), '1:00');
  assert.equal(A.fmtPace(3599.6), '1:00:00');
  assert.equal(A.fmtPace(327.067), '5:27');
  assert.equal(A.fmtHMS(0), '0:00');
  assert.equal(A.fmtHMS(86399.4), '23:59:59');
  assert.equal(A.fmtDelta(210.975), '3 分 31 秒');
  assert.equal(A.fmtDelta(-345.01), '-5 分 45 秒');
  assert.equal(A.fmtDelta(42), '42 秒');
  assert.equal(A.fmtHMS(Infinity), '—');
});

test('E4 往返：fmtHMS → parseTime 误差 ≤ 1 秒（一批值）', () => {
  [5, 59.4, 60, 599.5, 3000, 13800.598, 12600, 86399.6, 172800].forEach((s) => {
    const back = A.parseTime(A.fmtHMS(s));
    assert.ok(Math.abs(back - s) <= 1, `${s} → ${A.fmtHMS(s)} → ${back}`);
  });
});

/* ───────────────────────── F. 阈值两侧 ───────────────────────── */
test('F1 距离阈值两侧（0.1 / 500 公里）', () => {
  const ok1 = A.compute({ known: { dist: 0.1, time: '0:20' }, target: { preset: '5k' }, k: 1.06, splitEvery: 1 });
  assert.equal(ok1.ok, true, JSON.stringify(ok1.errors));
  const ok2 = A.compute({ known: { dist: 500, time: '48:00:00' }, target: { preset: 'custom', dist: 400 }, k: 1.06, splitEvery: 10 });
  assert.equal(ok2.ok, true, JSON.stringify(ok2.errors));
  const bad1 = A.compute({ known: { dist: 0.09, time: '0:20' }, target: { preset: '5k' }, k: 1.06, splitEvery: 1 });
  assert.equal(bad1.ok, false);
  assert.equal(bad1.errors.filter((e) => e.field === 'known.dist').length >= 1, true);
  const bad2 = A.compute({ known: { dist: 501, time: '0:20' }, target: { preset: '5k' }, k: 1.06, splitEvery: 1 });
  assert.equal(bad2.ok, false);
});

test('F2 时间阈值两侧（5 秒 / 48 小时）', () => {
  assert.equal(A.compute({ known: { dist: 10, time: '0:05' }, target: { preset: '5k' }, k: 1.06, splitEvery: 1 }).ok, true);
  assert.equal(A.compute({ known: { dist: 10, time: '48:00:00' }, target: { preset: '5k' }, k: 1.06, splitEvery: 1 }).ok, true);
  assert.equal(A.compute({ known: { dist: 10, time: '0:04' }, target: { preset: '5k' }, k: 1.06, splitEvery: 1 }).ok, false);
  assert.equal(A.compute({ known: { dist: 10, time: '48:00:01' }, target: { preset: '5k' }, k: 1.06, splitEvery: 1 }).ok, false);
});

test('F3 幂律指数阈值两侧（0.5 / 1.5）', () => {
  assert.equal(A.compute(Object.assign(D(), { k: 0.5 })).ok, true);
  assert.equal(A.compute(Object.assign(D(), { k: 1.5 })).ok, true);
  const lo = A.compute(Object.assign(D(), { k: 0.49 }));
  const hi = A.compute(Object.assign(D(), { k: 1.51 }));
  assert.equal(lo.ok, false);
  assert.equal(hi.ok, false);
  assert.equal(lo.errors.some((e) => e.field === 'k'), true);
  assert.equal(hi.errors.some((e) => e.field === 'k'), true);
});

test('F4 前后半程差阈值两侧（0 / 30%），且 ≥100% 的写法不可能通过', () => {
  assert.equal(A.compute(Object.assign(D(), { strategy: 'negative', xPct: 0 })).ok, true);
  assert.equal(A.compute(Object.assign(D(), { strategy: 'negative', xPct: 30 })).ok, true);
  assert.equal(A.compute(Object.assign(D(), { strategy: 'negative', xPct: -1 })).ok, false);
  assert.equal(A.compute(Object.assign(D(), { strategy: 'negative', xPct: 30.1 })).ok, false);
  assert.equal(A.compute(Object.assign(D(), { strategy: 'negative', xPct: 100 })).ok, false);
  // x = 0 与匀速必须给出同一个 T₂
  const a = A.compute(Object.assign(D(), { strategy: 'negative', xPct: 0 }));
  const b = A.compute(Object.assign(D(), { strategy: 'uniform' }));
  assert.ok(near(a.T2Sec, b.T2Sec, 1e-15));
});

test('F5 分段粒度只接受 1 / 2 / 5 / 10', () => {
  [1, 2, 5, 10].forEach((g) => assert.equal(A.compute(Object.assign(D(), { splitEvery: g })).ok, true, 'g=' + g));
  [0, 3, 7, 20, -5].forEach((g) => {
    const r = A.compute(Object.assign(D(), { splitEvery: g }));
    assert.equal(r.ok, false, 'g=' + g + ' 不该通过');
    assert.equal(r.errors.some((e) => e.field === 'splitEvery'), true);
  });
});

/* ───────────────────────── G. 退化 ───────────────────────── */
test('G1 D₂ = D₁ → T₂ = T₁（幂律退化成恒等）', () => {
  const r = A.compute({ known: { dist: 10, time: '50:00' }, target: { preset: '10k' }, k: 1.06, splitEvery: 1 });
  assert.ok(near(r.T2Sec, 3000, 1e-12));
  assert.ok(near(r.p2Sec, 300, 1e-12));
  assert.equal(r.ratio, 1);
});

test('G2 目标更短时配速更快（k>1 的方向性）', () => {
  const r = A.compute({ known: { dist: 42.195, time: '3:50:01' }, target: { preset: '10k' }, k: 1.06, splitEvery: 1 });
  assert.ok(r.p2Sec < r.p1Sec);
  assert.ok(r.T2Sec < r.T1Sec);
});

test('G3 匀速时忽略 xPct（改了也不影响结论）', () => {
  const a = A.compute(Object.assign(D(), { strategy: 'uniform', xPct: 0 }));
  const b = A.compute(Object.assign(D(), { strategy: 'uniform', xPct: 25 }));
  assert.equal(a.T2Sec, b.T2Sec);
  assert.equal(a.halfExtraSec, 0);
});

test('G4 未启用目标时间时不做反推，也不校验它的内容', () => {
  const r = A.compute(Object.assign(D(), { goal: { use: false, time: '' } }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.rev.use, false);
  assert.equal(r.rev.needPaceSec, undefined);
  const r2 = A.compute(Object.assign(D(), { goal: { use: false, time: '瞎写的' } }));
  assert.equal(r2.ok, true);
});

/* ───────────────────────── H. 非法输入逐条核字段（30+） ───────────────────────── */
test('H1 逐条非法输入：确认字段与消息，不静默兜底', () => {
  const cases = [
    ['known 距离为空串', { known: { dist: '', time: '50:00' } }, 'known.dist'],
    ['known 距离是文字', { known: { dist: '十公里', time: '50:00' } }, 'known.dist'],
    ['known 距离是 0', { known: { dist: 0, time: '50:00' } }, 'known.dist'],
    ['known 距离为负', { known: { dist: -10, time: '50:00' } }, 'known.dist'],
    ['known 距离 0.05（小于下限）', { known: { dist: 0.05, time: '50:00' } }, 'known.dist'],
    ['known 距离 600（超上限）', { known: { dist: 600, time: '50:00' } }, 'known.dist'],
    ['known 时间空串', { known: { dist: 10, time: '' } }, 'known.time'],
    ['known 时间空白', { known: { dist: 10, time: '   ' } }, 'known.time'],
    ['known 时间全是字', { known: { dist: 10, time: '五十分钟' } }, 'known.time'],
    ['known 时间 0', { known: { dist: 10, time: '0' } }, 'known.time'],
    ['known 时间负数', { known: { dist: 10, time: '-50:00' } }, 'known.time'],
    ['known 时间 3 秒（小于下限）', { known: { dist: 10, time: '0:03' } }, 'known.time'],
    ['known 时间 49 小时', { known: { dist: 10, time: '49:00:00' } }, 'known.time'],
    ['known 时间 秒位 99', { known: { dist: 10, time: '50:99' } }, 'known.time'],
    ['k 是文字', { k: '快一点' }, 'k'],
    ['k = 0.4', { k: 0.4 }, 'k'],
    ['k = 1.6', { k: 1.6 }, 'k'],
    ['k 为空串', { k: '' }, 'k'],
    ['k = NaN', { k: NaN }, 'k'],
    ['负分段 x 为空', { strategy: 'negative', xPct: '' }, 'xPct'],
    ['负分段 x = -0.1', { strategy: 'negative', xPct: -0.1 }, 'xPct'],
    ['负分段 x = 31', { strategy: 'negative', xPct: 31 }, 'xPct'],
    ['正分段 x = 100', { strategy: 'positive', xPct: 100 }, 'xPct'],
    ['粒度 3（不在允许集合）', { splitEvery: 3 }, 'splitEvery'],
    ['粒度为空', { splitEvery: '' }, 'splitEvery'],
    ['粒度 0', { splitEvery: 0 }, 'splitEvery'],
    ['粒度 -1', { splitEvery: -1 }, 'splitEvery'],
    ['自定距离为空', { target: { preset: 'custom', dist: '' } }, 'target.dist'],
    ['自定距离 0', { target: { preset: 'custom', dist: 0 } }, 'target.dist'],
    ['自定距离 2000', { target: { preset: 'custom', dist: 2000 } }, 'target.dist'],
    ['自定距离为负', { target: { preset: 'custom', dist: -42 } }, 'target.dist'],
    ['启用目标但时间为空', { goal: { use: true, time: '' } }, 'goal.time'],
    ['启用目标但时间看不懂', { goal: { use: true, time: '三小时半' } }, 'goal.time'],
    ['启用目标但时间为 0', { goal: { use: true, time: '0' } }, 'goal.time'],
    ['启用目标但时间 2 秒', { goal: { use: true, time: '0:02' } }, 'goal.time'],
    ['启用目标但时间 50 小时', { goal: { use: true, time: '50:00:00' } }, 'goal.time'],
  ];
  let n = 0;
  cases.forEach(([name, patch, field]) => {
    const r = A.compute(Object.assign(D(), patch));
    assert.equal(r.ok, false, name + ' 应当报错');
    assert.equal(r.fatal, true, name);
    assert.ok(r.errors.some((e) => e.field === field), name + ' 应在 ' + field + ' 上报错，实际 ' + JSON.stringify(r.errors));
    r.errors.forEach((e) => assert.ok(e.msg && e.msg.length > 2, name + ' 的消息要能看懂'));
    n++;
  });
  assert.equal(n, 36);
});

test('H2 一次多错一起报（不是只报第一个）', () => {
  const r = A.compute({ known: { dist: -1, time: 'abc' }, target: { preset: 'custom', dist: 0 }, k: 9, strategy: 'negative', xPct: 88, splitEvery: 3, goal: { use: true, time: '' }, unit: 'km' });
  assert.equal(r.ok, false);
  const fields = r.errors.map((e) => e.field);
  ['known.dist', 'known.time', 'target.dist', 'k', 'xPct', 'splitEvery', 'goal.time'].forEach((f) => {
    assert.ok(fields.indexOf(f) >= 0, '缺 ' + f + '：' + JSON.stringify(fields));
  });
  assert.ok(r.errors.length >= 7);
});

test('H3 未知枚举值退回默认而不是崩掉，且不静默改数字', () => {
  const r = A.compute({ unit: '光年', strategy: '倒着跑', target: { preset: '跑一百公里' }, splitEvery: 5, known: { dist: 10, time: '50:00' } });
  assert.equal(r.cfg.unit, 'km');
  assert.equal(r.cfg.strategy, 'uniform');
  assert.equal(r.cfg.target.preset, 'full');
  assert.ok(near(r.D2Km, 42.195, 1e-12));
});

test('H4 空串 ≠ 没填：空串一律报错，缺失才用默认', () => {
  const emptyStr = A.compute({ known: { dist: 10, time: '' }, target: { preset: 'full' }, k: 1.06, splitEvery: 5 });
  assert.equal(emptyStr.ok, false);
  const missing = A.compute({ known: { dist: 10, time: '50:00' } });
  assert.equal(missing.ok, true);
  assert.equal(missing.cfg.k, 1.06);
  assert.equal(missing.cfg.splitEvery, 5);
  assert.equal(missing.cfg.strategy, 'uniform');
  assert.equal(missing.cfg.goal.use, true);
});

/* ───────────────────────── I. 单调性与不变量 ───────────────────────── */
test('I1 T₂ 关于 D₂ 与 k 严格递增', () => {
  let prev = -1;
  [5, 10, 21.0975, 42.195, 80].forEach((d) => {
    const r = A.compute({ known: { dist: 10, time: '50:00' }, target: { preset: 'custom', dist: d }, k: 1.06, splitEvery: 5 });
    assert.ok(r.T2Sec > prev, 'D₂=' + d);
    prev = r.T2Sec;
  });
  prev = -1;
  [0.5, 0.9, 1, 1.06, 1.2, 1.5].forEach((k) => {
    const r = A.compute(Object.assign(D(), { k }));
    assert.ok(r.T2Sec > prev, 'k=' + k);
    prev = r.T2Sec;
  });
});

test('I2 300 组随机配置：自检全过 + 5 条不变量（约 6,000 条断言）', () => {
  let seed = 20261112;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let assertions = 0, cfgCount = 0;
  for (let i = 0; i < 300; i++) {
    const d1 = 0.5 + rnd() * 40;
    const p1 = 180 + rnd() * 240;
    const t1 = d1 * p1;
    const d2 = 0.5 + rnd() * 100;
    const k = 0.9 + rnd() * 0.3;
    const x = Math.round(rnd() * 20);
    const st = ['uniform', 'negative', 'positive'][Math.floor(rnd() * 3)];
    const g = [1, 2, 5, 10][Math.floor(rnd() * 4)];
    const r = A.compute({ known: { dist: Number(d1.toFixed(4)), time: A.fmtHMS(t1) }, target: { preset: 'custom', dist: Number(d2.toFixed(4)) }, k: Number(k.toFixed(3)), strategy: st, xPct: x, splitEvery: g, goal: { use: true, time: A.fmtHMS(d2 * p1 * 0.95) } });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.selfFail, 0, '自检失败：' + r.checks.filter((c) => !c.ok).map((c) => c.name));
    const sumD = r.splits.reduce((a, s) => a + s.distKm, 0);
    assert.ok(near(sumD, r.D2Km, 1e-11), 'Σ段距离');
    const sumT = r.splits.reduce((a, s) => a + s.segSec, 0);
    assert.ok(near(sumT, r.T2Sec, 1e-10), 'Σ段用时');
    assert.ok(near(r.p2Sec, r.T2Sec / r.D2Km, 1e-12), '配速口径');
    assert.ok(near(r.vKmh, 3600 / r.p2Sec, 1e-12), '速度口径');
    r.splits.forEach((s, j) => { if (j) assert.ok(s.cumSec >= r.splits[j - 1].cumSec); });
    assert.ok(r.halfSec > 0 && r.halfSec < r.T2Sec, '半程点必须在赛程内');
    assertions += 5 + r.splits.length * 2 + r.checks.length;
    cfgCount++;
  }
  assert.equal(cfgCount, 300);
  assert.ok(assertions > 6000, '随机压力累计断言数 ' + assertions);
  console.log('    随机压力：' + cfgCount + ' 组配置、累计约 ' + assertions + ' 条断言，0 失败');
});

test('I3 反推不变量：所需配速 × D₂ = 目标时间；反解回 D₁ 得 T₁', () => {
  [[3000, '10', 42.195, 12600], [2400, '5', 21.0975, 6000], [1800, '3', 10, 3300]].forEach(([t1, d1, d2, goal]) => {
    const r = A.compute({ known: { dist: Number(d1), time: A.fmtHMS(t1) }, target: { preset: 'custom', dist: d2 }, k: 1.06, splitEvery: 5, goal: { use: true, time: A.fmtHMS(goal) } });
    assert.ok(near(r.rev.needPaceSec * r.D2Km, goal, 1e-12));
    assert.ok(near(r.rev.equivT1Sec, t1, 1e-9));
    assert.ok(near(r.rev.fasterTotalSec, r.T2Sec - goal, 1e-12));
    assert.ok(near(r.rev.perKm5Sec, 5 * r.D2Km, 1e-12));
  });
});

test('I4 100 组随机反推：所需配速 × D₂ = 目标时间，且反解回 D₁ 得 T₁', () => {
  let seed = 777001;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 100; i++) {
    const d1 = 1 + rnd() * 30, p1 = 200 + rnd() * 200;
    const d2 = 1 + rnd() * 80;
    const goal = d2 * (p1 * (0.6 + rnd() * 0.6));
    const r = A.compute({ known: { dist: Number(d1.toFixed(4)), time: A.fmtHMS(d1 * p1) }, target: { preset: 'custom', dist: Number(d2.toFixed(4)) }, k: 1.06, splitEvery: 5, goal: { use: true, time: A.fmtHMS(goal) } });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(near(r.rev.needPaceSec * r.D2Km, A.parseTime(A.fmtHMS(goal)), 1e-9), '所需配速回代');
    assert.ok(near(r.rev.equivT1Sec, r.T1Sec, 1e-9), '反解回 D₁');
    assert.equal(r.selfFail, 0);
  }
});

/* ───────────────────────── J. 自检「会红」与确定性 ───────────────────────── */
test('J1 自检在合法配置上全过，在被人为改坏的输出上必须报红', () => {
  const r = A.compute(D());
  assert.ok(r.checks.length >= 18, '自检条数 ' + r.checks.length);
  assert.equal(r.selfFail, 0);
  const bad = JSON.parse(JSON.stringify(r));
  bad.T2Sec = bad.T2Sec * 1.01;
  const chk = A.selfCheck(bad);
  const fails = chk.filter((c) => !c.ok);
  assert.ok(fails.length >= 2, '改坏 T₂ 之后应当有多条自检报红，实际 ' + fails.length);
  const bad2 = JSON.parse(JSON.stringify(r));
  bad2.splits[2].segSec = 0;
  assert.ok(A.selfCheck(bad2).filter((c) => !c.ok).length >= 1, '段用时被改坏也要报红');
});

test('J2 确定性与纯函数：不改输入、两次结果一致', () => {
  const cfg = A.defaults();
  const snap = JSON.stringify(cfg);
  const a = A.compute(cfg), b = A.compute(cfg);
  assert.equal(JSON.stringify(cfg), snap, 'compute 不应该改输入对象');
  assert.equal(a.T2Sec, b.T2Sec);
  assert.equal(JSON.stringify(a.splits), JSON.stringify(b.splits));
  assert.equal(JSON.stringify(A.compute(cfg)), JSON.stringify(A.compute(cfg)));
});

test('J3 输出无 NaN / Infinity，且可 JSON 序列化', () => {
  [D(), Object.assign(D(), { strategy: 'negative', xPct: 30 }), Object.assign(D(), { unit: 'mi', known: { dist: 6.2, time: '48:00' }, target: { preset: 'custom', dist: 100 }, splitEvery: 10, k: 1.5 })]
    .forEach((cfg) => {
      const r = A.compute(cfg);
      assert.equal(r.ok, true, JSON.stringify(r.errors));
      const nums = [r.T2Sec, r.p1Sec, r.p2Sec, r.p2MiSec, r.vKmh, r.vMph, r.halfSec, r.pASec, r.pBSec, r.ratio];
      nums.forEach((x) => assert.ok(isFinite(x), 'NaN: ' + x));
      r.splits.forEach((s) => { assert.ok(isFinite(s.segSec) && isFinite(s.paceSec) && isFinite(s.cumSec) && isFinite(s.distKm)); });
      JSON.stringify(r);
    });
});

/* ───────────────────────── K. 极端值 ───────────────────────── */
test('K1 极短距离与极慢/极快配速仍能算', () => {
  const quick = A.compute({ known: { dist: 0.1, time: '0:05' }, target: { preset: '5k' }, k: 1.06, splitEvery: 1 });
  assert.equal(quick.ok, true);
  // 已知成绩那边：0.1 公里 5 秒 = 50 秒/公里 = 72 km/h（注意 vKmh 是「目标距离」的平均速度，不是这一项）
  assert.ok(near(3600 / quick.p1Sec, 72, 1e-12), String(3600 / quick.p1Sec));
  assert.ok(quick.p2Sec > quick.p1Sec, '距离拉长 50 倍、k>1，配速必然更慢');
  assert.ok(isFinite(quick.vKmh));
  const slow = A.compute({ known: { dist: 500, time: '48:00:00' }, target: { preset: 'custom', dist: 0.1 }, k: 1.06, splitEvery: 1 });
  assert.equal(slow.ok, true);
  assert.ok(slow.p2Sec > 0);
  assert.equal(slow.splits.length, 1);
});

test('K2 配速超过 60 分钟时以 h:mm:ss 显示（不出现 90:00 这种写法）', () => {
  assert.equal(A.fmtPace(5400), '1:30:00');
  assert.equal(A.fmtPace(3599), '59:59');
});

/* ───────────────────────── L. 导出契约 ───────────────────────── */
test('L1 CSV：段数对齐、含结论与自检、可被逐行解析', () => {
  const r = A.compute(D());
  const csv = A.toCSV(r);
  const lines = csv.trim().split('\n');
  assert.ok(lines[0].indexOf('#') === 0);
  assert.ok(csv.indexOf('预测完赛时间') > 0);
  assert.ok(csv.indexOf('3:50:01') > 0);
  const segLines = lines.filter((l) => /^\d+ \| /.test(l));
  assert.equal(segLines.length, r.nSeg, 'CSV 里的分段行数应等于段数');
  assert.ok(csv.indexOf('自检（' + (r.checks.length - r.selfFail) + '/' + r.checks.length + '）') > 0);
  segLines.forEach((l) => {
    const cols = l.split(' | ');
    assert.equal(cols.length, 6, l);
    assert.ok(A.parseTime(cols[4]) > 0, '段用时可解析：' + l);
    assert.ok(A.parseTime(cols[5]) > 0, '累计可解析：' + l);
  });
  assert.equal(A.toCSV({ fatal: true }), '');
});

test('L2 MD：含表格与关键锚点，段行数对齐', () => {
  const r = A.compute(Object.assign(D(), { strategy: 'negative', xPct: 5 }));
  const md = A.toMD(r);
  assert.ok(md.indexOf('# 先算配速再开跑') === 0);
  assert.ok(md.indexOf('| 段 | 区间 | 段距离 | 段配速 | 段用时 | 累计 |') > 0);
  const rows = md.split('\n').filter((l) => /^\| \d+ \| /.test(l));
  assert.equal(rows.length, r.nSeg);
  assert.ok(md.indexOf('5:43') > 0 && md.indexOf('5:11') > 0);
  assert.ok(md.indexOf('自检（' + (r.checks.length - r.selfFail) + '/' + r.checks.length + '）') > 0);
  assert.equal(A.toMD(null), '');
});

test('L3 敏感性表：k 从 1.00 到 1.10 共 11 行，首行等于线性口径', () => {
  const r = A.compute(D());
  assert.equal(r.sensK.length, 11);
  assert.equal(r.sensK[0].k, 1);
  assert.equal(r.sensK[10].k, 1.1);
  assert.ok(near(r.sensK[0].sec, r.T1Sec * r.ratio, 1e-12));
  assert.equal(r.sensK[6].k, 1.06);                          // 1.00 起第 7 行才是当前 k=1.06
  assert.ok(near(r.sensK[6].sec, r.T2Sec, 1e-12));
  assert.equal(r.sensK[6].isBase, true);
  assert.equal(r.sensK[5].isBase, false);
  assert.equal(r.sensPace.length, 3);
  assert.ok(near(r.sensPace[0].sec, (r.p2Sec - 5) * r.D2Km, 1e-12));
  assert.ok(near(r.sensPace[1].sec, r.T2Sec, 1e-12));
});

test('L4 版本与常量暴露正确', () => {
  assert.equal(A.VERSION, '1.0.0');
  assert.equal(A.MI_KM, 1.609344);
  assert.equal(A.PRESETS.length, 5);
  assert.equal(A.PRESETS.filter((p) => p.id === 'half')[0].km, 21.0975);
  assert.equal(A.LIMITS.splitChoices.join(','), '1,2,5,10');
});
