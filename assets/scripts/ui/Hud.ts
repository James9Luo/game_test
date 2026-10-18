/**
 * Hud.ts —— 顶部 HUD：关卡号 + 关卡名 / 剩余次数 / 连击
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：HUD 的显示口径（例如「连击显示系数还是次数」）测试会照着验收。
 *
 * 性能纪律：本类所有 set* 方法都做**值缓存**，值没变就不拼字符串、不写 label.string
 * （update 里调它们是安全的：不 new、不拼接、不触发重排）。
 */

import { Label, Node } from 'cc';
import { HUD, SAFE } from '../../core/Layout';
import { COLORS, CONTENT_W, COPY, FONT, hexColor, toLocalX, toLocalY } from './Theme';
import { makeLabel, makeNode } from './UiKit';

/** 行位置（占 HUD 高度的比例，0 = 顶部） */
const ROW_LEVEL = 0.28;
const ROW_STATE = 0.72;
/** 单行高度占 HUD 高度的比例 */
const ROW_H = 0.46;
/** 左右两栏的分界（0.25 = 四分之一处） */
const QUARTER = 0.25;
const THREE_QUARTER = 0.75;
const HALF = 0.5;

export class Hud {
    private root: Node | null = null;
    private levelLabel: Label | null = null;
    private attemptsLabel: Label | null = null;
    private comboLabel: Label | null = null;
    private hintLabel: Label | null = null;

    // 值缓存：只有变化才重拼字符串
    private lastIndex: number = -1;
    private lastTotal: number = -1;
    private lastName: string = '';
    private lastLeft: number = -1;
    private lastMax: number = -1;
    private lastCombo: number = -1;
    private lastHint: string = '';

    /** 建 HUD 节点树（挂在 Boot 给的 hudLayer 下） */
    init(parent: Node): void {
        const root = makeNode('Hud', parent, 0, 0, CONTENT_W + SAFE.left + SAFE.right, HUD.h);
        this.root = root;
        root.active = false;

        const centerX = toLocalX(SAFE.left + CONTENT_W * HALF);
        const levelY = toLocalY(HUD.y + HUD.h * ROW_LEVEL);
        const rowY = toLocalY(HUD.y + HUD.h * ROW_STATE);
        const rowH = HUD.h * ROW_H;

        this.levelLabel = makeLabel('HudLevel', root, centerX, levelY, CONTENT_W, rowH, '', FONT.hud, hexColor(COLORS.textMain));
        this.attemptsLabel = makeLabel(
            'HudAttempts',
            root,
            toLocalX(SAFE.left + CONTENT_W * QUARTER),
            rowY,
            CONTENT_W * HALF,
            rowH,
            '',
            FONT.sub,
            hexColor(COLORS.textSub),
        );
        this.comboLabel = makeLabel(
            'HudCombo',
            root,
            toLocalX(SAFE.left + CONTENT_W * THREE_QUARTER),
            rowY,
            CONTENT_W * HALF,
            rowH,
            '',
            FONT.sub,
            hexColor(COLORS.starOn),
        );
        this.hintLabel = makeLabel(
            'HudHint',
            root,
            centerX,
            toLocalY(HUD.y + HUD.h),
            CONTENT_W,
            HUD.h * ROW_H,
            COPY.hudHint,
            FONT.tiny,
            hexColor(COLORS.textSub),
        );
    }

    /** 设关卡标题：`第 n / N 关 · 关卡名`（值没变不重拼） */
    setLevel(index: number, total: number, name: string): void {
        if (index === this.lastIndex && total === this.lastTotal && name === this.lastName) {
            return;
        }
        this.lastIndex = index;
        this.lastTotal = total;
        this.lastName = name;
        if (this.levelLabel) {
            this.levelLabel.string =
                COPY.unlockPrefix + String(index + 1) + COPY.slash + String(total) + COPY.unlockMid + COPY.dot + name;
        }
    }

    /** 设剩余次数：`●●○`（值没变不重拼） */
    setAttempts(left: number, max: number): void {
        if (left === this.lastLeft && max === this.lastMax) {
            return;
        }
        this.lastLeft = left;
        this.lastMax = max;
        if (!this.attemptsLabel) {
            return;
        }
        let text = '';
        for (let i = 0; i < max; i++) {
            text += i < left ? COPY.attemptOn : COPY.attemptOff;
            if (i + 1 < max) {
                text += COPY.attemptsGap;
            }
        }
        this.attemptsLabel.string = text;
    }

    /** 设连击：0 时显示空串（值没变不重拼） */
    setCombo(combo: number, coef: number): void {
        if (combo === this.lastCombo) {
            return;
        }
        this.lastCombo = combo;
        if (!this.comboLabel) {
            return;
        }
        if (combo <= 0) {
            this.comboLabel.string = '';
            return;
        }
        this.comboLabel.string = COPY.comboPrefix + String(combo) + COPY.comboX + coef.toFixed(1);
    }

    /** 设提示文案（值没变不写） */
    setHint(text: string): void {
        if (text === this.lastHint) {
            return;
        }
        this.lastHint = text;
        if (this.hintLabel) {
            this.hintLabel.string = text;
        }
    }

    /** 显隐（HOME / 结算时不显示 HUD） */
    setVisible(visible: boolean): void {
        if (this.root) {
            this.root.active = visible;
        }
    }

    /** 当前是否可见（调试用） */
    isVisible(): boolean {
        return this.root !== null && this.root.active;
    }
}
