// The flying field: sky dome, mown grass with stripes (strong motion and height cues),
// a flight line, tree line and hills for horizon, a windsock, and the trainer's circle.
// Everything is procedural so the app works offline and stays small.

import * as THREE from "three";

function canvasTexture(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function grassTexture() {
  return canvasTexture(512, (g, n) => {
    const r = rand(11);
    g.fillStyle = "#5d7d34"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 26000; i++) {
      const x = r() * n, y = r() * n, l = 2 + r() * 5;
      const h = 70 + r() * 30, s = 35 + r() * 25, v = 22 + r() * 22;
      g.strokeStyle = `hsl(${h} ${s}% ${v}%)`;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y - l); g.stroke();
    }
  }, { repeat: 1 });
}

function noiseTexture() {
  return canvasTexture(256, (g, n) => {
    const r = rand(5);
    const img = g.createImageData(n, n);
    // value noise, a few octaves, tileable by wrapping the lattice
    const lattice = (p) => { const a = []; for (let i = 0; i < p * p; i++) a.push(r()); return a; };
    const octs = [8, 16, 32, 64].map((p) => ({ p, v: lattice(p) }));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let val = 0, amp = 0.5;
      for (const o of octs) {
        const fx = (x / n) * o.p, fy = (y / n) * o.p;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const at = (i, j) => o.v[((j % o.p) * o.p) + (i % o.p)];
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        val += (a + (b - a) * sy) * amp; amp *= 0.5;
      }
      const c = Math.max(0, Math.min(255, val * 270));
      const k = (y * n + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = c; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

function gravelTexture() {
  return canvasTexture(256, (g, n) => {
    const r = rand(23);
    g.fillStyle = "#9a948a"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 9000; i++) {
      const v = 45 + r() * 30;
      g.fillStyle = `hsl(35 8% ${v}%)`;
      g.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2);
    }
  });
}

function skyDome(sunDir) {
  const geo = new THREE.SphereGeometry(4000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x3d74b8) },
      horizon: { value: new THREE.Color(0xc9dbe8) },
      ground: { value: new THREE.Color(0x9fb0a8) },
      sun: { value: sunDir.clone().normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 zenith, horizon, ground, sun; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, ground, min(1.0, -h * 8.0));
        float s = max(dot(normalize(vDir), sun), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

/** Draw a flat mesh on the ground without z-fighting it: pulled toward the camera in depth. */
function decal(mat, order = 1) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -order * 2;
  mat.polygonOffsetUnits = -order * 4;
  return mat;
}

export function buildWorld(scene) {
  const sunDir = new THREE.Vector3(-0.45, 0.8, 0.55).normalize();  // behind-left of the pilot: shadow falls ahead
  scene.background = new THREE.Color(0xc9dbe8);
  scene.fog = new THREE.Fog(0xc9dbe8, 250, 2600);
  scene.add(skyDome(sunDir));

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x56653a, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.position.copy(sunDir).multiplyScalar(30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -2; sc.right = sc.top = 2; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // --- ground: detail grass, mowing stripes and large-scale colour variation in the shader
  const grass = grassTexture();
  const noise = noiseTexture();
  grass.repeat.set(2000, 2000);  // 2 m tiles over 4 km
  const groundMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0 });
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.macro = { value: noise };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld; uniform sampler2D macro;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float field = step(abs(vWorld.x), 60.0) * step(abs(vWorld.z + 30.0), 60.0);
        // anti-aliased stripe edges: a hard step() shimmers as the camera moves
        float sx = vWorld.x / 5.0, sw = max(fwidth(sx), 1e-4);
        float sq = clamp((abs(fract(sx) - 0.5) - 0.25) / sw + 0.5, 0.0, 1.0);
        float stripe = mix(1.0, mix(0.9, 1.06, mix(sq, 0.5, clamp(sw * 3.0, 0.0, 1.0))), field);
        float m1 = texture2D(macro, vWorld.xz / 90.0).r;
        float m2 = texture2D(macro, vWorld.xz / 13.0).r;
        diffuseColor.rgb *= stripe * (0.78 + 0.32 * m1) * (0.9 + 0.2 * m2) * mix(0.82, 1.0, field);`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // flight line (gravel strip the pilot stands on) and a small landing pad
  const gravel = gravelTexture();
  gravel.repeat.set(20, 2);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(40, 3), decal(new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 }), 1));
  line.rotation.x = -Math.PI / 2; line.position.set(0, 0.01, 0.6); line.receiveShadow = true;
  scene.add(line);
  const padTex = canvasTexture(256, (g, n) => {
    g.fillStyle = "#3c4148"; g.fillRect(0, 0, n, n);
    g.strokeStyle = "#e9e6dc"; g.lineWidth = 10; g.strokeRect(14, 14, n - 28, n - 28);
    g.fillStyle = "#e9e6dc"; g.font = "bold 150px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("H", n / 2, n / 2 + 8);
  });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), decal(new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.9 }), 1));
  pad.rotation.x = -Math.PI / 2; pad.rotation.z = Math.PI / 2; pad.receiveShadow = true;
  pad.position.set(0, 0.01, -5);
  scene.add(pad);

  // traffic cones along the flight line every 5 m for scale
  const coneGeo = new THREE.ConeGeometry(0.12, 0.45, 16);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 });
  for (const x of [-15, -10, -5, 5, 10, 15]) {
    const c = new THREE.Mesh(coneGeo, coneMat);
    c.position.set(x, 0.225, -2.2); c.castShadow = true; c.receiveShadow = true;
    scene.add(c);
  }

  // tree line
  const r = rand(42);
  const trees = 260;
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const pineGeo = new THREE.ConeGeometry(1, 2.6, 8);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f4a22, roughness: 1, flatShading: true });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x24391d, roughness: 1, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, trees);
  const pines = new THREE.InstancedMesh(pineGeo, pineMat, trees);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let nc = 0, np = 0, nt = 0;
  for (let i = 0; i < trees * 2; i++) {
    const a = r() * Math.PI * 2;
    const d = 130 + Math.pow(r(), 1.4) * 320;
        const x = Math.cos(a) * d, z = Math.sin(a) * d - 25;
    const h = 6 + r() * 12;
    const pine = r() < 0.45;
    if (pine && np < trees) {
      q.identity(); s.set(h * 0.22, h * 0.38, h * 0.22); p.set(x, h * 0.62, z);
      pines.setMatrixAt(np++, m.compose(p, q, s));
    } else if (!pine && nc < trees) {
      q.setFromEuler(new THREE.Euler(r(), r(), r())); s.set(h * 0.32, h * 0.28, h * 0.32); p.set(x, h * 0.62, z);
      crowns.setMatrixAt(nc++, m.compose(p, q, s));
    } else continue;
    q.identity(); s.set(1, h * 0.45, 1); p.set(x, h * 0.22, z);
    trunks.setMatrixAt(nt++, m.compose(p, q, s));
  }
  crowns.count = nc; pines.count = np; trunks.count = nt;
  scene.add(crowns, pines, trunks);

  // distant hills
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x51664d, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r() * 0.3;
    const d = 900 + r() * 700, h = 60 + r() * 140, w = 250 + r() * 300;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(w, h, 7, 1), hillMat);
    hill.position.set(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d);
    hill.rotation.y = r() * 3;
    scene.add(hill);
  }

  // windsock
  const sock = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 4, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  pole.position.y = 2; pole.castShadow = true;
  const sockPivot = new THREE.Group(); sockPivot.position.y = 3.9;
  const sockTex = canvasTexture(64, (g, n) => { for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? "#ffffff" : "#ff5a1f"; g.fillRect(0, (i * n) / 5, n, n / 5); } });
  const sockMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.18, 1.1, 12, 1, true), new THREE.MeshStandardMaterial({ map: sockTex, side: THREE.DoubleSide }));
  sockMesh.rotation.z = Math.PI / 2; sockMesh.position.x = 0.55; sockMesh.castShadow = true;
  sockPivot.add(sockMesh);
  sock.add(pole, sockPivot);
  sock.position.set(9, 0, -4);
  scene.add(sock);

  // trainer target: ground circle and a ring at hover height
  const targetGroup = new THREE.Group();
  const ringMat = decal(new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false }), 2);
  const groundRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), ringMat);
  groundRing.rotation.x = -Math.PI / 2; groundRing.position.y = 0.02;
  const airMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.3, depthWrite: false });
  const airRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.008, 6, 64), airMat);
  airRing.rotation.x = Math.PI / 2;
  // the scoring column: faint walls over the circle, the full height that counts
  const colMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64, 1, true), colMat);
  targetGroup.add(groundRing, airRing, column);
  scene.add(targetGroup);

  return {
    sun,
    setTarget(cfg, visible, showColumn = true) {
      targetGroup.visible = visible;
      column.visible = showColumn;
      const rad = cfg.circle / 2;
      targetGroup.position.set(0, 0, -cfg.distance);
      groundRing.scale.set(rad, rad, 1);
      airRing.scale.set(rad, rad, rad);
      airRing.position.y = cfg.height;
      const hw = cfg.heightWindow ?? 0;
      const lo = hw > 0 ? Math.max(0, cfg.height - hw) : 0, hi = hw > 0 ? cfg.height + hw : 8;
      column.scale.set(rad, hi - lo, rad);
      column.position.y = (lo + hi) / 2;
    },
    setZone(zone) {
      const c = { in: 0x4be37a, edge: 0xffd23f, out: 0xff5a4e }[zone];
      ringMat.color.setHex(c); airMat.color.setHex(c); colMat.color.setHex(c);
    },
    update(heliPos, wind) {
      sun.target.position.copy(heliPos);
      sun.position.copy(heliPos).addScaledVector(sunDir, 30);
      const sp = Math.hypot(wind.x, wind.z);
      sockPivot.rotation.y = Math.atan2(-wind.z, wind.x);
      sockPivot.rotation.order = "YXZ";
      sockPivot.rotation.z = -(1 - Math.min(1, sp / 7)) * 1.25;  // droops in calm air, flies straight at ~7 m/s
    },
  };
}
