/**
 * Heatmap.ts —— 重合热力图（绿 = 重合，红 = 偏差），两层 Graphics，透明度 0.55
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：颜色/透明度在 `Theme.ts`，数据口径在 core（经 `GameBridge.heatData`），
 * 本文件只负责画，不做任何几何计算。
 *
 * 数据形状（client-core 2026-10-18 确认）：`overlapStrips / missStrips` 直接返回
 * 「设计坐标、轴对齐的矩形（y 向下，{x,y,w,h}）」。所以这里只有坐标换算 + 两遍 fill。
 *
 * 性能：只在「按下那一刻」画一次（≤ 约 40 条 × 2 层），不在 update 里重画。
 */

import { Graphics, Node } from 'cc';
import { DESIGN_H, DESIGN_W } from '../../core/Layout';
import type { HeatData, HeatRect } from '../gameplay/GameBridge';
import { ALPHA, COLORS, hexColor, toLocalX, toLocalY } from './Theme';
import { makeGraphics, makeNode, opacityNode } from './UiKit';

export class Heatmap {
    private root: Node | null = null;
    /** 红层：并集 − 交集（物体探出绿框 / 绿框没填满的部分）= 偏差 */
    private red: Graphics | null = null;
    /** 绿层：交集 = 重合 */
    private green: Graphics | null = null;

    /** 建两层 Graphics（挂在 Boot 给的 heatLayer 下） */
    init(parent: Node): void {
        const root = makeNode('Heatmap', parent, 0, 0, DESIGN_W, DESIGN_H);
        this.root = root;
        root.active = false;
        this.red = makeGraphics('HeatRed', root, 0, 0, DESIGN_W, DESIGN_H);
        this.green = makeGraphics('HeatGreen', root, 0, 0, DESIGN_W, DESIGN_H);
        opacityNode(this.red.node, ALPHA.heat);
        opacityNode(this.green.node, ALPHA.heat);
    }

    /**
     * 画热力图：红层先画（底），绿层后画（压在上面，重合区域一眼可见）。
     * 两组都空 → 直接隐藏，调用方不用判断。
     */
    render(data: HeatData): void {
        const red = this.red;
        const green = this.green;
        const root = this.root;
        if (!red || !green || !root) {
            return;
        }
        red.clear();
        green.clear();
        if (data.miss.length === 0 && data.overlap.length === 0) {
            root.active = false;
            return;
        }
        root.active = true;
        red.fillColor = hexColor(COLORS.heatRed);
        green.fillColor = hexColor(COLORS.heatGreen);
        this.drawRects(red, data.miss);
        this.drawRects(green, data.overlap);
    }

    /** 一批矩形 → 一条路径 → 一次 fill（减少 fill 调用次数） */
    private drawRects(g: Graphics, rects: HeatRect[]): void {
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.w <= 0 || r.h <= 0) {
                continue;
            }
            // 设计坐标 y 向下 → 节点局部坐标 y 向上：矩形的左下角用「下边」= y + h
            g.rect(toLocalX(r.x), toLocalY(r.y + r.h), r.w, r.h);
        }
        g.fill();
    }

    /** 设两层透明度（0..1）：FEEDBACK_MS.heatmap 内做淡入 */
    setAlpha(alpha: number): void {
        if (!this.red || !this.green) {
            return;
        }
        opacityNode(this.red.node, alpha);
        opacityNode(this.green.node, alpha);
    }

    /** 隐藏（新一轮 / 切关 / 首页） */
    hide(): void {
        if (this.root) {
            this.root.active = false;
        }
    }

    /** 显示（热力图淡入开始时由 Boot 调） */
    show(): void {
        if (this.root) {
            this.root.active = true;
        }
    }

    /** 当前是否可见（调试与验收用） */
    isVisible(): boolean {
        return this.root !== null && this.root.active;
    }
}
