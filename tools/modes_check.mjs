/**
 * tools/modes_check.mjs —— 原型层验收断言（v0.3 → v0.9.1，共 42 条 = 39 绿 + 3 未执行）
 *
 * 规格来源：
 *   01_策划文档/20261018_v0.3_双模式改为时间限制.md   → M5–M8 / M13–M20
 *   01_策划文档/20261018_v0.4_四季60关与道具库.md      → S1/S2/S3/S5/S6
 *   01_策划文档/20261018_v0.5_机制节奏.md（决策记录）  → S10/S11/S12
 *   01_策划文档/20261018_v0.6_双物体错拍.md            → S17/S19/S20/S21
 *   01_策划文档/20261018_v0.7_道具BGM视觉三线规格.md   → S22a–d
 *   01_策划文档/20261019_v0.9_道具收集系统.md          → S30–S35
 *   04_项目管理/规格一致性核对_v0.8_v0.9.md            → S36（D-093 第 2 圈）/ S37（D-094 场景双通道）
 *   01_策划文档/20261018_埋点与验收.md §2.2            → S38–S42（v0.9.1 收集体验重做 D-103~D-107）
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
 *   S19 冻结（DESYNC_FREEZE_MS，D-128b 起 200ms）不吃窗口：timerElapsed 不变 + attemptStart 恰 +该常量
 *   S20 HUD 点组：错拍关 frozen 长度 2 / 同步关 frozen=null
 *   S21 失败后两个 mover 全部重置 + 扣一次机会（先证明这次真的失败）
 *   S22a 新进关道具 100% 落在其所属季 k 带内（k = ±窗口 / 2600，ktable2 的 2 圈口径）
 *   S22b 新面孔关 ①每圈 ≥ 1000ms 且 ②±窗口 ≥ 30ms、variant=single、id > 15（D-083：两条并列 AND）
 *   S22c 换形关 |Δ窗口| ≤ 10ms 且落在邻居带内；**除换形关外其余关窗口逐位不变**（基线 diff = 0）
 *   S22d 每个候选新道具**至少进 1 关**（D-082），季 4 按 D-079 豁免但必须打印原因
 *   S30 解锁门槛：主线 21 / 稀有 15；未通关 0；通关 L1 点亮 1；通关 L5 = 前 5 关去重数；
 *       thresholds[i] 点亮 rare[i] 且低 1 次不点亮；godTotal=31 满 15、≥31 不再增（期望从 levels.json 独立重算）
 *   S31 收集进度不污染核心：0 点亮 vs 36 点亮两个会话，同 pressMs 的 pct/rating/score/pass/stars 逐位相等；
 *       会话内先调 collectionState/openGallery 再判一次仍相等
 *   S32 助眠零收集：无图鉴入口、openGallery 返回 false 且仍在 play、无 collect_* 事件、
 *       第 1 圈 60 关 shapeId 与原表逐关相同、第 2 圈池去重 = 36
 *   S33 关卡表零改动：磁盘 levels.json 与 P.levels 的 (id,shapeId,outlineId,cycleMs,turns,path) 指纹逐项相等；
 *       调收集/图鉴/轮换前后产物指纹不变；磁盘文件字节与 mtime 未变
 *   S34 阈值单调：长度 15 / 严格递增 / 全正整数 / 末档 ∈ 顶级实测 31.9±10%（28.71–35.09）/ ≤40 / rare 池 15
 *   S35 无每日任务：game.js 与产物 bundle 都不含禁词；rules.dailyTasks === false
 *   S36 助眠第 2 圈：三场景各 60 关、去重 36、shapeId==outlineId、非 shape 字段逐关等于原表、
 *       顺序按 collection.json 的 orders 独立重算（撞 shapeId2 顺延）；第 1 圈仍为原表
 *   S37 场景双通道：override 不写 pref、覆盖优先于 pref（D-099：override > pref > 自动）、非法 id → null、
 *       关卡结束清空（getter 与 app.sceneOverride 都回 null）；
 *       ?cardScene= 会话不写 dista.scene、?scene= 会话仍写 pref；两参数同时带 = 渲染听卡片、pref 听链接
 *   S38 图鉴入口可点中：首页胶囊中心/下偏 10px 都进图鉴；远离入口仍开局；结算入口静止与滑入中视觉位置都进图鉴；
 *       面板下方不误触；relax 无入口
 *   S39 收集反馈：首通 L1 神级 → 解锁卡含 cup_tumbler+banana；已通 L1 后 L2 神级只含 duck；无新增不画卡且
 *       newIds 空；relax 零反馈；unlocks 不重复且单次结算 ≤2 件（绘制 slice(0,2) 不许静默丢件）；
 *       unlock_card_shown 的 count === ids.length；神级停留 1800 / 其它 1000
 *   S40 入口全程可达：首页卡片/局内图标/结算按钮/通关页卡片各一次点击进图鉴（点击点从 LIVE 常量算，不写死坐标）｜
 *       relax 图标不画且点它在场位置不会进图鉴｜四个热区高度 ≥88
 *   S41 图鉴欣赏：4×3 每页 12 件 × 3 页覆盖 36｜左右翻页 0→1→0｜首/末页越界点击无效（不循环）｜
 *       点格进 240px 详情｜锁定不泄露名字｜返回保留页｜NEW 看过即消且落盘
 *   S42 布局不重叠：4×3 末行底 < 翻页键 y｜同排格不横叠｜详情 240px 在屏内且名字离剪影 ≥40px｜
 *       解锁卡底 < 面板顶｜首页/局内/通关页三处入口不越界（全部读 LIVE 常量）
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
import fs from 'node:fs';
import { loadProto, HTML_PATH } from './proto_vm.mjs';
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
/**
 * v0.9 专用：绿了也把同一份 detail 打进日志（check 只在失败时带 detail）。
 * 目的：验收时不用另跑一次探针脚本才能看到「关/数值/期望值」这些关键数字。
 */
function checkWithDetail(name, cond, detail) {
    check(name, cond, detail);
    if (cond) {
        const sid = (name.match(/^(S\d+)/) || [])[1] || name;
        console.log('[ok] ' + sid + ' ' + detail);
    }
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
    R.freeze(R.now() + 2200); /* D-105：神级停留 1800 + 面板 260，再用 140ms 余量 */
    R.update();
    R.update();
    const advanced = R.app.lvl === 1;
    R.startLevel(R.levels.length - 1);
    const roundBefore = R.app.round;
    R.app.attemptStart = 0;
    R.freeze(R.app.rt.perfectMs);
    R.press(R.now());
    R.freeze(R.now() + 2200);
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
        C.update();          /* 每次按下都冻结 DESYNC_FREEZE_MS：到期后解冻或结算 */
    };
    if (isDzLast) { hitPerfect(0); hitPerfect(1); } else { hitPerfect(0); }
    C.freeze(C.now() + 2200); /* D-105：神级停留 1800 + 面板 260，再用 140ms 余量 */
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
    R.freeze(R.now() + 2200);
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
        'S19 错拍第一次点击只定格不出评级、时间轴不停（D-134）',
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
        /* ---- S19（D-134 改写）：第一次点击 = 真定格（物体停住）但**不出评级**、时间轴不停；
               第二次点击才结算评级。旧口径「冻结 N ms 后解冻 + 时间轴推后 N ms」已废弃。 ---- */
        {
            const hz = loadProto({ search: 'mode=challenge&start=' + dz.id, storage: {} });
            const Z = hz.P;
            Z.startLevel(P.levels.indexOf(dz));
            const zt1 = Z.perfectPressClockMs(0);
            Z.freeze(zt1); Z.press(zt1);
            const firstOk = (Z.app.scene === 'play') && (Z.app.fb === null) &&
                (JSON.stringify(Z.app.frozen) === '[true,false]') &&
                !!(Z.app.frozenPose && Z.app.frozenPose[0]);
            const att0 = Z.app.attemptStart;
            /* 「时间轴不停」的判据：**没被定格的那件物体此刻仍在动** */
            const mvA = Z.app.rt.movers[0], mvB = Z.app.rt.movers[1];
            const b0 = Z.CORE.poseAt(mvB, zt1);
            const b1 = Z.CORE.poseAt(mvB, zt1 + 400);
            const timeMoved = Math.hypot(b1.x - b0.x, b1.y - b0.y) > 5;
            /* 「定格的是它那一刻」的判据：存的姿态 == 按下时刻的姿态 */
            const a0 = Z.CORE.poseAt(mvA, zt1);
            const fp = Z.app.frozenPose && Z.app.frozenPose[0];
            const poseFixed = !!fp && Math.abs(fp.x - a0.x) < 1e-6 && Math.abs(fp.rotDeg - a0.rotDeg) < 1e-6;
            Z.freeze(zt1 + 400); Z.update();
            const att1 = Z.app.attemptStart;
            const noPause = Math.abs(att1 - att0) < 1e-6;               /* 运动相位没有被推后 */
            const zt2 = Z.perfectPressClockMs(1);
            Z.freeze(zt2); Z.press(zt2);
            const secondOk = (Z.app.scene === 'feedback') &&
                (JSON.stringify(Z.app.frozen) === '[true,true]');
            check('S19 错拍：第一次点击只定格（物体停住）+ 不出评级 + 时间轴不停；第二次才结算',
                firstOk && timeMoved && poseFixed && noPause && secondOk,
                'firstOk=' + firstOk + '｜未定格物体在动=' + timeMoved + '｜定格姿态固定=' + poseFixed +
                '｜attemptStart ' + Math.round(att0) + '→' + Math.round(att1) + '（应不变）｜secondOk=' + secondOk);
        }
    }

    /* ---- S44（D-131）错拍关连击保护 ----
       场景 A：第一次定格后 60ms 连点 → 必须被忽略（judged 不变、attempts 不变）
       场景 B：间隔 ≥ 保护值后再按（真实第二按 ~600ms）→ 必须正常定格（judged=2）
       用独立实例 `?start=50` 驱动（`?screen=play` 是冻结分支，不能用来驱动）。 */
    {
        const G = P.DESYNC_MIN_SECOND_MS;
        const dz = loadProto({ search: 'mode=challenge&start=50', storage: {} });
        const D = dz.P;
        const drv = (t) => { D.freeze(t); D.press(t); };
        let okA = false, okB = false, detA = '保护值缺失', detB = '保护值缺失';
        if (G > 0 && D.isDesync && D.isDesync()) {
            D.startLevel(49);
            const t1 = D.perfectPressClockMs(0);
            drv(t1);
            const j1 = (D.app.desyncJudged || []).length;
            const a1 = D.app.attempts;
            drv(t1 + 60);
            const j2 = (D.app.desyncJudged || []).length;
            okA = (j1 === 1) && (j2 === 1) && (D.app.attempts === a1);
            detA = '连点 60ms 后 judged ' + j1 + '→' + j2 + '，attempts ' + a1 + '→' + D.app.attempts;

            D.startLevel(49);
            const b1 = D.perfectPressClockMs(0);
            drv(b1);
            D.freeze(b1 + G + 10); D.update();
            drv(b1 + 600);
            okB = (D.app.desyncJudged || []).length === 2;
            detB = '间隔 600ms 后 judged=' + (D.app.desyncJudged || []).length;
        }
        check('S44 错拍关连击保护：两次定格间隔 < DESYNC_MIN_SECOND_MS 的按下被忽略（不判定、不扣机会）',
            okA && okB,
            '保护值 ' + G + 'ms｜A: ' + detA + '｜B: ' + detB);
    }

    /* ---- S45（D-136）失败重试后：错拍状态必须重建（frozen 长度 = mover 数） ----
       回归用例：曾因 beginAttempt 把 frozen 清成 null → 第一次按下让数组长度变 1 →
       desyncAllFrozen() 误判"都定住了" → 点一次就结算（用户报的 bug）。 */
    {
        const hz = loadProto({ search: 'mode=challenge&start=50', storage: {} });
        const Z = hz.P;
        const drv = (t) => { Z.freeze(t); Z.press(t); };
        const step = (ms) => { const t0 = Z.now(); for (let t = t0; t <= t0 + ms; t += 16) { Z.freeze(t); Z.update(); } };
        /* 第 1 轮：打歪 → fail → 自动重试 */
        const badT = Z.perfectPressClockMs(0) + 300;
        drv(badT); drv(badT + 600); step(2500);
        const rebuilt = Array.isArray(Z.app.frozen) && Z.app.frozen.length === 2 && Z.app.frozen.every((v) => v === false);
        /* 第 2 轮：第一下只定格一个、不结算 */
        const t1 = Z.perfectPressClockMs(0);
        drv(t1);
        const oneOnly = Z.app.scene === 'play' && Z.app.fb === null && JSON.stringify(Z.app.frozen) === '[true,false]';
        /* 连点仍被拦 */
        const j1 = (Z.app.desyncJudged || []).length;
        drv(t1 + 60);
        const j2 = (Z.app.desyncJudged || []).length;
        const guardOk = (j1 === 1) && (j2 === 1);
        check('S45 失败重试后错拍状态重建：第一下只定格一个不结算 + 连击仍被拦',
            rebuilt && oneOnly && guardOk,
            'frozen 重建=' + rebuilt + '（' + JSON.stringify(Z.app.frozen) + '）｜第一下只定格=' + oneOnly +
            '｜连点 judged ' + j1 + '→' + j2);
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

/* ================================================================
 * v0.9 —— S30–S37：道具收集（mock 图鉴）/ 助眠第 2 圈 36 池 / 场景双通道
 * 规格：01_策划文档/20261019_v0.9_道具收集系统.md §7（S30–S35）
 *       04_项目管理/规格一致性核对_v0.8_v0.9.md（D-093 第 2 圈 / D-094 场景双通道 / D-095 口径 / D-096 阈值）
 *
 * 纪律（与 S22 相同，且更严）：期望值**一律从磁盘配置独立重算**（levels.json / levels_relax.json /
 * collection.json），绝不调被测函数自证——用 collectionState() 算出期望再拿它比对，等于自己证明自己。
 * 构建产物若明显是旧的（COLLECTION 为空），一律 [skip] + 原因，不许写成通过。
 * ================================================================ */

/** 只读的磁盘配置（断言绝不许写这些文件；S33 会盯住 levels.json 的字节与 mtime） */
const DISK_LEVELS = path.resolve(ROOT, 'assets/resources/config/levels.json');
const DISK_RELAX = path.resolve(ROOT, 'assets/resources/config/levels_relax.json');
const DISK_COLLECTION = path.resolve(ROOT, 'assets/resources/config/collection.json');
const SRC_GAME = path.resolve(ROOT, '原型/_src/game.js');

/** 读盘：一次拿到 JSON / 原始文本 / mtime（失败不抛，交给调用方决定 skip 还是 fail） */
function readDiskConfig(p) {
    try {
        return {
            ok: true,
            data: readJson(p),
            text: fs.readFileSync(p, 'utf8'),
            mtimeMs: fs.statSync(p).mtimeMs,
            bytes: fs.statSync(p).size,
        };
    } catch (e) {
        return { ok: false, err: rel(p) + ' 读取失败：' + ((e && e.message) || e) };
    }
}

/** 关卡指纹：收集系统只允许改「图鉴怎么算」，不许碰这 6 列分毫（S33 的判据就是它） */
function lvlFingerprint(list) {
    return (list || []).map((d) => ({
        id: d.id, shapeId: d.shapeId, outlineId: d.outlineId,
        cycleMs: d.cycleMs, turns: d.turns, path: d.path,
    }));
}

/** 逐位比较两份指纹，返回第一处差异的描述（null = 完全相同） */
function firstFpDiff(a, b) {
    if (a.length !== b.length) return '关数 ' + a.length + ' vs ' + b.length;
    for (let i = 0; i < a.length; i++) {
        for (const k of ['id', 'shapeId', 'outlineId', 'cycleMs', 'turns', 'path']) {
            if (JSON.stringify(a[i][k]) !== JSON.stringify(b[i][k])) {
                return 'L' + (a[i].id || i + 1) + ' 的 ' + k + '：' + JSON.stringify(a[i][k]) + ' vs ' + JSON.stringify(b[i][k]);
            }
        }
    }
    return null;
}

/* ---------------- S30：解锁门槛（期望从 levels.json 独立重算） ---------------- */
{
    const NAME = 'S30 解锁门槛：主线池 21 / 稀有池 15｜未通关点亮 0｜通关 L1 点亮 1 且含 cup_tumbler｜通关 L5 = 前 5 关去重 shapeId｜thresholds[i] 点亮 rare[i]、低 1 次不点亮｜godTotal=31 满 15 且 ≥31 不再增';
    const P30 = chall ? chall.P : null;
    const diskLv30 = readDiskConfig(DISK_LEVELS);
    const coll30 = (P30 && P30.COLLECTION) ? P30.COLLECTION : null;
    const gap30 = [];
    if (!P30) gap30.push('挑战会话没起来（见上面那条失败）');
    if (!coll30 || !(coll30.thresholds || []).length || !(coll30.pools && (coll30.pools.mainline || []).length)) {
        gap30.push('构建产物里 COLLECTION 为空（CFG.collection 没进 bundle，collection.json 未打包）');
    }
    if (!diskLv30.ok) gap30.push(diskLv30.err);
    if (gap30.length) {
        skipCheck(NAME, gap30.join('；') + ' → 没法从配置独立重算期望值', '处置：node tools/build_proto.mjs 重打包（collection.json 必须进产物）；本项未执行 ≠ 通过');
    } else {
        const diskList30 = Array.isArray(diskLv30.data) ? diskLv30.data : (diskLv30.data.levels || []);
        const diskMainSet = [...new Set(diskList30.map((d) => d.shapeId))].sort();
        const first5 = [...new Set(diskList30.slice(0, 5).map((d) => d.shapeId))].sort();
        const T = coll30.thresholds;
        const rare = coll30.pools.rare || [];
        const main = coll30.pools.mainline || [];
        const st = (src) => P30.collectionState(src);
        const s0 = st({ cleared: 0, godTotal: 0 });
        const s1 = st({ cleared: 1, godTotal: 0 });
        const s5 = st({ cleared: 5, godTotal: 0 });
        const bad30 = [];

        if (main.length !== 21) bad30.push('主线池 ' + main.length + ' 个（应 21）');
        if (rare.length !== 15) bad30.push('稀有池 ' + rare.length + ' 个（应 15）');
        if (JSON.stringify(main.slice().sort()) !== JSON.stringify(diskMainSet)) {
            bad30.push('主线池 ≠ levels.json 60 关主物体去重集合（' + main.length + ' vs ' + diskMainSet.length + '）');
        }
        const overlap = rare.filter((id) => diskMainSet.indexOf(id) >= 0);
        if (overlap.length) bad30.push('稀有池混进了主线道具：' + overlap.slice(0, 5).join(','));
        if (s0.unlockedCount !== 0) bad30.push('cleared=0/godTotal=0 点亮 ' + s0.unlockedCount + ' 个（应 0）');
        const l1 = diskList30[0] && diskList30[0].shapeId;
        if (s1.unlockedCount !== 1) bad30.push('cleared=1 点亮 ' + s1.unlockedCount + ' 个（应 1）');
        if (s1.map[l1] !== 'main') bad30.push('cleared=1 没点亮 ' + l1 + '（map=' + JSON.stringify(s1.map) + '）');
        if (s1.map.cup_tumbler !== 'main') bad30.push('cleared=1 没点亮 cup_tumbler');
        const s5keys = Object.keys(s5.map).sort();
        if (s5.unlockedCount !== first5.length || JSON.stringify(s5keys) !== JSON.stringify(first5)) {
            bad30.push('cleared=5 点亮 ' + s5.unlockedCount + ' 个（应 = 前 5 关去重 ' + first5.length + ' 个：' + first5.join('/') + '；实测 ' + s5keys.join('/') + '）');
        }
        /* 阈值逐档边界：godTotal=thresholds[i] → rare[i] 亮、**下一档**不许亮；
           godTotal=thresholds[i]-1 → rare[i] 也不许亮（阈值必须真的生效） */
        const bounds = [];
        for (let i = 0; i < T.length && i < rare.length; i++) {
            const at = st({ cleared: 0, godTotal: T[i] });
            const below = st({ cleared: 0, godTotal: T[i] - 1 });
            const lit = at.map[rare[i]] === 'rare';
            const nextDark = (i + 1 >= rare.length) ? true : (at.map[rare[i + 1]] !== 'rare');
            const belowDark = below.map[rare[i]] !== 'rare';
            if (!lit) bad30.push('godTotal=' + T[i] + ' 时 rare[' + i + ']=' + rare[i] + ' 没点亮');
            if (!nextDark) bad30.push('godTotal=' + T[i] + ' 时下一档 rare[' + (i + 1) + ']=' + rare[i + 1] + ' 越档点亮');
            if (!belowDark) bad30.push('godTotal=' + (T[i] - 1) + '（=' + T[i] + '-1）时 rare[' + i + ']=' + rare[i] + ' 已点亮（阈值不生效）');
            bounds.push('i' + i + ':≥' + T[i] + (lit ? '✓' : '✗') + '/<' + T[i] + (belowDark ? '✓' : '✗'));
        }
        const s31 = st({ cleared: 0, godTotal: 31 });
        const s999 = st({ cleared: 0, godTotal: 999 });
        if (s31.rareCount !== 15) bad30.push('godTotal=31 稀有点亮 ' + s31.rareCount + ' 个（应 15）');
        if (s999.rareCount !== rare.length || s999.unlockedCount !== s999.rareCount) {
            bad30.push('godTotal=999 稀有点亮 ' + s999.rareCount + ' 个 / 总点亮 ' + s999.unlockedCount + '（应停在 ' + rare.length + '，不再增加）');
        }
        checkWithDetail(NAME, bad30.length === 0,
            (bad30.length ? bad30.slice(0, 6).join(' | ') + '｜' : '') +
            '池 ' + main.length + '/21·' + rare.length + '/15' +
            '｜未通关 ' + s0.unlockedCount +
            '｜cleared=1→' + s1.unlockedCount + '（' + l1 + (s1.map[l1] ? '✓' : '✗') + '）' +
            '｜cleared=5→' + s5.unlockedCount + '（前 5 关去重 ' + first5.length + '：' + first5.join('/') + '）' +
            '｜godTotal=31→' + s31.rareCount + '｜999→' + s999.rareCount +
            '｜阈值边界 ' + bounds.length + ' 档：' + bounds.join(' '));
    }
}

/* ---------------- S31：收集进度不污染核心判定（两个对照会话） ---------------- */
{
    const NAME = 'S31 不污染核心：图鉴 0 点亮 vs 36 点亮两个会话，同 pressMs 的 pct/rating/score/pass/stars 逐位相等；会话内先调 collectionState/openGallery 再判一次仍相等';
    const SEARCH31 = 'mode=challenge&screen=play&lvl=5&press=0.55';
    const STORE_A = { 'dista.progress': JSON.stringify({ unlocked: 1, cleared: 0, godTotal: 0 }) };
    const STORE_B = { 'dista.progress': JSON.stringify({ unlocked: 60, cleared: 60, godTotal: 31 }) };
    const diskLv31 = readDiskConfig(DISK_LEVELS);
    const diskCol31 = readDiskConfig(DISK_COLLECTION);
    let sA31 = null;
    let sB31 = null;
    let err31 = '';
    try {
        sA31 = loadProto({ search: SEARCH31, storage: STORE_A });
        sB31 = loadProto({ search: SEARCH31, storage: STORE_B });
    } catch (e) { err31 = String((e && e.message) || e); }
    const coll31 = (sA31 && sA31.P && sA31.P.COLLECTION) ? sA31.P.COLLECTION : null;
    if (!sA31 || !sB31) {
        checkWithDetail(NAME, false, '两个对照会话没起来：' + err31);
    } else if (!coll31 || !(coll31.thresholds || []).length) {
        skipCheck(NAME, '构建产物里 COLLECTION 为空（CFG.collection 没进 bundle）→ 造不出「图鉴进度不同」的两个对照会话',
            '处置：node tools/build_proto.mjs 重打包；本项未执行 ≠ 通过');
    } else if (!diskLv31.ok || !diskCol31.ok) {
        skipCheck(NAME, (!diskLv31.ok ? diskLv31.err : diskCol31.err) + ' → 算不出「36 点亮」这个期望值',
            '处置：确认 levels.json / collection.json 可读；本项未执行 ≠ 通过');
    } else {
        const PA31 = sA31.P;
        const PB31 = sB31.P;
        const diskLvList31 = Array.isArray(diskLv31.data) ? diskLv31.data : (diskLv31.data.levels || []);
        const diskMainN31 = new Set(diskLvList31.map((d) => d.shapeId)).size;
        const diskRareN31 = ((diskCol31.data.pools && diskCol31.data.pools.rare) || []).length;
        const wantB31 = diskMainN31 + diskRareN31;
        const collA0 = PA31.collectionState();
        const collB0 = PB31.collectionState();

        /* 判一次：同参数、同关卡、同按下时刻。boot 已把 attemptStart=0 / timeFreeze=cycle×0.55 钉好。 */
        const grab31 = (P) => {
            const fb = P.app.fb;
            return (fb && fb.res)
                ? { pct: fb.res.pct, rating: fb.res.rating, score: fb.res.score, pass: fb.res.pass, stars: fb.stars }
                : null;
        };
        const judgeBoot31 = (P) => {
            const t = P.now();
            P.press(t);
            P.freeze(t + 900);
            P.update();
            P.update();
            return grab31(P);
        };
        const judgeRestart31 = (P) => {
            const cyc = (P.app.def && P.app.def.cycleMs) || 0;
            P.startLevel(4);                 /* 与 ?lvl=5 同一关 */
            P.freeze(0);
            P.app.attemptStart = 0;
            P.freeze(cyc * 0.55);            /* 与 &press=0.55 同一按下时刻 */
            P.press(P.now());
            P.freeze(P.now() + 900);
            P.update();
            P.update();
            return grab31(P);
        };
        const sig31 = (r) => (r ? JSON.stringify([r.pct, r.rating, r.score, r.pass, r.stars]) : 'null');

        const A1 = judgeBoot31(PA31);
        const B1 = judgeBoot31(PB31);
        /* 会话内先摸一遍收集系统（状态是纯函数，openGallery 只切画面），再判一次 */
        const csA31 = PA31.collectionState({ cleared: 12, godTotal: 20 });
        const ogA31 = PA31.openGallery('home');
        const galSceneA31 = PA31.app.scene;
        const csB31 = PB31.collectionState({ cleared: 12, godTotal: 20 });
        const ogB31 = PB31.openGallery('home');
        const galSceneB31 = PB31.app.scene;
        PA31.closeGallery();
        PB31.closeGallery();
        const A2 = judgeRestart31(PA31);
        const B2 = judgeRestart31(PB31);

        const bad31 = [];
        if (!A1 || !B1) bad31.push('第一次判定没出结果（A=' + sig31(A1) + ' B=' + sig31(B1) + '）');
        if (!A2 || !B2) bad31.push('第二次判定没出结果（A=' + sig31(A2) + ' B=' + sig31(B2) + '）');
        if (sig31(A1) !== sig31(B1)) bad31.push('判前 A≠B：' + sig31(A1) + ' vs ' + sig31(B1));
        if (sig31(A2) !== sig31(B2)) bad31.push('调 collectionState/openGallery 后 A≠B：' + sig31(A2) + ' vs ' + sig31(B2));
        /* 空转保护：两个会话的图鉴进度必须真的不同，否则这条断言什么都没证明 */
        if (!(collA0.unlockedCount === 0)) bad31.push('对照会话 A 的点亮数 ' + collA0.unlockedCount + '（合成存档 cleared=0/godTotal=0 应 0）');
        if (!(collB0.unlockedCount === wantB31)) bad31.push('对照会话 B 的点亮数 ' + collB0.unlockedCount + '（合成存档 cleared=60/godTotal=31 应 ' + wantB31 + ' = 主线 ' + diskMainN31 + ' + 稀有 ' + diskRareN31 + '）');
        if (wantB31 !== 36) bad31.push('磁盘期望点亮数 ' + wantB31 + '（应 36 = 主线 21 + 稀有 15）');
        const show31 = (r) => (r ? 'pct ' + num1(r.pct) + ' ' + r.rating + ' score ' + r.score + ' pass=' + r.pass + ' stars=' + r.stars : 'null');
        checkWithDetail(NAME, bad31.length === 0,
            (bad31.length ? bad31.slice(0, 5).join(' | ') + '｜' : '') +
            '先判 A[' + show31(A1) + '] B[' + show31(B1) + ']' +
            '｜调 collectionState（合成档 cleared=12/godTotal=20 → 点亮 ' + csA31.unlockedCount + '/' + csB31.unlockedCount + '）+openGallery（返回 ' + ogA31 + '/' + ogB31 + '，进图鉴后 scene=' + galSceneA31 + '/' + galSceneB31 + '）再判 A[' + show31(A2) + '] B[' + show31(B2) + ']' +
            '｜图鉴进度对照 A=' + collA0.unlockedCount + ' / B=' + collB0.unlockedCount + '（两次判定脚本完全相同，score 从 ' + (A1 && A1.score) + '→' + (A2 && A2.score) + ' 是连击 +1，两边同步）');
    }
}

/* ---------------- S32：助眠零收集（硬条款） ---------------- */
{
    const NAME = 'S32 助眠零收集：galleryEntryVisible=false｜openGallery 返回 false 且仍在 play｜无 collect_* 事件｜第 1 圈 60 关 shapeId 与原表逐关相同｜第 2 圈池去重 36';
    const diskRelax32 = readDiskConfig(DISK_RELAX);
    const diskCol32 = readDiskConfig(DISK_COLLECTION);
    let run32 = null;
    let err32 = '';
    try { run32 = loadProto({ search: 'mode=relax&screen=play&lvl=1&press=0.55', storage: {} }); } catch (e) { err32 = String((e && e.message) || e); }
    if (!run32) {
        checkWithDetail(NAME, false, '助眠会话没起来：' + err32);
    } else if (!diskRelax32.ok || !diskCol32.ok) {
        skipCheck(NAME, (!diskRelax32.ok ? diskRelax32.err : diskCol32.err) + ' → 拿不到「原表」与「36 池」的独立期望值',
            '处置：确认 levels_relax.json / collection.json 可读；本项未执行 ≠ 通过');
    } else {
        const P32 = run32.P;
        const rl32 = P32.RELAX_LEVELS || [];
        const diskRL32 = diskRelax32.data.levels || [];
        const COL32 = diskCol32.data;
        const orders32 = (COL32.relaxCycle2 && COL32.relaxCycle2.orders) || {};
        const wantPool32 = (COL32.order || []).length;
        const bad32 = [];

        if (P32.isRelax() !== true || P32.app.mode !== 'relax') bad32.push('会话不是 relax（mode=' + P32.app.mode + ' isRelax=' + P32.isRelax() + '）');
        const vis32 = P32.galleryEntryVisible();
        if (vis32 !== false) bad32.push('galleryEntryVisible()=' + vis32 + '（应 false）');
        const sceneBefore32 = P32.app.scene;
        const ogRet32 = P32.openGallery('home');
        const sceneAfter32 = P32.app.scene;
        if (ogRet32 !== false) bad32.push('openGallery("home") 返回 ' + ogRet32 + '（应 false）');
        if (sceneAfter32 !== 'play' || sceneBefore32 !== 'play') bad32.push('openGallery 前后 scene=' + sceneBefore32 + '→' + sceneAfter32 + '（应始终 play）');

        if (rl32.length !== 60) bad32.push('RELAX_LEVELS=' + rl32.length + ' 关（应 60）');
        if (diskRL32.length !== 60) bad32.push('磁盘 levels_relax.json=' + diskRL32.length + ' 关（应 60）');
        const mismatch32 = [];
        const verdict32 = [];   /* 逐关结论：抽样打印的 ✓/✗ 必须来自这里，不许写死 */
        for (let i = 0; i < Math.min(rl32.length, 60); i++) {
            P32.startLevel(i);   /* round=1 → 不许轮换 */
            const got = P32.app.def && P32.app.def.shapeId;
            const want = diskRL32[i] && diskRL32[i].shapeId;
            const wantTbl = rl32[i] && rl32[i].shapeId;
            const ok = got === want && got === wantTbl;
            verdict32.push(ok);
            if (!ok) {
                mismatch32.push('L' + (i + 1) + ' ' + got + '≠' + want + (wantTbl !== want ? '（RELAX_LEVELS ' + wantTbl + '）' : ''));
            }
        }
        if (mismatch32.length) bad32.push('第 1 圈 ' + mismatch32.length + ' 关 shapeId 与原表不同：' + mismatch32.slice(0, 4).join(' / '));
        const sample32 = [0, 29, 59].map((i) => 'L' + (i + 1) + '=' + ((diskRL32[i] || {}).shapeId || '?') + (verdict32[i] ? '✓' : '✗')).join(',');

        const evs32 = (P32.trackLog() || []).map((e) => String(e && e.ev));
        const collectEvs32 = evs32.filter((e) => e.indexOf('collect_') === 0);
        if (collectEvs32.length) bad32.push('trackLog 里出现 collect_*：' + [...new Set(collectEvs32)].join(','));

        const poolSizes32 = {};
        const sceneIds32 = Object.keys(orders32).length ? Object.keys(orders32) : ['night_station', 'noon_window', 'minimal'];
        for (const sid of sceneIds32) {
            const rot = P32.relaxRotationForScene(sid, 2) || [];
            poolSizes32[sid] = new Set(rot.map((x) => x.shapeId)).size;
        }
        if (wantPool32 !== 36) bad32.push('磁盘 collection.json 的 order 长度 ' + wantPool32 + '（应 36）');
        const poolBad32 = Object.keys(poolSizes32).filter((k) => poolSizes32[k] !== wantPool32);
        if (poolBad32.length) bad32.push('第 2 圈去重道具数 ' + poolBad32.map((k) => k + '=' + poolSizes32[k]).join('/') + '（应各 = 顺序表 ' + wantPool32 + '）');

        checkWithDetail(NAME, bad32.length === 0,
            (bad32.length ? bad32.slice(0, 6).join(' | ') + '｜' : '') +
            '入口可见=' + vis32 + '｜openGallery=' + ogRet32 + '（scene ' + sceneBefore32 + '→' + sceneAfter32 + '）' +
            '｜collect_* 事件 ' + collectEvs32.length + ' 个（trackLog 共 ' + evs32.length + ' 条）' +
            '｜第 1 圈 ' + (mismatch32.length ? '✗' + mismatch32.length + ' 关' : '60/60 关与原表相同') + '（抽样 ' + sample32 + '）' +
            '｜第 2 圈去重 ' + Object.keys(poolSizes32).map((k) => k + '=' + poolSizes32[k]).join('/') + '（期望 ' + wantPool32 + '）');
    }
}

/* ---------------- S33：关卡表零改动（磁盘 ↔ 产物，调用收集系统前后） ---------------- */
{
    const NAME = 'S33 关卡表零改动：磁盘 levels.json 与 P.levels 的 (id,shapeId,outlineId,cycleMs,turns,path) 指纹逐项相等；调 collectionState/openGallery/relaxRotationForScene 前后产物指纹不变；磁盘文件字节与 mtime 未变';
    const P33 = chall ? chall.P : null;
    const diskBefore33 = readDiskConfig(DISK_LEVELS);
    if (!P33) {
        checkWithDetail(NAME, false, '挑战会话没起来（见上面那条失败）');
    } else if (!diskBefore33.ok) {
        skipCheck(NAME, diskBefore33.err + ' → 拿不到「应该是什么」的独立真值', '处置：确认 assets/resources/config/levels.json 可读；本项未执行 ≠ 通过');
    } else {
        const diskList33 = Array.isArray(diskBefore33.data) ? diskBefore33.data : (diskBefore33.data.levels || []);
        const diskFp33 = lvlFingerprint(diskList33);
        const fpBefore33 = lvlFingerprint(P33.levels);
        const bad33 = [];
        if (diskFp33.length !== 60) bad33.push('磁盘关数 ' + diskFp33.length + '（应 60）');
        if (fpBefore33.length !== 60) bad33.push('产物关数 ' + fpBefore33.length + '（应 60）');
        const diffDisk33 = firstFpDiff(diskFp33, fpBefore33);
        if (diffDisk33) bad33.push('磁盘 ↔ 产物 不一致：' + diffDisk33);

        /* 摸一遍收集系统（纯函数 + 页面切换 + 三场景轮换），产物关卡表一个字段都不许动 */
        P33.collectionState({ cleared: 12, godTotal: 20 });
        P33.collectionState({ cleared: 60, godTotal: 31 });
        P33.openGallery('home');
        P33.closeGallery();
        P33.relaxRotationForScene('night_station', 2);
        P33.relaxRotationForScene('noon_window', 3);
        P33.relaxRotationForScene('minimal', 2);
        P33.collectionState();
        const fpAfter33 = lvlFingerprint(P33.levels);
        const diffAfter33 = firstFpDiff(fpBefore33, fpAfter33);
        if (diffAfter33) bad33.push('调用收集系统后产物关卡表被改：' + diffAfter33);

        const diskAfter33 = readDiskConfig(DISK_LEVELS);
        let diskTouched33 = false;
        if (!diskAfter33.ok) bad33.push('二次读盘失败：' + diskAfter33.err);
        else {
            if (diskAfter33.text !== diskBefore33.text) { bad33.push('磁盘 levels.json 字节变了（调用收集系统前后不一致）'); diskTouched33 = true; }
            if (diskAfter33.mtimeMs !== diskBefore33.mtimeMs) {
                bad33.push('磁盘 levels.json mtime 变了（' + diskBefore33.mtimeMs + '→' + diskAfter33.mtimeMs + '）');
                diskTouched33 = true;
            }
            if (lvlFingerprint(Array.isArray(diskAfter33.data) ? diskAfter33.data : (diskAfter33.data.levels || [])).length !== 60) {
                bad33.push('二次读盘关数不是 60');
            }
        }
        checkWithDetail(NAME, bad33.length === 0,
            (bad33.length ? bad33.slice(0, 6).join(' | ') + '｜' : '') +
            '指纹 ' + fpBefore33.length + ' 关 × 6 字段｜磁盘 ↔ 产物：' + (diffDisk33 ? '✗ ' + diffDisk33 : '逐项相等✓') +
            '｜调用前后产物：' + (diffAfter33 ? '✗ ' + diffAfter33 : '不变✓') +
            '｜磁盘文件 ' + diskBefore33.bytes + ' 字节 / mtime ' + diskBefore33.mtimeMs + '：' + (diskTouched33 ? '✗ 被改' : '未变✓') +
            '（调用内容：collectionState×2 + openGallery/closeGallery + 三场景 relaxRotationForScene）');
    }
}

/* ---------------- S34：阈值单调 + 末档落在顶级实测区间 ---------------- */
{
    const NAME = 'S34 阈值单调：COLLECTION.thresholds 长度 15 / 严格递增 / 全为正整数 / 末档 ∈ 顶级实测 31.9±10%（28.71–35.09）/ 末档 ≤40 / rare 池 15';
    const P34 = chall ? chall.P : null;
    const T34 = (P34 && P34.COLLECTION) ? (P34.COLLECTION.thresholds || []) : [];
    const rare34 = (P34 && P34.COLLECTION && P34.COLLECTION.pools) ? (P34.COLLECTION.pools.rare || []) : [];
    if (!P34 || !T34.length) {
        skipCheck(NAME, '构建产物里 COLLECTION.thresholds 为空（collection.json 没进 bundle 或缺 thresholds 字段）→ 没有阈值表可判',
            '处置：node tools/build_proto.mjs 重打包；阈值表本身必须写在 collection.json（改表不改逻辑）。本项未执行 ≠ 通过');
    } else {
        const LO34 = 31.9 * 0.9;   /* 28.71 */
        const HI34 = 31.9 * 1.1;   /* 35.09 */
        const last34 = T34[T34.length - 1];
        const bad34 = [];
        if (T34.length !== 15) bad34.push('长度 ' + T34.length + '（应 15）');
        for (let i = 0; i < T34.length; i++) {
            const v = T34[i];
            if (!(typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v > 0)) bad34.push('第 ' + (i + 1) + ' 项 ' + v + ' 不是正整数');
            if (i > 0 && !(v > T34[i - 1])) bad34.push('第 ' + i + '→' + (i + 1) + ' 项 ' + T34[i - 1] + '→' + v + ' 非严格递增');
        }
        if (!(last34 >= LO34 && last34 <= HI34)) bad34.push('末档 ' + last34 + ' 不在顶级实测 31.9±10% 区间 [' + LO34.toFixed(2) + ',' + HI34.toFixed(2) + ']');
        if (!(last34 <= 40)) bad34.push('末档 ' + last34 + ' > 40（回到 44 那种永远达不到的档）');
        if (rare34.length !== 15) bad34.push('rare 池 ' + rare34.length + ' 个（应 15）');
        /* 实测档位（D-096，sim --n=6000）：每一档能点亮几个 —— 只进 detail，用来核对曲线意图。
           口径：按实测**均值**严格 ≥ 阈值计数（新手 1.9 次 → 只够点亮阈值 1 那 1 个；规格 §2 写「拿 2 个」是把 1.9 取整的说法）。 */
        const tiers34 = [['新手', 1.9], ['普通', 4.6], ['熟练', 10.9], ['高手', 18.6], ['顶级', 31.9]];
        const tierLit34 = tiers34.map((t) => t[0] + ' ' + t[1] + '次→' + T34.filter((x) => t[1] >= x).length + ' 个').join('｜');
        checkWithDetail(NAME, bad34.length === 0,
            (bad34.length ? bad34.slice(0, 6).join(' | ') + '｜' : '') +
            'thresholds=[' + T34.join(',') + '] 末档 ' + last34 + ' ∈[' + LO34.toFixed(2) + ',' + HI34.toFixed(2) + ']' +
            '｜严格递增/正整数/长度 ' + T34.length + '/rare 池 ' + rare34.length +
            '｜按实测均值（严格 ≥ 阈值）点亮数：' + tierLit34);
    }
}

/* ---------------- S35：无每日任务（扫源码 + 扫产物 bundle） ---------------- */
{
    const NAME = 'S35 无每日任务：原型/_src/game.js 与构建产物 bundle 都不含「今日收集/每日收集/连续收集/签到/dailyCollect/collectDaily/collect_streak」；rules.dailyTasks===false';
    const BANNED35 = ['今日收集', '每日收集', '连续收集', '签到', 'dailyCollect', 'collectDaily', 'collect_streak'];
    const P35 = chall ? chall.P : null;
    const srcs35 = [];
    let err35 = '';
    try {
        srcs35.push({ name: '原型/_src/game.js', text: fs.readFileSync(SRC_GAME, 'utf8') });
        const html35 = fs.readFileSync(HTML_PATH, 'utf8');
        const blocks35 = [...html35.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
        if (!blocks35.length) throw new Error('html 里没找到内联 bundle（script 块 0 个）');
        srcs35.push({ name: '原型/dista_prototype.html#bundle', text: blocks35[blocks35.length - 1] });
    } catch (e) { err35 = String((e && e.message) || e); }
    if (!P35) {
        skipCheck(NAME, '挑战会话没起来（见上面那条失败）→ 读不到 COLLECTION.rules', '本项未执行 ≠ 通过');
    } else if (err35) {
        skipCheck(NAME, '读不到要扫的源码：' + err35, '处置：确认 原型/_src/game.js 与 原型/dista_prototype.html 存在；本项未执行 ≠ 通过');
    } else {
        const hits35 = [];
        for (const s of srcs35) {
            for (const t of BANNED35) {
                const at = s.text.indexOf(t);
                if (at >= 0) hits35.push(s.name + ' 出现「' + t + '」@字符' + at);
            }
        }
        const daily35 = (P35.COLLECTION && P35.COLLECTION.rules) ? P35.COLLECTION.rules.dailyTasks : undefined;
        checkWithDetail(NAME, hits35.length === 0 && daily35 === false,
            (hits35.length ? hits35.slice(0, 6).join(' | ') + '｜' : '') +
            '扫描 ' + srcs35.map((s) => s.name + ' ' + s.text.length + ' 字符').join(' + ') +
            '｜禁词 ' + BANNED35.length + ' 个、命中 ' + hits35.length +
            '｜COLLECTION.rules.dailyTasks=' + daily35);
    }
}

/* ---------------- S36：助眠第 2 圈 = 36 池（顺序独立重算，撞第二件顺延） ---------------- */
{
    const NAME = 'S36 助眠第 2 圈：三场景各 60 关｜去重 shapeId=36｜每关 shapeId==outlineId｜非 shape 字段逐关等于原表｜顺序 = orders[scene][(i+base·step)%36] 撞 shapeId2 顺延｜第 1 圈仍为原表';
    const diskCol36 = readDiskConfig(DISK_COLLECTION);
    const diskRelax36 = readDiskConfig(DISK_RELAX);
    let run36 = null;
    let err36 = '';
    try { run36 = loadProto({ search: 'mode=relax&screen=play&lvl=1&press=0.55', storage: {} }); } catch (e) { err36 = String((e && e.message) || e); }
    if (!run36) {
        checkWithDetail(NAME, false, '助眠会话没起来：' + err36);
    } else if (!diskCol36.ok || !diskRelax36.ok) {
        skipCheck(NAME, (!diskCol36.ok ? diskCol36.err : diskRelax36.err) + ' → 拿不到顺序表 / 原表的独立真值',
            '处置：确认 collection.json 与 levels_relax.json 可读；本项未执行 ≠ 通过');
    } else {
        const P36 = run36.P;
        const cyc236 = (diskCol36.data.relaxCycle2 || {});
        const orders36 = cyc236.orders || {};
        const fromRound36 = typeof cyc236.fromRound === 'number' ? cyc236.fromRound : 2;
        const step36 = typeof cyc236.stepPerRound === 'number' ? cyc236.stepPerRound : 12;
        const ROUND36 = 2;
        const base36 = Math.max(0, ROUND36 - fromRound36);   /* 第 2 圈 → 0；公式与配置一致，不抄实现里的魔法数 */
        const rl36 = P36.RELAX_LEVELS || [];
        const diskRL36 = diskRelax36.data.levels || [];
        const N36 = rl36.length;
        const bad36 = [];
        const rows36 = [];
        const scenes36 = Object.keys(orders36);
        if (N36 !== 60) bad36.push('RELAX_LEVELS=' + N36 + ' 关（应 60）');
        if (scenes36.length !== 3) bad36.push('磁盘 collection.json 的场景顺序表 ' + scenes36.length + ' 张（应 3）');

        for (const sid of scenes36) {
            const ord = orders36[sid] || [];
            const got = P36.relaxRotationForScene(sid, ROUND36) || [];
            const uniq = new Set(got.map((x) => x.shapeId)).size;
            if (got.length !== N36) bad36.push(sid + ' 第 2 圈 ' + got.length + ' 关（应 ' + N36 + '）');
            if (uniq !== ord.length) bad36.push(sid + ' 第 2 圈去重 ' + uniq + ' 个（应 = 顺序表 ' + ord.length + '）');
            const here = [];
            const sundered = [];   /* 撞第二件被顺延的关：这条分支本轮是否真的被走过，必须看得见 */
            for (let i = 0; i < Math.min(N36, got.length); i++) {
                if (got[i].shapeId !== got[i].outlineId) here.push('L' + (i + 1) + ' shapeId≠outlineId（' + got[i].shapeId + '/' + got[i].outlineId + '）');
                /* 顺序独立重算：offset = base·step + i → orders[offset % 36]；撞该关第二件就顺延到下一个未撞的 */
                const start = (((base36 * step36 + i) % ord.length) + ord.length) % ord.length;
                const collide = rl36[i] && rl36[i].shapeId2;
                let exp = ord[start];
                let guard = 0;
                if (collide && exp === collide) sundered.push('L' + (i + 1) + '(' + collide + '→' + ord[(start + 1) % ord.length] + ')');
                while (collide && exp === collide && guard < ord.length) {
                    guard++;
                    exp = ord[(start + guard) % ord.length];
                }
                if (got[i].shapeId !== exp) {
                    here.push('L' + (i + 1) + ' 顺序 ' + got[i].shapeId + '≠独立重算 ' + exp + (collide && ord[start] === collide ? '（撞第二件 ' + collide + ' 顺延）' : ''));
                }
                if (got[i].shapeId2 !== (rl36[i] && rl36[i].shapeId2 ? rl36[i].shapeId2 : null)) {
                    here.push('L' + (i + 1) + ' shapeId2 被改：' + got[i].shapeId2 + '≠' + (rl36[i] && rl36[i].shapeId2));
                }
                /* 非 shape 字段：拿整关定义与原表逐字段比（只允许 shapeId/outlineId 变） */
                const d36 = P36.relaxRotatedDef(rl36[i], i, ROUND36, sid);
                for (const k of Object.keys(rl36[i])) {
                    if (k === 'shapeId' || k === 'outlineId') continue;
                    if (JSON.stringify(d36[k]) !== JSON.stringify(rl36[i][k])) {
                        here.push('L' + (i + 1) + ' 字段 ' + k + ' 变了：' + JSON.stringify(rl36[i][k]) + '→' + JSON.stringify(d36[k]));
                    }
                }
            }
            if (here.length) bad36.push(sid + '：' + here.slice(0, 3).join(' / ') + '（共 ' + here.length + ' 处）');
            rows36.push(sid + ' 60关/去重' + uniq + '/' + (here.length ? '✗' + here.length : '顺序✓字段✓') +
                '/顺延' + sundered.length + (sundered.length ? '(' + sundered.join(',') + ')' : ''));
        }
        /* 第 1 圈（新会话 round=1）：app.def 必须还是原表，一关都不许轮换 */
        const firstBad36 = [];
        for (let i = 0; i < Math.min(N36, diskRL36.length); i++) {
            P36.startLevel(i);
            const got = P36.app.def && P36.app.def.shapeId;
            if (got !== diskRL36[i].shapeId) firstBad36.push('L' + (i + 1) + ' ' + got + '≠' + diskRL36[i].shapeId);
        }
        if (P36.app.round !== 1) bad36.push('第 1 圈检查时 app.round=' + P36.app.round + '（应 1，否则轮换已经生效、这条检查是假的）');
        if (firstBad36.length) bad36.push('第 1 圈 ' + firstBad36.length + ' 关被轮换：' + firstBad36.slice(0, 3).join(' / '));

        checkWithDetail(NAME, bad36.length === 0,
            (bad36.length ? bad36.slice(0, 6).join(' | ') + '｜' : '') +
            rows36.join('｜') +
            '｜顺序源：collection.json relaxCycle2.orders（fromRound=' + fromRound36 + ' stepPerRound=' + step36 + ' → 第2圈 offset=i%' + (Object.values(orders36)[0] || []).length + '）' +
            '｜第 1 圈：' + (firstBad36.length ? '✗' + firstBad36.length + ' 关被轮换' : '60/60 关 = 原表✓（round=' + P36.app.round + '）'));
    }
}

/* ---------------- S37：场景双通道（D-094：覆盖不写 pref，?scene= 仍写 pref） ---------------- */
{
    const NAME = 'S37 场景双通道：setSceneOverride 不写 pref｜覆盖优先于 pref｜clear 后回落 pref｜非法 id → null 且 pref 不变｜关卡结束清空 override（getter 与 app.sceneOverride 都回 null）｜?cardScene= 不写 dista.scene｜?scene= 仍写 pref｜两参数同时带 = 渲染听卡片、pref 听链接';
    let run37 = null;
    let card37 = null;
    let link37 = null;
    let both37 = null;
    let err37 = '';
    try {
        run37 = loadProto({ search: 'screen=play&lvl=1', storage: {} });
        card37 = loadProto({ search: 'cardScene=noon_window&screen=play&lvl=1', storage: {} });
        link37 = loadProto({ search: 'scene=minimal&screen=play&lvl=1', storage: {} });
        /* proto-a 2026-10-19 的浏览器级反例：两条通道同时带，必须各走各的 */
        both37 = loadProto({ search: 'scene=minimal&cardScene=night_station&screen=play&lvl=1', storage: {} });
    } catch (e) { err37 = String((e && e.message) || e); }
    if (!run37 || !card37 || !link37 || !both37) {
        checkWithDetail(NAME, false, '场景对照会话没起来：' + err37);
    } else {
        const P37 = run37.P;
        const bad37 = [];
        const log37 = [];
        const pref0 = P37.readScenePref();
        /* ① 覆盖：生效，但不碰玩家自己的 pref */
        const ov1 = P37.setSceneOverride('minimal');
        const r1 = P37.resolveSceneId();
        const p1 = P37.readScenePref();
        log37.push('override(minimal)→' + r1 + '/pref ' + p1);
        if (ov1 !== 'minimal' || r1 !== 'minimal') bad37.push('setSceneOverride("minimal")→' + ov1 + '，resolve=' + r1 + '（应 minimal）');
        if (p1 !== pref0) bad37.push('setSceneOverride 后 pref 变了：' + pref0 + '→' + p1);
        if (P37.getSceneOverride() !== 'minimal') bad37.push('getSceneOverride()=' + P37.getSceneOverride() + '（应 minimal）');
        if (P37.app.sceneOverride !== 'minimal') bad37.push('app.sceneOverride=' + P37.app.sceneOverride + '（应与 getter 同步为 minimal）');
        /* ② 覆盖优先于 pref（D-099：override > 手动 pref > 自动；看别人的卡不该改我的设置，也不该被我的设置抢掉） */
        P37.setScenePref('night_station');
        const r2 = P37.resolveSceneId();
        const p2 = P37.readScenePref();
        log37.push('pref(night_station)+override(minimal)→' + r2 + '/pref ' + p2);
        if (r2 !== 'minimal') bad37.push('override + pref 时 resolve=' + r2 + '（应仍 minimal，覆盖优先）');
        if (p2 !== 'night_station') bad37.push('setScenePref 后 pref=' + p2 + '（应 night_station）');
        /* ③ 清掉覆盖 → 回落 pref */
        P37.clearSceneOverride();
        const r3 = P37.resolveSceneId();
        log37.push('clear→' + r3);
        if (r3 !== 'night_station') bad37.push('clearSceneOverride 后 resolve=' + r3 + '（应回落到 pref night_station）');
        if (P37.getSceneOverride() !== null) bad37.push('clearSceneOverride 后 getSceneOverride()=' + P37.getSceneOverride() + '（应 null）');
        if (P37.app.sceneOverride !== null) bad37.push('clearSceneOverride 后 app.sceneOverride=' + P37.app.sceneOverride + '（应 null）');
        /* ④ 非法 id：不生效、不写 pref */
        const ovBad = P37.setSceneOverride('bogus');
        const p4 = P37.readScenePref();
        log37.push('override(bogus)→' + ovBad + '/pref ' + p4);
        if (ovBad !== null || P37.getSceneOverride() !== null) bad37.push('setSceneOverride("bogus")→' + ovBad + ' / get=' + P37.getSceneOverride() + '（应都是 null）');
        if (P37.app.sceneOverride !== null) bad37.push('非法 override 后 app.sceneOverride=' + P37.app.sceneOverride + '（应 null）');
        if (p4 !== 'night_station') bad37.push('非法 override 之后 pref 变了：' + p4);
        /* ⑤ 覆盖只活一关：nextLevel 必须清空（否则"看别人的卡"会永久改我的渲染） */
        P37.startLevel(0);
        P37.setSceneOverride('noon_window');
        const beforeNext = P37.getSceneOverride();
        P37.nextLevel();
        const afterNext = P37.getSceneOverride();
        log37.push('startLevel+override+nextLevel→' + beforeNext + '→' + afterNext);
        if (beforeNext !== 'noon_window') bad37.push('startLevel 后 setSceneOverride 没生效：' + beforeNext);
        if (afterNext !== null) bad37.push('nextLevel 后 override=' + afterNext + '（应 null）');
        if (P37.app.sceneOverride !== null) bad37.push('nextLevel 后 app.sceneOverride=' + P37.app.sceneOverride + '（应 null）');

        /* ⑥ 瓶子卡通道：?cardScene= 只影响渲染，不写 dista.scene */
        const cardSceneId = card37.P.app.sceneId;
        const cardStorage = card37.storage.get('dista.scene');
        log37.push('?cardScene=noon_window→sceneId ' + cardSceneId + '/storage ' + JSON.stringify(cardStorage));
        if (cardSceneId !== 'noon_window') bad37.push('?cardScene=noon_window 会话的 app.sceneId=' + cardSceneId + '（应 noon_window）');
        if (cardStorage !== undefined) bad37.push('?cardScene= 会话写了 dista.scene=' + JSON.stringify(cardStorage) + '（覆盖通道不许写 pref）');
        /* ⑦ 分享链接通道：?scene= 就是"我跟你同款"，必须写 pref */
        const linkPref = link37.P.readScenePref();
        const linkStorage = link37.storage.get('dista.scene');
        log37.push('?scene=minimal→pref ' + linkPref + '/storage ' + JSON.stringify(linkStorage));
        if (linkStorage !== 'minimal') bad37.push('?scene=minimal 会话 storage.dista.scene=' + JSON.stringify(linkStorage) + '（应 minimal）');
        if (linkPref !== 'minimal') bad37.push('?scene=minimal 会话 readScenePref()=' + linkPref + '（应 minimal）');
        /* ⑧ 两条通道同时带：渲染听卡片、pref 听链接；关卡结束回落链接写的 pref */
        const PB37 = both37.P;
        const bothRender = PB37.app.sceneId;
        const bothPref = PB37.readScenePref();
        const bothOv = PB37.getSceneOverride();
        const bothStorage = both37.storage.get('dista.scene');
        log37.push('?scene=minimal&cardScene=night_station→渲染 ' + bothRender + '/override ' + bothOv + '/pref ' + bothPref);
        if (bothRender !== 'night_station' || bothOv !== 'night_station') bad37.push('两参数同带时渲染=' + bothRender + '/override=' + bothOv + '（应 night_station，覆盖优先）');
        if (bothPref !== 'minimal' || bothStorage !== 'minimal') bad37.push('两参数同带时 pref=' + bothPref + '/storage=' + JSON.stringify(bothStorage) + '（应被 ?scene= 写成 minimal）');
        PB37.nextLevel();
        const bothAfter = { sceneId: PB37.app.sceneId, ov: PB37.getSceneOverride(), pref: PB37.readScenePref() };
        log37.push('两参数同带 + nextLevel→' + bothAfter.sceneId + '/override ' + bothAfter.ov + '/pref ' + bothAfter.pref);
        if (bothAfter.ov !== null || bothAfter.sceneId !== 'minimal') bad37.push('两参数同带 nextLevel 后=' + bothAfter.sceneId + '/override ' + bothAfter.ov + '（应回落 minimal 且 override=null）');

        checkWithDetail(NAME, bad37.length === 0,
            (bad37.length ? bad37.slice(0, 6).join(' | ') + '｜' : '') +
            '初始 pref=' + pref0 +
            '｜' + log37.join('｜') +
            '｜cardScene 会话 storage keys=' + JSON.stringify([...card37.storage.keys()]) +
            '｜link 会话 storage=' + JSON.stringify([...link37.storage.entries()]) +
            '｜both 会话 storage=' + JSON.stringify([...both37.storage.entries()]));
    }
}

/* ---------------- S38：图鉴入口必须点得中（热区外扩 + 跟随面板滑入） ---------------- */
{
    const NAME = 'S38 图鉴入口可点中：首页胶囊中心/下偏10px 都进图鉴｜远离入口仍开局｜结算入口静止与滑入中视觉位置都进图鉴｜面板下方不误触｜relax 无入口';
    let home38 = null;
    let panel38 = null;
    let slide38 = null;
    let relax38 = null;
    let err38 = '';
    try {
        home38 = loadProto({ search: 'screen=home', storage: {} });
        panel38 = loadProto({ search: 'mode=challenge&screen=result&lvl=1&press=0.5&fxAt=900', storage: {} });
        slide38 = loadProto({ search: 'mode=challenge&screen=result&lvl=1&press=0.5&fxAt=270', storage: {} });
        relax38 = loadProto({ search: 'mode=relax&screen=home', storage: {} });
    } catch (e) { err38 = String((e && e.message) || e); }
    if (!home38 || !panel38 || !slide38 || !relax38) {
        checkWithDetail(NAME, false, '入口对照会话没起来：' + err38);
    } else {
        const bad38 = [];
        const log38 = [];
        /* 点击点一律从 LIVE 常量/热区算，不写死像素（S42 同口径；proto-a 改布局后不许假红） */
        const mid38 = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
        const HR = home38.P.homeGalleryHitRect();
        const HC = mid38(home38.P.HOME_GALLERY_BTN);
        if (HR.h < 88) bad38.push('首页图鉴热区高 ' + HR.h + '（应 ≥88）');
        home38.P.homePress(HC.x, HC.y);
        log38.push('首页卡片中心(' + HC.x + ',' + HC.y + ')→' + home38.P.app.scene);
        if (home38.P.app.scene !== 'gallery') bad38.push('首页胶囊中心点击后 scene=' + home38.P.app.scene + '（应 gallery）');
        const home2 = loadProto({ search: 'screen=home', storage: {} });
        home2.P.homePress(HC.x, HC.y + 10);
        log38.push('首页下偏10px→' + home2.P.app.scene);
        if (home2.P.app.scene !== 'gallery') bad38.push('首页胶囊下偏 10px 点击后 scene=' + home2.P.app.scene + '（热区没外扩）');
        const home3 = loadProto({ search: 'screen=home', storage: {} });
        const far38 = { x: HC.x, y: HR.y + HR.h + 40 };
        home3.P.homePress(far38.x, far38.y);
        log38.push('首页远离入口(' + far38.x + ',' + far38.y + ' 热区下沿+40)→' + home3.P.app.scene);
        if (home3.P.app.scene !== 'play') bad38.push('首页远离入口点击后 scene=' + home3.P.app.scene + '（应仍开局）');
        const PR = panel38.P;
        const ph = PR.panelGalleryHitRect(PR.app.fb);
        const phc = mid38(ph);
        if (ph.h < 88) bad38.push('结算入口热区高 ' + ph.h + '（应 ≥88）');
        PR.homePress(phc.x, phc.y);
        log38.push('面板静止(' + phc.x + ',' + phc.y.toFixed(0) + ')→' + PR.app.scene);
        if (PR.app.scene !== 'gallery') bad38.push('面板静止时点入口 scene=' + PR.app.scene + '（应 gallery）');
        const SR = slide38.P;
        const slide = SR.panelSlidePx(SR.app.fb);
        const srh = SR.panelGalleryHitRect(SR.app.fb);
        const src38 = mid38(srh);
        SR.homePress(src38.x, src38.y);
        log38.push('面板滑入 slide=' + slide.toFixed(1) + 'px 点热区中心(' + src38.x + ',' + src38.y.toFixed(0) + ')→' + SR.app.scene);
        if (SR.app.scene !== 'gallery') bad38.push('面板滑入中点视觉位置 scene=' + SR.app.scene + '（热区没跟随 slide）');
        const PB = loadProto({ search: 'mode=challenge&screen=result&lvl=1&press=0.5&fxAt=900', storage: {} });
        const pbh = PB.P.panelGalleryHitRect(PB.P.app.fb);
        const below38 = { x: pbh.x + pbh.w / 2, y: pbh.y + pbh.h + 40 };
        PB.P.homePress(below38.x, below38.y);
        log38.push('面板热区下沿+40(' + below38.x + ',' + below38.y.toFixed(0) + ')→' + PB.P.app.scene);
        if (PB.P.app.scene === 'gallery') bad38.push('面板热区下沿+40 也进图鉴（热区过大）');
        log38.push('relax 入口可见=' + relax38.P.galleryEntryVisible());
        if (relax38.P.galleryEntryVisible() !== false) bad38.push('relax 下 galleryEntryVisible=' + relax38.P.galleryEntryVisible() + '（应 false）');
        checkWithDetail(NAME, bad38.length === 0, (bad38.length ? bad38.join(' | ') + '｜' : '') + log38.join('｜'));
    }
}

/* ---------------- S39：收集反馈（解锁卡 + NEW + 神级停留） ---------------- */
{
    const NAME = 'S39 收集反馈：首通L1神级→解锁卡含保温杯+香蕉｜只差稀有→只含鸭子｜无新增→不画卡且newIds空｜relax→零反馈｜unlocks 去重且单次≤2件（绘制 slice(0,2) 不许丢件）｜unlock_card_shown count===ids.length｜神级停留1800/其它1000';
    const seed = (o) => JSON.stringify(o);
    let a39 = null, b39 = null, c39 = null, d39 = null, err39 = '';
    try {
        a39 = loadProto({ search: 'mode=challenge&screen=result&lvl=1&press=0.5&fxAt=400', storage: {} });
        b39 = loadProto({ search: 'mode=challenge&screen=result&lvl=2&press=0.5&fxAt=400', storage: { 'dista.progress': seed({ unlocked: 2, cleared: 1, godTotal: 1, god: 1, bestScore: 0, newIds: [] }) } });
        c39 = loadProto({ search: 'mode=challenge&screen=result&lvl=1&press=0.5&fxAt=400', storage: { 'dista.progress': seed({ unlocked: 2, cleared: 1, godTotal: 31, god: 31, bestScore: 0, newIds: [] }) } });
        d39 = loadProto({ search: 'mode=relax&screen=result&lvl=1&press=0.5&fxAt=400', storage: {} });
    } catch (e) { err39 = String((e && e.message) || e); }
    if (!a39 || !b39 || !c39 || !d39) {
        checkWithDetail(NAME, false, '收集反馈会话没起来：' + err39);
    } else {
        const bad39 = [];
        const log39 = [];
        const ua = (a39.P.app.fb && a39.P.app.fb.unlocks) || [];
        log39.push('L1首通神级 unlocks=' + JSON.stringify(ua));
        if (ua.indexOf('cup_tumbler') < 0 || ua.indexOf('banana') < 0 || ua.length !== 2) bad39.push('首通 L1 神级应解锁保温杯+香蕉，实际 ' + JSON.stringify(ua));
        if (a39.P.progress.newIds.indexOf('cup_tumbler') < 0 || a39.P.progress.newIds.indexOf('banana') < 0) bad39.push('newIds 未写入：' + JSON.stringify(a39.P.progress.newIds));
        const ub = (b39.P.app.fb && b39.P.app.fb.unlocks) || [];
        log39.push('L2仅新稀有 unlocks=' + JSON.stringify(ub));
        if (ub.length !== 1 || ub[0] !== 'duck') bad39.push('已通关 L1 后 L2 神级应只解锁鸭子，实际 ' + JSON.stringify(ub));
        const uc = (c39.P.app.fb && c39.P.app.fb.unlocks) || [];
        log39.push('无新增 unlocks=' + JSON.stringify(uc) + ' visible=' + c39.P.unlockCardVisible(c39.P.app.fb));
        if (uc.length !== 0 || c39.P.unlockCardVisible(c39.P.app.fb)) bad39.push('无新增时仍画解锁卡：' + JSON.stringify(uc));
        const ud = (d39.P.app.fb && d39.P.app.fb.unlocks) || [];
        log39.push('relax unlocks=' + JSON.stringify(ud) + ' newIds=' + JSON.stringify(d39.P.progress.newIds));
        if (ud.length !== 0 || d39.P.progress.newIds.length !== 0) bad39.push('relax 产生了收集反馈：' + JSON.stringify(ud));
        const r39 = a39.P.UNLOCK_CARD_RECT;
        log39.push('card=' + r39.x + ',' + r39.y + ',' + r39.w + 'x' + r39.h);
        if (r39.y + r39.h >= 880) bad39.push('解锁卡压到结算面板：bottom=' + (r39.y + r39.h));
        if (a39.P.feedbackHoldMs('god') !== 1800 || a39.P.feedbackHoldMs('perfect') !== 1000) bad39.push('停留时长错：god=' + a39.P.feedbackHoldMs('god') + ' perfect=' + a39.P.feedbackHoldMs('perfect'));
        const ev39 = a39.P.trackLog().map((e) => e.ev);
        log39.push('events=' + ev39.join(','));
        if (ev39.filter((x) => x === 'collect_unlock').length !== 2) bad39.push('collect_unlock 应 2 条，实际 ' + ev39.filter((x) => x === 'collect_unlock').length);
        if (ev39.filter((x) => x === 'unlock_card_shown').length !== 1) bad39.push('unlock_card_shown 应 1 条');

        /* ---- v0.9.1 收尾：unlocks 去重 / 单次结算 ≤2 件（绘制只画 slice(0,2)，多出来的会静默丢件）/ 事件 count 一致 ---- */
        const dupIds39 = (arr) => (arr || []).filter((x, i, a) => a.indexOf(x) !== i);
        const cardEvents39 = (P) => (P.trackLog() || []).filter((e) => e.ev === 'unlock_card_shown').map((e) => e.params || {});
        const rows39 = [['首通L1', a39], ['L1后L2', b39], ['无新增', c39], ['relax', d39]];
        const bad39Before = bad39.length;
        for (const [label, s] of rows39) {
            const P = s.P;
            const ids = (P.app.fb && P.app.fb.unlocks) || [];
            const dup = dupIds39(ids);
            if (dup.length) bad39.push(label + ' 的 unlocks 有重复 id：' + JSON.stringify(dup));
            /* 单次结算最多 2 件：主线 cleared+1 只多 1 个去重 shapeId；一次神级只多跨 1 个阈值（S34 严格递增）。
               若哪天出现 3 件，绘制 slice(0,2) 会静默丢第 3 件 —— 这条必须红，不许放宽成"画得下就行"。 */
            if (ids.length > 2) bad39.push(label + ' 单次结算解锁 ' + ids.length + ' 件 > 2（卡片只画 2 件，会静默丢件）');
            const evs = cardEvents39(P);
            if (ids.length === 0 && evs.length) bad39.push(label + ' 无新增却发了 ' + evs.length + ' 条 unlock_card_shown');
            if (ids.length > 0 && evs.length !== 1) bad39.push(label + ' unlock_card_shown 应 1 条，实际 ' + evs.length);
            evs.forEach((p, i) => {
                const pids = p.ids || [];
                if (p.count !== pids.length) bad39.push(label + ' unlock_card_shown#' + i + ' count=' + p.count + ' ≠ ids.length=' + pids.length);
                if (JSON.stringify(pids) !== JSON.stringify(ids)) {
                    bad39.push(label + ' unlock_card_shown#' + i + ' ids=' + JSON.stringify(pids) + ' ≠ fb.unlocks=' + JSON.stringify(ids));
                }
            });
            log39.push(label + ' unlocks=' + JSON.stringify(ids) + ' count=' + (evs.length ? evs[0].count : '—(无事件)'));
        }
        const cevA39 = cardEvents39(a39.P)[0] || {};
        const cevB39 = cardEvents39(b39.P)[0] || {};
        if (cevA39.count !== 2) bad39.push('首通 L1 的 unlock_card_shown.count=' + cevA39.count + '（应 2）');
        if (cevB39.count !== 1) bad39.push('L1 后 L2 的 unlock_card_shown.count=' + cevB39.count + '（应 1）');
        if (bad39.length === bad39Before) log39.push('去重✓ 单次≤2 件✓ count===ids.length✓（4 会话）');

        checkWithDetail(NAME, bad39.length === 0, (bad39.length ? bad39.join(' | ') + '｜' : '') + log39.join('｜'));
    }
}

/* ---------------- S40：入口全程可达（首页/局内/结算/通关页；relax 全无） ---------------- */
{
    const NAME = 'S40 图鉴入口：首页卡片/局内图标/结算按钮/通关页卡片各一次点击进图鉴（点击点从 LIVE 常量算）｜relax 图标不画且点其在场位置不会进图鉴｜四个热区高度≥88';
    let home40 = null, play40 = null, comp40 = null, relax40 = null, err40 = '';
    try {
        home40 = loadProto({ search: 'screen=home', storage: {} });
        play40 = loadProto({ search: 'mode=challenge&screen=play&lvl=1&press=0.55', storage: {} });
        comp40 = loadProto({ search: 'screen=complete', storage: {} });
        relax40 = loadProto({ search: 'mode=relax&screen=play&lvl=1', storage: {} });
    } catch (e) { err40 = String((e && e.message) || e); }
    if (!home40 || !play40 || !comp40 || !relax40) {
        checkWithDetail(NAME, false, '入口会话没起来：' + err40);
    } else {
        const bad40 = [];
        const log40 = [];
        /* 点击点一律从 __PROTO__ 的 LIVE 常量算，不写死像素：
           proto-a 本轮把局内图标改成 (24,1166) 的胶囊、relax 退出移到 (24,136)，写死旧坐标会假红。 */
        const mid40 = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
        const hr = home40.P.homeGalleryHitRect(), pr = play40.P.playGalleryHitRect(), cr = comp40.P.completeGalleryHitRect(), br = home40.P.panelGalleryHitRect(null);
        log40.push('hit h: home=' + hr.h + ' play=' + pr.h + ' complete=' + cr.h + ' panel=' + br.h);
        [['home', hr], ['play', pr], ['complete', cr], ['panel', br]].forEach(([n, r]) => { if (r.h < 88) bad40.push(n + ' 热区高 ' + r.h + '（应 ≥88）'); });
        /* 视觉矩形必须在屏内、且热区必须罩住视觉矩形（"看得见却点不中"是 P1） */
        const cover40 = (name, vis, hit, P) => {
            if (vis.x < 0 || vis.y < 0 || vis.x + vis.w > 720 || vis.y + vis.h > 1280) bad40.push(name + ' 视觉矩形出屏 x/y/w/h=' + [vis.x, vis.y, vis.w, vis.h].join(','));
            if (hit.x > vis.x || hit.y > vis.y || hit.x + hit.w < vis.x + vis.w || hit.y + hit.h < vis.y + vis.h) {
                bad40.push(name + ' 热区没罩住视觉矩形（热区 ' + JSON.stringify(hit) + ' / 视觉 ' + JSON.stringify(vis) + '）');
            }
        };
        cover40('局内图标', play40.P.PLAY_GALLERY_BTN, pr, play40.P);
        const hp40 = mid40(home40.P.HOME_GALLERY_BTN);
        const pp40 = mid40(play40.P.PLAY_GALLERY_BTN);
        const cp40 = mid40(comp40.P.COMPLETE_GALLERY_BTN);
        const rp40 = mid40(relax40.P.PLAY_GALLERY_BTN);
        log40.push('点击点 home(' + hp40.x + ',' + hp40.y + ') play(' + pp40.x + ',' + pp40.y + ') complete(' + cp40.x + ',' + cp40.y + ') relax(' + rp40.x + ',' + rp40.y + ')');
        home40.P.homePress(hp40.x, hp40.y);
        play40.P.homePress(pp40.x, pp40.y);
        comp40.P.homePress(cp40.x, cp40.y);
        log40.push('home→' + home40.P.app.scene + '/from ' + home40.P.app.galleryFrom +
            '｜play→' + play40.P.app.scene + '/from ' + play40.P.app.galleryFrom +
            '｜complete→' + comp40.P.app.scene + '/from ' + comp40.P.app.galleryFrom);
        if (home40.P.app.scene !== 'gallery') bad40.push('首页卡片点击后 ' + home40.P.app.scene);
        if (play40.P.app.scene !== 'gallery' || play40.P.app.galleryFrom !== 'play') bad40.push('局内图标点击后 ' + play40.P.app.scene + '/from ' + play40.P.app.galleryFrom);
        if (comp40.P.app.scene !== 'gallery' || comp40.P.app.galleryFrom !== 'complete') bad40.push('通关页卡片点击后 ' + comp40.P.app.scene + '/from ' + comp40.P.app.galleryFrom);
        /* 结算面板右上按钮：一次点击也要进（S38 验热区外扩，这里验"入口本身可用"） */
        const panelC = mid40(home40.P.PANEL_GALLERY_BTN);
        const pm40 = loadProto({ search: 'mode=challenge&screen=result&lvl=1&press=0.5&fxAt=900', storage: {} });
        pm40.P.homePress(panelC.x, panelC.y + pm40.P.panelSlidePx(pm40.P.app.fb));
        log40.push('panel(' + panelC.x + ',' + panelC.y.toFixed(0) + ')+slide→' + pm40.P.app.scene + '/from ' + pm40.P.app.galleryFrom);
        if (pm40.P.app.scene !== 'gallery' || pm40.P.app.galleryFrom !== 'feedback') bad40.push('结算面板入口点击后 ' + pm40.P.app.scene + '/from ' + pm40.P.app.galleryFrom);
        log40.push('relax 入口可见=' + relax40.P.galleryEntryVisible());
        if (relax40.P.galleryEntryVisible() !== false) bad40.push('relax galleryEntryVisible=' + relax40.P.galleryEntryVisible());
        relax40.P.homePress(rp40.x, rp40.y);
        log40.push('relax 点图标后=' + relax40.P.app.scene);
        if (relax40.P.app.scene === 'gallery') bad40.push('relax 点图标进了图鉴');
        checkWithDetail(NAME, bad40.length === 0, (bad40.length ? bad40.join(' | ') + '｜' : '') + log40.join('｜'));
    }
}

/* ---------------- S41：图鉴欣赏（4×3 分页 + 240px 详情 + NEW 清除） ---------------- */
{
    const NAME = 'S41 图鉴：4×3每页12件×3页覆盖36件｜左右翻页0→1→0｜首/末页越界点击无效（不循环）且 pageArrowEnabled 灰显门禁｜点格进240px详情｜锁定不泄露名字｜返回保留页｜NEW看过即消且落盘';
    let g41 = null, n41 = null, err41 = '';
    try {
        g41 = loadProto({ search: 'screen=gallery&progress=12&god=3', storage: {} });
        n41 = loadProto({ search: 'screen=gallery', storage: { 'dista.progress': JSON.stringify({ unlocked: 2, cleared: 1, godTotal: 1, god: 1, bestScore: 0, newIds: ['banana'] }) } });
    } catch (e) { err41 = String((e && e.message) || e); }
    if (!g41 || !n41) {
        checkWithDetail(NAME, false, '图鉴会话没起来：' + err41);
    } else {
        const bad41 = [];
        const log41 = [];
        const P41 = g41.P;
        const per = P41.GALLERY_GRID.perPage, pages = P41.galleryPageCount();
        log41.push('perPage=' + per + ' pages=' + pages);
        if (per !== 12 || pages !== 3) bad41.push('分页应为 12/页×3 页，实际 ' + per + '/' + pages);
        const seen = new Set();
        for (let p = 0; p < pages; p++) {
            const ids = P41.COLLECTION.order.slice(p * per, (p + 1) * per);
            ids.forEach((id) => seen.add(id));
        }
        log41.push('覆盖=' + seen.size);
        if (seen.size !== P41.COLLECTION.order.length) bad41.push('三页覆盖 ' + seen.size + ' ≠ ' + P41.COLLECTION.order.length);
        /* 翻页：点击点从 LIVE 常量算（GALLERY_PAGE_PREV/NEXT 可能随布局改，不写死像素）；
           0→1→0 走通，且**首/末页越界点击必须无效**（不循环，避免"翻回第 1 页以为漏了"） */
        const mid41 = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
        const prev41 = mid41(P41.GALLERY_PAGE_PREV);
        const next41 = mid41(P41.GALLERY_PAGE_NEXT);
        P41.app.galleryPage = 0;
        P41.homePress(prev41.x, prev41.y);
        const pFirstPrev = P41.app.galleryPage;
        P41.homePress(next41.x, next41.y);
        const p1 = P41.app.galleryPage;
        P41.homePress(prev41.x, prev41.y);
        const p0 = P41.app.galleryPage;
        P41.app.galleryPage = pages - 1;
        P41.homePress(next41.x, next41.y);
        const pLastNext = P41.app.galleryPage;
        P41.homePress(prev41.x, prev41.y);
        const pLastPrev = P41.app.galleryPage;
        log41.push('翻页 首点左(应0)=' + pFirstPrev + '｜0→' + p1 + '→' + p0 +
            '｜末点右(应' + (pages - 1) + ')=' + pLastNext + '→末点左=' + pLastPrev);
        if (pFirstPrev !== 0) bad41.push('第 0 页点左键应无效，实际 page=' + pFirstPrev);
        if (p1 !== 1 || p0 !== 0) bad41.push('翻页按钮无效：' + p1 + '/' + p0);
        if (pLastNext !== pages - 1) bad41.push('末页点右键应无效（不循环），实际 page=' + pLastNext + '（末页=' + (pages - 1) + '）');
        if (pLastPrev !== pages - 2) bad41.push('末页点左键应回到 ' + (pages - 2) + '，实际 ' + pLastPrev);
        /* 灰显硬门禁：pageArrowEnabled(dir)（proto-a 冻结前新增的只读口子，替代"靠截图看灰"）。
           约定：dir=-1 左键 / +1 右键；读当前 app.galleryPage。 */
        if (typeof P41.pageArrowEnabled !== 'function') {
            bad41.push('pageArrowEnabled 未导出（冻结版应已导出；否则箭头灰显只能靠截图，不能门禁）');
        } else {
            const arrowAt41 = (pg) => { P41.app.galleryPage = pg; return { prev: P41.pageArrowEnabled(-1), next: P41.pageArrowEnabled(1) }; };
            const a0 = arrowAt41(0), a1 = arrowAt41(1), aN = arrowAt41(pages - 1);
            log41.push('pageArrowEnabled p0=' + JSON.stringify(a0) + ' p1=' + JSON.stringify(a1) + ' p' + (pages - 1) + '=' + JSON.stringify(aN));
            if (a0.prev !== false || a0.next !== true) bad41.push('第 0 页箭头可用性错：prev=' + a0.prev + ' next=' + a0.next + '（应 false/true：左灰显、右可翻）');
            if (a1.prev !== true || a1.next !== true) bad41.push('第 1 页箭头应都可翻：prev=' + a1.prev + ' next=' + a1.next);
            if (aN.prev !== true || aN.next !== false) bad41.push('末页箭头可用性错：prev=' + aN.prev + ' next=' + aN.next + '（应 true/false：左可翻、右灰显）');
        }
        /* 详情：240px、返回保留页 */
        P41.app.galleryPage = 1;
        const opened = P41.openGalleryDetail('cup_tumbler');
        const big = P41.GALLERY_BIG;
        log41.push('detail open=' + opened + '/' + P41.app.galleryDetail + ' big=' + big.size);
        if (!opened || P41.app.galleryDetail !== 'cup_tumbler') bad41.push('点格未进详情');
        if (big.size !== 240) bad41.push('详情剪影 ' + big.size + '（应 240）');
        const back41 = mid41(P41.GALLERY_BACK);
        P41.homePress(back41.x, back41.y);
        log41.push('detail back → ' + P41.app.galleryDetail + ' page=' + P41.app.galleryPage);
        if (P41.app.galleryDetail !== null) bad41.push('详情返回失败');
        if (P41.app.galleryPage !== 1) bad41.push('详情返回丢了页码：' + P41.app.galleryPage);
        /* 锁定不泄露名字 */
        P41.openGalleryDetail('dragon');
        const lockedTitle = P41.galleryDetailTitle('dragon');
        log41.push('locked title=' + lockedTitle);
        if (lockedTitle !== '未点亮') bad41.push('锁定详情标题泄露：' + lockedTitle);
        /* NEW：进详情即清，且打开图鉴自动落到 NEW 所在页（香蕉=第 2 页） */
        const PN = n41.P;
        log41.push('NEW 打开落到 page=' + PN.app.galleryPage + ' newIds=' + JSON.stringify(PN.progress.newIds));
        if (PN.app.galleryPage !== 1) bad41.push('有 NEW 时未落到香蕉所在页：' + PN.app.galleryPage);
        PN.openGalleryDetail('banana');
        const afterNew = PN.progress.newIds.slice();
        const persisted = JSON.parse(n41.storage.get('dista.progress') || '{}').newIds || [];
        log41.push('看完 banana newIds=' + JSON.stringify(afterNew) + ' 落盘=' + JSON.stringify(persisted));
        if (afterNew.indexOf('banana') >= 0) bad41.push('看过详情仍保留 NEW');
        if (persisted.indexOf('banana') >= 0) bad41.push('NEW 清除未落盘');
        checkWithDetail(NAME, bad41.length === 0, (bad41.length ? bad41.join(' | ') + '｜' : '') + log41.join('｜'));
    }
}

/* ---------------- S42：v0.9.1 布局不重叠 ---------------- */
{
    const NAME = 'S42 布局：4×3 末行底 846 < 翻页键 924｜同排格不横叠｜详情 240px 双向在屏内且名字离剪影 ≥40px｜解锁卡 868 < 面板 880 且横向在屏内｜三处入口双向不越界｜relax 退出 EXIT_BTN 在屏内且避开 88–112 文字带（点它回首页、挑战同点位仍是判定）';
    let s42 = null, x42 = null, c42 = null, err42 = '';
    try {
        s42 = loadProto({ search: 'screen=home', storage: {} });
        x42 = loadProto({ search: 'mode=relax&screen=play&lvl=1', storage: {} });
        c42 = loadProto({ search: 'mode=challenge&screen=play&lvl=1&press=0.55', storage: {} });
    } catch (e) { err42 = String((e && e.message) || e); }
    if (!s42 || !x42 || !c42) {
        checkWithDetail(NAME, false, '布局会话没起来：' + err42);
    } else {
        const P = s42.P, bad = [], log = [];
        const G = P.GALLERY_GRID;
        const lastBottom = G.y0 + (G.rows - 1) * (G.ch + G.gy) + G.ch;
        log.push('grid lastBottom=' + lastBottom + ' pagePrev.y=' + P.GALLERY_PAGE_PREV.y);
        if (lastBottom >= P.GALLERY_PAGE_PREV.y) bad.push('末行压到翻页键');
        for (let r = 0; r < G.rows; r++) {
            for (let c = 0; c < G.cols - 1; c++) {
                const a = P.galleryCellRect(r * G.cols + c), b = P.galleryCellRect(r * G.cols + c + 1);
                if (a.x + a.w > b.x) bad.push('格 ' + (r * G.cols + c) + ' 横向重叠');
            }
        }
        const bigTop = P.GALLERY_BIG.cy - P.GALLERY_BIG.size / 2;
        const bigBottom = P.GALLERY_BIG.cy + P.GALLERY_BIG.size / 2;
        const bigLeft = P.GALLERY_BIG.cx - P.GALLERY_BIG.size / 2;
        const bigRight = P.GALLERY_BIG.cx + P.GALLERY_BIG.size / 2;
        log.push('big y ' + bigTop + '–' + bigBottom + ' x ' + bigLeft + '–' + bigRight + ' nameY=748');
        if (bigTop < 0 || bigBottom > 1280 || bigLeft < 0 || bigRight > 720) bad.push('详情剪影越界');
        if (748 - bigBottom < 40) bad.push('名字离剪影太近');
        const uc = P.UNLOCK_CARD_RECT;
        log.push('unlockCard y=' + uc.y + '–' + (uc.y + uc.h) + ' x=' + uc.x + '–' + (uc.x + uc.w) + ' panelTop=880');
        if (uc.y + uc.h >= 880) bad.push('解锁卡压面板');
        if (uc.x < 0 || uc.x + uc.w > 720) bad.push('解锁卡横向出屏');
        /* 三处入口全部读 LIVE 常量（proto-a 会把局内图标改成 (24,1166) 胶囊、relax 退出移到 (24,136)），不写死旧坐标 */
        const HB = P.HOME_GALLERY_BTN, PB2 = P.PLAY_GALLERY_BTN, CB = P.COMPLETE_GALLERY_BTN;
        log.push('home y=' + HB.y + '–' + (HB.y + HB.h) + ' x=' + HB.x + '–' + (HB.x + HB.w) +
            '｜play y=' + PB2.y + '–' + (PB2.y + PB2.h) + ' x=' + PB2.x + '–' + (PB2.x + PB2.w) +
            '｜complete y=' + CB.y + '–' + (CB.y + CB.h) + ' x=' + CB.x + '–' + (CB.x + CB.w));
        if (HB.y + HB.h >= 236) bad.push('首页卡片压标题');
        if (HB.x < 0 || HB.x + HB.w > 720) bad.push('首页卡片横向出屏');
        if (PB2.y < 0 || PB2.y + PB2.h > 1280) bad.push('局内图标纵向越界');
        if (PB2.x < 0 || PB2.x + PB2.w > 720) bad.push('局内图标横向出屏');
        if (CB.y + CB.h >= 250) bad.push('通关页卡片压标题');
        if (CB.x < 0 || CB.x + CB.w > 720) bad.push('通关页卡片横向出屏');
        /* relax 可见「退出」（D-106/D-100）：位置在屏内 + 避开 y 88–112 的关卡名文字带；
           行为两向：relax 点它 → 回首页；挑战点同一点位 → 仍是判定（先判 UI 但只对 relax 生效） */
        const EX = P.EXIT_BTN;
        if (!EX) {
            bad.push('EXIT_BTN 未导出（冻结版应已导出；relax 退出热区无法门禁）');
        } else {
            log.push('exit x=' + EX.x + '–' + (EX.x + EX.w) + ' y=' + EX.y + '–' + (EX.y + EX.h));
            if (EX.x < 0 || EX.y < 0 || EX.x + EX.w > 720 || EX.y + EX.h > 1280) bad.push('relax 退出热区出屏 x/y/w/h=' + [EX.x, EX.y, EX.w, EX.h].join(','));
            if (EX.y < 120) bad.push('relax 退出热区压到关卡名文字带（y=' + EX.y + '，应 ≥120，文字带 88–112）');
            const xc = { x: EX.x + EX.w / 2, y: EX.y + EX.h / 2 };
            const xr = x42.P;
            xr.homePress(xc.x, xc.y);
            log.push('relax 点退出(' + xc.x + ',' + xc.y + ')→' + xr.app.scene);
            if (xr.app.scene !== 'home') bad.push('relax 点退出后 scene=' + xr.app.scene + '（应 home）');
            const cr = c42.P;
            const crBefore = cr.app.scene;
            cr.homePress(xc.x, xc.y);
            log.push('挑战点同一点位（' + xc.x + ',' + xc.y + '，点击前 ' + crBefore + '）→' + cr.app.scene);
            if (cr.app.scene === 'home') bad.push('挑战模式点退出点位被当成退出（应仍是判定）');
            if (cr.app.scene !== 'play' && cr.app.scene !== 'feedback') bad.push('挑战点同一点位后 scene=' + cr.app.scene + '（应 play 或 feedback：判定已触发）');
        }
        checkWithDetail(NAME, bad.length === 0, (bad.length ? bad.join(' | ') + '｜' : '') + log.join('｜'));
    }
}

/* ---------------- S43：高 DPI / 宽窗口坐标换算（P0 热修回归） ---------------- */
{
    const NAME = 'S43 坐标换算：dpr=2 + 1440×900 下 CSS 点回设计(144,88)｜dpr=1 下也回 (144,88)｜clientX 是 CSS 像素，不许再除一次 dpr';
    let s43 = null, err43 = '';
    try { s43 = loadProto({ search: 'screen=home&progress=12&god=3', storage: {} }); } catch (e) { err43 = String((e && e.message) || e); }
    if (!s43) {
        checkWithDetail(NAME, false, '坐标会话没起来：' + err43);
    } else {
        const P = s43.P, bad = [], log = [];
        if (typeof P.toDesign !== 'function' || !P.view) {
            checkWithDetail(NAME, false, 'toDesign/view 未导出（无法回归高 DPI 坐标）');
        } else {
            const old = { scale: P.view.scale, ox: P.view.ox, oy: P.view.oy, dpr: P.view.dpr };
            /* 1440×900 @dpr2：scale=min(1440/720,900/1280)=0.703125，ox=(1440-720*0.703125)/2=466.875 */
            P.view.scale = Math.min(1440 / 720, 900 / 1280);
            P.view.ox = (1440 - 720 * P.view.scale) / 2;
            P.view.oy = 0;
            P.view.dpr = 2;
            const d2 = P.toDesign(466.875 + 144 * P.view.scale, 88 * P.view.scale);
            log.push('dpr2→(' + d2.x.toFixed(1) + ',' + d2.y.toFixed(1) + ')');
            if (Math.abs(d2.x - 144) > 2 || Math.abs(d2.y - 88) > 2) bad.push('dpr2 换算=' + d2.x.toFixed(1) + ',' + d2.y.toFixed(1) + '（应 144,88）');
            /* dpr1 基线：680×1149，scale=0.898，ox=16.8 */
            P.view.scale = Math.min(680 / 720, 1149 / 1280);
            P.view.ox = (680 - 720 * P.view.scale) / 2;
            P.view.oy = 0;
            P.view.dpr = 1;
            const d1 = P.toDesign(16.8 + 144 * P.view.scale, 88 * P.view.scale);
            log.push('dpr1→(' + d1.x.toFixed(1) + ',' + d1.y.toFixed(1) + ')');
            if (Math.abs(d1.x - 144) > 2 || Math.abs(d1.y - 88) > 2) bad.push('dpr1 换算=' + d1.x.toFixed(1) + ',' + d1.y.toFixed(1) + '（应 144,88）');
            P.view.scale = old.scale; P.view.ox = old.ox; P.view.oy = old.oy; P.view.dpr = old.dpr;
            checkWithDetail(NAME, bad.length === 0, (bad.length ? bad.join(' | ') + '｜' : '') + log.join('｜'));
        }
    }
}

/* ---------------- 汇总 ---------------- */

console.log('');
console.log('==== modes_check (v0.3 双模式 + v0.4 四季60关/特效外置 + v0.5 机制节奏 + v0.6 错拍 + v0.7 道具进关 + v0.9 收集/第2圈/场景双通道 + v0.9.1 收集体验 S39–S43) ====');
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
console.log('RESULT: PASS (M5–M8 + M13–M20 + S1/S2/S3/S5/S6 + S10/S11/S12 + S17/S19/S20/S21 + S22a–d + S30–S43，' + pass + ' 条绿' + tail + ')');
if (skipped.length) {
    console.log('注意：上面这行里的「未执行」= 对应验收的前置还没就绪（错拍：缺 judgeNearest / 数据 / 流程接线；');
    console.log('      道具进关：P2 还没改 levels.csv，或 S22c 的窗口基线没在改表前抓；');
    console.log('      v0.9/v0.9.1：collection.json 没进产物 / levels.json 不可读）。不要当成通过。');
}
console.log('');
