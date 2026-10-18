import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: 'mode=challenge&screen=play', storage: {} });
const P = H.P;
console.log('初始: lvl=' + P.app.lvl + ' scene=' + P.app.scene + ' mode=' + P.app.mode);
const rt = P.app.rt;
const perfect = rt.perfectMs;
console.log('perfectMs=' + perfect.toFixed(1) + ' cycleMs=' + rt.movers[0].cycleMs);
// 在完美时机按下
H.setNow(perfect);
P.press(perfect);
console.log('按下后: fb=' + (P.app.fb ? 'yes' : 'no') + ' pct=' + (P.app.fb ? P.app.fb.res.pct.toFixed(1) : '-') + ' pass=' + (P.app.fb ? P.app.fb.res.pass : '-'));
// 推进 2 秒，触发自动进关
let t = perfect;
for (let i = 0; i < 120; i++) { t += 20; H.setNow(t); P.update(); }
console.log('推进 2.4s 后: lvl=' + P.app.lvl + ' scene=' + P.app.scene + ' fb=' + (P.app.fb ? 'yes' : 'no'));
// 再推进 5 秒
for (let i = 0; i < 250; i++) { t += 20; H.setNow(t); P.update(); }
console.log('再推进 5s 后: lvl=' + P.app.lvl + ' scene=' + P.app.scene);
