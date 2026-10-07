(() => {
const E = Engine;
const $ = (s) => document.querySelector(s);
const stage = $('#stage');

// ---------- three.js setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
const HOME = new THREE.Vector3(0, -0.0001, 6.2);
let resizedOnce = false;
camera.position.copy(HOME);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.enableRotate = false; controls.enablePan = false;
controls.minDistance = 1.2; controls.maxDistance = 14;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa8a0, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(2, 3, 6); scene.add(sun);
const under = new THREE.DirectionalLight(0xffffff, 0.35); under.position.set(-2, -2, -5); scene.add(under);

// cutting mat
let matMesh;
(function mat() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#23473e'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i <= 64; i++) {
    const x = i * 16;
    g.strokeStyle = i % 8 === 0 ? 'rgba(220,240,230,.28)' : 'rgba(220,240,230,.10)';
    g.lineWidth = i % 8 === 0 ? 2 : 1;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, x); g.lineTo(1024, x); g.stroke();
  }
  g.strokeStyle = 'rgba(220,240,230,.22)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(1024, 1024); g.moveTo(1024, 0); g.lineTo(0, 1024); g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  m.position.z = -0.004; scene.add(m); matMesh = m;
})();

const matFront = new THREE.MeshStandardMaterial({ color: 0xc9483b, roughness: 0.85, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const matBack = new THREE.MeshStandardMaterial({ color: 0xfbfaf5, roughness: 0.9, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const matEdge = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 });
const paperGroup = new THREE.Group(); scene.add(paperGroup);
const overlay = new THREE.Group(); scene.add(overlay);

// ---------- state ----------
let facets = E.newPaper();
let history = [], future = [];
let bends = [], bendSeq = 1;
let tool = 'valley', method = 'line', phase = 'idle', viewMode = false, busy = false;
let start = null, end = null, crease = null, pA = null;
let thickness = 0.0009 * 7;
let meshes = [], levelsNow = [], snapPts = [], extraSnaps = [];

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = 32;
  camera.updateProjectionMatrix();
  const fit = 3.3, dist = (fit / 2) / Math.tan(16 * Math.PI / 180) / Math.min(1, camera.aspect) + 0.3;
  const fresh = camera.position.distanceTo(HOME) < 1e-6;
  HOME.z = dist;
  if (fresh || !resizedOnce) camera.position.copy(HOME);
  resizedOnce = true;
}
window.addEventListener('resize', resize); resize();

// ---------- geometry → meshes ----------
function rotAbout(v, L, th, zA) {
  const dx = L.d[0], dy = L.d[1];
  const wx = v[0] - L.p[0], wy = v[1] - L.p[1], wz = v[2] - zA;
  const c = Math.cos(th), s = Math.sin(th), dot = dx*wx + dy*wy;
  return [L.p[0] + wx*c + (dy*wz)*s + dx*dot*(1 - c),
          L.p[1] + wy*c + (-dx*wz)*s + dy*dot*(1 - c),
          zA + wz*c + (dx*wy - dy*wx)*s];
}
const ease = (u) => u < 0.5 ? 4*u*u*u : 1 - Math.pow(-2*u + 2, 3) / 2;

let spacing = thickness;
function zOf(level) { return 0.0015 + level * spacing; }
function updateSpacing() { const m = Math.max(1, ...levelsNow); spacing = Math.min(thickness, 0.045 / m); }

function buildMeshes() {
  for (const m of meshes) { paperGroup.remove(m.front, m.back, m.edges); m.geo.dispose(); m.egeo.dispose(); }
  meshes = [];
  const edges = E.drawnEdges(facets);
  levelsNow = E.levels(facets).lv;
  updateSpacing();
  facets.forEach((f, i) => {
    const n = f.poly.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const idx = []; for (let k = 1; k < n - 1; k++) idx.push(0, k, k + 1);
    geo.setIndex(idx);
    const segs = edges[i];
    const egeo = new THREE.BufferGeometry();
    egeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, segs.length) * 6), 3));
    const front = new THREE.Mesh(geo, matFront), back = new THREE.Mesh(geo, matBack);
    const el = new THREE.LineSegments(egeo, matEdge);
    paperGroup.add(front, back, el);
    meshes.push({ f, geo, egeo, front, back, edges: el, segs });
  });
  poseAll(null, 1);
  snapPts = [];
  for (const f of facets) for (const p of E.fold(f)) snapPts.push(p);
  edges.forEach((segs, i) => { for (const s of segs) { const a = E.ap(facets[i].T, s[0]), b = E.ap(facets[i].T, s[1]); snapPts.push([(a[0]+b[0])/2, (a[1]+b[1])/2]); } });
  snapPts.push([0, 0]);
}

// bends that move this facet, innermost first
function bendsFor(f) {
  const out = [];
  for (const b of bends) if (b.set.includes(f.id)) {
    const c = E.centroid(E.fold(f));
    const sg = Math.sign(E.side(b.line, c)) || 1;
    out.push({ line: b.line, th: b.dir * sg * b.angle * Math.PI / 180, n: b.set.length, zA: b.zA });
  }
  return out.sort((x, y) => x.n - y.n);
}
// every layer of a bent flap turns around the same hinge, so the stack stays together
function bendHinges() {
  const zById = new Map(facets.map((f, i) => [f.id, zOf(levelsNow[i])]));
  for (const b of bends) {
    const zs = b.set.map(id => zById.get(id)).filter(z => z != null);
    b.zA = zs.length ? (b.dir > 0 ? Math.max(...zs) : Math.min(...zs)) : 0;
  }
}
// anim: { oldLevels: Map(origin→level), u }
function poseAll(anim, u) {
  if (!anim && bends.length) bendHinges();
  meshes.forEach((m, i) => {
    const f = m.f;
    let map;
    if (anim) {
      const a = f.anim, z0 = zOf(anim.old.get(a.origin) ?? levelsNow[i]), z1 = zOf(levelsNow[i]);
      const e = ease(u), k = a.steps.length;
      map = (p) => {
        const q = E.ap(a.T0, p); let v = [q[0], q[1], z0];
        const K = a.stages || k;
        a.steps.forEach((s, j) => { const pr = Math.min(1, Math.max(0, e*K - (s.stage ?? j))); if (pr > 0) v = rotAbout(v, s.line, s.theta * pr, z0); });
        v[2] += (z1 - z0) * e; return v;
      };
    } else {
      const z = zOf(levelsNow[i]);
      const mine = bendsFor(f);
      map = (p) => {
        const q = E.ap(f.T, p); let v = [q[0], q[1], z];
        for (const b of mine) v = rotAbout(v, b.line, b.th, b.zA ?? z);
        return v;
      };
    }
    const pos = m.geo.attributes.position.array;
    f.poly.forEach((p, k) => { const v = map(p); pos[k*3] = v[0]; pos[k*3+1] = v[1]; pos[k*3+2] = v[2]; });
    m.geo.attributes.position.needsUpdate = true; m.geo.computeVertexNormals(); m.geo.computeBoundingSphere();
    const ep = m.egeo.attributes.position.array;
    m.segs.forEach((s, k) => { const a = map(s[0]), b = map(s[1]); ep.set(a, k*6); ep.set(b, k*6 + 3); });
    m.egeo.setDrawRange(0, m.segs.length * 2);
    m.egeo.attributes.position.needsUpdate = true; m.egeo.computeBoundingSphere();
  });
}

function applyResult(next, animate, dur, nb) {
  if (standing) { standing = false; matMesh.rotation.x = 0; matMesh.position.set(0, 0, -0.004); standLabel(false); }
  if (next && next.f) { nb = next.b; next = next.f; }
  bends = nb ? cloneBends(nb) : [];
  const prevLv = E.levels(facets).lv, old = new Map();
  facets.forEach((f, i) => old.set(f.id, prevLv[i]));
  facets = next.map(f => ({ id: f.id, poly: f.poly, T: f.T, layer: f.layer, anim: f.anim }));
  buildMeshes();
  updateButtons(); renderBends();
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { poseAll(null, 1); return Promise.resolve(); }
  busy = true;
  return new Promise(res => {
    const t0 = performance.now();
    const tick = (t) => {
      const u = Math.min(1, (t - t0) / dur);
      poseAll({ old }, u);
      if (u < 1) requestAnimationFrame(tick); else { poseAll(null, 1); busy = false; res(); }
    };
    requestAnimationFrame(tick);
  });
}
const plain = (fs) => fs.map(f => ({ id: f.id, poly: f.poly, T: f.T, layer: f.layer }));
const cloneBends = (bs) => bs.map(b => ({ ...b, line: { p: b.line.p.slice(), d: b.line.d.slice() }, set: b.set.slice() }));
const snapshot = () => ({ f: plain(facets), b: cloneBends(bends) });
let notify = () => {};
function commit(result, dur = 750, evt = 'fold') {
  if (result.error) { toast(result.error); return Promise.resolve(false); }
  if (bends.length) toast('The bends were flattened so the paper could fold. Undo brings them back.', true);
  history.push(snapshot()); future = [];
  return applyResult(result.facets, true, dur).then(() => { notify(evt); return true; });
}

// ---------- overlay ----------
const ovMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, side: THREE.DoubleSide });
const snapDot = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.034, 28), ovMat(0xffffff, 0.95)); snapDot.renderOrder = 10; overlay.add(snapDot);
const markA = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), ovMat(0xffd447, 1)); markA.renderOrder = 10; overlay.add(markA);
const sideMesh = new THREE.Mesh(new THREE.BufferGeometry(), ovMat(0xffd447, 0.22)); sideMesh.renderOrder = 9; overlay.add(sideMesh);
const creaseLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd447, dashSize: 0.06, gapSize: 0.04, depthTest: false }));
creaseLine.renderOrder = 11; overlay.add(creaseLine);
const segLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: .7 }));
segLine.renderOrder = 11; overlay.add(segLine);
function topZ() { return zOf(Math.max(0, ...levelsNow)) + 0.01; }
function modelBox() { const b = E.bbox(facets.flatMap(E.fold)); return [b[0] - 0.25, b[1] - 0.25, b[2] + 0.25, b[3] + 0.25]; }
function clipBox(L, sgn) {
  const b = modelBox();
  let poly = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i+1) % poly.length], sa = E.side(L, a) * sgn, sc = E.side(L, c) * sgn;
    if (sa >= 0) out.push(a);
    if (sa * sc < 0) { const t = sa / (sa - sc); out.push([a[0] + (c[0]-a[0])*t, a[1] + (c[1]-a[1])*t]); }
  }
  return out;
}
function lineAcross(L) {
  const b = modelBox(), r = Math.hypot(b[2]-b[0], b[3]-b[1]);
  const c = [(b[0]+b[2])/2, (b[1]+b[3])/2];
  const t = (c[0]-L.p[0])*L.d[0] + (c[1]-L.p[1])*L.d[1];
  const m = [L.p[0] + L.d[0]*t, L.p[1] + L.d[1]*t];
  return [[m[0] - L.d[0]*r, m[1] - L.d[1]*r], [m[0] + L.d[0]*r, m[1] + L.d[1]*r]];
}
function setLine(obj, pts) {
  const z = topZ();
  obj.geometry.dispose();
  obj.geometry = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], z)));
  if (obj.computeLineDistances) obj.computeLineDistances();
  obj.visible = true;
}
function setSide(L, sgn) {
  const pts = clipBox(L, sgn), z = topZ();
  if (pts.length < 3) { sideMesh.visible = false; return; }
  const g = new THREE.BufferGeometry();
  const arr = []; for (let k = 1; k < pts.length - 1; k++) for (const p of [pts[0], pts[k], pts[k+1]]) arr.push(p[0], p[1], z);
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  sideMesh.geometry.dispose(); sideMesh.geometry = g; sideMesh.visible = true;
}
function clearOverlay() { creaseLine.visible = segLine.visible = sideMesh.visible = markA.visible = false; }
clearOverlay(); snapDot.visible = false;
function creaseColor() { creaseLine.material.color.set(tool === 'mountain' || tool === 'outside' ? 0x8fd3ff : 0xffd447); creaseLine.material.dashSize = tool === 'mountain' ? 0.09 : 0.06; }

// ---------- input ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function worldAt(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -topZ() + 0.01);
  const hit = new THREE.Vector3();
  return ray.ray.intersectPlane(plane, hit) ? [hit.x, hit.y] : null;
}
function snap(p, ev) {
  const dist = camera.position.distanceTo(controls.target);
  const perPx = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / stage.clientHeight;
  const tol = perPx * (ev && ev.pointerType === 'touch' ? 26 : 14);
  let best = null, bd = tol;
  for (const q of snapPts.concat(extraSnaps)) { const d = Math.hypot(q[0]-p[0], q[1]-p[1]); if (d < bd) { bd = d; best = q; } }
  return best ? { p: best.slice(), snapped: true } : { p, snapped: false };
}
function showSnap(s) {
  if (s && s.snapped) { snapDot.position.set(s.p[0], s.p[1], topZ()); snapDot.visible = true; } else snapDot.visible = false;
}
const norm = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0]/l, v[1]/l]; };

const el = renderer.domElement;
let downInfo = null;
el.addEventListener('pointerdown', (ev) => {
  if (viewMode || busy || ev.button !== 0) return;
  const w = worldAt(ev); if (!w) return;
  const s = snap(w, ev);
  if (phase === 'pickSide') { downInfo = { side: Math.sign(E.side(crease, w)) || 1, tap: w }; return; }
  if (tool === 'petal') { runPetal(s.p); return; }
  if (method === 'p2p' && tool !== 'squash' && tool !== 'bend' && tool !== 'pull') {
    if (phase === 'idle') { pA = s.p; phase = 'p2pA'; markA.position.set(pA[0], pA[1], topZ()); markA.visible = true; hint(); return; }
    if (phase === 'p2pA') {
      const B = s.p; if (Math.hypot(B[0]-pA[0], B[1]-pA[1]) < 0.01) return;
      const L = { p: [(pA[0]+B[0])/2, (pA[1]+B[1])/2], d: norm([-(B[1]-pA[1]), B[0]-pA[0]]) };
      const sg = Math.sign(E.side(L, pA)) || 1;
      phase = 'idle'; clearOverlay(); hint();
      run(L, sg, pA); return;
    }
  }
  if (phase === 'idle') {
    start = s.p; end = s.p; phase = 'drawing';
    el.setPointerCapture(ev.pointerId);
    hint();
  }
});
el.addEventListener('pointermove', (ev) => {
  if (viewMode || busy) { snapDot.visible = false; return; }
  const w = worldAt(ev); if (!w) return;
  const s = snap(w, ev);
  if (phase === 'drawing') {
    end = s.p; showSnap(s);
    if (Math.hypot(end[0]-start[0], end[1]-start[1]) > 0.02) {
      const L = { p: start, d: norm([end[0]-start[0], end[1]-start[1]]) };
      creaseColor(); setLine(creaseLine, lineAcross(L)); setLine(segLine, [start, end]);
    }
  } else if (phase === 'pickSide') {
    snapDot.visible = false;
    setSide(crease, Math.sign(E.side(crease, w)) || 1);
  } else if (phase === 'p2pA') {
    showSnap(s);
    if (Math.hypot(s.p[0]-pA[0], s.p[1]-pA[1]) > 0.02) {
      const L = { p: [(pA[0]+s.p[0])/2, (pA[1]+s.p[1])/2], d: norm([-(s.p[1]-pA[1]), s.p[0]-pA[0]]) };
      creaseColor(); setLine(creaseLine, lineAcross(L)); setLine(segLine, [pA, s.p]);
      setSide(L, Math.sign(E.side(L, pA)) || 1);
    }
  } else showSnap(s);
});
el.addEventListener('pointerup', (ev) => {
  if (viewMode || busy) return;
  if (phase === 'drawing') {
    if (end && Math.hypot(end[0]-start[0], end[1]-start[1]) > 0.03) {
      crease = { p: start.slice(), d: norm([end[0]-start[0], end[1]-start[1]]) };
      phase = 'pickSide'; segLine.visible = false;
      const w = worldAt(ev); if (w) setSide(crease, Math.sign(E.side(crease, w)) || 1);
    } else { phase = 'idle'; clearOverlay(); }
    hint(); return;
  }
  if (phase === 'pickSide' && downInfo) {
    const sg = downInfo.side, tap = downInfo.tap; downInfo = null;
    const L = crease; phase = 'idle'; clearOverlay(); hint();
    run(L, sg, tap);
  }
});
el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); cancel(); });
function cancel() { phase = 'idle'; downInfo = null; clearOverlay(); hint(); }

function layerN() { return +$('#layers').value; }
function inPoly(pt, P) {
  let s0 = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i+1) % P.length]; const c = (b[0]-a[0])*(pt[1]-a[1]) - (b[1]-a[1])*(pt[0]-a[0]); if (Math.abs(c) < 1e-9) continue; if (!s0) s0 = Math.sign(c); else if (Math.sign(c) !== s0) return false; }
  return true;
}
function seedAt(tap) { return tap ? (f) => inPoly(tap, E.fold(f)) : undefined; }
function run(L, sg, tap) {
  const st = tut && tut.def.steps[tut.i];
  if (st && st.exact && tap) {
    const X = st.exact, cross = Math.abs(L.d[0]*X.d[1] - L.d[1]*X.d[0]);
    if (cross < Math.sin(8 * Math.PI / 180) && Math.abs(E.side(L, X.p)) < 0.1) { L = X; sg = Math.sign(E.side(X, tap)) || sg; }
  }
  const n = layerN();
  const flapTool = tool !== 'valley' && tool !== 'mountain';
  const seed = (n !== 0 || flapTool) && tap && E.side(L, tap) * sg > 0 ? seedAt(tap) : undefined;
  if (tool === 'bend') return addBend(L, sg, seed, (st && st.bendAngle) || 90, (st && st.bendDir) || 1, true, st && st.wing && L === st.exact ? wingSet(facets, L, st.wing) : undefined);
  if (tool === 'pull') return commit(tap ? E.pullOp(facets, L, sg, tap) : { error: 'Tap the part of the hidden flap you want to pull out.' }, 1000);
  const r = tool === 'squash' ? E.squashOp(facets, L, sg, n || 2, seed) : E.foldOp(facets, L, sg, tool, n, seed);
  if (r.error && seed && /Nothing/.test(r.error)) r.error = 'Tap right on the part of the paper you want to fold.';
  return commit(r, tool === 'squash' ? 1300 : tool === 'sink' || tool === 'inside' || tool === 'outside' ? 1000 : 750);
}
function runPetal(tap) { return commit(E.petalOp(facets, tap), 2100); }

// ---------- bends (partial folds) ----------
function addBend(L, sg, seed, angle = 90, dir = 1, animate = true, preset) {
  const r = preset ? { facets: facets.map(f => ({ ...f, origin: undefined })), set: preset } : E.bendSplit(facets, L, sg, layerN(), seed);
  if (r.error) { toast(r.error); return Promise.resolve(false); }
  // carry existing bends over to split facets
  const mapSet = (set) => r.facets.filter(f => set.includes(f.id) || (f.origin != null && f.origin !== f.id && set.includes(f.origin))).map(f => f.id);
  const nb = cloneBends(bends).map(b => ({ ...b, set: mapSet(b.set) }));
  const S = new Set(r.set);
  for (const b of nb) {
    const inter = b.set.filter(id => S.has(id)).length;
    if (inter && inter !== b.set.length && inter !== S.size) { toast('That bend would cross another bend in a way paper can’t move. Remove the other bend first.'); return Promise.resolve(false); }
  }
  const bend = { id: bendSeq++, line: { p: L.p.slice(), d: L.d.slice() }, set: r.set, angle: animate ? 0 : angle, dir };
  history.push(snapshot()); future = [];
  applyResult(r.facets.map(f => ({ id: f.id, poly: f.poly, T: f.T, layer: f.layer })), false, 0, nb.concat([bend]));
  const live = bends[bends.length - 1];
  if ($('#tools')) $('#tools').classList.add('showsettings');
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { live.angle = angle; poseAll(null, 1); renderBends(); notify('bend'); return Promise.resolve(true); }
  busy = true;
  return new Promise(res => {
    const t0 = performance.now();
    const tick = (t) => {
      const u = Math.min(1, (t - t0) / 700); live.angle = angle * ease(u); poseAll(null, 1);
      if (u < 1) requestAnimationFrame(tick); else { busy = false; renderBends(); notify('bend'); res(true); }
    };
    requestAnimationFrame(tick);
  });
}
function renderBends() {
  const box = $('#bends'); if (!box) return;
  if (!bends.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="sep"></div><div class="bends-head"><span>Bends</span><button type="button" data-b="flat">Flatten all</button></div>' +
    bends.map((b, i) => `<div class="bend" data-id="${b.id}">
      <label for="bend-${b.id}">Bend ${i + 1}</label>
      <input type="range" id="bend-${b.id}" min="0" max="180" value="${Math.round(b.angle)}" aria-label="Bend ${i + 1} angle">
      <output>${Math.round(b.angle)}°</output>
      <button type="button" data-b="flip" title="Bend the other way" aria-label="Bend the other way"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg></button>
      <button type="button" data-b="del" title="Remove this bend" aria-label="Remove this bend"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>`).join('');
}
document.addEventListener('input', (e) => {
  const row = e.target.closest && e.target.closest('.bend'); if (!row || e.target.type !== 'range') return;
  const b = bends.find(x => x.id === +row.dataset.id); if (!b) return;
  b.angle = +e.target.value; row.querySelector('output').textContent = b.angle + '°'; poseAll(null, 1);
});
document.addEventListener('change', (e) => { const row = e.target.closest && e.target.closest('.bend'); if (row && e.target.type === 'range') notify('bend-angle'); });
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-b]'); if (!btn || busy) return;
  const act = btn.dataset.b;
  if (act === 'flat') { history.push(snapshot()); future = []; bends = []; poseAll(null, 1); renderBends(); updateButtons(); return; }
  const row = btn.closest('.bend'); const b = bends.find(x => x.id === +row.dataset.id); if (!b) return;
  if (act === 'flip') { b.dir *= -1; poseAll(null, 1); }
  if (act === 'del') { history.push(snapshot()); future = []; bends = bends.filter(x => x !== b); poseAll(null, 1); renderBends(); updateButtons(); }
});

// ---------- UI ----------
const HINTS = {
  line: 'Drag across the paper to draw a crease.',
  p2p: 'Tap the point you want to move.',
  squash: 'Drag along the hinge of the flap you want to squash.',
};
function hint() {
  let t;
  if (viewMode) t = 'Drag to turn the model, scroll or pinch to zoom. Press Look around again to fold.';
  else if (phase === 'drawing') t = tool === 'squash' ? 'Let go when the line sits on the flap\u2019s hinge.' : 'Let go to place the crease. Points snap to corners and edges.';
  else if (phase === 'pickSide') t = tool === 'squash' ? 'Tap the flap to squash it open.' : tool === 'mountain' ? 'Tap the side that should fold behind.' : tool === 'bend' ? 'Tap the part that should lift up.' : tool === 'pull' ? 'Tap the hidden flap you want to pull out.' : tool === 'valley' ? 'Tap the side that should fold over.' : 'Tap the tip that should reverse.';
  else if (phase === 'p2pA') t = 'Tap where that point should land.';
  else t = tool === 'squash' ? HINTS.squash : tool === 'petal' ? 'Tap the open corner of the top flap. It lifts while both sides fold in.' : tool === 'bend' ? 'Drag a line where the paper should bend, then tap the part that lifts.' : tool === 'pull' ? 'Drag along the hinge of a hidden flap, then tap the flap to pull it out.' : HINTS[method];
  $('#hint').innerHTML = `<span>${t}</span>` + (phase !== 'idle' ? '<button class="cancel" type="button">Cancel</button>' : '');
  const c = $('#hint .cancel'); if (c) c.addEventListener('click', cancel);
}
let toastTimer;
function toast(msg, info) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('info', !!info); t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200); }

const DEFAULT_LAYERS = { valley: '0', mountain: '0', inside: '0', outside: '0', sink: '0', squash: '2', petal: '0', bend: '1', pull: '0' };
function setTool(t) {
  tool = t; cancel();
  document.querySelectorAll('.tool[data-tool]').forEach(b => { b.setAttribute('aria-checked', b.dataset.tool === t); if (b.dataset.tool === t) $('#tooldesc').textContent = b.querySelector('small').textContent + '.'; });
  $('#layers').value = DEFAULT_LAYERS[t];
  $('#layers').disabled = t === 'sink' || t === 'petal' || t === 'pull';
  hint();
}
document.querySelectorAll('.tool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setMethod(m) {
  method = m; cancel();
  document.querySelectorAll('[data-method]').forEach(x => x.setAttribute('aria-pressed', x.dataset.method === m));
  hint();
}
document.querySelectorAll('[data-method]').forEach(b => b.addEventListener('click', () => setMethod(b.dataset.method)));
$('#moreset').addEventListener('click', () => { const tl = $('#tools'); tl.classList.toggle('showsettings'); $('#moreset').setAttribute('aria-expanded', tl.classList.contains('showsettings')); });
$('#thick').addEventListener('input', (e) => { thickness = 0.0009 * +e.target.value; updateSpacing(); poseAll(null, 1); });
$('#cf').addEventListener('input', (e) => matFront.color.set(e.target.value));
$('#cb').addEventListener('input', (e) => matBack.color.set(e.target.value));

function updateButtons() { $('#undo').disabled = !history.length; $('#redo').disabled = !future.length; }
function undo() { if (busy || !history.length) return; cancel(); future.push(snapshot()); applyResult(history.pop(), false); notify('undo'); }
function redo() { if (busy || !future.length) return; cancel(); history.push(snapshot()); applyResult(future.pop(), false); }
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#turn').addEventListener('click', () => { if (!busy) { cancel(); commit(E.turnOver(facets), 900, 'turn'); } });
$('#rot').addEventListener('click', () => { if (!busy) { cancel(); commit(E.rotate(facets, Math.PI / 4), 0); } });
function setView(on) {
  if (!on && standing) { standing = false; standLabel(false); animateTo(false, HOME.clone(), new THREE.Vector3(0, 0, 0), 900); }
  viewMode = on; cancel(); controls.enableRotate = on; controls.enablePan = on;
  $('#view').setAttribute('aria-pressed', on); snapDot.visible = false;
  el.style.cursor = on ? 'grab' : 'crosshair'; hint();
  notify(on ? 'view-on' : 'view-off');
}
$('#view').addEventListener('click', () => setView(!viewMode));
el.style.cursor = 'crosshair';

const menu = $('#menu');
$('#more').addEventListener('click', (e) => { e.stopPropagation(); const o = menu.classList.toggle('open'); $('#more').setAttribute('aria-expanded', o); });
document.addEventListener('click', () => { menu.classList.remove('open'); $('#more').setAttribute('aria-expanded', false); });
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || busy) return;
  const a = b.dataset.act; cancel();
  if (a === 'new') { history.push(snapshot()); future = []; applyResult(E.newPaper(), false); }
  if (a === 'center') commit(E.recenter(facets), 0);
  if (a === 'resetview') resetView();
  if (a === 'stand') setStanding(!standing);
  if (a && a.startsWith('demo-')) { endTutorial(); demo(a.slice(5)); }
});
function resetView() { camera.position.copy(HOME); controls.target.set(0, 0, 0); controls.update(); }

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input,select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Escape') cancel();
  if (e.key === ' ' && !e.target.matches('button')) { e.preventDefault(); setView(!viewMode); }
  const map = { v: 'valley', m: 'mountain', i: 'inside', o: 'outside', s: 'sink', q: 'squash', p: 'petal', b: 'bend', u: 'pull' };
  if (!e.ctrlKey && !e.metaKey && map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  if (e.key.toLowerCase() === 't' && !busy) commit(E.turnOver(facets), 900, 'turn');
  if (e.key.toLowerCase() === 'r' && !busy) commit(E.rotate(facets, Math.PI / 4), 0);
});

// ---------- demos ----------
const S = Math.SQRT1_2;
function prelimBase() {
  let s = E.turnOver(E.newPaper()).facets;
  for (const fn of [s => E.foldOp(s, { p: [0,0], d: [S,-S] }, 1, 'valley', 0), s => E.foldOp(s, { p: [0,0], d: [-S,-S] }, 1, 'valley', 0),
    s => E.squashOp(s, { p: [0,0], d: [S,S] }, 1, 2), s => E.turnOver(s), s => E.squashOp(s, { p: [0,0], d: [S,-S] }, 1, 2),
    s => E.rotate(s, -Math.PI / 4), s => E.recenter(s)]) s = fn(s).facets;
  return { facets: s.map(f => ({ ...f, anim: undefined })) };
}
const dirA = (deg) => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];
// One fold of the elephant: line through p at angle deg, folding the part around tap.
function eFold(mode, p, deg, tap, all) {
  const L = { p, d: dirA(deg) };
  return s => E.foldOp(s, L, Math.sign(E.side(L, tap)), mode, 0, all ? undefined : (f => inPoly(tap, E.fold(f))));
}
const ELEPHANT = [
  { text: 'Valley fold the bottom edge onto the diagonal.', tool: 'valley', p: [-1, -1], deg: 22.5, tap: [0.8, -0.8], all: true },
  { text: 'Valley fold the left edge onto the diagonal. That\u2019s a kite.', tool: 'valley', p: [-1, -1], deg: 67.5, tap: [-0.8, 0.8], all: true },
  { text: 'Fold the narrow point over to the opposite corner.', tool: 'valley', p: [0, 0], deg: -45, tap: [-0.9, -0.9], all: true },
  { text: 'Valley fold in half along the diagonal, so the point ends up inside.', tool: 'valley', p: [0, 0], deg: 45, tap: [-0.2, 0.6], all: true },
  { text: 'Turning it so the folded edge is on top.', rotate: -45 },
  { text: 'Pull out the point hidden inside. It becomes the trunk.', tool: 'pull', p: [0, 0], deg: 90, tap: [0.5, -0.1] },
  { text: 'Shift the trunk inward, part 1: inside reverse fold it down at the head.', tool: 'inside', p: [-0.1, 0], deg: 200, tap: [-1.3, -0.02] },
  { text: 'Shift the trunk inward, part 2: outside reverse fold it so it hangs down. That shapes the forehead.', tool: 'outside', p: [-0.3298, -0.1928], deg: 240, tap: [-0.72, -0.42] },
  { text: 'Inside reverse fold the tip of the trunk so it curls out.', tool: 'inside', p: [-0.4618, -0.9413], deg: 215, tap: [-0.45, -1.05] },
  { text: 'Inside reverse fold the back corner down for the hind legs.', tool: 'inside', p: [0.45, 0], deg: 330, tap: [1.35, -0.02] },
  { text: 'Bend the trunk toward you to give it a 3D curl.', bend: true, p: [-0.3, -0.62], deg: 0, tap: [-0.4, -0.85], angle: 40 },
];
const ELE_COLORS = ['#8d9196', '#9da1a6'];
function eLine(st) { return { p: st.p, d: dirA(st.deg) }; }
function eSeed(st) { return st.all ? undefined : (f => inPoly(st.tap, E.fold(f))); }
function wingSet(fs, L, which) {
  // the two paper corners that end up lowest are the neck and tail tips; pieces nearest those
  // corners belong to the neck and tail. Everything else above the hinge is wing, split by layer.
  const up = E.side(L, [0, 5]);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(c => {
    const f = fs.find(g => g.poly.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-6));
    return { c, y: E.ap(f.T, c)[1] };
  }).sort((x, y) => x.y - y.y);
  const legs = corners.slice(0, 2).map(o => o.c), all = corners.map(o => o.c);
  const near = (pc) => all.reduce((b, c) => Math.hypot(pc[0] - c[0], pc[1] - c[1]) < Math.hypot(pc[0] - b[0], pc[1] - b[1]) ? c : b);
  const wing = fs.filter(f => {
    const c = E.centroid(E.fold(f)); if (E.side(L, c) * up <= 0) return false;
    return !legs.includes(near(E.centroid(f.poly)));
  });
  // split into connected pieces of paper (not counting joins along the hinge)
  const adj = wing.map(() => []);
  for (let i = 0; i < wing.length; i++) for (let j = i + 1; j < wing.length; j++) {
    const s = sharedEdge(wing[i], wing[j]);
    if (s && !s.every(p => Math.abs(E.side(L, E.ap(wing[i].T, p))) < 1e-6)) { adj[i].push(j); adj[j].push(i); }
  }
  const comp = new Array(wing.length).fill(-1), groups = [];
  for (let i = 0; i < wing.length; i++) if (comp[i] < 0) {
    const g = [i]; comp[i] = groups.length;
    for (let k = 0; k < g.length; k++) for (const j of adj[g[k]]) if (comp[j] < 0) { comp[j] = groups.length; g.push(j); }
    groups.push(g);
  }
  const area = (g) => g.reduce((s, i) => s + Math.abs(E.area(E.fold(wing[i]))), 0);
  const big = groups.sort((x, y) => area(y) - area(x)).slice(0, 2);
  if (big.length < 2) return [];
  const top = (g) => Math.max(...g.map(i => wing[i].layer));
  big.sort((x, y) => top(y) - top(x));
  const ids = big[which === 'front' ? 0 : 1].map(i => wing[i].id);
  // the back of the bird between the wings: split it by layer and send each half with its wing
  const taken = new Set(big.flat().map(i => wing[i].id));
  const back = fs.filter(f => { const c = E.centroid(E.fold(f)); return E.side(L, c) * up > 0 && Math.abs(c[0]) < 0.25 && !taken.has(f.id); });
  const bl = back.map(f => f.layer).sort((x, y) => x - y), bm = bl.length ? (bl[Math.floor((bl.length - 1) / 2)] + bl[Math.ceil((bl.length - 1) / 2)]) / 2 : 0;
  return ids.concat(back.filter(f => which === 'front' ? f.layer > bm : f.layer < bm).map(f => f.id));
}
function sharedEdge(f, g) {
  for (let i = 0; i < f.poly.length; i++) {
    const a1 = f.poly[i], a2 = f.poly[(i + 1) % f.poly.length];
    for (let j = 0; j < g.poly.length; j++) {
      const b1 = g.poly[j], b2 = g.poly[(j + 1) % g.poly.length];
      const m = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
      const ex = a2[0] - a1[0], ey = a2[1] - a1[1], l = Math.hypot(ex, ey); if (l < 1e-9) continue;
      const col = (q) => Math.abs(ex * (q[1] - a1[1]) - ey * (q[0] - a1[0])) / l < 1e-7;
      if (col(b1) && col(b2)) {
        const t = (q) => ((q[0] - a1[0]) * ex + (q[1] - a1[1]) * ey) / (l * l);
        const lo = Math.max(0, Math.min(t(b1), t(b2))), hi = Math.min(1, Math.max(t(b1), t(b2)));
        if ((hi - lo) * l > 1e-6) return [[a1[0] + ex * lo, a1[1] + ey * lo], [a1[0] + ex * hi, a1[1] + ey * hi]];
      }
    }
  }
  return null;
}
function eApply(st, s) {
  if (st.wing) return { facets: s, set: wingSet(s, eLine(st), st.wing) };
  if (st.rotate != null) { const r = E.rotate(s, st.rotate * Math.PI / 180); return st.center ? E.recenter(r.facets) : r; }
  if (st.turn) return E.turnOver(s);
  if (st.tool === 'petal') return E.petalOp(s, st.tap);
  const L = eLine(st), sg = Math.sign(E.side(L, st.tap));
  if (st.bend) return E.bendSplit(s, L, sg, st.n || 0, eSeed(st));
  if (st.tool === 'pull') return E.pullOp(s, L, sg, st.tap);
  if (st.tool === 'squash') return E.squashOp(s, L, sg, st.n || 2, eSeed(st));
  return E.foldOp(s, L, sg, st.tool, st.n || 0, eSeed(st));
}
function setColors(c) { if (!c) return; $('#cf').value = c[0]; $('#cb').value = c[1]; matFront.color.set(c[0]); matBack.color.set(c[1]); }
function modelSteps(list) {
  return list.map(st => st.bend
    ? [st.text, { bends: [[eLine(st), st.tap, st.wing]], angle: st.angle, dir: st.dir || 1, layers: String(st.n || 0) }]
    : [st.text, s => eApply(st, s), st.rotate != null ? 700 : st.turn ? 900 : st.tool === 'petal' ? 2200 : st.tool === 'squash' ? 1400 : 1100]);
}
function elephantSteps() { return modelSteps(ELEPHANT); }
const S_ = Math.SQRT1_2;
const CRANE = [
  { text: 'Valley fold corner to corner.', tool: 'valley', p: [0, 0], deg: -45, tap: [0.8, 0.8], all: true },
  { text: 'Fold the triangle in half.', tool: 'valley', p: [0, 0], deg: -135, tap: [0.5, -0.7], all: true },
  { text: 'Squash the top flap into a square.', tool: 'squash', p: [0, 0], deg: 45, tap: [-0.62, 0.22], n: 2 },
  { text: 'Turn the model over.', turn: true },
  { text: 'Squash this flap too. That\u2019s a preliminary base.', tool: 'squash', p: [0, 0], deg: -45, tap: [0.62, 0.22], n: 2 },
  { text: 'Turning it so the open end points down.', rotate: -45, center: true },
  { text: 'Petal fold: tap the bottom corner to lift it.', tool: 'petal', tap: [0, -0.7071] },
  { text: 'Turn the model over.', turn: true },
  { text: 'Petal fold this side too. That\u2019s a bird base.', tool: 'petal', tap: [0, -0.7071] },
  { text: 'Narrow the lower left edge: fold it to the center line.', tool: 'valley', p: [0, -0.7071], deg: 101.25, tap: [-0.15, -0.3], n: 1 },
  { text: 'Narrow the lower right edge the same way.', tool: 'valley', p: [0, -0.7071], deg: 78.75, tap: [0.15, -0.3], n: 1 },
  { text: 'Inside reverse fold the left point up. That\u2019s the neck.', tool: 'inside', p: [0, 0.05], deg: 197.5, tap: [-0.02, -0.5] },
  { text: 'Inside reverse fold the right point up. That\u2019s the tail.', tool: 'inside', p: [0, 0.05], deg: -17.5, tap: [0.02, -0.5] },
  { text: 'Inside reverse fold the tip of the neck to make the head.', tool: 'inside', p: [-0.2983, 0.4760], deg: 162.5, tap: [-0.3523, 0.5358] },
  { text: 'Bend the front wing out toward you.', bend: true, p: [-0.4, 0.2929], deg: 0, tap: [0, 0.9], n: 1, angle: 88, dir: 1, wing: 'front' },
  { text: 'Bend the back wing out the other way. I set Layers to Bottom 1 so the back wing moves.', bend: true, p: [-0.4, 0.2929], deg: 0, tap: [0, 0.9], n: -1, angle: 88, dir: -1, wing: 'back' },
];
const CRANE_COLORS = ['#c9483b', '#f3efe6'];
// segment of line L that crosses the model (for tutorial guides)
function crossing(fs, L) {
  const h = E.hull(fs.flatMap(E.fold)), pts = [];
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i+1) % h.length], sa = E.side(L, a), sb = E.side(L, b);
    if (Math.abs(sa) < 1e-9) pts.push(a);
    else if (sa * sb < 0) { const t = sa / (sa - sb); pts.push([a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]); }
  }
  if (pts.length < 2) return null;
  let best = [pts[0], pts[1]], bd = 0;
  for (const p of pts) for (const q of pts) { const d = Math.hypot(p[0]-q[0], p[1]-q[1]); if (d > bd) { bd = d; best = [p, q]; } }
  return best;
}
function blintzSteps() {
  const c1 = [[1,1],[-1,1],[-1,-1],[1,-1]], c2 = [[1,0],[0,1],[-1,0],[0,-1]];
  const p2p = (A) => { const L = { p: [A[0]/2, A[1]/2], d: norm([A[1], -A[0]]) }; return s => E.foldOp(s, L, Math.sign(E.side(L, A)), 'valley', 0); };
  return [
    ...c1.map((A, i) => [i ? 'Next corner.' : 'Fold each corner to the center.', p2p(A)]),
    ['Turn the model over.', s => E.turnOver(s), 900],
    ...c2.map((A, i) => [i ? 'Next corner.' : 'Fold the corners to the center again.', p2p(A)]),
  ];
}
function blintzBase() {
  let s = E.turnOver(E.newPaper()).facets;
  for (const [, fn] of blintzSteps()) s = fn(s).facets;
  return s.map(f => ({ ...f, anim: undefined }));
}
const DEMOS = {
  prelim: [
    ['Valley fold the diagonal.', s => E.foldOp(s, { p: [0,0], d: [S,-S] }, 1, 'valley', 0)],
    ['Fold the triangle in half.', s => E.foldOp(s, { p: [0,0], d: [S,S] }, -1, 'valley', 0)],
    ['Squash the top flap into a square.', s => E.squashOp(s, { p: [0,0], d: [S,S] }, 1, 2), 1400],
    ['Turn the model over.', s => E.turnOver(s), 900],
    ['Squash the other flap. That\u2019s a preliminary base.', s => E.squashOp(s, { p: [0,0], d: [S,-S] }, 1, 2), 1400],
  ],
  waterbomb: [
    ['Fold in half.', s => E.foldOp(s, { p: [0,0], d: [1,0] }, 1, 'valley', 0)],
    ['Fold in half again.', s => E.foldOp(s, { p: [0,0], d: [0,1] }, 1, 'valley', 0)],
    ['Squash the top flap into a triangle.', s => E.squashOp(s, { p: [0,0], d: [0,1] }, -1, 2), 1400],
    ['Turn the model over.', s => E.turnOver(s), 900],
    ['Squash the other flap. That\u2019s a waterbomb base.', s => E.squashOp(s, { p: [0,0], d: [0,1] }, 1, 2), 1400],
  ],
  bird: [
    ['Fold a preliminary base.', s => prelimBase(), 300],
    ['Petal fold: lift the bottom corner while the sides fold in.', s => E.petalOp(s, [0, -0.7]), 2200],
    ['Turn the model over.', s => E.turnOver(s), 900],
    ['Petal fold this side too. That’s a bird base, the start of the crane.', s => E.petalOp(s, [0, -0.7]), 2200],
  ],
  elephant: elephantSteps(),
  crane: modelSteps(CRANE),
  flower: [
    ...blintzSteps(),
    ['Bend the four petals open.', { bends: [
      [{ p: [0.5, 0], d: [0, 1] }, [0.3, 0]], [{ p: [0, 0.5], d: [-1, 0] }, [0, 0.3]],
      [{ p: [-0.5, 0], d: [0, -1] }, [-0.3, 0]], [{ p: [0, -0.5], d: [1, 0] }, [0, -0.3]]], angle: 105, dir: 1 }],
    ['Curl the tips outward. Use Look around to see it in 3D.', { bends: [
      [{ p: [0.16, 0], d: [0, 1] }, [0.06, 0]], [{ p: [0, 0.16], d: [-1, 0] }, [0, 0.06]],
      [{ p: [-0.16, 0], d: [0, -1] }, [-0.06, 0]], [{ p: [0, -0.16], d: [1, 0] }, [0, -0.06]]], angle: 70, dir: -1 }],
  ],
  reverse: [
    ['Valley fold the diagonal.', s => E.foldOp(s, { p: [0,0], d: [S,-S] }, 1, 'valley', 0)],
    ['Inside reverse fold the right tip.', s => E.foldOp(s, { p: [0.35,0], d: [0,1] }, -1, 'inside', 0), 1100],
    ['Outside reverse fold the top tip.', s => E.foldOp(s, { p: [0,0.3], d: [1,0] }, 1, 'outside', 0), 1100],
  ],
};
async function demo(name) {
  if (busy) return;
  if (viewMode) setView(false);
  history.push(snapshot()); future = [];
  await applyResult(name === 'reverse' ? E.newPaper() : E.turnOver(E.newPaper()).facets, false);
  resetView();
  if (name === 'elephant') setColors(ELE_COLORS);
  if (name === 'crane') setColors(CRANE_COLORS);
  for (const [msg, step, dur] of DEMOS[name]) {
    $('#hint').innerHTML = `<span>${msg}</span>`;
    await new Promise(r => setTimeout(r, 600));
    if (typeof step === 'function') {
      const r = step(facets);
      if (r.error) { toast(r.error); break; }
      history.push(snapshot());
      await applyResult(r.facets, !!r.facets[0].anim, dur || 800);
    } else {
      const saved = $('#layers').value; $('#layers').value = step.layers || '1';
      for (const [L, tap, wing] of step.bends) {
        const sg = Math.sign(E.side(L, tap));
        await addBend(L, sg, seedAt(tap), step.angle, step.dir, true, wing ? wingSet(facets, L, wing) : undefined);
      }
      $('#layers').value = saved;
    }
  }
  if (name === 'elephant' || name === 'crane') { await new Promise(r => setTimeout(r, 500)); await setStanding(true); }
  if (name === 'flower') {
    const from = camera.position.clone(), to = new THREE.Vector3(0, -3.3, 3.9), t0 = performance.now();
    await new Promise(res => { const f = (t) => { const u = ease(Math.min(1, (t - t0) / 1600)); camera.position.lerpVectors(from, to, u); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0); if (u < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  }
  await new Promise(r => setTimeout(r, 1800));
  hint();
}

// ---------- stand the model up ----------
let standing = false;
function modelMinY() { return Math.min(...facets.flatMap(E.fold).map(p => p[1])); }
function animateTo(toStand, camTo, tgtTo, ms, floorY) {
  const camFrom = camera.position.clone(), tgtFrom = controls.target.clone(), t0 = performance.now();
  const r0 = matMesh.rotation.x, r1 = toStand ? -Math.PI / 2 : 0;
  const y0 = matMesh.position.y, y1 = toStand ? floorY : 0, z0 = matMesh.position.z, z1 = toStand ? 0 : -0.004;
  busy = true;
  return new Promise(res => {
    const f = (t) => {
      const u = ease(Math.min(1, (t - t0) / ms));
      matMesh.rotation.x = r0 + (r1 - r0) * u; matMesh.position.y = y0 + (y1 - y0) * u; matMesh.position.z = z0 + (z1 - z0) * u;
      camera.position.lerpVectors(camFrom, camTo, u); controls.target.lerpVectors(tgtFrom, tgtTo, u);
      camera.lookAt(controls.target);
      if (u < 1) requestAnimationFrame(f); else { busy = false; res(); }
    };
    requestAnimationFrame(f);
  });
}
function standLabel(on) { const sb = document.querySelector('[data-act=stand]'); if (sb) sb.firstChild.textContent = on ? 'Lay it flat' : 'Stand it up'; }
async function setStanding(on) {
  if (on === standing || busy) return;
  standing = on; standLabel(on);
  if (on) {
    if (!viewMode) setView(true);
    const b = E.bbox(facets.flatMap(E.fold)), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const D = Math.max(2.6, 2.3 * Math.max(b[2] - b[0], b[3] - b[1]) / Math.min(1, camera.aspect));
    await animateTo(true, new THREE.Vector3(cx + 0.4 * D, cy + 0.3 * D, D), new THREE.Vector3(cx, cy, 0), 1300, b[1] - 0.002);
  } else {
    await animateTo(false, HOME.clone(), new THREE.Vector3(0, 0, 0), 900);
  }
}

// ---------- tutorials ----------
const S2 = Math.SQRT1_2;
function hullOf(pts) {
  const p = pts.map(q => [Math.round(q[0]*1e4)/1e4, Math.round(q[1]*1e4)/1e4]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length > 1 && cr(lo[lo.length-2], lo[lo.length-1], q) <= 1e-9) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length > 1 && cr(up[up.length-2], up[up.length-1], q) <= 1e-9) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function sig(fs) {
  const h = hullOf(fs.flatMap(E.fold));
  return { area: Math.abs(E.area(h)), verts: h.length, level: Math.max(...E.levels(fs).lv) };
}
const sameSig = (a, b) => Math.abs(a.area - b.area) < 0.02 && a.verts === b.verts && a.level === b.level;
const sameBox = (a, b) => { const x = E.bbox(a.flatMap(E.fold)), y = E.bbox(b.flatMap(E.fold)); return x.every((v, i) => Math.abs(v - y[i]) < 1e-3); };

function modelTutorial(title, list, colors, done) {
  return {
    title, colors, done, model: true,
    start: () => E.turnOver(E.newPaper()).facets,
    steps: list.map(st => {
      if (st.rotate != null) return { text: st.text, apply: fs => eApply(st, fs).facets, on: 'auto' };
      if (st.turn) return { text: st.text, apply: fs => eApply(st, fs).facets, on: 'turn' };
      if (st.tool === 'petal') return { text: st.text + ' Tap the glowing corner.', setup: () => setTool('petal'), guide: { pts: [st.tap] }, apply: fs => eApply(st, fs).facets, on: 'fold' };
      const L = eLine(st);
      const where = st.bend ? 'the part to bend' : st.tool === 'squash' ? 'the flap' : 'the glowing dot';
      return {
        text: st.text + ' Drag along the glowing line, then tap ' + where + '.',
        setup: () => { setTool(st.bend ? 'bend' : st.tool); setMethod('line'); if (st.tool !== 'sink') $('#layers').value = String(st.n || (st.tool === 'squash' ? 2 : 0)); },
        guide: (fs) => ({ line: crossing(fs, L), tap: st.tap }),
        exact: L,
        bend: st.bend ? [L, st.tap] : undefined, bendAngle: st.angle, bendDir: st.dir, wing: st.wing,
        apply: fs => eApply(st, fs).facets,
        on: st.bend ? 'bend' : 'fold',
      };
    }),
  };
}
const TUTORIALS = {
  basics: {
    title: 'The basics',
    start: () => E.newPaper(),
    steps: [
      { text: 'Drag a line across the middle of the paper, from the left edge to the right edge. Then tap the top half to fold it down.',
        setup: () => { setTool('valley'); setMethod('line'); },
        guide: { line: [[-1, 0], [1, 0]], tap: [0, 0.5] },
        apply: fs => E.foldOp(fs, { p: [0,0], d: [1,0] }, 1, 'valley', 0).facets, on: 'fold' },
      { text: 'Changed your mind? Press Undo at the top to unfold it.', apply: () => E.newPaper(), on: 'undo', act: () => undo() },
      { text: 'Now bring one corner onto another. I switched the crease to Point → point. Tap the glowing corner, then the corner opposite it.',
        setup: () => { setTool('valley'); setMethod('p2p'); },
        guide: { pts: [[1, 1], [-1, -1]] },
        apply: fs => E.foldOp(fs, { p: [0,0], d: [S2,-S2] }, 1, 'valley', 0).facets, on: 'fold' },
      { text: 'Press Turn over to flip the model and see the other side of the paper.', apply: fs => E.turnOver(fs).facets, on: 'turn' },
      { text: 'Press Look around and drag to tilt the model. You can see the layers stacked up. Press Look around again to go back to folding.', apply: fs => fs, on: 'view-off' },
    ],
    done: 'You know the basics. Every fold works the same way: pick a type, place the crease, and tap what moves.',
  },
  squash: {
    title: 'Squash folds',
    start: () => E.turnOver(E.newPaper()).facets,
    steps: [
      { text: 'Fold the paper corner to corner. Tap the glowing corner, then the opposite one.',
        setup: () => { setTool('valley'); setMethod('p2p'); },
        guide: { pts: [[1, 1], [-1, -1]] },
        apply: fs => E.foldOp(fs, { p: [0,0], d: [S2,-S2] }, 1, 'valley', 0).facets, on: 'fold' },
      { text: 'Fold the triangle in half. Tap the glowing sharp corner, then the other sharp corner.',
        setup: () => { setTool('valley'); setMethod('p2p'); },
        guide: { pts: [[1, -1], [-1, 1]] },
        apply: fs => E.foldOp(fs, { p: [0,0], d: [-S2,-S2] }, 1, 'valley', 0).facets, on: 'fold' },
      { text: 'Now the squash. I picked the Squash tool. Drag along the glowing line, which is the flap\u2019s hinge. Then tap the flap.',
        setup: () => { setTool('squash'); },
        guide: { line: [[0, 0], [-1, -1]], tap: [-0.62, 0.22] },
        apply: fs => E.squashOp(fs, { p: [0,0], d: [S2,S2] }, 1, 2).facets, on: 'fold' },
      { text: 'The flap opened into a square. Press Turn over to get to the other flap.', apply: fs => E.turnOver(fs).facets, on: 'turn' },
      { text: 'Squash this flap the same way. Drag along the glowing hinge, then tap the flap.',
        setup: () => { setTool('squash'); },
        guide: { line: [[0, 0], [1, -1]], tap: [0.62, 0.22] },
        apply: fs => E.squashOp(fs, { p: [0,0], d: [S2,-S2] }, 1, 2).facets, on: 'fold' },
    ],
    done: 'That square is a preliminary base. It\u2019s the starting point for the crane, the frog, and the lily.',
  },
  petal: {
    title: 'Petal folds',
    start: () => prelimBase().facets,
    steps: [
      { text: 'This is a preliminary base. I picked the Petal tool. Tap the glowing bottom corner to lift it.',
        setup: () => setTool('petal'), guide: { pts: [[0, -0.707]] },
        apply: fs => E.petalOp(fs, [0, -0.7]).facets, on: 'fold' },
      { text: 'The sides folded in as the corner went up. Press Turn over.', apply: fs => E.turnOver(fs).facets, on: 'turn' },
      { text: 'Petal fold this side too. Tap the glowing corner.',
        setup: () => setTool('petal'), guide: { pts: [[0, -0.707]] },
        apply: fs => E.petalOp(fs, [0, -0.7]).facets, on: 'fold' },
    ],
    done: 'That\u2019s a bird base, the shape a crane is folded from.',
  },
  elephant: modelTutorial('Elephant', ELEPHANT, ELE_COLORS, 'Your elephant is finished. Stand it up to see it in 3D, with the trunk curling toward you.'),
  crane: modelTutorial('Crane', CRANE, CRANE_COLORS, 'Your crane is finished. Stand it up to see it with its wings spread.'),
  flower: {
    title: 'Bend into 3D',
    start: () => blintzBase(),
    steps: [
      { text: 'Folds so far lie flat. Bends can stop at any angle. I picked Bend. Drag along the glowing edge, then tap the triangle next to it.',
        setup: () => { setTool('bend'); },
        guide: { line: [[0.5, -0.5], [0.5, 0.5]], tap: [0.3, 0] },
        bend: [{ p: [0.5, -0.5], d: [0, 1] }, [0.3, 0]],
        apply: fs => E.bendSplit(fs, { p: [0.5, -0.5], d: [0, 1] }, 1, 1, f => inPoly([0.3, 0], E.fold(f))).facets, on: 'bend' },
      { text: 'Your bend is listed in the panel on the left. Drag its slider to open the petal wider.', apply: fs => fs, on: 'bend-angle' },
      { text: 'Bend the top petal the same way: drag along the glowing edge, then tap its triangle.',
        setup: () => { setTool('bend'); },
        guide: { line: [[0.5, 0.5], [-0.5, 0.5]], tap: [0, 0.3] },
        bend: [{ p: [0.5, 0.5], d: [-1, 0] }, [0, 0.3]],
        apply: fs => fs, on: 'bend' },
      { text: 'Press Look around and drag to see your petals standing up. Press it again when you\u2019re done.', apply: fs => fs, on: 'view-off' },
    ],
    done: 'Bends work on any flap. Open Sheet and pick Show me: 3D flower to see a finished one.',
  },
};

let tut = null; // { def, i, canon[] }
const card = $('#tut');
const guideGroup = new THREE.Group(); scene.add(guideGroup);
function clearGuide() { while (guideGroup.children.length) { const c = guideGroup.children.pop(); c.geometry.dispose(); } }
function drawGuide(g) {
  clearGuide(); if (!g) return;
  const z = topZ() + 0.002;
  const ring = (p, col) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.075, 32), ovMat(col, 0.95)); m.position.set(p[0], p[1], z); m.renderOrder = 12; m.userData.pulse = true; guideGroup.add(m); };
  if (g.pts) g.pts.forEach((p, i) => ring(p, i === 0 ? 0xffd447 : 0xffffff));
  if (g.line) {
    const [a, b] = g.line, d = norm([b[0]-a[0], b[1]-a[1]]), w = 0.016, nx = -d[1]*w, ny = d[0]*w;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([a[0]+nx,a[1]+ny,0, b[0]+nx,b[1]+ny,0, b[0]-nx,b[1]-ny,0, a[0]+nx,a[1]+ny,0, b[0]-nx,b[1]-ny,0, a[0]-nx,a[1]-ny,0], 3));
    const l = new THREE.Mesh(geo, ovMat(0xffd447, 0.9)); l.position.z = z; l.renderOrder = 12; guideGroup.add(l);
    ring(g.line[0], 0xffd447); ring(g.line[1], 0xffd447);
  }
  if (g.tap) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.05, 28), ovMat(0xffffff, 0.75)); m.position.set(g.tap[0], g.tap[1], z); m.renderOrder = 12; m.userData.pulse = true; guideGroup.add(m); }
}
function renderCard(extra) {
  if (!tut) { card.hidden = true; return; }
  card.hidden = false;
  const { def, i } = tut, n = def.steps.length;
  if (i >= n) {
    card.innerHTML = `<p class="tut-title">${def.title}</p><p class="tut-text">${def.done}</p>
      <div class="tut-actions"><button class="primary" data-t="close">Start folding</button>${def === TUTORIALS.basics ? '<button data-t="next-tut">Try squash folds</button>' : ''}${def.model ? '<button data-t="look">Stand it up</button>' : ''}</div>`;
    return;
  }
  card.innerHTML = `<p class="tut-title">${def.title}<span>Step ${i + 1} of ${n}</span></p>
    <div class="tut-bar"><i style="width:${(i / n) * 100}%"></i></div>
    <p class="tut-text">${def.steps[i].text}</p>
    ${extra ? `<p class="tut-note">${extra}</p>` : ''}
    <div class="tut-actions">${def.steps[i].on === 'auto' ? '' : '<button class="primary" data-t="show">Show me</button>'}<button data-t="close">Exit tutorial</button></div>`;
}
card.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const a = b.dataset.t;
  if (a === 'close') endTutorial();
  if (a === 'next-tut') startTutorial('squash');
  if (a === 'show') showMe();
  if (a === 'look') { endTutorial(); setStanding(true); }
});
function enterStep() {
  cancel();
  const st = tut.def.steps[tut.i];
  if (!st) { clearGuide(); renderCard(); return; }
  if (st.setup) st.setup();
  const g = typeof st.guide === 'function' ? st.guide(tut.canon[tut.i]) : st.guide;
  extraSnaps = g ? [...(g.pts || []), ...(g.line || [])] : [];
  drawGuide(g);
  renderCard();
  if (st.on === 'auto') setTimeout(() => { if (tut && tut.def.steps[tut.i] === st) commit({ facets: st.apply(facets) }, 800, 'auto'); }, 700);
}
async function startTutorial(name) {
  if (busy) return;
  if (viewMode) setView(false);
  const def = TUTORIALS[name];
  const canon = [def.start()];
  def.steps.forEach((st, k) => canon.push(st.apply(canon[k])));
  tut = { def, i: 0, canon };
  if (def.colors) setColors(def.colors);
  history.push(snapshot()); future = [];
  await applyResult(canon[0], false);
  resetView();
  enterStep();
}
function endTutorial() { tut = null; extraSnaps = []; clearGuide(); renderCard(); }
function advance() {
  const target = tut.canon[tut.i + 1];
  if (target && !sameBox(facets, target)) applyResult(target, false, 0, bends);
  tut.i++;
  card.classList.add('tut-pass'); setTimeout(() => card.classList.remove('tut-pass'), 500);
  enterStep();
}
notify = (evt) => {
  if (!tut || tut.i >= tut.def.steps.length) return;
  const st = tut.def.steps[tut.i];
  if (st.on !== evt) return;
  if (evt === 'fold') {
    if (sameSig(sig(facets), sig(tut.canon[tut.i + 1]))) advance();
    else renderCard('That\u2019s a different fold. Press Undo and try again, or press Show me.');
  } else if (evt === 'undo') {
    if (facets.length === 1) advance();
  } else advance();
};
async function showMe() {
  if (busy || !tut) return;
  const st = tut.def.steps[tut.i];
  cancel();
  if (st.on === 'undo') { if (history.length) undo(); else advance(); return; }
  if (st.on === 'bend') { const [L, tap] = st.bend; await addBend(L, Math.sign(E.side(L, tap)), seedAt(tap), st.bendAngle || 90, st.bendDir || 1, true, st.wing ? wingSet(facets, L, st.wing) : undefined); return; }
  if (st.on === 'bend-angle') {
    const b = bends[bends.length - 1]; if (!b) { advance(); return; }
    const a0 = b.angle, t0 = performance.now(); busy = true;
    await new Promise(res => { const f = (t) => { const u = Math.min(1, (t - t0) / 700); b.angle = a0 + (140 - a0) * ease(u); poseAll(null, 1); if (u < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    busy = false; renderBends(); notify('bend-angle'); return;
  }
  if (st.on === 'view-off') {
    setView(true);
    const from = camera.position.clone(), t0 = performance.now();
    await new Promise(res => { const f = (t) => { const u = Math.min(1, (t - t0) / 1400); camera.position.set(from.x, from.y - Math.sin(u * Math.PI) * 3.2, from.z - Math.sin(u * Math.PI) * 1.2); camera.lookAt(0, 0, 0); if (u < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    setView(false); return;
  }
  const prev = tut.canon[tut.i];
  if (!sameBox(facets, prev) || facets.length !== prev.length) await applyResult(prev, false);
  const res = st.on === 'turn' ? E.turnOver(facets) : { facets: st.apply(facets) };
  const r = st.on === 'fold' ? { facets: st.apply(facets) } : res;
  await commit(r, tool === 'squash' ? 1300 : 800, st.on);
}
$('#learn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#learnmenu'); const o = m.classList.toggle('open'); $('#learn').setAttribute('aria-expanded', o); });
document.addEventListener('click', () => { $('#learnmenu').classList.remove('open'); $('#learn').setAttribute('aria-expanded', false); });
$('#learnmenu').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) startTutorial(b.dataset.tut); });
(function animateGuide() {
  const s = 1 + 0.18 * Math.sin(performance.now() / 260);
  guideGroup.children.forEach(c => { if (c.userData.pulse) c.scale.set(s, s, 1); c.position.z = topZ() + 0.002; });
  requestAnimationFrame(animateGuide);
})();
// first visit: offer the basics
let seen = false; try { seen = localStorage.getItem('fold-tour-seen') === '1'; localStorage.setItem('fold-tour-seen', '1'); } catch (e) {}
if (!seen) {
  card.hidden = false;
  card.innerHTML = `<p class="tut-title">New to Fold?</p><p class="tut-text">A five-step tour shows you how to crease, fold, undo, and look around. It takes about a minute.</p>
    <div class="tut-actions"><button class="primary" data-t2="go">Take the tour</button><button data-t2="no">No thanks</button></div>`;
  card.addEventListener('click', function once(e) {
    const b = e.target.closest('button[data-t2]'); if (!b) return;
    card.removeEventListener('click', once);
    if (b.dataset.t2 === 'go') startTutorial('basics'); else card.hidden = true;
  });
}

// ---------- loop ----------
buildMeshes(); updateButtons(); hint();
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
window.__fold = { E, get bends() { return bends; }, ws: (L, w) => wingSet(facets, L, w), st: (n) => startTutorial(n), show: (fs, nb) => applyResult(fs, false, 0, nb), get facets() { return facets; }, inPoly };
})();
