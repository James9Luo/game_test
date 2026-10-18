/**
 * UiKit.ts —— 纯代码建 UI 的小工具（不依赖任何美术资源）
 *
 * 谁负责：客户端程序（Cocos 生产层）
 * 改这里之前先打招呼：Boot / Hud / ResultPanel / Heatmap / Mover 都靠这四个工厂函数建节点，
 * 改签名等于全 UI 层返工。
 *
 * 只做三件事：建节点（带 UITransform）、建 Label（系统字体 + SHRINK 防溢出）、建 Graphics。
 */

import { Color, Graphics, Label, Layers, Node, UIOpacity, UITransform } from 'cc';
import { DESIGN_H, DESIGN_W } from '../../core/Layout';
import { SYSTEM_FONT, lineHeightOf, opacityOf } from './Theme';

/** 建一个 UI 节点：统一设 layer=UI_2D（漏了就没有相机渲染）、加 UITransform、给尺寸 */
export function makeNode(name: string, parent: Node, x: number, y: number, w: number, h: number): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    const ui = node.addComponent(UITransform);
    ui.setContentSize(w, h);
    parent.addChild(node);
    node.setPosition(x, y, 0);
    return node;
}

/** 建一个全屏根层（尺寸 = 设计分辨率），Boot 的节点树都挂在它下面 */
export function makeRootLayer(name: string, parent: Node): Node {
    return makeNode(name, parent, 0, 0, DESIGN_W, DESIGN_H);
}

/**
 * 建 Label：系统字体、居中、Overflow.SHRINK（内容超框自动缩字号，防小屏溢出）。
 * 注意：Label 必须有非零 UITransform，否则 SHRINK 没有参照框，文字不显示。
 */
export function makeLabel(
    name: string,
    parent: Node,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fontSize: number,
    color: Color,
): Label {
    const node = makeNode(name, parent, x, y, w, h);
    const label = node.addComponent(Label);
    label.useSystemFont = true;
    label.fontFamily = SYSTEM_FONT;
    label.fontSize = fontSize;
    label.lineHeight = lineHeightOf(fontSize);
    label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = true;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.color = color;
    label.string = text;
    return label;
}

/** 建 Graphics：空盒子，画什么由调用方决定（背景、绿框、物体、热力图、按钮） */
export function makeGraphics(name: string, parent: Node, x: number, y: number, w: number, h: number): Graphics {
    const node = makeNode(name, parent, x, y, w, h);
    return node.addComponent(Graphics);
}

/**
 * 给节点挂/取 UIOpacity（0..255）。用于热力图淡入、闪白衰减、面板压暗。
 * 重复调用安全：已有组件就复用，不会叠两个。
 */
export function opacityNode(node: Node, alpha: number): UIOpacity {
    let op = node.getComponent(UIOpacity);
    if (!op) {
        op = node.addComponent(UIOpacity);
    }
    op.opacity = opacityOf(alpha);
    return op;
}

/** 取节点的 UIOpacity，没有就建一个（不立刻改值） */
export function ensureOpacity(node: Node): UIOpacity {
    let op = node.getComponent(UIOpacity);
    if (!op) {
        op = node.addComponent(UIOpacity);
    }
    return op;
}
