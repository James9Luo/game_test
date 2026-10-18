/**
 * tools/phase_probe.mjs —— 相位最小复现：单关扫 φ ∈ [0,1)，打印 tStar / 完美点速度 / 早窗 / 晚窗
 *
 *   node tools/phase_probe.mjs --level=49
 *   node tools/phase_probe.mjs --level=49 --step=0.0625
 *   node tools/phase_probe.mjs --level=16 --step=0.1 --table
 *
 * 用途：**相位对窗口的作用没有闭式解**（v(tStar) 依赖 tStar，而 tStar 又随 φ 移动），
 *       所以不要用「φ=0.25 最慢/最快」这类口诀，直接跑这张扫描表看实测。
 *
 * 输出列：
 *   φ           相位
 *   tStar(ms)   u(tStar)=uStar 的解（随 φ 变化，这就是没有闭式解的原因）
 *   v(tStar)    完美点瞬时速度（px/s，由 u(t) 中心差分求得；路径总长 × du/dt）
 *   早/晚(ms)   pct 掉到 passRate 的两侧边界（与 hitWindow 同口径）
 *   窗宽(ms)    (|早|+|晚|)/2
 *   早>晚?      该关早窗是否比晚窗宽（实测，不预设方向）
 */

import path from 'node:path';
import { ROOT, readJson, exists, makeReporter, printTable, C } from './_io.mjs';
import { core } from './_core.mjs';

const { buildLevel, judge, hitWindow, uAt, readMotion, inspectShapes } = core;

const argv = process.argv.slice(2);
const argNum = (name, dflt) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.split('=')[1]) : dflt;
};
const LEVEL_ID = argNum('level', 49);
const STEP = Math.max(0.01, argNum('step', 0.0625));

const LEVELS_PATH = path.join(ROOT, 'assets/resources/config/levels.json');
const SHAPES_PATH = path.join(ROOT, 'assets/config/shapes.json');
const rep = makeReporter(`phase_probe：L${LEVEL_ID} 相位扫描（step ${STEP}）`);

if (!exists(LEVELS_PATH)) {
    rep.bad('找不到 levels.json，先跑 node tools/export_levels.mjs');
    process.exit(rep.finish());
}
if (!exists(SHAPES_PATH)) {
    rep.bad('找不到 assets/config/shapes.json（相位扫描必须用真形状，占位形状的窗口没有参考价值）');
    process.exit(rep.finish());
}
const rawLevels = readJson(LEVELS_PATH);
const levels = Array.isArray(rawLevels) ? rawLevels : rawLevels.levels || [];
const lv = levels.find((l) => l.id === LEVEL_ID);
if (!lv) {
    rep.bad(`levels.json 里没有 L${LEVEL_ID}`);
    process.exit(rep.finish());
}
const sinsp = inspectShapes(readJson(SHAPES_PATH));
if (sinsp.errors.length > 0) {
    for (const e of sinsp.errors.slice(0, 5)) rep.bad(e);
    process.exit(rep.finish());
}
const shapes = sinsp.shapes;

const m = readMotion(lv);
rep.info(
    `L${lv.id} ${lv.name}｜path=${lv.path} cycle=${lv.cycleMs} turns=${lv.turns} speedStage=${lv.speedStage}｜` +
        `amp=${m.sineAmp} T_sine=${m.sinePeriodMs} φ=${m.sinePhase}｜inertia=${m.inertiaPx}px@${m.inertiaHz}Hz φi=${m.inertiaPhase}｜passRate=${lv.passRate}`,
);
if (m.sineAmp === 0) rep.warn('该关 sineAmp=0：相位对它完全无效（所有 φ 的行应逐位相同），适合当兼容性对照');
rep.info(`cycle/T_sine = ${(lv.cycleMs / m.sinePeriodMs).toFixed(4)}（整数比附近时，φ 与窗口的关系会更"跳"）`);

/** 完美点瞬时速度（px/s）：u(t) 中心差分 × 路径长；h=0.5ms */
function speedAt(mover, tMs) {
    const h = 0.5;
    const du = (uAt(mover, tMs + h) - uAt(mover, tMs - h)) / (2 * h); // 1/ms
    return du * mover.pathLen * 1000;
}

const rows = [];
let sumW = 0;
let count = 0;
for (let ph = 0; ph < 1 - 1e-9; ph += STEP) {
    const def = { ...lv, sinePhase: Number(ph.toFixed(4)) };
    // seed 固定 0：与 levels.json 里的 hitWindow 同口径（jitter 抽签相同），方便直接对账
    const rt = buildLevel(def, shapes, 0);
    const w = hitWindow(rt);
    const v = speedAt(rt.movers[0], rt.perfectMs);
    const width = (Math.abs(w.earlyMs) + Math.abs(w.lateMs)) / 2;
    sumW += width;
    count++;
    const r = judge(rt, rt.perfectMs);
    rows.push([
        def.sinePhase.toFixed(4),
        rt.perfectMs.toFixed(1),
        v.toFixed(1),
        w.earlyMs.toFixed(1),
        w.lateMs.toFixed(1),
        width.toFixed(1),
        r.pct.toFixed(2),
        Math.abs(w.earlyMs) > Math.abs(w.lateMs) ? '是' : '否',
    ]);
}
printTable(
    ['φ', 'tStar(ms)', 'v(tStar) px/s', '早ms', '晚ms', '窗宽ms', 'pct@tStar', '早>晚'],
    rows,
    ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
);
const widths = rows.map((r) => parseFloat(r[5]));
const wMax = Math.max(...widths);
const wMin = Math.min(...widths);
rep.info(`实测：最宽 ${wMax.toFixed(1)}ms @ φ=${rows[widths.indexOf(wMax)][0]}，最窄 ${wMin.toFixed(1)}ms @ φ=${rows[widths.indexOf(wMin)][0]}，比值 ${(wMax / wMin).toFixed(2)}×`);
rep.info('结论口径：只看这张表，不背口诀。v(tStar) 越大 → 窗口越窄（完美点通过得越快，越难卡）。');
process.exit(rep.finish());
