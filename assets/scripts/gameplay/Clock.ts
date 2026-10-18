/**
 * Clock.ts —— 固定步长 1/60 的逻辑时钟（全工程唯一时间来源）
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：判定回滚用的 pressMs 就来自 nowMs()，改语义 = 改判定口径。
 *
 * 为什么不用 `director.getTotalFrames()` / `Date.now()`：
 * - 帧数与真实时间会漂移，回放不可复现；
 * - 暂停要求「立刻冻结、不等下一帧」，所以暂停标志必须进时钟本身。
 *
 * 语义（写死，改要打招呼）：
 * - `tick(dt)` 只在未暂停时推进，推进量是**整数个 1/60 步**（余量留到下一帧），所以不会漂移；
 * - `nowMs()` = **最近一次渲染出来的那一帧**的逻辑时间，也就是玩家眼睛看到的那一帧；
 * - 按下时取 `nowMs()` 去回滚判定 —— 「看到哪一帧就判哪一帧」，不用下一帧状态。
 */

/** 一逻辑步 = 1000/60 ms ≈ 16.667ms（引擎时间步常量，不是策划数值） */
export const STEP_MS = 1000 / 60;

/** 一次 tick 最多补几步：防止切后台回来后的 catch-up 螺旋（引擎保护常量） */
const MAX_STEPS_PER_TICK = 4;

/** 秒 → 毫秒（导出：Boot 的反馈计时器用同一口径，别在别处再写 1000） */
export const MS_PER_SEC = 1000;

export class Clock {
    /** 逻辑时间（毫秒），只会按 STEP_MS 递增 */
    private tMs: number = 0;
    /** 未满一步的余量（毫秒） */
    private accMs: number = 0;
    /** 暂停时完全不推进，pressMs 因此天然静止 */
    private paused: boolean = false;

    /** 推进一帧，返回本帧结束后的逻辑时间（毫秒）。暂停中调用无效。 */
    tick(dtSec: number): number {
        if (this.paused) {
            return this.tMs;
        }
        if (dtSec > 0) {
            this.accMs += dtSec * MS_PER_SEC;
        }
        let steps = 0;
        while (this.accMs >= STEP_MS && steps < MAX_STEPS_PER_TICK) {
            this.tMs += STEP_MS;
            this.accMs -= STEP_MS;
            steps++;
        }
        if (this.accMs > STEP_MS * MAX_STEPS_PER_TICK) {
            // 卡顿过久：直接丢掉积压，宁可掉一段动画也不要螺旋补帧
            this.accMs = 0;
        }
        return this.tMs;
    }

    /** 当前逻辑时间（毫秒）。这就是「玩家看到的那一帧」。 */
    nowMs(): number {
        return this.tMs;
    }

    /** 当前是第几步（整数帧号，从 0 起） */
    nowStep(): number {
        return Math.round(this.tMs / STEP_MS);
    }

    /** 设暂停：true = 冻结（判定后必须调它，保证画面与输入同时停住） */
    setPaused(paused: boolean): void {
        this.paused = paused;
    }

    /** 是否暂停中 */
    isPaused(): boolean {
        return this.paused;
    }

    /** 归零到指定时间（每次尝试进场调 reset(0)，保证同 seed 逐帧一致） */
    reset(tMs: number = 0): void {
        this.tMs = tMs;
        this.accMs = 0;
    }
}
