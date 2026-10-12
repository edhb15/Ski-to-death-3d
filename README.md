# Ski to Death 3D

A 3D ragdoll skiing game in plain HTML, CSS and JavaScript (Three.js, bundled in `lib/`).

Ski down a mountain full of trees, rocks, cabins, jump ramps and cliffs, and crash as hard as you can.
When you crash, the skier turns into a physics ragdoll. Every impact can break bones (all 206 are tracked),
and the game tells you how many you broke and whether it was enough to kill you.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Key | On the snow | In the air |
| --- | --- | --- |
| ← → / A D | steer | spin |
| ↑ / W | tuck (go faster) | front flip |
| ↓ / S | brake | back flip |
| Space | jump | |
| X | bail (throw yourself) | bail |
| R | restart | restart |

Touch buttons appear on phones and tablets.

## How injuries work

- The ragdoll has 16 body points. Each hit is measured by impact speed.
- Each body point is linked to bone groups (skull, ribs, femur, hand bones…), each with its own breaking
  threshold, so harder hits break more bones.
- Broken bones and blunt trauma add to an injury score. At 100% the skier dies, and the results screen
  names the cause of death.
- Broken neck and spine bones make the ragdoll floppier.

## Files

- `index.html`, `style.css`: page, HUD and menus
- `js/terrain.js`: procedural slope, cliffs and ramps
- `js/world.js`: trees, rocks, cabins, lift and collision shapes
- `js/ragdoll.js`: Verlet ragdoll physics and the skier model
- `js/injuries.js`: bone list, fracture and death logic
- `js/audio.js`: generated sound effects
- `js/game.js`: game loop, skiing physics, camera, UI
