import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
const P = H.P, a = P.app, T = P.CORE.moverTiming;
P.startRun('challenge', 49);
console.log('scene=', a.scene, 'lvl=', a.lvl, 'movers=', a.rt ? a.rt.movers.length : 'null', 'phase=', a.phase, 'limit=', a.timeLimitMs);
if (!a.rt) process.exit(0);
const pm = a.rt.movers.map(m => T(m).perfectMs);
console.log('perfectMs=', pm.map(x => x.toFixed(1)).join(', '), 'attemptStart=', a.attemptStart);
const t1 = a.attemptStart + pm[0];
P.freeze(t1); P.press(t1);
console.log('press#1 → phase=', a.phase, 'frozen=', JSON.stringify(a.frozen), 'pct=', a.fb && a.fb.res ? a.fb.res.pct.toFixed(1) : 'n/a');
P.freeze(t1 + 401); P.update(); P.update();
console.log('after freeze: phase=', a.phase, 'attemptStart=', a.attemptStart);
const t2 = a.attemptStart + pm[1];
P.freeze(t2); P.press(t2);
const r = a.fb && a.fb.res;
console.log('press#2 → phase=', a.phase, 'pass=', r ? r.pass : 'n/a', 'pct=', r ? r.pct.toFixed(1) : 'n/a', 'worst=', r ? (r.worstPct !== undefined ? r.worstPct.toFixed(1) : 'n/a') : 'n/a');

// 第二次定格后同样要等 400ms 才结算
P.freeze(t2 + 401); P.update(); P.update();
const r2 = a.fb && a.fb.res;
console.log('finalize → phase=', a.phase, 'pass=', r2 ? r2.pass : 'n/a', 'pct=', r2 ? r2.pct.toFixed(1) : 'n/a', 'frozen=', JSON.stringify(a.frozen));
