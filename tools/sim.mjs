/**
 * tools/sim.mjs —— 玩家模型批量模拟（判定自测工具 / 数值回归门禁）
 *
 *   node tools/sim.mjs                  # 5 档 σ × 15 关 × 10000 次（默认，约 1–2 分钟）
 *   node tools/sim.mjs --n=2000         # 快速冒烟
 *   node tools/sim.mjs --sigmas=90,60   # 只跑两档
 *   node tools/sim.mjs --levels=1,15    # 只跑两关
 *
 * 玩家模型（与策划约定，改之前先问）：
 *   err = 0.9·N(0,σ) + 0.1·N(0,3σ)，clamp ±600ms；pressMs = perfectMs + err
 *   σ 五档：130 新手 / 90 普通 / 60 熟练 / 35 高手 / 20 顶级
 *
 * 每关预建 K 个不同 seed 的运行时（模拟「每次重试速度微扰不同」），按 trial 轮换。
 * 命中窗口用 seed=0 的实例算（与 export_levels.mjs 共用 hitWindow，一份算法）。
 */

import path from 'node:path';
import { ROOT, readJson, exists, rel, makeReporter, printTable, C } from './_io.mjs';
import { placeholderShapes } from './_placeholder_shapes.mjs';
import { core } from './_core.mjs';

const {
    buildLevel,
    judge,
    hitWindow,
    godWindow,
    isStaggered,
    judgeNearest,
    moverTiming,
    duoVerdict,
    perMoverWindows,
    inspectShapes,
    readMotion,
    mulberry32,
} = core;

const argv = process.argv.slice(2);
const argNum = (name, dflt) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.split('=')[1]) : dflt;
};
const argList = (name, dflt) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    if (!hit) return dflt;
    return hit
        .split('=')[1]
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((x) => Number.isFinite(x));
};
const N = Math.max(10, argNum('n', 10000));
const SIGMAS = argList('sigmas', [130, 90, 60, 35, 20]);
const ONLY_LEVELS = argList('levels', []);
const K_RUNTIMES = Math.max(1, argNum('runtimes', 16));
const SEED0 = argNum('seed', 20261018);
const SIGMA_NAME = { 130: '新手', 90: '普通', 60: '熟练', 35: '高手', 20: '顶级' };

const LEVELS_PATH = path.join(ROOT, 'assets/resources/config/levels.json');
const SHAPES_PATH = path.join(ROOT, 'assets/config/shapes.json');

const rep = makeReporter('sim：玩家模型批量模拟');

if (!exists(LEVELS_PATH)) {
    rep.bad(`找不到 ${rel(LEVELS_PATH)}，先跑 node tools/export_levels.mjs`);
    process.exit(rep.finish());
}
const rawLevels = readJson(LEVELS_PATH);
let levels = Array.isArray(rawLevels) ? rawLevels : rawLevels.levels || [];
if (ONLY_LEVELS.length > 0) levels = levels.filter((l) => ONLY_LEVELS.includes(l.id));

let shapes;
let shapeSource;
if (exists(SHAPES_PATH)) {
    const insp = inspectShapes(readJson(SHAPES_PATH));
    if (insp.errors.length === 0) {
        shapes = insp.shapes;
        shapeSource = 'assets/config/shapes.json（真数据）';
    } else {
        rep.warn(`shapes.json 有 ${insp.errors.length} 项错误 → 用占位形状（数值不可用于定档）`);
    }
} else {
    rep.warn('shapes.json 不存在 → 用占位形状（数值不可用于定档，仅供链路验证）');
}
if (!shapes) {
    shapes = placeholderShapes();
    shapeSource = 'tools/_placeholder_shapes.mjs（占位）';
}
rep.info(`关卡 ${levels.length} 关 / 形状来源 ${shapeSource} / 每关 ${K_RUNTIMES} 个不同 seed 的运行时 / 每条样本 ${N} 次`);

// ---- 预建运行时 + 命中窗口 ----
const rts = new Map();
const wins = new Map();
const gods = new Map();
for (const lv of levels) {
    const list = [];
    for (let k = 0; k < K_RUNTIMES; k++) list.push(buildLevel(lv, shapes, SEED0 + k * 7919));
    rts.set(lv.id, list);
    if (isStaggered(lv)) {
        // 错拍关：关卡窗口 = 两个 mover 中较窄者；优先用导出写入的 JSON 值（同 seed=0 口径）
        const pm = perMoverWindows(list[0]);
        wins.set(
            lv.id,
            lv.hitWindow ? { earlyMs: lv.hitWindow.earlyMs, lateMs: lv.hitWindow.lateMs, earlyWide: false, lateWide: false } : pm.levelHit,
        );
        gods.set(
            lv.id,
            lv.godWindow ? { earlyMs: lv.godWindow.earlyMs, lateMs: lv.godWindow.lateMs, earlyWide: false, lateWide: false } : pm.levelGod,
        );
    } else {
        wins.set(lv.id, hitWindow(list[0]));
        gods.set(lv.id, godWindow(list[0]));
    }
}
rep.ok('运行时预建完成（命中窗口 / 神级窗口用 seed 固定的第 0 个实例；错拍关取较窄 mover）');
const staggeredCount = levels.filter((lv) => isStaggered(lv)).length;
if (staggeredCount > 0) rep.info(`错拍关 ${staggeredCount} 个：按「一关按两次」建模（两次独立误差，任一不合格即失败）`);

// ---- 玩家模型 ----
function gauss(rnd) {
    let u = 0;
    while (u === 0) u = rnd();
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const sampleErr = (rnd, sigma) => clamp(0.9 * gauss(rnd) * sigma + 0.1 * gauss(rnd) * 3 * sigma, -600, 600);

const results = new Map(); // sigma -> levelId -> stats
const t0 = Date.now();
for (const sigma of SIGMAS) {
    const perLevel = new Map();
    for (const lv of levels) {
        const list = rts.get(lv.id);
        const rnd = mulberry32((SEED0 ^ (sigma * 7919) ^ (lv.id * 104729)) >>> 0);
        const stag = isStaggered(lv);
        let pass = 0;
        let star3 = 0;
        let god = 0;
        let fail = 0;
        let near = 0;
        let sumPct = 0;
        for (let i = 0; i < N; i++) {
            const rt = list[i % list.length];
            if (!stag) {
                const err = sampleErr(rnd, sigma);
                const r = judge(rt, rt.perfectMs + err);
                if (r.pass) pass++;
                if (r.star3) star3++;
                if (r.pct >= 95) god++;
                if (r.pct < 40) fail++;
                if (r.pct >= 40 && r.pct < 60) near++;
                sumPct += r.pct;
            } else {
                // 错拍：两次独立按下，各自对准该 mover 的完美时刻；任一不合格 → 本关失败
                const pms = rt.movers.map((m) => moverTiming(m).perfectMs);
                const r1 = judgeNearest(rt, pms[0] + sampleErr(rnd, sigma), []);
                const r2 = r1 ? judgeNearest(rt, pms[1] + sampleErr(rnd, sigma), [r1.moverIndex]) : null;
                const pcts = [r1 ? r1.pct : 0, r2 ? r2.pct : 0];
                const verdict = duoVerdict(
                    rt,
                    [
                        { moverIndex: 0, pct: pcts[0] },
                        { moverIndex: 1, pct: pcts[1] },
                    ],
                    0,
                );
                if (verdict.pass) pass++;
                if (verdict.worstPct >= lv.star3Rate * 100) star3++;
                if (verdict.worstPct >= 95) god++;
                if (verdict.worstPct < 40) fail++;
                if (verdict.worstPct >= 40 && verdict.worstPct < 60) near++;
                sumPct += (pcts[0] + pcts[1]) / 2;
            }
        }
        perLevel.set(lv.id, {
            n: N,
            pass: pass / N,
            star3: star3 / N,
            god: god / N,
            fail: fail / N,
            near: near / N,
            avgPct: sumPct / N,
            staggered: stag,
        });
    }
    results.set(sigma, perLevel);
    console.log(C.dim(`  σ=${sigma}（${SIGMA_NAME[sigma] || '自定义'}）跑完 · 累计 ${((Date.now() - t0) / 1000).toFixed(1)}s`));
}

const pct1 = (x) => `${(x * 100).toFixed(1)}%`;
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// ---- 表 A：σ 汇总（15 关等权平均） ----
console.log(C.cyan('\n[A] 各技能档汇总（全部关卡等权平均）'));
{
    const rows = [];
    for (const sigma of SIGMAS) {
        const pl = results.get(sigma);
        const vals = [...pl.values()];
        const avgWin = mean(
            levels.map((lv) => {
                const w = wins.get(lv.id);
                return (Math.abs(w.earlyMs) + Math.abs(w.lateMs)) / 2;
            }),
        );
        const avgGod = mean(
            levels.map((lv) => {
                const g = gods.get(lv.id);
                return (Math.abs(g.earlyMs) + Math.abs(g.lateMs)) / 2;
            }),
        );
        rows.push([
            `${sigma}`,
            SIGMA_NAME[sigma] || '-',
            pct1(mean(vals.map((v) => v.pass))),
            pct1(mean(vals.map((v) => v.star3))),
            pct1(mean(vals.map((v) => v.god))),
            pct1(mean(vals.map((v) => v.fail))),
            pct1(mean(vals.map((v) => v.near))),
            `${mean(vals.map((v) => v.avgPct)).toFixed(2)}%`,
            `${avgWin.toFixed(1)}ms`,
            `${avgGod.toFixed(1)}ms`,
        ]);
    }
    printTable(['σ', '档位', '通关率', '三星率', '神级率', '失败率', '差一点', '平均重合率', '平均通关窗', '平均神级窗'], rows, ['r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
}

// ---- 表 A2：按季汇总（看季内阶梯是否掉档 / 季间是否断层） ----
console.log(C.cyan('\n[A2] 按季汇总（每季内的关卡等权平均）'));
{
    const rows = [];
    for (const sigma of SIGMAS) {
        const pl = results.get(sigma);
        for (const season of [1, 2, 3, 4]) {
            const lvs = levels.filter((lv) => readMotion(lv).season === season);
            if (lvs.length === 0) continue;
            const vals = lvs.map((lv) => pl.get(lv.id));
            const win = mean(lvs.map((lv) => (Math.abs(wins.get(lv.id).earlyMs) + Math.abs(wins.get(lv.id).lateMs)) / 2));
            rows.push([
                `${sigma}`,
                `季${season}`,
                `${lvs.length}`,
                pct1(mean(vals.map((v) => v.pass))),
                pct1(mean(vals.map((v) => v.star3))),
                pct1(mean(vals.map((v) => v.god))),
                pct1(mean(vals.map((v) => v.fail))),
                `${mean(vals.map((v) => v.avgPct)).toFixed(1)}%`,
                `${win.toFixed(1)}ms`,
            ]);
        }
    }
    printTable(['σ', '季', '关数', '通关率', '三星率', '神级率', '失败率', '平均重合率', '平均通关窗'], rows, ['r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
}

// ---- 表 B：每档 × 每关（含命中窗口） ----
for (const sigma of SIGMAS) {
    console.log(C.cyan(`\n[B] σ=${sigma}（${SIGMA_NAME[sigma] || '自定义'}）× 每关`));
    const pl = results.get(sigma);
    const rows = [];
    for (const lv of levels) {
        const s = pl.get(lv.id);
        const w = wins.get(lv.id);
        const g = gods.get(lv.id);
        rows.push([
            `L${lv.id}`,
            `季${readMotion(lv).season}`,
            lv.name,
            `${lv.cycleMs}`,
            `${lv.turns}`,
            `${lv.linSpeed[0]}–${lv.linSpeed[1]}`,
            `${w.earlyMs.toFixed(0)}`,
            `${w.lateMs.toFixed(0)}`,
            `${g.earlyMs.toFixed(0)}`,
            `${g.lateMs.toFixed(0)}`,
            pct1(s.pass),
            pct1(s.star3),
            pct1(s.god),
            pct1(s.fail),
            pct1(s.near),
            `${s.avgPct.toFixed(1)}%`,
        ]);
    }
    printTable(
        ['关', '季', '名字', '周期', '圈', '线速', '通关早', '通关晚', '神级早', '神级晚', '通关', '三星', '神级', '失败', '差一点', '平均'],
        rows,
        ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    );
}

// ---- 表 C：神级率矩阵（策划看高光稀有度，目标 2–5%） ----
console.log(C.cyan('\n[C] 神级率矩阵（行=σ，列=关；目标 2–5%）'));
{
    const rows = [];
    for (const sigma of SIGMAS) {
        const pl = results.get(sigma);
        const row = [`σ=${sigma}`];
        for (const lv of levels) row.push(pct1(pl.get(lv.id).god));
        rows.push(row);
    }
    printTable(['档位', ...levels.map((l) => `L${l.id}`)], rows, ['l', ...levels.map(() => 'r')]);
}

// ---- 目标对照（只给结论，不 fail） ----
console.log(C.cyan('\n[D] 与策划目标对照'));
{
    const find = (id) => levels.find((l) => l.id === id);
    const check = (label, actual, lo, hi) => {
        const ok = actual >= lo && actual <= hi;
        const line = `${label}：实测 ${pct1(actual)}，目标 ${pct1(lo)}–${pct1(hi)}`;
        if (ok) rep.ok(line);
        else rep.warn(`${line}（${actual < lo ? '偏低' : '偏高'}，需调 cycle_ms / turns / pass_rate）`);
    };
    const novice = results.get(130);
    const skilled = results.get(60);
    const l1 = find(1);
    const l15 = find(15);
    if (novice && l1) check('L1 新手(σ=130) 通关率', novice.get(l1.id).pass, 0.6, 0.85);
    if (skilled && l15) check('L15 熟练(σ=60) 神级率', skilled.get(l15.id).god, 0.0, 0.03);
    if (novice && l15) check('L15 新手(σ=130) 通关率', novice.get(l15.id).pass, 0.0, 0.25);
    const allGod = SIGMAS.map((s) => ({
        s,
        god: mean([...results.get(s).values()].map((v) => v.god)),
    }));
    console.log(
        C.dim(
            '  神级率参考：' +
                allGod.map((g) => `σ${g.s} ${(g.god * 100).toFixed(1)}%`).join(' / ') +
                '（全体平均落在 2–5% 说明高光稀有度合适）',
        ),
    );
    const l1w = l1 ? wins.get(l1.id) : null;
    if (l1w) {
        console.log(C.dim(`  L1 命中窗口：早 ${l1w.earlyMs.toFixed(1)}ms / 晚 ${l1w.lateMs.toFixed(1)}ms（σ=130 的玩家平均绝对误差 ≈ ${(130 * 1.0).toFixed(0)}ms，窗口应 ≥ 该值才「不像抽奖」）`));
    }
}

console.log(C.dim(`\n  总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，样本 ${SIGMAS.length * levels.length * N} 次判定`));
process.exit(rep.finish());
