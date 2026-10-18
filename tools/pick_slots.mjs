/**
 * tools/pick_slots.mjs —— v0.7 §2.4 选槽工具：把「已经画好、还没进关」的道具送进挑战关
 *
 * 规格：01_策划文档/20261018_v0.7_道具BGM视觉三线规格.md §2.4（七条条件 + 输出列）、§2.5（D-079 季4 豁免）
 *
 * 三条口径（改之前先问主策划，别自己调）：
 *   1) ±命中窗口 = |hitWindow.lateMs|。数据里左右对称，early 只用来对账（差 >1ms 会打印）。
 *   2) k 表口径照抄 _probe/ktable2.mjs：cycleMs=2600 定值、motion=旋转、path=h_line、jitter=0、
 *      passRate=0.6、turns=1/2/3 → k = ±窗口 / 2600。**判据取 2 圈列**（ktable2 判定列同口径）。
 *   3) 换形 = shapeId 与 outlineId **同时**换成新形状。只换 shapeId 会让绿框与物体永远不同形，
 *      完美那一按也拿不到 100% —— 那不是「道具进关」，是改判定。
 *
 * 七条条件（全部满足才进候选表，§2.4）：
 *   1) season ≥ 2 且 id > 15            不动教学季，保 S2 两模式镜像
 *   2) variant = single                 不碰双物体（D-025 结算口径）
 *   3) 可辨识门槛 = 两条并列、缺一不可（D-083）：
 *      3① 每圈 cycleMs/|turns| ≥ 1000ms   看得清（每圈太短，玩家只能读出「它朝向哪」，读不出「它是什么」）
 *      3② ±窗口 ≥ 30ms                    打得到（按早了/按晚了还有救）
 *      两者**不等价**，所以是 AND 不是 OR。实测反例：L46 窗口 68.5ms（②过）但每圈 567ms（①不过）；
 *      反方向也会出现（某关每圈够长、但形状窄导致窗口 < 30ms）。不通过时理由代码分开：
 *      SLOW（① 看得清不过）/ TIGHT（② 打得到不过），不合并成一句「门槛不过」。
 *   4) 新形状在该关所属季的 k 带内       季2 0.026–0.046 / 季3 0.020–0.038 / 季4 0.020–0.032
 *   5) 后一关窗口 < 新窗口 < 前一关窗口  保阶梯序（严格不等式，容差 0.05ms）
 *   6) |Δ窗口| ≤ 10ms                   单关难度不许明显跳
 *   7) 新形状尚未进关                   已作主物体 → 硬排除；只在双物体第二件出现过 → 放行但标「半新」
 *
 * 为什么条件 7 对「半新」放行（D-083 采纳）：cactus / dino 在挑战表里只作为 shapeId2 出现过
 * （实测 dino=L40、L55；cactus=L60，都是 dual 关），从没当过主物体；§2.2 的「从未出现」清单里也确实没有它们。
 * 硬排除会让 §2.4 的目标（4 个道具各 ≥1 槽）注定失败，所以放行、但在表里标「半新 + 出处」——不静默当成全新。
 *
 * 候选（§2.4 + §2.5）：headphone（季2）/ saxophone、cactus、dino（季3）。
 *   季4 的 windmill、satellite、anchor、dragon 按 D-079 豁免，本工具不给它们找槽，只打印证据。
 *
 * 用法：
 *   node tools/pick_slots.mjs                                  # 人读表
 *   node tools/pick_slots.mjs --json                           # 只打印 JSON（给策划/脚本吃）
 *   node tools/pick_slots.mjs --json --out temp/pick_slots.json # 同时落盘（不改正式配置）
 *   node tools/pick_slots.mjs --levels 01_策划文档/levels_probe.json   # 拿别的表试算
 *
 * 退出码：0 = 4 个道具各 ≥1 槽；1 = 有道具无槽（打印缺失清单）；2 = 输入 / 核心层加载失败。
 */

import path from 'node:path';
import { ROOT, readJson, exists, rel, printTable, C, writeJson } from './_io.mjs';

/* ---------------- 参数 ---------------- */

const USAGE = `用法：
  node tools/pick_slots.mjs [--json] [--out <path>] [--levels <path>] [--shapes <path>]

  --json            末尾打印可机读结果（含全量排除明细）
  --out <path>      把 --json 的结果写到文件（相对工程根目录）
  --levels <path>   换一份关卡表试算（默认 assets/resources/config/levels.json）
  --shapes <path>   换一份轮廓表试算（默认 assets/resources/config/shapes.json）
  --help            打印本段`;

const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes(n);
const val = (n) => {
    const i = ARGV.indexOf(n);
    if (i < 0 || i + 1 >= ARGV.length) return null;
    const v = ARGV[i + 1];
    return v.startsWith('--') ? null : v;
};
const abs = (p) => path.resolve(ROOT, p);

const LEVELS_PATH = abs(val('--levels') || 'assets/resources/config/levels.json');
const SHAPES_PATH = abs(val('--shapes') || 'assets/resources/config/shapes.json');
const OUT_PATH = val('--out') ? abs(val('--out')) : null;
const AS_JSON = flag('--json');

if (flag('--help') || flag('-h')) {
    console.log(USAGE);
    process.exit(0);
}

/* 核心层用动态 import：--help 不该为了打印用法去装 .ts 解析钩子 */
let core = null;
try {
    core = (await import('./_core.mjs')).core;
} catch (e) {
    console.error('');
    console.error('[pick_slots] 核心层加载失败：' + ((e && e.message) || e));
    console.error('  确认 node ≥ 22.15（本工程用 24，.ts 解析钩子需要 module.registerHooks），再看上面 _core.mjs 打印的堆栈。');
    console.error('');
    process.exit(2);
}

/* ---------------- 常量（= 规格数字，改这里等于改验收标准） ---------------- */

/** §2.3 可辨识门槛 ②：±窗口 ≥ 30ms（D-083：与 ① 并列，AND 关系）
 *  可用环境变量 PS_MIN_WIN 临时放宽做敏感度实验（只影响本工具，不改验收标准） */
const MIN_WIN_MS = +(process.env.PS_MIN_WIN || 30);
/** D-083 可辨识门槛 ①：每圈 cycleMs/|turns| ≥ 1000ms（「看得清」；与 ② 不等价，不许互相替代）
 *  可用环境变量 PS_MIN_LAP 临时放宽做敏感度实验 */
const MIN_LAP_MS = +(process.env.PS_MIN_LAP || 1000);
/** §2.4 条件 6：单关难度不许明显跳（可用环境变量 PS_MAX_DELTA 放宽做实验） */
const MAX_DELTA_MS = +(process.env.PS_MAX_DELTA || 10);
/** §2.4 条件 1：教学季关数（id > 15 才可动） */
const MIN_LEVEL_ID = 15;
/** k 表定周期 + 判据圈数（ktable2 口径） */
const K_CYCLE_MS = 2600;
const K_TURNS = 2;
/** 条件 5 严格不等式的容差：差 0.04ms 算「持平」而不是「落在带内」 */
const ADJ_EPS_MS = 0.05;
/** 季 = 每 15 关（与原型 seasonOf / S1 同口径） */
const SEASON_PER = 15;

/** §2.4 条件 4：季 → k 带（季1 无带：教学季不进新道具） */
const K_BANDS = { 2: [0.026, 0.046], 3: [0.020, 0.038], 4: [0.020, 0.032] };

/** §2.4 候选道具 → 目标季 */
const CANDIDATES = [
    { shape: 'headphone', season: 2 },
    { shape: 'saxophone', season: 3 },
    { shape: 'cactus', season: 3 },
    { shape: 'dino', season: 3 },
];

/** §2.5 / D-079：季4 不上新道具。这里只用来打证据，不参与选槽 */
const SEASON4_EXEMPT = ['windmill', 'satellite', 'anchor', 'dragon'];

/* ---------------- 小工具 ---------------- */

const round1 = (x) => Math.round(x * 10) / 10;
const round3 = (x) => Math.round(x * 1000) / 1000;
const fmt1 = (x) => (typeof x === 'number' && isFinite(x) ? round1(x).toFixed(1) : 'n/a');
const fmt3 = (x) => (typeof x === 'number' && isFinite(x) ? round3(x).toFixed(3) : 'n/a');
const signed = (x) => (x >= 0 ? '+' : '') + fmt1(x);
const winOfStored = (hw) => (hw && typeof hw.lateMs === 'number' && isFinite(hw.lateMs) ? Math.abs(hw.lateMs) : NaN);

function die(msg) {
    console.error('');
    console.error(C.red('[pick_slots] 失败：') + msg);
    console.error('');
    process.exit(2);
}

/* ---------------- 输入 ---------------- */

if (!exists(LEVELS_PATH)) die('找不到 ' + rel(LEVELS_PATH) + '（先跑 node tools/export_levels.mjs）');
if (!exists(SHAPES_PATH)) die('找不到 ' + rel(SHAPES_PATH));

const levelsRaw = readJson(LEVELS_PATH);
const levelList = (Array.isArray(levelsRaw) ? levelsRaw : levelsRaw.levels || []).slice().sort((a, b) => a.id - b.id);
if (!levelList.length) die(rel(LEVELS_PATH) + ' 里没有 levels 数组（支持 [ ... ] 或 { "levels": [ ... ] }）');

let shapes = null;
try {
    shapes = core.loadShapes(readJson(SHAPES_PATH));
} catch (e) {
    die('shapes.json 校验失败：' + ((e && e.message) || e));
}

/* ---------------- 核心层调用（带缓存 + 计数，出错不崩） ---------------- */

let buildCount = 0;
const winCache = new Map();
/** 实算某一关（或 k 表模板）的 ±窗口；失败返回 { ok:false, err } */
function tryWin(def, key) {
    if (winCache.has(key)) return winCache.get(key);
    buildCount++;
    let out;
    try {
        const rt = core.buildLevel(def, shapes, 0);
        const hw = core.hitWindow(rt, 0.5, 20);
        if (!hw || typeof hw.lateMs !== 'number' || !isFinite(hw.lateMs)) {
            throw new Error('hitWindow 返回非法值 ' + JSON.stringify(hw));
        }
        out = {
            ok: true,
            win: Math.abs(hw.lateMs),
            asym: Math.abs(Math.abs(hw.lateMs) - Math.abs(hw.earlyMs)),
            wide: !!(hw.earlyWide || hw.lateWide),
        };
    } catch (e) {
        out = { ok: false, err: String((e && e.message) || e) };
    }
    winCache.set(key, out);
    return out;
}

/** k 表模板（逐字照抄 _probe/ktable2.mjs 的 def，只把 turns 参数化） */
function kDef(shapeId, turns) {
    return {
        id: 0,
        name: 'k-table',
        shapeId,
        outlineId: shapeId,
        variant: 'single',
        motion: '旋转',
        path: 'h_line',
        cycleMs: K_CYCLE_MS,
        turns,
        jitter: 0,
        toleranceDeg: 10,
        passRate: 0.6,
        star3Rate: 0.94,
        estSec: 4,
        weight: 1,
        attempts: 3,
        note: 'ktable2 口径',
        speedStage: 1,
        linSpeed: [0, 0],
        angSpeed: [0, 0],
    };
}

/* ---------------- 季判定（字段优先，与 id 口径不符就记一条诊断） ---------------- */

const seasonMismatch = [];
const seasonMap = new Map();
for (const d of levelList) {
    const byId = Math.max(1, Math.ceil((d.id || 1) / SEASON_PER));
    const raw = Number(d.season);
    const byField = Number.isInteger(raw) && raw >= 1 && raw <= 4 ? raw : byId;
    if (byField !== byId) seasonMismatch.push('L' + d.id + ' season=' + String(d.season) + '，但按 15 关/季算应是季' + byId);
    seasonMap.set(d.id, byField);
}
const seasonOf = (d) => seasonMap.get(d.id) || Math.max(1, Math.ceil((d.id || 1) / SEASON_PER));

/* ---------------- k 表（ktable2 口径，1/2/3 圈全打印，判据取 2 圈） ---------------- */

const kRows = [];
for (const c of CANDIDATES) {
    const rows = [1, 2, 3].map((turns) => {
        const r = tryWin(kDef(c.shape, turns), 'k:' + c.shape + ':' + turns);
        return { turns, ok: !!r.ok, win: r.win, k: r.ok ? r.win / K_CYCLE_MS : NaN, asym: r.asym, err: r.err || '' };
    });
    const primary = rows.filter((r) => r.turns === K_TURNS)[0] || rows[1];
    const band = K_BANDS[c.season] || null;
    kRows.push({
        shape: c.shape,
        season: c.season,
        rows,
        ok: !!primary.ok,
        win: primary.win,
        k: primary.k,
        err: primary.err || '',
        band,
        inBand: !!(primary.ok && band && primary.k >= band[0] && primary.k <= band[1]),
    });
}
const kById = new Map(kRows.map((r) => [r.shape, r]));

/* ---------------- 现状：谁已经进关（主物体 / 双物体第二件） ---------------- */

const usedPrimary = new Map();
const usedDual = new Map();
const pushTo = (m, k, v) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
};
for (const d of levelList) {
    pushTo(usedPrimary, d.shapeId, d.id);
    if (d.shapeId2) pushTo(usedDual, d.shapeId2, d.id);
}

/* ---------------- 对账：levels.json 的派生窗口 vs 当前 shapes 实算 ---------------- */

const byId = new Map(levelList.map((d) => [d.id, d]));
const auditRows = [];
for (const d of levelList) {
    const stored = winOfStored(d.hitWindow);
    const own = tryWin(d, 'own:' + d.id);
    if (!own.ok) {
        auditRows.push({ id: d.id, stored, exact: NaN, diff: NaN, err: own.err });
        continue;
    }
    auditRows.push({ id: d.id, stored, exact: own.win, diff: isFinite(stored) ? own.win - stored : NaN, err: '' });
}
const auditBad = auditRows.filter((r) => r.err || !isFinite(r.diff) || Math.abs(r.diff) > 0.5);
const auditMax = auditRows.filter((r) => isFinite(r.diff)).reduce((m, r) => Math.max(m, Math.abs(r.diff)), 0);
const asymMax = kRows.reduce((m, r) => Math.max(m, r.rows.filter((x) => x.ok).reduce((mm, x) => Math.max(mm, x.asym || 0), 0)), 0);

/* ---------------- 主循环：七条条件逐 (关 × 形状) 求值 ---------------- */

const slots = [];
const exclusions = [];
const buildThrows = new Map(); // shape -> [{levelId, err}]

for (const d of levelList) {
    const season = seasonOf(d);
    const winBefore = winOfStored(d.hitWindow);
    const turnsAbs = Math.abs(Number(d.turns) || 0);
    const lapMs = Number(d.cycleMs) > 0 && turnsAbs > 0 ? Number(d.cycleMs) / turnsAbs : NaN;
    const cands = CANDIDATES.filter((c) => c.season === season);
    const base = {
        levelId: d.id,
        season,
        old: d.shapeId,
        winBefore: isFinite(winBefore) ? round1(winBefore) : null,
        lapMs: isFinite(lapMs) ? round1(lapMs) : null,
    };

    /* 关卡级门（与形状无关）。命中就整关照排，理由带数字。
       D-083：条件 3 拆成①看得清（每圈 ≥1000ms）/②打得到（±窗口 ≥30ms），并列 AND，代码分开。 */
    const levelFails = [];
    if (season === 4) {
        levelFails.push({
            code: 'D079-季4豁免',
            reason: 'D-079：季4 不上新道具（不给 windmill/satellite/anchor/dragon 找槽）',
        });
    }
    if (season === 1) {
        levelFails.push({ code: '季节1-教学', reason: '季1 教学季不进新道具（不动 A-08 / S2 两模式镜像）' });
    }
    if (d.id <= MIN_LEVEL_ID) {
        levelFails.push({ code: 'id<=15', reason: 'L' + d.id + ' 属教学关（条件 1：id > 15）' });
    }
    if (String(d.variant || 'single') !== 'single') {
        levelFails.push({ code: '双物体', reason: 'variant=' + String(d.variant) + '（条件 2 / D-025 结算口径不动）' });
    }
    /* 条件 3① SLOW：看得清 */
    if (!isFinite(lapMs)) {
        levelFails.push({
            code: 'LAP-NA',
            reason: '算不出每圈毫秒（cycleMs=' + String(d.cycleMs) + ' / turns=' + String(d.turns) + '，条件 3①）',
        });
    } else if (lapMs + 1e-9 < MIN_LAP_MS) {
        levelFails.push({
            code: 'SLOW',
            reason: '每圈 ' + fmt1(lapMs) + 'ms < ' + MIN_LAP_MS + 'ms（条件 3① 看得清 / D-083）',
        });
    }
    /* 条件 3② TIGHT：打得到 */
    if (!isFinite(winBefore)) {
        levelFails.push({ code: '缺窗口字段', reason: 'levels.json 没带 hitWindow（先跑 node tools/export_levels.mjs）' });
    } else if (winBefore + 1e-9 < MIN_WIN_MS) {
        levelFails.push({
            code: 'TIGHT',
            reason: '±窗口 ' + fmt1(winBefore) + 'ms < ' + MIN_WIN_MS + 'ms（条件 3② 打得到 / D-083）',
        });
    }

    if (!cands.length) {
        /* 季 1 / 季 4：本季没有候选道具 —— 也要留一条，别让「这一关」在日志里消失 */
        const reason = levelFails.length ? levelFails.map((f) => f.reason).join('；') : '本季无候选道具';
        exclusions.push(Object.assign({}, base, { shape: '-', code: levelFails.length ? levelFails[0].code : '无候选', reason }));
        continue;
    }

    for (const c of cands) {
        if (levelFails.length) {
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                /* 多条关卡级门同时不过时，代码用 + 连接（SLOW+TIGHT 这种要能在汇总里单独看见） */
                code: levelFails.map((f) => f.code).join('+'),
                reason: levelFails.map((f) => f.reason).join('；'),
            }));
            continue;
        }

        /* 条件 7：尚未进关 */
        const asPrimary = usedPrimary.get(c.shape) || [];
        const asDual = usedDual.get(c.shape) || [];
        if (asPrimary.length) {
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                code: '已进关(主物体)',
                reason: c.shape + ' 已是主物体：L' + asPrimary.join(',L') + '（条件 7）',
            }));
            continue;
        }

        /* 条件 4：k 落季带 */
        const kr = kById.get(c.shape);
        const band = K_BANDS[season];
        if (!kr || !kr.ok) {
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                code: 'k表不可测',
                reason: 'k 表测不出 ' + c.shape + '：' + (kr ? kr.err : '未知'),
            }));
            continue;
        }
        if (!(kr.k >= band[0] && kr.k <= band[1])) {
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                code: 'k越季带',
                reason: 'k(2圈)=' + fmt3(kr.k) + ' 不在季' + season + '带 [' + band[0] + ', ' + band[1] + ']（条件 4）',
            }));
            continue;
        }

        /* 条件 5 / 6：实算换形后窗口（不靠线性外推，几何变了就重算） */
        const swapped = Object.assign({}, d, { shapeId: c.shape, outlineId: c.shape });
        const after = tryWin(swapped, 'lv:' + d.id + ':' + c.shape);
        if (!after.ok) {
            if (!buildThrows.has(c.shape)) buildThrows.set(c.shape, []);
            buildThrows.get(c.shape).push({ levelId: d.id, err: after.err });
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                code: '换形后构关抛错',
                reason: '换形后 buildLevel/hitWindow 抛：' + after.err,
            }));
            continue;
        }
        const winAfter = after.win;
        const prev = byId.get(d.id - 1) || null;
        const next = byId.get(d.id + 1) || null;
        /* D-087：窗口阶梯只在**同季内**成立（D-061 允许季间锯齿：季末最难 → 新季开场回落）。
           跨季比较会把"季首关比上季末关容易"误判成"不在带内"——L16 就是反例：
           上邻 L15 34.0ms（上季末）、下邻 L17 102.6ms，跨季判据得到 "34 > w > 102.6"，永远不可能成立。 */
        const prevSame = (prev && Number(prev.season) === Number(d.season)) ? prev : null;
        const nextSame = (next && Number(next.season) === Number(d.season)) ? next : null;
        const prevWin = prevSame ? winOfStored(prevSame.hitWindow) : NaN;
        const nextWin = nextSame ? winOfStored(nextSame.hitWindow) : NaN;
        const neighborTxt = '同季 ' + (prevSame ? 'L' + prevSame.id + ' ' + fmt1(prevWin) : '（季首，无上邻）') +
            ' / ' + (nextSame ? 'L' + nextSame.id + ' ' + fmt1(nextWin) : '（季末，无下邻）');

        if ((prevSame && !isFinite(prevWin)) || (nextSame && !isFinite(nextWin))) {
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                code: '邻居缺失',
                reason: '邻居窗口取不到（' + neighborTxt + '），无法判阶梯（条件 5）',
            }));
            continue;
        }
        const delta = winAfter - winBefore;
        const inBand = (prevSame ? winAfter < prevWin - ADJ_EPS_MS : true) &&
            (nextSame ? winAfter > nextWin + ADJ_EPS_MS : true);
        if (!inBand) {
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                code: '邻居带外',
                reason: '换形后 ±' + fmt1(winAfter) + 'ms 不在邻居带内（' + neighborTxt + '，条件 5）',
            }));
            continue;
        }
        if (Math.abs(delta) > MAX_DELTA_MS) {
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                code: 'Δ>10ms',
                reason: 'Δ=' + signed(delta) + 'ms 超过 ' + MAX_DELTA_MS + 'ms（条件 6）',
            }));
            continue;
        }
        if (winAfter + 1e-9 < MIN_WIN_MS) {
            exclusions.push(Object.assign({}, base, {
                shape: c.shape,
                code: 'TIGHT-换形后',
                reason: '换形后 ±' + fmt1(winAfter) + 'ms < ' + MIN_WIN_MS + 'ms（条件 3② 复核 / D-083）',
            }));
            continue;
        }

        slots.push({
            levelId: d.id,
            season,
            old: d.shapeId,
            new: c.shape,
            lapMs: round1(lapMs),
            winBefore: round1(winBefore),
            winAfter: round1(winAfter),
            delta: round1(delta),
            k2: round3(kr.k),
            prevLevelId: prevSame ? prevSame.id : null,
            prevWin: isFinite(prevWin) ? round1(prevWin) : null,
            nextLevelId: nextSame ? nextSame.id : null,
            nextWin: isFinite(nextWin) ? round1(nextWin) : null,
            dualOnly: asDual.length > 0,
            dualAt: asDual,
            note: asDual.length ? '半新：已作双物体第二件 L' + asDual.join(',L') : '',
        });
    }
}

/* ---------------- 推荐分配（每道具 1 槽，贪心 + 相邻换形联合校验） ---------------- */

/** 某一关在「已定换形方案」下的有效窗口 */
function effWin(id, plan) {
    if (plan.has(id)) return plan.get(id).winAfter;
    const d = byId.get(id);
    return d ? winOfStored(d.hitWindow) : NaN;
}

/** 条件 5/6 在给定方案下是否仍成立 */
function jointPass(id, plan) {
    const s = plan.get(id);
    if (!s) return true;
    const d = byId.get(id);
    if (!d) return false;
    /* D-087：同季才比邻居（季边界不比，见上面 slots 循环里的说明） */
    const prev = byId.get(id - 1) || null;
    const next = byId.get(id + 1) || null;
    const prevSame = (prev && Number(prev.season) === Number(d.season)) ? prev : null;
    const nextSame = (next && Number(next.season) === Number(d.season)) ? next : null;
    const prevWin = prevSame ? effWin(prevSame.id, plan) : NaN;
    const nextWin = nextSame ? effWin(nextSame.id, plan) : NaN;
    if ((prevSame && !isFinite(prevWin)) || (nextSame && !isFinite(nextWin))) return false;
    const winAfter = s.winAfter;
    const okBand = (prevSame ? winAfter < prevWin - ADJ_EPS_MS : true) &&
        (nextSame ? winAfter > nextWin + ADJ_EPS_MS : true);
    return okBand && Math.abs(winAfter - s.winBefore) <= MAX_DELTA_MS;
}

const slotsByDelta = slots.slice().sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.levelId - b.levelId);
const plan = new Map();
const plannedShapes = new Set();
for (const s of slotsByDelta) {
    if (plannedShapes.has(s.new) || plan.has(s.levelId)) continue;
    plan.set(s.levelId, s);
    const affected = [s.levelId - 1, s.levelId, s.levelId + 1];
    const ok = affected.every((id) => jointPass(id, plan));
    if (!ok) {
        plan.delete(s.levelId);
        continue;
    }
    plannedShapes.add(s.new);
}
const recommendation = Array.from(plan.values()).sort((a, b) => a.season - b.season || a.levelId - b.levelId);
const recommendationOk = recommendation.every((s) => jointPass(s.levelId, plan));
const recommendMissing = CANDIDATES.map((c) => c.shape).filter((s) => !plannedShapes.has(s));

/* ---------------- 季4 证据（D-079） ---------------- */

const s4 = levelList.filter((d) => seasonOf(d) === 4);
const lapOfDef = (d) => {
    const t = Math.abs(Number(d.turns) || 0);
    return Number(d.cycleMs) > 0 && t > 0 ? Number(d.cycleMs) / t : NaN;
};
const s4Win = s4.map((d) => ({
    id: d.id,
    win: winOfStored(d.hitWindow),
    lap: lapOfDef(d),
    variant: d.variant,
    cycle: Number(d.cycleMs),
    turns: Number(d.turns),
}))
    .filter((r) => isFinite(r.win));
/* 条件 3 拆两条（D-083）：①看得清 = 每圈 ≥1000ms，②打得到 = ±窗口 ≥30ms；两条都过才算过门槛 */
const s4Slow = s4Win.filter((r) => isFinite(r.lap) && r.lap + 1e-9 >= MIN_LAP_MS);
const s4Pass = s4Win.filter((r) => r.win + 1e-9 >= MIN_WIN_MS);
const s4Both = s4Win.filter((r) => isFinite(r.lap) && r.lap + 1e-9 >= MIN_LAP_MS && r.win + 1e-9 >= MIN_WIN_MS);
const s4Max = s4Win.reduce((m, r) => (r.win > m.win ? r : m), { id: 0, win: 0, lap: NaN });
const s4Fast = s4Win.filter((r) => isFinite(r.lap)).reduce((m, r) => (r.lap < m.lap ? r : m), { id: 0, lap: Infinity });
const s4SinglePass = s4Both.filter((r) => String(r.variant || 'single') === 'single');

/* ---------------- 排除汇总 ---------------- */

const exclByCode = new Map();
for (const e of exclusions) {
    if (!exclByCode.has(e.code)) exclByCode.set(e.code, []);
    exclByCode.get(e.code).push(e);
}
const exclSummary = Array.from(exclByCode.entries())
    .map(([code, list]) => ({ code, count: list.length, list }))
    .sort((a, b) => b.count - a.count);

/* ---------------- 打印：人读表 ---------------- */

if (!AS_JSON) {
    console.log('');
    console.log(C.cyan('=== pick_slots · v0.7 §2.4 道具进关选槽 ==='));
    console.log('关卡表：' + rel(LEVELS_PATH) + '（' + levelList.length + ' 关，挑战表）');
    console.log('轮廓表：' + rel(SHAPES_PATH) + '（' + Object.keys(shapes).length + ' 个轮廓）');
    console.log('门槛  ：①每圈 ≥ ' + MIN_LAP_MS + 'ms（看得清）＋ ②±窗口 ≥ ' + MIN_WIN_MS + 'ms（打得到）—— 并列，缺一不可（D-083）');
    console.log('        ｜|Δ窗口| ≤ ' + MAX_DELTA_MS + 'ms｜id > ' + MIN_LEVEL_ID + '｜variant = single｜k(2圈) 落季带');
    console.log('只改挑战表；催眠 levels_relax.json 一个字不动（S3 不受影响）');

    /* k 表 */
    console.log('');
    console.log(C.cyan('[k 表] ktable2 口径：cycleMs=' + K_CYCLE_MS + ' / motion=旋转 / path=h_line / jitter=0 / passRate=0.6'));
    const kTable = kRows.map((r) => [
        r.shape,
        String(r.season),
        r.rows[0] && r.rows[0].ok ? fmt3(r.rows[0].k) : 'n/a',
        r.ok ? fmt3(r.k) + '※' : 'n/a',
        r.rows[2] && r.rows[2].ok ? fmt3(r.rows[2].k) : 'n/a',
        r.band ? r.band[0] + '–' + r.band[1] : '（无带）',
        r.ok ? (r.inBand ? '在带内 ✓' : '越界 ✗') : '测不出：' + r.err,
    ]);
    printTable(['道具', '季', 'k(1圈)', 'k(2圈)※', 'k(3圈)', '季带', '判定'], kTable);
    console.log(C.dim('  ※ = 判据列（§2.4 条件 4 用它）。k = ±窗口 / ' + K_CYCLE_MS + 'ms'));

    /* 候选槽 */
    console.log('');
    console.log(C.cyan('[候选槽] 条件 1–7 全满足（Δ = 换形后 − 换形前，负数 = 变简单）'));
    if (slots.length) {
        const rows = slots.map((s) => [
            'L' + s.levelId,
            String(s.season),
            s.old + '→' + s.new,
            fmt1(s.lapMs),
            fmt1(s.winBefore),
            fmt1(s.winAfter),
            signed(s.delta),
            s.prevLevelId + '/' + s.nextLevelId + '：' + fmt1(s.prevWin) + '/' + fmt1(s.nextWin),
            s.note,
        ]);
        printTable(['关', '季', '换形', '每圈ms', '窗口前', '窗口后', 'Δms', '邻居(前/后) 窗口', '备注'], rows,
            ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'l', 'l']);
    } else {
        console.log(C.yellow('  （无：七条条件没有任何 (关 × 形状) 全满足 —— 逐条理由见下面「排除明细」）'));
    }

    /* 推荐分配 */
    console.log('');
    console.log(C.cyan('[推荐分配] 每个道具取 |Δ| 最小的空闲槽；相邻两种换形会一起复核阶梯'));
    if (recommendation.length) {
        const rows = recommendation.map((s) => [
            'L' + s.levelId + '（季' + s.season + '）',
            s.old + '→' + s.new,
            fmt1(s.winBefore) + '→' + fmt1(s.winAfter),
            signed(s.delta),
            s.note,
        ]);
        printTable(['落点', '换形', '窗口', 'Δms', '备注'], rows, ['l', 'l', 'l', 'r', 'l']);
        if (recommendMissing.length) {
            console.log(C.red('  推荐后仍缺：' + recommendMissing.join(' / ')));
        }
        console.log(C.dim('  相邻联合复核：' + (recommendationOk ? '通过（换形后的邻居阶梯仍严格单调）' : '不通过 —— 有相邻关互相顶掉，需人工取舍')));
    } else {
        console.log(C.yellow('  （无）'));
    }

    /* 排除汇总 */
    console.log('');
    console.log(C.cyan('[排除汇总] ' + exclusions.length + ' 条（关 × 形状 配对；季1/季4 无候选的按关记一条）'));
    printTable(['理由代码', '条数'], exclSummary.map((g) => [g.code, String(g.count)]), ['l', 'r']);

    console.log('');
    console.log(C.cyan('[排除明细]'));
    const MAX_PER_GROUP = 15;
    for (const g of exclSummary) {
        console.log('  ' + C.yellow('[' + g.code + ']') + ' ' + g.count + ' 条');
        for (const e of g.list.slice(0, MAX_PER_GROUP)) {
            console.log('    L' + e.levelId + ' ×' + e.shape + '  ' + e.reason);
        }
        if (g.list.length > MAX_PER_GROUP) {
            console.log(C.dim('    …另 ' + (g.list.length - MAX_PER_GROUP) + ' 条（--json 里有全量）'));
        }
    }

    /* 季4 证据 */
    console.log('');
    console.log(C.cyan('[D-079 季4 证据]'));
    console.log('  季4 共 ' + s4.length + ' 关｜①看得清（每圈 ≥ ' + MIN_LAP_MS + 'ms）：' + s4Slow.length + ' 关' +
        '｜②打得到（±窗口 ≥ ' + MIN_WIN_MS + 'ms）：' + s4Pass.length + ' 关' +
        (s4Pass.length ? '（' + s4Pass.map((r) => 'L' + r.id + ' ±' + fmt1(r.win) + '／' + (isFinite(r.lap) ? Math.round(r.lap) : 'n/a') + 'ms 每圈').join('，') + '）' : '') +
        '｜①②同时过：' + s4Both.length + ' 关');
    console.log('  最快每圈 ' + (isFinite(s4Fast.lap) ? Math.round(s4Fast.lap) + 'ms @L' + s4Fast.id : 'n/a') +
        '｜最大 ±窗口 ' + fmt1(s4Max.win) + 'ms @L' + s4Max.id);
    console.log('  其中单物体（variant=single）且 ①② 都过的：' + (s4SinglePass.length ? s4SinglePass.map((r) => 'L' + r.id).join('，') : '无'));
    console.log(C.dim('  结论按 D-079：季4 不找槽。注意 ① 与 ② **不等价**（本行就是证据）：每圈短的关也可能窗口很宽，'));
    console.log(C.dim('  所以两条并列 AND，不许互相替代 —— 上面把两个数都打出来，谁不过一眼能看到。'));

    /* 对账 */
    console.log('');
    console.log(C.cyan('[对账]'));
    console.log('  levels.json 派生窗口 vs 当前 shapes 实算：' +
        (auditBad.length === 0
            ? levelList.length + ' 关全部一致（最大差 ' + auditMax.toFixed(3) + 'ms）'
            : auditBad.length + ' 关不一致（最大差 ' + auditMax.toFixed(3) + 'ms）→ ' +
              auditBad.slice(0, 6).map((r) => 'L' + r.id + (r.err ? ' 抛错' : ' 差 ' + r.diff.toFixed(2) + 'ms')).join('，')));
    if (auditBad.length) console.log(C.yellow('  提示：改了 shapes.json 却没重跑 node tools/export_levels.mjs 时会出现这种差'));
    console.log('  early/late 不对称最大值：' + asymMax.toFixed(2) + 'ms（>1ms 说明窗口不再对称，§2.3 的「对称」假设要复核）');
    if (seasonMismatch.length) console.log(C.yellow('  season 字段与 15 关/季 不符：' + seasonMismatch.slice(0, 6).join('；')));
    {
        const auditById = new Map(auditRows.map((r) => [r.id, r]));
        const ks = levelList.map((d) => {
            const r = auditById.get(d.id);
            const w = r && isFinite(r.exact) ? r.exact : NaN;
            return isFinite(w) && d.cycleMs > 0 && d.turns ? (w * Math.abs(d.turns)) / d.cycleMs : NaN;
        }).filter((x) => isFinite(x));
        if (ks.length) {
            console.log('  全表 k_spec = ±窗口×圈数/周期 ∈ [' + Math.min(...ks).toFixed(3) + ', ' + Math.max(...ks).toFixed(3) + ']');
            console.log(C.dim('    §2.3 的「k≈0.03」只覆盖最窄那一档；季带（条件 4）用的是 ktable2 的「窗口/周期，2 圈」，'));
            console.log(C.dim('    两者差 2 倍（2 圈时），别把两个 k 混用 —— 混用的后果是整条断言永远红或永远绿。'));
        }
    }
    console.log('  实算 hitWindow 次数：' + buildCount);

    /* 汇总 */
    console.log('');
    console.log(C.cyan('[汇总]'));
    const perShape = CANDIDATES.map((c) => ({
        shape: c.shape,
        n: slots.filter((s) => s.new === c.shape).length,
    }));
    console.log('  ' + perShape.map((x) => x.shape + ' ' + x.n + ' 槽').join('｜'));
    const missing = perShape.filter((x) => x.n === 0).map((x) => x.shape);
    if (missing.length) {
        console.log(C.red('  缺失：' + missing.join(' / ') + '（看上面 [排除明细] 里它被哪条卡住）'));
        console.log(C.red('RESULT: MISSING（' + (CANDIDATES.length - missing.length) + '/' + CANDIDATES.length + ' 个道具找到槽）'));
    } else {
        console.log(C.green('RESULT: OK（' + CANDIDATES.length + '/' + CANDIDATES.length + ' 个道具各 ≥1 槽，候选槽共 ' + slots.length + ' 个）'));
    }
    console.log('');
    console.log(C.dim('口径备注一：条件 4 的季带按 ktable2 的 k（±窗口/周期，2 圈）解释；§2.3 里「k≈0.03」那个 k'));
    console.log(C.dim('          是 ±窗口×圈数/周期，2 圈时正好差 2 倍。两种取法若策划要换，先改规格再改这个文件。'));
    console.log(C.dim('口径备注二：条件 7 对「只在双物体第二件出现过」的形状放行并标半新（见文件头）。'));
    console.log(C.dim('口径备注三：条件 3 = ①每圈 ≥ 1000ms 且 ②±窗口 ≥ 30ms（D-083，AND）。理由代码 SLOW / TIGHT 分开计，'));
    console.log(C.dim('          因为修法不同：SLOW 要调周期或圈数（动速度阶梯），TIGHT 要换更宽的形状或调 passRate。'));
    console.log('');
}

/* ---------------- --json ---------------- */

const result = {
    tool: 'pick_slots',
    version: 'v0.7',
    inputs: {
        levels: rel(LEVELS_PATH),
        shapes: rel(SHAPES_PATH),
        levelCount: levelList.length,
        shapeCount: Object.keys(shapes).length,
    },
    thresholds: {
        minLapMs: MIN_LAP_MS,
        minWinMs: MIN_WIN_MS,
        maxDeltaMs: MAX_DELTA_MS,
        minLevelId: MIN_LEVEL_ID,
        kCycleMs: K_CYCLE_MS,
        kTurns: K_TURNS,
        gate3: 'AND（D-083）：① cycleMs/|turns| ≥ minLapMs 且 ② ±窗口 ≥ minWinMs',
    },
    kTable: kRows.map((r) => ({
        shape: r.shape,
        season: r.season,
        k1: r.rows[0] && r.rows[0].ok ? round3(r.rows[0].k) : null,
        k2: r.ok ? round3(r.k) : null,
        k3: r.rows[2] && r.rows[2].ok ? round3(r.rows[2].k) : null,
        win2: r.ok ? round1(r.win) : null,
        band: r.band,
        inBand: r.inBand,
        err: r.err || null,
    })),
    slots,
    recommendation,
    recommendationOk,
    recommendMissing,
    exclusions: {
        total: exclusions.length,
        byCode: exclSummary.map((g) => ({ code: g.code, count: g.count })),
        detail: exclusions,
    },
    season4Evidence: {
        exempt: SEASON4_EXEMPT,
        levelCount: s4.length,
        /* D-083 两条并列，分开计数：谁不过一眼能看到 */
        slowPassIds: s4Slow.map((r) => r.id),
        windowPassIds: s4Pass.map((r) => r.id),
        bothPassIds: s4Both.map((r) => r.id),
        maxWin: { levelId: s4Max.id, win: round1(s4Max.win) },
        fastestLap: { levelId: s4Fast.id, lapMs: isFinite(s4Fast.lap) ? round1(s4Fast.lap) : null },
        singleBothPassIds: s4SinglePass.map((r) => r.id),
        rows: s4Win.map((r) => ({ levelId: r.id, lapMs: isFinite(r.lap) ? round1(r.lap) : null, win: round1(r.win), variant: r.variant })),
    },
    audit: {
        maxDiffMs: round3(auditMax),
        bad: auditBad.map((r) => ({ levelId: r.id, stored: r.stored, exact: isFinite(r.exact) ? round1(r.exact) : null, err: r.err || null })),
        asymMaxMs: round3(asymMax),
        buildCount,
    },
    missing: CANDIDATES.map((c) => c.shape).filter((s) => !slots.some((x) => x.new === s)),
};

if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
}
if (OUT_PATH) {
    writeJson(OUT_PATH, result);
    console.log('');
    console.log('[pick_slots] 已写出 ' + rel(OUT_PATH));
}

process.exit(result.missing.length === 0 ? 0 : 1);
