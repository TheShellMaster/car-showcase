import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CARS, carFromLocation, rememberCar } from "./cars.js?v=1";
import { loadVehicle, animateWheels } from "./vehicles.js?v=3";
import { buildCity, updateLOD, isDrivable, tileOf, tileAt, tileX, tileZ, road, T, TILE, SIDE, ROADS, LANE, HALF_ROAD, PERIOD } from "./city.js?v=7";

// ---------------------------------------------------------------------------
// DOM

const canvas = document.getElementById("scene");
const loaderBar = document.getElementById("loader-bar");
const loaderText = document.getElementById("loader-text");
const startEl = document.getElementById("start");
const hudSpeed = document.getElementById("hud-speed");
const hudGear = document.getElementById("hud-gear");
const hudRpm = document.getElementById("hud-rpm");
const hudCar = document.getElementById("hud-car");
const soundToggle = document.getElementById("sound-toggle");
const cameraToggle = document.getElementById("camera-toggle");
const minimap = document.getElementById("minimap");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

const fail = (message) => {
  loaderText.textContent = message;
  loaderBar.style.width = "0%";
};
window.addEventListener("error", (e) => fail("Une erreur a interrompu la conduite : " + (e.message || "erreur inconnue") + ". Voir la page Documentation, section Dépannage."), { once: true });

if (!document.body.classList.contains("no-webgl")) boot();

async function boot() {
  const carData = carFromLocation();
  rememberCar(carData.id);
  document.title = `Conduire la ${carData.brand} ${carData.model} — La Collection`;
  if (hudCar) hudCar.textContent = `${carData.brand} ${carData.model}`;
  document.querySelectorAll("[data-car-name]").forEach((el) => (el.textContent = `${carData.brand} ${carData.model}`));
  document.querySelectorAll("[data-back-studio]").forEach((a) => (a.href = `index.html?car=${carData.id}`));

  // ---------------------------------------------------------------------------
  // Rendu

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Ombres : désactivées sur les écrans tactiles (puces mobiles), carte réduite ailleurs.
  renderer.shadowMap.enabled = finePointer;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0xd9dee6);
  scene.background = fogColor;
  scene.fog = new THREE.Fog(fogColor, 70, 330);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1200);

  // Ciel en dégradé, attaché à la caméra.
  const sky = (() => {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x8fa6c4), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 900, 0, 1);
      c.copy(fogColor).lerp(top, Math.pow(t, 0.55));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false }));
    scene.add(mesh);
    return mesh;
  })();

  scene.add(new THREE.HemisphereLight(0xd6dde8, 0x7d8a6d, 0.75));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 140;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -38;
  sun.shadow.camera.right = sun.shadow.camera.top = 38;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const sunOffset = new THREE.Vector3(30, 48, 22);

  // ---------------------------------------------------------------------------
  // Ville

  loaderText.textContent = "Construction du quartier";
  loaderBar.style.width = "15%";
  const world = new THREE.Group();
  scene.add(world);
  const city = await buildCity(world, { seed: 7 });
  const map = city.map;
  loaderBar.style.width = "55%";

  // ---------------------------------------------------------------------------
  // Voiture du joueur

  loaderText.textContent = `Préparation de la ${carData.brand} ${carData.model}`;
  const player = await loadVehicle({ ...carData.vehicle, paint: carData.paint, accent: carData.accent });
  const carRoot = new THREE.Group();
  const bodyPivot = new THREE.Group(); // roulis / tangage sans toucher la pose
  bodyPivot.add(player.group);
  carRoot.add(bodyPivot);
  scene.add(carRoot);
  loaderBar.style.width = "70%";

  const PERF = carData.drive;
  const CAR = {
    halfWidth: player.size.x / 2,
    halfLength: player.size.z / 2,
    wheelbase: player.size.z * 0.58,
    vmax: PERF.vmax / 3.6,
    reverseMax: 7,
    accel: PERF.accel,
    brake: PERF.brake,
    grip: PERF.grip,
  };

  // Départ : au milieu de la rue centrale ouest-est, voie de droite, face à l'est.
  const startJ = road(2), startI = road(0) + 2;
  const car = { x: tileX(startI), z: tileZ(startJ) + LANE, yaw: -Math.PI / 2, v: 0, accel: 0, steer: 0, hitFlash: 0, dist: 0 };

  function resetCar() {
    // Remet la voiture sur la voie la plus proche, dans le sens du cap actuel.
    const [i, j] = tileOf(car.x, car.z);
    const t = tileAt(map, i, j);
    if (t === T.NS || t === T.CROSS) {
      const dir = Math.cos(car.yaw) < 0 ? 1 : -1; // vers +z (sud) si yaw ≈ π
      car.x = tileX(i) + (dir > 0 ? -LANE : LANE);
      car.yaw = dir > 0 ? Math.PI : 0;
    } else if (t === T.EW) {
      const dir = -Math.sin(car.yaw) >= 0 ? 1 : -1; // vers +x
      car.z = tileZ(j) + (dir > 0 ? LANE : -LANE);
      car.yaw = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      car.x = tileX(startI);
      car.z = tileZ(startJ) + LANE;
      car.yaw = -Math.PI / 2;
    }
    car.v = 0;
    car.steer = 0;
  }

  // ---------------------------------------------------------------------------
  // Trafic autonome : des voitures de la collection qui suivent les voies et respectent les feux.

  loaderText.textContent = "Mise en place du trafic";
  const TRAFFIC_COUNT = finePointer ? 26 : 16;
  const traffic = [];
  const trafficSpecs = CARS.filter((c) => c.id !== carData.id);
  const extra = [
    { vehicle: { src: "assets/cars/q-taxi.glb", kind: "quaternius", length: 4.4 }, paint: "#f2c319" },
    { vehicle: { src: "assets/cars/kenney/van.glb", kind: "kenney", length: 4.9 }, paint: "#d8dbe0" },
    { vehicle: { src: "assets/cars/kenney/delivery.glb", kind: "kenney", length: 5.4 }, paint: "#2f6f4e" },
    { vehicle: { src: "assets/cars/q-police.glb", kind: "quaternius", length: 4.6 }, paint: "#e8ecf0" },
  ];
  const palette = ["#d8dbe0", "#2b2e33", "#8b9099", "#9c1f28", "#1f3a6d", "#e0521c", "#c9b79c", "#3b5a3a", "#e8ecf0", "#5a3a7a"];
  const rnd = (n) => Math.floor(Math.random() * n);

  // Graphe : nœuds = carrefours (a, b) ; on roule à droite, voie décalée de LANE.
  // Directions : 0 = vers +z (sud), 1 = vers -x (ouest), 2 = vers -z (nord), 3 = vers +x (est).
  const DIRV = [
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 0],
  ];
  const yawOf = (d) => [Math.PI, Math.PI / 2, 0, -Math.PI / 2][d]; // avant = (-sin yaw, -cos yaw)
  // Décalage de voie à droite du sens de marche.
  const laneOffset = (d) => {
    const [dx, dz] = DIRV[d];
    return [-dz * LANE, dx * LANE]; // droite de (dx, dz) dans un repère x est / z sud
  };

  // Chemin d'un carrefour au suivant : segment droit, puis traversée (tout droit ou virage en arc).
  function segmentPath(a, b, d, nextD) {
    const pts = [];
    const [ox, oz] = laneOffset(d);
    const [nox, noz] = laneOffset(nextD);
    const ax = tileX(road(a)), az = tileZ(road(b));
    const [dx, dz] = DIRV[d];
    const bx = ax + dx * PERIOD * TILE, bz = az + dz * PERIOD * TILE;
    // Sortie du carrefour A jusqu'à l'entrée de B (bord du carrefour à HALF_ROAD + 1).
    const start = HALF_ROAD + 1, len = PERIOD * TILE - 2 * start;
    for (let s = 0; s <= len; s += 2.5) pts.push([ax + dx * (start + s) + ox, az + dz * (start + s) + oz]);
    // Traversée de B.
    if (nextD === d) {
      for (let s = -start + 2.5; s <= start; s += 2.5) pts.push([bx + dx * s + ox, bz + dz * s + oz]);
    } else {
      // Arc entre le point d'entrée et le point de sortie.
      const inX = bx - dx * start + ox, inZ = bz - dz * start + oz;
      const [ndx, ndz] = DIRV[nextD];
      const outX = bx + ndx * start + nox, outZ = bz + ndz * start + noz;
      // Contrôle : intersection des deux directions (virage quadratique).
      const proj = (outX - inX) * dx + (outZ - inZ) * dz;
      const cX = inX + dx * proj, cZ = inZ + dz * proj;
      const n = 8;
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        pts.push([u * u * inX + 2 * u * t * cX + t * t * outX, u * u * inZ + 2 * u * t * cZ + t * t * outZ]);
      }
    }
    return pts;
  }

  function chooseNext(a, b, d) {
    // Tout droit de préférence ; tourner aux bords ; jamais de demi-tour.
    const options = [d, (d + 1) % 4, (d + 3) % 4].filter((nd) => {
      const [dx, dz] = DIRV[nd];
      const na = a + dx, nb = b + dz;
      return na >= 0 && na < ROADS && nb >= 0 && nb < ROADS;
    });
    const weights = options.map((nd) => (nd === d ? 0.6 : 0.2));
    let r = Math.random() * weights.reduce((s, w) => s + w, 0);
    for (let k = 0; k < options.length; k++) {
      r -= weights[k];
      if (r <= 0) return options[k];
    }
    return options[options.length - 1];
  }

  async function spawnTraffic() {
    const loads = [];
    for (let n = 0; n < TRAFFIC_COUNT; n++) {
      const useExtra = Math.random() < 0.3;
      const spec = useExtra ? extra[rnd(extra.length)] : trafficSpecs[rnd(trafficSpecs.length)];
      const paint = useExtra ? spec.paint : Math.random() < 0.5 ? spec.paint : palette[rnd(palette.length)];
      loads.push(
        loadVehicle({ ...spec.vehicle, paint }).then((v) => {
          const a = rnd(ROADS), b = rnd(ROADS);
          let d = rnd(4);
          // Direction valide depuis (a, b).
          for (let k = 0; k < 4 && (a + DIRV[d][0] < 0 || a + DIRV[d][0] >= ROADS || b + DIRV[d][1] < 0 || b + DIRV[d][1] >= ROADS); k++) d = (d + 1) % 4;
          const nextD = chooseNext(a + DIRV[d][0], b + DIRV[d][1], d);
          const path = segmentPath(a, b, d, nextD);
          const ai = {
            v, a, b, d, nextD, path, idx: Math.floor(Math.random() * (path.length * 0.5)),
            speed: 0, cruise: 9 + Math.random() * 4, x: 0, z: 0, yaw: yawOf(d), length: spec.vehicle.length, waiting: 0,
          };
          [ai.x, ai.z] = path[ai.idx];
          // Évite de naître sur une autre voiture ou sur le joueur.
          for (let tries = 0; tries < 12; tries++) {
            const tooClose = traffic.some((o) => Math.hypot(o.x - ai.x, o.z - ai.z) < 9) || Math.hypot(car.x - ai.x, car.z - ai.z) < 25;
            if (!tooClose) break;
            ai.idx = Math.floor(Math.random() * (path.length * 0.6));
            [ai.x, ai.z] = path[ai.idx];
          }
          scene.add(v.group);
          traffic.push(ai);
        })
      );
    }
    await Promise.all(loads);
  }
  await spawnTraffic();
  loaderBar.style.width = "95%";

  // Le feu qui concerne une voiture arrivant au carrefour B dans la direction d.
  function lightFor(ai) {
    const [dx, dz] = DIRV[ai.d];
    const it = city.intersectionAt(road(ai.a + dx), road(ai.b + dz));
    if (!it) return "green";
    return ai.d === 0 || ai.d === 2 ? it.ns : it.ew;
  }

  function stepTraffic(dt) {
    for (const ai of traffic) {
      // Cible : point suivant du chemin.
      const target = ai.path[Math.min(ai.idx + 1, ai.path.length - 1)];
      const tx = target[0] - ai.x, tz = target[1] - ai.z;
      const distT = Math.hypot(tx, tz);

      // Feu : la traversée commence à l'index où le segment droit finit.
      const straightCount = Math.floor((PERIOD * TILE - 2 * (HALF_ROAD + 1)) / 2.5) + 1;
      const beforeCross = ai.idx < straightCount - 1;
      const distToCross = beforeCross ? (straightCount - 1 - ai.idx) * 2.5 : 999;
      const light = lightFor(ai);
      let want = ai.cruise;
      if (beforeCross && light !== "green" && distToCross < 14) {
        // S'arrête à la ligne (les 4 derniers mètres), sauf si déjà engagé à l'orange.
        want = distToCross < 4 ? 0 : Math.min(want, distToCross * 0.6);
      }

      // Véhicule devant (trafic ou joueur) : on garde ses distances.
      const fx = -Math.sin(ai.yaw), fz = -Math.cos(ai.yaw);
      // Seuls les véhicules qui roulent dans le même sens comptent (le trafic perpendiculaire est
      // géré par les feux) ; sinon deux voitures peuvent se bloquer mutuellement au carrefour.
      const consider = (ox, oz, olen, oyaw) => {
        const rx = ox - ai.x, rz = oz - ai.z;
        const ahead = rx * fx + rz * fz;
        const side = Math.abs(rx * fz - rz * fx);
        const sameWay = Math.cos(oyaw - ai.yaw) > 0.3;
        if (ahead > 0 && ahead < 14 && side < 2.4 && (sameWay || ahead < 5)) {
          const gap = ahead - (ai.length + olen) / 2;
          want = Math.min(want, gap < 1.5 ? 0 : gap * 0.9);
        }
      };
      if (ai.waiting < 6) {
        for (const o of traffic) if (o !== ai) consider(o.x, o.z, o.length, o.yaw);
        consider(car.x, car.z, CAR.halfLength * 2, car.yaw);
      }
      // Anti-blocage : après 6 s à l'arrêt au vert, on repart doucement en ignorant les autres.
      ai.waiting = ai.speed < 0.1 && light === "green" ? ai.waiting + dt : 0;
      if (ai.waiting > 8) ai.waiting = 0;

      ai.speed += THREE.MathUtils.clamp(want - ai.speed, -8 * dt, 3 * dt);
      if (ai.speed < 0.02) ai.speed = 0;
      const step = ai.speed * dt;
      if (distT > 0.01) {
        const k = Math.min(1, step / distT);
        ai.x += tx * k;
        ai.z += tz * k;
        const targetYaw = Math.atan2(-tx, -tz);
        let dy = targetYaw - ai.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        ai.yaw += dy * Math.min(1, dt * 6);
      }
      if (distT < Math.max(0.6, step)) ai.idx++;
      if (ai.idx >= ai.path.length - 1) {
        // Arrivé au carrefour B : il devient A, on repart.
        const [dx, dz] = DIRV[ai.d];
        ai.a += dx;
        ai.b += dz;
        ai.d = ai.nextD;
        const [ndx, ndz] = DIRV[ai.d];
        ai.nextD = chooseNext(ai.a + ndx, ai.b + ndz, ai.d);
        ai.path = segmentPath(ai.a, ai.b, ai.d, ai.nextD);
        ai.idx = 0;
      }
      ai.v.group.position.set(ai.x, 0, ai.z);
      ai.v.group.rotation.y = ai.yaw;
      animateWheels(ai.v, step, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // Entrées

  const keys = { gas: false, brake: false, left: false, right: false, hand: false };
  const keyMap = { ArrowUp: "gas", KeyW: "gas", KeyZ: "gas", ArrowDown: "brake", KeyS: "brake", ArrowLeft: "left", KeyA: "left", KeyQ: "left", ArrowRight: "right", KeyD: "right", Space: "hand" };

  let driving = false;
  function startDriving() {
    if (driving) return;
    driving = true;
    startEl.classList.add("hidden");
    document.body.classList.add("driving");
  }
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    startDriving();
    const k = keyMap[e.code];
    if (k) {
      keys[k] = true;
      e.preventDefault();
    }
    if (e.code === "KeyR") resetCar();
    if (e.code === "KeyC") cycleCamera();
    if (e.code === "KeyM") toggleSound();
  });
  window.addEventListener("keyup", (e) => {
    const k = keyMap[e.code];
    if (k) keys[k] = false;
  });
  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a")) return;
    startDriving();
  });
  document.querySelectorAll(".touch-button").forEach((btn) => {
    const key = btn.dataset.key;
    const on = (e) => {
      e.preventDefault();
      keys[key] = true;
      btn.classList.add("active");
      startDriving();
    };
    const off = () => {
      keys[key] = false;
      btn.classList.remove("active");
    };
    btn.addEventListener("pointerdown", on);
    btn.addEventListener("pointerup", off);
    btn.addEventListener("pointercancel", off);
    btn.addEventListener("pointerleave", off);
  });
  const touchSteer = { value: 0 };
  const steerEl = document.getElementById("touch-steer");
  const steerKnob = document.getElementById("touch-steer-knob");
  if (steerEl) {
    let steerPointer = null;
    const setFromX = (clientX) => {
      const r = steerEl.getBoundingClientRect();
      const v = THREE.MathUtils.clamp(((clientX - r.left) / r.width) * 2 - 1, -1, 1);
      touchSteer.value = -v;
      steerKnob.style.transform = `translateX(${(v * r.width) / 2}px)`;
    };
    steerEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      steerPointer = e.pointerId;
      steerEl.setPointerCapture(e.pointerId);
      steerEl.classList.add("active");
      setFromX(e.clientX);
      startDriving();
    });
    steerEl.addEventListener("pointermove", (e) => e.pointerId === steerPointer && setFromX(e.clientX));
    const release = (e) => {
      if (e.pointerId !== steerPointer) return;
      steerPointer = null;
      touchSteer.value = 0;
      steerEl.classList.remove("active");
      steerKnob.style.transform = "translateX(0)";
    };
    steerEl.addEventListener("pointerup", release);
    steerEl.addEventListener("pointercancel", release);
  }
  document.querySelectorAll(finePointer ? "[data-coarse]" : "[data-fine]").forEach((el) => (el.hidden = true));
  document.querySelectorAll(finePointer ? "[data-fine]" : "[data-coarse]").forEach((el) => (el.hidden = false));

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  if (finePointer && !reducedMotion) {
    window.addEventListener("pointermove", (e) => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    });
  }

  const cameraModes = ["poursuite", "capot", "cinéma"];
  let cameraMode = 0;
  function cycleCamera() {
    cameraMode = (cameraMode + 1) % cameraModes.length;
    cameraToggle.textContent = "Caméra : " + cameraModes[cameraMode];
  }
  cameraToggle.addEventListener("click", cycleCamera);

  // Son : petit moteur synthétisé, grave pour les grosses cylindrées.
  let audio = null, soundOn = false;
  function toggleSound() {
    if (!audio) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      const osc2 = ctx.createOscillator();
      osc2.type = "square";
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start();
      audio = { ctx, osc1, osc2, filter, gain };
    }
    soundOn = !soundOn;
    if (soundOn) audio.ctx.resume();
    soundToggle.textContent = soundOn ? "Son actif" : "Son coupé";
    soundToggle.setAttribute("aria-pressed", String(soundOn));
  }
  soundToggle.addEventListener("click", toggleSound);

  // ---------------------------------------------------------------------------
  // Simulation du joueur

  const GEARS = 7;
  const gearTops = Array.from({ length: GEARS + 1 }, (_, g) => (g === 0 ? 0 : (PERF.vmax * g) / GEARS));
  const gearFor = (kmh) => {
    for (let g = GEARS; g >= 1; g--) if (kmh >= gearTops[g - 1]) return g;
    return 1;
  };

  function stepCar(dt) {
    const throttle = keys.gas ? 1 : 0;
    const brake = keys.brake ? 1 : 0;
    const steerTarget = touchSteer.value !== 0 ? touchSteer.value : (keys.left ? 1 : 0) - (keys.right ? 1 : 0);

    const lock = (0.6 * Math.min(CAR.grip, 1.2)) / (1 + Math.abs(car.v) / 12);
    car.steer = THREE.MathUtils.damp(car.steer, steerTarget * lock, 8, dt);

    let a = 0;
    const v = car.v;
    const speedRatio = Math.min(Math.abs(v) / CAR.vmax, 1);
    if (throttle && v >= -0.5) a += CAR.accel * (1 - Math.pow(speedRatio, 1.5));
    if (brake) {
      if (v > 0.6) a -= CAR.brake;
      else if (v > -CAR.reverseMax) a -= 3.5;
    }
    if (keys.hand) a -= v > 0 ? 18 : v < 0 ? -18 : 0;
    a -= 0.003 * v * Math.abs(v);
    if (!throttle && !brake) a -= Math.sign(v) * Math.min(Math.abs(v) / dt, 1.2);
    car.accel = a;
    car.v += a * dt;
    if (Math.abs(car.v) < 0.02 && !throttle && !brake) car.v = 0;

    if (Math.abs(car.v) > 0.01) car.yaw += (car.v / CAR.wheelbase) * Math.tan(car.steer) * dt;
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    const rx = -fz, rz = fx; // vecteur latéral (droite)

    // Déplacement avec collision contre trottoirs et bâtiments : on teste les quatre coins,
    // axe par axe, pour glisser le long des obstacles au lieu de s'y coller.
    const corners = (x, z) => [
      [x + fx * CAR.halfLength + rx * CAR.halfWidth, z + fz * CAR.halfLength + rz * CAR.halfWidth],
      [x + fx * CAR.halfLength - rx * CAR.halfWidth, z + fz * CAR.halfLength - rz * CAR.halfWidth],
      [x - fx * CAR.halfLength + rx * CAR.halfWidth, z - fz * CAR.halfLength + rz * CAR.halfWidth],
      [x - fx * CAR.halfLength - rx * CAR.halfWidth, z - fz * CAR.halfLength - rz * CAR.halfWidth],
    ];
    const free = (x, z) => corners(x, z).every(([px, pz]) => isDrivable(map, px, pz));
    const nx = car.x + fx * car.v * dt, nz = car.z + fz * car.v * dt;
    let hit = false;
    if (free(nx, nz)) {
      car.x = nx;
      car.z = nz;
    } else if (free(nx, car.z)) {
      car.x = nx;
      hit = true;
    } else if (free(car.x, nz)) {
      car.z = nz;
      hit = true;
    } else hit = true;
    if (hit) {
      if (Math.abs(car.v) > 3) car.hitFlash = 1;
      car.v *= Math.abs(car.v) > 3 ? 0.35 : 0.8;
    }

    // Collisions avec le trafic : simple répulsion.
    for (const ai of traffic) {
      const dx = car.x - ai.x, dz = car.z - ai.z;
      const d = Math.hypot(dx, dz);
      const minD = (CAR.halfLength + ai.length / 2) * 0.8;
      if (d < minD && d > 0.001) {
        const push = (minD - d) * 0.5;
        car.x += (dx / d) * push;
        car.z += (dz / d) * push;
        if (Math.abs(car.v) > 2) car.hitFlash = 1;
        car.v *= 0.5;
        ai.speed = 0;
      }
    }
    car.hitFlash = Math.max(0, car.hitFlash - dt * 3);
    car.dist += car.v * dt;

    carRoot.position.set(car.x, 0, car.z);
    carRoot.rotation.y = car.yaw;
    const roll = THREE.MathUtils.clamp(-car.steer * car.v * 0.006, -0.05, 0.05);
    const pitch = THREE.MathUtils.clamp(car.accel * 0.004, -0.035, 0.035);
    bodyPivot.rotation.z = THREE.MathUtils.damp(bodyPivot.rotation.z, roll, 6, dt);
    bodyPivot.rotation.x = THREE.MathUtils.damp(bodyPivot.rotation.x, pitch, 6, dt);
    animateWheels(player, car.v * dt, car.steer);
  }

  // ---------------------------------------------------------------------------
  // Caméra

  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), fwd = new THREE.Vector3();
  const orbit = { phi: Math.PI, dist: 6.4, height: 2.0, fov: 40 };
  const dampAngle = (cur, tgt, l, dt) => {
    let d = tgt - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return cur + d * (1 - Math.exp(-l * dt));
  };

  function stepCamera(dt) {
    mouse.x = THREE.MathUtils.damp(mouse.x, mouse.tx, 4, dt);
    mouse.y = THREE.MathUtils.damp(mouse.y, mouse.ty, 4, dt);
    fwd.set(-Math.sin(car.yaw), 0, -Math.cos(car.yaw));
    const speed = Math.abs(car.v);
    const mode = cameraModes[cameraMode];
    const L = player.size.z;

    if (mode === "poursuite") {
      const targetPhi = Math.PI - mouse.x * 0.9 - car.steer * Math.min(speed, 30) * 0.02;
      orbit.phi = dampAngle(orbit.phi, targetPhi, 6, dt);
      const portrait = THREE.MathUtils.clamp(1 - camera.aspect, 0, 0.6);
      orbit.dist = THREE.MathUtils.damp(orbit.dist, L * 1.45 + speed * 0.04 + portrait * 4, 4, dt);
      orbit.height = THREE.MathUtils.damp(orbit.height, 2.0 + speed * 0.01 - mouse.y * 0.7 + portrait * 1.2, 4, dt);
      orbit.fov = THREE.MathUtils.damp(orbit.fov, 42 + (Math.min(speed, 60) / 60) * 12, 3, dt);
      const phi = car.yaw + orbit.phi;
      camPos.set(car.x - Math.sin(phi) * orbit.dist, orbit.height, car.z - Math.cos(phi) * orbit.dist);
      camLook.set(car.x + fwd.x * 3, 0.8, car.z + fwd.z * 3);
      camera.fov = orbit.fov;
    } else if (mode === "capot") {
      const look = car.yaw - mouse.x * 0.7;
      camPos.set(car.x + fwd.x * L * 0.28, player.size.y * 0.82, car.z + fwd.z * L * 0.28);
      camLook.set(camPos.x - Math.sin(look) * 30, camPos.y - 0.3 - mouse.y * 4, camPos.z - Math.cos(look) * 30);
      camera.fov = 62 + (Math.min(speed, 60) / 60) * 8;
    } else {
      // Cinéma : trois quarts avant, bas, qui tourne avec le pointeur.
      const targetPhi = Math.PI * 0.72 - mouse.x * 1.2;
      orbit.phi = dampAngle(orbit.phi, targetPhi, 3, dt);
      orbit.height = THREE.MathUtils.damp(orbit.height, 1.2 - mouse.y * 0.8, 3, dt);
      const phi = car.yaw + orbit.phi;
      const dist = L * 1.7;
      camPos.set(car.x - Math.sin(phi) * dist, orbit.height, car.z - Math.cos(phi) * dist);
      camLook.set(car.x, 0.6, car.z);
      camera.fov = 34;
    }
    const shake = car.hitFlash * 0.06;
    if (shake > 0 && !reducedMotion) {
      camPos.x += (Math.random() - 0.5) * shake;
      camPos.y += (Math.random() - 0.5) * shake;
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.updateProjectionMatrix();
  }

  function stepWorld() {
    sky.position.copy(camera.position);
    updateLOD(camera.position);
    // Trafic lointain masqué (au-delà du brouillard).
    for (const ai of traffic) ai.v.group.visible = Math.hypot(ai.x - camera.position.x, ai.z - camera.position.z) < 300;
    sun.position.set(car.x + sunOffset.x, sunOffset.y, car.z + sunOffset.z);
    sun.target.position.set(car.x, 0, car.z);
  }

  // ---------------------------------------------------------------------------
  // Mini-carte

  const mm = minimap ? minimap.getContext("2d") : null;
  let mapLayer = null;
  function buildMapLayer() {
    const size = minimap.width;
    mapLayer = document.createElement("canvas");
    mapLayer.width = mapLayer.height = size;
    const ctx = mapLayer.getContext("2d");
    const s = size / SIDE;
    for (let j = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++) {
        const t = map[j * SIDE + i];
        ctx.fillStyle = t === T.BLOCK ? "rgba(21,24,29,0.55)" : t === T.PARK ? "rgba(90,130,90,0.55)" : "rgba(238,240,243,0.9)";
        ctx.fillRect(i * s, j * s, s + 0.5, s + 0.5);
      }
    }
  }
  if (mm) buildMapLayer();
  function drawMinimap() {
    if (!mm) return;
    const size = minimap.width;
    const s = size / SIDE;
    mm.clearRect(0, 0, size, size);
    mm.drawImage(mapLayer, 0, 0);
    const toPx = (x, z) => [(x / TILE + SIDE / 2) * s, (z / TILE + SIDE / 2) * s];
    // Feux : petit point coloré au carrefour selon l'axe nord-sud.
    for (const it of city.intersections) {
      const [px, pz] = toPx(it.x, it.z);
      mm.fillStyle = it.ns === "green" ? "#2ee06a" : it.ns === "amber" ? "#ffb020" : "#ff2a1f";
      mm.fillRect(px - 1.5, pz - 1.5, 3, 3);
    }
    mm.fillStyle = "#5b616b";
    for (const ai of traffic) {
      const [px, pz] = toPx(ai.x, ai.z);
      mm.fillRect(px - 1.5, pz - 1.5, 3, 3);
    }
    const [px, pz] = toPx(car.x, car.z);
    mm.save();
    mm.translate(px, pz);
    mm.rotate(-car.yaw);
    mm.fillStyle = carData.paint;
    mm.strokeStyle = "#15181d";
    mm.lineWidth = 1.2;
    mm.beginPath();
    mm.moveTo(0, -6);
    mm.lineTo(4, 4);
    mm.lineTo(-4, 4);
    mm.closePath();
    mm.fill();
    mm.stroke();
    mm.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD et son

  let hudTimer = 0, mapTimer = 0;
  function stepHud(dt) {
    hudTimer += dt;
    mapTimer += dt;
    const kmh = Math.abs(car.v) * 3.6;
    const gear = car.v < -0.3 ? "R" : kmh < 1 ? "N" : String(gearFor(kmh));
    let rpmFrac;
    if (gear === "N") rpmFrac = keys.gas ? 0.5 : 0.1;
    else if (gear === "R") rpmFrac = Math.min(kmh / 30, 1);
    else {
      const g = Number(gear);
      rpmFrac = 0.25 + 0.75 * THREE.MathUtils.clamp((kmh - gearTops[g - 1]) / (gearTops[g] - gearTops[g - 1]), 0, 1);
    }
    if (hudTimer > 0.08) {
      hudTimer = 0;
      hudSpeed.textContent = String(Math.round(kmh));
      hudGear.textContent = gear;
      hudRpm.style.width = Math.round(rpmFrac * 100) + "%";
    }
    if (mapTimer > 0.12) {
      mapTimer = 0;
      drawMinimap();
    }
    if (audio) {
      const bass = PERF.mass > 1900 ? 0.7 : PERF.mass > 1500 ? 0.85 : 1;
      const rpm = 900 + rpmFrac * 7600;
      const f = (rpm / 60) * 4 * bass;
      const t = audio.ctx.currentTime;
      audio.osc1.frequency.setTargetAtTime(f, t, 0.05);
      audio.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      audio.filter.frequency.setTargetAtTime(300 + rpm * 0.12, t, 0.05);
      const target = soundOn ? 0.025 + (keys.gas ? 0.05 : 0.015) * (0.4 + rpmFrac) : 0;
      audio.gain.gain.setTargetAtTime(target, t, 0.08);
    }
  }

  // ---------------------------------------------------------------------------
  // Boucle

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const FIXED_DT = 1 / 120;
  let accumulator = 0;
  function simulate(dt) {
    accumulator = Math.min(accumulator + dt, 0.25);
    while (accumulator >= FIXED_DT) {
      stepCar(FIXED_DT);
      accumulator -= FIXED_DT;
    }
  }

  const quality = { ratio: Math.min(window.devicePixelRatio, 1.25), min: 0.55, frames: 0, time: 0 };
  function adaptQuality(dt) {
    quality.frames++;
    quality.time += dt;
    if (quality.time < 1.5) return;
    const fps = quality.frames / quality.time;
    quality.frames = 0;
    quality.time = 0;
    let next = quality.ratio;
    if (fps < 28) next = Math.max(quality.min, quality.ratio * 0.85);
    else if (fps > 56) next = Math.min(Math.min(window.devicePixelRatio, 1.25), quality.ratio * 1.1);
    if (Math.abs(next - quality.ratio) > 0.01) {
      quality.ratio = next;
      renderer.setPixelRatio(quality.ratio);
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  const clock = new THREE.Clock();
  function animate() {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.25);
    if (driving) simulate(dt);
    city.stepLights(dt);
    stepTraffic(Math.min(dt, 0.05));
    stepCamera(Math.min(dt, 0.05));
    stepWorld();
    stepHud(dt);
    adaptQuality(rawDt);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  window.__renderStill = () => {
    renderer.render(scene, camera);
    return canvas.toDataURL("image/png");
  };
  window.__drive = { car, keys, traffic, city, resetCar, startDriving, camera, scene, renderer, cycleCamera };

  stepCar(FIXED_DT);
  stepWorld();
  loaderText.textContent = "Prêt";
  loaderBar.style.width = "100%";
  requestAnimationFrame(() => document.body.classList.add("ready"));
  animate();
}
