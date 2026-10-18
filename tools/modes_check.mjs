/**
 * tools/modes_check.mjs —— 原型层验收断言（v0.3 → v0.7，共 28 条）
 *
 * 规格来源：
 *   01_策划文档/20261018_v0.3_双模式改为时间限制.md   → M5–M8 / M13–M20
 *   01_策划文档/20261018_v0.4_四季60关与道具库.md      → S1/S2/S3/S5/S6
 *   01_策划文档/20261018_v0.5_机制节奏.md（决策记录）  → S10/S11/S12
 *   01_策划文档/20261018_v0.6_双物体错拍.md            → S17/S19/S20/S21
 *   01_策划文档/20261018_v0.7_道具BGM视觉三线规格.md   → S22a–d
 *
 * 逐条清单：
 *   M5  场景自适应：hour=3 → night_station；hour=13 → noon_window
 *   M6  手动优先：minimal 覆盖自动；改回 auto 回到自动
 *   M7  场景不干扰判定：同 pressMs 三场景 pct 完全相同
 *   M8  绿框几何静止：呼吸周期内 targetPts 逐点差值 0，外发光 α 0.35–0.55
 *   M13 计时配置：挑战 timeLimitMs=15000；relax 恒 null
 *   M14 超时进结算：fb.timeout=true、rating=fail
 *   M15 超时扣一次机会
 *   M16 重试后计时回 15000
 *   M17 两模式评分一致：同 pressMs 的 pct/rating/score/pass 逐位相同
 *   M18 relax 同规格：ratingSfx/showScore 同挑战、面板会 revealed、不画倒计时槽位
 *   M19 relax 合格进下一关；最后一关后回第 1 关且 round+1
 *   M20 挑战通关写 bestScore；relax 不写（最后一关是错拍关时按两次定格驱动）
 *   S1  60 关结构：4 季 × 15 关，season 连续
 *   S2  两模式前 15 关逐关镜像（shapeId/variant/path）
 *   S3  催眠矩阵：后 45 关每道具 3 次；纯单物体路径不重复；无双物体邻居撞路径；双物体 11 关且 h_line
 *   S5  fx.json 外置生效：json 值 ≠ DEFAULT_FX；四季各钉一关验季色
 *   S6  季主题不影响判定：同 pressMs 四季 pct 相同，仅环色变
 *   S10 机制节点间隔 ≤4 关（季 1 豁免，理由见下）
 *   S11 机制关速度持平（季内比较，季首关不比较）
 *   S12 路径覆盖 + 季 2–4 曲率渐进（季 1 豁免回滚）
 *   S17 错拍关过关条件：只定格 1 个时 phase≠result；两个都合格才 pass
 *   S19 冻结 400ms 不吃窗口：timerElapsed 不变 + attemptStart 恰 +400
 *   S20 HUD 点组：错拍关 frozen 长度 2 / 同步关 frozen=null
 *   S21 失败后两个 mover 全部重置 + 扣一次机会（先证明这次真的失败）
 *   S22a 新进关道具 100% 落在其所属季 k 带内（k = ±窗口 / 2600，ktable2 的 2 圈口径）
 *   S22b 新面孔关 ①每圈 ≥ 1000ms 且 ②±窗口 ≥ 30ms、variant=single、id > 15（D-083：两条并列 AND）
 *   S22c 换形关 |Δ窗口| ≤ 10ms 且落在邻居带内；**除换形关外其余关窗口逐位不变**（基线 diff = 0）
 *   S22d 每个候选新道具**至少进 1 关**（D-082），季 4 按 D-079 豁免但必须打印原因
 *
 * 纪律：
 *   · 未就绪的断言记入「未执行」并打印 [skip]，原因**实时求值**（不许写死文案），
 *     且 RESULT 行必须体现"N 条未执行"——"24 条绿"和"20 条绿"在日志里不能看起来一样。
 *   · 每条 detail 必须能定位到「关/数值/期望值」，不要只说"不对"。
 *   · S22c 需要**改表之前**的窗口快照。捕获方式（P2 改 levels.csv 之前跑一次）：
 *       node tools/modes_check.mjs --write-win-baseline
 *     没快照时 S22c 记 [skip] 并打印查找过的路径，**不许判绿**——抓晚了会把新值当基线，比不测更糟。
 *
 * 用法：node tools/build_proto.mjs && node tools/modes_check.mjs
 *       node tools/modes_check.mjs --write-win-baseline        # 抓 S22c 基线
 *       node tools/modes_check.mjs --baseline <json>           # 指定别的基线
 */

import path from 'node:path';
import { loadProto } from './proto_vm.mjs';
import { ROOT, readJson, writeJson, exists, rel } from './_io.mjs';

let pass = 0;
let fail = 0;
const fails = [];
const skipped = [];

function check(name, cond, detail) {
    if (cond) { pass++; return; }
    fail++;
    fails.push(name + (detail ? ' — ' + detail : ''));
}
function skipCheck(name, why, extra) {
    skipped.push(name);
    console.log('[skip] ' + name + '：' + why + ' → 未执行（≠ 通过）');
    if (extra) console.log('       ' + extra);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const num1 = (v) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(1) : String(v);

/* ---------------- 命令行参数（只给 S22 用：抓基线 / 指定基线） ---------------- */
const ARGV = process.argv.slice(2);
const argVal = (name) => {
    const i = ARGV.indexOf(name);
    if (i < 0 || i + 1 >= ARGV.length) return null;
    const v = ARGV[i + 1];
    return v.startsWith('--') ? null : v;
};
/** 显式基线（JSON）；不给就按 DEFAULT_BASES 的顺序找 */
const BASE_ARG = argVal('--baseline');
const WANT_WRITE_BASE = ARGV.includes('--write-win-baseline');
/** S22c 的基线候选：先看本工具抓的快照，再看 levels.json 的手工副本 */
const DEFAULT_BASES = ['tools/_win_baseline_s22.json', 'assets/resources/config/levels.json.bak'];

/** CORE 缺窗口 API 时给出「缺哪个」（实时求值，不许写死文案） */
function coreHookGap(P) {
    const C = (P && P.CORE) || {};
    const miss = [];
    if (typeof C.buildLevel !== 'function') miss.push('CORE.buildLevel 未导出');
    if (typeof C.hitWindow !== 'function') miss.push('CORE.hitWindow 未导出');
    return miss;
}

/** 挑战表逐关实算窗口（seed=0，与 export_levels.mjs 同口径）；S22 与抓基线共用 */
function collectWins(P) {
    const seasonOfD = (d) => (typeof P.seasonOf === 'function' ? P.seasonOf(d) : Math.max(1, Math.ceil((d.id || 1) / 15)));
    return (P.levels || []).map((d) => {
        const hw = P.CORE.hitWindow(P.CORE.buildLevel(d, P.shapes, 0), 0.5, 20);
        return {
            id: d.id,
            shapeId: d.shapeId,
            outlineId: d.outlineId,
            variant: d.variant,
            cycleMs: d.cycleMs,
            turns: d.turns,
            season: seasonOfD(d),
            hit: [hw.earlyMs, hw.lateMs],
        };
    });
}

/* ---------------- 基础会话（挑战 / 催眠各一个） ---------------- */
let chall = null;
let relax = null;
try {
    chall = loadProto({ search: 'mode=challenge&screen=play&lvl=1&press=0.55', storage: {} });
    relax = loadProto({ search: 'mode=relax&screen=play&lvl=1&press=0.55', storage: {} });
} catch (e) {
    check('产物能在 node 里启动（challenge / relax）', false, e && e.message ? e.message : String(e));
}

/* ---------------- --write-win-baseline：抓 S22c 的窗口基线（改表之前跑） ---------------- */
if (WANT_WRITE_BASE) {
    const outPath = path.resolve(ROOT, argVal('--write-win-baseline') || DEFAULT_BASES[0]);
    const gap = chall ? coreHookGap(chall.P) : ['挑战会话没起来（见上面那条失败）'];
    if (gap.length) {
        console.error('[write-win-baseline] 抓不了：' + gap.join('；'));
        console.error('  处置：先 node tools/build_proto.mjs，再确认 core/index.ts 的 Core 对象里有 hitWindow（打包链路不展开 export *）。');
        process.exit(2);
    }
    let rows = null;
    try {
        rows = collectWins(chall.P);
    } catch (e) {
        console.error('[write-win-baseline] 实算窗口抛错：' + ((e && e.message) || e));
        process.exit(2);
    }
    writeJson(outPath, {
        version: 'v0.7-S22',
        precision: 'full',
        note: 'S22c 基线：P2 改 levels.csv 之前抓一次。之后除换形关外，任何一关窗口都不许变（diff = 0）。',
        capturedFrom: 'assets/resources/config/levels.json + assets/scripts/core（seed=0 实算，未四舍五入）',
        levels: rows,
    });
    console.log('[write-win-baseline] 已写出 ' + rel(outPath) + '（' + rows.length + ' 关，全精度）');
    console.log('  下一步：改 01_策划文档/levels.csv → node tools/export_levels.mjs → node tools/modes_check.mjs');
    process.exit(0);
}

if (chall && relax) {
    const C = chall.P;
    const R = relax.P;

    /* ================= M13：计时配置 ================= */
    check('M13 挑战有倒计时（15s）、relax 恒为 null',
        C.app.timeLimitMs === 15000 && R.app.timeLimitMs === null &&
        C.modeCfg().timeLimitMs === 15000 && R.modeCfg().timeLimitMs === null,
        'challenge=' + C.app.timeLimitMs + ' relax=' + R.app.timeLimitMs);

    /* ================= M17：两模式评分完全一致 ================= */
    const rtC = C.CORE.buildLevel(C.levels[0], C.shapes, 4242);
    const pressMs17 = Math.min(rtC.movers[0].cycleMs - 1, rtC.perfectMs + 40);
    const rC = C.CORE.judge(rtC, pressMs17, 0);
    const rR = R.CORE.judge(rtC, pressMs17, 0);
    check('M17 同一 pressMs 两模式 pct/rating/score/pass 完全相同',
        rC.pct === rR.pct && rC.rating === rR.rating && rC.score === rR.score && rC.pass === rR.pass,
        'pct ' + rC.pct.toFixed(3) + '/' + rR.pct.toFixed(3) + ' rating ' + rC.rating + '/' + rR.rating + ' score ' + rC.score + '/' + rR.score);

    /* ================= M18：relax 同规格 ================= */
    const cfgR = R.modeCfg();
    R.startLevel(0);
    R.app.attemptStart = 0;
    R.freeze(R.app.rt.perfectMs);
    R.press(R.now());
    R.freeze(R.now() + 400);
    R.update();
    check('M18 relax 也放评级音、也显示分数/连击、也弹面板；且不画倒计时槽位',
        cfgR.ratingSfx === true && cfgR.showScore === true &&
        !!R.app.fb && R.app.fb.revealed === true && R.app.fb.settled === true &&
        R.timerLeftMs() === null && R.app.timeLimitMs === null,
        'ratingSfx=' + cfgR.ratingSfx + ' showScore=' + cfgR.showScore + ' revealed=' + (R.app.fb && R.app.fb.revealed) +
        ' timerLeft=' + R.timerLeftMs() + ' timeLimit=' + R.app.timeLimitMs);

    /* ================= M14 / M15：超时进结算 + 扣一次机会 ================= */
    C.startLevel(0);
    const attemptsBefore = C.app.attempts;
    C.app.timerStart = C.now() - (C.app.timeLimitMs + 10);
    C.triggerTimeout();
    const fbT = C.app.fb;
    check('M14 超时进结算：fb.timeout=true、rating=fail',
        !!fbT && fbT.timeout === true && fbT.res.rating === 'fail' && C.app.scene === 'feedback',
        'fb=' + JSON.stringify(fbT && { timeout: fbT.timeout, rating: fbT.res && fbT.res.rating }) + ' scene=' + C.app.scene);
    check('M15 超时扣一次机会', C.app.attempts === attemptsBefore - 1, attemptsBefore + '→' + C.app.attempts);

    /* ================= M16：重试后计时回 15000 ================= */
    C.restartLevel();
    C.app.timerStart = C.now();
    const left16 = C.timerLeftMs();
    check('M16 重试后计时回 15000ms', Math.round(left16) === 15000 && C.app.timerStopAt === null, 'left=' + left16);

    /* ================= M19：relax 合格进下一关 + 循环 ================= */
    R.startLevel(0);
    R.app.attemptStart = 0;
    R.freeze(R.app.rt.perfectMs);
    R.press(R.now());
    R.freeze(R.now() + 1500);
    R.update();
    R.update();
    const advanced = R.app.lvl === 1;
    R.startLevel(R.levels.length - 1);
    const roundBefore = R.app.round;
    R.app.attemptStart = 0;
    R.freeze(R.app.rt.perfectMs);
    R.press(R.now());
    R.freeze(R.now() + 1500);
    R.update();
    R.update();
    check('M19 relax 合格进下一关；最后一关后回第 1 关且轮次+1',
        advanced && R.app.lvl === 0 && R.app.round === roundBefore + 1 && R.app.scene === 'play',
        'advanced=' + advanced + ' lvl=' + R.app.lvl + ' round ' + roundBefore + '→' + R.app.round);

    /* ================= M20：挑战通关写 bestScore；relax 不写 =================
       注意：最后一关 L60 是**错拍关**（phase_2=0.4），必须按两次定格才算过关。
       只按一次会停在"还需定格 1 个"（这是 S17 要求的正确行为），永远到不了 showComplete()。 */
    C.startLevel(C.levels.length - 1);
    C.app.totalScore = 4321;
    const bestBefore = C.progress.bestScore || 0;
    C.freeze(0);
    C.app.attemptStart = 0;
    const isDzLast = typeof C.desyncPhase === 'function' && C.desyncPhase(C.app.def) > 0 &&
        typeof C.CORE.judgeNearest === 'function';
    const hitPerfect = (moverIdx) => {
        /* 必须用**换算后的墙钟时刻**（attemptStart 在解冻后已 +400）；
           用"理论 perfectMs"而不换算会把正确实现判成失败（2026-10-18 踩过）。 */
        const at = typeof C.perfectPressClockMs === 'function'
            ? C.perfectPressClockMs(moverIdx)
            : C.app.attemptStart + ((C.app.rt.movers[moverIdx] && C.app.rt.movers[moverIdx].perfectMs) || 0);
        C.freeze(at);
        C.press(C.now());
        C.freeze(C.now() + C.DESYNC_FREEZE_MS);
        C.update();          /* 每次按下都冻结 400ms：到期后解冻或结算 */
    };
    if (isDzLast) { hitPerfect(0); hitPerfect(1); } else { hitPerfect(0); }
    C.freeze(C.now() + 1500);
    C.update();
    C.update();
    const bestAfterChallenge = C.progress.bestScore || 0;
    const sceneAfter = C.app.scene;

    R.startLevel(R.levels.length - 1);
    R.app.totalScore = 9999;
    const bestRelaxBefore = R.progress.bestScore || 0;
    R.app.attemptStart = 0;
    R.freeze(R.app.rt.perfectMs);
    R.press(R.now());
    R.freeze(R.now() + 1500);
    R.update();
    R.update();
    const bestAfterRelax = R.progress.bestScore || 0;

    check('M20 挑战通关写 bestScore；relax 不写',
        bestAfterChallenge >= 4321 && bestRelaxBefore === bestAfterRelax,
        'challenge best ' + bestBefore + '→' + bestAfterChallenge + '（scene=' + sceneAfter + '，最后一关错拍=' + isDzLast + '）' +
        ' | relax best ' + bestRelaxBefore + '→' + bestAfterRelax);
}

/* ---------------- M5 / M6：日夜自适应与手动优先 ---------------- */
let nightRun = null;
let noonRun = null;
let manualRun = null;
try {
    nightRun = loadProto({ search: 'hour=3&screen=home', storage: {} });
    noonRun = loadProto({ search: 'hour=13&screen=home', storage: {} });
    manualRun = loadProto({ search: 'hour=3&scene=minimal&screen=home', storage: {} });
} catch (e) {
    check('M5/M6 场景断言可加载', false, e && e.message ? e.message : String(e));
}
if (nightRun && noonRun && manualRun) {
    check('M5 场景自适应：03:00 → night_station，13:00 → noon_window',
        nightRun.P.autoSceneId() === 'night_station' && noonRun.P.autoSceneId() === 'noon_window',
        'hour3=' + nightRun.P.autoSceneId() + ' hour13=' + noonRun.P.autoSceneId());
    const P = manualRun.P;
    const manual = P.resolveSceneId();
    P.setScenePref('auto');
    const afterAuto = P.resolveSceneId();
    check('M6 手动优先：minimal 覆盖自动；改回 auto 后回到 night_station',
        manual === 'minimal' && afterAuto === 'night_station',
        'manual=' + manual + ' afterAuto=' + afterAuto);
}

/* ---------------- M7：场景不干扰判定 ---------------- */
if (chall) {
    const P = chall.P;
    const rt = P.CORE.buildLevel(P.levels[0], P.shapes, 4242);
    const pressMs7 = Math.min(rt.movers[0].cycleMs - 1, rt.perfectMs + 40);
    const pcts = [];
    for (const id of ['night_station', 'noon_window', 'minimal']) {
        P.app.sceneId = id;
        pcts.push(P.CORE.judge(rt, pressMs7, 0).pct);
    }
    check('M7 场景不干扰判定：三场景下同一 pressMs 的 pct 完全一致',
        pcts[0] === pcts[1] && pcts[1] === pcts[2],
        pcts.map((x) => x.toFixed(6)).join(' / '));
}

/* ---------------- M8：绿框几何静止（只允许发光呼吸） ---------------- */
if (chall) {
    const P = chall.P;
    const rt = P.CORE.buildLevel(P.levels[0], P.shapes, 4242);
    const ptsA = rt.movers[0].targetPts.map((p) => ({ x: p.x, y: p.y }));
    P.app.lvl = 0;
    P.freeze(0);
    const a0 = P.targetBreathAlpha();
    P.freeze(2000);
    const a1 = P.targetBreathAlpha();
    const ptsB = rt.movers[0].targetPts.map((p) => ({ x: p.x, y: p.y }));
    const inRange = (v) => v >= 0.349 && v <= 0.551;
    check('M8 绿框几何静止：呼吸周期内 targetPts 逐点差值 = 0，外发光 α 在 0.35–0.55',
        eq(ptsA, ptsB) && inRange(a0) && inRange(a1) && Math.abs(a0 - a1) > 0.01,
        'ptsEqual=' + eq(ptsA, ptsB) + ' a0=' + a0.toFixed(3) + ' a1=' + a1.toFixed(3));
}

/* ================================================================
 * v0.4 —— S1 / S2 / S3 / S5 / S6
 * ================================================================ */

/* ---------------- S1：60 关结构 ---------------- */
if (chall) {
    const P = chall.P;
    const lv = P.levels;
    const seasons = lv.map((d) => P.seasonOf(d));
    const bad = [];
    if (lv.length !== 60) bad.push('关数=' + lv.length);
    const uniq = [...new Set(seasons)].sort((a, b) => a - b);
    if (!eq(uniq, [1, 2, 3, 4])) bad.push('季集合=' + uniq.join(','));
    if (!eq(seasons, seasons.slice().sort((a, b) => a - b))) bad.push('season 不单调');
    for (let s = 1; s <= 4; s++) {
        const n = seasons.filter((x) => x === s).length;
        if (n !== 15) bad.push('季' + s + '=' + n + '关');
    }
    check('S1 60 关结构：4 季 × 15 关，season 连续无缺口', bad.length === 0, bad.slice(0, 5).join(' | '));
}

/* ---------------- S2：两模式前 15 关逐关镜像 ---------------- */
if (chall) {
    const P = chall.P;
    const ch = P.levels.slice(0, 15);
    const rl = (P.RELAX_LEVELS || []).slice(0, 15);
    const bad = [];
    for (let i = 0; i < 15 && i < ch.length && i < rl.length; i++) {
        const a = ch[i], b = rl[i];
        if (a.shapeId !== b.shapeId) bad.push('L' + (i + 1) + ' 形状 ' + b.shapeId + '≠' + a.shapeId);
        else if ((a.variant || 'single') !== (b.variant || 'single')) bad.push('L' + (i + 1) + ' variant 不同');
        else if (a.path !== b.path) bad.push('L' + (i + 1) + ' 路径 ' + b.path + '≠' + a.path);
    }
    check('S2 两模式前 15 关逐关镜像（shapeId / variant / path 全同）',
        bad.length === 0 && ch.length === 15 && rl.length === 15, bad.slice(0, 5).join(' | '));
}

/* ---------------- S3：催眠矩阵 ---------------- */
if (chall) {
    const P = chall.P;
    const rl = P.RELAX_LEVELS || [];
    const bad = [];
    if (rl.length !== 60) bad.push('催眠关数=' + rl.length);
    const tail = rl.slice(15);
    const count = {};
    const singlePaths = {};
    for (const d of tail) {
        count[d.shapeId] = (count[d.shapeId] || 0) + 1;
        if ((d.variant || 'single') !== 'dual') (singlePaths[d.shapeId] = singlePaths[d.shapeId] || []).push(d.path);
    }
    const ids = Object.keys(count);
    if (ids.length !== 15) bad.push('后45关道具种类=' + ids.length);
    for (const id of ids) {
        if (count[id] !== 3) bad.push('后45关 ' + id + '×' + count[id]);
        const ps = singlePaths[id] || [];
        if (ps.length && new Set(ps).size !== ps.length) bad.push(id + ' 单物体路径重复 ' + ps.join('/'));
    }
    for (let i = 16; i < rl.length; i++) {
        const a = rl[i - 1], b = rl[i];
        if (a.variant === 'dual' || b.variant === 'dual') continue;
        if (b.path === a.path) { bad.push('L' + (i + 1) + ' 与 L' + i + ' 同为单物体且同路径 ' + b.path); break; }
    }
    const duals = rl.filter((d) => d.variant === 'dual');
    if (duals.length !== 11) bad.push('双物体=' + duals.length + '（门槛 11）');
    const dualNonH = duals.filter((d) => d.path !== 'h_line').map((d) => 'L' + d.id + ':' + d.path);
    if (dualNonH.length) bad.push('双物体路径不是 h_line：' + dualNonH.slice(0, 5).join(','));
    check('S3 催眠矩阵：前15关镜像挑战 / 后45关每道具3次 / 单物体路径不重复 / 无双物体邻居撞路径 / 双物体11关且 h_line',
        bad.length === 0,
        (bad.slice(0, 6).join(' | ')) + ' ［诊断：双物体 ' + duals.length + ' 关，id=' + duals.map((d) => d.id).join(',') + '］');
}

/* ---------------- S5：fx.json 外置生效（四季各钉一关） ---------------- */
if (chall) {
    const P = chall.P;
    const fx = P.FX || {};
    const def = P.DEFAULT_FX || {};
    const godFx = fx.rating && fx.rating.god;
    const godDef = def.rating && def.rating.god;
    const differs = !!(godFx && godDef && godFx.ring && godFx.ring.alpha !== godDef.ring.alpha);
    const running = P.ratingFx('god');
    const anchors = [0, 15, 30, 45];   /* L1(季1) / L16(季2) / L31(季3) / L46(季4) */
    const per = [];
    const accents = new Set();
    let allOk = true;
    for (const i of anchors) {
        P.app.def = P.levels[i];
        const s = P.seasonOf(P.app.def);
        const got = (P.ringCfg('god') || { colors: [] }).colors[0];
        const want = P.seasonTintOf(s).accent;
        accents.add(want);
        if (got !== want) allOk = false;
        per.push('L' + (i + 1) + '(季' + s + ')=' + got + (got === want ? '✓' : '✗期望' + want));
    }
    check('S5 fx.json 外置生效：json 值覆盖 DEFAULT_FX，且四季环首色各自对上 seasonTint',
        differs && running.motes === godFx.motes && allOk && accents.size === 4 && fx.schema === 'dista.fx/1',
        'json.god.ring.alpha=' + (godFx && godFx.ring && godFx.ring.alpha) +
        ' def=' + (godDef && godDef.ring && godDef.ring.alpha) +
        ' motes=' + running.motes + ' | ' + per.join('  '));
}

/* ---------------- S6：季主题不影响判定 ---------------- */
if (chall) {
    const P = chall.P;
    const base = P.levels[0];
    const rt6 = P.CORE.buildLevel(base, P.shapes, 777);
    const pressMs6 = Math.min(rt6.movers[0].cycleMs - 1, rt6.perfectMs + 40);
    const out6 = [];
    const ringFirsts = [];
    for (let s = 1; s <= 4; s++) {
        P.app.def = Object.assign({}, base, { season: s });
        const r = P.CORE.judge(rt6, pressMs6, 0);
        out6.push(r.pct + '/' + r.rating + '/' + r.score);
        ringFirsts.push((P.ringCfg('god') || { colors: ['-'] }).colors[0]);
    }
    check('S6 季主题不影响判定：同 pressMs 四季 pct/rating/score 相同，只有环色变',
        new Set(out6).size === 1 && new Set(ringFirsts).size === 4,
        'judge=' + [...new Set(out6)].join(' | ') + '  tint=[' + ringFirsts.join(',') + ']');
}

/* ================================================================
 * v0.5 —— S10 / S11 / S12（机制节奏三条门禁）
 * ================================================================ */
const isMechNode = (d) => /机制/.test(String((d && d.note) || ''));
const RANK_NAME = ['h_line', 'diag', 'arc', 'bounce'];
function pathRank(p) {
    const s = String(p || '');
    if (/^h_line/.test(s)) return 0;
    if (/^diag/.test(s)) return 1;
    if (/^arc/.test(s)) return 2;
    if (/^bounce/.test(s)) return 3;
    return -1;
}

if (chall) {
    const P = chall.P;
    const lv = P.levels || [];
    const seasonOf = (d) => P.seasonOf(d);
    const nodes = lv.filter(isMechNode);

    /* ---- S10：相邻节点 id 差 ≤4、首个 ≤L16、末个 ≥L57、季 2–4 各 ≥4（季 1 豁免） ---- */
    {
        const NAME = 'S10 机制节点间隔 ≤4 关：相邻 id 差 ≤4、首个 ≤L16、末个 ≥L57、季2–4 各 ≥4 个（季1 豁免）';
        const ids = nodes.map((d) => d.id);
        if (!ids.length) {
            check(NAME, false, '全表 0 个机制节点（note 里没有「机制」二字）→ 机制节奏表还没落地');
        } else {
            const bad = [];
            const gaps = [];
            for (let i = 1; i < ids.length; i++) {
                const g = ids[i] - ids[i - 1];
                gaps.push(g);
                if (g > 4) bad.push('L' + ids[i - 1] + '→L' + ids[i] + ' 间隔 ' + g + ' 关（>4）');
            }
            if (ids[0] > 16) bad.push('首个节点 L' + ids[0] + '（应 ≤L16）');
            if (ids[ids.length - 1] < 57) bad.push('末个节点 L' + ids[ids.length - 1] + '（应 ≥L57）');
            const perSeason = [1, 2, 3, 4].map((s) => nodes.filter((d) => seasonOf(d) === s).length);
            for (let s = 2; s <= 4; s++) if (perSeason[s - 1] < 4) bad.push('季' + s + ' 只有 ' + perSeason[s - 1] + ' 个节点（应 ≥4）');
            const summary = '节点 ' + ids.length + ' 个：L' + ids.join(',L') +
                '｜最大间隔 ' + Math.max(...gaps) + ' 关｜每季 ' + perSeason.join('/') +
                '｜季1 豁免（教学季，S8 已锁死其 15 关）';
            check(NAME, bad.length === 0, bad.length ? bad.slice(0, 5).join(' | ') : summary);
        }
    }

    /* ---- S11：机制关 cycleMs ≥ 同季上一关（季首关不比较） ---- */
    {
        const bad = [];
        const rows = [];
        const skip = [];
        for (const d of nodes) {
            const s = seasonOf(d);
            const idx = lv.findIndex((x) => x.id === d.id);
            const prev = idx > 0 ? lv[idx - 1] : null;
            const cyc = Number(d.cycleMs) || 0;
            if (!prev || seasonOf(prev) !== s) { skip.push('L' + d.id + '(季' + s + '首关)'); continue; }
            const pcyc = Number(prev.cycleMs) || 0;
            const ok = cyc >= pcyc;
            rows.push('季' + s + ' L' + d.id + ' cyc=' + cyc + (ok ? ' ≥ ' : ' < ') + 'L' + prev.id + ' cyc=' + pcyc + (ok ? '✓' : '✗'));
            if (!ok) bad.push('季' + s + ' L' + d.id + ' cyc=' + cyc + ' < L' + prev.id + ' cyc=' + pcyc + '（机制关比同季前关更快 ' + (pcyc - cyc) + 'ms）');
        }
        const info = skip.length ? '｜季首关不比较（换赛季提速）：' + skip.join(',') : '';
        check('S11 机制关速度持平：机制节点 cycleMs ≥ 同季上一关 cycleMs（机制换难度，不靠提速）',
            nodes.length > 0 && bad.length === 0,
            (bad.length ? bad.slice(0, 5).join(' | ') : (rows.length ? rows.slice(0, 6).join('｜') : '无机制节点可判')) + info);
    }

    /* ---- S12：每季路径种类 + 季 2–4 曲率渐进（季 1 豁免回滚） ---- */
    {
        const NEED = { 1: 6, 2: 2, 3: 3, 4: 4 };
        const bad = [];
        const rows = [];
        const info = [];
        for (let s = 1; s <= 4; s++) {
            const seq = lv.filter((d) => seasonOf(d) === s);
            const kinds = new Set(seq.map((d) => String(d.path || '')));
            const need = NEED[s] || 0;
            rows.push('季' + s + ' 路径 ' + kinds.size + ' 种' + (kinds.size >= need ? '≥' : '<') + need + (kinds.size >= need ? '✓' : '✗'));
            if (kinds.size < need) bad.push('季' + s + ' 只有 ' + kinds.size + ' 种路径 [' + [...kinds].join(',') + ']，应 ≥' + need);
            if (s === 1) { info.push('季1 豁免曲率回滚（阶梯复习两遍，种类仍需 ≥6）'); continue; }
            let maxRank = -1;
            let lowRun = 0;
            for (const d of seq) {
                const r = pathRank(d.path);
                if (r < 0) { bad.push('L' + d.id + ' 未知路径「' + d.path + '」'); continue; }
                if (r >= maxRank) { maxRank = r; lowRun = 0; }
                else {
                    lowRun++;
                    if (lowRun > 2) {
                        bad.push('季' + s + ' L' + d.id + ' 用 ' + RANK_NAME[r] + '，但此前已有更高曲率（' + RANK_NAME[maxRank] + '）且已连续 ' + lowRun + ' 关低曲率（上限 2）');
                        break;
                    }
                }
            }
        }
        check('S12 路径覆盖：季1≥6/季2≥2/季3≥3/季4≥4，且季2–4 曲率渐进（低曲率不得连续超 2 关；季1 豁免回滚）',
            bad.length === 0,
            (bad.length ? bad.slice(0, 5).join(' | ') : rows.join('｜')) + (info.length ? '｜' + info.join('｜') : ''));
    }
}

/* ================================================================
 * v0.6 —— S17 / S19 / S20（由原型层 desyncSelftest 驱动）+ S21（本文件直接驱动）
 * 未就绪时记入「未执行」，原因**实时求值**；不许写死文案（会把查问题的人带到错误的文件上）。
 * ================================================================ */
if (chall) {
    const P = chall.P;
    const C0 = P.CORE || {};
    const S_NAMES = [
        'S17 错拍关过关条件（只定格 1 个不算过关）',
        'S19 冻结 400ms 不吃窗口（停表 + attemptStart +400）',
        'S20 HUD 点组（错拍 2 点 / 同步不显示）'
    ];
    const missing = [];
    if (typeof C0.judgeNearest !== 'function') {
        missing.push('core 的 judgeNearest 未被 CORE 命名空间导出（index.ts 缺显式 export；build 不展开 export *）');
    }
    const desyncLevels = (P.levels || []).filter((d) => (typeof P.desyncPhase === 'function' ? P.desyncPhase(d) : 0) > 0);
    if (!desyncLevels.length) missing.push('数据里没有 phase_2>0 的错拍关');
    if (typeof P.desyncSelftest !== 'function') missing.push('原型层 desyncSelftest() 未接线');
    const phaseTxt = desyncLevels.length
        ? '数据侧：' + desyncLevels.map((d) => 'L' + d.id + ' phase_2=' + P.desyncPhase(d).toFixed(2)).join(' / ') +
          (desyncLevels.some((d) => d.timeLimitSec) ? '，时限 ' + desyncLevels.filter((d) => d.timeLimitSec).map((d) => d.timeLimitSec + 's').join('/') + ' ✓' : '')
        : '数据侧：未找到 phase_2>0 的关（请确认 levels.csv 的 phase_2 列已写）';

    if (missing.length) {
        const why = missing.join('；') || '未知原因（前置都满足却仍跳过 → 这是 bug，请查）';
        for (const n of S_NAMES) skipCheck(n, why, phaseTxt);
    } else {
        /* ---- S20：HUD 点组 ---- */
        const dz = desyncLevels[0];
        const syncDual = (P.levels || []).find((d) => d.variant === 'dual' && P.desyncPhase(d) === 0);
        P.freeze(0);
        P.startLevel(P.levels.indexOf(dz));
        const dzFrozen = Array.isArray(P.app.frozen) ? P.app.frozen.length : 0;
        const dzIsDesync = P.isDesync() === true;
        let syncOk = true;
        let syncFrozen = '(无对照关)';
        if (syncDual) {
            P.startLevel(P.levels.indexOf(syncDual));
            syncFrozen = P.app.frozen === null ? 'null' : 'array';
            syncOk = (P.app.frozen === null) && (P.isDesync() === false);
        }
        check('S20 HUD 点组：错拍关 frozen 长度 2、isDesync=true；同步关 frozen=null（不画点组）',
            dzFrozen === 2 && dzIsDesync && syncOk,
            '错拍 L' + dz.id + ' frozen=' + dzFrozen + ' isDesync=' + dzIsDesync +
            '｜同步对照 L' + (syncDual ? syncDual.id : '-') + ' frozen=' + syncFrozen);

        /* ---- S17 / S19：desyncSelftest 驱动 ---- */
        const r = P.desyncSelftest();
        check('S17 错拍关过关条件：只定格 1 个时 phase≠result；两个都合格才 pass',
            r.afterFirst.phase !== 'result' && r.afterSecond.phase === 'result' && r.afterSecond.pass === true,
            'afterFirst.phase=' + r.afterFirst.phase + ' afterSecond.phase=' + r.afterSecond.phase +
            ' pass=' + r.afterSecond.pass +
            '｜t2Used=' + r.afterSecond.t2Used + ' perfect0=' + r.afterSecond.perfect0 + ' perfect1=' + r.afterSecond.perfect1 +
            ' worstPct=' + (r.afterSecond.worstPct || 0));
        check('S19 冻结 400ms 不吃窗口：停表（timerElapsed 不变）+ 运动相位 attemptStart 恰 +400',
            r.freeze.timerEqual === true && r.freeze.attemptStartDelta === 400,
            'timerElapsed ' + r.freeze.timerBefore + '→' + r.freeze.timerAfter + '｜attemptStart +' + r.freeze.attemptStartDelta);
    }

    /* ---- S21：本文件直接驱动（不依赖 selftest 的场景构造） ----
       配方（lead 2026-10-18 手驱验证）：第一次卡准 mover0 → 冻结 400ms →
       第二次在 **mover1 完美点 +200ms**（季 4 mover 窗口 ≤±36ms，200ms 必出窗；< cycle(≥1200ms) 不跨周期）。
       为什么不用半周期：h_line + passRate 0.70 下物体在路径另一端仍可能 ≥70% 重合，场景不成立。
       为什么不用 attemptStart+1：那一按常落在起飞段，还没进入可判定状态。
       **跑之前必须清状态**（前面的断言会留下 timeFreeze / attemptStart / fb），否则会得到假绿。 */
    const s21 = { pass: null, pct: null, frozen: null, attemptsDelta: null };
    const s21dbg = {};
    let s21ok = false;
    let s21err = '';
    try {
        P.freeze(0);                      /* ① 清时钟 */
        P.app.fb = null;
        P.app.phase = 'aim';
        const dz21 = (P.levels || []).find((d) => Number(d.phase2 || d.phase_2 || 0) > 0);
        if (dz21 && typeof C0.judgeNearest === 'function' && typeof P.desyncPress === 'function') {
            const idx21 = P.levels.indexOf(dz21);
            P.startRun('challenge', idx21);   /* ② 走真实入口：会重置 attempts/combo/round */
            P.freeze(0);
            P.app.attemptStart = 0;           /* ③ 时钟钉在 0，保证 attemptStart===0 */
            const att0 = P.app.attempts;
            const timingOf = (m) => {
                const mv = P.app.rt.movers[m];
                if (typeof C0.moverTiming === 'function') {
                    const tm = C0.moverTiming(mv);
                    if (tm && isFinite(tm.perfectMs)) return tm.perfectMs;
                }
                return (mv && isFinite(mv.perfectMs)) ? mv.perfectMs : 0;
            };
            const pf0 = timingOf(0);
            const pf1 = timingOf(1);
            const as0 = P.app.attemptStart;
            /* 只定格第一个 mover（模拟"按中一个、另一个还没按"），随后用**超时**制造失败。
               为什么不用"打偏一次"：连续运动的物体在对称路径上，几何重合率与时间差不成单调关系
               （200ms 之外仍可能 ≥passRate），测试场景不可靠。超时是产品里确定性的失败路径，
               且与"任一 mover 不合格"共用同一条 reset 分支。 */
            const t21 = as0 + pf0;
            P.freeze(t21); P.press(t21);
            P.freeze(t21 + 400); P.update(); P.update();
            const frozenAfterFirst = JSON.stringify(P.app.frozen);
            if (typeof P.triggerTimeout === 'function') P.triggerTimeout();
            else throw new Error('缺 triggerTimeout 钩子');
            P.freeze(t21 + 900); P.update(); P.update();
            s21.pass = !!(P.app.fb && P.app.fb.res && P.app.fb.res.pass);
            s21.pct = P.app.fb && P.app.fb.res ? P.app.fb.res.pct : null;
            s21.frozen = P.app.frozen;
            s21.attemptsDelta = att0 - P.app.attempts;
            s21dbg.as0 = as0; s21dbg.pf0 = num1(pf0); s21dbg.pf1 = num1(pf1);
            s21dbg.far = num1(t21 + 400); s21dbg.phase = P.app.phase;
            s21dbg.frozenAfterFirst = frozenAfterFirst;
            s21dbg.reason = P.app.fb ? (P.app.fb.timeout ? 'timeout' : 'judge') : 'none';
            s21ok = s21.pass === false && s21.attemptsDelta === 1 &&
                (s21.frozen === null || (s21.frozen || []).every((v) => !v));
        } else {
            s21err = '缺少 judgeNearest / desyncPress / 错拍关数据';
        }
    } catch (e) { s21err = String((e && e.message) || e); }
    check('S21 失败后两个 mover 全部重置 + 扣一次机会（先证明这次真的失败）', s21ok,
        'pass=' + s21.pass + ' pct=' + (s21.pct == null ? 'n/a' : num1(s21.pct)) +
        ' frozen=' + JSON.stringify(s21.frozen) + ' attemptsDelta=' + s21.attemptsDelta +
        '｜as0=' + s21dbg.as0 + ' pf0=' + s21dbg.pf0 + ' pf1=' + s21dbg.pf1 +
        ' far=' + s21dbg.far + ' phase=' + s21dbg.phase +
        ' 失败路径=' + s21dbg.reason + '｜定格1个后 frozen=' + s21dbg.frozenAfterFirst +
        (s21err ? ' err=' + s21err : ''));
}

/* ================================================================
 * v0.7 —— S22a–d：道具进关（P1 出候选表 → P2 改 CSV → 这里验收）
 * 规格：01_策划文档/20261018_v0.7_道具BGM视觉三线规格.md §2.6
 * 口径与 tools/pick_slots.mjs 完全一致（工具与断言不许各说各话）：
 *   ±窗口 = |hitWindow.lateMs|；k = ±窗口 / 2600（ktable2 的 2 圈口径）；换形 = shapeId + outlineId 同时换
 * D-083：可辨识门槛 = **两条并列 AND**：① 每圈 cycleMs/|turns| ≥ 1000ms（看得清）② ±窗口 ≥ 30ms（打得到）。
 *   两者不等价（实测 L46 窗口 68.5ms 很宽但每圈 567ms），所以工具判两条、S22b 也判两条；
 *   修法也不同：①不过要动周期/圈数（牵速度阶梯），②不过要换更宽的形状或调 passRate。
 * D-082：S22d 的判据是「**每个**候选新道具至少进 1 关」，不是「每季 ≥1 关」，也不是 D-071 的「每季 ≥3 关」。
 *   理由：候选池只有 4 个道具；「每季 3 关」是「每季新增 4 个道具」时代的口径，写一条做不到的断言只有两种结局——
 *   永远红，或被迫放宽。所以按「道具」计数，不按「季」计数。
 * ================================================================ */
if (chall) {
    const P = chall.P;
    const S22_A = 'S22a 新进关道具 100% 落在其所属季 k 带内（k = ±窗口/2600，2 圈口径）';
    const S22_B = 'S22b 新面孔关 ①每圈 ≥ 1000ms 且 ②±窗口 ≥ 30ms、variant=single、id > 15（D-083 两条并列）';
    const S22_C = 'S22c 换形关 |Δ窗口| ≤ 10ms 且落邻居带；其余关窗口逐位不变（基线 diff = 0）';
    const S22_D = 'S22d 每个候选新道具至少进 1 关（D-082）；季 4 按 D-079 豁免';
    const NEW_PROPS = { headphone: 2, saxophone: 3, cactus: 3, dino: 3 };
    const S22_BANDS = { 2: [0.026, 0.046], 3: [0.020, 0.038], 4: [0.020, 0.032] };
    const MIN_WIN_MS = 30;
    const MIN_LAP_MS = 1000;
    const MAX_DELTA_MS = 10;
    const K_CYCLE_MS = 2600;
    const K_TURNS = 2;
    const ADJ_EPS_MS = 0.05;
    const SEASON4_EXEMPT = ['windmill', 'satellite', 'anchor', 'dragon'];

    const gap = coreHookGap(P);
    if (gap.length) {
        for (const n of [S22_A, S22_B, S22_C, S22_D]) {
            skipCheck(n, gap.join('；') + ' → 没法用「游戏同一套几何」判窗口/形状', '处置：node tools/build_proto.mjs 重打包；确认 core/index.ts 的 Core 对象与末尾 export 里都有 hitWindow（打包链路不展开 export *）');
        }
    } else {
        const lv22 = P.levels || [];
        const seasonOfD = (d) => (typeof P.seasonOf === 'function' ? P.seasonOf(d) : Math.max(1, Math.ceil((d.id || 1) / 15)));

        /* ---- 全量窗口一次算完（S22a 的诊断、S22b、S22c 共用；60 关 × 二分 ≈ 秒级） ---- */
        const winAll = new Map();
        const winErr = new Map();
        for (const d of lv22) {
            try {
                const rt = P.CORE.buildLevel(d, P.shapes, 0);
                const hw = P.CORE.hitWindow(rt, 0.5, 20);
                winAll.set(d.id, Math.abs(hw.lateMs));
            } catch (e) {
                winAll.set(d.id, NaN);
                winErr.set(d.id, String((e && e.message) || e));
            }
        }

        /* ---- k 表（只算判据那一列：2 圈 / cycle 2600；模板照抄 _probe/ktable2.mjs） ---- */
        const kBase = (shapeId) => ({
            id: 0, name: 'k-table', shapeId, outlineId: shapeId, variant: 'single',
            motion: '旋转', path: 'h_line', cycleMs: K_CYCLE_MS, turns: K_TURNS,
            jitter: 0, toleranceDeg: 10, passRate: 0.6, star3Rate: 0.94,
            estSec: 4, weight: 1, attempts: 3, note: 'ktable2 口径', speedStage: 1,
            linSpeed: [0, 0], angSpeed: [0, 0],
        });
        const kOf = new Map();
        for (const id of Object.keys(NEW_PROPS)) {
            if (!P.shapes || !P.shapes[id]) {
                kOf.set(id, { ok: false, err: 'shapes.json 里没有 ' + id });
                continue;
            }
            try {
                const hw = P.CORE.hitWindow(P.CORE.buildLevel(kBase(id), P.shapes, 0), 0.5, 20);
                kOf.set(id, { ok: true, k: Math.abs(hw.lateMs) / K_CYCLE_MS });
            } catch (e) {
                kOf.set(id, { ok: false, err: 'k 表建关抛错：' + ((e && e.message) || e) });
            }
        }

        /* ---- 现状：候选道具进关情况 ---- */
        const newFace = lv22.filter((d) => NEW_PROPS[d.shapeId]);
        const dualOnly = {};
        for (const id of Object.keys(NEW_PROPS)) {
            dualOnly[id] = lv22.filter((d) => d.shapeId2 === id).map((d) => d.id);
        }
        const propBrief = () => Object.keys(NEW_PROPS)
            .map((id) => id + ' 主物体 ' + newFace.filter((d) => d.shapeId === id).length + ' 关 / 第二件 ' + dualOnly[id].length + ' 关')
            .join('｜');

        /* ---------------- S22a：k 带 ---------------- */
        if (!newFace.length) {
            skipCheck(S22_A,
                '挑战表里 0 关用候选道具（' + Object.keys(NEW_PROPS).join('/') + ' 都没作 shapeId 出现）→ P2 还没把候选表落进 levels.csv',
                '数据侧：' + propBrief());
        } else {
            const bad = [];
            const rows = [];
            for (const d of newFace) {
                const s = seasonOfD(d);
                const want = NEW_PROPS[d.shapeId];
                const kr = kOf.get(d.shapeId) || { ok: false, err: '未测' };
                const band = S22_BANDS[s] || null;
                if (s !== want) bad.push('L' + d.id + ' ' + d.shapeId + ' 落在季' + s + '（应季' + want + '）');
                if (!kr.ok) { bad.push('L' + d.id + ' ' + d.shapeId + ' k 表：' + kr.err); continue; }
                if (!band) { bad.push('L' + d.id + ' 季' + s + ' 没有 k 带（季 1 不该出现候选道具）'); continue; }
                const inside = kr.k >= band[0] && kr.k <= band[1];
                rows.push('L' + d.id + ' ' + d.shapeId + ' k=' + kr.k.toFixed(4) + (inside ? '∈' : '∉') + '[' + band[0] + ',' + band[1] + ']');
                if (!inside) bad.push('L' + d.id + ' ' + d.shapeId + ' k=' + kr.k.toFixed(4) + ' 不在季' + s + '带 [' + band[0] + ',' + band[1] + ']');
            }
            check(S22_A, bad.length === 0, bad.length ? bad.slice(0, 6).join(' | ') : rows.join('｜'));
        }
        /* 口径说明：全表按「真实窗口 × 圈数 / 周期」折算出的 k 会远大于季带（季带是形状可辨识度口径），
           所以 S22a 只判「本轮新进关的道具」，不判 60 关全部道具 —— 否则这条断言设计上就不可能绿。 */
        {
            const ks = lv22.map((d) => {
                const w = winAll.get(d.id);
                return isFinite(w) && d.cycleMs > 0 && d.turns ? (w * Math.abs(d.turns)) / d.cycleMs : NaN;
            }).filter((x) => isFinite(x));
            if (ks.length) {
                console.log('[info] S22a 口径：全表 ' + ks.length + ' 关按「±窗口×圈数/周期」折算 ∈ [' +
                    Math.min(...ks).toFixed(3) + ', ' + Math.max(...ks).toFixed(3) + ']，本就跨出季带；' +
                    '季带（季2 0.026–0.046 / 季3 0.020–0.038）是 ktable2 的「窗口/周期，2 圈」口径。S22a 只判本轮新进关的道具。');
            }
        }

        /* ---------------- S22b：可辨识 + 单物体 + 非教学关 ---------------- */
        if (!newFace.length) {
            skipCheck(S22_B, '挑战表里 0 关用候选道具 → 没有「新面孔关」可判（P2 未执行）', '数据侧：' + propBrief());
        } else {
            const bad = [];
            const rows = [];
            /* D-083 条件 3①：每圈 = cycleMs / |turns|。与 ②±窗口 并列 AND —— 两者不等价，都要判。 */
            const lapOf = (d) => {
                const t = Math.abs(Number(d.turns) || 0);
                return Number(d.cycleMs) > 0 && t > 0 ? Number(d.cycleMs) / t : NaN;
            };
            for (const d of newFace) {
                const w = winAll.get(d.id);
                const lap = lapOf(d);
                const variant = String(d.variant || 'single');
                if (!(isFinite(lap) && lap + 1e-9 >= MIN_LAP_MS)) bad.push('L' + d.id + ' 每圈 ' + num1(lap) + 'ms < ' + MIN_LAP_MS + 'ms（D-083① 看得清）');
                if (!(isFinite(w) && w + 1e-9 >= MIN_WIN_MS)) bad.push('L' + d.id + ' ±' + num1(w) + 'ms < ' + MIN_WIN_MS + 'ms（D-083② 打得到）' + (winErr.get(d.id) ? '（建关抛错：' + winErr.get(d.id) + '）' : ''));
                if (variant !== 'single') bad.push('L' + d.id + ' variant=' + variant + '（必须 single，D-025 结算口径）');
                if (!(d.id > 15)) bad.push('L' + d.id + ' id ≤ 15（候选道具不许进教学关）');
                rows.push('L' + d.id + ' ' + d.shapeId + ' 每圈' + num1(lap) + 'ms ±' + num1(w) + 'ms ' + variant + ' id' + (d.id > 15 ? '>' : '≤') + '15');
            }
            /* 半新提示：候选道具只在双物体第二件出现过、还没当主物体 → 不算失败，但日志里必须看得见 */
            const half = Object.keys(NEW_PROPS).filter((id) => dualOnly[id].length && !newFace.some((d) => d.shapeId === id));
            check(S22_B, bad.length === 0,
                (bad.length ? bad.slice(0, 6).join(' | ') : rows.join('｜')) +
                (half.length ? '｜半新未进关（历史上只当过双物体第二件）：' + half.map((id) => id + ' L' + dualOnly[id].join(',L')).join('，') : ''));
        }

        /* ---------------- S22c：与基线比窗口（基线必须在 P2 改表之前抓） ---------------- */
        {
            const basePath = BASE_ARG ? path.resolve(ROOT, BASE_ARG) : (DEFAULT_BASES.map((p) => path.resolve(ROOT, p)).find((p) => exists(p)) || null);
            let base = null;
            let baseErr = '';
            let tol = 0.051;
            let precTxt = 'round1 快照';
            if (!basePath) {
                baseErr = '没找到基线：' + DEFAULT_BASES.join(' / ') + ' 都不存在，也没给 --baseline <json>';
            } else if (!exists(basePath)) {
                baseErr = '--baseline 指向的文件不存在：' + rel(basePath);
            } else {
                try {
                    const raw = readJson(basePath);
                    const list = Array.isArray(raw) ? raw : (raw && raw.levels) || [];
                    const norm = [];
                    for (const r of list) {
                        if (!r || typeof r.id !== 'number') continue;
                        const hit = Array.isArray(r.hit) ? r.hit : (r.hitWindow ? [r.hitWindow.earlyMs, r.hitWindow.lateMs] : null);
                        if (!hit) continue;
                        norm.push({ id: r.id, shapeId: typeof r.shapeId === 'string' ? r.shapeId : null, hit });
                    }
                    if (!norm.length) {
                        baseErr = '基线没有可用行（要 { levels: [{ id, shapeId, hit: [早, 晚] }] }）：' + rel(basePath) + ' 有 ' + list.length + ' 行';
                    } else {
                        base = new Map(norm.map((r) => [r.id, r]));
                        if (raw && raw.precision === 'full') { tol = 1e-9; precTxt = '全精度快照'; }
                    }
                } catch (e) {
                    baseErr = '基线读取失败：' + ((e && e.message) || e);
                }
            }
            const baseWinOf = (r) => (Array.isArray(r.hit) ? Math.abs(r.hit[1]) : NaN);
            const baseHasNoShape = base ? Array.from(base.values()).some((r) => !r.shapeId) : false;

            if (!base) {
                skipCheck(S22_C, baseErr, '处置：在 P2 改 levels.csv **之前**跑 node tools/modes_check.mjs --write-win-baseline（默认写 ' + DEFAULT_BASES[0] + '）；抓晚了会把新值当基线，等于没测');
            } else if (baseHasNoShape) {
                skipCheck(S22_C, '基线不含 shapeId（' + rel(basePath) + '）→ 分不出「换形关」和「没动关」，无法判「其余关逐位不变」', '处置：用 --write-win-baseline 重抓，或 --baseline 换成带 shapeId 的 JSON');
            } else {
                const changed = [];
                const unmoved = [];
                let notCovered = 0;
                for (const d of lv22) {
                    const b = base.get(d.id);
                    if (!b) { notCovered++; continue; }
                    const w = winAll.get(d.id);
                    const rec = { d, b, w, bw: baseWinOf(b) };
                    if (String(b.shapeId) !== String(d.shapeId)) changed.push(rec);
                    else unmoved.push(rec);
                }
                const bad = [];
                for (const r of unmoved) {
                    if (!(isFinite(r.w) && isFinite(r.bw) && Math.abs(r.w - r.bw) <= tol)) {
                        bad.push('L' + r.d.id + ' ' + r.d.shapeId + ' 窗口 ' + num1(r.bw) + '→' + num1(r.w) + 'ms（非换形关，diff 必须 = 0）');
                    }
                }
                const changedRows = [];
                for (const r of changed) {
                    const prevWin = winAll.get(r.d.id - 1);
                    const nextWin = winAll.get(r.d.id + 1);
                    const delta = r.w - r.bw;
                    const inBand = isFinite(prevWin) && isFinite(nextWin) && r.w < prevWin - ADJ_EPS_MS && r.w > nextWin + ADJ_EPS_MS;
                    changedRows.push('L' + r.d.id + ' ' + r.b.shapeId + '→' + r.d.shapeId + ' ±' + num1(r.bw) + '→' + num1(r.w) +
                        '（Δ' + (delta >= 0 ? '+' : '') + num1(delta) + 'ms）邻居 L' + (r.d.id - 1) + ' ' + num1(prevWin) + ' / L' + (r.d.id + 1) + ' ' + num1(nextWin) +
                        (inBand ? ' 带内 ✓' : ' 带外 ✗'));
                    if (!(Math.abs(delta) <= MAX_DELTA_MS)) bad.push('L' + r.d.id + ' 换形 Δ=' + (delta >= 0 ? '+' : '') + num1(delta) + 'ms 超过 ' + MAX_DELTA_MS + 'ms');
                    if (!inBand) bad.push('L' + r.d.id + ' 换形后 ±' + num1(r.w) + 'ms 不在邻居带内（需 L' + (r.d.id - 1) + ' ' + num1(prevWin) + ' > x > L' + (r.d.id + 1) + ' ' + num1(nextWin) + '）');
                }
                check(S22_C, bad.length === 0,
                    (bad.length ? bad.slice(0, 6).join(' | ') : (changedRows.length ? changedRows.join('｜') : '换形关 0 关（P2 还没改表，只验了「其余关不变」）')) +
                    '｜基线 ' + rel(basePath) + '（容差 ' + (tol === 1e-9 ? '1e-9' : '0.051ms') + '·' + precTxt + '）' +
                    '｜比对 ' + (changed.length + unmoved.length) + ' 关：换形 ' + changed.length + ' / 未动 ' + unmoved.length +
                    (notCovered ? '｜基线未覆盖 ' + notCovered + ' 关' : ''));
            }
        }

        /* ---------------- S22d：每个候选道具 ≥1 关（D-082）+ 季 4 豁免打印 ---------------- */
        {
            const props = Object.keys(NEW_PROPS).map((id) => ({
                id,
                n: newFace.filter((d) => d.shapeId === id).length,
                levelIds: newFace.filter((d) => d.shapeId === id).map((d) => 'L' + d.id),
            }));
            const missingProps = props.filter((r) => r.n === 0).map((r) => r.id);
            if (!newFace.length) {
                skipCheck(S22_D,
                    '4 个候选道具在挑战表里都是 0 关 → S22d 无从判（P2 未执行）；D-082 要求每个道具 ≥1 关，所以这不是通过',
                    '数据侧：' + propBrief());
            } else {
                check(S22_D, missingProps.length === 0,
                    '进关数：' + props.map((r) => r.id + ' ' + r.n + ' 关' + (r.levelIds.length ? '(' + r.levelIds.join(',') + ')' : '←无槽')).join('｜') +
                    (missingProps.length
                        ? '｜D-082 判据 = 每个候选道具 ≥1 关；缺 ' + missingProps.join('/') + '（被哪条条件挡住：node tools/pick_slots.mjs 的 [排除明细]）'
                        : '｜D-082：4/4 道具各 ≥1 关'));
            }

            /* 季 4 豁免：**必须打印原因**（不许静默跳过）。数据也一起打，方便核对 D-079 的依据。
               D-083 之后「过门槛」= ①每圈 ≥1000ms 且 ②±窗口 ≥30ms，两个数分开打（它们不等价）。 */
            const s4 = lv22.filter((d) => seasonOfD(d) === 4);
            const lapOfS4 = (d) => {
                const t = Math.abs(Number(d.turns) || 0);
                return Number(d.cycleMs) > 0 && t > 0 ? Number(d.cycleMs) / t : NaN;
            };
            const laps = s4.map(lapOfS4).filter((x) => isFinite(x));
            const lapTxt = laps.length ? Math.round(Math.min(...laps)) + '–' + Math.round(Math.max(...laps)) + 'ms' : 'n/a';
            const s4Slow = s4.filter((d) => { const l = lapOfS4(d); return isFinite(l) && l + 1e-9 >= MIN_LAP_MS; });
            const s4Win = s4.filter((d) => isFinite(winAll.get(d.id)) && winAll.get(d.id) + 1e-9 >= MIN_WIN_MS);
            const s4Both = s4.filter((d) => {
                const l = lapOfS4(d);
                const w = winAll.get(d.id);
                return isFinite(l) && l + 1e-9 >= MIN_LAP_MS && isFinite(w) && w + 1e-9 >= MIN_WIN_MS;
            });
            const s4Max = s4.reduce((m, d) => {
                const w = winAll.get(d.id);
                return isFinite(w) && w > m.win ? { id: d.id, win: w } : m;
            }, { id: 0, win: 0 });
            const gateTxt = s4Both.length === 0
                ? '①②同时达标的 0 关（门槛物理不可达）'
                : '①②同时达标的只有 ' + s4Both.length + '/' + s4.length + ' 关（' + s4Both.map((d) => 'L' + d.id).join(',') + '）';
            console.log('[info] S22d 季 4 豁免（D-079）：季 4 每圈 ' + lapTxt + '（D-083 门槛 = ①每圈 ≥ ' + MIN_LAP_MS +
                'ms 且 ②±窗口 ≥ ' + MIN_WIN_MS + 'ms，两条并列），' + gateTxt + ' → ' + SEASON4_EXEMPT.join('/') + ' 进备用池，本轮不进关。');
            console.log('[info] S22d 季 4 数据侧：共 ' + s4.length + ' 关｜①过 ' + s4Slow.length + ' 关｜②过 ' + s4Win.length +
                ' 关' + (s4Win.length ? '（' + s4Win.map((d) => 'L' + d.id + ' ±' + num1(winAll.get(d.id))).join('，') + '）' : '') +
                '｜最大 ±' + num1(s4Max.win) + 'ms @L' + s4Max.id +
                '。过门槛不等于要上道具：D-079 已拍板，改这条先改决策记录，不要在断言里放宽。');
        }
    }
}

/* ---------------- 汇总 ---------------- */

console.log('');
console.log('==== modes_check (v0.3 双模式 + v0.4 四季60关/特效外置 + v0.5 机制节奏 + v0.6 错拍 + v0.7 道具进关) ====');
console.log('断言通过: ' + pass);
console.log('断言失败: ' + fail);
if (skipped.length) {
    console.log('未执行  : ' + skipped.length + ' 条 ← 不是通过：' + skipped.join(' / '));
}
if (fail) {
    console.log('---- 失败明细 ----');
    for (const f of fails) console.log('  X ' + f);
    console.log('RESULT: FAIL (' + fail + ' 项)');
    process.exit(1);
}
const tail = skipped.length ? '，' + skipped.length + ' 条未执行（≠ 通过）' : '';
console.log('RESULT: PASS (M5–M8 + M13–M20 + S1/S2/S3/S5/S6 + S10/S11/S12 + S17/S19/S20/S21 + S22a–d，' + pass + ' 条绿' + tail + ')');
if (skipped.length) {
    console.log('注意：上面这行里的「未执行」= 对应验收的前置还没就绪（错拍：缺 judgeNearest / 数据 / 流程接线；');
    console.log('      道具进关：P2 还没改 levels.csv，或 S22c 的窗口基线没在改表前抓）。不要当成通过。');
}
console.log('');
