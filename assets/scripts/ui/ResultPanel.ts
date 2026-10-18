/**
 * ResultPanel.ts —— 结算 / 首页 / 过关 / 全通 面板（同一个面板换文案，不建第二套美术）
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：面板文案口径（评级 / 早晚 ms / 角度 / 星数）是 H4 假设的验收点，
 * 测试会逐字核对；模板来自 `core/Layout.ts` 的 VERDICT_TEXT / TIMING_TEXT，不许在本文件另写一份。
 *
 * 性能：只在「切换面板」时拼字符串；update 里不碰本类。
 */

import { Label, Node } from 'cc';
import { DESIGN_H, DESIGN_W, TIMING_TEXT, VERDICT_TEXT } from '../../core/Layout';
import type { RatingId } from '../../core/Types';
import {
    ALPHA,
    COLORS,
    COPY,
    FONT,
    PANEL_H,
    PANEL_RADIUS,
    PANEL_W,
    STROKE,
    hexColor,
    opacityOf,
    toLocalX,
    toLocalY,
} from './Theme';
import { makeGraphics, makeLabel, makeNode } from './UiKit';

/** 面板内各行相对面板中心的位置（占面板高度的比例，正 = 偏上） */
const ROW = {
    title: 0.34,
    sub: 0.17,
    percent: 0.03,
    timing: -0.09,
    score: -0.21,
    stars: -0.32,
    hint: -0.43,
} as const;

/** 面板内文字宽度占面板宽的比例 */
const TEXT_W_RATIO = 0.86;
/** 面板内单行高度占面板高的比例 */
const TEXT_H_RATIO = 0.13;
/** 星数显示上限（三星制，与 Layout.STAR_SPLIT 口径一致） */
const STAR_MAX = 3;
/** 取整后为 0 毫秒 / 0 度 → 视为「时机刚好」 */
const ON_TIME = 0;
/** 一半 */
const HALF = 0.5;

/** 结算面板要显示的数值（由 Boot 从 PressOutcome 转过来，面板只负责排版） */
export interface ResultView {
    rating: RatingId;
    /** 重合率 0..100 */
    percent: number;
    /** 带符号毫秒：负 = 按早了 */
    deltaMs: number;
    /** 带符号角度：正 = 物体比目标多转了 */
    angleDeg: number;
    /** 最终得分 */
    score: number;
    /** 星数 0..3 */
    stars: number;
    /** 底部的行动提示（「点击继续」/「点击重来」，由 Boot 按后续状态给） */
    hint: string;
}

/** 把 `{ms}` / `{deg}` 占位符替换成数字（模板在 Layout.TIMING_TEXT，改文案去改那里） */
function fillTiming(template: string, ms: number, deg: number): string {
    return template.replace('{ms}', String(ms)).replace('{deg}', String(deg));
}

export class ResultPanel {
    private root: Node | null = null;
    private title: Label | null = null;
    private sub: Label | null = null;
    private percent: Label | null = null;
    private timing: Label | null = null;
    private score: Label | null = null;
    private stars: Label | null = null;
    private hint: Label | null = null;

    /** 建面板节点树（挂在 Boot 给的 panelLayer 下） */
    init(parent: Node): void {
        const root = makeNode('ResultPanel', parent, 0, 0, DESIGN_W, DESIGN_H);
        this.root = root;
        root.active = false;

        // 全屏压暗（挡住底下的物体，避免玩家误以为还在动）
        const dim = makeGraphics('PanelDim', root, 0, 0, DESIGN_W, DESIGN_H);
        dim.fillColor = hexColor(COLORS.panelBg, opacityOf(ALPHA.dim));
        dim.rect(toLocalX(0), toLocalY(DESIGN_H), DESIGN_W, DESIGN_H);
        dim.fill();

        // 底板
        const box = makeNode('PanelBox', root, 0, 0, PANEL_W, PANEL_H);
        const bg = makeGraphics('PanelBg', box, 0, 0, PANEL_W, PANEL_H);
        bg.fillColor = hexColor(COLORS.panelBg, opacityOf(ALPHA.panelBg));
        bg.strokeColor = hexColor(COLORS.panelEdge);
        bg.lineWidth = STROKE.panel;
        bg.roundRect(-PANEL_W * HALF, -PANEL_H * HALF, PANEL_W, PANEL_H, PANEL_RADIUS);
        bg.fill();
        bg.stroke();

        const textW = PANEL_W * TEXT_W_RATIO;
        const textH = PANEL_H * TEXT_H_RATIO;
        const main = hexColor(COLORS.textMain);
        const sub = hexColor(COLORS.textSub);
        const accent = hexColor(COLORS.starOn);

        this.title = makeLabel('PanelTitle', box, 0, PANEL_H * ROW.title, textW, textH, '', FONT.big, main);
        this.sub = makeLabel('PanelSub', box, 0, PANEL_H * ROW.sub, textW, textH, '', FONT.sub, sub);
        this.percent = makeLabel('PanelPercent', box, 0, PANEL_H * ROW.percent, textW, textH, '', FONT.title, main);
        this.timing = makeLabel('PanelTiming', box, 0, PANEL_H * ROW.timing, textW, textH, '', FONT.body, sub);
        this.score = makeLabel('PanelScore', box, 0, PANEL_H * ROW.score, textW, textH, '', FONT.body, main);
        this.stars = makeLabel('PanelStars', box, 0, PANEL_H * ROW.stars, textW, textH, '', FONT.big, accent);
        this.hint = makeLabel('PanelHint', box, 0, PANEL_H * ROW.hint, textW, textH, '', FONT.sub, sub);
    }

    /** 判定结果面板：评级 + 重合率 + 早晚 ms/角度 + 得分 + 星数 */
    showJudge(view: ResultView): void {
        const verdict = VERDICT_TEXT[view.rating];
        this.setTitle(verdict.title);
        this.setSub(verdict.sub);
        this.setPercent(view.percent);
        this.setTiming(view.deltaMs, view.angleDeg);
        this.setScore(view.score);
        this.setStars(view.stars);
        this.setHint(view.hint);
        this.setActive(this.percent, true);
        this.setActive(this.timing, true);
        this.setActive(this.score, true);
        this.setActive(this.stars, true);
        this.open();
    }

    /** 首页：标题 + 一句话规则 + 开始提示 */
    showHome(): void {
        this.setTitle(COPY.homeTitle);
        this.setSub(COPY.homeSub);
        this.setHint(COPY.homeHint);
        this.compactLayout(false);
        this.open();
    }

    /** 过关：本关通过 + 星数 + 点击继续 */
    showLevelClear(levelName: string, stars: number): void {
        this.setTitle(COPY.levelClearTitle);
        this.setSub(levelName);
        this.setStars(stars);
        this.setHint(COPY.nextHint);
        this.compactLayout(true);
        this.open();
    }

    /** 全通：最后一关也过了 */
    showAllClear(): void {
        this.setTitle(COPY.allClearTitle);
        this.setSub(COPY.allClearSub);
        this.setHint(COPY.homeHint);
        this.compactLayout(false);
        this.open();
    }

    /** 机会用完：点击重来 */
    showRetry(): void {
        this.setTitle(COPY.retryTitle);
        this.setSub(COPY.retrySub);
        this.setHint(COPY.retryHint);
        this.compactLayout(false);
        this.open();
    }

    /** 读配置中 */
    showLoading(): void {
        this.setTitle(COPY.loading);
        this.setSub('');
        this.setHint('');
        this.compactLayout(false);
        this.open();
    }

    /** 出错（不弹 toast，直接一行字，避免卡死主流程） */
    showError(message: string): void {
        this.setTitle(COPY.loadFail);
        this.setSub(message);
        this.setHint('');
        this.compactLayout(false);
        this.open();
    }

    /** 隐藏面板 */
    hide(): void {
        if (this.root) {
            this.root.active = false;
        }
    }

    /** 当前是否可见（验收用） */
    isVisible(): boolean {
        return this.root !== null && this.root.active;
    }

    // ---------------------------------------------------------------- 内部

    /** 非结算页：只留标题/副标题/提示（+ 可选星数） */
    private compactLayout(showStars: boolean): void {
        this.setActive(this.percent, false);
        this.setActive(this.timing, false);
        this.setActive(this.score, false);
        this.setActive(this.stars, showStars);
    }

    private open(): void {
        if (this.root) {
            this.root.active = true;
        }
    }

    private setActive(label: Label | null, visible: boolean): void {
        if (label) {
            label.node.active = visible;
        }
    }

    private setTitle(text: string): void {
        if (this.title) {
            this.title.string = text;
        }
    }

    private setSub(text: string): void {
        if (this.sub) {
            this.sub.string = text;
        }
    }

    private setPercent(percent: number): void {
        if (this.percent) {
            this.percent.string = COPY.percentPrefix + percent.toFixed(1) + COPY.percentSuffix;
        }
    }

    /** 早晚文案：模板来自 Layout.TIMING_TEXT，数字取整（<1ms 视为刚好） */
    private setTiming(deltaMs: number, angleDeg: number): void {
        if (!this.timing) {
            return;
        }
        const ms = Math.round(Math.abs(deltaMs));
        const deg = Math.round(Math.abs(angleDeg));
        if (ms <= ON_TIME && deg <= ON_TIME) {
            this.timing.string = TIMING_TEXT.onTime;
            return;
        }
        const template = deltaMs < 0 ? TIMING_TEXT.early : TIMING_TEXT.late;
        this.timing.string = fillTiming(template, ms, deg);
    }

    private setScore(score: number): void {
        if (this.score) {
            this.score.string = COPY.scorePrefix + String(Math.round(score));
        }
    }

    /** 星数：★/☆ 拼串（只在面板切换时调用） */
    private setStars(stars: number): void {
        if (!this.stars) {
            return;
        }
        let text = '';
        for (let i = 0; i < STAR_MAX; i++) {
            text += i < stars ? COPY.starsFull : COPY.starsEmpty;
        }
        this.stars.string = text;
    }

    private setHint(text: string): void {
        if (this.hint) {
            this.hint.string = text;
        }
    }
}
