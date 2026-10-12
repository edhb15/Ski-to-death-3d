'use strict';
// Terrain: a long procedural mountain run going downhill along -Z.
// "d" is the distance down the slope (d = -z).

const TERRAIN = {
  xMin: -120, xMax: 120,
  dMin: -40, dMax: 1600,
  resX: 2, resD: 1.5,
};
TERRAIN.nx = Math.round((TERRAIN.xMax - TERRAIN.xMin) / TERRAIN.resX) + 1;
TERRAIN.nd = Math.round((TERRAIN.dMax - TERRAIN.dMin) / TERRAIN.resD) + 1;

const CLIFFS = [
  { d: 250, drop: 10, w: 2.5, name: 'LITTLE DROP' },
  { d: 520, drop: 22, w: 3, name: 'THE LEDGE' },
  { d: 820, drop: 40, w: 3.5, name: 'WIDOWMAKER' },
  { d: 1180, drop: 120, w: 5, name: 'THE ABYSS' },
];
const ABYSS = CLIFFS[CLIFFS.length - 1];
const FINISH_D = 1470;

const RAMPS = [
  { d: 140, x: 0, len: 9, h: 3.5, hw: 5 },
  { d: 380, x: -22, len: 9, h: 4, hw: 5 },
  { d: 660, x: 18, len: 10, h: 5, hw: 5 },
  { d: 1000, x: 0, len: 12, h: 7, hw: 6 },
  { d: 1110, x: -25, len: 9, h: 4, hw: 5 },
];

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function cliffEdge(c, x) {
  return c.d + Math.sin(x * 0.09 + c.d) * 2.5 + Math.sin(x * 0.23) * 0.8;
}

function rawHeight(x, d) {
  let h = d < 0 ? -0.1 * d : -0.34 * d + 9.6 * (1 - Math.exp(-d / 40));
  // gentler run-out at the bottom of the abyss, then a wall at the very end
  if (d > ABYSS.d + 10) h += 0.27 * (d - ABYSS.d - 10);
  if (d > 1490) h += (d - 1490) * (d - 1490) * 0.02;
  for (const c of CLIFFS) h -= c.drop * smoothstep(0, 1, (d - cliffEdge(c, x)) / c.w);
  // bumps / moguls
  const fade = d < 20 ? Math.max(0, d / 20) : 1;
  h += fade * (0.45 * Math.sin(x * 0.21) * Math.sin(d * 0.17) +
               0.8 * Math.sin(x * 0.045 + d * 0.031) +
               0.35 * Math.sin(d * 0.09 - x * 0.07));
  // valley walls
  const ax = Math.abs(x);
  if (ax > 55) h += (ax - 55) * (ax - 55) * 0.02;
  // jump ramps
  for (const r of RAMPS) {
    const u = d - (r.d - r.len);
    if (u < 0 || u > r.len + 1.5) continue;
    const lat = Math.abs(x - r.x);
    if (lat > r.hw + 2) continue;
    const p = u <= r.len ? r.h * Math.pow(u / r.len, 1.6) : r.h * (1 - (u - r.len) / 1.5);
    h += p * (1 - smoothstep(r.hw, r.hw + 2, lat));
  }
  return h;
}

const HGRID = new Float32Array(TERRAIN.nx * TERRAIN.nd);
for (let j = 0; j < TERRAIN.nd; j++) {
  const d = TERRAIN.dMin + j * TERRAIN.resD;
  for (let i = 0; i < TERRAIN.nx; i++) {
    HGRID[j * TERRAIN.nx + i] = rawHeight(TERRAIN.xMin + i * TERRAIN.resX, d);
  }
}

// Height of the rendered terrain at world (x, z).
function groundHeight(x, z) {
  const T = TERRAIN;
  let fx = (x - T.xMin) / T.resX;
  let fd = (-z - T.dMin) / T.resD;
  fx = Math.min(T.nx - 1.0001, Math.max(0, fx));
  fd = Math.min(T.nd - 1.0001, Math.max(0, fd));
  const i = Math.floor(fx), j = Math.floor(fd);
  const tx = fx - i, td = fd - j;
  const k = j * T.nx + i;
  const h00 = HGRID[k], h10 = HGRID[k + 1], h01 = HGRID[k + T.nx], h11 = HGRID[k + T.nx + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - td) + (h01 * (1 - tx) + h11 * tx) * td;
}

function groundNormal(x, z, out) {
  const e = 0.35;
  const hL = groundHeight(x - e, z), hR = groundHeight(x + e, z);
  const hB = groundHeight(x, z - e), hF = groundHeight(x, z + e);
  return out.set(hL - hR, 2 * e, hB - hF).normalize();
}

function buildTerrainMesh() {
  const T = TERRAIN;
  const count = T.nx * T.nd;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let j = 0; j < T.nd; j++) {
    for (let i = 0; i < T.nx; i++) {
      const k = j * T.nx + i;
      pos[k * 3] = T.xMin + i * T.resX;
      pos[k * 3 + 1] = HGRID[k];
      pos[k * 3 + 2] = -(T.dMin + j * T.resD);
    }
  }
  const idx = new Uint32Array((T.nx - 1) * (T.nd - 1) * 6);
  let p = 0;
  for (let j = 0; j < T.nd - 1; j++) {
    for (let i = 0; i < T.nx - 1; i++) {
      const a = j * T.nx + i, b = a + 1, c = a + T.nx, d = c + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  for (let k = 0; k < count; k++) {
    const ny = nrm[k * 3 + 1];
    const x = pos[k * 3], z = pos[k * 3 + 2];
    const snow = smoothstep(0.22, 0.36, ny);
    const n = 0.03 * Math.sin(x * 0.7 + z * 0.3) * Math.sin(z * 0.9);
    const rock = 0.36 + 0.06 * Math.sin(x * 1.3 + z * 2.1);
    col[k * 3] = rock * (1 - snow) + (0.93 + n) * snow;
    col[k * 3 + 1] = rock * (1 - snow) + (0.95 + n) * snow;
    col[k * 3 + 2] = (rock + 0.02) * (1 - snow) + (1.0 + n) * snow;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
