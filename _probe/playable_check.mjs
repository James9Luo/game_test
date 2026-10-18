import { loadProto } from '../tools/proto_vm.mjs';
const H = loadProto({ search: '', storage: {} });
const P = H.P;
const lv = P.levels;
console.log('原型内联关数 =', lv.length);
for (const s of [1,2,3,4]) {
  const a = lv.filter(x => x.season === s);
  const m = {}; a.forEach(x => m[x.path] = (m[x.path]||0)+1);
  console.log('季'+s, JSON.stringify(m), '| 例: L'+a[a.length-1].id, 'path='+a[a.length-1].path, 'cycle='+a[a.length-1].cycleMs, 'sine='+a[a.length-1].sineAmp, 'inertia='+a[a.length-1].inertiaPx);
}
// 实测：跳到季 4 末关，构建并检查第一帧是否跑在 bounce/arc 上
const def = lv.find(x => x.id === 60);
const rt = P.CORE.buildLevel(def, P.shapes, 12345);
console.log('L60 path =', def.path, '| movers =', rt.movers.length, '| perfectMs =', rt.perfectMs.toFixed(1), '| cycle =', rt.movers[0].cycleMs);
const pose = P.CORE.poseAt(rt.movers[0], rt.perfectMs);
console.log('L60 完美时刻姿态: x=', pose.x.toFixed(1), 'y=', pose.y.toFixed(1), 'rot=', pose.rot.toFixed(1));
