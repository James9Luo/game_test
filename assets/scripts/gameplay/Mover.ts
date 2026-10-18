/**
 * Mover.ts —— 一个运动物体：只做「按 core 的 pose 摆节点 + 用 Graphics 画轮廓」
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：本文件**不含任何判定 / 打分 / 连击**逻辑，别往这里搬。
 *
 * 绘制方案（与 lead 定的性能方案一致）：
 * - 绿框静止 → 由 Boot 只画一次（`drawTargets()`），本文件不碰；
 * - 运动物体每帧 `clear()` 后重建路径（≤ 48 顶点 × 最多 2 个物体 = 96 个 lineTo/帧，实测在预算内）；
 * - 顶点数组**预先把「乘倍率 + y 翻转」算好并缓存**，每帧只做 moveTo/lineTo，不在 update 里 new 数组、不做乘除。
 *
 * 坐标与旋转（最容易做反的地方，改动前先读）：
 * - core 的 `shape.pts` 是「y 向下」，节点局部空间是「y 向上」，所以缓存顶点时 y 取负号；
 * - 在同一个换算下，节点旋转角必须是 **-pose.rotDeg**（不是 +），否则物体会朝反方向翻；
 * - 编辑器里若看到「物体与绿框反向转」，就是这里符号错了（接入说明 T-02）。
 *
 * 尺寸口径：倍率由 core 的 `objectScaleOf(mover)` 给（按**面积**反推，物体面积 = 目标面积），
 * 像素长边 = `shape.size × objectScaleOf(mover)`，由 LevelRunner 传进来；本文件不自己猜。
 */

import { Graphics, Node, UITransform } from 'cc';
import { polyBounds } from '../../core/Geometry';
import type { Vec2 } from '../../core/Geometry';
import type { MoverRuntime, Pose } from '../../core/Types';
import { COLORS, STROKE, hexColor, toLocalX, toLocalY } from '../ui/Theme';

/** 顶点坐标（局部空间，已乘倍率且 y 已翻转） */
interface DrawPt {
    x: number;
    y: number;
}

export class Mover {
    /** 物体节点：位置 = 形心世界坐标，angle = -rotDeg */
    readonly node: Node;
    /** 运行时数据（只读，来自 core.buildLevel） */
    readonly rt: MoverRuntime;

    private readonly graphics: Graphics;
    /** 预计算好的绘制顶点（局部空间） */
    private readonly drawPts: DrawPt[];

    /**
     * 建节点并画第一帧。
     * @param parent 物体层节点（由 Boot 建）
     * @param rt core 给的运行时（形状 / 目标多边形 / 轨迹）
     * @param order 同级排序（双物体关保证上下车道绘制顺序稳定）
     * @param unitScale core 的 objectScaleOf(mover)：物体面积 = 目标面积
     */
    constructor(parent: Node, rt: MoverRuntime, order: number, unitScale: number) {
        this.rt = rt;
        const node = new Node('Mover_' + rt.shape.id);
        node.layer = parent.layer;
        parent.addChild(node);
        node.setSiblingIndex(order);
        const ui = node.addComponent(UITransform);
        this.node = node;

        const px = rt.shape.size * unitScale;
        const k = px > 0 ? px : rt.shape.size;
        const src = rt.shape.pts;
        const pts: DrawPt[] = new Array(src.length);
        for (let i = 0; i < src.length; i++) {
            // y 取负号：设计坐标 y 向下 → 节点局部坐标 y 向上
            pts[i] = { x: src[i].x * k, y: -src[i].y * k };
        }
        this.drawPts = pts;

        // contentSize 按包围盒给（部分版本按 UITransform 尺寸做批处理裁剪，给 0 会不显示）
        const box = polyBounds(src);
        const boxW = (box.maxX - box.minX) * k;
        const boxH = (box.maxY - box.minY) * k;
        ui.setContentSize(boxW > 0 ? boxW : k, boxH > 0 ? boxH : k);

        const g = node.addComponent(Graphics);
        this.graphics = g;
        g.lineWidth = STROKE.object;
        g.strokeColor = hexColor(rt.shape.stroke);
        g.fillColor = hexColor(rt.shape.fill);
        this.redraw();
    }

    /**
     * 摆到某个姿态并重画（每帧调用）。
     * 只改 2 个属性 + 一次路径重建，不分配对象、不拼接字符串。
     */
    applyPose(pose: Pose): void {
        this.node.setPosition(toLocalX(pose.x), toLocalY(pose.y), 0);
        this.node.angle = -pose.rotDeg;
        this.redraw();
    }

    /** 按缓存顶点重建路径（clear → moveTo → lineTo… → fill + stroke） */
    private redraw(): void {
        const g = this.graphics;
        const pts = this.drawPts;
        g.clear();
        if (pts.length === 0) {
            return;
        }
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            g.lineTo(pts[i].x, pts[i].y);
        }
        g.close();
        g.fill();
        g.stroke();
    }

    /** 显示 / 隐藏（HOME 与结算时隐藏） */
    setVisible(visible: boolean): void {
        this.node.active = visible;
    }

    /** 换色（判灯 / 高亮用；改完颜色下一帧生效，不额外重建） */
    setTint(fill: string, stroke: string): void {
        this.graphics.fillColor = hexColor(fill || COLORS.textMain);
        this.graphics.strokeColor = hexColor(stroke || COLORS.textSub);
    }

    /** 销毁（换关时由 LevelRunner 调用） */
    destroy(): void {
        if (this.node.isValid) {
            this.node.destroy();
        }
    }
}
