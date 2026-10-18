import { loadProto } from '../tools/proto_vm.mjs';

function run(mode) {
  const H = loadProto({ search: '', storage: {} });
  const P = H.P;
  H.setNow(500);
  /* 点首页按钮 */
  const r = mode === 'challenge' ? { x: 180, y: 876, w: 360, h: 84 } : { x: 180, y: 764, w: 360, h: 96 };
  P.homePress(r.x + r.w / 2, r.y + r.h / 2);
  H.setNow(520);
  P.update();
  console.log('[' + mode + '] 进游戏: scene=' + P.app.scene + ' mode=' + P.app.mode + ' lvl=' + P.app.lvl);
  if (P.app.scene !== 'play') return;
  const rt = P.app.rt, perfect = rt.perfectMs, cyc = rt.movers[0].cycleMs;
  /* 等到完美时机 */
  const base = P.app.attemptStart;
  const tPress = base + perfect;
  H.setNow(tPress - 20); P.update();
  H.setNow(tPress);
  P.press(tPress);
  console.log('  按下: pct=' + P.app.fb.res.pct.toFixed(1) + ' pass=' + P.app.fb.res.pass + ' scene=' + P.app.scene);
  let t = tPress;
  for (let i = 0; i < 200; i++) {
    t += 20; H.setNow(t); P.update();
    if (P.app.lvl !== 0 || P.app.scene !== 'feedback') break;
  }
  console.log('  推进 ' + ((t - tPress) / 1000).toFixed(1) + 's 后: lvl=' + P.app.lvl + ' scene=' + P.app.scene + ' attempts=' + P.app.attempts);
}
run('challenge');
run('relax');
