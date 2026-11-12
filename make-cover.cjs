#!/usr/bin/env node
/* 批次 57 封面（1200×1200）：数字全部来自同一次引擎输出（先跑 core.js 并落盘 evidence/封面取值.json）。
 * 画法：生成 1200×1200 临时 HTML，用 agent-browser 截图 → 01-pace-split/cover.png。不手抄任何数字。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = fs.existsSync(path.join(__dirname, '01-pace-split')) ? __dirname : path.dirname(__dirname);
const APP = path.join(ROOT, '01-pace-split');
const AB = '/Users/xululu/.workbuddy/binaries/node/versions/22.22.2-6/bin/agent-browser';
const SESSION = 'codex57-cover';
const C = require(path.join(APP, 'core.js'));

const v = C.compute(C.defaults());
if (v.fatal || v.selfFail) { console.error('引擎没算干净，不画封面：', v.errors, v.selfFail); process.exit(1); }
const neg = C.compute(Object.assign(C.defaults(), { strategy: 'negative', xPct: 5 }));

const out = {
  D1: v.D1, T1: v.T1Sec, D2: v.D2, D2km: v.D2Km,
  T2: v.T2Sec, T2HMS: C.fmtHMS(v.T2Sec), p2: v.p2Sec, p2HMS: C.fmtPace(v.p2Sec),
  vKmh: v.vKmh, half: v.halfSec, halfHMS: C.fmtHMS(v.halfSec), nSeg: v.nSeg, gDisplay: v.gDisplay,
  k: v.k, k1Sec: v.sensK[0].sec, k1HMS: C.fmtHMS(v.sensK[0].sec),
  k1Delta: C.fmtDelta(Math.abs(v.sensK[0].deltaSec)),
  k1Faster: v.sensK[0].deltaSec < 0,
  neg: { pA: neg.pASec, pA_HMS: C.fmtPace(neg.pASec), pB: neg.pBSec, pB_HMS: C.fmtPace(neg.pBSec), halfExtra: C.fmtDelta(neg.halfExtraSec) },
  rev: { goal: v.rev.goalSec, goalHMS: C.fmtHMS(v.rev.goalSec), needPace: C.fmtPace(v.rev.needPaceSec), fasterPerKm: v.rev.fasterPerKm },
  splits: v.splits.map(function (s) { return { i: s.i, from: s.from, to: s.to, pace: C.fmtPace(s.paceSec), cum: C.fmtHMS(s.cumSec), km: s.distKm }; }),
  selfCount: v.checks.length, selfFail: v.selfFail, unit: C.unitLabel(v.unit)
};
fs.mkdirSync(path.join(ROOT, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'evidence', '封面取值.json'), JSON.stringify(out, null, 2));

/* 赛程轴：等宽格子（每段距离一样，末段除外，这里按距离占比画宽），半程虚线 */
function axis() {
  const W = 1000, H = 118;
  const minP = Math.min.apply(null, v.splits.map(function (s) { return s.paceSec; }));
  const maxP = Math.max.apply(null, v.splits.map(function (s) { return s.paceSec; }));
  let x = 0;
  const cells = v.splits.map(function (s) {
    const w = (s.distKm / v.D2Km) * W;
    const t = (maxP - minP) < 1e-9 ? 0.3 : (s.paceSec - minP) / (maxP - minP);
    const a = (0.18 + 0.5 * t).toFixed(3);
    const show = (s.i % 2 === 1) || s.i === v.nSeg;
    const g = '<g><rect x="' + x.toFixed(1) + '" y="34" width="' + Math.max(2, w - 3).toFixed(1) + '" height="46" rx="5" fill="rgba(43,79,158,' + a + ')"/>' +
      (show ? '<text x="' + (x + w / 2).toFixed(1) + '" y="24" text-anchor="middle" font-size="17" fill="#1b356f">' + C.fmtPace(s.paceSec) + '</text>' +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="100" text-anchor="middle" font-size="16" fill="#4b5359">' + C.fmtHMS(s.cumSec) + '</text>' : '') +
      '</g>';
    x += w;
    return g;
  }).join('');
  const mx = W / 2;
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '">' + cells +
    '<line x1="' + mx + '" x2="' + mx + '" y1="28" y2="86" stroke="#c8552b" stroke-width="3" stroke-dasharray="9 7"/>' +
    '<text x="0" y="114" font-size="15" fill="#7b848a">出发</text>' +
    '<text x="' + mx + '" y="114" text-anchor="middle" font-size="16" fill="#8f3a1c">半程 ' + out.halfHMS + '</text>' +
    '<text x="' + W + '" y="114" text-anchor="end" font-size="15" fill="#7b848a">' + v.D2.toFixed(3) + ' ' + out.unit + '</text>' +
    '</svg>';
}

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:1200px;background:#f1f3f6;font:16px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#15181c}
  .card{margin:40px;width:1120px;height:1120px;background:#fff;border:1px solid #c6cfd6;border-left:8px solid #2b4f9e;padding:46px 52px;display:flex;flex-direction:column}
  h1{font-size:52px;letter-spacing:1px}
  .lede{margin-top:8px;font-size:24px;color:#4b5359}
  .hero{margin-top:26px;padding:22px 26px;background:#fafbfc;border:1px solid #e1e6ea;border-radius:14px}
  .hero .line1{font-size:28px;color:#4b5359}
  .hero .line1 b{color:#15181c}
  .hero .big{font-size:96px;font-weight:700;color:#1b356f;letter-spacing:1px;line-height:1.12}
  .hero .line2{font-size:24px;color:#4b5359;margin-top:2px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px}
  .kpi{background:#fafbfc;border:1px solid #e1e6ea;border-radius:12px;padding:12px 16px}
  .kpi .k{font-size:19px;color:#7b848a}
  .kpi .v{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums}
  .kpi .s{font-size:17px;color:#7b848a}
  .axis{margin-top:20px}
  .axis .cap{font-size:19px;color:#7b848a;margin-bottom:2px}
  .pts{margin-top:16px;display:flex;flex-direction:column;gap:11px}
  .pt{font-size:23px;line-height:1.45;color:#15181c}
  .pt b{color:#1b356f}
  .pt i{font-style:normal;color:#8f3a1c}
  .foot{margin-top:auto;font-size:17px;color:#4b5359;line-height:1.6;border-top:1px solid #e1e6ea;padding-top:14px}
  .foot span{color:#7b848a}
</style></head><body><div class="card">
  <h1>先算配速再开跑</h1>
  <div class="lede">一个成绩换到另一段距离：跑多久、每段该跑到多少</div>

  <div class="hero">
    <div class="line1">已知 <b>${out.D1} ${out.unit} 跑 ${C.fmtHMS(out.T1)}</b>，目标 <b>全马 ${v.D2.toFixed(3)} ${out.unit}</b>（幂律 k = ${v.k}）</div>
    <div class="big">${out.T2HMS}</div>
    <div class="line2">预测完赛时间 · 平均配速 ${out.p2HMS} /${out.unit} · ${v.vKmh.toFixed(2)} km/h</div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="k">半程点累计</div><div class="v">${out.halfHMS}</div><div class="s">匀速口径</div></div>
    <div class="kpi"><div class="k">分段</div><div class="v">${out.nSeg} 段</div><div class="s">每 ${v.gDisplay} ${out.unit}</div></div>
    <div class="kpi"><div class="k">每 ${out.unit} 配速</div><div class="v">${out.p2HMS}</div><div class="s">${v.p2Sec.toFixed(2)} 秒/${out.unit}</div></div>
    <div class="kpi"><div class="k">自检</div><div class="v">${out.selfCount - out.selfFail}/${out.selfCount}</div><div class="s">内部一致性</div></div>
  </div>

  <div class="axis">
    <div class="cap">赛程轴：格子里是每段配速，下面是累计时间，虚线是半程点</div>
    ${axis()}
  </div>

  <div class="pts">
    <div class="pt">同样这两个距离，<i>按配速线性放大（k = 1.00）只得到 ${out.k1HMS}</i> —— 比幂律外推${out.k1Faster ? '快' : '慢'} <b>${out.k1Delta}</b>。</div>
    <div class="pt">负分段 5%：前半 <b>${out.neg.pA_HMS}</b>、后半 <b>${out.neg.pB_HMS}</b>，总时间不变，半程点多花 ${out.neg.halfExtra}。</div>
    <div class="pt">想跑进 ${out.rev.goalHMS}：需要配速 <b>${out.rev.needPace} /${out.unit}</b>，即每${out.unit}要快 ${out.rev.fasterPerKm.toFixed(2)} 秒。</div>
  </div>

  <div class="foot">口径：距离按${out.unit}、配速按分钟/${out.unit}；1 英里 = 1.609344 公里；秒数四舍五入、累计按未取整值求和。<br>
  <span>默认场景是虚构示例，不代表任何真实跑者或赛事；k 是可调旋钮，本页不引用任何研究或他人成绩。页面不联网、不内置成绩库。</span></div>
</div></body></html>`;

const tmp = path.join(ROOT, 'evidence', '_cover.html');
fs.writeFileSync(tmp, html);
try { execFileSync(AB, ['close', '--all'], { encoding: 'utf8', timeout: 60000 }); } catch (e) { }
execFileSync(AB, ['--session', SESSION, 'open', 'file://' + tmp], { encoding: 'utf8', timeout: 120000 });
execFileSync(AB, ['--session', SESSION, 'set', 'viewport', '1200', '1200'], { encoding: 'utf8', timeout: 60000 });
execFileSync('sleep', ['1']);
const shot = path.join(APP, 'cover.png');
execFileSync(AB, ['--session', SESSION, 'screenshot', shot], { encoding: 'utf8', timeout: 120000 });
execFileSync(AB, ['--session', SESSION, 'close', '--all'], { encoding: 'utf8', timeout: 60000 });
const sz = fs.statSync(shot).size;
const b = fs.readFileSync(shot);
console.log('cover.png ' + sz + ' 字节 ' + b.readUInt32BE(16) + '×' + b.readUInt32BE(20) + ' 头 ' + b.slice(0, 8).toString('hex'));
