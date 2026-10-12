'use strict';
(() => {
  const PHYS_DT = 1 / 120;
  const RAG_SUB = 4;
  const G = 9.81;
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------ renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  $('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const FOG = 0xcfe0f2;
  scene.fog = new THREE.Fog(FOG, 70, 480);
  scene.background = new THREE.Color(FOG);
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 3000);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d7fd6) }, bottom: { value: new THREE.Color(FOG) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = smoothstep(-0.05, 0.45, vP.y); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
  }));
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xdcecff, 0x6c7488, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  const SUN_OFFSET = new THREE.Vector3(-35, 70, 25);

  scene.add(buildTerrainMesh());
  populateWorld(scene);

  // falling snow
  const SNOW_N = 1800, SNOW_BOX = 60;
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW_N * 3);
  for (let i = 0; i < SNOW_N * 3; i++) snowPos[i] = (Math.random() - 0.5) * SNOW_BOX;
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85 }));
  snow.frustumCulled = false;
  scene.add(snow);

  const model = new SkierModel(scene);

  // blood splats on the snow
  const splatGeo = new THREE.CircleGeometry(1, 12); splatGeo.rotateX(-Math.PI / 2);
  const splatMat = new THREE.MeshBasicMaterial({ color: 0x8a0010, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const splats = [];

  // ------------------------------------------------------------ input
  const keys = {};
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    Space: 'jump', KeyX: 'bail', KeyR: 'restart', Enter: 'enter',
  };
  window.addEventListener('keydown', e => {
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (!keys[k]) onPress(k);
    keys[k] = true;
  });
  window.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
  document.querySelectorAll('#touch-controls [data-key]').forEach(btn => {
    const k = btn.dataset.key;
    const down = e => { e.preventDefault(); if (!keys[k]) onPress(k); keys[k] = true; btn.classList.add('on'); };
    const up = e => { e.preventDefault(); keys[k] = false; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });
  if (window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

  // ------------------------------------------------------------ state
  let state = 'menu';
  let timeScale = 1, slowmo = 0, shake = 0, acc = 0;
  let injuries = new Injuries();
  let ragdoll = null;
  let crashT = 0, stillT = 0, crashReason = '';
  const X = []; for (let i = 0; i < PARTICLE_COUNT; i++) X.push(new THREE.Vector3());
  const lastX = X.map(v => v.clone());
  const lastPos = new THREE.Vector3();

  const sk = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0,
    onGround: true, air: 0, pitch: 0, airYaw: 0, tuck: 0, lean: 0,
    normal: new THREE.Vector3(0, 1, 0), maxSpeed: 0, time: 0, bestAir: 0, tricks: 0,
  };

  const BEST_KEY = 'ski-to-death-3d-best';
  function loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || { bones: 0, score: 0, deaths: 0 }; }
    catch (e) { return { bones: 0, score: 0, deaths: 0 }; }
  }
  function saveBest(b) { try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ } }
  let best = loadBest();
  function showBest() {
    $('menu-best').textContent = best.bones ? `Personal record: ${best.bones} bones · ${best.score} pts · ${best.deaths} deaths` : '';
  }
  showBest();

  function resetRun() {
    sk.pos.set(0, groundHeight(0, 4), 4);
    sk.vel.set(0, 0, -2);
    sk.heading = 0; sk.onGround = true; sk.air = 0; sk.pitch = 0; sk.airYaw = 0;
    sk.tuck = 0; sk.lean = 0; sk.maxSpeed = 0; sk.time = 0; sk.bestAir = 0; sk.tricks = 0;
    groundNormal(sk.pos.x, sk.pos.z, sk.normal);
    injuries = new Injuries();
    ragdoll = null;
    crashT = 0; stillT = 0; timeScale = 1; slowmo = 0; shake = 0; acc = 0;
    model.reset();
    model.upHint.set(0, 1, 0);
    for (const s of splats) scene.remove(s);
    splats.length = 0;
    $('injury-feed').innerHTML = '';
    $('crash-hud').classList.add('hidden');
    $('dead-banner').classList.add('hidden');
    $('results').classList.add('hidden');
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('hud-stats').classList.remove('hidden');
    $('hint').classList.remove('hidden');
    updateCrashHud();
    computePose();
    for (let i = 0; i < PARTICLE_COUNT; i++) lastX[i].copy(X[i]);
    camPos.copy(sk.pos).add(new THREE.Vector3(0, 3, 8));
    state = 'skiing';
    document.body.classList.add('skiing');
  }

  function onPress(k) {
    Sfx.init();
    if (k === 'restart' && state !== 'menu') return resetRun();
    if (k === 'enter' && (state === 'menu' || state === 'results')) return resetRun();
    if (state === 'skiing') {
      if (k === 'jump' && sk.onGround) {
        sk.vel.addScaledVector(sk.normal, 5.2);
        takeOff();
      }
      if (k === 'bail') bail();
    }
  }
  $('start-btn').addEventListener('click', () => { Sfx.init(); resetRun(); });
  $('again-btn').addEventListener('click', () => { Sfx.init(); resetRun(); });

  // ------------------------------------------------------------ skier pose
  const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qRoll = new THREE.Quaternion();
  const qAlign = new THREE.Quaternion(), qBody = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
  const alignN = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpN = new THREE.Vector3();

  function computePose() {
    const t = sk.tuck;
    alignN.lerp(sk.onGround ? sk.normal : AY, 0.25).normalize();
    qAlign.setFromUnitVectors(AY, alignN);
    qYaw.setFromAxisAngle(AY, sk.heading);
    qPitch.setFromAxisAngle(AX, sk.pitch);
    qRoll.setFromAxisAngle(AZ, sk.lean);
    qBody.copy(qAlign).multiply(qYaw).multiply(qPitch).multiply(qRoll);
    const airArms = sk.onGround ? 0 : Math.min(1, sk.air * 3);
    for (let i = 0; i < BODY_COUNT; i++) {
      const a = POSE_NEUTRAL[i], b = POSE_TUCK[i];
      tmp.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      if (i === P.LHA || i === P.RHA || i === P.LEL || i === P.REL) {
        const side = (i === P.LHA || i === P.LEL) ? -1 : 1;
        tmp.x += side * airArms * (i >= P.LHA ? 0.35 : 0.15);
        tmp.y += airArms * (i >= P.LHA ? 0.3 : 0.12);
      }
      X[i].copy(tmp).applyQuaternion(qBody).add(sk.pos);
    }
    // skis
    const ski = (fi, bi, side) => {
      X[fi].set(side * 0.14, 0.03, -0.95).applyQuaternion(qBody).add(sk.pos);
      X[bi].set(side * 0.14, 0.03, 0.75).applyQuaternion(qBody).add(sk.pos);
    };
    ski(P.LSKI_F, P.LSKI_B, -1); ski(P.RSKI_F, P.RSKI_B, 1);
    // poles: grip at the hand, tip behind and below
    const pole = (ti, bi, hi, side) => {
      X[ti].copy(X[hi]);
      const h = (i => { const a = POSE_NEUTRAL[i], b = POSE_TUCK[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; })(hi);
      X[bi].set(h[0] + side * (0.06 + airArms * 0.4), Math.max(0.05, h[1] - 1.05) + airArms * 0.3, h[2] + 0.4).applyQuaternion(qBody).add(sk.pos);
    };
    pole(P.LPOLE_T, P.LPOLE_B, P.LHA, -1); pole(P.RPOLE_T, P.RPOLE_B, P.RHA, 1);
    model.upHint.set(0, 1, 0).applyQuaternion(qBody);
  }

  // ------------------------------------------------------------ skiing physics
  // true when the snow ahead drops away faster than gravity can bend our path (lips, cliffs)
  function groundFallsAway(look) {
    const hs = Math.hypot(sk.vel.x, sk.vel.z);
    if (hs < 1) return false;
    const dx = sk.vel.x / hs * look, dz = sk.vel.z / hs * look;
    const slope = (groundHeight(sk.pos.x + dx, sk.pos.z + dz) - groundHeight(sk.pos.x, sk.pos.z)) / look;
    return sk.vel.y - slope * hs > G * PHYS_DT * 3 + hs * 0.05;
  }
  function takeOff() {
    sk.onGround = false; sk.air = 0; sk.airYaw = 0; sk.pitch = 0;
    sk.flipLock = !!(keys.up || keys.down);
  }

  const fwd = new THREE.Vector3();
  function skierStep(dt) {
    const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    const speed0 = sk.vel.length();
    sk.time += dt;
    if (sk.onGround && groundFallsAway(1.0)) takeOff();
    if (sk.onGround) {
      groundNormal(sk.pos.x, sk.pos.z, sk.normal);
      const n = sk.normal;
      sk.heading += steer * (1.9 - Math.min(0.8, speed0 * 0.025)) * dt;
      sk.pitch = 0;
      // gravity along the slope
      sk.vel.y -= G * dt;
      sk.vel.addScaledVector(n, -sk.vel.dot(n));
      fwd.set(-Math.sin(sk.heading), 0, -Math.cos(sk.heading));
      fwd.addScaledVector(n, -fwd.dot(n)).normalize();
      let speed = sk.vel.length();
      if (speed > 0.3) {
        tmp.copy(sk.vel).divideScalar(speed);
        const align = tmp.dot(fwd);
        if (align > -0.2) {
          // carve: velocity follows the skis
          const carve = keys.down ? 2.2 : 5;
          tmp.lerp(fwd, 1 - Math.exp(-carve * dt)).normalize();
          speed -= (1 - align) * speed * 1.2 * dt;
        } else {
          sk.heading += Math.PI; // facing uphill, swing round
        }
        const mu = keys.down ? 0.55 : 0.045;
        speed = Math.max(0, speed - mu * G * n.y * dt);
        const drag = keys.up ? 0.0035 : keys.down ? 0.012 : 0.0065;
        speed -= drag * speed * speed * dt;
        sk.vel.copy(tmp).multiplyScalar(Math.max(0, speed));
      } else if (keys.up) {
        sk.vel.addScaledVector(fwd, 3 * dt);
      }
      if (keys.up && speed < 7) sk.vel.addScaledVector(fwd, 2.5 * dt); // skating
    } else {
      sk.air += dt;
      sk.vel.y -= G * dt;
      sk.vel.multiplyScalar(1 - 0.003 * sk.vel.length() * dt);
      // tuck/brake held through the takeoff doesn't count as a flip until released
      if (sk.flipLock && !keys.up && !keys.down) sk.flipLock = false;
      const flip = sk.flipLock ? 0 : (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      sk.pitch += flip * 5 * dt;
      sk.heading += steer * 4.5 * dt;
      sk.airYaw += steer * 4.5 * dt;
    }
    sk.tuck += ((keys.up && sk.onGround ? 1 : 0) - sk.tuck) * Math.min(1, dt * 6);
    sk.lean += (steer * 0.4 * Math.min(1, speed0 / 10) * (sk.onGround ? 1 : 0) - sk.lean) * Math.min(1, dt * 5);

    sk.pos.addScaledVector(sk.vel, dt);
    const gy = groundHeight(sk.pos.x, sk.pos.z);
    if (sk.pos.y <= gy && !sk.onGround && sk.air < 0.12) {
      // just launched: graze along the (concave) kicker without re-landing
      groundNormal(sk.pos.x, sk.pos.z, sk.normal);
      sk.pos.y = gy;
      const vn = sk.vel.dot(sk.normal);
      if (vn < 0) sk.vel.addScaledVector(sk.normal, -vn);
    } else if (sk.pos.y <= gy) {
      groundNormal(sk.pos.x, sk.pos.z, sk.normal);
      if (!sk.onGround) {
        const vn = sk.vel.dot(sk.normal);
        const k = Math.round(sk.pitch / (Math.PI * 2));
        const pitchErr = Math.abs(sk.pitch - k * Math.PI * 2);
        tmp.set(sk.vel.x, 0, sk.vel.z);
        fwd.set(-Math.sin(sk.heading), 0, -Math.cos(sk.heading));
        const hs = tmp.length();
        const dirOk = hs < 4 || tmp.divideScalar(hs).dot(fwd) > 0.5;
        sk.pos.y = gy;
        if (-vn > 14) return crash('Hard landing!');
        if (pitchErr > 0.75) return crash('Landed on your head!');
        if (!dirOk) return crash('Landed sideways!');
        if (sk.air > 0.6) {
          sk.bestAir = Math.max(sk.bestAir, sk.air);
          const spins = Math.round(Math.abs(sk.airYaw) / (Math.PI * 2));
          const parts = [];
          if (Math.abs(k) > 0) parts.push((Math.abs(k) > 1 ? Math.abs(k) + 'x ' : '') + (k < 0 ? 'FRONTFLIP' : 'BACKFLIP'));
          if (spins > 0) parts.push(spins * 360 + '°');
          trick(parts.length ? parts.join(' + ') + '!' : `${sk.air.toFixed(1)}s AIR`);
          sk.tricks += Math.abs(k) + spins;
        }
        sk.pitch = 0;
        sk.vel.addScaledVector(sk.normal, -vn);
      }
      sk.pos.y = gy;
      sk.onGround = true;
    } else if (sk.onGround) {
      if (!groundFallsAway(0.4) && sk.pos.y - gy < 0.3) sk.pos.y = gy;
      else takeOff();
    }
    // obstacles
    for (const o of nearbyObstacles(sk.pos.x, sk.pos.z)) {
      for (const hgt of [0.35, 1.0]) {
        tmp.copy(sk.pos); tmp.y += hgt;
        const pen = collideObstacle(o, tmp, 0.35, tmpN);
        if (pen <= 0) continue;
        const sp = sk.vel.length();
        if (sp > 4) return crash(o.kind === 'tree' ? 'You hugged a tree!' : o.kind === 'rock' ? 'Rock solid impact!' : o.kind === 'cabin' ? 'Knock knock!' : o.kind === 'snowman' ? 'Snowman revenge!' : 'Hit a lift pylon!');
        sk.pos.addScaledVector(tmpN, pen);
        const vn = sk.vel.dot(tmpN);
        if (vn < 0) sk.vel.addScaledVector(tmpN, -vn);
      }
    }
    const sp = sk.vel.length();
    sk.maxSpeed = Math.max(sk.maxSpeed, sp);
    if (-sk.pos.z > FINISH_D) finish();
  }

  // ------------------------------------------------------------ crashing
  function startRagdoll() {
    const h = PHYS_DT / RAG_SUB;
    // body velocity = skier velocity + the pose's own motion (spins/flips), minus any ground snapping
    const vels = X.map((x, i) => {
      const rel = tmp2.subVectors(x, lastX[i]).sub(sk.pos).add(lastPos).divideScalar(PHYS_DT).clone();
      if (rel.length() > 8) rel.setLength(8);
      return rel.add(sk.vel);
    });
    ragdoll = new Ragdoll(X, vels, h);
    model.upHint.set(0, 1, 0);
    crashT = 0; stillT = 0;
    state = 'crashing';
    document.body.classList.remove('skiing');
    $('crash-hud').classList.remove('hidden');
    $('hud-stats').classList.add('hidden');
    $('hint').classList.add('hidden');
    crashYaw = Math.atan2(sk.vel.x, sk.vel.z) + Math.PI; // camera behind the motion
  }

  function crash(reason) {
    crashReason = reason;
    if (!sk.onGround) sk.bestAir = Math.max(sk.bestAir, sk.air);
    trick(reason, 'bad');
    Sfx.boom();
    computePose(); // pose at the impact point, so the ragdoll inherits the real velocity
    startRagdoll();
  }

  function bail() {
    crashReason = 'Bailed out!';
    trick('BAIL!', 'bad');
    // throw the body forward and up
    lastPos.copy(sk.pos);
    for (let i = 0; i < PARTICLE_COUNT; i++) lastX[i].copy(X[i]);
    for (let i = 0; i < BODY_COUNT; i++) {
      const up = POSE_NEUTRAL[i][1];
      lastX[i].y -= (2 + up * 3) * PHYS_DT;
      fwd.set(-Math.sin(sk.heading), 0, -Math.cos(sk.heading));
      lastX[i].addScaledVector(fwd, -up * 3 * PHYS_DT);
    }
    startRagdoll();
  }

  function finish() {
    crashReason = 'Reached the bottom';
    state = 'results';
    document.body.classList.remove('skiing');
    showResults(true);
  }

  const feed = [];
  function onImpact(i, speed, pos) {
    if (state !== 'crashing') return;
    if (speed > 7) { Sfx.thud(Math.min(1, speed / 25)); shake = Math.max(shake, Math.min(0.6, speed * 0.02)); }
    if (i >= BODY_COUNT) return;
    if (speed > 13 && splats.length < 80) {
      const s = new THREE.Mesh(splatGeo, splatMat);
      const gy = groundHeight(pos.x, pos.z);
      if (Math.abs(pos.y - gy) < 0.5) {
        s.position.set(pos.x, gy + 0.03, pos.z);
        s.scale.setScalar(0.2 + Math.min(0.9, (speed - 13) * 0.05) * Math.random() + 0.15);
        groundNormal(pos.x, pos.z, tmpN);
        s.quaternion.setFromUnitVectors(AY, tmpN);
        scene.add(s); splats.push(s);
      }
    }
    const res = injuries.impact(i, speed);
    for (const ev of res.events) {
      const g = ev.group;
      floatText(pos, `CRACK! ${g.name}${ev.n > 1 ? ' ×' + ev.n : ''}`, ev.n > 3 || g.lethal >= 10 ? 'big' : '');
      addFeed(`${g.name}${ev.n > 1 ? ' ×' + ev.n : ''}`);
      Sfx.crack(Math.min(1, 0.5 + ev.n * 0.1));
      model.flashGroup(g.id);
      slowmo = Math.max(slowmo, g.lethal >= 10 || ev.n >= 4 ? 0.7 : 0.35);
      if (g.id === 'cervical') ragdoll.weaken('neck', 0.04);
      if (g.id === 'thoracic' || g.id === 'lumbar') ragdoll.weaken('spine', 0.08);
    }
    if (res.events.length) model.refreshTints(injuries);
    if (res.died) {
      $('dead-banner').classList.remove('hidden');
      $('dead-cause').textContent = injuries.causeOfDeath;
      slowmo = 1.2;
    }
    updateCrashHud();
  }

  function addFeed(text) {
    const li = document.createElement('li');
    li.textContent = '✖ ' + text;
    const ul = $('injury-feed');
    ul.prepend(li);
    while (ul.children.length > 7) ul.lastChild.remove();
  }

  function updateCrashHud() {
    $('crash-bones').textContent = injuries.totalBroken;
    const pct = Math.min(100, Math.round(injuries.damage));
    $('death-fill').style.width = pct + '%';
    $('death-label').textContent = injuries.dead ? '☠ DEAD' : `INJURY ${pct}%`;
    $('death-fill').classList.toggle('dead', injuries.dead);
    if (injuries.dead) $('dead-cause').textContent = injuries.causeOfDeath;
  }

  const floaters = $('floaters');
  function floatText(pos, text, cls) {
    const v = pos.clone().project(camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'floater ' + (cls || '');
    el.textContent = text;
    el.style.left = ((v.x + 1) / 2 * window.innerWidth + (Math.random() - 0.5) * 80) + 'px';
    el.style.top = ((1 - v.y) / 2 * window.innerHeight + (Math.random() - 0.5) * 40) + 'px';
    floaters.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  let trickTimer = null;
  function trick(text, cls) {
    const el = $('trick-text');
    el.textContent = text;
    el.className = 'show ' + (cls || '');
    clearTimeout(trickTimer);
    trickTimer = setTimeout(() => { el.className = ''; }, 1400);
  }

  // ------------------------------------------------------------ results
  function showResults(noCrash) {
    $('hud').classList.add('hidden');
    const inj = injuries;
    const broken = inj.totalBroken;
    const dist = Math.max(0, Math.round(-sk.pos.z));
    const score = Math.round(broken * 10 + inj.damage * 2 + sk.maxSpeed * 3.6 + sk.tricks * 50);
    $('res-verdict').textContent = inj.dead ? '☠ FATAL' : (noCrash ? '🙄 YOU SURVIVED THE RUN' : '🩹 SURVIVED');
    $('res-verdict').className = inj.dead ? 'dead' : 'alive';
    $('res-sub').textContent = inj.dead
      ? `Cause of death: ${inj.causeOfDeath}`
      : noCrash ? 'Not a single scratch. That is not how this game works.'
        : `Injury severity ${Math.round(inj.damage)}% — not enough to kill you. Try harder!`;
    $('res-reason').textContent = crashReason;
    $('res-bones').textContent = broken;
    $('res-stats').innerHTML = [
      ['Score', score],
      ['Top speed', Math.round(sk.maxSpeed * 3.6) + ' km/h'],
      ['Hardest impact', Math.round(inj.maxImpact * 3.6) + ' km/h'],
      ['Distance', dist + ' m'],
      ['Longest air', sk.bestAir.toFixed(1) + ' s'],
      ['Injury severity', Math.round(inj.damage) + '%'],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const list = inj.groups.filter(g => g.broken).sort((a, b) => b.broken * b.lethal - a.broken * a.lethal);
    $('res-list').innerHTML = list.length
      ? list.map(g => `<li><span>${g.name}</span><b>${g.broken}/${g.count}</b></li>`).join('')
      : '<li class="none">No broken bones. Pathetic.</li>';
    drawSkeleton(inj);
    if (inj.dead) best.deaths++;
    let rec = '';
    if (broken > best.bones) { best.bones = broken; rec = '🏆 New record for broken bones!'; }
    if (score > best.score) { best.score = score; rec = rec || '🏆 New high score!'; }
    saveBest(best);
    $('res-record').textContent = rec;
    showBest();
    $('results').classList.remove('hidden');
  }

  function drawSkeleton(inj) {
    const col = id => {
      const s = inj.severity(id);
      return s === 0 ? '#ece6d6' : s < 0.7 ? '#ff9a3c' : '#ff2d2d';
    };
    const cols = ids => {
      let m = 0;
      for (const id of ids) m = Math.max(m, inj.severity(id));
      return m === 0 ? '#ece6d6' : m < 0.7 ? '#ff9a3c' : '#ff2d2d';
    };
    const L = (x1, y1, x2, y2, c, w = 7) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
    let s = '';
    // patient's left is on the viewer's right
    s += `<circle cx="100" cy="38" r="22" fill="${cols(['cranium', 'ossicles'])}"/>`;
    s += `<path d="M86 46 Q100 70 114 46 L110 58 Q100 66 90 58Z" fill="${col('face')}"/>`;
    s += `<circle cx="92" cy="36" r="5" fill="#222"/><circle cx="108" cy="36" r="5" fill="#222"/>`;
    s += L(100, 62, 100, 82, col('cervical'), 8);
    s += L(100, 86, 100, 156, col('thoracic'), 8);
    s += L(100, 158, 100, 186, col('lumbar'), 9);
    for (let i = 0; i < 6; i++) {
      const y = 96 + i * 10, w = 30 - Math.abs(i - 2) * 3;
      s += `<path d="M100 ${y} Q${100 - w} ${y + 2} ${100 - w + 4} ${y + 10}" stroke="${col('ribs')}" stroke-width="4" fill="none"/>`;
      s += `<path d="M100 ${y} Q${100 + w} ${y + 2} ${100 + w - 4} ${y + 10}" stroke="${col('ribs')}" stroke-width="4" fill="none"/>`;
    }
    s += L(100, 90, 100, 136, col('sternum'), 6);
    for (const [S, d] of [['R', -1], ['L', 1]]) {
      const x = v => 100 + d * v;
      s += L(x(4), 86, x(34), 88, col('clavicle' + S), 6);
      s += `<path d="M${x(24)} 90 L${x(38)} 92 L${x(28)} 118Z" fill="${col('scapula' + S)}"/>`;
      s += L(x(38), 92, x(46), 158, col('humerus' + S), 8);
      s += L(x(44), 162, x(52), 222, col('radius' + S), 5);
      s += L(x(50), 162, x(58), 220, col('ulna' + S), 5);
      s += `<ellipse cx="${x(57)}" cy="236" rx="9" ry="13" fill="${col('hand' + S)}"/>`;
      s += `<path d="M${x(2)} 186 Q${x(34)} 168 ${x(30)} 200 Q${x(20)} 212 ${x(4)} 206Z" fill="${col('hip' + S)}"/>`;
      s += L(x(22), 206, x(20), 292, col('femur' + S), 10);
      s += `<circle cx="${x(20)}" cy="298" r="6" fill="${col('patella' + S)}"/>`;
      s += L(x(17), 306, x(17), 372, col('tibia' + S), 8);
      s += L(x(26), 308, x(25), 370, col('fibula' + S), 4);
      s += `<ellipse cx="${x(22)}" cy="384" rx="13" ry="7" fill="${col('foot' + S)}"/>`;
    }
    s += `<path d="M94 186 L106 186 L100 204Z" fill="${col('sacrum')}"/>`;
    s += `<text x="20" y="390" fill="#888" font-size="14">R</text><text x="172" y="390" fill="#888" font-size="14">L</text>`;
    $('res-skeleton').innerHTML = s;
  }

  // ------------------------------------------------------------ camera / loop
  const camPos = new THREE.Vector3(0, 10, 10);
  const camLook = new THREE.Vector3();
  let crashYaw = 0;
  const desired = new THREE.Vector3(), lookT = new THREE.Vector3();

  function updateCamera(dt) {
    let target;
    if (state === 'skiing' || state === 'menu') {
      target = sk.pos;
      tmp.set(sk.vel.x, 0, sk.vel.z);
      if (tmp.lengthSq() < 4) tmp.set(-Math.sin(sk.heading), 0, -Math.cos(sk.heading));
      tmp.normalize();
      const sp = sk.vel.length();
      const back = 6 + sp * 0.06;
      desired.copy(sk.pos).addScaledVector(tmp, -back);
      desired.y = Math.max(desired.y, sk.pos.y) + 2.6;
      lookT.copy(sk.pos).addScaledVector(tmp, 4); lookT.y += 1;
      if (state === 'menu') {
        const a = performance.now() * 0.00015;
        desired.set(sk.pos.x + Math.sin(a) * 9, sk.pos.y + 3.5, sk.pos.z + Math.cos(a) * 9);
        lookT.copy(sk.pos); lookT.y += 1;
      }
    } else {
      target = ragdoll ? ragdoll.p[P.PELVIS].pos : sk.pos;
      crashYaw += dt * 0.25;
      desired.set(target.x + Math.sin(crashYaw) * 6.5, target.y + 2.8, target.z + Math.cos(crashYaw) * 6.5);
      lookT.copy(target);
    }
    const k = 1 - Math.exp(-(state === 'skiing' ? 6 : 3.5) * dt);
    camPos.lerp(desired, k);
    const minY = groundHeight(camPos.x, camPos.z) + 1.2;
    if (camPos.y < minY) camPos.y = minY;
    camLook.lerp(lookT, Math.min(1, k * 2));
    camera.position.copy(camPos);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake = Math.max(0, shake - dt * 1.5);
    }
    camera.lookAt(camLook);
    sun.position.copy(target).add(SUN_OFFSET);
    sun.target.position.copy(target);
    sky.position.copy(camera.position);
  }

  function updateSnow(dt) {
    const a = snowGeo.attributes.position.array;
    const c = camera.position;
    for (let i = 0; i < SNOW_N; i++) {
      const k = i * 3;
      a[k + 1] -= dt * (1.2 + (i % 7) * 0.15);
      a[k] += Math.sin(i + performance.now() * 0.0005) * dt * 0.3;
      for (let j = 0; j < 3; j++) {
        const rel = a[k + j] - c.getComponent(j);
        if (rel < -SNOW_BOX / 2) a[k + j] += SNOW_BOX; else if (rel > SNOW_BOX / 2) a[k + j] -= SNOW_BOX;
      }
    }
    snowGeo.attributes.position.needsUpdate = true;
  }

  function physicsStep() {
    if (state === 'skiing') {
      for (let i = 0; i < PARTICLE_COUNT; i++) lastX[i].copy(X[i]);
      lastPos.copy(sk.pos);
      skierStep(PHYS_DT);
      if (state === 'skiing') computePose();
    } else if (state === 'crashing' || (state === 'results' && ragdoll)) {
      ragdoll.step(RAG_SUB, onImpact);
      for (let i = 0; i < PARTICLE_COUNT; i++) X[i].copy(ragdoll.p[i].pos);
      if (state === 'crashing') {
        crashT += PHYS_DT;
        stillT = ragdoll.maxBodySpeed() < 0.8 ? stillT + PHYS_DT : 0;
        if (stillT > 1.2 || crashT > 16) {
          state = 'results';
          showResults(false);
        }
      }
    }
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (slowmo > 0) { slowmo -= dt; timeScale += (0.22 - timeScale) * Math.min(1, dt * 12); }
    else timeScale += (1 - timeScale) * Math.min(1, dt * 4);
    if (state !== 'menu') {
      acc += dt * timeScale;
      let n = 0;
      while (acc >= PHYS_DT && n < 12) { physicsStep(); acc -= PHYS_DT; n++; }
      if (n >= 12) acc = 0;
    } else {
      computePose();
    }
    model.update(X, dt);
    updateCamera(dt);
    updateSnow(dt);

    if (state === 'skiing') {
      const kmh = Math.round(sk.vel.length() * 3.6);
      $('hud-speed').textContent = kmh;
      $('hud-dist').textContent = Math.max(0, Math.round(-sk.pos.z));
      $('hud-air').textContent = sk.onGround ? '0.0' : sk.air.toFixed(1);
      Sfx.setWind(sk.vel.length());
      const nextCliff = CLIFFS.find(c => c.d > -sk.pos.z);
      $('hud-cliff').textContent = nextCliff ? `${nextCliff.name} (${nextCliff.drop} m) in ${Math.round(nextCliff.d + sk.pos.z)} m` : '';
    } else if (ragdoll) {
      Sfx.setWind(state === 'crashing' ? ragdoll.maxBodySpeed() * 0.7 : 0);
    } else Sfx.setWind(0);
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // initial menu backdrop
  sk.pos.set(0, groundHeight(0, 4), 4);
  groundNormal(0, 4, sk.normal);
  computePose();
  requestAnimationFrame(frame);
  // debug / testing hook
  window.__game = {
    get state() { return state; }, get reason() { return crashReason; }, sk, keys, onPress, resetRun,
    injuries: () => injuries,
    simulate(sec) { for (let i = 0; i < sec / PHYS_DT; i++) physicsStep(); },
  };
})();
