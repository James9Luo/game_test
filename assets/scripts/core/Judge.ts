/**
 * Judge.ts —— 判定（纯函数）+ 热力图条带
 *
 * 口径（与 assets/resources/config/judge_rule.json 同源）：
 *   pct = 交集面积 / max(物体面积, 目标面积) × 100   ← 只用轮廓面积，绝不用中心点
 *   多物体关：pct 取算术平均；pass 要求**每个**物体都 ≥ passRate；star3 = 平均 ≥ star3Rate
 *   timing = pressMs 相对 perfectMs 的环绕最近值（±cycleMs/2），|Δ| ≤ 16.7ms → onTime
 *
 * 纯函数：同一 (rt, pressMs, combo) 必然得到同一结果（可单测、可回放、可批量回归）。
 */

import type { JudgeResult, LevelRuntime, MoverRuntime, ObjectJudge, RatingId } from './Types';
import type { Vec2 } from './Geometry';
import { normDeg, overlapAreaExact, polyArea, polyCentroid } from './Geometry';
import { moverTiming, objectPtsAt, poseAt, wrapDelta, wrapT } from './Paths';
import { ON_TIME_MS, ratingOf, scoreOf, starsOf } from './Score';

/** 热力图条带（渲染用，误差不参与判分） */
export interface HeatStrip {
    /** 条带上沿 y（设计坐标，y 向下） */
    y0: number;
    /** 条带下沿 y（y1 > y0） */
    y1: number;
    /** 目标轮廓在该条带内的横向范围 */
    tgtX0: number;
    tgtX1: number;
    /** 重合部分在该条带内的横向范围；无重合时 hitX0 === hitX1 */
    hitX0: number;
    hitX1: number;
}

export interface StripRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** y 水平线上的交点 x（升序，偶数个） */
function crossingsAt(pts: Vec2[], y: number): number[] {
    const xs: number[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
    }
    xs.sort((m: number, n2: number) => m - n2);
    return xs;
}

/** 多边形在 y 处的横截面区间（凹多边形会有多段） */
function sectionsAt(pts: Vec2[], y: number): Array<[number, number]> {
    const xs = crossingsAt(pts, y);
    const out: Array<[number, number]> = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
}

/** 两多边形的横截面交集区间 */
function overlapSectionsAt(P: Vec2[], Q: Vec2[], y: number): Array<[number, number]> {
    const sp = sectionsAt(P, y);
    const sq = sectionsAt(Q, y);
    const out: Array<[number, number]> = [];
    for (let i = 0; i < sp.length; i++) {
        for (let j = 0; j < sq.length; j++) {
            const lo = Math.max(sp[i][0], sq[j][0]);
            const hi = Math.min(sp[i][1], sq[j][1]);
            if (hi > lo) out.push([lo, hi]);
        }
    }
    return out;
}

/**
 * 把交集区域切成高 bandPx 的水平条带，返回矩形列表。
 * 用途：热力图（绿=重合）。**不参与判分**，所以允许 ±1px 的近似。
 */
export function overlapStrips(P: Vec2[], Q: Vec2[], bandPx: number): StripRect[] {
    const out: StripRect[] = [];
    if (P.length < 3 || Q.length < 3) return out;
    const h = Math.max(1, bandPx);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of P) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    for (const q of Q) {
        if (q.y < minY) minY = q.y;
        if (q.y > maxY) maxY = q.y;
    }
    if (!(maxY > minY)) return out;
    for (let y0 = minY; y0 < maxY; y0 += h) {
        const y1 = Math.min(y0 + h, maxY);
        const yMid = (y0 + y1) / 2;
        for (const seg of overlapSectionsAt(P, Q, yMid)) {
            const x0 = seg[0];
            const x1 = seg[1];
            if (x1 - x0 <= 1e-9) continue;
            out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
    }
    return out;
}

/** 区间差：union 里挖掉 inter（两边都是已排序、互不相交的区间列表） */
function subtractIntervals(union: Array<[number, number]>, inter: Array<[number, number]>): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const u of union) {
        let cur = u[0];
        for (const s of inter) {
            if (s[1] <= cur || s[0] >= u[1]) continue;
            if (s[0] > cur) out.push([cur, Math.min(s[0], u[1])]);
            cur = Math.max(cur, s[1]);
            if (cur >= u[1]) break;
        }
        if (cur < u[1]) out.push([cur, u[1]]);
    }
    return out;
}

/**
 * 「红区」：并集 − 交集（= 物体和绿框没对上的那部分），切成水平条带。
 * 热力图配色口径：绿 = 重合（overlapStrips），红 = 偏差（本函数）。同样不参与判分。
 */
export function missStrips(P: Vec2[], Q: Vec2[], bandPx: number): StripRect[] {
    const out: StripRect[] = [];
    if (P.length < 3 || Q.length < 3) return out;
    const h = Math.max(1, bandPx);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of P) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    for (const q of Q) {
        if (q.y < minY) minY = q.y;
        if (q.y > maxY) maxY = q.y;
    }
    if (!(maxY > minY)) return out;
    for (let y0 = minY; y0 < maxY; y0 += h) {
        const y1 = Math.min(y0 + h, maxY);
        const yMid = (y0 + y1) / 2;
        const sp = sectionsAt(P, yMid);
        const sq = sectionsAt(Q, yMid);
        const union = sp.concat(sq);
        const inter = overlapSectionsAt(P, Q, yMid);
        for (const seg of subtractIntervals(union, inter)) {
            const x0 = seg[0];
            const x1 = seg[1];
            if (x1 - x0 <= 1e-9) continue;
            out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
    }
    return out;
}

/**
 * 热力图条带（客户端热力图直接可用）：把交集覆盖的 y 范围等分 count 段。
 * 每段给出「目标横向范围」与「重合横向范围」，美术按 (hit 宽度 / 目标宽度) 上色。
 */
export function heatBands(objectPts: Vec2[], targetPts: Vec2[], count: number = 24): HeatStrip[] {
    const out: HeatStrip[] = [];
    const n = Math.max(1, Math.floor(count));
    if (objectPts.length < 3 || targetPts.length < 3) return out;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of objectPts) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    for (const p of targetPts) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    if (!(maxY > minY)) return out;
    const h = (maxY - minY) / n;
    for (let i = 0; i < n; i++) {
        const y0 = minY + i * h;
        const y1 = y0 + h;
        const yMid = (y0 + y1) / 2;
        const st = sectionsAt(targetPts, yMid);
        let tgtX0 = 0;
        let tgtX1 = 0;
        let widest = -1;
        for (const s of st) {
            const w = s[1] - s[0];
            if (w > widest) {
                widest = w;
                tgtX0 = s[0];
                tgtX1 = s[1];
            }
        }
        const hits = overlapSectionsAt(objectPts, targetPts, yMid);
        let hitX0 = (tgtX0 + tgtX1) / 2;
        let hitX1 = hitX0;
        if (hits.length > 0) {
            hitX0 = hits[0][0];
            hitX1 = hits[0][1];
            for (let k = 1; k < hits.length; k++) {
                hitX0 = Math.min(hitX0, hits[k][0]);
                hitX1 = Math.max(hitX1, hits[k][1]);
            }
        }
        out.push({ y0, y1, tgtX0, tgtX1, hitX0, hitX1 });
    }
    return out;
}

/** 单个物体的判定明细 */
export function judgeMover(mover: MoverRuntime, pressMs: number): ObjectJudge {
    // 传**原始**时间：poseAt/uAt/inertiaOffsetOf 内部各自处理 localT（v0.6 offset），这里再取模会重复
    const pose = poseAt(mover, pressMs);
    const objectPts = objectPtsAt(mover, pressMs);
    const objArea = polyArea(objectPts);
    const interArea = overlapAreaExact(objectPts, mover.targetPts);
    const denom = Math.max(objArea, mover.targetArea);
    const raw = denom > 1e-9 ? (interArea / denom) * 100 : 0;
    const pct = raw < 0 ? 0 : raw > 100 ? 100 : raw;
    const c = polyCentroid(objectPts);
    return {
        shapeId: mover.shape.id,
        pct,
        interArea,
        targetArea: mover.targetArea,
        angleDev: normDeg(pose.rotDeg - mover.targetRotDeg),
        offsetPx: Math.hypot(c.x - mover.targetCenter.x, c.y - mover.targetCenter.y),
        pose,
        objectPts,
        targetPts: mover.targetPts,
    };
}

/**
 * 判定入口（CoreApi）。
 * @param pressMs 点击时刻（同一周期内即可；内部按各 mover 自己的 cycleMs 取模）
 * @param combo 当前连击数（0,1,2…），内部按 Layout.COMBO 折算倍率
 */
export function judge(rt: LevelRuntime, pressMs: number, combo: number = 0): JudgeResult {
    const movers = rt.movers;
    const objects: ObjectJudge[] = new Array(movers.length);
    let sumPct = 0;
    let minPct = Infinity;
    for (let i = 0; i < movers.length; i++) {
        const o = judgeMover(movers[i], pressMs);
        objects[i] = o;
        sumPct += o.pct;
        if (o.pct < minPct) minPct = o.pct;
    }
    const pct = movers.length > 0 ? sumPct / movers.length : 0;
    const def = rt.def;
    // 时间差：每个 mover 用自己的 cycleMs 折到 ±cycleMs/2，多物体取平均（正常同帧时为同一个数）
    let sumDelta = 0;
    for (let i = 0; i < movers.length; i++) {
        const d = wrapDelta(pressMs - rt.perfectMs, movers[i].cycleMs);
        sumDelta += d;
    }
    const deltaMs = movers.length > 0 ? sumDelta / movers.length : 0;
    const verdict: 'early' | 'late' | 'onTime' = Math.abs(deltaMs) <= ON_TIME_MS ? 'onTime' : deltaMs < 0 ? 'early' : 'late';
    const rule = ratingOf(pct);
    return {
        pct,
        rating: rule.id,
        baseScore: rule.baseScore,
        score: scoreOf(pct, combo),
        pass: movers.length > 0 && minPct >= def.passRate * 100,
        star3: pct >= def.star3Rate * 100,
        timing: { deltaMs, verdict },
        objects,
    };
}

/**
 * 便利函数：本关**面板展示用**的星级。
 * 注意：星级必须被 pass 门控 —— 双物体关可能出现「平均 90%、但有一个物体没到 55%」的情况，
 * 此时 judge().pass=false，界面若直接按平均分给星就会显示「三星但没过」，属于展示矛盾。
 * 所以：没过 → 0 星；过了 → 按平均 pct 走 passRate / +0.7gap / star3Rate 三档。
 */
export function starsOfResult(rt: LevelRuntime, r: JudgeResult): number {
    if (!r.pass) return 0;
    return starsOf(r.pct, rt.def);
}

/** 命中窗口（毫秒）：pct 掉到 passRate 边界时的「早 / 晚」极限，单侧值，早为负 */
export interface HitWindow {
    earlyMs: number;
    lateMs: number;
    /** true = 到半个周期都还能过（窗口触到周期边界，数据不可信，需要主策划看） */
    earlyWide: boolean;
    lateWide: boolean;
}

export interface WindowMetrics extends HitWindow {
    /** 窗口边缘处的角度偏差（度）= |ω|·窗口ms/1000，取较窄的一侧 */
    tolDeg: number;
    /** 窗口边缘处的形心位移（px），取较窄的一侧 */
    tolPx: number;
}

/**
 * 通用窗口求解：给定「该时刻是否达标」的判定函数，从 perfectMs 向早/晚二分找边界。
 * 纯函数、确定性；内部只调 judge，不重建关卡。
 * @param precisionMs 精度（默认 0.5ms）
 * @param maxIter 迭代上限（默认 20 次 → 1300ms 区间精度 0.0012ms）
 */
export function windowFor(
    rt: LevelRuntime,
    ok: (r: JudgeResult) => boolean,
    precisionMs: number = 0.5,
    maxIter: number = 20,
): HitWindow {
    const cycle = rt.movers.length > 0 ? rt.movers[0].cycleMs : 0;
    if (!(cycle > 0)) return { earlyMs: 0, lateMs: 0, earlyWide: false, lateWide: false };
    // 超过半个周期会绕回窗口另一侧，所以搜索上限取 0.5·cycle
    const lim = cycle * 0.5 * 0.999;
    const side = (sign: 1 | -1): { ms: number; wide: boolean } => {
        if (!ok(judge(rt, rt.perfectMs))) return { ms: 0, wide: false };
        if (ok(judge(rt, rt.perfectMs + sign * lim))) return { ms: sign * lim, wide: true };
        let lo = 0;
        let hi = lim;
        const n = Math.max(1, Math.min(40, maxIter));
        for (let i = 0; i < n && hi - lo > precisionMs; i++) {
            const mid = (lo + hi) / 2;
            if (ok(judge(rt, rt.perfectMs + sign * mid))) lo = mid;
            else hi = mid;
        }
        return { ms: sign * lo, wide: false };
    };
    const e = side(-1);
    const l = side(1);
    return { earlyMs: e.ms, lateMs: l.ms, earlyWide: e.wide, lateWide: l.wide };
}

/**
 * 命中窗口：pass 边界（=「每个物体都 ≥ passRate」）。
 * 这是「能不能通关」的窗口，策划调难度曲线的主指标。
 * **错拍关自动分支**：返回各 mover 窗口中较窄者（每 mover 以自己 perfectMs 为基准）。
 */
export function hitWindow(rt: LevelRuntime, precisionMs: number = 0.5, maxIter: number = 20): HitWindow {
    if (isDesyncRuntime(rt)) return tighterWindow(rt.movers.map((_, i) => hitWindowForMover(rt, i)));
    return windowFor(rt, (r) => r.pass, precisionMs, maxIter);
}

/**
 * 神级窗口：平均 pct ≥ 95（rating = god）的边界。
 * 神级率 ≈ P(|err| ≤ 神级窗口)，目标 2–5%（高光稀有度）。比 hitWindow 窄得多。
 * 错拍关自动分支 → 各 mover 中较窄者。
 */
export function godWindow(rt: LevelRuntime, precisionMs: number = 0.5, maxIter: number = 20): HitWindow {
    if (isDesyncRuntime(rt)) return tighterWindow(rt.movers.map((_, i) => godWindowForMover(rt, i)));
    return windowFor(rt, (r) => r.pct >= 95, precisionMs, maxIter);
}

/** 三星窗口：平均 pct ≥ star3Rate×100 的边界；错拍关自动分支 → 各 mover 中较窄者 */
export function starWindow(rt: LevelRuntime, precisionMs: number = 0.5, maxIter: number = 20): HitWindow {
    if (isDesyncRuntime(rt)) return tighterWindow(rt.movers.map((_, i) => starWindowForMover(rt, i)));
    const thr = rt.def.star3Rate * 100;
    return windowFor(rt, (r) => r.pct >= thr, precisionMs, maxIter);
}

/**
 * 取某个 mover 自己的完美时刻（v0.6）。
 * ⚠️ 用 `rt.perfectMs` 只对**同步关**成立（它等于 mover0 的值）；错拍关必须用这个函数按 mover 取，
 * 否则会拿 mover0 的基准去扫 mover1 —— L50/L60 的「mover1 窗口=0」就是这么来的。
 */
export function perfectMsOf(rt: LevelRuntime, index: number = 0): number {
    const mv = rt.movers[index];
    return mv ? moverTiming(mv).perfectMs : rt.perfectMs;
}

/** 是否错拍关（任一 mover 有非零时间轴偏移） */
export function isDesyncRuntime(rt: LevelRuntime): boolean {
    return rt.movers.some((m) => moverTiming(m).offsetMs !== 0);
}

/**
 * ===== v0.6 双物体错拍 =====
 * 设计：错拍关「一关按两次，每次定格当前最接近绿框的那个」。
 * core 保持**无状态**：谁已定格由调用方通过 `skipIdx` 传入（会话状态归原型层）。
 */
export interface NearestJudge {
    /** 本次判定的 mover 下标（全部在 skipIdx 里时函数返回 null） */
    moverIndex: number;
    pct: number;
    rating: RatingId;
    baseScore: number;
    score: number;
    timing: { deltaMs: number; verdict: 'early' | 'late' | 'onTime' };
    /** **只含本次选中的那个 mover**（原型直接拿去画热力图）；`judge()` 的 objects 才是全量 */
    objects: ObjectJudge[];
}

/**
 * 取「未定格 mover 中 pct 最大者」判一次（错拍关专用）。
 * @param skipIdx 已定格的 mover 下标（调用方维护；本函数不改任何状态）
 * @returns 全部已定格 → null
 */
export function judgeNearest(rt: LevelRuntime, tMs: number, skipIdx: number[] = [], combo: number = 0): NearestJudge | null {
    const movers = rt.movers;
    if (movers.length === 0) return null;
    const skip = skipIdx ?? [];
    let bestIdx = -1;
    let best: ObjectJudge | null = null;
    for (let i = 0; i < movers.length; i++) {
        if (skip.indexOf(i) >= 0) continue;
        const o = judgeMover(movers[i], tMs);
        if (best === null || o.pct > best.pct) {
            best = o;
            bestIdx = i;
        }
    }
    if (best === null || bestIdx < 0) return null;
    const mv = movers[bestIdx];
    const deltaMs = wrapDelta(tMs - moverTiming(mv).perfectMs, mv.cycleMs);
    const verdict: 'early' | 'late' | 'onTime' = Math.abs(deltaMs) <= ON_TIME_MS ? 'onTime' : deltaMs < 0 ? 'early' : 'late';
    const rule = ratingOf(best.pct);
    return {
        moverIndex: bestIdx,
        pct: best.pct,
        rating: rule.id,
        baseScore: rule.baseScore,
        score: scoreOf(best.pct, combo),
        timing: { deltaMs, verdict },
        objects: [best],
    };
}

export interface DuoVerdict {
    /** 错拍关过关条件：**所有** mover 都已定格且都 ≥ passRate×100 */
    pass: boolean;
    /** 本关评级 = 两次里**较差**的那个（未全部定格 → fail） */
    rating: RatingId;
    baseScore: number;
    /** 分数 = 最差评级基础分 × 连击（不叠加两次分数）；未过关 = 0 */
    score: number;
    worstPct: number;
    judgedCount: number;
    needCount: number;
}

/**
 * 错拍关的关卡级结算（纯函数）：把 `judgeNearest` 的两次结果喂进来。
 * 规格 §2.3：评级取较差者、分数只算一次（最差评级的基础分），任一不合格 → 整关失败。
 * 同一 mover 重复出现在 judged 里会被忽略（幂等，配合 S16）。
 */
export function duoVerdict(rt: LevelRuntime, judged: Array<{ moverIndex: number; pct: number }>, combo: number = 0): DuoVerdict {
    const need = rt.movers.length;
    const seen = new Set<number>();
    let worstPct = Infinity;
    for (const j of judged) {
        if (j.moverIndex < 0 || j.moverIndex >= need) continue;
        if (seen.has(j.moverIndex)) continue;
        seen.add(j.moverIndex);
        if (j.pct < worstPct) worstPct = j.pct;
    }
    const judgedCount = seen.size;
    const allJudged = need > 0 && judgedCount === need;
    const w = isFinite(worstPct) ? worstPct : 0;
    const allPass = allJudged && w >= rt.def.passRate * 100;
    const rule = ratingOf(allPass ? w : Math.min(w, rt.def.passRate * 100 - 1e-9));
    return {
        pass: allPass,
        rating: allPass ? rule.id : 'fail',
        baseScore: allPass ? rule.baseScore : 0,
        score: allPass ? scoreOf(w, combo) : 0,
        worstPct: w,
        judgedCount,
        needCount: need,
    };
}

/** 单个 mover 的窗口（错拍关每个 mover 有自己的完美时刻与周期） */
export function moverWindowAt(
    rt: LevelRuntime,
    index: number,
    ok: (pct: number) => boolean,
    precisionMs: number = 0.5,
    maxIter: number = 20,
): HitWindow {
    const empty: HitWindow = { earlyMs: 0, lateMs: 0, earlyWide: false, lateWide: false };
    const mv = rt.movers[index];
    if (!mv || !(mv.cycleMs > 0)) return empty;
    const cyc = mv.cycleMs;
    const pm = moverTiming(mv).perfectMs;
    const lim = cyc * 0.5 * 0.999;
    const side = (sign: 1 | -1): { ms: number; wide: boolean } => {
        if (!ok(judgeMover(mv, pm).pct)) return { ms: 0, wide: false };
        if (ok(judgeMover(mv, pm + sign * lim).pct)) return { ms: sign * lim, wide: true };
        let lo = 0;
        let hi = lim;
        for (let i = 0; i < Math.min(40, maxIter) && hi - lo > precisionMs; i++) {
            const mid = (lo + hi) / 2;
            if (ok(judgeMover(mv, pm + sign * mid).pct)) lo = mid;
            else hi = mid;
        }
        return { ms: sign * lo, wide: false };
    };
    const e = side(-1);
    const l = side(1);
    return { earlyMs: e.ms, lateMs: l.ms, earlyWide: e.wide, lateWide: l.wide };
}

export function hitWindowForMover(rt: LevelRuntime, index: number): HitWindow {
    return moverWindowAt(rt, index, (p) => p >= rt.def.passRate * 100);
}

export function godWindowForMover(rt: LevelRuntime, index: number): HitWindow {
    return moverWindowAt(rt, index, (p) => p >= 95);
}

export function starWindowForMover(rt: LevelRuntime, index: number): HitWindow {
    const thr = rt.def.star3Rate * 100;
    return moverWindowAt(rt, index, (p) => p >= thr);
}

/** 关卡窗口 = 各 mover 窗口中**较窄者**（规格 §3；玩家必须两边都卡准） */
export function tighterWindow(windows: HitWindow[]): HitWindow {
    if (windows.length === 0) return { earlyMs: 0, lateMs: 0, earlyWide: false, lateWide: false };
    const width = (w: HitWindow): number => (Math.abs(w.earlyMs) + Math.abs(w.lateMs)) / 2;
    let best = windows[0];
    for (let i = 1; i < windows.length; i++) if (width(windows[i]) < width(best)) best = windows[i];
    return { earlyMs: best.earlyMs, lateMs: best.lateMs, earlyWide: best.earlyWide, lateWide: best.lateWide };
}

/** 每个 mover 的命中窗口（数组，按 mover 下标；错拍关导出的 `hitWindowByMover` 就是这个） */
export function hitWindowByMover(rt: LevelRuntime): HitWindow[] {
    return rt.movers.map((_, i) => hitWindowForMover(rt, i));
}

/** 每个 mover 的神级窗口 */
export function godWindowByMover(rt: LevelRuntime): HitWindow[] {
    return rt.movers.map((_, i) => godWindowForMover(rt, i));
}

/** 每个 mover 各自的完美时刻（ms） */
export function perfectMsByMover(rt: LevelRuntime): number[] {
    return rt.movers.map((m) => moverTiming(m).perfectMs);
}

/** 每个 mover 的三窗口 + 关卡窗口（较窄者）。错拍关导出用它 */
export function perMoverWindows(rt: LevelRuntime): {
    hit: HitWindow[];
    god: HitWindow[];
    star: HitWindow[];
    levelHit: HitWindow;
    levelGod: HitWindow;
    levelStar: HitWindow;
} {
    const hit = rt.movers.map((_, i) => hitWindowForMover(rt, i));
    const god = rt.movers.map((_, i) => godWindowForMover(rt, i));
    const star = rt.movers.map((_, i) => starWindowForMover(rt, i));
    return { hit, god, star, levelHit: tighterWindow(hit), levelGod: tighterWindow(god), levelStar: tighterWindow(star) };
}

/** 命中窗口 + 由窗口推出的「角度容错 / 位移容错」（策划调数值的主指标） */
export function windowMetrics(rt: LevelRuntime): WindowMetrics {
    // 错拍关：窗口取较窄者，容错按**各自基准**折算
    if (isDesyncRuntime(rt)) {
        const pmw = perMoverWindows(rt);
        const w = pmw.levelHit;
        const mv0 = rt.movers[0];
        const omega = mv0 && mv0.cycleMs > 0 ? (360 * Math.abs(mv0.turns)) / (mv0.cycleMs / 1000) : 0;
        const tightMs = Math.min(Math.abs(w.earlyMs), Math.abs(w.lateMs));
        let maxPx = 0;
        for (let i = 0; i < rt.movers.length; i++) {
            const mv = rt.movers[i];
            const pm = moverTiming(mv).perfectMs;
            const d = Math.min(Math.abs(pmw.hit[i].earlyMs), Math.abs(pmw.hit[i].lateMs));
            const off = Math.max(judgeMover(mv, pm - d).offsetPx, judgeMover(mv, pm + d).offsetPx);
            if (off > maxPx) maxPx = off;
        }
        return { ...w, tolDeg: (omega * tightMs) / 1000, tolPx: maxPx };
    }
    const w = hitWindow(rt);
    const m0 = rt.movers[0];
    const omega = m0 && m0.cycleMs > 0 ? (360 * Math.abs(m0.turns)) / (m0.cycleMs / 1000) : 0;
    const tightMs = Math.min(Math.abs(w.earlyMs), Math.abs(w.lateMs));
    const maxOffsetAt = (dt: number): number => {
        const r = judge(rt, rt.perfectMs + dt);
        let mx = 0;
        for (let i = 0; i < r.objects.length; i++) {
            if (r.objects[i].offsetPx > mx) mx = r.objects[i].offsetPx;
        }
        return mx;
    };
    return {
        earlyMs: w.earlyMs,
        lateMs: w.lateMs,
        earlyWide: w.earlyWide,
        lateWide: w.lateWide,
        tolDeg: (omega * tightMs) / 1000,
        tolPx: Math.min(maxOffsetAt(w.earlyMs), maxOffsetAt(w.lateMs)),
    };
}

/** 形心距（给调试面板 / 文案用） */
export function centroidDistance(pts: Vec2[], target: Vec2): number {
    const c = polyCentroid(pts);
    return Math.hypot(c.x - target.x, c.y - target.y);
}
