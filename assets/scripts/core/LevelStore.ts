/**
 * LevelStore.ts —— 关卡配置加载（校验）+ 运行时构建
 *
 * 数据流：01_策划文档/levels.csv --(tools/export_levels.mjs)--> assets/resources/config/levels.json --> loadLevels()
 * 校验原则：宁可启动时报错，也不要线上出现「第 7 关不动」这种脏数据事故。
 *
 * 冻结口径（Types.LevelDef / Layout）：
 *  - 绿框固定不动：targetPts 只由 Layout 的目标中心 + 轮廓尺寸决定，与时间无关；
 *  - 双车道：mover[1] 直接用**已镜像好的路径**（h_line ↔ h_line_rl），dir 恒为 1，运动学里不做二次镜像；
 *  - 双车道 perfectMs 相同的前提：两条路径长度相同（h_line / h_line_rl 满足；arc / bounce 不满足 → 校验期 WARN）。
 */

import type { LevelDef, LevelRuntime, MoverRuntime, ShapeDef } from './Types';
import type { Vec2 } from './Geometry';
import type { MotionExtras, MoverMotion, DuoParams, MoverTiming } from './Paths';
import { place, polyArea, scaleLocal, v } from './Geometry';
import { TARGET_DUAL, TARGET_SINGLE } from './Layout';
import { RATINGS } from './Score';
import {
    buildPathPts,
    cumulativeLengths,
    jitteredCycle,
    mirrorPathX,
    mulberry32,
    PATH_IDS,
    pathLength,
    pointAtU,
    startRotOf,
    tStarOfMotion,
    uStarOf,
} from './Paths';
import { requireShape } from './Shapes';

/** 14 个必填字段（缺一个就是导出工具坏了，不是「可选项」） */
export const REQUIRED_FIELDS: Array<keyof LevelDef> = [
    'id',
    'name',
    'shapeId',
    'outlineId',
    'variant',
    'motion',
    'path',
    'cycleMs',
    'turns',
    'jitter',
    'toleranceDeg',
    'passRate',
    'star3Rate',
    'speedStage',
];

/** 取值范围（上下界含端点） */
export const LEVEL_RANGES = {
    cycleMs: [500, 8000] as [number, number],
    turns: [-8, 8] as [number, number],
    jitter: [0, 0.15] as [number, number],
    toleranceDeg: [0, 30] as [number, number],
    passRate: [0, 1] as [number, number],
    star3Rate: [0, 1] as [number, number],
    speedStage: [0.5, 1.5] as [number, number],
    estSec: [1, 60] as [number, number],
    weight: [0, 2] as [number, number],
    attempts: [1, 10] as [number, number],
} as const;

/** v0.4 / v0.5 运动调制字段的取值范围（缺列 = 0，向后兼容旧表） */
export const MOTION_RANGES = {
    season: [1, 4] as [number, number],
    sineAmp: [0, 0.14] as [number, number],
    sinePeriodMs: [600, 1600] as [number, number],
    /** v0.5 正弦起始相位：0 与 0.5 是两种「呼吸节奏」（先快后慢 / 先慢后快） */
    sinePhase: [0, 1] as [number, number],
    inertiaPx: [0, 6] as [number, number],
    inertiaHz: [0.7, 1.3] as [number, number],
    inertiaPhase: [0, 1] as [number, number],
} as const;

/** v0.6 双物体错拍字段取值范围（缺列默认 0 = 同步） */
export const DUO_RANGES = {
    phase2: [0, 0.5] as [number, number],
    /** 0 = 与第一个 mover 相同；非 0 时 600–4000 */
    cycle2Ms: [600, 4000] as [number, number],
} as const;

/**
 * 读双物体错拍参数（camelCase / snake_case / 数字字符串都认；缺省 = 同步）。
 * `phase2>0 || cycle2Ms>0` 才是错拍关；`phase2===0 && cycle2Ms===0` 会走 localT 的零偏移兼容分支。
 */
export function readDuo(src: Record<string, unknown> | null | undefined): DuoParams {
    const o = src ?? {};
    const pick = (a: string, b: string, dflt: number): number => {
        const raw = o[a] !== undefined && o[a] !== '' ? o[a] : o[b];
        if (typeof raw === 'number' && isFinite(raw)) return raw;
        if (typeof raw === 'string' && raw.trim() !== '') {
            const n = Number(raw);
            if (isFinite(n)) return n;
        }
        return dflt;
    };
    return {
        phase2: pick('phase2', 'phase_2', 0),
        cycle2Ms: pick('cycle2Ms', 'cycle_2_ms', 0),
        timeLimitSec: pick('timeLimitSec', 'time_limit_sec', 0),
    };
}

/** 是否错拍关（第二 mover 有自己的时间轴） */
export function isStaggered(def: LevelDef): boolean {
    const d = readDuo(def as unknown as Record<string, unknown>);
    return d.phase2 > 0 || d.cycle2Ms > 0;
}

/**
 * 从 JSON 行/CSV 行读取运动调制参数（兼容 camelCase 与 snake_case）。
 * 缺省值：season=1、sineAmp=0、sinePeriodMs=960、sinePhase=0、inertiaPx=0、inertiaHz=1、inertiaPhase=0。
 * 注意：这里只做「读数」，合法区间由 inspectLevels 负责报错。
 */export function readMotion(src: Record<string, unknown> | null | undefined): MotionExtras & { season: number } {
    const o = src ?? {};
    // CSV 行读出来是字符串（"0.04"），JSON 行是数字 → 两种都认；空串/非法值走默认
    const pick = (a: string, b: string, dflt: number): number => {
        const raw = o[a] !== undefined && o[a] !== '' ? o[a] : o[b];
        if (typeof raw === 'number' && isFinite(raw)) return raw;
        if (typeof raw === 'string' && raw.trim() !== '') {
            const n = Number(raw);
            if (isFinite(n)) return n;
        }
        return dflt;
    };
    return {
        season: pick('season', 'season', 1),
        sineAmp: pick('sineAmp', 'sine_amp', 0),
        sinePeriodMs: pick('sinePeriodMs', 'sine_period_ms', 960),
        sinePhase: pick('sinePhase', 'sine_phase', 0),
        inertiaPx: pick('inertiaPx', 'inertia_px', 0),
        inertiaHz: pick('inertiaHz', 'inertia_hz', 1),
        inertiaPhase: pick('inertiaPhase', 'inertia_phase', 0),
    };
}

const MOTIONS = ['旋转', '抛物', '弹跳', '组合'];

export interface LevelInspectResult {
    levels: LevelDef[];
    errors: string[];
    warnings: string[];
}

function isFiniteNum(x: unknown): x is number {
    return typeof x === 'number' && isFinite(x);
}

function inRange(name: string, value: unknown, range: [number, number], errors: string[], tag: string): void {
    if (!isFiniteNum(value)) {
        errors.push(`${tag}: ${name} 必须是数字`);
        return;
    }
    if (value < range[0] || value > range[1]) {
        errors.push(`${tag}: ${name}=${value} 超出 [${range[0]}, ${range[1]}]`);
    }
}

function asList(json: unknown): unknown[] {
    if (Array.isArray(json)) return json;
    if (json && typeof json === 'object' && Array.isArray((json as { levels?: unknown[] }).levels)) {
        return (json as { levels: unknown[] }).levels;
    }
    return [];
}

/** 校验但不抛异常（工具打印全部问题用） */
export function inspectLevels(json: unknown): LevelInspectResult {
    const list = asList(json);
    const errors: string[] = [];
    const warnings: string[] = [];
    const levels: LevelDef[] = [];
    if (list.length === 0) errors.push('levels 为空或格式不对（支持 [ ... ] 或 { "levels": [ ... ] }）');
    const ids = new Set<number>();
    let intRatioCount = 0;
    for (let i = 0; i < list.length; i++) {
        const raw = list[i] as Partial<LevelDef> & Record<string, unknown>;
        const tag = `L${raw && raw.id !== undefined ? raw.id : '?'}(第${i + 1}条)`;
        if (!raw || typeof raw !== 'object') {
            errors.push(`${tag}: 不是对象`);
            continue;
        }
        for (const f of REQUIRED_FIELDS) {
            if (raw[f] === undefined || raw[f] === null || raw[f] === '') errors.push(`${tag}: 缺字段 ${String(f)}`);
        }
        if (!isFiniteNum(raw.id) || !Number.isInteger(raw.id) || raw.id < 1) errors.push(`${tag}: id 必须是 ≥1 的整数`);
        else if (ids.has(raw.id)) errors.push(`${tag}: id 重复`);
        else ids.add(raw.id);
        if (typeof raw.variant !== 'string' || (raw.variant !== 'single' && raw.variant !== 'dual')) {
            errors.push(`${tag}: variant 只能是 single / dual`);
        }
        if (typeof raw.motion !== 'string' || MOTIONS.indexOf(raw.motion) < 0) {
            errors.push(`${tag}: motion 只能是 ${MOTIONS.join(' / ')}`);
        }
        if (typeof raw.path !== 'string' || (PATH_IDS as readonly string[]).indexOf(raw.path) < 0) {
            errors.push(`${tag}: path 非法（允许 ${PATH_IDS.join(' / ')}）`);
        }
        inRange('cycleMs', raw.cycleMs, LEVEL_RANGES.cycleMs, errors, tag);
        inRange('turns', raw.turns, LEVEL_RANGES.turns, errors, tag);
        inRange('jitter', raw.jitter, LEVEL_RANGES.jitter, errors, tag);
        inRange('toleranceDeg', raw.toleranceDeg, LEVEL_RANGES.toleranceDeg, errors, tag);
        inRange('passRate', raw.passRate, LEVEL_RANGES.passRate, errors, tag);
        inRange('star3Rate', raw.star3Rate, LEVEL_RANGES.star3Rate, errors, tag);
        inRange('speedStage', raw.speedStage, LEVEL_RANGES.speedStage, errors, tag);
        if (raw.estSec !== undefined) inRange('estSec', raw.estSec, LEVEL_RANGES.estSec, errors, tag);
        if (raw.weight !== undefined) inRange('weight', raw.weight, LEVEL_RANGES.weight, errors, tag);
        if (raw.attempts !== undefined) inRange('attempts', raw.attempts, LEVEL_RANGES.attempts, errors, tag);

        // ---- v0.4 运动调制字段（缺列 = 0，向后兼容 15 关旧表）----
        // 注意：CSV 行读出来是字符串，JSON 行是数字 → 两种都要认（历史上这里漏过一次，导致 60 关全取默认值）
        const mtn = readMotion(raw);
        const motionField = (name: string, camel: string, snake: string, range: [number, number]): void => {
            const hasCamel = raw[camel] !== undefined && raw[camel] !== null && raw[camel] !== '';
            const hasSnake = raw[snake] !== undefined && raw[snake] !== null && raw[snake] !== '';
            if (!hasCamel && !hasSnake) return;
            const rawVal = hasCamel ? raw[camel] : raw[snake];
            const parsed = typeof rawVal === 'number' ? rawVal : Number(rawVal);
            if (!isFinite(parsed)) {
                errors.push(`${tag}: ${name}=${String(rawVal)} 不是数字`);
                return;
            }
            inRange(name, parsed, range, errors, tag);
        };
        if (raw.season !== undefined && raw.season !== null && raw.season !== '') {
            const seasonNum = typeof raw.season === 'number' ? raw.season : Number(raw.season);
            if (!isFinite(seasonNum) || !Number.isInteger(seasonNum) || seasonNum < 1 || seasonNum > 4) {
                errors.push(`${tag}: season=${String(raw.season)} 必须是 1–4 的整数`);
            }
        }
        motionField('sineAmp', 'sineAmp', 'sine_amp', MOTION_RANGES.sineAmp);
        motionField('sinePeriodMs', 'sinePeriodMs', 'sine_period_ms', MOTION_RANGES.sinePeriodMs);
        motionField('sinePhase', 'sinePhase', 'sine_phase', MOTION_RANGES.sinePhase);
        motionField('inertiaPx', 'inertiaPx', 'inertia_px', MOTION_RANGES.inertiaPx);
        motionField('inertiaHz', 'inertiaHz', 'inertia_hz', MOTION_RANGES.inertiaHz);
        motionField('inertiaPhase', 'inertiaPhase', 'inertia_phase', MOTION_RANGES.inertiaPhase);
        if (mtn.sineAmp > 0 && !(mtn.sinePeriodMs > 0)) errors.push(`${tag}: 开了正弦（sineAmp>0）但 sinePeriodMs 无效`);
        if (mtn.inertiaPx > 0 && !(mtn.inertiaHz > 0)) errors.push(`${tag}: 开了惯性（inertiaPx>0）但 inertiaHz 无效`);

        // ---- v0.6 双物体错拍字段（缺列 = 0 = 同步）----
        const duo = readDuo(raw);
        motionField('phase2', 'phase2', 'phase_2', DUO_RANGES.phase2);
        // cycle2Ms 的 0 是合法「哨兵值」（= 与第一个同周期），所以 0 时跳过区间校验
        if (raw.cycle2Ms !== undefined || raw.cycle_2_ms !== undefined) {
            const rawC2 = raw.cycle2Ms !== undefined ? raw.cycle2Ms : raw.cycle_2_ms;
            const c2 = typeof rawC2 === 'number' ? rawC2 : Number(rawC2);
            if (!isFinite(c2)) errors.push(`${tag}: cycle2Ms=${String(rawC2)} 不是数字`);
            else if (c2 !== 0 && (c2 < DUO_RANGES.cycle2Ms[0] || c2 > DUO_RANGES.cycle2Ms[1])) {
                errors.push(`${tag}: cycle2Ms=${c2} 超出 [0] 或 [${DUO_RANGES.cycle2Ms[0]}, ${DUO_RANGES.cycle2Ms[1]}]`);
            }
        }
        const staggered = duo.phase2 > 0 || duo.cycle2Ms > 0;
        if (staggered && raw.variant !== 'dual') {
            errors.push(`${tag}: 错拍字段（phase2/cycle2Ms）只能用在 dual 关（单物体没有「第二个 mover」）`);
        }
        if (duo.phase2 > 0 && duo.phase2 < 0.05) {
            errors.push(`${tag}: phase2=${duo.phase2} 太小（<0.05），不构成错拍；要同步请显式写 0`);
        }
        // 双峰风险备注：正弦只改速度大小、u(t) 严格单调 ⇒ 数学上不会出现第二个卡位点；
        // 整数比只影响「快/慢相位落在窗口哪一侧」，所以这里只做**汇总提示**，不逐关刷 WARN。
        if (mtn.sineAmp > 0 && mtn.sinePeriodMs > 0 && isFiniteNum(raw.cycleMs)) {
            const ratio = raw.cycleMs / mtn.sinePeriodMs;
            const nearest = Math.round(ratio);
            if (nearest >= 1 && Math.abs(ratio - nearest) < 0.02) intRatioCount++;
        }
        if (isFiniteNum(raw.passRate) && isFiniteNum(raw.star3Rate) && raw.star3Rate < raw.passRate) {
            errors.push(`${tag}: star3Rate(${raw.star3Rate}) 不能小于 passRate(${raw.passRate})`);
        }
        // 跨表口径检查：三星阈值不能高于「神级」评级阈值，否则会出现「神级定格但只有 2 星」
        if (isFiniteNum(raw.star3Rate) && raw.star3Rate * 100 > RATINGS[0].minPercent) {
            warnings.push(
                `${tag}: star3Rate=${raw.star3Rate}（${(raw.star3Rate * 100).toFixed(0)}%）高于神级阈值 ${RATINGS[0].minPercent}% → 本关会出现「神级定格但只有 2 星」，建议 star3Rate ≤ ${RATINGS[0].minPercent / 100}`,
            );
        }
        if (raw.variant === 'dual') {
            if (typeof raw.shapeId2 !== 'string' || raw.shapeId2.length === 0) {
                errors.push(`${tag}: dual 关卡必须给 shapeId2（第二个物体）`);
            }
            if (raw.path !== 'h_line' && raw.path !== 'h_line_rl') {
                warnings.push(
                    `${tag}: dual + ${String(raw.path)} —— 判定没问题（双车道用等距变换保证同帧完美），但车道 1 的路径是车道 0 的平移副本，arc/bounce 可能有顶点飞出可玩区；视觉上建议 h_line`,
                );
            }
        }
        const def: LevelDef = {
            id: raw.id as number,
            name: (raw.name as string) ?? '',
            shapeId: (raw.shapeId as string) ?? '',
            outlineId: (raw.outlineId as string) ?? '',
            variant: (raw.variant as LevelDef['variant']) ?? 'single',
            motion: (raw.motion as LevelDef['motion']) ?? '旋转',
            path: (raw.path as LevelDef['path']) ?? 'h_line',
            cycleMs: (raw.cycleMs as number) ?? 0,
            turns: (raw.turns as number) ?? 1,
            jitter: (raw.jitter as number) ?? 0,
            toleranceDeg: (raw.toleranceDeg as number) ?? 15,
            passRate: (raw.passRate as number) ?? 0.6,
            star3Rate: (raw.star3Rate as number) ?? 0.95,
            estSec: (raw.estSec as number) ?? 4,
            weight: (raw.weight as number) ?? 1,
            attempts: (raw.attempts as number) ?? 3,
            note: (raw.note as string) ?? '',
            speedStage: (raw.speedStage as number) ?? 1,
            shapeId2: raw.shapeId2 as string | undefined,
            linSpeed: Array.isArray(raw.linSpeed) ? (raw.linSpeed as [number, number]) : [0, 0],
            angSpeed: Array.isArray(raw.angSpeed) ? (raw.angSpeed as [number, number]) : [0, 0],
        };
        // 运动调制 + 错拍字段作为附加属性带在 def 上（Types.ts 冻结，不往里加字段）
        levels.push(Object.assign(def, mtn, duo) as LevelDef);
    }
    levels.sort((a, b) => a.id - b.id);
    if (intRatioCount > 0) {
        warnings.push(
            `${intRatioCount} 关的 cycleMs/sinePeriodMs 为整数比（正弦与穿越同相）—— 不影响判定（u(t) 严格单调，物体只穿过 C 一次），只影响窗口左右对称度；若窗口左右差 >10% 再考虑调周期`,
        );
    }
    return { levels, errors, warnings };
}

/** 加载 levels.json → LevelDef[]（按 id 升序）。有致命错误直接抛。 */
export function loadLevels(json: unknown): LevelDef[] {
    const r = inspectLevels(json);
    if (r.errors.length > 0) {
        throw new Error(`levels.json 校验失败（${r.errors.length} 项）：\n- ` + r.errors.join('\n- '));
    }
    return r.levels;
}

interface Lane {
    c: Vec2;
    scale: number;
    object: ShapeDef;
    outline: ShapeDef;
    mirror: boolean;
}

function lanesOf(def: LevelDef, shapes: Record<string, ShapeDef>): Lane[] {
    const object = requireShape(shapes, def.shapeId, `L${def.id}.shapeId`);
    const outline = requireShape(shapes, def.outlineId, `L${def.id}.outlineId`);
    if (def.variant !== 'dual') {
        return [{ c: { x: TARGET_SINGLE.cx, y: TARGET_SINGLE.cy }, scale: 1, object, outline, mirror: false }];
    }
    const object2 = requireShape(shapes, def.shapeId2 ?? '', `L${def.id}.shapeId2`);
    // dual 的第二个目标轮廓：LevelDef 没有 outlineId2，默认「自己的轮廓就是自己的目标」
    const outline2 = shapes[def.shapeId2 ?? ''] ?? object2;
    return [
        { c: { x: TARGET_DUAL[0].cx, y: TARGET_DUAL[0].cy }, scale: TARGET_DUAL[0].scale, object, outline, mirror: false },
        { c: { x: TARGET_DUAL[1].cx, y: TARGET_DUAL[1].cy }, scale: TARGET_DUAL[1].scale, object: object2, outline: outline2, mirror: true },
    ];
}

/**
 * 构建关卡运行时（CoreApi）。
 * @param seed 确定性种子：同一 seed → 逐帧一致（速度微扰、完美时机都一致）
 */
export function buildLevel(def: LevelDef, shapes: Record<string, ShapeDef>, seed: number): LevelRuntime {
    const rnd = mulberry32((seed >>> 0) ^ 0x9e3779b9);
    const cycleMs = jitteredCycle(def.cycleMs, def.jitter, rnd);
    const lanes = lanesOf(def, shapes);
    // v0.4 调制参数：从 def 的附加属性读（旧表没有 → 全 0，行为与 v0.3 完全一致）
    const motion = readMotion(def as unknown as Record<string, unknown>);
    // v0.6 错拍参数：第二 mover 的时间轴后移 phase2×cycle2；cycle2Ms=0 时与第一个同周期。
    // 微扰用**同一个**倍率（不额外消耗 rnd 抽样），保证同 seed 下各关抽签序列不变。
    const duo = readDuo(def as unknown as Record<string, unknown>);
    const jitterFactor = def.cycleMs > 0 ? cycleMs / def.cycleMs : 1;
    const cycle2Ms = duo.cycle2Ms > 0 ? duo.cycle2Ms * jitterFactor : cycleMs;
    const movers: MoverRuntime[] = new Array(lanes.length);
    let perfectMs = 0;
    // 双车道：以第 0 条车道的路径为**母版**，再做「y 平移 + x 镜像」。
    // 这样两条路径逐段等长 → uStar（弧长比例）相同 → tStar 相同 → 同一帧完美。
    // 反例（已修的 bug）：对每条车道各自 buildPathPts(C_i)，arc/bounce 的路径长会随 C_i.y 变化，
    // 于是 tStar 不同——L52（dual + bounce_floor）就出现过 pct=50%、位移 228px。
    const basePathPts = buildPathPts(def.path, lanes[0].c);
    const tStars: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        let pathPts = basePathPts;
        if (i > 0) {
            const dy = lane.c.y - lanes[0].c.y;
            pathPts = mirrorPathX(basePathPts, lane.c.x).map((p) => v(p.x, p.y + dy));
        }
        const pathLen = pathLength(pathPts);
        const cum = cumulativeLengths(pathPts);
        const uStar = uStarOf(pathPts, cum, pathLen, lane.c);
        // 安全网：完美时机必须**存在且唯一** —— 路径上离 C 最近的点要真的落在 C 上（否则本关无解）
        if (!(pathLen > 0)) throw new Error(`L${def.id}: 路径长度为 0（path=${def.path}）`);
        const nearest = pointAtU(pathPts, cum, pathLen, uStar);
        const miss = Math.hypot(nearest.x - lane.c.x, nearest.y - lane.c.y);
        if (miss > 0.5) {
            throw new Error(`L${def.id}: 路径 ${def.path} 离目标中心 ${miss.toFixed(2)}px（>0.5px），完美时机不存在`);
        }
        if (uStar <= 1e-6 || uStar >= 1 - 1e-6) {
            throw new Error(`L${def.id}: uStar=${uStar} 贴在路径端点，物体在 C 处没有「穿过」的过程，不该出题`);
        }
        // 每个 mover 有自己的周期与时间轴（v0.6）：第二 mover 后移 phase2×cycle2
        const cyc = i === 0 ? cycleMs : cycle2Ms;
        const offsetMs = i === 0 ? 0 : duo.phase2 * cycle2Ms;
        // 正弦调制会改变「何时到达 uStar」→ 必须重新求 tStar（amp=0 时函数内部走 v0.3 原算式，逐位兼容）
        const tStar = tStarOfMotion(uStar, pathLen, cyc, def.speedStage, motion);
        if (!(tStar > 0 && tStar < cyc)) throw new Error(`L${def.id}: perfectMs=${tStar} 不在 (0, ${cyc}) 内`);
        const targetPts = place(scaleLocal(lane.outline.pts, lane.outline.size * lane.scale), lane.c.x, lane.c.y, 0);
        const targetArea = polyArea(targetPts);
        if (!(targetArea > 1)) throw new Error(`L${def.id}: 目标轮廓面积 ${targetArea}（outline=${lane.outline.id}，size 或 pts 有问题）`);
        const timing: MoverTiming = { offsetMs, perfectMs: tStar + offsetMs };
        const mover = {
            shape: lane.object,
            targetPts,
            targetArea: targetArea,
            targetCenter: { x: lane.c.x, y: lane.c.y },
            targetRotDeg: 0,
            pathPts,
            pathLen,
            uStar,
            startRot: startRotOf(def.turns, tStar, cyc),
            turns: def.turns,
            speedStage: def.speedStage,
            cycleMs: cyc,
            dir: 1,
            // 附加属性（Types.MoverRuntime 冻结，不往里加字段）：调制参数 + 惯性零点 + 独立时间轴
            motion: { ...motion, zeroMs: tStar } as MoverMotion,
            timing,
        };
        movers[i] = mover as MoverRuntime;
        tStars.push(tStar);
        if (i === 0) perfectMs = tStar;
    }
    // 双车道一致性守卫：
    //  - 同步关（phase2=0 & cycle2=0）：两 mover 的 tStar 必须相等（同一帧完美）；
    //  - 错拍关：phase2 必须 ≥0.05（否则「错拍」名不副实，S14 会按 0.3×cycle 严格判）。
    if (tStars.length > 1) {
        const staggered = duo.phase2 > 0 || duo.cycle2Ms > 0;
        if (!staggered) {
            let dMax = 0;
            for (let i = 1; i < tStars.length; i++) {
                const d = Math.abs(tStars[i] - tStars[0]);
                if (d > dMax) dMax = d;
            }
            if (!(dMax <= 0.05)) {
                throw new Error(
                    `L${def.id}: 双车道的 perfectMs 不一致（最大差 ${dMax.toFixed(3)}ms）→ 不可能同帧完美；请改用 h_line/h_line_rl，或检查该路径模板是否随车道中心改变长度`,
                );
            }
        } else if (duo.phase2 > 0 && duo.phase2 < 0.05) {
            throw new Error(`L${def.id}: phase2=${duo.phase2} 太小（<0.05），不构成错拍；要同步请显式写 0`);
        }
    }
    // perfectMs 保留 = mover0 的完美时刻（**只对同步关等价于「全关一个」**）。
    // 错拍关请用 moverTiming(mover).perfectMs / Judge.perfectMsOf(rt, i) —— 别拿它当 mover1 的基准。
    return { def, movers, perfectMs };
}
