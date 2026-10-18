import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: 'mode=challenge&screen=play', storage: {} });
const P = H.P;
const rt = P.app.rt;
const perfect = rt.perfectMs;
H.setNow(perfect);
P.press(perfect);
const fb = P.app.fb;
console.log('press: t0=' + fb.t0.toFixed(1) + ' pass(res)=' + fb.res.pass + ' pct=' + fb.res.pct.toFixed(1));
let t = perfect;
for (let i = 1; i <= 150; i++) {
  t += 20; H.setNow(t); 
  try { P.update(); } catch (e) { console.log('update threw at i=' + i + ': ' + e.message); break; }
  if (i % 25 === 0) {
    const f = P.app.fb;
    console.log('i=' + i + ' e=' + (f ? f.elapsed.toFixed(0) : '-') + ' settled=' + (f ? f.settled : '-') + ' pass=' + (f ? f.pass : '-') + ' lvl=' + P.app.lvl + ' scene=' + P.app.scene);
  }
  if (P.app.lvl !== 0) { console.log('进阶成功于 i=' + i + ' lvl=' + P.app.lvl + ' scene=' + P.app.scene); break; }
}
console.log('最终 lvl=' + P.app.lvl + ' scene=' + P.app.scene);
