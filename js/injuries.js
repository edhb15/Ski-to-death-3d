'use strict';
// All 206 bones of the human body, grouped. Each group knows how hard an
// impact (m/s) it takes to break, and how much each fracture hurts.

const BONE_GROUPS = (() => {
  const g = [];
  const add = (id, name, count, thr, step, lethal, cat) =>
    g.push({ id, name, count, thr, step, lethal, cat });
  add('cranium', 'Skull (cranium)', 8, 9, 3, 20, 'head');
  add('face', 'Facial bones', 14, 8, 1.8, 3, 'head');
  add('ossicles', 'Inner-ear bones', 6, 20, 2.5, 1, 'head');
  add('hyoid', 'Hyoid', 1, 12, 5, 4, 'neck');
  add('cervical', 'Neck vertebrae', 7, 10.5, 2.5, 30, 'neck');
  add('thoracic', 'Thoracic vertebrae', 12, 11.5, 2.2, 10, 'spine');
  add('lumbar', 'Lumbar vertebrae', 5, 11.5, 2.6, 10, 'spine');
  add('sacrum', 'Sacrum & coccyx', 2, 11, 4, 5, 'pelvis');
  add('ribs', 'Ribs', 24, 8, 1.1, 3, 'chest');
  add('sternum', 'Sternum', 1, 11, 5, 8, 'chest');
  for (const [s, S] of [['L', 'Left'], ['R', 'Right']]) {
    add('clavicle' + s, S + ' collarbone', 1, 8, 5, 2, 'limbs');
    add('scapula' + s, S + ' shoulder blade', 1, 12, 5, 3, 'chest');
    add('humerus' + s, S + ' upper arm (humerus)', 1, 9, 5, 4, 'limbs');
    add('radius' + s, S + ' radius', 1, 8, 5, 2, 'limbs');
    add('ulna' + s, S + ' ulna', 1, 8.5, 5, 2, 'limbs');
    add('hand' + s, S + ' hand bones', 27, 7, 1, 0.3, 'limbs');
    add('hip' + s, S + ' hip bone', 1, 12, 5, 14, 'pelvis');
    add('femur' + s, S + ' thigh bone (femur)', 1, 11, 5, 15, 'bleeding');
    add('patella' + s, S + ' kneecap', 1, 9, 5, 1, 'limbs');
    add('tibia' + s, S + ' shin bone (tibia)', 1, 10, 5, 5, 'limbs');
    add('fibula' + s, S + ' fibula', 1, 9.5, 5, 2, 'limbs');
    add('foot' + s, S + ' foot bones', 26, 9, 1, 0.3, 'limbs');
  }
  return g;
})();
const TOTAL_BONES = BONE_GROUPS.reduce((s, g) => s + g.count, 0); // 206

// Which bone groups each ragdoll particle can damage.
const PARTICLE_BONES = [
  ['cranium', 'face', 'ossicles'],            // 0 head
  ['cervical', 'hyoid'],                      // 1 neck
  ['ribs', 'sternum', 'thoracic'],            // 2 chest
  ['lumbar', 'sacrum', 'hipL', 'hipR'],       // 3 pelvis
  ['clavicleL', 'scapulaL', 'humerusL', 'ribs'], // 4 left shoulder
  ['clavicleR', 'scapulaR', 'humerusR', 'ribs'], // 5 right shoulder
  ['humerusL', 'radiusL', 'ulnaL'],           // 6 left elbow
  ['humerusR', 'radiusR', 'ulnaR'],           // 7 right elbow
  ['handL', 'radiusL', 'ulnaL'],              // 8 left hand
  ['handR', 'radiusR', 'ulnaR'],              // 9 right hand
  ['hipL', 'femurL'],                         // 10 left hip
  ['hipR', 'femurR'],                         // 11 right hip
  ['patellaL', 'femurL', 'tibiaL', 'fibulaL'],// 12 left knee
  ['patellaR', 'femurR', 'tibiaR', 'fibulaR'],// 13 right knee
  ['footL', 'tibiaL', 'fibulaL'],             // 14 left foot
  ['footR', 'tibiaR', 'fibulaR'],             // 15 right foot
];

// Blunt trauma (organs, brain) per particle: [weight, safe speed, category]
const PARTICLE_TRAUMA = [
  [1.0, 7, 'head'], [0.8, 8, 'neck'], [0.5, 9, 'chest'], [0.35, 10, 'pelvis'],
];
const LIMB_TRAUMA = [0.04, 12, 'limbs'];

const CAUSES = {
  head: 'Severe head trauma',
  neck: 'Broken neck',
  spine: 'Shattered spine',
  chest: 'Crushed chest',
  pelvis: 'Shattered pelvis & internal bleeding',
  bleeding: 'Massive blood loss (broken femur)',
  limbs: 'Multiple fractures & shock',
};

class Injuries {
  constructor() {
    this.groups = BONE_GROUPS.map(g => Object.assign({ broken: 0 }, g));
    this.byId = {};
    for (const g of this.groups) this.byId[g.id] = g;
    this.damage = 0;
    this.cat = {};
    this.dead = false;
    this.maxImpact = 0;
    this.hits = 0;
  }

  get totalBroken() {
    let n = 0;
    for (const g of this.groups) n += g.broken;
    return n;
  }

  addDamage(cat, amount) {
    this.damage += amount;
    this.cat[cat] = (this.cat[cat] || 0) + amount;
  }

  // Returns { events: [{group, n}], died: bool }
  impact(pi, speed) {
    const result = { events: [], died: false };
    if (speed > this.maxImpact) this.maxImpact = speed;
    if (speed > 6) this.hits++;
    const tr = PARTICLE_TRAUMA[pi] || LIMB_TRAUMA;
    if (speed > tr[1]) this.addDamage(tr[2], tr[0] * (speed - tr[1]) * (speed - tr[1]) * 0.35);
    for (const id of PARTICLE_BONES[pi]) {
      const g = this.byId[id];
      if (speed < g.thr || g.broken >= g.count) continue;
      const prob = Math.min(1, (speed - g.thr) / 5 + 0.3);
      if (Math.random() > prob) continue;
      let n = Math.max(1, Math.round((speed - g.thr) / g.step * (0.5 + Math.random())));
      n = Math.min(n, g.count - g.broken);
      g.broken += n;
      this.addDamage(g.cat, n * g.lethal);
      result.events.push({ group: g, n });
    }
    if (!this.dead && this.damage >= 100) {
      this.dead = true;
      result.died = true;
    }
    return result;
  }

  get causeOfDeath() {
    let best = 'limbs', v = -1;
    for (const k in this.cat) if (this.cat[k] > v) { v = this.cat[k]; best = k; }
    return CAUSES[best];
  }

  severity(id) {
    const g = this.byId[id];
    if (!g || !g.broken) return 0;
    return g.count === 1 ? 1 : Math.min(1, 0.35 + 0.65 * g.broken / g.count);
  }
}
