/**
 * tools/proto_vm.mjs —— 在 node 里把「构建产物」跑起来的最小宿主
 *
 * 目的：不开浏览器就能断言**产物里的**逻辑（audio_check 的 A5–A10 用）。
 * 做法：从 原型/dista_prototype.html 抠出内联 bundle，用假 canvas / 假 DOM 在 node:vm 里跑，
 *       然后通过 window.__PROTO__ 驱动。
 *
 * 不验视觉（构图/颜色），视觉靠 Edge 截图 + 人眼。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HTML_PATH = path.join(ROOT, '原型', 'dista_prototype.html');

function makeCtx() {
    const noop = () => {};
    const grad = { addColorStop: noop };
    return {
        save: noop, restore: noop, setTransform: noop, translate: noop, rotate: noop, scale: noop,
        clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
        moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, fill: noop, stroke: noop, clip: noop,
        createLinearGradient: () => grad, createRadialGradient: () => grad,
        measureText: (t) => ({ width: String(t == null ? '' : t).length * 12 }),
        fillText: noop, drawImage: noop, setLineDash: noop,
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
        font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
        shadowColor: 'transparent', shadowBlur: 0, filter: 'none'
    };
}

/**
 * @param {object} opts
 *   opts.search   URL query（不含 '?'），默认 ''
 *   opts.audio    true → 注入一个极简 AudioContext 桩（验证接线）；默认 false（走 A8 无音频路径）
 *   opts.storage  预置 localStorage（对象）
 */
export function loadProto(opts = {}) {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    if (blocks.length < 2) throw new Error('HTML 里没找到内联 bundle（script 块数 = ' + blocks.length + '）');
    const bundle = blocks[blocks.length - 1];

    const listeners = { win: {}, cv: {} };
    const canvas = {
        width: 720, height: 1280, style: {},
        getContext: () => makeCtx(),
        addEventListener: (k, fn) => { listeners.cv[k] = fn; }
    };
    const body = { attrs: {}, setAttribute: (k, v) => { body.attrs[k] = v; }, getAttribute: (k) => body.attrs[k] };
    const htmlEl = { attrs: {}, setAttribute: (k, v) => { htmlEl.attrs[k] = v; } };
    const storage = new Map(Object.entries(opts.storage || {}));
    const documentStub = {
        readyState: 'complete',
        title: '定格瞬间 · 原型',
        documentElement: htmlEl,
        body,
        getElementById: (id) => (id === 'cv' ? canvas : id === 'errbar' ? { style: {}, textContent: '' } : null),
        addEventListener: () => {}
    };

    let now = 0;
    const sandbox = {
        console,
        document: documentStub,
        performance: { now: () => now },
        requestAnimationFrame: () => 0,
        cancelAnimationFrame: () => {},
        setTimeout: () => 0,
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        localStorage: {
            getItem: (k) => (storage.has(k) ? storage.get(k) : null),
            setItem: (k, v) => storage.set(k, String(v)),
            removeItem: (k) => storage.delete(k)
        },
        location: { search: opts.search ? '?' + opts.search : '' }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.devicePixelRatio = 1;
    sandbox.innerWidth = 720;
    sandbox.innerHeight = 1280;
    sandbox.addEventListener = (k, fn) => { listeners.win[k] = fn; };
    sandbox.localStorage = sandbox.localStorage;
    sandbox.PointerEvent = function PointerEvent() {};

    if (opts.audio) sandbox.AudioContext = makeAudioContextStub();

    vm.createContext(sandbox);
    vm.runInContext(bundle, sandbox, { filename: 'dista_prototype.bundle.js' });

    return {
        P: sandbox.window.__PROTO__,
        sandbox,
        listeners,
        storage,
        title: () => documentStub.title,
        htmlError: () => htmlEl.attrs['data-js-error'],
        setNow: (v) => { now = v; }
    };
}

/** 极简 WebAudio 桩：只保证 audio.js 的接线不抛异常（不验声音） */
function makeAudioContextStub() {
    function param() {
        return {
            value: 1,
            setValueAtTime() { return this; },
            linearRampToValueAtTime() { return this; },
            exponentialRampToValueAtTime() { return this; },
            cancelScheduledValues() { return this; }
        };
    }
    function node(extra) {
        return Object.assign({
            connect() { return this; },
            disconnect() {},
            gain: param(),
            frequency: param(),
            detune: param(),
            delayTime: param(),
            Q: param(),
            type: 'sine',
            start() {},
            stop() {}
        }, extra || {});
    }
    function AudioContextStub() {
        this.currentTime = 0;
        this.sampleRate = 44100;
        this.state = 'running';
        this.destination = node();
    }
    AudioContextStub.prototype.createGain = () => node();
    AudioContextStub.prototype.createOscillator = () => node();
    AudioContextStub.prototype.createBiquadFilter = () => node();
    AudioContextStub.prototype.createDelay = () => node();
    AudioContextStub.prototype.createBufferSource = () => node();
    AudioContextStub.prototype.createBuffer = (ch, len) => ({ duration: len / 44100, getChannelData: () => new Float32Array(len) });
    AudioContextStub.prototype.resume = function () { this.state = 'running'; };
    AudioContextStub.prototype.suspend = function () { this.state = 'suspended'; };
    return AudioContextStub;
}
