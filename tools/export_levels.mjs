/**
 * tools/export_levels.mjs —— 策划 CSV → 运行时 JSON（单一数据源，可重复执行）
 *
 *   node tools/export_levels.mjs            # 生成 assets/resources/config/levels.json + judge_rule.json
 *   node tools/export_levels.mjs --check    # 只校验「已提交的 JSON 是否与 CSV 一致」，不写文件
 *
 * 派生字段：linSpeed（px/s）、angSpeed（deg/s）。派生值只做「与策划目标区间比对」，偏差 >5% 打 WARN（不 fail）：
 * 因为 CSV 的速度是**手感目标**，派生值是**实现出来的实际值**，两者不一致要让策划知道，但不该卡住构建。
 *
 * 速度口径（与核心层一致）：
 *   两段变速 speedStage=k → 前 40% 周期速度 ×k、后 60% ×(2−k)，总距离不变
 *   linSpeed = [min(k,2−k)·v0·1000, max(k,2−k)·v0·1000]，v0 = 路径长 / cycleMs / (0.4k + 0.6(2−k))
 *   angSpeed = 360·|turns| / (cycleMs/1000)（旋转按冻结口径线性的时间，不随两段变速变化）
 */

import path from 'node:path';
import fs from 'node:fs';
import { ROOT, readText, readJson, writeJson, parseCsv, rel, round1, makeReporter, printTable, exists, C } from './_io.mjs';
import { placeholderShapes } from './_placeholder_shapes.mjs';
import { core } from './_core.mjs';

// 核心层是全工程唯一判定口径：这里只取数，不复制算法
const {
    buildPathPts,
    pathLength,
    speedProfile,
    sineIntegral,
    readMotion,
    readDuo,
    isStaggered,
    perMoverWindows,
    moverTiming,
    judgeMover,
    TARGET_SINGLE,
    TARGET_DUAL,
    judgeRuleSnapshot,
    inspectLevels,
    inspectShapes,
    buildLevel,
    windowMetrics,
    godWindow,
    starWindow,
} = core;

const CSV_PATH = path.join(ROOT, '01_策划文档/levels.csv');
const OUT_LEVELS = path.join(ROOT, 'assets/resources/config/levels.json');
const RELAX_CSV = path.join(ROOT, '01_策划文档/levels_relax.csv');
const OUT_RELAX = path.join(ROOT, 'assets/resources/config/levels_relax.json');
const OUT_RULE = path.join(ROOT, 'assets/resources/config/judge_rule.json');
const SHAPES_PATH = path.join(ROOT, 'assets/config/shapes.json');
const SHAPES_OUT = path.join(ROOT, 'assets/resources/config/shapes.json');
const WARN_TOL = 0.05;
const CHECK_TOL = 0.005;

const CHECK_ONLY = process.argv.includes('--check');
/** 漂移门禁模式：默认只对「已校准的季 1」FAIL，季 2–4 草稿期 WARN；--strict-drift 时全 FAIL（发版用） */
const STRICT_DRIFT = process.argv.includes('--strict-drift');

const num = (s) => {
    const v = Number(s);
    return Number.isFinite(v) ? v : NaN;
};
/** CSV 可选列 → 空串/NaN 时用默认值（注意 0 是合法值，不能用 `||`） */
const numOr = (s, dflt) => {
    if (s === undefined || s === null || s === '') return dflt;
    const v = Number(s);
    return Number.isFinite(v) ? v : dflt;
};

/** 派生速度：与 buildLevel 用同一套路径与变速公式（v0.4 含正弦调制） */
function derive(def) {
    const c = def.variant === 'dual' ? { x: TARGET_DUAL[0].cx, y: TARGET_DUAL[0].cy } : { x: TARGET_SINGLE.cx, y: TARGET_SINGLE.cy };
    const pts = buildPathPts(def.path, c);
    const len = pathLength(pts);
    const p = speedProfile(def.speedStage, def.cycleMs);
    const amp = def.sineAmp ?? 0;
    const phase = def.sinePhase ?? 0;
    const periodSec = Math.max(1, def.sinePeriodMs ?? 960) / 1000;
    // 距离积分（秒）：D = k1·I(ts) + k2·(I(T) − I(ts))，v0 = 路径长 / D（px/s）
    // 相位只改变余弦项，会轻微改变 D 与 v0（所以这里必须带 phase，否则派生速度对不齐）
    const iS = sineIntegral(p.switchMs / 1000, amp, periodSec, phase);
    const iC = sineIntegral(def.cycleMs / 1000, amp, periodSec, phase);
    const dTotal = p.k1 * iS + p.k2 * (iC - iS);
    const v0 = dTotal > 1e-9 ? len / dTotal : 0;
    const loStage = Math.min(p.k1, p.k2);
    const hiStage = Math.max(p.k1, p.k2);
    // 正弦让「快相位/慢相位」各有一段：区间取 [慢相位最慢, 快相位最快]
    const lin = [round1(v0 * loStage * (1 - amp)), round1(v0 * hiStage * (1 + amp))];
    const angV = round1((360 * Math.abs(def.turns)) / (def.cycleMs / 1000));
    return { pathLen: len, lin, ang: [angV, angV] };
}

/** 派生值 vs 策划目标区间：越界超过 tol 才报 */
function deviation(derived, min, max, tol) {
    let dev = 0;
    let side = '';
    if (derived[0] < min * (1 - tol)) {
        const d = ((derived[0] - min) / min) * 100;
        if (Math.abs(d) > Math.abs(dev)) {
            dev = d;
            side = '低';
        }
    }
    if (derived[1] > max * (1 + tol)) {
        const d = ((derived[1] - max) / max) * 100;
        if (Math.abs(d) > Math.abs(dev)) {
            dev = d;
            side = '高';
        }
    }
    return { over: Math.abs(dev) > tol * 100, dev, side };
}

function main() {
    const rep = makeReporter(`export_levels${CHECK_ONLY ? '（--check）' : ''}`);
    if (!exists(CSV_PATH)) {
        rep.bad(`找不到策划表 ${rel(CSV_PATH)}`);
        return rep.finish();
    }
    const { header, rows } = parseCsv(readText(CSV_PATH));
    const need = [
        'id', 'name', 'object_id', 'outline_id', 'motion_type', 'ang_speed_min', 'ang_speed_max',
        'lin_speed_min', 'lin_speed_max', 'jitter', 'tolerance_deg', 'pass_rate', 'star3_rate',
        'est_seconds', 'weight', 'note', 'path', 'cycle_ms', 'turns', 'speed_stage', 'variant',
        'object_id_2', 'attempts',
    ];
    const missing = need.filter((k) => !header.includes(k));
    if (missing.length > 0) {
        rep.bad(`CSV 缺列：${missing.join(' / ')}`);
        return rep.finish();
    }
    rep.ok(`读入 CSV：${rows.length} 行 × ${header.length} 列`, rel(CSV_PATH));
    // 运动调制列是「可选」的：缺列按 0 处理（向后兼容旧表），但要明确告知
    const MOTION_COLS = ['season', 'sine_amp', 'sine_period_ms', 'sine_phase', 'inertia_px', 'inertia_hz', 'inertia_phase'];
    const missingMotion = MOTION_COLS.filter((k) => !header.includes(k));
    if (missingMotion.length > 0) {
        rep.warn(`CSV 缺运动调制列：${missingMotion.join(' / ')} → 按缺省值处理（season=1 / sineAmp=0 / sinePhase=0 / inertia=0）`);
    } else {
        rep.info('运动调制列：season / sine_amp / sine_period_ms / sine_phase / inertia_px / inertia_hz / inertia_phase 全部就位');
    }

    const levels = [];
    const table = [];
    let warnCount = 0;
    let placeholderLin = 0;
    for (const r of rows) {
        const def = {
            id: num(r.id),
            name: r.name,
            shapeId: r.object_id,
            outlineId: r.outline_id,
            variant: r.variant,
            motion: r.motion_type,
            path: r.path,
            cycleMs: num(r.cycle_ms),
            turns: num(r.turns),
            jitter: num(r.jitter),
            toleranceDeg: num(r.tolerance_deg),
            passRate: num(r.pass_rate),
            star3Rate: num(r.star3_rate),
            estSec: num(r.est_seconds),
            weight: num(r.weight),
            attempts: num(r.attempts),
            note: r.note,
            speedStage: num(r.speed_stage),
            shapeId2: r.object_id_2 ? r.object_id_2 : undefined,
            // 策划给的「目标命中窗口（单侧 ms）」，用于窗口漂移门禁（>15% → 季 1 FAIL / 季 2–4 WARN）
            hitTargetMs: r.hit_target_ms !== undefined && r.hit_target_ms !== '' ? num(r.hit_target_ms) : null,
            // 关卡时限（秒）：0 = 用模式默认；错拍关主策划会写 20
            timeLimitSec: r.time_limit_sec ? numOr(r.time_limit_sec, 0) : 0,
            ...readMotion(r),
            ...readDuo(r),
        };
        const d = derive(def);
        def.linSpeed = d.lin;
        def.angSpeed = d.ang;
        // 键顺序固定，保证 diff 稳定
        levels.push({
            id: def.id,
            name: def.name,
            shapeId: def.shapeId,
            outlineId: def.outlineId,
            variant: def.variant,
            motion: def.motion,
            path: def.path,
            cycleMs: def.cycleMs,
            turns: def.turns,
            jitter: def.jitter,
            toleranceDeg: def.toleranceDeg,
            passRate: def.passRate,
            star3Rate: def.star3Rate,
            estSec: def.estSec,
            weight: def.weight,
            attempts: def.attempts,
            note: def.note,
            speedStage: def.speedStage,
            ...(def.shapeId2 ? { shapeId2: def.shapeId2 } : {}),
            hitTargetMs: def.hitTargetMs,
            season: def.season,
            sineAmp: def.sineAmp,
            sinePeriodMs: def.sinePeriodMs,
            sinePhase: def.sinePhase,
            phase2: def.phase2,
            cycle2Ms: def.cycle2Ms,
            timeLimitSec: def.timeLimitSec,
            inertiaPx: def.inertiaPx,
            inertiaHz: def.inertiaHz,
            inertiaPhase: def.inertiaPhase,
            linSpeed: d.lin,
            angSpeed: d.ang,
        });
        const linCsv = [num(r.lin_speed_min), num(r.lin_speed_max)];
        const angCsv = [num(r.ang_speed_min), num(r.ang_speed_max)];
        // 季 2–4 的 lin 列在草稿阶段是占位值（0/0、1/1）→ 跳过比对，避免 45 条噪音 WARN
        const linPlaceholder = !(linCsv[1] > 1);
        const angPlaceholder = !(angCsv[1] > 1);
        const linDev = linPlaceholder ? { over: false, dev: 0, side: '' } : deviation(d.lin, linCsv[0], linCsv[1], WARN_TOL);
        const angDev = angPlaceholder ? { over: false, dev: 0, side: '' } : deviation(d.ang, angCsv[0], angCsv[1], WARN_TOL);
        const isWarn = linDev.over || angDev.over;
        if (isWarn) warnCount++;
        if (linPlaceholder) placeholderLin++;
        table.push([
            def.season,
            def.id,
            def.name,
            def.path,
            def.cycleMs,
            def.turns,
            def.speedStage,
            `${d.lin[0]}–${d.lin[1]}`,
            linPlaceholder ? '(占位)' : `${linCsv[0]}–${linCsv[1]}`,
            linDev.over ? `${linDev.side}${linDev.dev.toFixed(1)}%` : 'ok',
            `${d.ang[0]}`,
            angPlaceholder ? '(占位)' : `${angCsv[0]}–${angCsv[1]}`,
            angDev.over ? `${angDev.side}${angDev.dev.toFixed(1)}%` : 'ok',
        ]);
    }

    printTable(
        ['季', '关', '名字', '路径', '周期', '圈', 'k', '派生线速', 'CSV 目标', '偏差', '派生角速', 'CSV 目标', '偏差'],
        table,
        ['r', 'r', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    );
    if (warnCount > 0) {
        console.log(C.yellow(`\n  WARN：${warnCount} 关的派生速度超出策划目标区间 5% 以上（不阻塞构建，需策划确认：改 cycleMs 还是改目标区间）`));
    } else {
        console.log(C.green('  派生速度全部落在策划目标区间 ±5% 内'));
    }
    if (placeholderLin > 0) {
        console.log(C.dim(`  ${placeholderLin} 关的 lin_speed 目标列是占位值（≤1），已跳过比对；季 2–4 校准后重跑本工具即可`));
    }
    // S1 轻量检查：每季 15 关、season 连续、id 连续
    const seasonCount = new Map();
    for (const lv of levels) seasonCount.set(lv.season, (seasonCount.get(lv.season) || 0) + 1);
    const seasonStr = [...seasonCount.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `季${s}:${n}`).join('  ');
    rep.info(`季节分布：${seasonStr}`);
    if (seasonCount.size !== 4 || [...seasonCount.values()].some((n) => n !== 15)) {
        rep.warn(`季节分布不是「4 季 × 15 关」（实际 ${seasonStr}）—— S1 不满足，请主策划确认 CSV`);
    } else if (levels.some((lv, i) => lv.id !== i + 1)) {
        rep.warn('id 不是 1..60 连续 —— S1 不满足');
    } else {
        rep.ok('S1 结构检查：4 季 × 15 关，id 1–60 连续');
    }

    // 用运行时同一套校验兜底（14 字段完整性 / 取值范围 / dual 必须有第二个物体）
    const insp = inspectLevels({ levels });
    for (const w of insp.warnings) rep.warn(w);
    if (insp.errors.length > 0) {
        for (const e of insp.errors) rep.bad(e);
        return rep.finish();
    }
    rep.ok(`levels.json 结构校验通过（${levels.length} 关，14 必填字段 + 取值范围）`);

    // ---- 命中窗口（P0）：策划调难度曲线的主指标，与 sim.mjs 共用 windowMetrics() ----
    // 口径：seed=0 固定，从 perfectMs 向早/晚二分到 judge().pass 的边界，精度 0.5ms
    let shapes = null;
    let shapeSource = '';
    if (exists(SHAPES_PATH)) {
        const insp = inspectShapes(readJson(SHAPES_PATH));
        if (insp.errors.length === 0) {
            shapes = insp.shapes;
            shapeSource = 'assets/config/shapes.json（美术真数据）';
        } else {
            rep.warn(`assets/config/shapes.json 有 ${insp.errors.length} 项错误，暂用占位形状算窗口（修好后重跑本工具即可）`);
            for (const e of insp.errors.slice(0, 5)) rep.warn('  ' + e);
        }
    } else {
        rep.warn('assets/config/shapes.json 不存在 → 用 tools/_placeholder_shapes.mjs 占位形状算窗口（真数据到位后自动切换）');
    }
    if (!shapes) shapes = placeholderShapes();
    rep.info(`窗口计算形状来源：${shapeSource || 'tools/_placeholder_shapes.mjs（占位）'}`);

    const winRows = [];
    const godRows = [];
    let wideWarn = 0;
    let driftFail = 0;
    let driftWarn = 0;
    let maxDrift = 0;
    let maxDriftS1 = 0;
    let driftChecked = 0;
    const DRIFT_TOL = 0.15;
    for (const lv of levels) {
        try {
            const rt = buildLevel(lv, shapes, 0); // seed 固定 0，窗口才可复现
            // v0.6：错拍关走 core 的自动分支（hitWindow/godWindow/starWindow 内部按「每 mover 各自 perfectMs」算，
            // 关卡窗口 = 较窄者）；同步关行为与 v0.5 逐位相同。这里不再自己拼窗口，避免「用错时间基准」。
            const staggered = isStaggered(lv);
            const wm = windowMetrics(rt);
            const w = { earlyMs: wm.earlyMs, lateMs: wm.lateMs, earlyWide: wm.earlyWide, lateWide: wm.lateWide };
            const gw = godWindow(rt);
            const sw = starWindow(rt);
            lv.tolDegActual = round1(wm.tolDeg);
            lv.tolPxActual = round1(wm.tolPx);
            if (staggered) {
                const pm = perMoverWindows(rt);
                lv.hitWindowByMover = pm.hit.map((x) => ({ earlyMs: round1(x.earlyMs), lateMs: round1(x.lateMs) }));
                lv.godWindowByMover = pm.god.map((x) => ({ earlyMs: round1(x.earlyMs), lateMs: round1(x.lateMs) }));
                lv.perfectMsByMover = rt.movers.map((m) => round1(moverTiming(m).perfectMs));
            }
            lv.hitWindow = { earlyMs: round1(w.earlyMs), lateMs: round1(w.lateMs) };
            lv.godWindow = { earlyMs: round1(gw.earlyMs), lateMs: round1(gw.lateMs) };
            lv.starWindow = { earlyMs: round1(sw.earlyMs), lateMs: round1(sw.lateMs) };
            const wide = w.earlyWide || w.lateWide;
            if (wide) wideWarn++;

            // 窗口漂移门禁：实测窗口 vs 策划写的 hit_target_ms（较宽一侧，>15%）
            // 季 1 = 已校准、必须守住 → FAIL；季 2–4 是草稿值、正在反解 → WARN；--strict-drift 时全 FAIL
            let drift = null;
            let driftGated = false;
            const target = lv.hitTargetMs;
            if (typeof target === 'number' && isFinite(target) && target > 0) {
                driftChecked++;
                const dEarly = Math.abs(Math.abs(w.earlyMs) - target) / target;
                const dLate = Math.abs(Math.abs(w.lateMs) - target) / target;
                drift = Math.max(dEarly, dLate);
                lv.windowDriftPct = round1(drift * 100);
                if (drift > maxDrift) maxDrift = drift;
                if (lv.season === 1 && drift > maxDriftS1) maxDriftS1 = drift;
                driftGated = STRICT_DRIFT || lv.season === 1;
                if (drift > DRIFT_TOL) {
                    const msg = `L${lv.id}（季${lv.season}）窗口漂移 ${(drift * 100).toFixed(1)}% > ${DRIFT_TOL * 100}%（实测 早${w.earlyMs.toFixed(1)}/晚${w.lateMs.toFixed(1)}ms，目标 ±${target}ms）`;
                    if (driftGated) {
                        driftFail++;
                        rep.bad(`${msg} —— 已校准的关卡不许漂；美术改了 shapes.json？还是 cycle_ms/turns 变了？`);
                    } else {
                        driftWarn++;
                        rep.warn(`${msg} —— 季 2–4 草稿值，等 tuner 反解 cycle 后自动收敛`);
                    }
                }
            } else {
                lv.windowDriftPct = null;
            }

            winRows.push([
                `季${lv.season}`,
                `L${lv.id}`,
                lv.name,
                `${lv.cycleMs}`,
                `${lv.turns}`,
                `${lv.speedStage}`,
                `${lv.sineAmp}`,
                `${lv.inertiaPx}`,
                `${lv.linSpeed[0]}–${lv.linSpeed[1]}`,
                w.earlyMs.toFixed(1),
                w.lateMs.toFixed(1),
                // 注意：tolDegActual/tolPxActual 是 round1 后的数字；w 只携带窗口四件套（不含 tol*）
                lv.tolDegActual === null ? '-' : lv.tolDegActual.toFixed(1),
                lv.tolPxActual === null ? '-' : lv.tolPxActual.toFixed(1),
                drift === null ? '-' : `${(drift * 100).toFixed(1)}%`,
                staggered ? `错拍 φ2=${lv.phase2}` : '',
                wide ? '窗口触周期边界!' : '',
            ]);
            godRows.push([
                `L${lv.id}`,
                `${lv.passRate}`,
                `${lv.star3Rate}`,
                sw.earlyMs.toFixed(1),
                sw.lateMs.toFixed(1),
                (Math.abs(sw.earlyMs) + Math.abs(sw.lateMs)).toFixed(1),
                gw.earlyMs.toFixed(1),
                gw.lateMs.toFixed(1),
                (Math.abs(gw.earlyMs) + Math.abs(gw.lateMs)).toFixed(1),
            ]);
        } catch (e) {
            lv.hitWindow = null;
            lv.godWindow = null;
            lv.starWindow = null;
            lv.windowDriftPct = null;
            lv.tolDegActual = null;
            lv.tolPxActual = null;
            winRows.push([`季${lv.season}`, `L${lv.id}`, lv.name, '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', `算不出：${e.message}`]);
            rep.warn(`L${lv.id} 命中窗口算不出来：${e.message}（缺形状？）`);
        }
    }
    printTable(
        ['季', '关', '名字', '周期ms', '圈', 'k', '正弦', '惯性px', '线速px/s', '早ms', '晚ms', '角容错°', '位移容错px', '漂移', '错拍', '告警'],
        winRows,
        ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l', 'l'],
    );
    printTable(
        ['关', 'pass阈值', '三星阈值', '三星早', '三星晚', '三星窗宽', '神级早', '神级晚', '神级窗宽'],
        godRows,
        ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    );
    // 窗口漂移门禁汇总（美术改 shapes.json 后窗口会漂，这是唯一能自动发现漂移的闸门）
    if (driftChecked === 0) {
        rep.warn('窗口漂移检查：CSV 没有 hit_target_ms 列，跳过（建议策划补上「目标窗口」以便自动发现漂移）');
    } else if (driftFail === 0) {
        rep.ok(
            `窗口漂移检查：季 1 通过 15/15（最大 ${(maxDriftS1 * 100).toFixed(1)}%）` +
                (driftWarn > 0 ? `；季 2–4 参考值超差 ${driftWarn} 关（最大 ${(maxDrift * 100).toFixed(1)}%，草稿期 WARN 不算失败）` : '') +
                `；门禁 ${DRIFT_TOL * 100}%`,
        );
    } else {
        rep.bad(`窗口漂移检查：${driftFail} 关超 ${DRIFT_TOL * 100}%（已校准季不许漂），最大 ${(maxDrift * 100).toFixed(1)}%`);
    }
    rep.ok(`命中窗口算完（${levels.length} 关，seed=0，精度 0.5ms）${wideWarn > 0 ? '，其中 ' + wideWarn + ' 关窗口触到半周期边界' : ''}`);

    if (CHECK_ONLY) {
        if (!exists(OUT_LEVELS)) {
            rep.bad('--check：levels.json 不存在，请先跑一次不带 --check 的导出');
            return rep.finish();
        }
        if (exists(SHAPES_PATH) && exists(SHAPES_OUT)) {
            if (fs.readFileSync(SHAPES_PATH, 'utf8') === fs.readFileSync(SHAPES_OUT, 'utf8')) rep.ok('--check：resources/config/shapes.json 与美术源文件一致');
            else rep.bad('--check：resources/config/shapes.json 与 assets/config/shapes.json 不一致（Cocos 会读到旧轮廓！重跑导出即可同步）');
        } else if (exists(SHAPES_PATH) && !exists(SHAPES_OUT)) {
            rep.bad('--check：resources/config/shapes.json 缺失（Cocos 侧 resources.load 会失败），重跑导出即可生成');
        }
        const cur = readJson(OUT_LEVELS);
        const curList = Array.isArray(cur) ? cur : cur.levels || [];
        const byId = new Map(curList.map((l) => [l.id, l]));
        let diffs = 0;
        const ignore = new Set(['linSpeed', 'angSpeed', 'hitWindow', 'godWindow', 'starWindow', 'windowDriftPct', 'tolDegActual', 'tolPxActual']);
        for (const l of levels) {
            const c = byId.get(l.id);
            if (!c) {
                rep.bad(`--check：levels.json 缺 L${l.id}`);
                diffs++;
                continue;
            }
            for (const k of Object.keys(l)) {
                if (ignore.has(k)) continue;
                if (JSON.stringify(c[k]) !== JSON.stringify(l[k])) {
                    rep.bad(`--check：L${l.id}.${k} 不一致：json=${JSON.stringify(c[k])} csv=${JSON.stringify(l[k])}`);
                    diffs++;
                }
            }
            const relDiff = (a, b) => (Math.abs(b) < 1e-9 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b));
            const linDiff = Math.max(relDiff(c.linSpeed?.[0] ?? 0, l.linSpeed[0]), relDiff(c.linSpeed?.[1] ?? 0, l.linSpeed[1]));
            if (linDiff > CHECK_TOL) {
                rep.warn(`--check：L${l.id}.linSpeed 与 CSV 派生值差 ${(linDiff * 100).toFixed(2)}%（json=${JSON.stringify(c.linSpeed)} csv=${JSON.stringify(l.linSpeed)}，重跑导出即可修）`);
            }
            // 命中窗口是派生值：形状文件一变就会变，给 0.2ms / 0.1° 容差
            if (l.hitWindow && c.hitWindow) {
                const de = Math.abs(c.hitWindow.earlyMs - l.hitWindow.earlyMs);
                const dlate = Math.abs(c.hitWindow.lateMs - l.hitWindow.lateMs);
                if (de > 0.2 || dlate > 0.2) {
                    rep.warn(`--check：L${l.id}.hitWindow 变了（json=[${c.hitWindow.earlyMs},${c.hitWindow.lateMs}] 重算=[${l.hitWindow.earlyMs},${l.hitWindow.lateMs}]，形状或数值改过？重跑导出）`);
                }
            } else if (l.hitWindow && !c.hitWindow) {
                rep.warn(`--check：L${l.id} 的 levels.json 里没有 hitWindow，重跑导出补上`);
            } else if (!l.hitWindow && c.hitWindow) {
                rep.warn(`--check：L${l.id} 现在算不出窗口（缺形状？），json 里却是 ${JSON.stringify(c.hitWindow)}`);
            }
        }
        if (diffs === 0) rep.ok('--check：levels.json 与 CSV 完全一致');

        // 错拍字段守门：CSV 有 phase_2 列 → JSON 必须有对应 phase2（防「写了但被 JSON.stringify 丢掉」）
        {
            const cur = readJson(OUT_LEVELS);
            const curList = Array.isArray(cur) ? cur : cur.levels || [];
            const byId2 = new Map(curList.map((l) => [l.id, l]));
            if (header.includes('phase_2')) {
                const badPhase = [];
                let staggeredCount = 0;
                for (const r of rows) {
                    const id = numOr(r.id, NaN);
                    const c = byId2.get(id);
                    if (!c) continue;
                    const csvPhase = numOr(r.phase_2, 0);
                    if (csvPhase > 0) staggeredCount++;
                    const jsonPhase = typeof c.phase2 === 'number' ? c.phase2 : 0;
                    if (Math.abs(jsonPhase - csvPhase) > 1e-9) badPhase.push(`L${id}: csv=${csvPhase} json=${jsonPhase}`);
                }
                if (badPhase.length > 0) {
                    rep.bad(`--check：phase2 与 CSV 不一致（${badPhase.length} 关）：${badPhase.slice(0, 5).join('；')}`);
                } else {
                    rep.ok(`--check：phase2 与 CSV 一致（${staggeredCount} 关错拍）`);
                }
            } else {
                const withPhase = curList.filter((l) => (l.phase2 ?? 0) > 0).length;
                if (withPhase > 0) rep.warn(`--check：CSV 没有 phase_2 列，但 levels.json 有 ${withPhase} 关 phase2>0（数据来源不一致）`);
                else rep.ok('--check：CSV 无 phase_2 列，levels.json phase2 全为 0');
            }
        }
        const rule = judgeRuleSnapshot();
        if (exists(OUT_RULE)) {
            const curRule = readJson(OUT_RULE);
            rep.ok(
                `--check：judge_rule.json ${JSON.stringify(curRule.ratings?.map((r) => r.minPercent)) === JSON.stringify(rule.ratings?.map((r) => r.minPercent)) ? '评级表一致' : '评级表**不一致**，重跑导出'}`,
            );
        } else rep.bad('--check：judge_rule.json 不存在');

        // relax 一致性（客户端两模式都吃 JSON，任一缺失就会回落到 CSV fallback）
        if (exists(RELAX_CSV)) {
            if (!exists(OUT_RELAX)) {
                rep.bad('--check：levels_relax.json 缺失（客户端会回落到 CSV），重跑导出');
            } else {
                const curRelax = readJson(OUT_RELAX);
                const curList = Array.isArray(curRelax) ? curRelax : curRelax.levels || [];
                const csvRows = parseCsv(readText(RELAX_CSV)).rows;
                let relaxDiffs = 0;
                if (curList.length !== csvRows.length) {
                    rep.bad(`--check：levels_relax.json 有 ${curList.length} 关，CSV 有 ${csvRows.length} 行`);
                    relaxDiffs++;
                }
                const byId = new Map(curList.map((l) => [l.id, l]));
                for (const r of csvRows) {
                    const id = numOr(r.id, NaN);
                    const c = byId.get(id);
                    if (!c) {
                        rep.bad(`--check：levels_relax.json 缺 L${id}`);
                        relaxDiffs++;
                        continue;
                    }
                    if (c.shapeId !== r.object_id || c.path !== r.path || Math.abs(c.cycleMs - numOr(r.cycle_ms, NaN)) > 1e-6) {
                        rep.bad(
                            `--check：relax L${id} 不一致（shape ${c.shapeId}/${r.object_id}、path ${c.path}/${r.path}、cycle ${c.cycleMs}/${r.cycle_ms}）`,
                        );
                        relaxDiffs++;
                    }
                }
                if (relaxDiffs === 0) rep.ok(`--check：levels_relax.json 与 CSV 一致（${curList.length} 关）`);
            }
        }

        // 两模式口径守门（v0.4 冻结）：attempts 必须逐个相同 —— HUD 次数点按它画
        if (exists(OUT_RELAX) && exists(OUT_LEVELS)) {
            const chRaw = readJson(OUT_LEVELS);
            const chList = Array.isArray(chRaw) ? chRaw : chRaw.levels || [];
            const chMap = new Map(chList.map((l) => [l.id, l]));
            const rlRaw = readJson(OUT_RELAX);
            const rlList = Array.isArray(rlRaw) ? rlRaw : rlRaw.levels || [];
            const aDiff = [];
            for (const lv of rlList) {
                const c = chMap.get(lv.id);
                if (c && c.attempts !== lv.attempts) aDiff.push(`L${lv.id}: challenge=${c.attempts} relax=${lv.attempts}`);
            }
            if (aDiff.length > 0) {
                rep.bad(`--check：两模式 attempts 不一致（${aDiff.length} 关）：${aDiff.slice(0, 5).join('；')}${aDiff.length > 5 ? ' …' : ''}`);
            } else {
                rep.ok(`--check：attempts 口径一致（relax × ${rlList.length} 关 = challenge）`);
            }
        }
        return rep.finish();
    }

    writeJson(OUT_LEVELS, {
        version: 1,
        generatedBy: 'tools/export_levels.mjs',
        source: '01_策划文档/levels.csv',
        note: 'linSpeed/angSpeed 为派生字段（工具重算，运行时只读）；hitWindow/godWindow/starWindow/tolDegActual/tolPxActual 为派生值（seed=0，形状或数值一变就重算）；改数值一律改 CSV 后重跑本工具',
        levelCount: levels.length,
        levels,
    });
    writeJson(OUT_RULE, judgeRuleSnapshot());
    rep.ok(`写出 ${rel(OUT_LEVELS)}（${levels.length} 关）`);
    rep.ok(`写出 ${rel(OUT_RULE)}（评级表/连击/模式系数）`);

    // Cocos 的 resources.load 只认 assets/resources/ → 同步一份 shapes 副本（源文件不动）
    if (exists(SHAPES_PATH)) {
        fs.mkdirSync(path.dirname(SHAPES_OUT), { recursive: true });
        fs.copyFileSync(SHAPES_PATH, SHAPES_OUT);
        const kb = (fs.statSync(SHAPES_OUT).size / 1024).toFixed(1);
        rep.ok(`shapes 已同步 ${kb} KB → ${rel(SHAPES_OUT)}（源 ${rel(SHAPES_PATH)} 未改动）`);
    } else {
        rep.warn('assets/config/shapes.json 不存在 → 跳过 shapes 同步（美术交付后重跑本工具，Cocos 侧才能 resources.load 到）');
    }

    // ---- 催眠模式（relax）导出：同一套 core、同一个 loadLevels/buildLevel，两模式数据流统一 ----
    exportRelax(rep, levels);
    return rep.finish();
}

/**
 * 导出 `assets/resources/config/levels_relax.json`（60 行）。
 * relax 的 CSV 只给了 id/season/name/object_id/motion_type/path/cycle/turns/jitter/sine/inertia/variant/object_id_2，
 * 其余字段用**惰性默认值**补齐，但结构必须与 levels.json 同构，这样客户端只走一条 loadLevels → buildLevel 的路径。
 *
 * 两个口径（v0.4 冻结）：
 *  - `attempts` = **3**（催眠也是 3 次/关，失败扣 1 次、用完重开本关、无倒计时）——HUD 按它画次数点；
 *  - `passRate` 保留 0.6（在 relax 里是「合格 → 下一关」的合格线，不能置空）。
 * 导出末尾会校验 relax 与 challenge 的 `attempts` 逐个相同（两模式只在计时/判榜上不同）。
 */
function exportRelax(rep, challengeLevels) {
    if (!exists(RELAX_CSV)) {
        rep.warn(`没有 ${rel(RELAX_CSV)}，跳过 relax 导出（客户端会继续用 CSV fallback）`);
        return;
    }
    const { header, rows } = parseCsv(readText(RELAX_CSV));
    const needMin = ['id', 'object_id', 'path', 'cycle_ms', 'turns', 'jitter'];
    const lack = needMin.filter((k) => !header.includes(k));
    if (lack.length > 0) {
        rep.bad(`levels_relax.csv 缺列：${lack.join(' / ')}`);
        return;
    }
    const levels = [];
    for (const r of rows) {
        const objectId = r.object_id;
        const def = {
            id: numOr(r.id, NaN),
            name: r.name || `放松·${r.id}`,
            shapeId: objectId,
            outlineId: r.outline_id || objectId,
            variant: r.variant || 'single',
            motion: r.motion_type || '旋转',
            path: r.path,
            cycleMs: numOr(r.cycle_ms, NaN),
            turns: numOr(r.turns, 1),
            jitter: numOr(r.jitter, 0),
            // 放松模式阈值（结构占位；passRate 在 relax 里是「合格→下一关」的合格线，保留 0.6）
            toleranceDeg: numOr(r.tolerance_deg, 15),
            passRate: numOr(r.pass_rate, 0.6),
            star3Rate: numOr(r.star3_rate, 0.94),
            estSec: numOr(r.est_seconds, 8),
            weight: numOr(r.weight, 1),
            // 催眠也是 3 次/关（与挑战一致）：HUD 按 def.attempts 画次数点，填 1 会只画一个点
            attempts: numOr(r.attempts, 3),
            note: r.note || 'relax',
            speedStage: numOr(r.speed_stage, 1),
            shapeId2: r.object_id_2 || undefined,
            hitTargetMs: r.hit_target_ms ? numOr(r.hit_target_ms, null) : null,
            timeLimitSec: r.time_limit_sec ? numOr(r.time_limit_sec, 0) : 0,
            ...readMotion(r),
            ...readDuo(r),
        };
        const d = derive(def);
        levels.push({
            id: def.id,
            name: def.name,
            shapeId: def.shapeId,
            outlineId: def.outlineId,
            variant: def.variant,
            motion: def.motion,
            path: def.path,
            cycleMs: def.cycleMs,
            turns: def.turns,
            jitter: def.jitter,
            toleranceDeg: def.toleranceDeg,
            passRate: def.passRate,
            star3Rate: def.star3Rate,
            estSec: def.estSec,
            weight: def.weight,
            attempts: def.attempts,
            note: def.note,
            speedStage: def.speedStage,
            ...(def.shapeId2 ? { shapeId2: def.shapeId2 } : {}),
            hitTargetMs: def.hitTargetMs,
            season: def.season,
            sineAmp: def.sineAmp,
            sinePeriodMs: def.sinePeriodMs,
            sinePhase: def.sinePhase,
            phase2: def.phase2,
            cycle2Ms: def.cycle2Ms,
            timeLimitSec: def.timeLimitSec,
            inertiaPx: def.inertiaPx,
            inertiaHz: def.inertiaHz,
            inertiaPhase: def.inertiaPhase,
            linSpeed: d.lin,
            angSpeed: d.ang,
        });
    }
    const insp = inspectLevels({ levels });
    for (const w of insp.warnings) rep.warn(`relax ${w}`);
    if (insp.errors.length > 0) {
        for (const e of insp.errors) rep.bad(`relax ${e}`);
        return;
    }
    writeJson(OUT_RELAX, {
        version: 1,
        mode: 'relax',
        generatedBy: 'tools/export_levels.mjs',
        source: '01_策划文档/levels_relax.csv',
        note: '放松模式：不计榜、无倒计时；attempts=3（与挑战一致，HUD 画 3 个次数点）、passRate=0.6 是「合格→下一关」的合格线；toleranceDeg/star3Rate/estSec 为结构占位默认值，改体验请改 cycle/turns/路径',
        levelCount: levels.length,
        levels,
    });
    rep.ok(`写出 ${rel(OUT_RELAX)}（${levels.length} 关 relax，结构与 levels.json 同构）`);

    // S2：前 15 关道具一致
    if (challengeLevels.length >= 15 && levels.length >= 15) {
        const same = challengeLevels.slice(0, 15).every((c, i) => c.shapeId === levels[i].shapeId);
        if (same) rep.ok('S2 前 15 关道具一致：relax[0..14].shapeId === challenge[0..14].shapeId');
        else rep.warn('S2 前 15 关道具不一致（relax 与 challenge 的 object_id 不同）—— 规格要求两条模式前 15 关道具相同');
    }

    // 两模式口径守门：attempts 必须逐个相同（两模式只在计时/判榜上不同，次数点不该不一样）
    const chById = new Map(challengeLevels.map((l) => [l.id, l]));
    const attemptDiff = [];
    for (const lv of levels) {
        const c = chById.get(lv.id);
        if (!c) continue;
        if (c.attempts !== lv.attempts) attemptDiff.push(`L${lv.id}: challenge=${c.attempts} relax=${lv.attempts}`);
    }
    if (attemptDiff.length > 0) {
        rep.bad(`两模式 attempts 不一致（${attemptDiff.length} 关）：${attemptDiff.slice(0, 5).join('；')}${attemptDiff.length > 5 ? ' …' : ''}`);
    } else {
        rep.ok(`attempts 口径一致：relax × ${levels.length} 关全部 = challenge（HUD 次数点两边相同）`);
    }
}

process.exit(main());
