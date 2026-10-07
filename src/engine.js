// ===== Origami flat-fold engine =====
const Engine = (() => {
  const TOL = 1e-6;
  let nextId = 1;
  const ap = (T, p) => [T[0]*p[0] + T[1]*p[1] + T[4], T[2]*p[0] + T[3]*p[1] + T[5]];
  const comp = (A, B) => [
    A[0]*B[0] + A[1]*B[2], A[0]*B[1] + A[1]*B[3],
    A[2]*B[0] + A[3]*B[2], A[2]*B[1] + A[3]*B[3],
    A[0]*B[4] + A[1]*B[5] + A[4], A[2]*B[4] + A[3]*B[5] + A[5]];
  const refl = (L) => {
    const [dx, dy] = L.d, [px, py] = L.p;
    const a = 2*dx*dx - 1, b = 2*dx*dy, d = 2*dy*dy - 1;
    return [a, b, b, d, px - (a*px + b*py), py - (b*px + d*py)];
  };
  const side = (L, q) => L.d[0]*(q[1] - L.p[1]) - L.d[1]*(q[0] - L.p[0]);
  const reflPt = (L, q) => ap(refl(L), q);
  const fold = (f) => f.poly.map(v => ap(f.T, v));
  const centroid = (pts) => {
    let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; }
    return [x / pts.length, y / pts.length];
  };
  const area = (pts) => {
    let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i+1) % pts.length]; s += a[0]*b[1] - a[1]*b[0]; }
    return s / 2;
  };
  const dirOf = (ang) => [Math.cos(ang), Math.sin(ang)];
  const clone = (fs) => fs.map(f => ({ id: f.id, poly: f.poly.map(p => p.slice()), T: f.T.slice(), layer: f.layer }));

  function newPaper() {
    nextId = 1;
    return [{ id: nextId++, poly: [[-1,-1],[1,-1],[1,1],[-1,1]], T: [1,0,0,1,0,0], layer: 0 }];
  }

  // Split a facet by a line given in folded coordinates.
  function splitFacet(f, L) {
    const P = fold(f);
    const s = P.map(q => { const v = side(L, q); return Math.abs(v) < 1e-9 ? 0 : v; });
    if (s.every(v => v >= -TOL) || s.every(v => v <= TOL)) return [f];
    const A = [], B = [], n = f.poly.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, vi = f.poly[i], vj = f.poly[j];
      if (s[i] >= 0) A.push(vi); if (s[i] <= 0) B.push(vi);
      if ((s[i] > 0 && s[j] < 0) || (s[i] < 0 && s[j] > 0)) {
        const t = s[i] / (s[i] - s[j]);
        const m = [vi[0] + (vj[0] - vi[0])*t, vi[1] + (vj[1] - vi[1])*t];
        A.push(m); B.push(m);
      }
    }
    if (A.length < 3 || B.length < 3 || Math.abs(area(A)) < 1e-9 || Math.abs(area(B)) < 1e-9) return [f];
    return [
      { id: nextId++, poly: A, T: f.T.slice(), layer: f.layer, origin: f.origin ?? f.id, group: f.group },
      { id: nextId++, poly: B, T: f.T.slice(), layer: f.layer, origin: f.origin ?? f.id, group: f.group }];
  }
  const splitAll = (fs, L, pred) => fs.flatMap(f => (!pred || pred(f)) ? splitFacet(f, L) : [f]);

  // Shared boundary segment between two facets, in paper coordinates.
  function shared(f, g) {
    const a = f.poly, b = g.poly;
    for (let i = 0; i < a.length; i++) {
      const a1 = a[i], a2 = a[(i+1) % a.length];
      const ex = a2[0] - a1[0], ey = a2[1] - a1[1], len2 = ex*ex + ey*ey;
      if (len2 < 1e-14) continue;
      const len = Math.sqrt(len2);
      for (let j = 0; j < b.length; j++) {
        const b1 = b[j], b2 = b[(j+1) % b.length];
        const c1 = (ex*(b1[1] - a1[1]) - ey*(b1[0] - a1[0])) / len;
        const c2 = (ex*(b2[1] - a1[1]) - ey*(b2[0] - a1[0])) / len;
        if (Math.abs(c1) > 1e-7 || Math.abs(c2) > 1e-7) continue;
        const t1 = ((b1[0] - a1[0])*ex + (b1[1] - a1[1])*ey) / len2;
        const t2 = ((b2[0] - a1[0])*ex + (b2[1] - a1[1])*ey) / len2;
        const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(1, Math.max(t1, t2));
        if ((hi - lo)*len > 1e-6) return [[a1[0] + ex*lo, a1[1] + ey*lo], [a1[0] + ex*hi, a1[1] + ey*hi]];
      }
    }
    return null;
  }
  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return [x0, y0, x1, y1];
  }
  function neighbors(fs) {
    const bb = fs.map(f => bbox(f.poly));
    const nb = fs.map(() => []);
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const A = bb[i], B = bb[j];
      if (A[0] > B[2] + 1e-6 || B[0] > A[2] + 1e-6 || A[1] > B[3] + 1e-6 || B[1] > A[3] + 1e-6) continue;
      const s = shared(fs[i], fs[j]);
      if (s) { nb[i].push({ j, seg: s }); nb[j].push({ j: i, seg: s }); }
    }
    return nb;
  }
  const segOnLine = (f, seg, L) => seg.every(p => Math.abs(side(L, ap(f.T, p))) < 1e-6);

  // Convex polygon overlap (SAT) with a small tolerance so touching edges do not count.
  function overlap(P, Q) {
    for (const poly of [P, Q]) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i+1) % poly.length];
      const nx = a[1] - b[1], ny = b[0] - a[0], l = Math.hypot(nx, ny);
      if (l < 1e-12) continue;
      let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
      for (const v of P) { const d = (v[0]*nx + v[1]*ny) / l; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
      for (const v of Q) { const d = (v[0]*nx + v[1]*ny) / l; q0 = Math.min(q0, d); q1 = Math.max(q1, d); }
      if (Math.min(p1, q1) - Math.max(p0, q0) < 1e-5) return false;
    }
    return true;
  }
  // Physical stack level of each facet (0 = resting on the table) and depth from the top.
  function levels(fs) {
    const P = fs.map(fold), bb = P.map(bbox);
    const ord = fs.map((_, i) => i).sort((a, b) => fs[a].layer - fs[b].layer);
    const lv = new Array(fs.length).fill(0), top = new Array(fs.length).fill(0);
    const hit = (i, j) => !(bb[i][0] > bb[j][2] || bb[j][0] > bb[i][2] || bb[i][1] > bb[j][3] || bb[j][1] > bb[i][3]) && overlap(P[i], P[j]);
    for (let a = 0; a < ord.length; a++) {
      const i = ord[a]; let m = -1;
      for (let b = 0; b < a; b++) { const j = ord[b]; if (lv[j] > m && hit(i, j)) m = lv[j]; }
      lv[i] = m + 1;
    }
    for (let a = ord.length - 1; a >= 0; a--) {
      const i = ord[a]; let m = -1;
      for (let b = ord.length - 1; b > a; b--) { const j = ord[b]; if (top[j] > m && hit(i, j)) m = top[j]; }
      top[i] = m + 1;
    }
    return { lv, top };
  }
  function renorm(fs) {
    const ord = fs.slice().sort((a, b) => a.layer - b.layer);
    ord.forEach((f, i) => f.layer = i);
  }

  // Facets on `sgn` side of L that must move together, starting from the top `layerN` layers (0 = all).
  function movingSet(fs, L, sgn, layerN, seedPred) {
    const nb = neighbors(fs);
    const on = fs.map(f => side(L, centroid(fold(f))) * sgn > 0);
    const { top, lv } = levels(fs);
    const M = new Set(), q = [];
    if (seedPred && layerN !== 0) {
      // layers counted at the tapped spot: the top (or bottom) N facets under it
      const cand = fs.map((f, i) => i).filter(i => on[i] && seedPred(fs[i])).sort((a, b) => layerN > 0 ? fs[b].layer - fs[a].layer : fs[a].layer - fs[b].layer);
      for (const i of cand.slice(0, Math.abs(layerN))) { M.add(i); q.push(i); }
    } else fs.forEach((f, i) => { if (on[i] && (layerN === 0 || (layerN > 0 ? top[i] < layerN : lv[i] < -layerN)) && (!seedPred || seedPred(f))) { M.add(i); q.push(i); } });
    while (q.length) {
      const i = q.pop();
      for (const { j, seg } of nb[i]) if (on[j] && !M.has(j) && !segOnLine(fs[i], seg, L)) { M.add(j); q.push(j); }
    }
    return { M, nb };
  }

  // Prepare animation info: each facet gets T0 (pre-op transform) and steps of rigid rotations.
  function stamp(fs) { for (const f of fs) { f.origin = f.id; f.T0 = f.T.slice(); f.steps = []; } }
  function addStep(f, L, dir) {
    // centroid at this stage (after previous steps)
    let T = f.T0; for (const s of f.steps) T = comp(refl(s.line), T);
    const c = centroid(f.poly.map(v => ap(T, v)));
    const sg = Math.sign(side(L, c)) || 1;
    f.steps.push({ line: { p: L.p.slice(), d: L.d.slice() }, theta: Math.PI * dir * sg });
    f.T = comp(refl(L), f.T);
  }
  function finish(fs) {
    renorm(fs);
    return fs.map(f => ({ id: f.id, poly: f.poly, T: f.T, layer: f.layer,
      anim: { origin: f.origin, T0: f.T0 || f.T.slice(), steps: f.steps || [] } }));
  }

  // mode: valley | mountain | inside | outside | sink
  function foldOp(state, L, sgn, mode, layerN, seedPred) {
    let fs = clone(state); stamp(fs);
    fs = splitAll(fs, L).map(f => ({ ...f, T0: f.T.slice(), steps: [] }));
    if (mode === 'sink') layerN = 0;
    const { M } = movingSet(fs, L, sgn, layerN, seedPred);
    if (!M.size) return { error: 'Nothing to fold on that side. Draw the crease across the paper.' };
    if (M.size === fs.length) return { error: 'That crease misses the paper. Draw it across the part you want to fold.' };
    const mv = [...M].map(i => fs[i]);
    const keys = mv.map(f => f.layer);
    const mx = Math.max(...fs.map(f => f.layer)), mn = Math.min(...fs.map(f => f.layer));
    const kmax = Math.max(...keys), kmin = Math.min(...keys);
    if (mode === 'pull') {
      for (const f of mv) addStep(f, L, 1); // stays at its depth, sandwiched between the outer layers
    } else if (mode === 'valley' || mode === 'mountain') {
      for (const f of mv) {
        addStep(f, L, mode === 'valley' ? 1 : -1);
        f.layer = mode === 'valley' ? mx + 1 + (kmax - f.layer) : mn - 1 - (f.layer - kmin);
      }
    } else {
      // reverse folds / sinks: split the moving layers into an upper and lower half
      const lv = [...new Set(keys)].sort((a, b) => b - a);
      if (lv.length < 2) return { error: 'Reverse folds and sinks need a flap with at least two layers.' };
      const half = Math.ceil(lv.length / 2), topSet = new Set(lv.slice(0, half));
      const T = mv.filter(f => topSet.has(f.layer)), B = mv.filter(f => !topSet.has(f.layer));
      const minT = Math.min(...T.map(f => f.layer)), maxB = Math.max(...B.map(f => f.layer));
      const maxT = Math.max(...T.map(f => f.layer)), minB = Math.min(...B.map(f => f.layer));
      const inside = mode !== 'outside';
      const n = mv.length + 2, eps = 1 / (n * 4);
      const g = (minT + maxB) / 2;
      // inside: [T reversed][B reversed] placed in the gap between the halves (top→bottom)
      // outside: T reversed above the top half, B reversed below the bottom half
      const Tasc = T.slice().sort((a, b) => a.layer - b.layer); // bottom→top of T
      const Basc = B.slice().sort((a, b) => a.layer - b.layer);
      const newKey = new Map();
      if (inside) {
        const seq = [...Tasc, ...Basc]; // top→bottom order of reflected parts
        seq.forEach((f, i) => newKey.set(f, g + (seq.length / 2 - i) * eps));
      } else {
        Tasc.forEach((f, i) => newKey.set(f, maxT + (Tasc.length - i) * eps * 2));
        Basc.forEach((f, i) => newKey.set(f, minB - (Basc.length - i) * eps * 2));
      }
      for (const f of T) addStep(f, L, inside ? -1 : 1);
      for (const f of B) addStep(f, L, inside ? 1 : -1);
      for (const f of mv) f.layer = newKey.get(f);
    }
    return { facets: finish(fs) };
  }

  // Squash: H = hinge line of the flap, sgn = side the flap lies on, layerN = layers in the flap (default 2).
  function squashOp(state, H, sgn, layerN, seedPred) {
    let fs = clone(state); stamp(fs);
    fs = splitAll(fs, H).map(f => ({ ...f, T0: f.T.slice(), steps: [] }));
    const { M, nb } = movingSet(fs, H, sgn, layerN || 2, seedPred);
    if (!M.size) return { error: 'No flap found on that side of the hinge.' };
    const flap = [...M];
    const lv = [...new Set(flap.map(i => fs[i].layer))].sort((a, b) => b - a);
    if (lv.length < 2) return { error: 'A squash needs a flap with two or more layers joined at a folded edge.' };
    const topSet = new Set(lv.slice(0, Math.ceil(lv.length / 2)));
    const U = new Set(flap.filter(i => topSet.has(fs[i].layer)));
    const Lo = new Set(flap.filter(i => !topSet.has(fs[i].layer)));
    // spine: edges joining upper and lower halves of the flap, away from the hinge
    let spine = null, best = 0; const attach = [];
    for (const i of flap) for (const { j, seg } of nb[i]) {
      const a = ap(fs[i].T, seg[0]), b = ap(fs[i].T, seg[1]);
      if (!M.has(j) && segOnLine(fs[i], seg, H)) { attach.push(a, b); continue; }
      if (U.has(i) && Lo.has(j) && !segOnLine(fs[i], seg, H)) {
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > best) { best = l; spine = [a, b]; }
      }
    }
    if (!spine) return { error: 'Could not find the folded edge of that flap. Try the Layers setting, or pick the other side.' };
    if (!attach.length) return { error: 'That line is not the hinge of a flap. Draw it along the crease where the flap is attached.' };
    // P = intersection of hinge and spine lines
    const sd = [spine[1][0] - spine[0][0], spine[1][1] - spine[0][1]];
    const den = H.d[0]*sd[1] - H.d[1]*sd[0];
    if (Math.abs(den) < 1e-6) return { error: 'The flap\u2019s folded edge runs parallel to the hinge, so it cannot be squashed open here.' };
    const t = ((spine[0][0] - H.p[0])*sd[1] - (spine[0][1] - H.p[1])*sd[0]) / den;
    const P = [H.p[0] + H.d[0]*t, H.p[1] + H.d[1]*t];
    const far = Math.hypot(spine[0][0] - P[0], spine[0][1] - P[1]) > Math.hypot(spine[1][0] - P[0], spine[1][1] - P[1]) ? spine[0] : spine[1];
    const am = centroid(attach);
    const a = Math.atan2(am[1] - P[1], am[0] - P[0]);
    const e = Math.atan2(far[1] - P[1], far[0] - P[0]);
    const h = Math.atan2(H.d[1], H.d[0]);
    const cLo = (a + e) / 2, cUpost = cLo + h - e, cUcur = 2*h - cUpost;
    const LLo = { p: P, d: dirOf(cLo) }, LUcur = { p: P, d: dirOf(cUcur) }, LUpost = { p: P, d: dirOf(cUpost) };
    const HL = { p: P, d: H.d.slice() };
    fs.forEach((f, i) => f.group = U.has(i) ? 'U' : Lo.has(i) ? 'L' : null);
    fs = splitAll(fs, LLo, f => f.group === 'L');
    fs = splitAll(fs, LUcur, f => f.group === 'U').map(f => ({ ...f, T0: f.T0 || f.T.slice(), steps: f.steps || [] }));
    const sLo = Math.sign(side(LLo, far)), sU = Math.sign(side(LUcur, far));
    let mx = Math.max(...fs.map(f => f.layer));
    const nearU = [], farAll = [];
    for (const f of fs) {
      const c = centroid(fold(f));
      if (f.group === 'L' && side(LLo, c) * sLo > 0) { addStep(f, LLo, 1); farAll.push(f); }
      else if (f.group === 'U') {
        const isFar = side(LUcur, c) * sU > 0;
        addStep(f, HL, 1);
        if (isFar) { addStep(f, LUpost, 1); farAll.push(f); } else nearU.push(f);
      }
    }
    nearU.sort((x, y) => y.layer - x.layer).forEach((f, i) => f.layer = mx + 1 + i);
    mx += nearU.length + 1;
    farAll.sort((x, y) => x.layer - y.layer).forEach((f, i) => f.layer = mx + 1 + i);
    for (const f of fs) delete f.group;
    return { facets: finish(fs) };
  }



  // Pull out: swing a hidden inner flap out across L. Picks the layer under `tap`
  // whose flap can move without dragging the outermost layers along.
  function pullOp(state, L, sgn, tap) {
    let fs = clone(state);
    fs = splitAll(fs, L);
    const under = fs.map((f, i) => i).filter(i => side(L, centroid(fold(fs[i]))) * sgn > 0 && insideConvex(tap, fold(fs[i])))
      .sort((a, b) => fs[b].layer - fs[a].layer);
    if (under.length < 3) return { error: 'There\u2019s no hidden flap there. Pull out works on a layer tucked between other layers.' };
    const outer = new Set([under[0], under[under.length - 1]]);
    let best = null;
    for (let k = 1; k < under.length - 1; k++) {
      const id = fs[under[k]].id;
      const { M } = movingSet(fs, L, sgn, 0, f => f.id === id);
      if ([...outer].some(i => M.has(i))) continue;
      if (!best || M.size < best.size) best = { id, size: M.size, layer: fs[under[k]].layer };
    }
    if (!best) return { error: 'That flap is joined to the outer layers on this side, so it can\u2019t be pulled out along this line.' };
    return foldOp(state, L, sgn, 'pull', 0, f => f.layer === best.layer && insideConvex(tap, fold(f)));
  }
  function insideConvex(pt, P) {
    let s0 = 0;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i+1) % P.length]; const c = (b[0]-a[0])*(pt[1]-a[1]) - (b[1]-a[1])*(pt[0]-a[0]); if (Math.abs(c) < 1e-9) continue; if (!s0) s0 = Math.sign(c); else if (Math.sign(c) !== s0) return false; }
    return true;
  }

  // ---- hull helper ----
  function hull(pts) {
    const p = pts.map(q => [Math.round(q[0]*1e6)/1e6, Math.round(q[1]*1e6)/1e6]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cr(lo[lo.length-2], lo[lo.length-1], q) <= 1e-9) lo.pop(); lo.push(q); }
    for (const q of p.slice().reverse()) { while (up.length > 1 && cr(up[up.length-2], up[up.length-1], q) <= 1e-9) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const nrm = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0]/l, v[1]/l]; };
  function segX(p, u, a, b) { // ray p+t u with segment a-b
    const e = [b[0]-a[0], b[1]-a[1]], den = u[0]*e[1] - u[1]*e[0];
    if (Math.abs(den) < 1e-12) return null;
    const w = [a[0]-p[0], a[1]-p[1]];
    const t = (w[0]*e[1] - w[1]*e[0]) / den, s = (w[0]*u[1] - w[1]*u[0]) / den;
    if (t <= 1e-9 || s < -1e-6 || s > 1 + 1e-6) return null;
    return [p[0] + u[0]*t, p[1] + u[1]*t];
  }
  // chain several ops into one animation
  function chain(state, fns) {
    let cur = state, byId = null, stage = 0;
    for (const fn of fns) {
      const r = fn(cur);
      if (r.error) return r;
      if (byId) for (const f of r.facets) {
        const prev = byId.get(f.anim.origin);
        f.anim = { origin: prev.anim.origin, T0: prev.anim.T0,
          steps: prev.anim.steps.concat(f.anim.steps.map(s => ({ ...s, stage }))) };
      } else for (const f of r.facets) f.anim.steps = f.anim.steps.map(s => ({ ...s, stage }));
      byId = new Map(r.facets.map(f => [f.id, f]));
      cur = r.facets; stage++;
    }
    for (const f of cur) f.anim.stages = stage;
    return { facets: cur };
  }

  // Petal fold: tap the open corner of the top flap. Kite creases bisect the corner,
  // both side edges collapse inward (inside reverse folds), and the corner swings up.
  function petalOp(state, tap) {
    const { top } = levels(state);
    const topF = state.filter((f, i) => top[i] === 0);
    const h = hull(topF.flatMap(fold));
    if (h.length < 4) return { error: 'A petal fold needs a diamond-shaped flap on top, like a preliminary base.' };
    let ci = 0, bd = Infinity;
    h.forEach((q, i) => { const d = Math.hypot(q[0]-tap[0], q[1]-tap[1]); if (d < bd) { bd = d; ci = i; } });
    const C = h[ci], B = h[(ci + h.length - 1) % h.length], D = h[(ci + 1) % h.length];
    let A = null, far = -1;
    for (const q of h) { const d = Math.hypot(q[0]-C[0], q[1]-C[1]); if (d > far) { far = d; A = q; } }
    if (A === B || A === D) return { error: 'Tap the corner you want to lift. It works on a diamond flap with a corner pointing away from the closed point.' };
    const ua = nrm([A[0]-C[0], A[1]-C[1]]);
    const kB = segX(C, nrm([nrm([B[0]-C[0], B[1]-C[1]])[0] + ua[0], nrm([B[0]-C[0], B[1]-C[1]])[1] + ua[1]]), A, B);
    const kD = segX(C, nrm([nrm([D[0]-C[0], D[1]-C[1]])[0] + ua[0], nrm([D[0]-C[0], D[1]-C[1]])[1] + ua[1]]), A, D);
    if (!kB || !kD) return { error: 'This flap isn\u2019t shaped for a petal fold. Try it on a preliminary base.' };
    const L1 = { p: C, d: nrm([kB[0]-C[0], kB[1]-C[1]]) }, L2 = { p: C, d: nrm([kD[0]-C[0], kD[1]-C[1]]) };
    const H = { p: kB, d: nrm([kD[0]-kB[0], kD[1]-kB[1]]) };
    const Bp = ap(refl(L1), B), Dp = ap(refl(L2), D);
    if (Math.abs(side(H, Bp)) > 2e-3 || Math.abs(side(H, Dp)) > 2e-3)
      return { error: 'The two sides of this flap aren\u2019t even, so it can\u2019t petal fold cleanly. Try it on a preliminary base.' };
    return chain(state, [
      s => foldOp(s, L1, Math.sign(side(L1, B)), 'inside', 2),
      s => foldOp(s, L2, Math.sign(side(L2, D)), 'inside', 2),
      s => foldOp(s, H, Math.sign(side(H, C)), 'valley', 1, f => {
        const c = centroid(fold(f)), s1 = side(L1, c) * side(L1, kD), s2 = side(L2, c) * side(L2, kB);
        return s1 > 0 && s2 > 0;
      }),
    ]);
  }

  // Bend: split along a line and report which facets move (no flat change).
  function bendSplit(state, L, sgn, layerN, seedPred) {
    let fs = clone(state);
    fs = splitAll(fs, L);
    const { M } = movingSet(fs, L, sgn, layerN, seedPred);
    if (!M.size) return { error: 'Nothing to bend on that side. Draw the line across the paper.' };
    if (M.size === fs.length) return { error: 'That line misses the paper. Draw it across the part you want to bend.' };
    return { facets: fs.map(f => ({ id: f.id, poly: f.poly, T: f.T, layer: f.layer, origin: f.origin })), set: [...M].map(i => fs[i].id) };
  }

  function transformAll(state, M, flipLayers, theta) {
    const fs = clone(state).map(f => {
      const g = { ...f, origin: f.id, T0: f.T.slice(), steps: [] };
      if (theta) g.steps.push({ line: { p: [0, 0], d: [0, 1] }, theta });
      g.T = comp(M, f.T);
      if (flipLayers) g.layer = -f.layer;
      return g;
    });
    return { facets: finish(fs) };
  }
  const turnOver = (state) => transformAll(state, [-1, 0, 0, 1, 0, 0], true, Math.PI);
  function rotate(state, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return transformAll(state, [c, -s, s, c, 0, 0], false, 0);
  }
  function recenter(state) {
    const b = bbox(state.flatMap(fold));
    return transformAll(state, [1, 0, 0, 1, -(b[0] + b[2]) / 2, -(b[1] + b[3]) / 2], false, 0);
  }

  // Edges worth drawing: raw paper edges and real creases (neighbor folded differently).
  function drawnEdges(fs) {
    const nb = neighbors(fs);
    return fs.map((f, i) => {
      const segs = [];
      const n = f.poly.length;
      for (let k = 0; k < n; k++) {
        const a = f.poly[k], b = f.poly[(k+1) % n];
        const ex = b[0] - a[0], ey = b[1] - a[1], len2 = ex*ex + ey*ey;
        // collect covered intervals by flat (same-T) neighbors
        const cov = [];
        for (const { j, seg } of nb[i]) {
          const g = fs[j];
          const same = g.T.every((v, m) => Math.abs(v - f.T[m]) < 1e-6);
          if (!same) continue;
          const on = seg.every(p => Math.abs(ex*(p[1] - a[1]) - ey*(p[0] - a[0])) < 1e-7);
          if (!on) continue;
          const t = seg.map(p => ((p[0] - a[0])*ex + (p[1] - a[1])*ey) / len2).sort((x, y) => x - y);
          cov.push(t);
        }
        cov.sort((x, y) => x[0] - y[0]);
        let cur = 0;
        for (const [t0, t1] of cov) {
          if (t0 > cur + 1e-6) segs.push([[a[0] + ex*cur, a[1] + ey*cur], [a[0] + ex*t0, a[1] + ey*t0]]);
          cur = Math.max(cur, t1);
        }
        if (cur < 1 - 1e-6) segs.push([[a[0] + ex*cur, a[1] + ey*cur], b]);
      }
      return segs;
    });
  }

  return { newPaper, foldOp, squashOp, petalOp, pullOp, bendSplit, hull, turnOver, rotate, recenter, levels, drawnEdges, fold, ap, comp, refl, side, centroid, bbox, area };
})();
if (typeof module !== 'undefined') module.exports = Engine;
