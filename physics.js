// Moteur physique de la conduite : Rapier (WebAssembly) avec un véhicule à quatre roues suspendues
// (lancer de rayons), une transmission à rapports et des colliders fixes pour la ville.
//
// Conventions : le corps rigide du châssis a l'avant en +z local (convention Rapier) ; le modèle
// 3D de la voiture, dont l'avant est en -z, est retourné de 180° à l'intérieur du châssis.

import * as THREE from "three";
import RAPIER from "./vendor/rapier/rapier.mjs";
import { SIDE, TILE, PERIOD, MARGIN, ROADS, HALF_ROAD, T, tileX, tileZ, road, tileAt } from "./city.js?v=7";

let ready = null;
export function initPhysics() {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export const CURB_HEIGHT = 0.16; // trottoirs Kenney : 0,02 unité × 10

/** Monde physique + colliders fixes du quartier (sol, trottoirs, îlots bâtis). */
export function createWorld(map) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;

  const fixed = (hx, hy, hz, x, y, z, friction = 1.0) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction), body);
    return body;
  };

  // Sol : une dalle très large sous tout le quartier (surface à y = 0).
  const half = (SIDE * TILE) / 2 + 300;
  fixed(half, 0.5, half, 0, -0.5, 0, 1.0);

  // Trottoirs : bandes latérales des tuiles de rue, quarts de coin des carrefours.
  const sw = (TILE / 2 - HALF_ROAD) / 2; // demi-largeur d'une bande de trottoir (0,7 m)
  const swCenter = HALF_ROAD + sw;
  for (let j = 0; j < SIDE; j++) {
    for (let i = 0; i < SIDE; i++) {
      const t = tileAt(map, i, j);
      const x = tileX(i), z = tileZ(j);
      if (t === T.NS) {
        fixed(sw, CURB_HEIGHT / 2, TILE / 2, x - swCenter, CURB_HEIGHT / 2, z);
        fixed(sw, CURB_HEIGHT / 2, TILE / 2, x + swCenter, CURB_HEIGHT / 2, z);
      } else if (t === T.EW) {
        fixed(TILE / 2, CURB_HEIGHT / 2, sw, x, CURB_HEIGHT / 2, z - swCenter);
        fixed(TILE / 2, CURB_HEIGHT / 2, sw, x, CURB_HEIGHT / 2, z + swCenter);
      } else if (t === T.CROSS) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) fixed(sw, CURB_HEIGHT / 2, sw, x + sx * swCenter, CURB_HEIGHT / 2, z + sz * swCenter);
      }
    }
  }

  // Îlots : un bloc plein par rectangle entre les rues (façades alignées sur le bord de la tuile).
  const cuts = [0, ...Array.from({ length: ROADS }, (_, k) => road(k)), SIDE - 1];
  for (let a = 0; a < cuts.length - 1; a++) {
    for (let b = 0; b < cuts.length - 1; b++) {
      const i0 = cuts[a] + (a === 0 ? 0 : 1), i1 = cuts[a + 1] - (a + 1 === cuts.length - 1 ? 0 : 1);
      const j0 = cuts[b] + (b === 0 ? 0 : 1), j1 = cuts[b + 1] - (b + 1 === cuts.length - 1 ? 0 : 1);
      if (i1 < i0 || j1 < j0) continue;
      // La dalle d'îlot est un trottoir surélevé ; les bâtiments sont en retrait de 0,4 m.
      const cx = (tileX(i0) + tileX(i1)) / 2, cz = (tileZ(j0) + tileZ(j1)) / 2;
      const hx = ((i1 - i0 + 1) * TILE) / 2, hz = ((j1 - j0 + 1) * TILE) / 2;
      fixed(hx, CURB_HEIGHT / 2, hz, cx, CURB_HEIGHT / 2, cz);
      fixed(hx - 0.4, 8, hz - 0.4, cx, 8, cz, 0.6);
    }
  }

  return world;
}

// ---------------------------------------------------------------------------
// Véhicule

const GEAR_RATIOS = [3.6, 2.2, 1.55, 1.18, 0.95, 0.8, 0.7];
const FINAL_DRIVE = 3.4;
const IDLE = 900;

/**
 * @param world  monde Rapier
 * @param visual résultat de loadVehicle (group, wheels, size, wheelRadius)
 * @param perf   { vmax (km/h), accel (m/s²), brake (m/s²), grip, mass (kg), drivetrain: "fwd"|"rwd"|"awd", redline }
 */
export function createVehicle(world, visual, perf, start) {
  const L = visual.size.z, W = visual.size.x, H = visual.size.y;
  const r = visual.wheelRadius || 0.33;
  const chassisHalf = { x: W / 2 - 0.05, y: Math.max(0.3, (H - r) / 2), z: L / 2 - 0.1 };
  const chassisY = r + chassisHalf.y - 0.05; // centre du châssis au repos

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, chassisY + 0.3, start.z)
      .setRotation(yawToQuat(start.yaw))
      .setLinearDamping(0.05)
      .setAngularDamping(1.5)
      .setCcdEnabled(true)
  );
  // Inertie d'un parallélépipède plein, centre de gravité abaissé pour limiter le roulis.
  const m = perf.mass, dx = chassisHalf.x * 2, dy = chassisHalf.y * 2, dz = chassisHalf.z * 2;
  const inertia = { x: (m / 12) * (dy * dy + dz * dz), y: (m / 12) * (dx * dx + dz * dz), z: (m / 12) * (dx * dx + dy * dy) };
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(chassisHalf.x, chassisHalf.y, chassisHalf.z)
      .setMassProperties(m, { x: 0, y: -chassisHalf.y * 0.5, z: 0 }, inertia, { w: 1, x: 0, y: 0, z: 0 })
      .setFriction(0.5)
      .setRestitution(0.1),
    body
  );

  const vehicle = world.createVehicleController(body);
  vehicle.indexUpAxis = 1;
  vehicle.setIndexForwardAxis = 2; // setter Rapier (nom historique)

  // Positions des roues : lues sur le modèle (repère du groupe, avant en -z) puis retournées (+z).
  const wheelInfo = [];
  visual.group.updateMatrixWorld(true);
  const groupInv = new THREE.Matrix4().copy(visual.group.matrixWorld).invert();
  const p = new THREE.Vector3();
  for (const w of visual.wheels.all) {
    w.getWorldPosition(p);
    p.applyMatrix4(groupInv);
    const isFront = visual.wheels.front.includes(w);
    wheelInfo.push({ mesh: w, local: new THREE.Vector3(-p.x, p.y, -p.z), isFront, baseY: w.position.y });
  }
  const restLength = 0.18;
  const travel = 0.14;
  wheelInfo.forEach((wi, k) => {
    // Point d'ancrage de la suspension : au-dessus de la roue, dans le repère du châssis.
    const anchor = { x: wi.local.x, y: wi.local.y + restLength - chassisY, z: wi.local.z };
    vehicle.addWheel(anchor, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, restLength, r);
    vehicle.setWheelSuspensionStiffness(k, 32);
    vehicle.setWheelMaxSuspensionTravel(k, travel);
    vehicle.setWheelSuspensionCompression(k, 3.2);
    vehicle.setWheelSuspensionRelaxation(k, 4.2);
    vehicle.setWheelFrictionSlip(k, 9 * perf.grip);
    vehicle.setWheelSideFrictionStiffness(k, 1.0);
    vehicle.setWheelMaxSuspensionForce(k, perf.mass * 9.81 * 3);
  });
  const frontIdx = wheelInfo.map((w, k) => (w.isFront ? k : -1)).filter((k) => k >= 0);
  const rearIdx = wheelInfo.map((w, k) => (w.isFront ? -1 : k)).filter((k) => k >= 0);
  const drivetrain = perf.drivetrain || "rwd";
  const driven = drivetrain === "fwd" ? frontIdx : drivetrain === "rwd" ? rearIdx : [...frontIdx, ...rearIdx];

  // Le modèle est retourné dans le châssis : avant du modèle (-z) vers +z du corps.
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI;
  inner.position.y = -chassisY;
  inner.add(visual.group);
  const root = new THREE.Group();
  root.add(inner);

  const redline = perf.redline || 7000;
  const state = {
    body, collider, vehicle, root, wheelInfo,
    gear: 1, rpm: IDLE, manual: false, speed: 0, forwardSpeed: 0, steer: 0, throttle: 0, brake: 0,
    handbrake: false, reverse: false, shiftTimer: 0, lastSpeed: 0, impact: 0, onGround: true, stopTimer: 0, wantForward: false,
    lights: false, indicator: 0, // -1 gauche, 1 droite
  };

  const q = new THREE.Quaternion(), fwd = new THREE.Vector3(), lin = new THREE.Vector3();

  function readState() {
    const rot = body.rotation();
    q.set(rot.x, rot.y, rot.z, rot.w);
    fwd.set(0, 0, 1).applyQuaternion(q);
    const v = body.linvel();
    lin.set(v.x, v.y, v.z);
    state.forwardSpeed = lin.dot(fwd);
    state.speed = Math.hypot(v.x, v.z);
    state.onGround = wheelInfo.some((_, k) => vehicle.wheelIsInContact(k));
  }

  function torqueCurve(rpmFrac) {
    // Couple plein à mi-régime, creux au ralenti, chute avant le rupteur.
    return 0.55 + 0.6 * Math.sin(Math.min(rpmFrac, 1) * Math.PI) - 0.15 * Math.max(0, rpmFrac - 0.85) * 6;
  }

  function autoShift(dt) {
    state.shiftTimer = Math.max(0, state.shiftTimer - dt);
    if (state.manual || state.shiftTimer > 0) return;
    const frac = state.rpm / redline;
    if (frac > 0.86 && state.gear < GEAR_RATIOS.length) {
      state.gear++;
      state.shiftTimer = 0.35;
    } else if (frac < 0.32 && state.gear > 1) {
      state.gear--;
      state.shiftTimer = 0.35;
    }
  }

  /** Une itération physique. inputs : { throttle 0-1, brake 0-1, steer -1..1, handbrake, shiftUp, shiftDown } */
  function step(dt, inputs) {
    readState();
    const kmh = Math.abs(state.forwardSpeed) * 3.6;

    // Marche arrière : frein maintenu à l'arrêt pendant 0,5 s → recul ; gaz en marche arrière → on
    // freine d'abord, puis on repart en avant une fois arrêté.
    if (inputs.brake > 0 && inputs.throttle === 0 && Math.abs(state.forwardSpeed) < 0.4 && !state.reverse) {
      state.stopTimer += dt;
      if (state.stopTimer > 0.5) state.reverse = true;
    } else if (!state.reverse) state.stopTimer = 0;
    if (state.reverse && inputs.throttle > 0) {
      state.wantForward = true;
      if (state.forwardSpeed > -0.4) {
        state.reverse = false;
        state.wantForward = false;
        state.stopTimer = 0;
      }
    } else state.wantForward = false;

    // Régime moteur : déduit de la vitesse et du rapport (embrayage "parfait").
    const ratio = GEAR_RATIOS[state.gear - 1] * FINAL_DRIVE;
    const wheelRps = Math.abs(state.forwardSpeed) / (2 * Math.PI * r);
    let rpm = wheelRps * ratio * 60;
    if (rpm < IDLE) rpm = IDLE + (state.reverse ? inputs.brake : inputs.throttle) * 1800 * (1 - Math.min(kmh / 20, 1));
    state.rpm = THREE.MathUtils.damp(state.rpm, Math.min(rpm, redline), 12, dt);
    autoShift(dt);
    if (inputs.shiftUp && state.manual && state.gear < GEAR_RATIOS.length) state.gear++;
    if (inputs.shiftDown && state.manual && state.gear > 1) state.gear--;

    // Direction : angle maximal qui diminue avec la vitesse, réponse lissée.
    const lock = 0.6 / (1 + kmh / 30);
    state.steer = THREE.MathUtils.damp(state.steer, inputs.steer * lock, 10, dt);
    for (const k of frontIdx) vehicle.setWheelSteering(k, state.steer); // Rapier : angle positif = à gauche

    // Force motrice : accélération nominale × courbe de couple × rapport, plafonnée à vmax par la traînée.
    const vmax = perf.vmax / 3.6;
    const gearBoost = Math.min(1.6, GEAR_RATIOS[state.gear - 1] / GEAR_RATIOS[2]);
    const frac = state.rpm / redline;
    let force = 0;
    const cut = state.shiftTimer > 0 ? 0.25 : 1; // coupure à l'embrayage
    if (state.reverse) {
      force = state.wantForward ? 0 : -inputs.brake * perf.mass * perf.accel * 0.45;
      if (state.forwardSpeed < -8) force = 0;
    } else if (inputs.throttle > 0 && frac < 1.02) {
      force = inputs.throttle * perf.mass * perf.accel * torqueCurve(frac) * gearBoost * cut;
      force *= Math.max(0, 1 - Math.pow(Math.abs(state.forwardSpeed) / vmax, 3));
    }
    // Traînée aérodynamique + roulement.
    const drag = 0.5 * 1.2 * 0.32 * 2.2 * state.forwardSpeed * Math.abs(state.forwardSpeed);
    const rolling = 0.012 * perf.mass * 9.81 * Math.sign(state.forwardSpeed);
    const resist = drag + rolling;
    const perWheel = (force - (Math.abs(state.forwardSpeed) > 0.3 ? resist : 0)) / driven.length;
    for (let k = 0; k < wheelInfo.length; k++) vehicle.setWheelEngineForce(k, driven.includes(k) ? perWheel : 0);

    // Freinage : pédale (répartie 60/40), frein moteur, frein à main sur l'arrière.
    const brakeForce = state.reverse ? (state.wantForward ? perf.mass * perf.brake * 0.5 : 0) : inputs.brake * perf.mass * perf.brake * 0.5;
    const engineBrake = inputs.throttle === 0 && !state.reverse ? perf.mass * 0.6 : 0;
    for (let k = 0; k < wheelInfo.length; k++) {
      const front = wheelInfo[k].isFront;
      let b = brakeForce * (front ? 0.6 : 0.4) + engineBrake * 0.25;
      if (inputs.handbrake && !front) b += perf.mass * 12;
      // À l'arrêt sans commande : maintien.
      if (inputs.throttle === 0 && inputs.brake === 0 && Math.abs(state.forwardSpeed) < 0.3) b += perf.mass * 2;
      vehicle.setWheelBrake(k, b);
    }

    vehicle.updateVehicle(dt);
    world.step();

    // Détection de choc : perte brutale de vitesse.
    readState();
    const loss = state.lastSpeed - state.speed;
    state.impact = loss > 2.5 ? Math.min(1, loss / 12) : Math.max(0, state.impact - dt * 2);
    state.lastSpeed = state.speed;
  }

  /** Copie la pose physique sur le modèle et anime les roues. */
  const tmpQ = new THREE.Quaternion();
  function sync(dt) {
    const t = body.translation(), rot = body.rotation();
    root.position.set(t.x, t.y, t.z);
    root.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    wheelInfo.forEach((wi, k) => {
      // Enfoncement de suspension : la roue descend/monte dans le repère du modèle.
      const len = vehicle.wheelSuspensionLength(k);
      const dy = restLength - (len ?? restLength);
      wi.mesh.position.y = wi.baseY - dy / visual.scale;
      wi.mesh.rotation.y = wi.isFront ? vehicle.wheelSteering(k) : 0;
      wi.mesh.rotation.x -= (state.forwardSpeed * dt) / r;
    });
  }

  function teleport(x, z, yaw) {
    body.setTranslation({ x, y: chassisY + 0.2, z }, true);
    body.setRotation(yawToQuat(yaw), true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    state.reverse = false;
    state.gear = 1;
  }

  /** Cap au sens du site : avant = (-sin yaw, -cos yaw). */
  function heading() {
    readState();
    return Math.atan2(-fwd.x, -fwd.z);
  }

  return { state, step, sync, teleport, heading, forward: fwd, body, root, chassisY, wheelRadius: r };
}

/** Quaternion d'un cap : l'avant du corps (+z) doit pointer vers (-sin yaw, -cos yaw). */
export function yawToQuat(yaw) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Corps cinématique pour une voiture du trafic (le joueur peut la heurter). */
export function createKinematicCar(world, length, width, height = 1.4) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, height / 2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, length / 2).setFriction(0.4), body);
  const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 1, 0);
  return {
    body,
    move(x, z, yaw) {
      body.setNextKinematicTranslation({ x, y: height / 2, z });
      q.setFromAxisAngle(axis, yaw + Math.PI);
      body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    },
  };
}
