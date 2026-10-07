const E=require('../src/engine.js');const S=Math.SQRT1_2;
let s=E.turnOver(E.newPaper()).facets;
const seq=[s=>E.foldOp(s,{p:[0,0],d:[S,-S]},1,'valley',0),s=>E.foldOp(s,{p:[0,0],d:[-S,-S]},1,'valley',0),s=>E.squashOp(s,{p:[0,0],d:[S,S]},1,2),s=>E.turnOver(s),s=>E.squashOp(s,{p:[0,0],d:[S,-S]},1,2),
 s=>E.rotate(s,-Math.PI/4), s=>E.recenter(s)];
for(const fn of seq){const r=fn(s);if(r.error){console.log('ERR',r.error);process.exit()}s=r.facets;}
const sig=s=>{const h=E.hull(s.flatMap(E.fold));return h.map(p=>p.map(v=>+v.toFixed(3)).join(',')).join(' ')+' L'+Math.max(...E.levels(s).lv)+' n'+s.length+' area'+s.reduce((a,f)=>a+Math.abs(E.area(E.fold(f))),0).toFixed(3)};
console.log('prelim',sig(s));
let r=E.petalOp(s,[0,-0.7]); if(r.error){console.log(r.error);process.exit()} s=r.facets; console.log('petal1',sig(s));
r=E.turnOver(s); s=r.facets;
r=E.petalOp(s,[0,-0.7]); if(r.error){console.log(r.error);process.exit()} s=r.facets; console.log('petal2',sig(s));

