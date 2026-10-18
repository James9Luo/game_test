import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const P = await import('../assets/scripts/core/Paths.ts');
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json', 'utf8')));
const J = JSON.parse(fs.readFileSync('assets/resources/config/levels.json', 'utf8'));
const d = (J.levels || J).find(x => x.id === 50);
const rt = buildLevel(d, shapes, 0);
console.log('movers =', rt.movers.length, '| inertiaPx =', d.inertiaPx, '| hz =', d.inertiaHz, '| phase =', d.inertiaPhase);
for (let m = 0; m < rt.movers.length; m++) {
  const mv = rt.movers[m];
  const tm = P.moverTiming(mv);
  const pm = tm.perfectMs;
  const lt = P.localT ? P.localT(mv, pm) : null;
  const off = P.inertiaOffsetOf ? P.inertiaOffsetOf(mv, pm) : null;
  const pose = P.poseAt(mv, pm);
  console.log('mover' + m + ': offsetMs=' + tm.offsetMs + ' perfectMs=' + pm.toFixed(1) +
    ' localT(pm)=' + (lt === null ? 'n/a' : lt.toFixed(1)) +
    ' inertiaOff(pm)=' + (off ? '{' + off.x.toFixed(3) + ',' + off.y.toFixed(3) + '}' : 'n/a') +
    ' pose=(' + pose.x.toFixed(2) + ',' + pose.y.toFixed(2) + ')');
}
