/**
 * Paths.ts —— 轨迹模板 + 弧长参数化 + 两段变速 + v0.4 运动调制（正弦 / 惯性）+ 姿态/轮廓求值
 *
 * 设计铁律（改动前先看 04_项目管理/决策记录.md）：
 *  1) 绿框固定不动，只有物体动；目标中心 C 由 Layout 给定，路径必须**数学上经过 C**；
 *  2) uStar 是「路径上离 C 最近的点」的弧长比例 —— 完美时机唯一存在且可背；
 *  3) 随机只做速度微扰（整局抽一次 cycleMs 缩放），**不改路径、不改 uStar 与路径的相对关系**；
 *  4) 同一 seed 必须逐帧一致（无 Math.random，无 Date.now）；
 *  5) v0.4 调制全部是**确定性解析式**：正弦改「何时到达 uStar」（重求 tStar），惯性只叠位移不叠转角。
 *
 * 坐标：设计分辨率 720×1280，y 向下。路径用折线（弧线先采样成折线），弧长按折线算。
 */

import type { MoverRuntime, PathId, Pose } from './Types';
import type { Vec2 } from './Geometry';
import { clamp, normDeg, place, scaleLocal, v } from './Geometry';
import { PLAY } from './Layout';
import { shapeUnitArea } from './Shapes';

/**
 * v0.4 运动调制参数。
 * `Types.ts` 是冻结件，**不往里加字段**；buildLevel 把这份结构作为附加属性挂到 mover 上，
 * 这里用结构化读取 + 兜底默认值，保证「旧 mover（无附加属性）」= 零调制（向后兼容）。
 */
export interface MotionExtras {
    /** 正弦速度调制幅度 0–0.14：v(t) = v0·(1 + amp·sin(2π(t/T + phase))) */
    sineAmp: number;
    /** 正弦周期（ms）600–1600 */
    sinePeriodMs: number;
    /**
     * 正弦起始相位 0–1（v0.5）：`sin(2π(t/T + phase))`。
     * 0 = 现状；0.5 = 镜像（先慢后快）。**只改速度大小、不改方向** ⇒ u(t) 仍严格单调、完美时机仍唯一。
     * 相位 0 时必须走 sineIntegral 里的兼容分支（逐位等同 v0.4，S8 依赖它）。
     */
    sinePhase: number;
    /** 惯性位移振幅（px）0–6 */
    inertiaPx: number;
    /** 惯性抖动频率（Hz）0.7–1.3 */
    inertiaHz: number;
    /**
     * 惯性相位 0–1。**本实现把它解释为「抖动方向角」**：方向 = 2π·phase，
     * 0 = 沿 x 轴左右抖、0.25 = 沿 y 轴上下抖、0.5 = 反向左右抖…
     * 这样「完美时机（tStar）」处位移恒为 0 → 卡得准时仍然 100%，惩罚只落在提前/滞后上。
     * （若主策划要的是「时间相位」（tStar 处也有偏移），改 inertiaOffsetOf 一处即可，见 客户端_核心说明.md）
     */
    inertiaPhase: number;
}

/** 运行时附加属性：调制参数 + 惯性零点（= perfectMs，保证完美时机位移为 0） */
export interface MoverMotion extends MotionExtras {
    zeroMs: number;
}

/** 无调制默认值（旧数据 / 手工构造 mover 走这条） */
export const MOTION_OFF: MoverMotion = {
    sineAmp: 0,
    sinePeriodMs: 960,
    sinePhase: 0,
    inertiaPx: 0,
    inertiaHz: 1,
    inertiaPhase: 0,
    zeroMs: 0,
};

/** 读 mover 的运动调制（无附加属性 → 零调制，绝不抛错） */
export function moverMotion(mover: MoverRuntime): MoverMotion {
    const m = (mover as MoverRuntime & { motion?: MoverMotion }).motion;
    return m ?? MOTION_OFF;
}

/**
 * v0.6 双物体错拍参数（可缺省）：
 *  - `phase2` 第二个 mover 的时间相位偏移（按周期比例，0–0.5），默认 0 = 同步；
 *  - `cycle2Ms` 第二个 mover 的周期（600–4000），0 = 与第一个相同。
 * `phase2 === 0 && cycle2Ms === 0` 时必须与 v0.5 **逐位相同**（靠 localT 的零偏移兼容分支保证）。
 */
export interface DuoParams {
    phase2: number;
    cycle2Ms: number;
    /** 关卡时限（秒）：0 = 用模式默认；错拍关主策划会给 20（原型层读它，core 不用） */
    timeLimitSec: number;
}

export const DUO_OFF: DuoParams = { phase2: 0, cycle2Ms: 0, timeLimitSec: 0 };

/**
 * 单个 mover 的时间轴（v0.6）：
 *  - `offsetMs`：本 mover 的时间轴相对关卡时钟的后移量（第二 mover = phase2 × cycle2Ms）；
 *  - `perfectMs`：**本 mover 自己**的完美时刻（= 自身 tStar + offsetMs）。
 * 「谁已定格」是会话状态，**不放这里**（core 保持零状态）：由调用方用 `judgeNearest(rt,t,skipIdx)` 传入。
 */
export interface MoverTiming {
    offsetMs: number;
    perfectMs: number;
}

export const TIMING_OFF: MoverTiming = { offsetMs: 0, perfectMs: 0 };

/** 读 mover 的时间轴（旧数据/手工构造 → offset 0，等价 v0.5） */
export function moverTiming(mover: MoverRuntime): MoverTiming {
    const t = (mover as MoverRuntime & { timing?: MoverTiming }).timing;
    return t ?? TIMING_OFF;
}

/**
 * 关卡时钟 → 本 mover 的本地时间（已按自身周期取模）。
 *
 * **零偏移兼容分支（禁改）**：`offsetMs === 0` 时返回 `wrapT(tMs, cycleMs)`，
 * 与 v0.5 完全同一串浮点运算 —— S13（phase_2=0 的关逐位不变）依赖它。
 */
export function localT(mover: MoverRuntime, tMs: number): number {
    const off = moverTiming(mover).offsetMs;
    if (off === 0) return wrapT(tMs, mover.cycleMs);
    return wrapT(tMs - off, mover.cycleMs);
}

/** 轨迹模板全集（与 Types.PathId 一一对应；顺序 = 文档顺序） */
export const PATH_IDS: PathId[] = ['h_line', 'h_line_rl', 'diag_dl', 'diag_ur', 'arc_up', 'arc_down', 'bounce_floor'];

/** 贝塞尔采样段数：40 段 → 折线与真实曲线的最大偏差 < 0.35px（720 宽屏上肉眼不可见） */
export const ARC_SAMPLES = 40;

/** 两段变速的切换点（占整周期比例），写死 = 可练可背，不随机 */
export const SPEED_SWITCH = 0.4;

/** 弧线起点/落点的水平范围（世界坐标，与 Layout 的可玩区对齐） */
export const ARC_X0 = 80;
export const ARC_X1 = 640;
/** 弧线端点离可玩区下沿的距离 */
export const ARC_MARGIN_BOTTOM = 60;

/** 生成轨迹折线（世界坐标）。同一 (pathId, C) 必须返回完全相同的点列。 */
export function buildPathPts(pathId: PathId, c: Vec2, samples: number = ARC_SAMPLES): Vec2[] {
    switch (pathId) {
        case 'h_line':
            return [v(-180, c.y), v(900, c.y)];
        case 'h_line_rl':
            return [v(900, c.y), v(-180, c.y)];
        case 'diag_dl':
            return [v(c.x - 360, c.y - 220), v(c.x + 360, c.y + 220)];
        case 'diag_ur':
            return [v(c.x - 360, c.y + 220), v(c.x + 360, c.y - 220)];
        case 'arc_up': {
            // 二次贝塞尔 P0 / P2 在屏幕下方，控制点取 Pc = 2C − (P0+P2)/2 ⇒ 曲线在 s=0.5 处严格过 C
            const pts = sampleQuadBezier(c, false, samples);
            return pts;
        }
        case 'arc_down': {
            // arc_up 关于 y = C.y 镜像
            return sampleQuadBezier(c, true, samples);
        }
        case 'bounce_floor':
            // 左上落下 → 触地反弹 → 上穿目标中心 → 飞出
            return [v(-120, 120), v(195, PLAY.bottom - 40), v(c.x, c.y), v(525, 300), v(860, 120)];
        default:
            throw new Error(`未知路径模板: ${String(pathId)}`);
    }
}

/** 二次贝塞尔采样；mirrorY=true 时整体关于 y = C.y 镜像（= arc_down） */
function sampleQuadBezier(c: Vec2, mirrorY: boolean, samples: number): Vec2[] {
    const yBase = PLAY.bottom + ARC_MARGIN_BOTTOM;
    const p0x = ARC_X0;
    const p2x = ARC_X1;
    const p0y = yBase;
    const p2y = yBase;
    const pcy = 2 * c.y - (p0y + p2y) / 2;
    const pcx = 2 * c.x - (p0x + p2x) / 2;
    const out: Vec2[] = [];
    const n = Math.max(2, samples);
    for (let i = 0; i <= n; i++) {
        const s = i / n;
        const w0 = (1 - s) * (1 - s);
        const w1 = 2 * s * (1 - s);
        const w2 = s * s;
        const x = w0 * p0x + w1 * pcx + w2 * p2x;
        const y = w0 * p0y + w1 * pcy + w2 * p2y;
        out.push(v(x, mirrorY ? 2 * c.y - y : y));
    }
    return out;
}

/** 累计弧长数组（cum[i] = 0..i 号点的长度，cum[n] = 总长） */
export function cumulativeLengths(pts: Vec2[]): number[] {
    const cum: number[] = new Array(pts.length);
    cum[0] = 0;
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        cum[i] = cum[i - 1] + Math.hypot(dx, dy);
    }
    return cum;
}

export function pathLength(pts: Vec2[]): number {
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
        s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return s;
}

/**
 * 路径上离 C 最近的点对应的弧长比例 uStar（0–1）。
 * - 折线顶点恰好等于 C 时（diag / arc / bounce）返回该顶点的弧长比例，误差 0；
 * - 直线路径（h_line）返回 C 在段上的投影位置（= 0.5）。
 */
export function uStarOf(pts: Vec2[], cum: number[], total: number, c: Vec2): number {
    if (total <= 1e-9) return 0;
    let bestD = Infinity;
    let bestU = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen2 = dx * dx + dy * dy;
        let t = segLen2 > 1e-12 ? ((c.x - a.x) * dx + (c.y - a.y) * dy) / segLen2 : 0;
        t = clamp(t, 0, 1);
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const d = Math.hypot(px - c.x, py - c.y);
        if (d < bestD - 1e-9) {
            bestD = d;
            bestU = (cum[i] + Math.hypot(px - a.x, py - a.y)) / total;
        }
    }
    return clamp(bestU, 0, 1);
}

/** 弧长比例 u → 折线上的点 */
export function pointAtU(pts: Vec2[], cum: number[], total: number, u: number): Vec2 {
    const target = clamp(u, 0, 1) * total;
    const n = pts.length;
    if (n === 0) return v(0, 0);
    if (n === 1 || total <= 1e-9) return v(pts[0].x, pts[0].y);
    // 二分找所在段（线性查找也够快，但二分让 40+ 段的大路径稳定 O(log n)）
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid;
        else hi = mid;
    }
    const segLen = cum[hi] - cum[lo];
    const t = segLen > 1e-12 ? (target - cum[lo]) / segLen : 0;
    return v(pts[lo].x + (pts[hi].x - pts[lo].x) * t, pts[lo].y + (pts[hi].y - pts[lo].y) * t);
}

/** 两段变速的权重：返回 [前段倍率, 后段倍率, 归一化分母, 切换时刻(ms)] */
export function speedProfile(speedStage: number, cycleMs: number): { k1: number; k2: number; norm: number; switchMs: number } {
    const k1 = clamp(speedStage, 0.5, 1.5);
    const k2 = 2 - k1;
    // 总距离不变：k1·0.4 + k2·0.6 = 1（匀速时 k1=k2=1）
    const norm = SPEED_SWITCH * k1 + (1 - SPEED_SWITCH) * k2;
    return { k1, k2, norm, switchMs: SPEED_SWITCH * cycleMs };
}

/**
 * 正弦速度调制的位移积分（v0.5 带相位）：
 *   ∫₀ᵗ (1 + amp·sin(2π(τ/T + φ))) dτ = t + (amp·T/(2π))·[cos(2πφ) − cos(2π(t/T + φ))]
 * 单位：秒。
 *
 * **相位 0 兼容分支（禁改）**：φ === 0 时走 `t + (amp/w)(1 − cos(wt))`，与 v0.4 逐位相同。
 * S8（季 1 三窗口逐位回归）依赖这条分支；要合并两条公式前先想清楚浮点顺序会变。
 */
export function sineIntegral(tSec: number, amp: number, periodSec: number, phase: number = 0): number {
    if (amp === 0) return tSec;
    const w = (2 * Math.PI) / Math.max(1e-6, periodSec);
    if (phase === 0) return tSec + (amp / w) * (1 - Math.cos(w * tSec));
    const ph = 2 * Math.PI * phase;
    return tSec + (amp / w) * (Math.cos(ph) - Math.cos(w * tSec + ph));
}

/**
 * 带正弦调制（含相位）的 u(t)：距离积分 / 总积分（v0 被约掉，与路径长无关）。
 * 单调性：amp < 1 时被积函数 1 + amp·sin(·) > 0，故严格单调 → 完美时机唯一（与相位无关）。
 */
export function uOfTSine(
    tMs: number,
    cycleMs: number,
    speedStage: number,
    sineAmp: number,
    sinePeriodMs: number,
    sinePhase: number = 0,
): number {
    if (!(cycleMs > 0)) return 0;
    const t = clamp(tMs, 0, cycleMs);
    const p = speedProfile(speedStage, cycleMs);
    const periodSec = Math.max(1, sinePeriodMs) / 1000;
    const iT = sineIntegral(t / 1000, sineAmp, periodSec, sinePhase);
    const iS = sineIntegral(p.switchMs / 1000, sineAmp, periodSec, sinePhase);
    const iC = sineIntegral(cycleMs / 1000, sineAmp, periodSec, sinePhase);
    const total = p.k1 * iS + p.k2 * (iC - iS);
    if (!(Math.abs(total) > 1e-12)) return 0;
    const d = t <= p.switchMs ? p.k1 * iT : p.k1 * iS + p.k2 * (iT - iS);
    return clamp(d / total, 0, 1);
}

/**
 * 时间（ms，已按周期取模）→ 弧长比例 u（0–1）。单调递增，u(0)=0，u(cycleMs)=1。
 *
 * **关键兼容性**：sineAmp === 0 时走 v0.3 的原始算式（不是「数学等价」而是「逐位相同」），
 * 这是 S8 回归（季 1 三窗口与 v0.3 逐位一致）的唯一保证方式。
 */
export function uAt(mover: MoverRuntime, tMs: number): number {
    const m = moverMotion(mover);
    if (m.sineAmp === 0) return uAtUnmodulated(mover, tMs);
    const cycle = mover.cycleMs;
    if (!(cycle > 0) || !(mover.pathLen > 0)) return 0;
    return uOfTSine(clamp(localT(mover, tMs), 0, cycle), cycle, mover.speedStage, m.sineAmp, m.sinePeriodMs, m.sinePhase);
}

/** v0.3 的原算式（零调制专用，改它等于改历史窗口，禁改） */
export function uAtUnmodulated(mover: MoverRuntime, tMs: number): number {
    const cycle = mover.cycleMs;
    if (!(cycle > 0) || !(mover.pathLen > 0)) return 0;
    const t = clamp(localT(mover, tMs), 0, cycle);
    const p = speedProfile(mover.speedStage, cycle);
    // 权重 1 时「匀速全程」的速度基准（px/ms）
    const base = mover.pathLen / cycle / p.norm;
    const d = t <= p.switchMs ? base * p.k1 * t : base * p.k1 * p.switchMs + base * p.k2 * (t - p.switchMs);
    return clamp(d / mover.pathLen, 0, 1);
}

/** 把任意 ms 折回 [0, cycleMs) */
export function wrapT(tMs: number, cycleMs: number): number {
    if (!(cycleMs > 0)) return 0;
    const m = tMs % cycleMs;
    return m < 0 ? m + cycleMs : m;
}

/** 把时间差折到 ±cycleMs/2（判定「早了 / 晚了」用），每个 mover 用自己的 cycleMs */
export function wrapDelta(dMs: number, cycleMs: number): number {
    if (!(cycleMs > 0)) return 0;
    const m = wrapT(dMs, cycleMs);
    return m > cycleMs / 2 ? m - cycleMs : m;
}

/**
 * 完美时机 tStar：解 u(t) = uStar。
 * u(t) 严格单调，二分 40 次 → 精度 cycleMs/2^40（≈1e-9ms），完全确定、可重放。
 */
export function tStarOf(uStar: number, pathLen: number, cycleMs: number, speedStage: number): number {
    if (!(pathLen > 0) || !(cycleMs > 0)) return 0;
    const p = speedProfile(speedStage, cycleMs);
    const base = pathLen / cycleMs / p.norm;
    // u(t) 的分段线性反函数本可直接解，这里统一用二分，保证「换了路径模板也不会算错」
    let lo = 0;
    let hi = cycleMs;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const d = mid <= p.switchMs ? base * p.k1 * mid : base * p.k1 * p.switchMs + base * p.k2 * (mid - p.switchMs);
        if (d < uStar * pathLen) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * v0.4/v0.5：带正弦调制时重新求完美时机 tStar（解 u(t) = uStar）。
 * u(t) 仍严格单调（amp<1 ⇒ 速度恒正；相位只改速度大小，不改方向），二分 40 次；
 * amp=0 时**直接走 v0.3 的 tStarOf**（逐位兼容），phase=0 时 sineIntegral 走兼容分支（逐位兼容）。
 */
export function tStarOfMotion(
    uStar: number,
    pathLen: number,
    cycleMs: number,
    speedStage: number,
    motion: MotionExtras,
): number {
    if (motion.sineAmp === 0) return tStarOf(uStar, pathLen, cycleMs, speedStage);
    if (!(cycleMs > 0)) return 0;
    let lo = 0;
    let hi = cycleMs;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (uOfTSine(mid, cycleMs, speedStage, motion.sineAmp, motion.sinePeriodMs, motion.sinePhase) < uStar) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/** 累计弧长缓存：同一份 pathPts 只算一次（判定每帧都要用，不能反复 new 数组） */
const CUM_CACHE = new WeakMap<Vec2[], { cum: number[]; total: number }>();

function cumsOf(mover: MoverRuntime): { cum: number[]; total: number } {
    const hit = CUM_CACHE.get(mover.pathPts);
    if (hit) return hit;
    const cum = cumulativeLengths(mover.pathPts);
    const entry = { cum, total: mover.pathLen > 0 ? mover.pathLen : cum[cum.length - 1] };
    CUM_CACHE.set(mover.pathPts, entry);
    return entry;
}

/**
 * v0.4 惯性位移：只叠加**位置**，不叠加转角（转角叠加会隐性收窄角度容错，不可解释）。
 * 形态：offset(t) = A·sin(2π·f·(t − tStar))·dir，dir = (cos 2πφ, sin 2πφ)。
 * 三个性质：
 *  1) t = tStar 时 offset ≡ 0 ⇒ 完美时机仍是 100%（不会把「神级」变成不可达）；
 *  2) 振幅严格 = A（不放大），只改接近/离开段的轨迹形状；
 *  3) 完全确定：无随机、无状态，同 seed 逐帧一致；φ 让同季不同关手感不同。
 */
export function inertiaOffsetOf(mover: MoverRuntime, tMs: number): Vec2 {
    const m = moverMotion(mover);
    if (!(m.inertiaPx > 0) || !(m.inertiaHz > 0) || !(mover.cycleMs > 0)) return v(0, 0);
    // localT 只在这里减一次 offset（错拍关 mover1 的 offset≠0）；zeroMs = 该 mover 自己的 tStar
    const t = localT(mover, tMs);
    const dtSec = (t - m.zeroMs) / 1000;
    const s = Math.sin(2 * Math.PI * m.inertiaHz * dtSec) * m.inertiaPx;
    const a = 2 * Math.PI * m.inertiaPhase;
    return v(s * Math.cos(a), s * Math.sin(a));
}

/**
 * 某时刻的姿态（位置 + 旋转角）。正弦只改 u(t)，惯性只改位置，转角始终线性于本地时间。
 *
 * ⚠️ 时间基准纪律：`uAt` 和 `inertiaOffsetOf` **内部各自**都会做 localT（减 offset），
 * 所以这里必须把**原始 tMs** 传给它们，不能用已经减过 offset 的局部时间 t。
 * （v0.6 在这里连踩两次：先漏了 uAt、后漏了 inertia —— 症状分别是「mover1 窗口=0」和
 *  「mover1 在自己的完美时刻偏 0.5–1.4px、角偏恒为 0」。两处现在都传 tMs。）
 */
export function poseAt(mover: MoverRuntime, tMs: number): Pose {
    const cycle = mover.cycleMs;
    const t = localT(mover, tMs); // 只用于旋转（转角线性于本地时间）
    const u = uAt(mover, tMs);
    const c = cumsOf(mover);
    const p = pointAtU(mover.pathPts, c.cum, c.total, u);
    const rotDeg = mover.startRot + (360 * mover.turns * t) / cycle;
    const m = moverMotion(mover);
    if (m.inertiaPx > 0) {
        const off = inertiaOffsetOf(mover, tMs); // 传原始时间，offset 只减一次
        return { x: p.x + off.x, y: p.y + off.y, rotDeg };
    }
    return { x: p.x, y: p.y, rotDeg };
}

/**
 * 物体绘制/判定的缩放倍率：让物体的「长边」= 目标轮廓的长边（双车道 0.62 也自动成立）。
 * 由 targetArea 反推，保证「判到的面积」与「看到的面积」同源。
 */
export function objectScaleOf(mover: MoverRuntime): number {
    const unitArea = shapeUnitArea(mover.shape);
    const worldAreaAt1 = unitArea * mover.shape.size * mover.shape.size;
    if (!(worldAreaAt1 > 1e-9) || !(mover.targetArea > 0)) return 1;
    return Math.sqrt(mover.targetArea / worldAreaAt1);
}

/** t 时刻物体的世界轮廓（与 targetPts 同一份坐标口径） */
export function objectPtsAt(mover: MoverRuntime, tMs: number): Vec2[] {
    const pose = poseAt(mover, tMs);
    const k = mover.shape.size * objectScaleOf(mover);
    return place(scaleLocal(mover.shape.pts, k), pose.x, pose.y, pose.rotDeg);
}

/** 确定性随机数（mulberry32）：同 seed 同序列，跨平台一致（不依赖 Math.random） */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function next(): number {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 本周期实际时长：整局抽一次 ±jitter，路径与 uStar 的相对关系不变 */
export function jitteredCycle(baseMs: number, jitter: number, rnd: () => number): number {
    const j = clamp(jitter, 0, 0.15);
    if (j <= 0) return baseMs;
    return baseMs * (1 + (rnd() * 2 - 1) * j);
}

/** 起始角：使 rot(tStar) ≡ 0 (mod 360)，即完美时机物体正好「转正」 */
export function startRotOf(turns: number, tStar: number, cycleMs: number): number {
    if (!(cycleMs > 0)) return 0;
    return normDeg((-360 * turns * tStar) / cycleMs);
}

/** 世界坐标镜像（双车道第二车道用）：绕 x = cx 翻转 */
export function mirrorPathX(pts: Vec2[], cx: number): Vec2[] {
    return pts.map((p) => v(2 * cx - p.x, p.y));
}
