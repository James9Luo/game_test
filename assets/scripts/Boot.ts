/**
 * Boot.ts —— 唯一入口：挂在场景任意节点上，用代码建出整棵 UI 树并驱动状态机
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：状态机（HOME → PLAY → JUDGED → LEVEL_CLEAR → ALL_CLEAR）与反馈时序在这里，
 * 测试用例 `debugJump` 也在这里，改状态名等于让测试脚本全部返工。
 *
 * 设计原则：
 * - **不自己造 Camera**：场景里必须已有 Canvas + Camera（接入说明第 1 步）。缺了只报错，不猜。
 * - **零美术资源依赖**：所有图形都用 Graphics 画、所有文字都用系统字体，保证没有美术也能先跑起来。
 * - **零玩法数值**：位置来自 Layout.ts，关卡数值来自 levels.json，判定全部在 core。
 *
 * 反馈时序（Layout.FEEDBACK_MS，顺序固定不可调换）：
 *   按下 → 冻结（当帧）→ 闪白 90ms → 热力图 120ms → 评级面板 260ms → 停留 900ms 后可继续
 */

import { _decorator, Camera, Canvas, Color, Component, Graphics, Node, director, find, input, Input, view } from 'cc';
import type { Vec2 } from './core/Geometry';
import { DESIGN_H, DESIGN_W, FEEDBACK_MS, PAUSE_BTN, RETRY_DELAY_MS } from './core/Layout';
import { Clock, MS_PER_SEC } from './gameplay/Clock';
import { GameBridge } from './gameplay/GameBridge';
import { LevelRunner } from './gameplay/LevelRunner';
import type { PressOutcome } from './gameplay/LevelRunner';
import { Heatmap } from './ui/Heatmap';
import { Hud } from './ui/Hud';
import { ResultPanel } from './ui/ResultPanel';
import type { ResultView } from './ui/ResultPanel';
import {
    ALPHA,
    BG_BANDS,
    COLORS,
    COPY,
    FONT,
    STROKE,
    hexColor,
    mixColor,
    opacityOf,
    toLocalX,
    toLocalY,
} from './ui/Theme';
import { makeGraphics, makeLabel, makeRootLayer, opacityNode } from './ui/UiKit';

const { ccclass } = _decorator;

/**
 * 游戏状态（用字符串常量不用 enum：本项目走 ES2015 + 类型擦除，enum 会带运行时代码，
 * 且 `debugJump` 要能被外部脚本按字符串驱动）。
 */
export const GameState = {
    HOME: 'HOME',
    PLAY: 'PLAY',
    JUDGED: 'JUDGED',
    LEVEL_CLEAR: 'LEVEL_CLEAR',
    ALL_CLEAR: 'ALL_CLEAR',
} as const;

/** 状态 id 联合类型 */
export type GameStateId = (typeof GameState)[keyof typeof GameState];

/** 判定后「接下来去哪」的内部标记 */
const PENDING_NEXT = 'next';
const PENDING_ALL_CLEAR = 'allClear';
const PENDING_RETRY = 'retry';
const PENDING_FAIL = 'fail';

/** 设计分辨率校验容差（像素） */
const TOL_PX = 1;
/** 画矩形时多画 1px 防相邻带之间出现接缝 */
const SEAM_PX = 1;
/**
 * 关内失败是否自动重新进场（Layout.RETRY_DELAY_MS 的语义）。
 * true = 评级面板停留到 resultHold 后自动重进（规格字面口径）；
 * false = 等玩家点一下再重进（给读文案的时间）。
 */
const AUTO_RETRY_ON_FAIL = true;

@ccclass('Boot')
export class Boot extends Component {
    // ---- 节点（全部代码建，预制体里只需要挂本组件） ----
    private root: Node | null = null;
    private targetGfx: Graphics | null = null;
    private objectLayer: Node | null = null;
    private pauseLayer: Node | null = null;
    private flashGfx: Graphics | null = null;

    // ---- 逻辑层 ----
    private readonly clock: Clock = new Clock();
    private readonly hud: Hud = new Hud();
    private readonly panel: ResultPanel = new ResultPanel();
    private readonly heatmap: Heatmap = new Heatmap();
    private bridge: GameBridge | null = null;
    private runner: LevelRunner | null = null;

    // ---- 状态机 ----
    private state: string = GameState.HOME;
    private ready: boolean = false;
    /** 判定后的反馈计时（毫秒，真实时间；不受 clock 暂停影响） */
    private feedbackMs: number = 0;
    /** 评级面板是否已经弹过（避免每帧重复 show） */
    private panelShown: boolean = false;
    /** 本次判定后要去哪 */
    private pending: string = PENDING_NEXT;
    /** 停在「机会用完」页，等玩家点重来 */
    private awaitingRetry: boolean = false;
    /** 最近一次判定结果（面板数据源） */
    private lastOutcome: PressOutcome | null = null;
    /** 同一帧只认一次输入：touch 与 mouse 模拟会成对触发 */
    private pressFrame: number = -1;

    // ================================================================ 生命周期

    protected onLoad(): void {
        const canvasNode = this.resolveCanvas();
        if (!canvasNode) {
            return;
        }
        this.buildTree(canvasNode);
        this.bindInput();
        this.panel.showLoading();
    }

    protected start(): void {
        this.loadConfig();
    }

    protected update(dt: number): void {
        if (!this.root) {
            return;
        }
        if (this.state === GameState.PLAY) {
            const runner = this.runner;
            if (runner) {
                runner.update(dt);
                // setCombo 内部有值缓存：值没变不拼字符串
                this.hud.setCombo(runner.comboCount(), runner.comboCoef());
            }
            return;
        }
        if (this.state === GameState.JUDGED) {
            this.feedbackMs += dt * MS_PER_SEC;
            this.updateFlash();
            this.updateHeatFade();
            if (this.feedbackMs >= FEEDBACK_MS.panel) {
                this.showJudgePanel();
            }
            // 失败但还有机会：等结算停留结束（且不早于 RETRY_DELAY_MS）后自动重新进场
            if (AUTO_RETRY_ON_FAIL && this.pending === PENDING_RETRY) {
                const waitMs = FEEDBACK_MS.resultHold > RETRY_DELAY_MS ? FEEDBACK_MS.resultHold : RETRY_DELAY_MS;
                if (this.feedbackMs >= waitMs) {
                    this.applyPending();
                }
            }
        }
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onPress, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onPress, this);
        if (this.runner) {
            this.runner.dispose();
        }
    }

    // ================================================================ 对外（测试 / 调试）

    /**
     * 测试用：强制跳到指定状态，不做进度校验、不拦输入。
     * @param state GameState 里的字符串（'HOME' / 'PLAY' / 'JUDGED' / 'LEVEL_CLEAR' / 'ALL_CLEAR'）
     * @param level 关卡 id（1 基，对应 levels.csv 的 id）；HOME 忽略
     */
    debugJump(state: string, level: number): void {
        const runner = this.runner;
        if (!this.ready || !runner) {
            console.warn('[Boot] debugJump 时配置尚未加载完成，已忽略');
            return;
        }
        let index = runner.indexOfLevelId(level);
        if (index < 0) {
            index = level - 1;
        }
        this.clearFlash();
        this.heatmap.hide();
        this.awaitingRetry = false;
        this.panelShown = false;
        this.feedbackMs = 0;

        if (state === GameState.HOME) {
            this.goHome();
            return;
        }
        if (state === GameState.PLAY) {
            if (!runner.startLevel(index)) {
                console.warn('[Boot] debugJump 关卡越界：' + level);
                return;
            }
            this.state = GameState.PLAY;
            this.panel.hide();
            this.afterAttemptStarted();
            return;
        }
        if (state === GameState.JUDGED) {
            if (!runner.startLevel(index)) {
                console.warn('[Boot] debugJump 关卡越界：' + level);
                return;
            }
            this.afterAttemptStarted();
            const rt = runner.runtimeNow();
            const outcome = runner.debugJudgeAt(rt ? rt.perfectMs : 0);
            if (!outcome) {
                return;
            }
            this.enterJudged(outcome);
            // 直接跳到「面板已弹出」的时刻，省掉等 260ms
            this.feedbackMs = FEEDBACK_MS.panel;
            this.showJudgePanel();
            this.heatmap.setAlpha(ALPHA.heat);
            return;
        }
        if (state === GameState.LEVEL_CLEAR) {
            if (!runner.startLevel(index)) {
                console.warn('[Boot] debugJump 关卡越界：' + level);
                return;
            }
            this.afterAttemptStarted();
            const def = runner.levelDef();
            this.state = GameState.LEVEL_CLEAR;
            this.hud.setVisible(false);
            if (this.pauseLayer) {
                this.pauseLayer.active = false;
            }
            this.panel.showLevelClear(def ? def.name : '', runner.starsOf(def ? def.id : 0));
            return;
        }
        if (state === GameState.ALL_CLEAR) {
            this.state = GameState.ALL_CLEAR;
            this.hud.setVisible(false);
            if (this.pauseLayer) {
                this.pauseLayer.active = false;
            }
            this.panel.showAllClear();
            return;
        }
        console.warn('[Boot] debugJump 未知状态：' + state);
    }

    /** 当前状态（测试断言用） */
    currentState(): string {
        return this.state;
    }

    // ================================================================ 建树

    /** 找到并校验场景里的 Canvas（**不创建 Camera**，缺了直接报错让人去补） */
    private resolveCanvas(): Node | null {
        const canvasNode = find('Canvas');
        if (!canvasNode) {
            console.error('[Boot] 场景里找不到名为 "Canvas" 的节点。接入说明第 1 步：新建 2D 场景，保留默认 Canvas + Camera。');
            return null;
        }
        if (!canvasNode.getComponent(Canvas)) {
            console.error('[Boot] "Canvas" 节点上没有 Canvas 组件。请用 Cocos 的「新建 Canvas」，别手搭空节点。');
            return null;
        }
        if (!canvasNode.getComponentInChildren(Camera)) {
            console.error('[Boot] Canvas 下没有 Camera 子节点，UI 不会被渲染。请用默认 Canvas（自带 Camera）。');
            return null;
        }
        const size = view.getDesignResolutionSize();
        if (Math.abs(size.width - DESIGN_W) > TOL_PX || Math.abs(size.height - DESIGN_H) > TOL_PX) {
            console.warn(
                '[Boot] 设计分辨率不是 ' + DESIGN_W + '×' + DESIGN_H + '，实际 ' + size.width + '×' + size.height +
                    '。接入说明第 4 步：项目设置 → 设计分辨率 720×1280、适配 Fit Width。',
            );
        }
        return canvasNode;
    }

    /** 建节点树：背景 / 绿框层 / 物体层 / 热力图层 / 闪白层 / HUD / 暂停按钮 / 结算面板 */
    private buildTree(canvasNode: Node): void {
        const root = makeRootLayer('DistaRoot', canvasNode);
        this.root = root;

        // 顺序 = 绘制顺序（后面的盖在前面的上面）
        const bg = makeGraphics('BgLayer', root, 0, 0, DESIGN_W, DESIGN_H);
        this.drawBackground(bg);

        this.targetGfx = makeGraphics('TargetLayer', root, 0, 0, DESIGN_W, DESIGN_H);

        this.objectLayer = makeRootLayer('ObjectLayer', root);

        const heatLayer = makeRootLayer('HeatLayer', root);
        this.heatmap.init(heatLayer);

        const flashLayer = makeRootLayer('FlashLayer', root);
        const flash = makeGraphics('Flash', flashLayer, 0, 0, DESIGN_W, DESIGN_H);
        flash.fillColor = hexColor(COLORS.flash);
        flash.rect(toLocalX(0), toLocalY(DESIGN_H), DESIGN_W, DESIGN_H);
        flash.fill();
        opacityNode(flash.node, 0);
        this.flashGfx = flash;
        flashLayer.active = false;

        this.pauseLayer = makeRootLayer('PauseLayer', root);
        this.drawPauseButton(this.pauseLayer);
        this.pauseLayer.active = false;

        const hudLayer = makeRootLayer('HudLayer', root);
        this.hud.init(hudLayer);
        this.hud.setHint(COPY.hudHint);

        const panelLayer = makeRootLayer('PanelLayer', root);
        this.panel.init(panelLayer);
    }

    /** 背景：竖向渐变（横向分带近似；只在开机时画一次） */
    private drawBackground(g: Graphics): void {
        g.clear();
        const top = hexColor(COLORS.bgTop);
        const bottom = hexColor(COLORS.bgBottom);
        const bandH = DESIGN_H / BG_BANDS;
        for (let i = 0; i < BG_BANDS; i++) {
            const y0 = bandH * i;
            const y1 = y0 + bandH;
            g.fillColor = mixColor(top, bottom, i / BG_BANDS);
            g.rect(toLocalX(0), toLocalY(y1), DESIGN_W, bandH + SEAM_PX);
            g.fill();
        }
    }

    /** 暂停按钮：唯一的视觉按钮（整个可玩区都可点，按钮只是心理锚点） */
    private drawPauseButton(parent: Node): void {
        const g = makeGraphics(
            'PauseButton',
            parent,
            toLocalX(PAUSE_BTN.cx),
            toLocalY(PAUSE_BTN.cy),
            PAUSE_BTN.r * 2,
            PAUSE_BTN.r * 2,
        );
        g.fillColor = hexColor(COLORS.btnFill);
        g.strokeColor = hexColor(COLORS.btnStroke);
        g.lineWidth = STROKE.btn;
        g.circle(0, 0, PAUSE_BTN.r);
        g.fill();
        g.stroke();
        makeLabel('PauseText', g.node, 0, 0, PAUSE_BTN.r * 2, PAUSE_BTN.r * 2, COPY.pauseBtn, FONT.big, hexColor(COLORS.textMain));
    }

    /** 画绿框：多边形**直接来自 core 的 targetPts**，保证「看到的绿框 = 判定的绿框」 */
    private drawTargets(): void {
        const g = this.targetGfx;
        const runner = this.runner;
        if (!g || !runner) {
            return;
        }
        g.clear();
        const rt = runner.runtimeNow();
        if (!rt) {
            return;
        }
        for (let i = 0; i < rt.movers.length; i++) {
            const pts = rt.movers[i].targetPts;
            this.strokePoly(g, pts, STROKE.targetGlow, hexColor(COLORS.targetGlow, opacityOf(ALPHA.targetGlow)));
            this.strokePoly(g, pts, STROKE.target, hexColor(COLORS.target));
        }
    }

    /** 用一条闭合折线描边（先宽后窄 = 发光 + 主描边；每次重建路径，不依赖 Graphics 的路径残留行为） */
    private strokePoly(g: Graphics, pts: Vec2[], width: number, color: Color): void {
        if (pts.length < 2) {
            return;
        }
        g.lineWidth = width;
        g.strokeColor = color;
        g.moveTo(toLocalX(pts[0].x), toLocalY(pts[0].y));
        for (let i = 1; i < pts.length; i++) {
            g.lineTo(toLocalX(pts[i].x), toLocalY(pts[i].y));
        }
        g.close();
        g.stroke();
    }

    // ================================================================ 配置

    /** 异步读配置；失败只显示一行错误，不弹窗、不卡死 */
    private loadConfig(): void {
        GameBridge.load()
            .then((bridge: GameBridge) => {
                this.bridge = bridge;
                const issues = bridge.validate();
                for (let i = 0; i < issues.length; i++) {
                    console.warn('[Boot] 配置问题：' + issues[i]);
                }
                if (bridge.levels.length === 0) {
                    this.panel.showError('levels.json 里没有关卡');
                    return;
                }
                const runner = new LevelRunner(bridge, this.clock);
                if (this.objectLayer) {
                    runner.attach(this.objectLayer);
                }
                this.runner = runner;
                this.ready = true;
                this.goHome();
            })
            .catch((e: Error) => {
                console.error('[Boot] 配置读取失败：', e);
                this.panel.showError(e && e.message ? e.message : '未知错误');
            });
    }

    // ================================================================ 输入

    /** 输入只认 TOUCH_START / MOUSE_DOWN，整个可玩区（全屏）都是点击区 */
    private bindInput(): void {
        input.on(Input.EventType.TOUCH_START, this.onPress, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onPress, this);
    }

    /**
     * 唯一的输入出口：按状态分派。
     * 同一帧的重复事件（touch + 模拟 mouse）直接丢弃 —— 否则一次点击会被算成两次。
     */
    private onPress(): void {
        if (!this.ready || !this.runner) {
            return;
        }
        const frame = director.getTotalFrames();
        if (frame === this.pressFrame) {
            return;
        }
        this.pressFrame = frame;

        if (this.state === GameState.HOME) {
            this.startRun(this.runner.firstPlayableIndex());
            return;
        }
        if (this.state === GameState.PLAY) {
            const outcome = this.runner.press();
            if (!outcome) {
                return; // 连点 / 冻结中 / 结算中：一律丢弃
            }
            this.enterJudged(outcome);
            return;
        }
        if (this.state === GameState.JUDGED) {
            if (this.feedbackMs < FEEDBACK_MS.resultHold) {
                return; // 结算停留期内点击无效（防手抖连点跳关）
            }
            if (this.awaitingRetry) {
                this.restartLevel();
                return;
            }
            this.applyPending();
            return;
        }
        if (this.state === GameState.LEVEL_CLEAR) {
            this.goNext();
            return;
        }
        if (this.state === GameState.ALL_CLEAR) {
            this.goHome();
        }
    }

    // ================================================================ 状态流转

    /** 开始某一关（0 基序号） */
    private startRun(index: number): void {
        const runner = this.runner;
        if (!runner) {
            return;
        }
        if (!runner.startLevel(index)) {
            console.warn('[Boot] 无法开始关卡序号：' + index);
            return;
        }
        this.state = GameState.PLAY;
        this.afterAttemptStarted();
    }

    /** 每次尝试进场后的统一收尾：画绿框、刷 HUD、清反馈层 */
    private afterAttemptStarted(): void {
        const runner = this.runner;
        this.panel.hide();
        this.panelShown = false;
        this.feedbackMs = 0;
        this.awaitingRetry = false;
        this.heatmap.hide();
        this.clearFlash();
        this.drawTargets();
        const flashLayer = this.flashGfx ? this.flashGfx.node.parent : null;
        if (flashLayer) {
            flashLayer.active = false;
        }
        if (this.pauseLayer) {
            this.pauseLayer.active = true;
        }
        this.hud.setVisible(true);
        if (!runner) {
            return;
        }
        const def = runner.levelDef();
        if (def) {
            this.hud.setLevel(runner.index(), runner.total(), def.name);
        }
        this.hud.setAttempts(runner.attempts(), runner.maxAttempts());
        this.hud.setCombo(runner.comboCount(), runner.comboCoef());
        this.hud.setHint(COPY.hudHint);
    }

    /** 判定完成：冻结已在 runner 内完成，这里负责「反馈三件套」的开场 */
    private enterJudged(outcome: PressOutcome): void {
        this.lastOutcome = outcome;
        this.state = GameState.JUDGED;
        this.feedbackMs = 0;
        this.panelShown = false;
        this.awaitingRetry = false;
        this.panel.hide();

        // 1) 闪白：当帧给峰值，update 里按 FEEDBACK_MS.flash 衰减
        this.setFlashPeak();
        // 2) 热力图：先画好、透明度 0，update 里按 FEEDBACK_MS.heatmap 淡入
        const bridge = this.bridge;
        if (bridge) {
            this.heatmap.render(bridge.heatData(outcome.result));
            this.heatmap.setAlpha(0);
        }
        const runner = this.runner;
        if (runner) {
            this.hud.setAttempts(outcome.attemptsLeft, runner.maxAttempts());
            this.hud.setCombo(outcome.combo, runner.comboCoef());
        }
        // 3) 评级面板：等 FEEDBACK_MS.panel 后由 update 弹出
        if (outcome.pass) {
            this.pending = outcome.allClear ? PENDING_ALL_CLEAR : PENDING_NEXT;
        } else {
            this.pending = outcome.canRetry ? PENDING_RETRY : PENDING_FAIL;
        }
    }

    /** 评级面板（只弹一次） */
    private showJudgePanel(): void {
        if (this.panelShown) {
            return;
        }
        this.panelShown = true;
        const outcome = this.lastOutcome;
        if (!outcome) {
            return;
        }
        const objs = outcome.result.objects;
        const view: ResultView = {
            rating: outcome.result.rating,
            percent: outcome.result.pct,
            deltaMs: outcome.result.timing.deltaMs,
            angleDeg: objs.length > 0 ? objs[0].angleDev : 0,
            score: outcome.result.score,
            stars: outcome.stars,
            hint: this.pending === PENDING_FAIL ? COPY.retryHint : COPY.nextHint,
        };
        this.panel.showJudge(view);
    }

    /** 停留期结束、玩家点一下之后：按 pending 决定去哪 */
    private applyPending(): void {
        const runner = this.runner;
        this.clearFlash();
        this.heatmap.hide();
        if (!runner) {
            return;
        }
        if (this.pending === PENDING_NEXT) {
            const def = runner.levelDef();
            this.state = GameState.LEVEL_CLEAR;
            this.hud.setVisible(false);
            if (this.pauseLayer) {
                this.pauseLayer.active = false;
            }
            this.panel.showLevelClear(def ? def.name : '', runner.starsOf(def ? def.id : 0));
            return;
        }
        if (this.pending === PENDING_ALL_CLEAR) {
            this.state = GameState.ALL_CLEAR;
            this.hud.setVisible(false);
            if (this.pauseLayer) {
                this.pauseLayer.active = false;
            }
            this.panel.showAllClear();
            return;
        }
        if (this.pending === PENDING_RETRY) {
            // 还有机会：自动重新进场（等待已在 resultHold 内完成，无需再定时）
            if (runner.beginAttempt()) {
                this.state = GameState.PLAY;
                this.afterAttemptStarted();
            }
            return;
        }
        // PENDING_FAIL：机会用完，停在面板等玩家点「重来」
        this.pending = PENDING_FAIL;
        this.awaitingRetry = true;
        this.panel.showRetry();
    }

    /** 进下一关（LEVEL_CLEAR 页点击） */
    private goNext(): void {
        const runner = this.runner;
        if (!runner) {
            return;
        }
        if (runner.advanceLevel()) {
            this.state = GameState.PLAY;
            this.afterAttemptStarted();
            return;
        }
        this.state = GameState.ALL_CLEAR;
        this.hud.setVisible(false);
        this.panel.showAllClear();
    }

    /** 同关重来（机会用完之后） */
    private restartLevel(): void {
        const runner = this.runner;
        if (!runner) {
            return;
        }
        if (!runner.retryLevel()) {
            return;
        }
        this.awaitingRetry = false;
        this.state = GameState.PLAY;
        this.afterAttemptStarted();
    }

    /** 回首页（清物体 + 清层） */
    private goHome(): void {
        this.clearFlash();
        this.heatmap.hide();
        if (this.targetGfx) {
            this.targetGfx.clear();
        }
        if (this.pauseLayer) {
            this.pauseLayer.active = false;
        }
        const runner = this.runner;
        if (runner) {
            runner.dispose();
        }
        this.state = GameState.HOME;
        this.hud.setVisible(false);
        this.panel.showHome();
    }

    // ================================================================ 反馈动画（手写，不用 tween）

    /** 闪白峰值：当帧生效（「按下瞬间」这一帧必须有反馈） */
    private setFlashPeak(): void {
        const g = this.flashGfx;
        if (!g) {
            return;
        }
        const layer = g.node.parent;
        if (layer) {
            layer.active = true;
        }
        opacityNode(g.node, ALPHA.flash);
    }

    /** 闪白衰减：FEEDBACK_MS.flash 内从峰值降到 0 */
    private updateFlash(): void {
        const g = this.flashGfx;
        if (!g) {
            return;
        }
        const layer = g.node.parent;
        if (FEEDBACK_MS.flash <= 0) {
            opacityNode(g.node, 0);
            return;
        }
        const t = this.feedbackMs;
        if (t >= FEEDBACK_MS.flash) {
            opacityNode(g.node, 0);
            if (layer) {
                layer.active = false;
            }
            return;
        }
        opacityNode(g.node, ALPHA.flash * (1 - t / FEEDBACK_MS.flash));
    }

    /** 热力图淡入：FEEDBACK_MS.heatmap 内从 0 到 ALPHA.heat */
    private updateHeatFade(): void {
        if (FEEDBACK_MS.heatmap <= 0) {
            this.heatmap.setAlpha(ALPHA.heat);
            return;
        }
        const t = this.feedbackMs;
        const k = t >= FEEDBACK_MS.heatmap ? 1 : t / FEEDBACK_MS.heatmap;
        this.heatmap.setAlpha(ALPHA.heat * k);
    }

    /** 立即清掉闪白（离开判定状态时调，避免残留白屏） */
    private clearFlash(): void {
        const g = this.flashGfx;
        if (!g) {
            return;
        }
        opacityNode(g.node, 0);
        const layer = g.node.parent;
        if (layer) {
            layer.active = false;
        }
    }
}
