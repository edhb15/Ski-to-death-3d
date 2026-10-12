'use strict';
// Verlet ragdoll + the skier's 3D model (shared by skiing and crashing).

// Particle indices
const P = {
  HEAD: 0, NECK: 1, CHEST: 2, PELVIS: 3,
  LSH: 4, RSH: 5, LEL: 6, REL: 7, LHA: 8, RHA: 9,
  LHIP: 10, RHIP: 11, LKN: 12, RKN: 13, LFT: 14, RFT: 15,
  // loose gear
  LSKI_F: 16, LSKI_B: 17, RSKI_F: 18, RSKI_B: 19,
  LPOLE_T: 20, LPOLE_B: 21, RPOLE_T: 22, RPOLE_B: 23,
};
const BODY_COUNT = 16;
const PARTICLE_COUNT = 24;

const PARTICLE_RADIUS = [0.14, 0.06, 0.15, 0.13, 0.07, 0.07, 0.06, 0.06, 0.06, 0.06,
  0.08, 0.08, 0.07, 0.07, 0.07, 0.07, 0.04, 0.04, 0.04, 0.04, 0.03, 0.03, 0.03, 0.03];
const PARTICLE_MASS = [5, 2, 18, 14, 3, 3, 2.5, 2.5, 1, 1, 6, 6, 4, 4, 2, 2, 1, 1, 1, 1, 0.3, 0.3, 0.3, 0.3];

// [a, b, stiffness, tag]
const CONSTRAINTS = [
  // bones
  [0, 1, 1, 'neck'], [1, 2, 1], [2, 3, 1], [1, 4, 1], [1, 5, 1],
  [4, 6, 1], [5, 7, 1], [6, 8, 1], [7, 9, 1],
  [3, 10, 1], [3, 11, 1], [10, 12, 1], [11, 13, 1], [12, 14, 1], [13, 15, 1],
  // structure
  [4, 5, 1], [10, 11, 1], [4, 2, 1], [5, 2, 1], [4, 3, 0.8, 'spine'], [5, 3, 0.8, 'spine'],
  [10, 2, 0.8, 'spine'], [11, 2, 0.8, 'spine'], [1, 3, 0.4, 'spine'],
  [0, 4, 0.6, 'neck'], [0, 5, 0.6, 'neck'], [0, 2, 0.5, 'neck'],
  [4, 10, 1], [5, 11, 1], [1, 10, 0.8], [1, 11, 0.8],
  // gear
  [16, 17, 1], [18, 19, 1], [20, 21, 1], [22, 23, 1],
];
// Keep joints from folding completely flat: [a, b, minDistFactor]
const MIN_CONSTRAINTS = [[10, 14, 0.45], [11, 15, 0.45], [4, 8, 0.35], [5, 9, 0.35], [0, 3, 0.6]];

// Skiing poses in skier-local space (x right, y up, -z forward)
const POSE_NEUTRAL = [
  [0, 1.62, -0.12], [0, 1.42, -0.06], [0, 1.2, 0], [0, 0.92, 0.08],
  [-0.21, 1.38, -0.04], [0.21, 1.38, -0.04],
  [-0.3, 1.12, -0.18], [0.3, 1.12, -0.18],
  [-0.32, 0.98, -0.42], [0.32, 0.98, -0.42],
  [-0.12, 0.88, 0.08], [0.12, 0.88, 0.08],
  [-0.14, 0.5, -0.14], [0.14, 0.5, -0.14],
  [-0.14, 0.1, 0.02], [0.14, 0.1, 0.02],
];
const POSE_TUCK = [
  [0, 1.25, -0.38], [0, 1.1, -0.28], [0, 0.92, -0.12], [0, 0.72, 0.12],
  [-0.2, 1.06, -0.25], [0.2, 1.06, -0.25],
  [-0.24, 0.86, -0.42], [0.24, 0.86, -0.42],
  [-0.18, 0.8, -0.62], [0.18, 0.8, -0.62],
  [-0.12, 0.7, 0.12], [0.12, 0.7, 0.12],
  [-0.14, 0.45, -0.25], [0.14, 0.45, -0.25],
  [-0.14, 0.1, 0.0], [0.14, 0.1, 0.0],
];

class Ragdoll {
  constructor(positions, velocities, h) {
    this.h = h;
    this.g = new THREE.Vector3(0, -9.81, 0);
    this.p = positions.map((pos, i) => ({
      pos: pos.clone(),
      prev: pos.clone().addScaledVector(velocities[i], -h),
      r: PARTICLE_RADIUS[i],
      w: 1 / PARTICLE_MASS[i],
      cool: 0,
    }));
    this.c = CONSTRAINTS.map(([a, b, k, tag]) => ({ a, b, k, tag, rest: positions[a].distanceTo(positions[b]) }));
    this.cmin = MIN_CONSTRAINTS.map(([a, b, f]) => ({ a, b, min: positions[a].distanceTo(positions[b]) * f }));
    this._d = new THREE.Vector3(); this._v = new THREE.Vector3(); this._n = new THREE.Vector3(); this._t = new THREE.Vector3();
  }

  weaken(tag, k) {
    for (const c of this.c) if (c.tag === tag) c.k = Math.min(c.k, k);
  }

  solve(c, isMin) {
    const A = this.p[c.a], B = this.p[c.b];
    const d = this._d.subVectors(B.pos, A.pos);
    const len = d.length() || 1e-6;
    let diff;
    if (isMin) { if (len >= c.min) return; diff = (len - c.min) / len; }
    else diff = (len - c.rest) / len * c.k;
    const ws = A.w + B.w;
    A.pos.addScaledVector(d, diff * A.w / ws);
    B.pos.addScaledVector(d, -diff * B.w / ws);
  }

  step(substeps, onImpact) {
    const h = this.h;
    for (let s = 0; s < substeps; s++) {
      for (const p of this.p) {
        const v = this._v.subVectors(p.pos, p.prev).multiplyScalar(0.9995);
        p.prev.copy(p.pos);
        p.pos.add(v).addScaledVector(this.g, h * h);
        if (p.cool > 0) p.cool -= h;
      }
      for (let it = 0; it < 6; it++) {
        for (const c of this.c) this.solve(c, false);
        for (const c of this.cmin) this.solve(c, true);
      }
      for (let i = 0; i < this.p.length; i++) this.collide(i, onImpact);
    }
  }

  respond(i, n, pen, onImpact, e, mu, scrape = 0) {
    const p = this.p[i], h = this.h;
    const v = this._v.subVectors(p.pos, p.prev).divideScalar(h);
    p.pos.addScaledVector(n, pen);
    const vn = v.dot(n);
    if (vn >= 0) return;
    const vt = this._t.copy(v).addScaledVector(n, -vn);
    const vtl = vt.length();
    const keep = vtl > 1e-6 ? Math.max(0, vtl - mu * -vn - 0.6 * h) / vtl : 0;
    vt.multiplyScalar(keep).addScaledVector(n, -vn * e);
    p.prev.copy(p.pos).addScaledVector(vt, -h);
    // obstacles also hurt when you hit them at an angle (scrape)
    const hit = -vn + scrape * vtl;
    if (hit > 4 && p.cool <= 0) {
      p.cool = 0.1;
      onImpact(i, hit, p.pos);
    }
  }

  collide(i, onImpact) {
    const p = this.p[i];
    const gy = groundHeight(p.pos.x, p.pos.z);
    if (p.pos.y - p.r < gy) {
      // push straight up (robust on steep cliff faces), respond along the normal
      const dy = gy + p.r - p.pos.y;
      this.respond(i, groundNormal(p.pos.x, p.pos.z, this._n), 0, onImpact, 0.15, 0.55);
      p.pos.y += dy; p.prev.y += dy;
    }
    const obs = nearbyObstacles(p.pos.x, p.pos.z);
    for (const o of obs) {
      const pen = collideObstacle(o, p.pos, p.r, this._n);
      if (pen > 0) this.respond(i, this._n, pen, onImpact, 0.25, 0.4, 0.4);
    }
  }

  maxBodySpeed() {
    let m = 0;
    for (let i = 0; i < BODY_COUNT; i++) {
      const p = this.p[i];
      m = Math.max(m, p.pos.distanceTo(p.prev) / this.h);
    }
    return m;
  }
}

// ---------------------------------------------------------------- model
class SkierModel {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.segments = [];
    this.upHint = new THREE.Vector3(0, 1, 0);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
    const sph = new THREE.SphereGeometry(1, 16, 12);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const COL = { jacket: 0xd62828, pants: 0x1d3557, skin: 0xf1c27d, glove: 0x222222, boot: 0x555b66, ski: 0xff8c1a, pole: 0xc0c6cf, helmet: 0xffbe0b };

    const add = (kind, geo, color, opts) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      this.group.add(mesh);
      const seg = Object.assign({ kind, mesh, base: new THREE.Color(color), groups: [], flash: 0 }, opts);
      this.segments.push(seg);
      return seg;
    };
    const limb = (a, b, r, color, groups) => add('limb', cyl, color, { a, b, r, groups });
    const joint = (a, r, color, groups) => add('joint', sph, color, { a, r, groups });

    // head (group with helmet + goggles)
    const head = new THREE.Group();
    const skull = new THREE.Mesh(sph, new THREE.MeshStandardMaterial({ color: COL.skin, roughness: 0.6 }));
    skull.scale.setScalar(0.12); skull.castShadow = true;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.137, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: COL.helmet, roughness: 0.35 }));
    helmet.position.y = 0.01; helmet.castShadow = true;
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.065, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.5, roughness: 0.2, emissive: 0x2a1840 }));
    goggles.position.set(0, 0.01, -0.105);
    head.add(skull, helmet, goggles);
    this.group.add(head);
    this.segments.push({ kind: 'head', mesh: head, tintMesh: skull, base: new THREE.Color(COL.skin), groups: ['cranium', 'face'], flash: 0 });

    limb(0, 1, 0.05, COL.skin, ['cervical']);
    add('torso', box, COL.jacket, { groups: ['ribs', 'thoracic', 'sternum'] });
    add('pelvis', box, COL.pants, { groups: ['hipL', 'hipR', 'sacrum', 'lumbar'] });
    joint(P.LSH, 0.075, COL.jacket, ['clavicleL', 'scapulaL']);
    joint(P.RSH, 0.075, COL.jacket, ['clavicleR', 'scapulaR']);
    limb(P.LSH, P.LEL, 0.055, COL.jacket, ['humerusL']);
    limb(P.RSH, P.REL, 0.055, COL.jacket, ['humerusR']);
    joint(P.LEL, 0.055, COL.jacket, ['humerusL']);
    joint(P.REL, 0.055, COL.jacket, ['humerusR']);
    limb(P.LEL, P.LHA, 0.048, COL.jacket, ['radiusL', 'ulnaL']);
    limb(P.REL, P.RHA, 0.048, COL.jacket, ['radiusR', 'ulnaR']);
    joint(P.LHA, 0.06, COL.glove, ['handL']);
    joint(P.RHA, 0.06, COL.glove, ['handR']);
    joint(P.LHIP, 0.085, COL.pants, ['hipL']);
    joint(P.RHIP, 0.085, COL.pants, ['hipR']);
    limb(P.LHIP, P.LKN, 0.075, COL.pants, ['femurL']);
    limb(P.RHIP, P.RKN, 0.075, COL.pants, ['femurR']);
    joint(P.LKN, 0.07, COL.pants, ['patellaL']);
    joint(P.RKN, 0.07, COL.pants, ['patellaR']);
    limb(P.LKN, P.LFT, 0.062, COL.pants, ['tibiaL', 'fibulaL']);
    limb(P.RKN, P.RFT, 0.062, COL.pants, ['tibiaR', 'fibulaR']);
    add('boot', box, COL.boot, { a: P.LFT, b: P.LKN, groups: ['footL'] });
    add('boot', box, COL.boot, { a: P.RFT, b: P.RKN, groups: ['footR'] });
    add('stick', box, COL.ski, { a: P.LSKI_F, b: P.LSKI_B, w: 0.1, t: 0.03 });
    add('stick', box, COL.ski, { a: P.RSKI_F, b: P.RSKI_B, w: 0.1, t: 0.03 });
    limb(P.LPOLE_T, P.LPOLE_B, 0.013, COL.pole, []);
    limb(P.RPOLE_T, P.RPOLE_B, 0.013, COL.pole, []);

    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._Y = new THREE.Vector3(0, 1, 0);
  }

  // basis: local Y along `up`, local X close to `right`
  setBasis(mesh, up, right) {
    const y = this._y.copy(up).normalize();
    const x = this._x.copy(right).addScaledVector(y, -right.dot(y));
    if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(y, -y.x);
    x.normalize();
    const z = this._z.crossVectors(x, y);
    this._m.makeBasis(x, y, z);
    mesh.quaternion.setFromRotationMatrix(this._m);
  }

  update(X, dt) {
    const right = this._c.subVectors(X[P.RSH], X[P.LSH]);
    for (const s of this.segments) {
      const m = s.mesh;
      if (s.kind === 'limb') {
        const a = X[s.a], b = X[s.b];
        const d = this._a.subVectors(b, a);
        const len = d.length() || 1e-4;
        m.position.copy(a).addScaledVector(d, 0.5);
        m.quaternion.setFromUnitVectors(this._Y, d.divideScalar(len));
        m.scale.set(s.r, len, s.r);
      } else if (s.kind === 'joint') {
        m.position.copy(X[s.a]);
        m.scale.setScalar(s.r);
      } else if (s.kind === 'head') {
        m.position.copy(X[P.HEAD]);
        this.setBasis(m, this._a.subVectors(X[P.HEAD], X[P.NECK]), right);
      } else if (s.kind === 'torso') {
        const up = this._a.subVectors(X[P.NECK], X[P.PELVIS]);
        const len = up.length();
        m.position.copy(X[P.PELVIS]).addScaledVector(up, 0.55);
        this.setBasis(m, up, right);
        m.scale.set(0.38, len * 0.95, 0.24);
      } else if (s.kind === 'pelvis') {
        const hr = this._b.subVectors(X[P.RHIP], X[P.LHIP]);
        m.position.copy(X[P.LHIP]).add(X[P.RHIP]).multiplyScalar(0.5).add(X[P.PELVIS]).multiplyScalar(0.5);
        this.setBasis(m, this._a.subVectors(X[P.CHEST], X[P.PELVIS]), hr);
        m.scale.set(0.34, 0.2, 0.22);
      } else if (s.kind === 'boot') {
        m.position.copy(X[s.a]);
        const up = this._a.subVectors(X[s.b], X[s.a]);
        this.setBasis(m, up, right);
        m.position.addScaledVector(up.normalize(), 0.02);
        m.scale.set(0.13, 0.16, 0.3);
      } else if (s.kind === 'stick') {
        const a = X[s.a], b = X[s.b];
        const d = this._a.subVectors(b, a);
        const len = d.length();
        m.position.copy(a).addScaledVector(d, 0.5);
        // local Z along the ski, local Y towards upHint
        const z = this._z.copy(d).normalize();
        const x = this._x.crossVectors(this.upHint, z);
        if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
        x.normalize();
        const y = this._y.crossVectors(z, x);
        this._m.makeBasis(x, y, z);
        m.quaternion.setFromRotationMatrix(this._m);
        m.scale.set(s.w, s.t, len);
      }
      if (s.flash > 0) {
        s.flash = Math.max(0, s.flash - dt * 2.5);
        const mat = (s.tintMesh || m).material;
        mat.emissive.setRGB(s.flash * 0.9, 0, 0);
      }
    }
  }

  refreshTints(injuries) {
    const red = new THREE.Color(0x9b0000);
    for (const s of this.segments) {
      if (!s.groups.length) continue;
      let sev = 0;
      for (const g of s.groups) sev = Math.max(sev, injuries.severity(g));
      const mat = (s.tintMesh || s.mesh).material;
      mat.color.copy(s.base).lerp(red, sev * 0.8);
    }
  }

  flashGroup(id) {
    for (const s of this.segments) if (s.groups.includes(id)) s.flash = 1;
  }

  reset() {
    for (const s of this.segments) {
      const mat = (s.tintMesh || s.mesh).material;
      if (s.groups.length) mat.color.copy(s.base);
      s.flash = 0;
      if (mat.emissive) mat.emissive.setRGB(0, 0, 0);
    }
  }
}
