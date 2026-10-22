/**
 * tools/geometry_test.mjs —— 判定几何的回归门禁（改 Geometry / Judge 后必跑）
 *
 *   node tools/geometry_test.mjs            # 全量（含栅格交叉校验，约 3–5s）
 *   node tools/geometry_test.mjs --fast     # 跳过栅格交叉校验（提交前用这个）
 *   node tools/geometry_test.mjs --no-perf  # 跳过性能测试（CI 上用）
 *
 * 覆盖：
 *  1) 解析解：两个单位正方形同心相对旋转 θ，交集 = 1 − 2ab
 *       a = 0.5 − 0.5(1−sinθ)/cosθ，b = 0.5 − 0.5(1−cosθ)/sinθ     （θ ∈ [0°,45°]）
 *       黄金点：5°→0.960013 / 15°→0.898956 / 30°→0.845301 / 45°→2√2−2=0.828427（手算 + 精确解双核）
 *  1b) A/B 对照：优化后的 overlapAreaExact vs tools/_geom_baseline.mjs 的改前快照 → 要求逐位 ===
 *  2) 性质测试（不依赖任何公式）：pct(0)=100、[0,45] 单调递减、pct(θ)=pct(90−θ)、pct(90)≈100
 *  3) 栅格解 vs 精确解：偏差 < 0.3%（含凹多边形 L 形）
 *  4) 判定闭环：完美时机 pct≈100/角偏 0/位移 0；早/晚都掉分；双物体同帧都满；同 seed 逐帧一致
 *  5) 路径参数化：7 条模板的 uStar 处必须过 C（≤0.05px）
 *  5b) 热力图条带：overlapStrips / missStrips / heatBands（曾经恒空过，锁死）
 *  6) 性能：judge ≤0.5ms（80 顶点×2 物体）、每帧判定相关开销 ≤0.1ms（决策记录 D-014）
 *  S8) 季 1 回归：sine_amp=0 & inertia=0 的三窗口与 v0.3 基线逐位相同（基线见 tools/_win_baseline_v03.mjs）
 *  S9) 正弦/惯性：同 seed 逐帧一致、完美时机仍 pct≥99.9（惯性在 tStar 归零）、±400ms 单调且无双峰
 *  S9b) 相位对照：同一关 phase 0 vs 0.5，窗口宽度可不同，但都必须「完美时机唯一 + 无双峰 + 同 seed 一致」
 */

import path from 'node:path';
import fs from 'node:fs';
import { ROOT, readJson, exists, rel, makeReporter, printTable, C } from './_io.mjs';
import { placeholderShapes } from './_placeholder_shapes.mjs';
import { core } from './_core.mjs';
import { overlapAreaExactBaseline, overlapPercentBaseline } from './_geom_baseline.mjs';
import { WIN_BASELINE_V03 } from './_win_baseline_v03.mjs';

const {
    overlapAreaExact,
    overlapAreaRaster,
    overlapPercent,
    polyArea,
    rotateAbout,
    buildLevel,
    judge,
    hitWindow,
    windowMetrics,
    godWindow,
    starWindow,
    overlapStrips,
    missStrips,
    heatBands,
    buildPathPts,
    pathLength,
    pointAtU,
    cumulativeLengths,
    uStarOf,
    inspectShapes,
    readMotion,
    readDuo,
    isStaggered,
    moverTiming,
    localT,
    wrapT,
    judgeMover,
    judgeNearest,
    duoVerdict,
    perMoverWindows,
    poseAt,
    objectPtsAt,
    TARGET_SINGLE,
} = core;

const round1 = (x) => Math.round(x * 10) / 10;

const FAST = process.argv.includes('--fast');
const NO_PERF = process.argv.includes('--no-perf');
const SQUARE = [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
];

/** 解析解：两个单位正方形同心，相对旋转 deg 度（0–90°）的交集面积 = 1 − 2ab
 *  a = 0.5 − 0.5(1−sinθ)/cosθ，b = 0.5 − 0.5(1−cosθ)/sinθ
 *  自检：15° → 0.898979、30° → 0.845278、45° → 2√2−2 = 0.828427（三个点手算已核过） */
function analyticSquareOverlap(deg) {
    const d = deg <= 45 ? deg : 90 - deg;
    if (d <= 0) return 1;
    const t = (d * Math.PI) / 180;
    const a = 0.5 - (0.5 * (1 - Math.sin(t))) / Math.cos(t);
    const b = 0.5 - (0.5 * (1 - Math.cos(t))) / Math.sin(t);
    return 1 - 2 * a * b;
}

const rep = makeReporter('geometry_test：判定几何回归');

// ---------- 1) 解析解 ----------
console.log(C.cyan('\n[1] 精确解 vs 解析解（单位正方形，同心旋转）'));
{
    const rows = [];
    for (const deg of [0, 5, 10, 15, 22.5, 30, 37.5, 45]) {
        const P = SQUARE;
        const Q = rotateAbout(SQUARE, 0, 0, deg);
        const got = overlapAreaExact(P, Q);
        const want = analyticSquareOverlap(deg);
        const dev = Math.abs(got - want);
        rows.push([`${deg}°`, got.toFixed(6), want.toFixed(6), dev.toExponential(2)]);
        if (dev > 1e-3) rep.bad(`旋转 ${deg}°：精确解 ${got.toFixed(6)} ≠ 解析解 ${want.toFixed(6)}（差 ${dev.toExponential(2)}）`);
    }
    printTable(['角度', '精确解', '解析解', '偏差'], rows, ['r', 'r', 'r', 'r']);
    const okCount = rows.length - rep.stats.fail;
    if (rep.stats.fail === 0) rep.ok(`8 个角度全部命中解析解（最大偏差 < 1e-3）`);
}
{
    const a15 = overlapAreaExact(SQUARE, rotateAbout(SQUARE, 0, 0, 15));
    const a45 = overlapAreaExact(SQUARE, rotateAbout(SQUARE, 0, 0, 45));
    const a05 = overlapAreaExact(SQUARE, rotateAbout(SQUARE, 0, 0, 5));
    const a30 = overlapAreaExact(SQUARE, rotateAbout(SQUARE, 0, 0, 30));
    const goldRow = (name, got, want) => {
        if (Math.abs(got - want) <= 0.001) rep.ok(`黄金点 ${name} → ${want.toFixed(5)}`, `实测 ${got.toFixed(6)}`);
        else rep.bad(`黄金点 ${name} 应为 ${want.toFixed(5)}`, `实测 ${got.toFixed(6)}`);
    };
    goldRow('旋转 5°', a05, 0.96);
    goldRow('旋转 15°', a15, 0.89896);
    goldRow('旋转 30°', a30, 0.8453);
    goldRow('旋转 45° = 2√2−2', a45, 2 * Math.SQRT2 - 2);

    // 平移用例（解析解直接可算）：重叠宽高 = 边长 − |dx|、边长 − |dy|
    const shiftCase = (dx, dy, want) => {
        const Q = SQUARE.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        const got = overlapAreaExact(SQUARE, Q);
        if (Math.abs(got - want) <= 0.001) rep.ok(`平移 dx=${dx}, dy=${dy} → ${want.toFixed(5)}`, `实测 ${got.toFixed(6)}`);
        else rep.bad(`平移 dx=${dx}, dy=${dy} 应为 ${want.toFixed(5)}`, `实测 ${got.toFixed(6)}`);
    };
    shiftCase(0.25, 0, 0.75);
    shiftCase(0.5, 0.25, 0.375);
    shiftCase(0.3, 0.2, 0.56);
    shiftCase(1, 0, 0);
}

// ---------- 1b) A/B 对照：优化后的 Geometry vs 优化前的基线快照（要求逐位相同） ----------
console.log(C.cyan('\n[1b] A/B 对照：优化后 overlapAreaExact vs 优化前基线（逐位相同才算过）'));
{
    // 固定种子造 400 组随机位姿（含旋转 + 平移 + 缩放），覆盖凹形与接近相切的边界情况
    let s = 12345;
    const rnd = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
    const poly = (n, aspect, wob) => {
        const out = [];
        for (let i = 0; i < n; i++) {
            const t = (i / n) * Math.PI * 2;
            const r = 1 + wob * Math.cos(3 * t + 0.4) + 0.4 * wob * Math.cos(5 * t + 1.7);
            out.push({ x: aspect * Math.cos(t) * r, y: Math.sin(t) * r });
        }
        return out;
    };
    const base = poly(20, 1.4, 0.12);
    const base2 = poly(24, 0.7, 0.2);
    let maxDiff = 0;
    let mismatch = 0;
    let exactZeroBoth = 0;
    for (let i = 0; i < 400; i++) {
        const P = rotateAbout(base, 0, 0, rnd() * 360).map((p) => ({ x: p.x + (rnd() - 0.5) * 1.6, y: p.y + (rnd() - 0.5) * 1.6 }));
        const Q = rotateAbout(base2, 0, 0, rnd() * 360).map((p) => ({ x: p.x + (rnd() - 0.5) * 1.6, y: p.y + (rnd() - 0.5) * 1.6 }));
        const a = overlapAreaExact(P, Q);
        const b = overlapAreaExactBaseline(P, Q);
        if (a === 0 && b === 0) exactZeroBoth++;
        if (a !== b) {
            mismatch++;
            maxDiff = Math.max(maxDiff, Math.abs(a - b));
        }
    }
    printTable(
        ['用例数', '逐位不同', '最大差', '两边都 0'],
        [['400', String(mismatch), maxDiff.toExponential(2), String(exactZeroBoth)]],
        ['r', 'r', 'r', 'r'],
    );
    if (mismatch === 0) rep.ok('400 组随机位姿：优化后与优化前**逐位相同**（===）');
    else rep.bad(`400 组里有 ${mismatch} 组结果不同（最大差 ${maxDiff.toExponential(3)}），优化改变了数值，不能接受`);
    // 整条链路（pct）也对照一次
    const p1 = overlapPercent(base, rotateAbout(base, 0, 0, 23));
    const p2 = overlapPercentBaseline(base, rotateAbout(base, 0, 0, 23));
    if (Math.abs(p1 - p2) < 1e-12) rep.ok('overlapPercent 链路对照一致', `${p1.toFixed(9)}%`);
    else rep.bad(`overlapPercent 链路不一致：${p1} vs ${p2}`);
}

// ---------- 2) 性质测试（不依赖任何闭式公式，最可靠的回归门禁） ----------
console.log(C.cyan('\n[2] 性质测试（不依赖闭式公式）'));
{
    const P = SQUARE;
    const pctAt = (deg) => overlapPercent(rotateAbout(SQUARE, 0, 0, deg), SQUARE);
    // a) 0° 必须 100%
    const p0 = pctAt(0);
    if (Math.abs(p0 - 100) < 1e-6) rep.ok('pct(0°) = 100（同形完全重合）', `${p0.toFixed(9)}%`);
    else rep.bad(`pct(0°) 应 100，实测 ${p0}`);
    // b) [0,45] 单调递减
    let mono = true;
    let prev = Infinity;
    const pts = [];
    for (let d = 0; d <= 45; d += 2.5) {
        const v = pctAt(d);
        pts.push([d, v]);
        if (v > prev + 1e-6) mono = false;
        prev = v;
    }
    if (mono) rep.ok('pct(θ) 在 [0°,45°] 单调递减（2.5° 步长）');
    else rep.bad('pct(θ) 在 [0°,45°] 不单调（判定有 bug）');
    // c) 对称性 pct(θ) = pct(90°−θ)
    let symOk = true;
    for (const d of [5, 12.5, 22.5, 33, 40]) {
        const a = pctAt(d);
        const b = pctAt(90 - d);
        if (Math.abs(a - b) > 0.05) {
            symOk = false;
            rep.bad(`对称性 pct(${d}°)=${a.toFixed(3)} 与 pct(${90 - d}°)=${b.toFixed(3)} 差 >0.05`);
        }
    }
    if (symOk) rep.ok('对称性 pct(θ) = pct(90°−θ)（5 组）');
    // d) 90° 转回自身 → 100%
    const p90 = pctAt(90);
    if (Math.abs(p90 - 100) < 0.1) rep.ok('pct(90°) ≈ 100（正方形转 90° 等价于自身）', `${p90.toFixed(4)}%`);
    else rep.bad(`pct(90°) 应 ≈100，实测 ${p90.toFixed(4)}%`);
    // e) 面积单调性：面积口径下 pct 与「交集面积」完全一致（分母相同时）
    const inter15 = overlapAreaExact(rotateAbout(SQUARE, 0, 0, 15), SQUARE);
    if (Math.abs(inter15 / 1 - pctAt(15) / 100) < 1e-9) rep.ok('pct15 = 交集面积 / 较大者面积（口径自洽）');
    else rep.bad('pct 与交集面积口径不一致');
}

// ---------- 3) 栅格交叉校验 ----------
if (!FAST) {
    console.log(C.cyan('\n[3] 栅格解 vs 精确解（偏差 < 0.3%）'));
    const rasterCheck = (name, P, Q, base) => {
        const exact = overlapAreaExact(P, Q);
        const raster = overlapAreaRaster(P, Q, 0.0008);
        const rel = Math.abs(exact - raster) / base;
        if (rel <= 0.003) rep.ok(`${name} 精确 ${exact.toFixed(5)} vs 栅格 ${raster.toFixed(5)}`, `偏差 ${(rel * 100).toFixed(3)}%`);
        else rep.bad(`${name} 栅格偏差 ${(rel * 100).toFixed(3)}% > 0.3%`, `精确 ${exact.toFixed(5)} / 栅格 ${raster.toFixed(5)}`);
    };
    rasterCheck('正方形 15°', SQUARE, rotateAbout(SQUARE, 0, 0, 15), 1);
    rasterCheck('正方形 22.5°', SQUARE, rotateAbout(SQUARE, 0, 0, 22.5), 1);
    rasterCheck('正方形 30°', SQUARE, rotateAbout(SQUARE, 0, 0, 30), 1);
    rasterCheck('正方形 15°+偏移', SQUARE, rotateAbout(SQUARE, 0.12, -0.08, 15), 1);
    // 凹多边形：L 形（宽 1、高 1、右下缺口 0.5×0.5）
    const L = [
        { x: -0.5, y: -0.5 },
        { x: 0.5, y: -0.5 },
        { x: 0.5, y: 0.0 },
        { x: 0.0, y: 0.0 },
        { x: 0.0, y: 0.5 },
        { x: -0.5, y: 0.5 },
    ];
    if (Math.abs(polyArea(L) - 0.75) > 1e-9) rep.bad('L 形自检：面积应为 0.75', `实测 ${polyArea(L)}`);
    else rep.ok('L 形自检：面积 0.75、凹点 (0,0)');
    rasterCheck('L 形 20°', L, rotateAbout(L, 0, 0, 20), 0.75);
    rasterCheck('L 形 vs 正方形', L, rotateAbout(SQUARE, 0.05, 0.03, 10), 0.75);
}

// ---------- 3) 判定闭环 ----------
console.log(C.cyan('\n[3] 判定闭环（完美时机 / 早 / 晚 / 双物体）'));
// 形状数据：优先用美术的**真实** shapes.json（与运行时同一套校验），缺失/非法才回退占位
const SHAPES_PATH = path.join(ROOT, 'assets/config/shapes.json');
let shapes = null;
let shapeSource = '';
if (exists(SHAPES_PATH)) {
    const sinsp = inspectShapes(readJson(SHAPES_PATH));
    if (sinsp.errors.length === 0) {
        shapes = sinsp.shapes;
        shapeSource = `${rel(SHAPES_PATH)}（美术真数据）`;
    } else {
        rep.warn(`${rel(SHAPES_PATH)} 有 ${sinsp.errors.length} 项错误，改用占位形状（结果只验证逻辑，不代表真机手感）`);
        for (const e of sinsp.errors.slice(0, 3)) rep.warn('  ' + e);
    }
}
if (!shapes) {
    shapes = placeholderShapes();
    shapeSource = 'tools/_placeholder_shapes.mjs（占位）';
}
rep.info(`形状来源：${shapeSource}（${Object.keys(shapes).length} 个轮廓）`);
const levelsPath = path.join(ROOT, 'assets/resources/config/levels.json');
let levels;
if (exists(levelsPath)) {
    const raw = readJson(levelsPath);
    levels = Array.isArray(raw) ? raw : raw.levels;
    rep.info(`关卡配置：${levels.length} 关（${path.relative(ROOT, levelsPath)}）`);
} else {
    levels = [1, 2, 3].map((id) => ({
        id,
        name: `合成关 ${id}`,
        shapeId: 'cup_tumbler',
        outlineId: 'cup_tumbler',
        variant: 'single',
        motion: '旋转',
        path: 'h_line',
        cycleMs: 2600,
        turns: 1,
        jitter: 0,
        toleranceDeg: 15,
        passRate: 0.6,
        star3Rate: 0.93,
        estSec: 4,
        weight: 1,
        attempts: 3,
        note: 'synthetic',
        speedStage: 1,
        linSpeed: [0, 0],
        angSpeed: [0, 0],
    }));
    rep.warn('没有 levels.json，用 3 个合成关跑判定闭环');
}

// 防御：关卡引用了当前形状集里没有的 id（美术改 shapes.json 后最常见的坑）→ 跳过该关并点名，别让整段崩掉
{
    const missing = [];
    levels = levels.filter((lv) => {
        const ids = [lv.shapeId, lv.outlineId, lv.shapeId2].filter(Boolean);
        const lack = ids.filter((id) => !shapes[id]);
        if (lack.length > 0) {
            missing.push(`L${lv.id} 缺 ${lack.join('/')}`);
            return false;
        }
        return true;
    });
    if (missing.length > 0) rep.warn(`跳过 ${missing.length} 关（形状缺失）：${missing.join('；')}`);
    else rep.ok(`levels.json 的 ${levels.length} 关形状全部就位`);
    if (levels.length === 0) {
        rep.bad('没有可跑的关卡（levels.json 为空，或形状全缺）—— 先跑 tools/export_levels.mjs');
        process.exit(rep.finish());
    }
}

for (const def of levels) {
    const rt = buildLevel(def, shapes, def.id * 1000 + 1);
    const tag = `L${def.id}`;
    const desync = isStaggered(def);
    // v0.6：错拍关的「完美时机」在**每个 mover 自己的 perfectMs** 上，而不是全关一个时刻。
    // 同步关（desync=false）保持原来的「同一帧两侧都完美」断言。
    const perMoverPerfect = (rt0) =>
        rt0.movers.map((mv) => {
            const pm = moverTiming(mv).perfectMs;
            return { pm, r: judgeMover(mv, pm), pose: poseAt(mv, pm) };
        });
    if (desync) {
        const pms = perMoverPerfect(rt);
        let bad = 0;
        for (let i = 0; i < pms.length; i++) {
            const { pm, r, pose } = pms[i];
            const laneD = Math.hypot(pose.x - rt.movers[i].targetCenter.x, pose.y - rt.movers[i].targetCenter.y);
            if (r.pct < 99.9) {
                bad++;
                rep.bad(`${tag} [desync] mover${i} 在自身 perfectMs=${pm.toFixed(1)} 仅 ${r.pct.toFixed(2)}%`);
            }
            if (Math.abs(r.angleDev) > 0.01) {
                bad++;
                rep.bad(`${tag} [desync] mover${i} 角度偏差 ${r.angleDev.toFixed(3)}°`);
            }
            if (laneD > 0.05) {
                bad++;
                rep.bad(`${tag} [desync] mover${i} 偏车道中心 ${laneD.toFixed(3)}px`);
            }
        }
        if (bad === 0) {
            rep.ok(
                `${tag} [desync] 各 mover 在各自 perfectMs 上完美`,
                pms.map((x, i) => `m${i}@${x.pm.toFixed(0)}ms pct=${x.r.pct.toFixed(2)}`).join(' / '),
            );
        }
    } else {
        const perfect = judge(rt, rt.perfectMs);
        const minPct = Math.min(...perfect.objects.map((o) => o.pct));
        if (minPct >= 99.9) rep.ok(`${tag} 完美时机 pct ≥ 99.9`, `pct=${perfect.pct.toFixed(3)}% rating=${perfect.rating}`);
        else rep.bad(`${tag} 完美时机 pct 只有 ${perfect.pct.toFixed(3)}%（应 ≈100）`);
        const maxAng = Math.max(...perfect.objects.map((o) => Math.abs(o.angleDev)));
        if (maxAng <= 0.01) rep.ok(`${tag} 完美时机角度偏差 ≈ 0`, `|Δθ|max=${maxAng.toExponential(2)}°`);
        else rep.bad(`${tag} 完美时机角度偏差 ${maxAng}°（startRot 算错）`);
        const maxOff = Math.max(...perfect.objects.map((o) => o.offsetPx));
        if (maxOff <= 0.05) rep.ok(`${tag} 完美时机位移 ≈ 0`, `|Δ|max=${maxOff.toExponential(2)}px`);
        else rep.bad(`${tag} 完美时机位移 ${maxOff.toFixed(4)}px（uStar 没落在 C 上）`);
        if (perfect.timing.verdict === 'onTime' && Math.abs(perfect.timing.deltaMs) < 1e-6) rep.ok(`${tag} 完美时机判为 onTime`);
        else rep.bad(`${tag} 完美时机 timing 错：${JSON.stringify(perfect.timing)}`);
        const perfectPct = perfect.pct;

        // 早/晚都要掉分，且 timing 判断正确（同步关才用全关统一的 perfectMs）
        for (const off of [-200, -100, 100, 200]) {
            const r = judge(rt, rt.perfectMs + off);
            const wantVerdict = off < 0 ? 'early' : 'late';
            const dErr = Math.abs(r.timing.deltaMs - off);
            if (r.timing.verdict !== wantVerdict) rep.bad(`${tag} 按${off < 0 ? '早' : '晚'} ${Math.abs(off)}ms 却判 ${r.timing.verdict}`);
            else if (dErr > 1) rep.bad(`${tag} deltaMs=${r.timing.deltaMs.toFixed(2)} 与输入 ${off} 不符`);
            else if (!(r.pct < perfectPct)) rep.bad(`${tag} 偏 ${off}ms 的 pct(${r.pct.toFixed(2)}) 没有低于完美(${perfectPct.toFixed(2)})`);
            else rep.ok(`${tag} ${wantVerdict} ${Math.abs(off)}ms → pct ${r.pct.toFixed(2)}%`, `Δ=${r.timing.deltaMs.toFixed(1)}ms`);
        }

        // 距离完美时机越远，pct 单调不增（允许 1.5% 抖动，凹形/多峰轮廓可能非严格单调）
        if (def.variant === 'single') {
            let prev = Infinity;
            let monoOk = true;
            for (let off = 0; off <= 400; off += 25) {
                const r = judge(rt, rt.perfectMs + off);
                if (r.pct > prev + 1.5) monoOk = false;
                prev = r.pct;
            }
            if (monoOk) rep.ok(`${tag} pct 随 |Δ| 增大单调不增（0–400ms / 25ms 步）`);
            else rep.warn(`${tag} pct 非严格单调（凹形或多峰导致，人工看一眼）`);

            // 确定性：同 seed 两次 buildLevel 完全一致
            const rt2 = buildLevel(def, shapes, def.id * 1000 + 1);
            const same =
                Math.abs(rt2.perfectMs - rt.perfectMs) < 1e-9 &&
                Math.abs(rt2.movers[0].cycleMs - rt.movers[0].cycleMs) < 1e-9 &&
                Math.abs(rt2.movers[0].startRot - rt.movers[0].startRot) < 1e-9;
            if (same) rep.ok(`${tag} 同 seed 重建逐帧一致（perfectMs/cycleMs/startRot）`);
            else rep.bad(`${tag} 同 seed 重建结果不一致`);
        }
        if (def.variant === 'dual') {
            if (rt.movers.length !== 2) rep.bad(`${tag} dual 关应有 2 个 mover，实有 ${rt.movers.length}`);
            else if (perfect.objects.length === 2 && minPct >= 99.9) rep.ok(`${tag} 双物体同帧都 ≥99.9%`, `两个 pct=${perfect.objects.map((o) => o.pct.toFixed(2)).join(' / ')}`);
            // 双车道同帧硬断言（仅同步关）：每个 mover 在 perfectMs 的姿态必须落在**自己**车道中心（≤0.05px）。
            // 这条能抓到「path × dual 组合下路径长随车道中心变化 → tStar 不同」的 bug（L52 dual+bounce_floor 曾偏 228px）
            let maxLane = 0;
            for (const mv of rt.movers) {
                const p = poseAt(mv, rt.perfectMs);
                maxLane = Math.max(maxLane, Math.hypot(p.x - mv.targetCenter.x, p.y - mv.targetCenter.y));
        }
        if (maxLane <= 0.05) rep.ok(`${tag} 双车道同帧：两侧姿态都在各自车道中心 ≤0.05px`, `path=${def.path}`);
        else rep.bad(`${tag} 双车道不同帧：有一侧偏离车道中心 ${maxLane.toFixed(2)}px（path=${def.path}）—— uStar/tStar 随车道中心漂了`);
        }
    }
    // jitter 边界（同步关/错拍关都查：错拍只改第二 mover 的时间轴，不改随机范围）
    if (def.jitter > 0) {
        let minC = Infinity;
        let maxC = -Infinity;
        for (let s = 0; s < 200; s++) {
            const r = buildLevel(def, shapes, 7919 * (s + 1) + def.id);
            minC = Math.min(minC, r.movers[0].cycleMs);
            maxC = Math.max(maxC, r.movers[0].cycleMs);
        }
        const lo = def.cycleMs * (1 - def.jitter) - 1e-6;
        const hi = def.cycleMs * (1 + def.jitter) + 1e-6;
        if (minC >= lo && maxC <= hi) rep.ok(`${tag} jitter 只在 ±${(def.jitter * 100).toFixed(0)}% 内改周期`, `[${minC.toFixed(1)}, ${maxC.toFixed(1)}] 目标 [${lo.toFixed(1)}, ${hi.toFixed(1)}]`);
        else rep.bad(`${tag} jitter 越界：[${minC.toFixed(1)}, ${maxC.toFixed(1)}] 超出 [${lo.toFixed(1)}, ${hi.toFixed(1)}]`);
    }
}

// ---------- 3b) 诊断：偏离完美时机时「到底差在哪」 ----------
console.log(C.cyan('\n[3b] 诊断：±200ms 的几何明细（角度 / 位移 / 交集面积）'));
{
    const lv = levels[0];
    const rt = buildLevel(lv, shapes, 0);
    const rows = [];
    for (const off of [-200, -100, -50, 0, 50, 100, 200]) {
        const r = judge(rt, rt.perfectMs + off);
        const o = r.objects[0];
        rows.push([
            `${off > 0 ? '+' : ''}${off}`,
            r.pct.toFixed(2),
            o.angleDev.toFixed(2),
            o.offsetPx.toFixed(1),
            o.interArea.toFixed(1),
            polyArea(o.objectPts).toFixed(1),
            o.targetArea.toFixed(1),
            r.rating,
            r.timing.verdict,
        ]);
    }
    printTable(
        ['Δt(ms)', 'pct%', '角偏°', '位移px', '交集面积', '物体面积', '目标面积', '评级', '时机'],
        rows,
        ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'l', 'l'],
    );
    const b = rt.movers[0].targetPts.reduce(
        (acc, p) => ({ minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x), minY: Math.min(acc.minY, p.y), maxY: Math.max(acc.maxY, p.y) }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
    rep.info(
        `L${lv.id} 尺寸参考：物体 longSide=${rt.movers[0].shape.size}px、目标 longSide=${Math.max(b.maxX - b.minX, b.maxY - b.minY).toFixed(1)}px；` +
            `±200ms 时同时偏 ${judge(rt, rt.perfectMs - 200).objects[0].offsetPx.toFixed(1)}px、转 ${Math.abs(judge(rt, rt.perfectMs - 200).objects[0].angleDev).toFixed(1)}°`,
    );
    rep.info('说明：位移与转角是「叠加惩罚」，200ms 早 = 同时错位 + 错角，pct 掉到个位数是这个机制的正常结果（这正是玩法要的因果）');
}

// ---------- 3c) 命中窗口（策划调数值的主指标） ----------
console.log(C.cyan('\n[3c] 命中窗口（pct 掉到 passRate 的边界，纯函数 hitWindow/windowMetrics）'));
{
    const rows = [];
    for (const def of levels) {
        const rt = buildLevel(def, shapes, 0);
        const desync = isStaggered(def);
        // 错拍关：关卡窗口 = 各 mover 中较窄者（每 mover 以自己 perfectMs 为基准）
        const pmw = desync ? perMoverWindows(rt) : null;
        const w = desync
            ? {
                  earlyMs: pmw.levelHit.earlyMs,
                  lateMs: pmw.levelHit.lateMs,
                  tolDeg: 0,
                  tolPx: 0,
                  wide: pmw.levelHit.earlyWide || pmw.levelHit.lateWide,
                  byMover: pmw.hit,
              }
            : (() => {
                  const x = windowMetrics(rt);
                  return { earlyMs: x.earlyMs, lateMs: x.lateMs, tolDeg: x.tolDeg, tolPx: x.tolPx, wide: x.earlyWide || x.lateWide, byMover: null };
              })();
        rows.push([
            `L${def.id}`,
            desync ? `${def.shapeId}+${def.shapeId2 ?? '?'}` : def.shapeId,
            `${def.cycleMs}`,
            `${def.turns}`,
            `${w.earlyMs.toFixed(1)}`,
            `${w.lateMs.toFixed(1)}`,
            `${(Math.abs(w.earlyMs) + Math.abs(w.lateMs)).toFixed(1)}`,
            desync ? '-' : `${w.tolDeg.toFixed(1)}`,
            desync ? '-' : `${w.tolPx.toFixed(1)}`,
            desync
                ? `[desync] ` + w.byMover.map((x) => `${x.earlyMs.toFixed(0)}/${x.lateMs.toFixed(0)}`).join(' | ')
                : w.wide
                  ? '窗口触周期边界!'
                  : '',
        ]);
    }
    printTable(
        ['关', '形状', '周期ms', '圈', '早ms', '晚ms', '总窗口', '角容错°', '位移容错px', '告警'],
        rows,
        ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
    );
    rep.info('错拍关（[desync]）的「总窗口」= 两个 mover 中较窄者；告警列给出每个 mover 各自的早/晚窗口');
    rep.info('注意：此处用的是占位形状（tools/_placeholder_shapes.mjs）；真 shapes.json 到位后窗口会变，数值由主策划按窗口重调 cycle_ms/turns');
}

// ---------- S8) 季 1 回归：零调制时三窗口必须与 v0.3 逐位相同 ----------
console.log(C.cyan('\n[S8] 季 1 回归：sine_amp=0 & inertia=0 的三窗口 vs v0.3 基线（逐位相同）'));
{
    const rows = [];
    let badCount = 0;
    let checked = 0;
    const eq = (a, b) => Math.abs(a - b) < 1e-9;
    for (const base of WIN_BASELINE_V03.levels) {
        const lv = levels.find((l) => l.id === base.id);
        if (!lv) {
            rep.warn(`S8：levels.json 里没有 L${base.id}（60 关表缺季 1 行？）`);
            continue;
        }
        const m = readMotion(lv);
        if (m.sineAmp !== 0 || m.inertiaPx !== 0) {
            rep.bad(`S8：L${base.id} 是季 1 却开了调制（sineAmp=${m.sineAmp}, inertiaPx=${m.inertiaPx}）`);
            continue;
        }
        const rt = buildLevel(lv, shapes, 0);
        // 输入一致性诊断：cycle/turns/pass/star3 变了 → 窗口当然会变，先说清楚是哪一类
        const inputChanged =
            Math.abs(lv.cycleMs - base.cycleMs) > 1e-6 ||
            lv.turns !== base.turns ||
            Math.abs(lv.passRate - base.passRate) > 1e-9 ||
            Math.abs(lv.star3Rate - base.star3Rate) > 1e-9;
        if (inputChanged) {
            rep.warn(
                `S8：L${base.id} 的输入参数相对 v0.3 变了（cycle ${base.cycleMs}→${lv.cycleMs}、turns ${base.turns}→${lv.turns}、pass ${base.passRate}→${lv.passRate}、star3 ${base.star3Rate}→${lv.star3Rate}）→ 窗口变化属预期，基线需由主策划重定`,
            );
        }
        const hit = round1(hitWindow(rt).earlyMs);
        const hitL = round1(hitWindow(rt).lateMs);
        const god = round1(godWindow(rt).earlyMs);
        const godL = round1(godWindow(rt).lateMs);
        const star = round1(starWindow(rt).earlyMs);
        const starL = round1(starWindow(rt).lateMs);
        const ok =
            eq(hit, base.hit[0]) && eq(hitL, base.hit[1]) &&
            eq(god, base.god[0]) && eq(godL, base.god[1]) &&
            eq(star, base.star[0]) && eq(starL, base.star[1]);
        checked++;
        if (!ok) {
            badCount++;
            rep.bad(
                `S8：L${base.id} 窗口漂了 —— 实测 通关[${hit},${hitL}] 神级[${god},${godL}] 三星[${star},${starL}] vs v0.3 通关${JSON.stringify(base.hit)} 神级${JSON.stringify(base.god)} 三星${JSON.stringify(base.star)}`,
            );
        }
        rows.push([`L${base.id}`, `${hit}/${hitL}`, base.hit.join('/'), `${god}/${godL}`, base.god.join('/'), `${star}/${starL}`, base.star.join('/'), ok ? 'ok' : '漂移']);
    }
    printTable(['关', '通关', 'v0.3', '神级', 'v0.3', '三星', 'v0.3', ''], rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'l']);
    if (badCount === 0 && checked === WIN_BASELINE_V03.levels.length) {
        rep.ok(`S8 通过：${checked}/${WIN_BASELINE_V03.levels.length} 关三窗口与 v0.3 **逐位相同**（零调制走兼容分支）`);
    } else if (badCount === 0) {
        rep.warn(`S8：只比对了 ${checked}/${WIN_BASELINE_V03.levels.length} 关`);
    } else {
        rep.bad(`S8 失败：${badCount} 关窗口漂移（说明零调制路径不再逐位兼容，季 1 阶梯被污染）`);
        rep.info('排查顺序：① 输入参数是否变了（上面若有 WARN 就是它）；② 美术是否改了季 1 用到的 shapes.json（D-017 要求不改现有 id）；③ 最后才怀疑代码');
    }
}

// ---------- S9) 正弦/惯性：确定性 + 完美时机 + 单调性/双峰 ----------
console.log(C.cyan('\n[S9] 正弦/惯性：同 seed 确定性、u(tStar) 仍落在 C、无双峰（单调超限只 WARN）'));
{
    const rows = [];
    let checked = 0;
    let badCount = 0;
    const modulated = levels.filter((lv) => {
        const m = readMotion(lv);
        return m.sineAmp > 0 || m.inertiaPx > 0;
    });
    if (modulated.length === 0) rep.warn('S9：没有带正弦/惯性的关卡（季 2–4 表可能还没生成）');
    for (const lv of modulated) {
        const m = readMotion(lv);
        const seed = lv.id * 1000 + 7;
        const a = buildLevel(lv, shapes, seed);
        const b = buildLevel(lv, shapes, seed);
        checked++;
        const tag = `L${lv.id}（季${m.season} sine=${m.sineAmp} inertia=${m.inertiaPx}px）`;

        // 1) 同 seed 逐帧一致
        let detOk = Math.abs(a.perfectMs - b.perfectMs) < 1e-12 && Math.abs(a.movers[0].cycleMs - b.movers[0].cycleMs) < 1e-12;
        if (detOk) {
            for (let k = 0; k < 16 && detOk; k++) {
                const t = (k * 137.7) % a.movers[0].cycleMs;
                if (Math.abs(judge(a, t).pct - judge(b, t).pct) > 1e-12) detOk = false;
            }
        }
        if (!detOk) {
            badCount++;
            rep.bad(`S9：${tag} 同 seed 两次构建结果不一致（确定性破功）`);
        }

        // 2) 完美时机：姿态回 C、转角归零、pct ≈ 100（惯性在 tStar 处必须为 0）
        //    错拍关（v0.6）：每个 mover 在**自己的 perfectMs** 上校验（[desync]）
        const desync = isStaggered(lv);
        const pm0 = moverTiming(a.movers[0]).perfectMs;
        const r = judge(a, a.perfectMs);
        let poseD = 0;
        let minPct = 100;
        let maxAng = 0;
        let maxOff = 0;
        if (desync) {
            for (let i = 0; i < a.movers.length; i++) {
                const mv = a.movers[i];
                const pm = moverTiming(mv).perfectMs;
                const rm = judgeMover(mv, pm);
                const pose = poseAt(mv, pm);
                poseD = Math.max(poseD, Math.hypot(pose.x - mv.targetCenter.x, pose.y - mv.targetCenter.y));
                minPct = Math.min(minPct, rm.pct);
                maxAng = Math.max(maxAng, Math.abs(rm.angleDev));
                maxOff = Math.max(maxOff, rm.offsetPx);
            }
        } else {
            poseD = Math.hypot(poseAt(a.movers[0], a.perfectMs).x - a.movers[0].targetCenter.x, poseAt(a.movers[0], a.perfectMs).y - a.movers[0].targetCenter.y);
            minPct = Math.min(...r.objects.map((o) => o.pct));
            maxAng = Math.max(...r.objects.map((o) => Math.abs(o.angleDev)));
            maxOff = Math.max(...r.objects.map((o) => o.offsetPx));
        }
        const perfectOk = poseD <= 0.05 && minPct >= 99.9 && maxAng <= 0.01 && maxOff <= 0.05;
        if (!perfectOk) {
            badCount++;
            rep.bad(
                `S9：${tag}${desync ? ' [desync] 各 mover 在各自 perfectMs 上校验' : ''} 完美时机不完美：pose偏离${poseD.toFixed(4)}px pct=${minPct.toFixed(3)} 角偏=${maxAng.toExponential(2)}° 位移=${maxOff.toFixed(4)}px`,
            );
        }

        // 3) ±400ms 单调 + 双峰检测
        //    单调容差：带惯性 5%（惯性 ±A px 的涟漪本来就 1–5%）、无惯性 3%；超标只报 WARN
        //    双峰：判据不放宽（次峰 ≥70% 主峰 且 ≥40% 才算「第二个能卡住的时刻」）→ FAIL
        const mono = m.inertiaPx > 0 ? 5 : 3;
        const step = 5;
        const series = [];
        for (let dt = -400; dt <= 400; dt += step) {
            // 错拍关：以 mover0 自己的完美时刻为基准（每个 mover 独立成峰）
            series.push([dt, desync ? judgeMover(a.movers[0], pm0 + dt).pct : judge(a, a.perfectMs + dt).pct]);
        }
        let peakIdx = 0;
        for (let i = 1; i < series.length; i++) if (series[i][1] > series[peakIdx][1]) peakIdx = i;
        let monoOk = true;
        for (let i = 1; i <= peakIdx; i++) if (series[i][1] < series[i - 1][1] - mono) monoOk = false;
        for (let i = peakIdx + 1; i < series.length; i++) if (series[i][1] > series[i - 1][1] + mono) monoOk = false;
        // 显著次峰：必须是「第二个真的能卡住的时刻」（阈值见上）
        const peakPct = series[peakIdx][1];
        let secondPeak = null;
        for (let i = 1; i + 1 < series.length; i++) {
            const [t, v] = series[i];
            const isLocalMax = v >= series[i - 1][1] && v >= series[i + 1][1];
            if (isLocalMax && v >= 40 && v >= peakPct * 0.7 && Math.abs(t - series[peakIdx][0]) > 20) {
                secondPeak = { t, v };
                break;
            }
        }
        if (secondPeak) {
            badCount++;
            rep.bad(
                `S9：${tag} 出现双峰：主峰 Δt=${series[peakIdx][0]}ms(${peakPct.toFixed(2)}%)，次峰 Δt=${secondPeak.t}ms(${secondPeak.v.toFixed(2)}%) —— 「两个可以卡住的时刻」等于玩法失效，请检查 sine_period_ms 与 cycle_ms 的比例`,
            );
        } else if (!monoOk) {
            rep.warn(
                `S9：${tag} pct(t) 在 ±400ms 内非单调（主峰 Δt=${series[peakIdx][0]}ms，容差 ${mono}%）—— 惯性涟漪属正常，不拦校准；只要无双峰即可`,
            );
        } else if (detOk && perfectOk) {
            rows.push([
                `L${lv.id}`,
                `季${m.season}`,
                `${m.sineAmp}`,
                `${m.inertiaPx}`,
                `${m.sinePeriodMs}`,
                `${(a.movers[0].cycleMs / m.sinePeriodMs).toFixed(2)}`,
                `${pm0.toFixed(1)}`,
                `${minPct.toFixed(2)}`,
                `${poseD.toExponential(1)}`,
                `${series[peakIdx][0]}`,
                desync ? 'ok [desync]' : 'ok',
            ]);
        }
    }
    if (rows.length > 0) {        printTable(
            ['关', '季', '正弦', '惯性px', '周期ms', 'cycle/period', 'perfectMs', 'pct', 'pose偏', '主峰Δt', '状态'],
            rows,
            ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
        );
    }
    if (badCount === 0) {
        rep.ok(`S9 通过：${checked} 个带调制关卡满足「同 seed 一致 / 完美时机 pct≥99.9 / 无双峰」（单调容差：惯性 5%、无惯性 3%，超限只 WARN）`);
    } else {
        rep.bad(`S9 失败：${badCount}/${checked} 个带调制关卡不达标（双峰 / 确定性 / 完美时机）`);
    }
}

// ---------- S9b) 相位对照：同一关 φ = 0 / 0.25 / 0.5 / 0.75 ----------
// 纪律：**相位对窗口的作用没有闭式解**——v(tStar) 依赖 tStar，而 tStar 又随 φ 移动，
// 所以这里只打印实测值，不对「哪个相位更宽/早晚是否互换」做任何断言。
// 断言只保留必须成立的性质：完美时机唯一（pct≥99.9、姿态落 C ≤0.05px）、无双峰、同 seed 一致。
// （这条纪律是被实测纠正过来的：曾按「φ=0.5 会镜像早/晚」写汇总，45 关实测 0 关互换。）
console.log(C.cyan('\n[S9b] 正弦相位对照（实测）：φ=0 / 0.25 / 0.5 / 0.75 —— 只断言性质，不断言物理猜测'));
{
    const withPhase = (lv, ph) => ({ ...lv, sinePhase: ph });
    const checkVariant = (lv, ph) => {
        const def = withPhase(lv, ph);
        const rt = buildLevel(def, shapes, lv.id * 1000 + 11);
        const duoSrc = isStaggered(lv);
        // 完美时机：同步关看同一时刻两侧；错拍关看**各 mover 在自己的 perfectMs**（[desync]）
        let poseD = 0;
        let minPct = 100;
        const pm0 = moverTiming(rt.movers[0]).perfectMs;
        if (duoSrc) {
            for (let i = 0; i < rt.movers.length; i++) {
                const mv = rt.movers[i];
                const pm = moverTiming(mv).perfectMs;
                const pose = poseAt(mv, pm);
                poseD = Math.max(poseD, Math.hypot(pose.x - mv.targetCenter.x, pose.y - mv.targetCenter.y));
                minPct = Math.min(minPct, judgeMover(mv, pm).pct);
            }
        } else {
            for (const mv of rt.movers) {
                const pose = poseAt(mv, rt.perfectMs);
                const d = Math.hypot(pose.x - mv.targetCenter.x, pose.y - mv.targetCenter.y);
                if (d > poseD) poseD = d;
            }
            minPct = Math.min(...judge(rt, rt.perfectMs).objects.map((o) => o.pct));
        }
        const w = duoSrc ? perMoverWindows(rt).levelHit : hitWindow(rt);
        // 确定性：同 seed 再建一次，比较 perfectMs 与采样 pct
        const rt2 = buildLevel(def, shapes, lv.id * 1000 + 11);
        let det = Math.abs(rt.perfectMs - rt2.perfectMs) < 1e-12;
        for (let k = 0; k < 4 && det; k++) {
            const t = (k * 211.3) % rt.movers[0].cycleMs;
            if (Math.abs(judge(rt, t).pct - judge(rt2, t).pct) > 1e-12) det = false;
        }
        // 主峰位置 + 双峰（判据与 S9 相同）
        const series = [];
        for (let dt = -400; dt <= 400; dt += 10) {
            series.push([dt, duoSrc ? judgeMover(rt.movers[0], pm0 + dt).pct : judge(rt, rt.perfectMs + dt).pct]);
        }
        let peakIdx = 0;
        for (let i = 1; i < series.length; i++) if (series[i][1] > series[peakIdx][1]) peakIdx = i;
        const peakPct = series[peakIdx][1];
        let second = null;
        for (let i = 1; i + 1 < series.length; i++) {
            const [t, v] = series[i];
            if (v >= series[i - 1][1] && v >= series[i + 1][1] && v >= 40 && v >= peakPct * 0.7 && Math.abs(t - series[peakIdx][0]) > 20) {
                second = { t, v };
                break;
            }
        }
        return { rt, w, det, poseD, minPct, second, peakDt: series[peakIdx][0] };
    };

    const PHASES = [0, 0.25, 0.5, 0.75];
    const sineLevels = levels.filter((lv) => readMotion(lv).sineAmp > 0);
    const rows = [];
    let bad = 0;
    let earlyWider0 = 0;
    let earlyWider5 = 0;
    const width = (w) => (Math.abs(w.earlyMs) + Math.abs(w.lateMs)) / 2;
    for (const lv of sineLevels) {
        const m = readMotion(lv);
        const v = PHASES.map((ph) => checkVariant(lv, ph));
        const ok = (x) => x.det && x.poseD <= 0.05 && x.minPct >= 99.9 && !x.second;
        if (!v.every(ok)) {
            bad++;
            const why = (x, i) =>
                `φ${PHASES[i]}[det=${x.det} pose=${x.poseD.toFixed(3)} pct=${x.minPct.toFixed(2)}${x.second ? ` 双峰@${x.second.t}ms` : ''}]`;
            rep.bad(`S9b：L${lv.id} 相位对照不达标 —— ${v.map(why).join(' ')}`);
        }
        if (Math.abs(v[0].w.earlyMs) > Math.abs(v[0].w.lateMs)) earlyWider0++;
        if (Math.abs(v[2].w.earlyMs) > Math.abs(v[2].w.lateMs)) earlyWider5++;
        const ws = v.map((x) => width(x.w));
        const wMax = Math.max(...ws);
        const wMin = Math.min(...ws);
        rows.push([
            `L${lv.id}`,
            `季${m.season}`,
            `${m.sineAmp}`,
            `${m.sinePeriodMs}`,
            `${v[0].w.earlyMs.toFixed(1)}/${v[0].w.lateMs.toFixed(1)}`,
            `${v[2].w.earlyMs.toFixed(1)}/${v[2].w.lateMs.toFixed(1)}`,
            `${ws[0].toFixed(1)}`,
            `${ws[2].toFixed(1)}`,
            `${ws[1].toFixed(1)}`,
            `${ws[3].toFixed(1)}`,
            wMin > 1e-6 ? `${(wMax / wMin).toFixed(2)}×` : '-',
            v.every(ok) ? 'ok' : '不达标',
        ]);
    }
    if (rows.length > 0) {
        printTable(
            ['关', '季', '正弦', '周期ms', 'φ0 早/晚', 'φ0.5 早/晚', 'φ0 窗宽', 'φ0.5 窗宽', 'φ0.25 窗宽', 'φ0.75 窗宽', '最宽/最窄', '状态'],
            rows,
            ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
        );
        const ratioMean = (idx) => rows.reduce((s, r) => s + parseFloat(r[idx]), 0) / rows.length;
        const d01 = ratioMean(6) > 1e-9 ? ((ratioMean(7) - ratioMean(6)) / ratioMean(6)) * 100 : 0;
        // 以下全部是**实测陈述**：不写「应如何」，也不断言方向（方向随 r=cycle/sinePeriod 变化，已被实测证伪过一次）
        rep.info(
            `实测 φ0 vs φ0.5 平均窗宽 ${ratioMean(6).toFixed(1)} vs ${ratioMean(7).toFixed(1)}ms（差 ${d01 >= 0 ? '+' : ''}${d01.toFixed(1)}%）；` +
                `早>晚的关数：φ0 ${earlyWider0}/${rows.length}、φ0.5 ${earlyWider5}/${rows.length}（实测方向，不作断言）`,
        );
        rep.info(
            `实测 φ0.25 vs φ0.75 平均窗宽 ${ratioMean(8).toFixed(1)} vs ${ratioMean(9).toFixed(1)}ms；平均最宽/最窄 ${ratioMean(10).toFixed(2)}× —— ` +
                `宽度旋钮方向随 r=cycle/sinePeriod 变化，以逐关表为准（单关扫描用 tools/phase_probe.mjs）`,
        );
        rep.info('断言只保留性质：唯一（pct≥99.9、姿态落 C ≤0.05px）/ 无双峰 / 同 seed 一致；窗口宽度差异不作断言');
    }
    // 兼容性守卫：amp=0 时相位必须完全无效（季 1 不受影响）
    {
        const l1 = levels.find((l) => l.id === 1);
        if (l1) {
            const base = buildLevel(l1, shapes, 0);
            const phased = buildLevel(withPhase(l1, 0.5), shapes, 0);
            const same =
                Math.abs(base.perfectMs - phased.perfectMs) < 1e-12 &&
                Math.abs(hitWindow(base).earlyMs - hitWindow(phased).earlyMs) < 1e-12 &&
                Math.abs(hitWindow(base).lateMs - hitWindow(phased).lateMs) < 1e-12;
            if (same) rep.ok('S9b 守卫：sineAmp=0 时 sinePhase 完全无效（季 1 三窗口不受影响）');
            else rep.bad('S9b 守卫失败：amp=0 时任改相位竟改变了窗口 → 兼容分支被破坏');
        }
    }
    if (bad === 0 && rows.length > 0) {
        rep.ok(`S9b 通过：${rows.length} 个正弦关在 φ=0/0.25/0.5/0.75 下都满足「完美时机唯一 + 无双峰 + 同 seed 一致」`);
    } else if (rows.length === 0) {
        rep.warn('S9b：没有 sineAmp>0 的关卡，相位对照跳过');
    } else {
        rep.bad(`S9b 失败：${bad}/${rows.length} 关相位对照不达标`);
    }
}

// ---------- S13–S18) v0.6 双物体错拍 ----------
console.log(C.cyan('\n[S13–S18] 双物体错拍（phase_2 / cycle_2_ms / judgeNearest）'));
{
    // v0.5 基线（若还没捕获就跳过窗口比对，只做分支级验证）
    let BASE = null;
    try {
        BASE = (await import('./_win_baseline_v05.mjs')).WIN_BASELINE_V05;
    } catch {
        BASE = null;
    }
    const baseOf = (id) => (BASE && BASE.levels ? BASE.levels.find((l) => l.id === id) || null : null);

    // ---------- S13 同步关兼容（逐位） ----------
    const syncLevels = levels.filter((lv) => !isStaggered(lv));
    let s13bad = 0;
    let s13baseline = 0;
    for (const lv of syncLevels) {
        const rt0 = buildLevel(lv, shapes, 0);
        for (const m of rt0.movers) {
            const tm = moverTiming(m);
            if (tm.offsetMs !== 0) {
                s13bad++;
                rep.bad(`S13：L${lv.id} 是同步关却有 offsetMs=${tm.offsetMs}`);
                break;
            }
            // 600 采样点：零偏移时 localT 必须与 v0.5 的 wrapT 逐位相同（===，不是近似）
            let bitOk = true;
            for (let k = 0; k < 600; k++) {
                const tt = (k * 7.31) % m.cycleMs;
                if (localT(m, tt) !== wrapT(tt, m.cycleMs)) {
                    bitOk = false;
                    break;
                }
            }
            if (!bitOk) {
                s13bad++;
                rep.bad(`S13：L${lv.id} localT 与 wrapT 逐位不一致（零偏移兼容分支被破坏）`);
                break;
            }
        }
        const base = baseOf(lv.id);
        if (base && (base.phase2 ?? 0) === 0 && (base.cycle2Ms ?? 0) === 0) {
            const hit = [round1(hitWindow(rt0).earlyMs), round1(hitWindow(rt0).lateMs)];
            const god = [round1(godWindow(rt0).earlyMs), round1(godWindow(rt0).lateMs)];
            const star = [round1(starWindow(rt0).earlyMs), round1(starWindow(rt0).lateMs)];
            const eq = (a, b) => Math.abs(a - b) < 1e-9;
            const ok =
                eq(hit[0], base.hit[0]) && eq(hit[1], base.hit[1]) &&
                eq(god[0], base.god[0]) && eq(god[1], base.god[1]) &&
                eq(star[0], base.star[0]) && eq(star[1], base.star[1]);
            s13baseline++;
            if (!ok) {
                s13bad++;
                rep.bad(
                    `S13：L${lv.id} 同步关窗口与 v0.5 基线不一致 —— 实测 通关[${hit}] 神级[${god}] 三星[${star}] vs 基线 通关[${base.hit}] 神级[${base.god}] 三星[${base.star}]`,
                );
            }
        }
    }
    if (s13bad === 0) {
        rep.ok(
            `S13 通过：${syncLevels.length} 个同步关的局部时间轴与 v0.5 逐位相同（${syncLevels.length * 600}+ 采样点）` +
                (s13baseline > 0 ? `；${s13baseline} 关三窗口与 v0.5 基线逐位相同` : '；未找到 v0.5 基线（先跑 tools/win_snapshot.mjs）'),
        );
    } else {
        rep.bad(`S13 失败：${s13bad} 处不兼容 —— 加字段不能改变同步关的行为`);
    }

    // ---------- 挑一个错拍样本：优先用数据里已有的，否则在双物体同步关上合成 phase2=0.38 ----------
    let stag = levels.find((lv) => isStaggered(lv)) || null;
    let stagSynthetic = false;
    if (!stag) {
        const dualSync = levels.find((lv) => !isStaggered(lv) && lv.variant === 'dual');
        if (dualSync) {
            stag = { ...dualSync, phase2: 0.38, cycle2Ms: 0 };
            stagSynthetic = true;
        }
    }
    if (!stag) {
        rep.warn('S14/S16/S17/S18：没有可用的双物体关（既没有错拍关，也没有双物体同步关）');
    } else {
        const duo = readDuo(stag);
        const rt = buildLevel(stag, shapes, 0);
        const tag = stagSynthetic ? `合成样本（L${stag.id} + phase2=0.38）` : `L${stag.id}（phase2=${duo.phase2}, cycle2Ms=${duo.cycle2Ms}）`;
        const pms = rt.movers.map((m) => moverTiming(m).perfectMs);
        const cycleMs = rt.movers[0].cycleMs;

        // ---------- S14 错拍生效 ----------
        if (rt.movers.length < 2) {
            rep.warn(`S14：${tag} 只有一个 mover，跳过`);
        } else {
            const dPerfect = Math.abs(pms[1] - pms[0]);
            if (dPerfect >= 0.3 * cycleMs) {
                rep.ok(`S14 通过：${tag} 两 mover perfectMs 差 ${dPerfect.toFixed(1)}ms ≥ 0.3×cycle(${(0.3 * cycleMs).toFixed(1)}ms)`);
            } else {
                rep.bad(`S14 失败：${tag} 两 mover perfectMs 只差 ${dPerfect.toFixed(1)}ms（< 0.3×cycle=${(0.3 * cycleMs).toFixed(1)}ms），不构成错拍`);
            }
        }

        // ---------- S15 判定不退化（同步关：judgeNearest === judge 的 per-object 值） ----------
        {
            let s15bad = 0;
            let samples = 0;
            for (const lv of syncLevels) {
                const r0 = buildLevel(lv, shapes, 0);
                for (const off of [-120, -60, 0, 60, 120]) {
                    const t = r0.perfectMs + off;
                    const r = judge(r0, t);
                    const near = judgeNearest(r0, t, []);
                    const maxObj = Math.max(...r.objects.map((o) => o.pct));
                    const minObj = Math.min(...r.objects.map((o) => o.pct));
                    samples++;
                    if (!near || Math.abs(near.pct - maxObj) > 1e-9) {
                        s15bad++;
                        rep.bad(`S15：L${lv.id} @${off}ms judgeNearest.pct=${near ? near.pct.toFixed(3) : 'null'} ≠ max(objects)=${maxObj.toFixed(3)}`);
                    } else if (r0.movers.length === 1 && Math.abs(near.pct - minObj) > 1e-9) {
                        s15bad++;
                        rep.bad(`S15：L${lv.id} 单物体关 judgeNearest.pct ≠ judge().pct`);
                    } else if (off === 0 && r0.movers.length > 1 && Math.abs(maxObj - minObj) > 1e-9) {
                        s15bad++;
                        rep.bad(`S15：L${lv.id} 同步双物体关在 perfectMs 处 max≠min（${maxObj.toFixed(3)} vs ${minObj.toFixed(3)}）`);
                    }
                }
            }
            if (s15bad === 0) rep.ok(`S15 通过：${syncLevels.length} 个同步关 × 5 个采样点，judgeNearest 与 judge 的 per-object pct 完全一致（${samples} 次）`);
            else rep.bad(`S15 失败：${s15bad}/${samples} 次不一致`);
        }

        // ---------- S16 幂等：skipIdx 排除已定格，重复不计分 ----------
        {
            let ok = true;
            const single = levels.find((lv) => lv.variant === 'single');
            if (single) {
                const rt1 = buildLevel(single, shapes, 0);
                const r1 = judgeNearest(rt1, rt1.perfectMs, []);
                if (!r1) {
                    ok = false;
                    rep.bad('S16：单物体关第一次 judgeNearest 就返回 null');
                } else if (judgeNearest(rt1, rt1.perfectMs, [r1.moverIndex]) !== null) {
                    ok = false;
                    rep.bad('S16：同一 mover 再判一次应返回 null（已定格）');
                }
            }
            if (rt.movers.length >= 2) {
                const r1 = judgeNearest(rt, pms[0], []);
                const r2 = judgeNearest(rt, pms[1], r1 ? [r1.moverIndex] : []);
                const r3 = judgeNearest(rt, pms[1], r1 && r2 ? [r1.moverIndex, r2.moverIndex] : [0, 1]);
                if (!r1 || !r2 || r2.moverIndex === r1.moverIndex) {
                    ok = false;
                    rep.bad(`S16：双物体关第二次判定没有切到另一个 mover（r1=${r1 && r1.moverIndex}, r2=${r2 && r2.moverIndex}）`);
                }
                if (r3 !== null) {
                    ok = false;
                    rep.bad('S16：两个都定格后再判应返回 null');
                }
                if (r1 && r2) {
                    const dup = duoVerdict(rt, [r1, r2, r1], 0);
                    const once = duoVerdict(rt, [r1, r2], 0);
                    if (dup.judgedCount !== once.judgedCount || dup.score !== once.score) {
                        ok = false;
                        rep.bad(`S16：duoVerdict 对重复结果计次/计分不一致（dup=${dup.judgedCount}/${dup.score} once=${once.judgedCount}/${once.score}）`);
                    }
                }
            }
            if (ok) rep.ok('S16 通过：skipIdx 排除已定格 mover（第二次返回 null）；duoVerdict 对重复结果幂等（分数不叠加）');
        }

        // ---------- S17 过关条件：只定格 1 个 → 未过关；两个都合格 → 过关 ----------
        if (rt.movers.length >= 2) {
            const rA = judgeNearest(rt, pms[0], []);
            const rB = rA ? judgeNearest(rt, pms[1], [rA.moverIndex]) : null;
            if (rA && rB) {
                const partial = duoVerdict(rt, [rA]);
                const full = duoVerdict(rt, [rA, rB]);
                const bad = duoVerdict(rt, [
                    { moverIndex: 0, pct: 5 },
                    { moverIndex: 1, pct: 5 },
                ]);
                if (!partial.pass && full.pass && !bad.pass) {
                    rep.ok(`S17 通过：只定格 1 个 → 未过关；两个都合格 → 过关（rating=${full.rating}, score=${full.score}）；任一不合格 → 失败`);
                } else {
                    rep.bad(`S17 失败：partial.pass=${partial.pass} full.pass=${full.pass} bad.pass=${bad.pass}（期望 false/true/false）`);
                }
            }
        }

        // ---------- S18 每个 mover 在各自 perfectMs 上完美（规格 §5 v0.6 修订版） ----------
        // 旧版「同姿态换 phase 不改 pct」是错的：phase 就是时间轴偏移，改 phase 后同一时刻的姿态本来就变。
        {
            const w = perMoverWindows(rt);
            let bad = 0;
            for (let i = 0; i < rt.movers.length; i++) {
                const mv = rt.movers[i];
                const pm = moverTiming(mv).perfectMs;
                const rm = judgeMover(mv, pm);
                const pose = poseAt(mv, pm);
                const laneD = Math.hypot(pose.x - mv.targetCenter.x, pose.y - mv.targetCenter.y);
                const win = w.hit[i];
                const width = (Math.abs(win.earlyMs) + Math.abs(win.lateMs)) / 2;
                if (rm.pct < 99.9 || laneD > 0.05 || !(width > 0)) {
                    bad++;
                    rep.bad(
                        `S18：${tag} mover${i} @perfectMs=${pm.toFixed(1)} pct=${rm.pct.toFixed(2)} 落车道中心=${laneD.toFixed(3)}px 窗口宽=${width.toFixed(1)}ms（要求 pct≥99.9 / ≤0.05px / >0）`,
                    );
                }
            }
            if (bad === 0) {
                rep.ok(
                    `S18 通过：${tag} 两个 mover 各自在自身 perfectMs 上「pct≥99.9 + 落车道中心 ≤0.05px + 窗口 > 0」`,
                    w.hit.map((x, i) => `m${i} 窗宽=${((Math.abs(x.earlyMs) + Math.abs(x.lateMs)) / 2).toFixed(1)}ms`).join(' / '),
                );
            }
        }
    }
}

// ---------- 4) 路径 uStar 落在目标中心 ----------
console.log(C.cyan('\n[4] 路径参数化：uStar 处必须精确等于目标中心 C'));
{
    const C0 = { x: TARGET_SINGLE.cx, y: TARGET_SINGLE.cy };
    const rows = [];
    for (const pid of ['h_line', 'h_line_rl', 'diag_dl', 'diag_ur', 'arc_up', 'arc_down', 'bounce_floor']) {
        const pts = buildPathPts(pid, C0);
        const cum = cumulativeLengths(pts);
        const total = pathLength(pts);
        const u = uStarOf(pts, cum, total, C0);
        const p = pointAtU(pts, cum, total, u);
        const d = Math.hypot(p.x - C0.x, p.y - C0.y);
        rows.push([pid, `${C0.x},${C0.y}`, u.toFixed(6), `${p.x.toFixed(3)},${p.y.toFixed(3)}`, d.toExponential(2)]);
        // 阈值 0.05px：720 屏宽下 = 0.00007 屏宽，肉眼与判定都不可能感知
        // （残差来源：弧长插值浮点误差 + 形状形心非严格原点带来的旋转残差，不是逻辑错）
        if (d > 0.05) rep.bad(`${pid} 的 uStar 处偏离 C ${d.toFixed(6)}px（> 0.05px）`);
    }
    printTable(['路径', '目标 C', 'uStar', 'u* 处的点', '误差px'], rows, ['l', 'r', 'r', 'r', 'r']);
    if (rep.stats.fail === 0) rep.ok('7 条路径的 uStar 全部落在 C 上（误差 ≤ 0.05px）');
}

// ---------- 5) 口径自洽 ----------
console.log(C.cyan('\n[5] 口径自洽（面积口径，不是中心点）'));
{
    const A = rotateAbout(SQUARE, 0, 0, 0);
    const same = overlapPercent(A, SQUARE);
    if (Math.abs(same - 100) < 1e-6) rep.ok('完全重合 → 100%');
    else rep.bad(`完全重合应 100%，实测 ${same}`);
    // 中心点完全对齐但转了 45°：中心点距离 0，但重合率只有 82.84% ← 这就是「不用中心点」的证据
    const r45 = overlapPercent(rotateAbout(SQUARE, 0, 0, 45), SQUARE);
    if (Math.abs(r45 - 82.84) < 0.1) rep.ok('中心点重合但转 45° → 82.84%（证明判定不是中心点）', `实测 ${r45.toFixed(2)}%`);
    else rep.bad(`转 45° 应 82.84%，实测 ${r45.toFixed(2)}%`);
    // 平移不改面积
    const Pshift = SQUARE.map((p) => ({ x: p.x + 0.13, y: p.y - 0.07 }));
    const Qshift = rotateAbout(SQUARE, 0, 0, 15).map((p) => ({ x: p.x + 0.13, y: p.y - 0.07 }));
    const a1 = overlapAreaExact(SQUARE, rotateAbout(SQUARE, 0, 0, 15));
    const a2 = overlapAreaExact(Pshift, Qshift);
    if (Math.abs(a1 - a2) < 1e-9) rep.ok('平移不变性：整体平移后面积不变');
    else rep.bad(`平移后面积变了：${a1} vs ${a2}`);
    // 对称
    const a3 = overlapAreaExact(rotateAbout(SQUARE, 0, 0, 15), SQUARE);
    if (Math.abs(a1 - a3) < 1e-9) rep.ok('对称性：overlap(P,Q) = overlap(Q,P)');
    else rep.bad(`不对称：${a1} vs ${a3}`);
    // 不相交
    const far = SQUARE.map((p) => ({ x: p.x + 5, y: p.y }));
    if (overlapAreaExact(SQUARE, far) === 0) rep.ok('不相交 → 面积 0');
    else rep.bad('不相交却算出了面积');
    // 0 面积退化输入不抛异常
    try {
        overlapAreaExact([], SQUARE);
        overlapAreaExact([{ x: 0, y: 0 }], SQUARE);
        rep.ok('退化输入（空/单点）不抛异常，返回 0');
    } catch (e) {
        rep.bad(`退化输入抛异常：${e.message}`);
    }
}

// ---------- 5b) 热力图条带（曾经整片返回空数组的 P1，回归锁死） ----------
console.log(C.cyan('\n[5b] 热力图条带 overlapStrips / missStrips / heatBands'));
{
    const lv = levels[0];
    const rt = buildLevel(lv, shapes, 0);
    const perfect = judge(rt, rt.perfectMs);
    const obj = perfect.objects[0].objectPts;
    const tgt = perfect.objects[0].targetPts;
    const areaOf = (rects) => rects.reduce((s, r) => s + r.w * r.h, 0);

    const strips = overlapStrips(obj, tgt, 6);
    if (strips.length > 0) rep.ok('完美重合：overlapStrips 非空（回归：曾因 minY/maxY 写反恒返回 []）', `${strips.length} 条`);
    else rep.bad('完美重合时 overlapStrips 仍返回空数组');

    const objArea = polyArea(obj);
    const stripArea = areaOf(strips);
    const relO = Math.abs(stripArea - objArea) / objArea;
    if (relO < 0.05) rep.ok('overlapStrips 面积和 ≈ 物体面积', `条带 ${stripArea.toFixed(1)} vs 物体 ${objArea.toFixed(1)}（差 ${(relO * 100).toFixed(2)}%）`);
    else rep.bad(`overlapStrips 面积和偏差 ${(relO * 100).toFixed(2)}% > 5%`);

    const misses = missStrips(obj, tgt, 6);
    const missArea = areaOf(misses);
    if (missArea / objArea < 0.02) rep.ok('完美重合：missStrips（红区）≈ 0', `${missArea.toFixed(1)}px²（${((missArea / objArea) * 100).toFixed(2)}%）`);
    else rep.bad(`完美重合却还有红区 ${missArea.toFixed(1)}px²`);

    // 偏离 200ms：绿 + 红 ≈ 并集面积（说明两块不重不漏）
    const off = judge(rt, rt.perfectMs + 200);
    const o2 = off.objects[0].objectPts;
    const t2 = off.objects[0].targetPts;
    const green = areaOf(overlapStrips(o2, t2, 6));
    const red = areaOf(missStrips(o2, t2, 6));
    const unionApprox = polyArea(o2) + polyArea(t2) - off.objects[0].interArea;
    const relU = Math.abs(green + red - unionApprox) / unionApprox;
    if (relU < 0.05) rep.ok('偏 200ms：绿区+红区 ≈ 并集面积（不重不漏）', `绿 ${green.toFixed(0)} + 红 ${red.toFixed(0)} vs 并集 ${unionApprox.toFixed(0)}（差 ${(relU * 100).toFixed(2)}%）`);
    else rep.bad(`绿+红 与并集面积差 ${(relU * 100).toFixed(2)}% > 5%`);

    const bands = heatBands(o2, t2, 24);
    const bandsOk = bands.length === 24 && bands.every((b) => b.y1 > b.y0 && b.hitX1 >= b.hitX0 - 1e-9 && b.tgtX1 >= b.tgtX0 - 1e-9);
    if (bandsOk) rep.ok('heatBands(…,24) 返回 24 条且区间合法', `有重合的条带 ${bands.filter((b) => b.hitX1 > b.hitX0).length} 条`);
    else rep.bad(`heatBands 异常：${bands.length} 条`);

    // 完全错开时必须返回空（而不是全屏乱画）
    const far = o2.map((p) => ({ x: p.x + 5000, y: p.y }));
    if (overlapStrips(far, t2, 6).length === 0) rep.ok('完全错开：overlapStrips 返回空');
    else rep.bad('完全错开却返回了条带');
}

// ---------- 6) 性能（红线见 04_项目管理/决策记录.md D-014） ----------
if (!NO_PERF) {
    console.log(C.cyan('\n[6] 性能：judge ≤0.5ms（48 顶点×2 物体）、每帧判定相关开销 ≤0.1ms'));
    const N = 1000;

    /** 计时：固定实例（不要每次重建，重建会把 buildLevel 的开销算进来） */
    const bench = (name, rt, vtx) => {
        for (let i = 0; i < 50; i++) judge(rt, (i * 7.3) % rt.movers[0].cycleMs); // 预热 JIT
        const t0 = process.hrtime.bigint();
        let sink = 0;
        for (let i = 0; i < N; i++) sink += judge(rt, (i * 13.7) % rt.movers[0].cycleMs).pct;
        const t1 = process.hrtime.bigint();
        const totalMs = Number(t1 - t0) / 1e6;
        return { name, rt, vtx, perCall: totalMs / N, totalMs, sink };
    };

    /** 计时：每帧开销 = 每个 mover 的 poseAt + objectPtsAt（不含 judge） */
    const benchFrame = (rt) => {
        const cyc = rt.movers[0].cycleMs;
        let sink = 0;
        for (let i = 0; i < 200; i++) for (const m of rt.movers) sink += objectPtsAt(m, (i * 3.1) % cyc).length;
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < N; i++) {
            const t = (i * 2.7) % cyc;
            for (const m of rt.movers) {
                const p = poseAt(m, t);
                const pts = objectPtsAt(m, t);
                sink += p.x + pts.length;
            }
        }
        const t1 = process.hrtime.bigint();
        const totalMs = Number(t1 - t0) / 1e6;
        return { perFrame: totalMs / N, totalMs, sink };
    };

    // a) 真实关卡（取最后一个**同步关**，与历史性能数字同口径；错拍关的 judge 语义不同，不拿来比）
    const syncForPerf = levels.filter((lv) => !isStaggered(lv));
    const def = syncForPerf.length > 0 ? syncForPerf[syncForPerf.length - 1] : levels[levels.length - 1];
    const rtReal = buildLevel(def, shapes, 0); // seed 固定 0：可复现
    // b) 48 顶点 × 2 物体 dual 压力用例（上限规格：12–48 顶点）
    const benchPts = [];
    const VN = 80;   // D-119：顶点上限 48→80
    for (let i = 0; i < VN; i++) {
        const t = 0.37 + (i / VN) * Math.PI * 2;
        const r = 1 + 0.16 * Math.cos(3 * t + 0.2) + 0.08 * Math.cos(5 * t + 1.1);
        benchPts.push({ x: 0.5 * Math.cos(t) * r, y: (0.5 / 3) * Math.sin(t) * r });
    }
    const benchShape = { id: 'bench48', name: '48 顶点压力用例', size: 300, fill: '#888888', stroke: '#000000', pts: benchPts };
    const benchDef = {
        ...def,
        id: 999,
        name: 'bench48-dual',
        shapeId: 'bench48',
        outlineId: 'bench48',
        shapeId2: 'bench48',
        variant: 'dual',
        path: 'h_line',
        turns: 2,
        jitter: 0,
        passRate: 0.6,
        star3Rate: 0.95,
    };
    const rtBench = buildLevel(benchDef, { ...shapes, bench48: benchShape }, 0);

    const r1 = bench('真实关卡', rtReal, rtReal.movers[0].shape.pts.length);
    const r2 = bench('48 顶点压力', rtBench, rtBench.movers[0].shape.pts.length);
    const f1 = benchFrame(rtReal);
    const f2 = benchFrame(rtBench);
    const rows = [
        [r1.name, `${r1.vtx}×${r1.rt.movers.length}`, `${r1.perCall.toFixed(4)} ms`, `${r1.totalMs.toFixed(1)} ms`, '≤ 0.5 ms'],
        [r2.name, `${r2.vtx}×${r2.rt.movers.length}`, `${r2.perCall.toFixed(4)} ms`, `${r2.totalMs.toFixed(1)} ms`, '≤ 0.5 ms'],
        ['每帧开销（真实关）', `${r1.vtx}×${r1.rt.movers.length}`, `${f1.perFrame.toFixed(4)} ms`, `${f1.totalMs.toFixed(1)} ms`, '≤ 0.1 ms'],
        ['每帧开销（48 顶点）', `${r2.vtx}×${r2.rt.movers.length}`, `${f2.perFrame.toFixed(4)} ms`, `${f2.totalMs.toFixed(1)} ms`, '≤ 0.1 ms'],
        ['（校验和，防优化跳过）', '', r1.sink.toFixed(0), r2.sink.toFixed(0), ''],
    ];
    printTable(['用例', '顶点×物体', `单次(×${N})`, `总耗时`, '红线'], rows, ['l', 'r', 'r', 'r', 'r']);

    if (r1.perCall <= 0.5) rep.ok(`${r1.vtx} 顶点（${r1.rt.movers.length} 物体）judge 单次 ${r1.perCall.toFixed(4)}ms ≤ 0.5ms`);
    else rep.bad(`${r1.vtx} 顶点 judge 单次 ${r1.perCall.toFixed(4)}ms 超 0.5ms 红线`);
    if (r2.perCall <= 0.5) rep.ok(`${r2.vtx} 顶点×2 物体 judge 单次 ${r2.perCall.toFixed(4)}ms ≤ 0.5ms（上限规格）`);
    else rep.bad(`${r2.vtx} 顶点×2 物体 judge 单次 ${r2.perCall.toFixed(4)}ms 超 0.5ms 红线（报主策划裁决，不许自己放宽）`);
    if (f2.perFrame <= 0.1) rep.ok(`每帧判定相关开销（48 顶点×2）${f2.perFrame.toFixed(4)}ms ≤ 0.1ms`);
    else rep.bad(`每帧开销 ${f2.perFrame.toFixed(4)}ms 超 0.1ms（poseAt+objectPtsAt 每帧都跑，这条才是真红线）`);
}

process.exit(rep.finish());
