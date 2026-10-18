/**
 * LevelRunner.ts —— 关卡运行：当前关 / 尝试次数 / 连击 / 进度存档 / 按下判定
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：**判定口径与输入折扣规则在本文件**，测试用例直接对着它写。
 *
 * 四条写死的规则（改动 = 改玩法，先问主策划）：
 * 1. 按下时用 `clock.nowMs()`（当帧精确 tMs）回滚判定，不用下一帧状态；
 * 2. 连点只认第一次：判定后立刻 `frozen = true`，之后的 press() 一律返回 null；
 * 3. 暂停中 / 结算中的输入一律丢弃（同上，靠 frozen 兜住）；
 * 4. 每次尝试 seed = `levelId * SEED_STEP + attemptIndex`，同关同次可复现，重试换微扰。
 */

import { Node, sys } from 'cc';
import { COMBO } from '../../core/Layout';
import type { JudgeResult, LevelDef, LevelRuntime, MoverRuntime } from '../../core/Types';
import { GameBridge } from './GameBridge';
import { Clock } from './Clock';
import { Mover } from './Mover';

/** 进度存档 key（改版本号 = 玩家进度清零，慎重） */
export const PROGRESS_KEY = 'dista.v1.progress';

/** seed 步长：seed = 关卡 id × 1000 + 尝试序号（确定性，便于复现与回放） */
const SEED_STEP = 1000;

/** 进度存档内容 */
interface Progress {
    /** 已解锁到第几关（1 基，最小 1） */
    unlocked: number;
    /** 关卡 id → 最好星数（0..3） */
    stars: Record<string, number>;
}

/** 一次按下后的结果（Boot 用它驱动状态机与面板，不再回头问 core） */
export interface PressOutcome {
    /** core 的判定明细（分数 / 评级 / 早晚 / 各物体明细） */
    result: JudgeResult;
    /** 本次判定用的精确时间（毫秒，从本周期 t=0 起算） */
    pressMs: number;
    /** 本次按完还剩几次尝试 */
    attemptsLeft: number;
    /** 是否通过本关 */
    pass: boolean;
    /** 是否通过且是最后一关 */
    allClear: boolean;
    /** 星数 0..3 */
    stars: number;
    /** 按完后的连击数（通过 +1，失败归零） */
    combo: number;
    /** 失败但还有尝试次数（可自动重进） */
    canRetry: boolean;
}

function emptyProgress(): Progress {
    return { unlocked: 1, stars: {} };
}

/** 读存档：任何异常都退回「从第 1 关开始」，不许因为存档坏掉卡死开局 */
function loadProgress(): Progress {
    try {
        const raw = sys.localStorage.getItem(PROGRESS_KEY);
        if (!raw) {
            return emptyProgress();
        }
        const parsed = JSON.parse(raw) as Partial<Progress>;
        const p = emptyProgress();
        if (typeof parsed.unlocked === 'number' && parsed.unlocked >= 1) {
            p.unlocked = Math.floor(parsed.unlocked);
        }
        if (parsed.stars && typeof parsed.stars === 'object') {
            const src = parsed.stars as Record<string, number>;
            for (const key in src) {
                if (typeof src[key] === 'number') {
                    p.stars[key] = src[key];
                }
            }
        }
        return p;
    } catch (e) {
        console.warn('[LevelRunner] 存档读取失败，按新档处理：', e);
        return emptyProgress();
    }
}

export class LevelRunner {
    private readonly bridge: GameBridge;
    private readonly clock: Clock;

    /** 物体层（Boot 给），Mover 作为它的子节点 */
    private layer: Node | null = null;
    /** 当前关的物体（每次尝试重建：换形状 / 换车道都靠它） */
    private movers: Mover[] = [];

    private levelIndex: number = 0;
    private attemptIndex: number = 0;
    private attemptsLeft: number = 0;
    /** 当前连击数（连续通过的次数） */
    private combo: number = 0;
    private runtime: LevelRuntime | null = null;
    /** 判定后冻结：连点 / 暂停中 / 结算中的输入全部靠它丢弃 */
    private frozen: boolean = true;
    private progress: Progress = emptyProgress();

    constructor(bridge: GameBridge, clock: Clock) {
        this.bridge = bridge;
        this.clock = clock;
        this.progress = loadProgress();
    }

    /** 绑定物体层节点（Boot 建完节点树后调一次） */
    attach(layer: Node): void {
        this.layer = layer;
    }

    // ---------------------------------------------------------------- 查询

    /** 当前关卡定义（未开局返回 null） */
    levelDef(): LevelDef | null {
        return this.bridge.levelAt(this.levelIndex);
    }

    /** 当前关序号（0 基） */
    index(): number {
        return this.levelIndex;
    }

    /** 关卡总数 */
    total(): number {
        return this.bridge.levels.length;
    }

    /** 当前尝试剩余次数 */
    attempts(): number {
        return this.attemptsLeft;
    }

    /** 本关允许的尝试次数（来自 levels.csv 的 attempts） */
    maxAttempts(): number {
        const def = this.levelDef();
        return def ? def.attempts : 0;
    }

    /** 当前连击数 */
    comboCount(): number {
        return this.combo;
    }

    /** 连击系数（1 + 0.1 × 连击，上限 2.0；HUD 显示用，实际结算在 core） */
    comboCoef(): number {
        const c = 1 + COMBO.step * this.combo;
        return c > COMBO.max ? COMBO.max : c;
    }

    /** 是否处于「判定后冻结」 */
    isFrozen(): boolean {
        return this.frozen;
    }

    /** 已解锁到第几关（1 基） */
    unlocked(): number {
        return this.progress.unlocked;
    }

    /** 某关最好星数（0 = 没打过） */
    starsOf(levelId: number): number {
        const v = this.progress.stars[String(levelId)];
        return typeof v === 'number' ? v : 0;
    }

    /** 当前运行时（调试 / 热力图用；未开局返回 null） */
    runtimeNow(): LevelRuntime | null {
        return this.runtime;
    }

    // ---------------------------------------------------------------- 开局

    /** 按 id 找关序号（0 基）；找不到返回 -1。测试与 debugJump 用。 */
    indexOfLevelId(id: number): number {
        for (let i = 0; i < this.bridge.levels.length; i++) {
            if (this.bridge.levels[i].id === id) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 首页点击后该进哪一关（0 基）：取存档解锁进度，越界（存档来自更早版本）夹到最后一关。
     * 这是「玩家点开始」的唯一入口，避免越界导致点了没反应。
     */
    firstPlayableIndex(): number {
        const last = this.bridge.levels.length - 1;
        const idx = this.progress.unlocked - 1;
        if (idx < 0) {
            return 0;
        }
        return idx > last ? last : idx;
    }

    /**
     * 从第 index 关（0 基）开始一局：清零连击与尝试次数，建首个尝试。
     * @returns 是否成功（越界返回 false）
     */
    startLevel(index: number): boolean {
        if (!this.bridge.levelAt(index)) {
            return false;
        }
        this.levelIndex = index;
        this.combo = 0;
        this.attemptIndex = 0;
        this.frozen = true;
        const def = this.levelDef() as LevelDef;
        this.attemptsLeft = def.attempts;
        return this.beginAttempt();
    }

    /** 直接跳到下一关（通过后调用）；已是最后一关返回 false */
    advanceLevel(): boolean {
        if (this.levelIndex + 1 >= this.bridge.levels.length) {
            return false;
        }
        return this.startLevel(this.levelIndex + 1);
    }

    /** 同关重来（机会用完后的「再来一次」）：尝试次数重置、连击归零 */
    retryLevel(): boolean {
        this.combo = 0;
        const def = this.levelDef();
        if (!def) {
            return false;
        }
        this.attemptsLeft = def.attempts;
        return this.beginAttempt();
    }

    /**
     * 开始一次尝试：新 seed 建运行时、重建 Mover 节点、时钟归零、解冻。
     * 失败后自动重进（Boot 等 RETRY_DELAY_MS）也走这里，attemptsLeft 不再扣。
     */
    beginAttempt(): boolean {
        const def = this.levelDef();
        const layer = this.layer;
        if (!def || !layer) {
            return false;
        }
        this.clearMovers();

        const seed = def.id * SEED_STEP + this.attemptIndex;
        this.attemptIndex++;
        const rt = this.bridge.buildLevel(def, seed);
        this.runtime = rt;

        for (let i = 0; i < rt.movers.length; i++) {
            const moverRt: MoverRuntime = rt.movers[i];
            // 倍率由 core 给（按面积反推，物体面积 = 目标面积），渲染层不自己猜
            this.movers.push(new Mover(layer, moverRt, i, this.bridge.objectScaleOf(moverRt)));
        }
        this.clock.reset(0);
        this.clock.setPaused(false);
        this.frozen = false;
        this.placeAt(0);
        return true;
    }

    // ---------------------------------------------------------------- 每帧

    /**
     * 每帧推进：时钟前进 → 按 core 的 pose 摆物体。
     * 冻结（判定后 / 结算中）时整帧不做任何事 —— 画面自然停在被判定的那一帧。
     */
    update(dtSec: number): void {
        if (this.frozen) {
            return;
        }
        const t = this.clock.tick(dtSec);
        this.placeAt(t);
    }

    /** 把当前关所有物体摆到 tMs 时刻的姿态 */
    private placeAt(tMs: number): void {
        const rt = this.runtime;
        if (!rt) {
            return;
        }
        for (let i = 0; i < this.movers.length && i < rt.movers.length; i++) {
            const pose = this.bridge.poseAt(rt.movers[i], tMs);
            this.movers[i].applyPose(pose);
        }
    }

    // ---------------------------------------------------------------- 输入

    /**
     * 按下【暂停】：用**当帧精确 tMs** 判定并立刻冻结。
     * @returns null = 本次输入被丢弃（已判定过 / 暂停中 / 结算中），调用方什么都不做
     */
    press(): PressOutcome | null {
        if (this.frozen || !this.runtime) {
            return null;
        }
        // ↓ 关键：先取时间，再算分。绝不读下一帧状态。
        const pressMs = this.clock.nowMs();
        return this.judgeAt(pressMs);
    }

    /**
     * 测试用：按指定 tMs 直接判一次（不读时钟），用来验证结算面板 / 热力图 / 文案。
     * 判定口径与 press() 完全一致；返回 null 表示当前不可判定。
     */
    debugJudgeAt(tMs: number): PressOutcome | null {
        return this.judgeAt(tMs);
    }

    /** 真正的判定入口：一次调用 = 一次尝试的判决（press 与 debugJudgeAt 共用） */
    private judgeAt(pressMs: number): PressOutcome | null {
        const def = this.levelDef();
        const rt = this.runtime;
        if (this.frozen || !def || !rt) {
            return null;
        }
        const result = this.bridge.judge(rt, pressMs, this.combo);

        this.frozen = true;
        this.clock.setPaused(true);

        if (this.attemptsLeft > 0) {
            this.attemptsLeft--;
        }
        if (result.pass) {
            this.combo++;
        } else {
            this.combo = 0;
        }

        // 星级**只信 core**：starsOfResult 先用 result.pass 门控（没过一律 0 星），双物体关不会被算成「三星但没过」
        const stars = this.bridge.starsOfResult(rt, result);
        const lastLevel = this.levelIndex + 1 >= this.bridge.levels.length;
        const canRetry = !result.pass && this.attemptsLeft > 0;

        if (result.pass) {
            this.recordClear(def, stars, lastLevel);
        }

        return {
            result,
            pressMs,
            attemptsLeft: this.attemptsLeft,
            pass: result.pass,
            allClear: result.pass && lastLevel,
            stars,
            combo: this.combo,
            canRetry,
        };
    }

    // ---------------------------------------------------------------- 内部

    /** 记进度：最好星数取大，解锁下一关（不越过最后一关） */
    private recordClear(def: LevelDef, stars: number, lastLevel: boolean): void {
        const key = String(def.id);
        const old = this.starsOf(def.id);
        if (stars > old) {
            this.progress.stars[key] = stars;
        }
        if (!lastLevel) {
            const next = def.id + 1;
            if (next > this.progress.unlocked) {
                this.progress.unlocked = next;
            }
        }
        this.saveProgress();
    }

    /** 写存档（失败只 warn，不阻断流程） */
    private saveProgress(): void {
        try {
            sys.localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress));
        } catch (e) {
            console.warn('[LevelRunner] 存档写入失败：', e);
        }
    }

    /** 清空当前关的物体节点 */
    private clearMovers(): void {
        for (let i = 0; i < this.movers.length; i++) {
            this.movers[i].destroy();
        }
        this.movers = [];
    }

    /** 退出游戏（Boot.onDestroy 调）：清节点 + 冻结，避免残留节点泄漏 */
    dispose(): void {
        this.clearMovers();
        this.runtime = null;
        this.frozen = true;
        this.clock.setPaused(true);
    }
}
