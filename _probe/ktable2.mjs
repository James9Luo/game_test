import fs from 'node:fs';
import '../tools/_ts_boot.mjs';
const { loadShapes } = await import('../assets/scripts/core/Shapes.ts');
const { buildLevel } = await import('../assets/scripts/core/LevelStore.ts');
const { hitWindow } = await import('../assets/scripts/core/Judge.ts');
const shapes = loadShapes(JSON.parse(fs.readFileSync('assets/config/shapes.json','utf8')));
function def(id, turns) {
  return { id:1,name:'t',shapeId:id,outlineId:id,variant:'single',motion:'旋转',path:'h_line',
    cycleMs:2600,turns,jitter:0,toleranceDeg:10,passRate:0.6,star3Rate:0.94,estSec:4,weight:1,
    attempts:3,note:'',speedStage:1,linSpeed:[0,0],angSpeed:[0,0] };
}
const rows=[];
for (const id of Object.keys(shapes)) {
  const k=[1,2,3].map(t=>{ const rt=buildLevel(def(id,t),shapes,0); const hw=hitWindow(rt,0.5,20);
    return Math.min(Math.abs(hw.earlyMs),Math.abs(hw.lateMs))/2600; });
  rows.push({id,k});
}
console.log('shape'.padEnd(14)+' k(1圈)  k(2圈)  k(3圈)  判定(0.020–0.047)');
for(const r of rows){
  const ok = r.k[1]>=0.020 && r.k[1]<=0.047;
  console.log(r.id.padEnd(14)+r.k.map(x=>x.toFixed(4).padStart(7)).join(' ')+'   '+(ok?'OK':'越界'));
}
