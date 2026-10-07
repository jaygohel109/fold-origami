const E=require('../src/engine.js');
const S=Math.SQRT1_2;
function show(fs,label){
  const pts=fs.flatMap(E.fold);const b=E.bbox(pts);
  const area=fs.reduce((s,f)=>s+Math.abs(E.area(E.fold(f))),0);
  const {lv}=E.levels(fs);
  console.log(label,'facets',fs.length,'bbox',b.map(v=>+v.toFixed(3)),'sumArea',area.toFixed(3),'maxLevel',Math.max(...lv));
}
function run(steps){
  let s=E.newPaper();
  for(const [name,fn] of steps){const r=fn(s); if(r.error){console.log(name,'ERR',r.error);return s;} s=r.facets; show(s,name);}
  return s;
}
console.log('--- waterbomb');
run([
 ['half',s=>E.foldOp(s,{p:[0,0],d:[1,0]},1,'valley',0)],
 ['half2',s=>E.foldOp(s,{p:[0,0],d:[0,1]},1,'valley',0)],
 ['squash',s=>E.squashOp(s,{p:[0,0],d:[0,1]},-1,2)],
 ['turn',s=>E.turnOver(s)],
 ['squash2',s=>E.squashOp(s,{p:[0,0],d:[0,1]},1,2)],
]);
console.log('--- prelim');
const pre=run([
 ['diag',s=>E.foldOp(s,{p:[0,0],d:[S,-S]},1,'valley',0)],
 ['diag2',s=>E.foldOp(s,{p:[0,0],d:[S,S]},-1,'valley',0)],
 ['squash',s=>E.squashOp(s,{p:[0,0],d:[S,S]},1,2)],
 ['turn',s=>E.turnOver(s)],
 ['squash2',s=>E.squashOp(s,{p:[0,0],d:[S,-S]},-1,2)],
]);
console.log('--- reverse');
run([
 ['diag',s=>E.foldOp(s,{p:[0,0],d:[S,-S]},1,'valley',0)],
 ['inside',s=>E.foldOp(s,{p:[0,0.2],d:[1,0]},1,'inside',0)],
]);
run([
 ['diag',s=>E.foldOp(s,{p:[0,0],d:[S,-S]},1,'valley',0)],
 ['outside',s=>E.foldOp(s,{p:[0,0.2],d:[1,0]},1,'outside',0)],
]);
