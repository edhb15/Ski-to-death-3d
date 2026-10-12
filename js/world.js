'use strict';
// World decoration + obstacle colliders (trees, rocks, cabins, lift pylons...)

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const OBST_BUCKET = 10;
const obstacleBuckets = new Map();

function addObstacle(o) {
  const k = Math.floor(-o.z / OBST_BUCKET);
  if (!obstacleBuckets.has(k)) obstacleBuckets.set(k, []);
  obstacleBuckets.get(k).push(o);
}

const _near = [];
function nearbyObstacles(x, z) {
  _near.length = 0;
  const k = Math.floor(-z / OBST_BUCKET);
  for (let kk = k - 1; kk <= k + 1; kk++) {
    const b = obstacleBuckets.get(kk);
    if (b) for (const o of b) _near.push(o);
  }
  return _near;
}

// Sphere (center pos, radius r) vs obstacle. Writes push-out normal to outN,
// returns penetration depth (0 if no contact).
function collideObstacle(o, pos, r, outN) {
  if (o.type === 'sphere') {
    const dx = pos.x - o.x, dy = pos.y - o.y, dz = pos.z - o.z;
    const R = o.r + r;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= R * R) return 0;
    const d = Math.sqrt(d2) || 1e-6;
    outN.set(dx / d, dy / d, dz / d);
    return R - d;
  }
  if (o.type === 'cyl') {
    if (pos.y < o.y0 - r || pos.y > o.y1 + r) return 0;
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const R = o.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) return 0;
    const d = Math.sqrt(d2) || 1e-6;
    const side = R - d;
    const top = o.y1 + r - pos.y;
    if (top < side) { outN.set(0, 1, 0); return top; }
    outN.set(dx / d, 0, dz / d);
    return side;
  }
  if (o.type === 'box') {
    const pens = [
      pos.x + r - o.minX, o.maxX - (pos.x - r),
      pos.y + r - o.minY, o.maxY - (pos.y - r),
      pos.z + r - o.minZ, o.maxZ - (pos.z - r),
    ];
    let best = 0;
    for (let i = 0; i < 6; i++) {
      if (pens[i] <= 0) return 0;
      if (pens[i] < pens[best]) best = i;
    }
    const s = best % 2 === 0 ? -1 : 1;
    if (best < 2) outN.set(s, 0, 0); else if (best < 4) outN.set(0, s, 0); else outN.set(0, 0, s);
    return pens[best];
  }
  return 0;
}

function nearCliffOrRamp(x, d, margin) {
  for (const c of CLIFFS) if (d > c.d - margin - 4 && d < c.d + c.w + margin + 4) return true;
  for (const r of RAMPS) if (Math.abs(x - r.x) < r.hw + 6 && d > r.d - r.len - margin - 15 && d < r.d + margin + 4) return true;
  return false;
}

function makeTextTexture(lines, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = fg; g.lineWidth = 14; g.strokeRect(10, 10, 492, 236);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = lines.length > 1 ? 70 : 96;
  g.font = `900 ${size}px Impact, Arial Black, sans-serif`;
  const widest = Math.max(...lines.map(l => g.measureText(l).width));
  if (widest > 450) { size = Math.floor(size * 450 / widest); g.font = `900 ${size}px Impact, Arial Black, sans-serif`; }
  lines.forEach((l, i) => g.fillText(l, 256, 128 + (i - (lines.length - 1) / 2) * size * 1.1));
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function populateWorld(scene) {
  const rand = mulberry32(1337);
  const tmpN = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();

  // ---- Trees ----
  const trees = [];
  for (let i = 0; i < 1500 && trees.length < 950; i++) {
    const x = (rand() * 2 - 1) * 112;
    const d = rand() * 1560 - 30;
    if (Math.abs(x) < 38 && rand() > 0.12) continue;
    if (Math.abs(x) < 4) continue; // keep a clear line down the middle
    if (d < 30 && Math.abs(x) < 16) continue;
    if (nearCliffOrRamp(x, d, 3)) continue;
    const z = -d;
    if (groundNormal(x, z, tmpN).y < 0.72) continue;
    trees.push({ x, z, y: groundHeight(x, z) - 0.2, s: 0.8 + rand() * 0.9, rot: rand() * 6.28 });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.8, 6); trunkGeo.translate(0, 0.9, 0);
  const layers = [[1.7, 3.0, 1.3], [1.3, 2.6, 2.6], [0.85, 2.2, 3.8]];
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 }), trees.length);
  const cones = layers.map(([r, h, y], li) => {
    const g = new THREE.ConeGeometry(r, h, 8); g.translate(0, y + h / 2, 0);
    const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees.length);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  });
  trunk.castShadow = true;
  const c = new THREE.Color();
  trees.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    m4.compose(p.set(t.x, t.y, t.z), q, s.set(t.s, t.s, t.s));
    trunk.setMatrixAt(i, m4);
    cones.forEach((cm, li) => {
      cm.setMatrixAt(i, m4);
      const snowy = li === 2 ? 0.45 : 0.12;
      c.setHSL(0.36 + rand() * 0.05, 0.45, 0.17 + rand() * 0.06).lerp(new THREE.Color(0xeef4ff), snowy * rand());
      cm.setColorAt(i, c);
    });
    addObstacle({ type: 'cyl', x: t.x, z: t.z, y0: t.y - 1, y1: t.y + 6 * t.s, r: 0.45 * t.s, kind: 'tree' });
  });
  scene.add(trunk); cones.forEach(m => scene.add(m));

  // ---- Rocks ----
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rp = rockGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const vx = rp.getX(i), vy = rp.getY(i), vz = rp.getZ(i);
    const f = 1 + 0.22 * Math.sin(vx * 5.1 + vy * 3.3) * Math.cos(vz * 4.7 - vx * 2.1);
    rp.setXYZ(i, vx * f, vy * f * 0.8, vz * f);
  }
  rockGeo.computeVertexNormals();
  const rocks = [];
  const addRock = (x, d, sz) => {
    const z = -d;
    rocks.push({ x, z, y: groundHeight(x, z) + sz * 0.2, s: sz, rx: rand() * 6, ry: rand() * 6 });
  };
  for (let i = 0; i < 400 && rocks.length < 130; i++) {
    const x = (rand() * 2 - 1) * 100, d = rand() * 1150 + 20;
    if (nearCliffOrRamp(x, d, 2)) continue;
    addRock(x, d, 0.6 + rand() * 1.6);
  }
  // boulders at the bottom of each cliff
  for (const cl of CLIFFS) {
    const n = cl === ABYSS ? 140 : 18;
    for (let i = 0; i < n; i++) {
      const x = (rand() * 2 - 1) * 95;
      const d = cl.d + cl.w + 6 + rand() * (cl === ABYSS ? 230 : 30);
      addRock(x, d, (cl === ABYSS ? 1.2 : 0.8) + rand() * (cl === ABYSS ? 2.8 : 1.4));
    }
  }
  const rockMesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x77777f, roughness: 0.95, flatShading: true }), rocks.length);
  rockMesh.castShadow = true; rockMesh.receiveShadow = true;
  rocks.forEach((r, i) => {
    q.setFromEuler(e.set(r.rx, r.ry, 0));
    m4.compose(p.set(r.x, r.y, r.z), q, s.set(r.s, r.s, r.s));
    rockMesh.setMatrixAt(i, m4);
    c.setHSL(0.62, 0.04, 0.38 + rand() * 0.12);
    rockMesh.setColorAt(i, c);
    addObstacle({ type: 'sphere', x: r.x, y: r.y, z: r.z, r: r.s * 0.85, kind: 'rock' });
  });
  scene.add(rockMesh);

  // ---- Cabins ----
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.9, flatShading: true });
  const winMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0x6a4a10 });
  for (const [x, d] of [[22, 60], [-26, 300], [30, 590], [-18, 930], [12, 1300]]) {
    const z = -d;
    const y = Math.min(groundHeight(x - 3, z - 3), groundHeight(x + 3, z + 3), groundHeight(x - 3, z + 3), groundHeight(x + 3, z - 3));
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 5), wood); body.position.y = 2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5, 2.4, 4), roofMat); roof.position.y = 5.2; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.85);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 0.1), winMat); win.position.set(0, 2.2, 2.52);
    for (const m of [body, roof]) { m.castShadow = true; m.receiveShadow = true; }
    g.add(body, roof, win);
    g.position.set(x, y - 0.5, z);
    scene.add(g);
    addObstacle({ type: 'box', x, z, minX: x - 3, maxX: x + 3, minY: y - 3, maxY: y + 4.5, minZ: z - 2.5, maxZ: z + 2.5, kind: 'cabin' });
  }

  // ---- Ski lift pylons + cables ----
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a96a3, metalness: 0.6, roughness: 0.4 });
  const tops = [];
  for (let d = 10; d < 1170; d += 55) {
    if (nearCliffOrRamp(-38, d, 4)) continue;
    const x = -38, z = -d, y = groundHeight(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 14, 8), steel);
    pole.position.set(x, y + 7, z); pole.castShadow = true;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 0.35), steel);
    bar.position.set(x, y + 13.8, z);
    scene.add(pole, bar);
    tops.push(new THREE.Vector3(x, y + 13.6, z));
    addObstacle({ type: 'cyl', x, z, y0: y - 1, y1: y + 14, r: 0.4, kind: 'pylon' });
  }
  const cableMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  for (const off of [-2.3, 2.3]) {
    const pts = tops.map(t => t.clone().add(new THREE.Vector3(off, 0, 0)));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
  }
  // chairs hanging from the cable
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2b6cb0 });
  for (let i = 0; i < tops.length - 1; i++) {
    for (const off of [-2.3, 2.3]) {
      const a = tops[i], b = tops[i + 1];
      const t = 0.5;
      const cp = a.clone().lerp(b, t).add(new THREE.Vector3(off, -0.4, 0));
      const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2, 4), steel); hang.position.copy(cp).add(new THREE.Vector3(0, -1, 0));
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.6), chairMat); seat.position.copy(cp).add(new THREE.Vector3(0, -2, 0));
      scene.add(hang, seat);
    }
  }

  // ---- Snowmen ----
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const carrot = new THREE.MeshStandardMaterial({ color: 0xff7a1a });
  const coal = new THREE.MeshStandardMaterial({ color: 0x111111 });
  for (const [x, d] of [[8, 95], [-12, 455], [5, 760], [-6, 1060], [14, 1240]]) {
    const z = -d, y = groundHeight(x, z);
    const g = new THREE.Group();
    [[0.75, 0.6], [0.55, 1.65], [0.38, 2.4]].forEach(([r, h]) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), snowMat); b.position.y = h; b.castShadow = true; g.add(b);
    });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 8), carrot); nose.rotation.x = Math.PI / 2; nose.position.set(0, 2.4, 0.5); g.add(nose);
    for (const ex of [-0.13, 0.13]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), coal); eye.position.set(ex, 2.52, 0.33); g.add(eye); }
    g.position.set(x, y - 0.1, z);
    g.rotation.y = 0;
    scene.add(g);
    addObstacle({ type: 'sphere', x, y: y + 1.1, z, r: 0.95, kind: 'snowman' });
  }

  // ---- Slalom gates (decorative) ----
  const red = new THREE.MeshStandardMaterial({ color: 0xe63946 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1d4ed8 });
  for (let i = 0; i < 8; i++) {
    const d = 35 + i * 13, x = (i % 2 ? -1 : 1) * 6;
    if (nearCliffOrRamp(x, d, 1)) continue;
    const z = -d, y = groundHeight(x, z);
    const mat = i % 2 ? red : blue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), mat); pole.position.set(x, y + 0.9, z);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.02), mat); flag.position.set(x + 0.3, y + 1.5, z);
    scene.add(pole, flag);
  }

  // ---- Signs ----
  const post = new THREE.MeshStandardMaterial({ color: 0x4a3420 });
  const sign = (x, d, lines, bg, fg, w = 4, h = 2) => {
    const z = -d, y = groundHeight(x, z);
    const mat = new THREE.MeshStandardMaterial({ map: makeTextTexture(lines, bg, fg), roughness: 0.8 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), [post, post, post, post, mat, post]);
    board.position.set(x, y + 2.8, z);
    board.castShadow = true;
    for (const ox of [-w / 2 + 0.3, w / 2 - 0.3]) {
      const pp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), post);
      pp.position.set(x + ox, y + 1.5, z);
      scene.add(pp);
    }
    scene.add(board);
  };
  for (const cl of CLIFFS) {
    sign(-9, cl.d - 30, ['⚠ ' + cl.name, cl.drop + ' m DROP'], '#ffd60a', '#111');
    sign(9, cl.d - 30, ['☠ DANGER', 'CLIFF AHEAD'], '#e63946', '#fff');
  }
  sign(-7, 14, ['SKI TO DEATH'], '#111', '#ff3b3b', 5, 2);

  // Start banner
  const bannerMat = new THREE.MeshStandardMaterial({ map: makeTextTexture(['START'], '#e63946', '#fff') });
  const by = groundHeight(0, 0);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(8, 1.6, 0.1), bannerMat);
  banner.position.set(0, by + 4.6, -2);
  scene.add(banner);
  for (const ox of [-4.2, 4.2]) {
    const pp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5.4, 8), steel);
    pp.position.set(ox, groundHeight(ox, -2) + 2.7, -2);
    scene.add(pp);
  }

  // ---- Distant mountains ----
  const mtnMat = new THREE.MeshStandardMaterial({ color: 0xdfe8f5, roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (200 + rand() * 250);
    const d = rand() * 1900 - 200;
    const h = 150 + rand() * 250;
    const m = new THREE.Mesh(new THREE.ConeGeometry(120 + rand() * 120, h, 7), mtnMat);
    m.position.set(x, -0.34 * Math.max(0, d) + h / 2 - 60, -d);
    m.rotation.y = rand() * 6;
    scene.add(m);
  }
}
