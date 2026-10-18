import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: 'mode=challenge&screen=play', storage: {} });
const P = H.P;
const perfect = P.app.rt.perfectMs;
H.setNow(perfect);
P.press(perfect);
for (const dt of [20, 200, 500, 1500]) {
  H.setNow(perfect + dt);
  console.log('setNow=+' + dt + '  P.now()=' + P.now().toFixed(1) + '  fb.t0=' + P.app.fb.t0.toFixed(1) + '  fb.elapsed(before update)=' + P.app.fb.elapsed);
  P.update();
  console.log('   after update: elapsed=' + P.app.fb.elapsed.toFixed(1) + ' lvl=' + P.app.lvl + ' scene=' + P.app.scene);
}
