/**
 * tools/_ts_boot.mjs —— 给 node 装一条「无后缀相对 import → 补 .ts」的解析钩子
 *
 * 为什么需要：核心层源码（assets/scripts/core/*.ts）必须用**无后缀** import，
 * 因为工程 tsconfig 是 `moduleResolution: "node"` 且没有 `allowImportingTsExtensions`，
 * 写 './Geometry.ts' 会被 tsc 判 TS5097，Cocos 编辑器直接用不了。
 * 但 node 的 ESM 解析要求显式扩展名，所以工具侧用这个钩子补齐 —— 核心层代码保持 tsc/Cocos 干净。
 *
 * 行为约束（故意做窄）：只处理 './' 与 '../' 开头、且没有扩展名的说明符；
 * 先按原样解析，失败才补 '.ts'。不会影响 node: 内置模块与 npm 包。
 *
 * 依赖：node ≥ 22.15（module.registerHooks，同步线程内钩子）。本工程用 node 24。
 */

import { registerHooks } from 'node:module';

export const TS_HOOK = { installed: false, error: '' };

try {
    if (typeof registerHooks !== 'function') {
        throw new Error(`module.registerHooks 不可用（当前 node ${process.version}，需要 ≥ 22.15）`);
    }
    registerHooks({
        resolve(specifier, context, nextResolve) {
            if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
                try {
                    return nextResolve(specifier, context);
                } catch {
                    return nextResolve(`${specifier}.ts`, context);
                }
            }
            return nextResolve(specifier, context);
        },
    });
    TS_HOOK.installed = true;
} catch (e) {
    TS_HOOK.installed = false;
    TS_HOOK.error = e && e.message ? e.message : String(e);
    console.error(`\n[tools/_ts_boot] 装不上 .ts 解析钩子：${TS_HOOK.error}`);
    console.error('  影响：工具无法 import 核心层的无后缀相对 import。');
    console.error('  处置：升级 node（≥22.15，本工程用 24）或告诉我，我改回带 .ts 后缀（但那样 Cocos 会挂）。\n');
}
