/**
 * Theme.ts —— UI 外观常量 + 「设计坐标 ↔ Canvas 局部坐标」换算
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：Boot / Hud / ResultPanel / Heatmap / Mover 的外观数值全部来自本文件。
 * 颜色最终以 `02_美术源文件/风格圣经.md` 为准，本文件只是占位色 —— 换色只改这一处，不许散进逻辑代码。
 *
 * 约定：本文件**不含任何玩法数值**。玩法数值只来自 `core/Layout.ts` 与 `assets/resources/config/*.json`。
 */

import { Color } from 'cc';
import { DESIGN_H, DESIGN_W, SAFE } from '../../core/Layout';

/** 一半：设计坐标以屏幕中心为原点，换算时要用 */
const HALF = 0.5;
/** 颜色通道上限（Color 用 0–255） */
const BYTE_MAX = 255;
/** 十六进制里一个通道占 2 个字符 */
const HEX_PAIR = 2;
const HEX_BASE = 16;

// ---------------------------------------------------------------------------
// 坐标换算（唯一口径）
// ---------------------------------------------------------------------------

/**
 * 设计坐标 x（原点左上、0..720）→ Canvas 局部坐标 x（原点中心、-360..360）。
 * 谁负责：客户端程序。这是全工程唯一的横向换算口径，禁止在别处再写一次。
 */
export function toLocalX(x: number): number {
    return x - DESIGN_W * HALF;
}

/**
 * 设计坐标 y（原点左上、y 向下、0..1280）→ Canvas 局部坐标 y（原点中心、y 向上）。
 * 谁负责：客户端程序。Cocos 的 y 轴向上，与策划表相反，所有 y 必须走这里。
 */
export function toLocalY(y: number): number {
    return DESIGN_H * HALF - y;
}

// ---------------------------------------------------------------------------
// 颜色
// ---------------------------------------------------------------------------

/** '#RRGGBB' / '#RRGGBBAA' → Color；自己解析，不依赖引擎静态方法的版本差异 */
export function hexColor(hex: string, alpha: number = BYTE_MAX): Color {
    const h = hex.charAt(0) === '#' ? hex.substring(1) : hex;
    const r = parseInt(h.substring(0, HEX_PAIR), HEX_BASE);
    const g = parseInt(h.substring(HEX_PAIR, HEX_PAIR * 2), HEX_BASE);
    const b = parseInt(h.substring(HEX_PAIR * 2, HEX_PAIR * 3), HEX_BASE);
    const a = h.length >= HEX_PAIR * 4 ? parseInt(h.substring(HEX_PAIR * 3, HEX_PAIR * 4), HEX_BASE) : alpha;
    return new Color(r, g, b, a);
}

/** 线性混色：t=0 取 a，t=1 取 b（背景渐变用，只在建场景时调一次） */
export function mixColor(a: Color, b: Color, t: number): Color {
    return new Color(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t),
        Math.round(a.a + (b.a - a.a) * t),
    );
}

/** 0..1 透明度 → UIOpacity 用的 0..255 整数 */
export function opacityOf(alpha: number): number {
    return Math.round(BYTE_MAX * alpha);
}

/** 占位色板（美术《风格圣经》落地后整体替换，逻辑代码不用改） */
export const COLORS = {
    bgTop: '#10131A',
    bgBottom: '#1B2030',
    target: '#3DDC84',
    targetGlow: '#3DDC84',
    textMain: '#F2F5F8',
    textSub: '#9AA4B2',
    btnFill: '#232A36',
    btnStroke: '#5A6779',
    panelBg: '#0E1219',
    panelEdge: '#3A4556',
    heatGreen: '#3DDC84',
    heatRed: '#FF4D4F',
    flash: '#FFFFFF',
    starOn: '#FFD166',
    starOff: '#3A4556',
} as const;

/** 透明度（任务书 / 策划表里写死的值） */
export const ALPHA = {
    /** 热力图两层 Graphics 的透明度：任务书 0.55 */
    heat: 0.55,
    /** 绿框外发光 */
    targetGlow: 0.25,
    /** 结算面板底 */
    panelBg: 0.92,
    /** 全屏压暗 */
    dim: 0.65,
    /** 闪白峰值 */
    flash: 0.85,
} as const;

// ---------------------------------------------------------------------------
// 字体（系统字体，不引美术字体文件，保证代码能先跑起来）
// ---------------------------------------------------------------------------

export const SYSTEM_FONT = 'Arial';
/** 行高 = 字号 × 1.2（中文不给 lineHeight 会被裁切） */
export const LINE_RATIO = 1.2;

/** 字号 → 行高 */
export function lineHeightOf(fontSize: number): number {
    return fontSize * LINE_RATIO;
}

/** 字号档位（设计分辨率像素） */
export const FONT = {
    title: 76,
    big: 56,
    hud: 30,
    body: 34,
    sub: 26,
    tiny: 22,
} as const;

/** 线宽档位（设计分辨率像素） */
export const STROKE = {
    target: 6,
    targetGlow: 16,
    object: 3,
    btn: 4,
    panel: 3,
} as const;

// ---------------------------------------------------------------------------
// 尺寸（能从 Layout 推的一律推，不写绝对值）
// ---------------------------------------------------------------------------

/** 内容宽 = 屏宽去掉左右安全区 */
export const CONTENT_W = DESIGN_W - SAFE.left - SAFE.right;

/** 面板：宽 = 内容宽，高 = 宽 × 0.8（视觉比例，非玩法数值） */
export const PANEL_ASPECT = 0.8;
export const PANEL_W = CONTENT_W;
export const PANEL_H = Math.round(CONTENT_W * PANEL_ASPECT);
export const PANEL_RADIUS = 28;

/** 背景渐变的横条数（只在建场景时画一次） */
export const BG_BANDS = 24;

// ---------------------------------------------------------------------------
// 文案占位（最终以 GDD 第 7 章 / levels.csv 的 note 为准；判定文案在 Layout.VERDICT_TEXT）
// ---------------------------------------------------------------------------

export const COPY = {
    homeTitle: '定格瞬间',
    homeSub: '物体翻滚飞过，绿框不动。\n重合那一瞬点【暂停】。',
    homeHint: '点击任意处开始',
    pauseBtn: '暂停',
    hudHint: '卡进绿框，点【暂停】',
    levelClearTitle: '本关通过',
    allClearTitle: '全部通关',
    allClearSub: '15 关全部卡住，截图发出去吧',
    nextHint: '点击继续',
    retryHint: '点击重来',
    retryTitle: '再来一次',
    retrySub: '机会用完了，但因果还在',
    loading: '读取配置中…',
    loadFail: '配置读取失败，看 Console',
    unlockPrefix: '第 ',
    unlockMid: ' 关',
    slash: ' / ',
    dot: ' · ',
    percentPrefix: '重合 ',
    comboPrefix: '连击 ',
    comboX: '×',
    attemptOn: '●',
    attemptOff: '○',
    attemptsGap: ' ',
    percentSuffix: '%',
    scorePrefix: '得分 ',
    starsFull: '★',
    starsEmpty: '☆',
} as const;
