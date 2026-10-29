// Procedural helicopter model. Built at 450 scale (body axes: x nose, y up, z right)
// and scaled to the flight model's rotor size. Fast-spinning blades fade into a blurred
// disc, like they look to the eye, and the disc tilts with the simulated flapping.

import * as THREE from "three";

/** The blurred disc spinning blades make, in the blades' colour. */
function discTexture(blade) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const rgb = [16, 8, 0].map((sh) => (blade >> sh) & 255).join(",");
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, `rgba(${rgb},0)`);
  grd.addColorStop(0.12, `rgba(${rgb},0.3)`);
  grd.addColorStop(0.85, `rgba(${rgb},0.5)`);
  grd.addColorStop(0.95, `rgba(${rgb},0.8)`);
  grd.addColorStop(0.99, `rgba(${rgb},0.6)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class HeliMesh {
  constructor(def) {
    this.root = new THREE.Group();
    this.build(def);
  }

  build(def) {
    this.root.clear();
    this.def = def;
    const look = def.look;
    const canopy = new THREE.MeshStandardMaterial({ color: look.canopy, roughness: 0.32, metalness: 0.05 });
    const trim = new THREE.MeshStandardMaterial({ color: look.trim, roughness: 0.4 });
    const frame = new THREE.MeshStandardMaterial({ color: look.frame, roughness: 0.6, metalness: 0.3 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.1, metalness: 0.4 });
    const body = new THREE.Group();
    const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; body.add(m); return m;
    };
    const sphere = new THREE.SphereGeometry(1, 28, 18);
    add(sphere, canopy, 0.06, 0.0, 0, 0.19, 0.1, 0.062);                    // canopy
    add(sphere, glass, 0.15, 0.025, 0, 0.085, 0.05, 0.054);                 // windscreen
    add(sphere, trim, 0.02, -0.045, 0, 0.16, 0.035, 0.064);                 // belly stripe
    add(new THREE.BoxGeometry(0.15, 0.07, 0.044), frame, -0.07, 0.02, 0);   // frame / mechanics behind the canopy
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 16), metal, -0.05, 0.07, 0); // motor bell
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 8), metal, 0, 0.09, 0);      // main shaft
    const boom = add(new THREE.CylinderGeometry(0.011, 0.011, 0.36, 12), frame, -0.25, 0.025, 0);
    boom.rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(0.035, 0.03, 0.02), frame, -0.425, 0.025, 0);  // tail gearbox
    add(new THREE.BoxGeometry(0.08, 0.11, 0.003), trim, -0.44, -0.035, 0).rotation.z = -0.35; // vertical fin
    add(new THREE.BoxGeometry(0.05, 0.003, 0.11), trim, -0.33, 0.025, 0);   // horizontal fin
    // landing gear
    const g = def.geometry, s0 = def.rotor.radius / 0.357;
    const skidY = g.skidY / s0, skidZ = g.skidZ / s0, [sx0, sx1] = g.skidX.map((x) => x / s0);
    for (const z of [-skidZ, skidZ]) {
      const skid = add(new THREE.CylinderGeometry(0.005, 0.005, sx1 - sx0 + 0.04, 8), frame, (sx0 + sx1) / 2, skidY, z);
      skid.rotation.z = Math.PI / 2;
      for (const x of [sx0 + 0.04, sx1 - 0.04]) {
        const strut = add(new THREE.CylinderGeometry(0.004, 0.004, Math.hypot(-0.06 - skidY, skidZ - 0.02), 6), frame, x, (skidY - 0.06) / 2, Math.sign(z) * (0.02 + skidZ) / 2);
        strut.rotation.x = -Math.sign(z) * Math.atan2(skidZ - 0.02, -0.06 - skidY);
      }
    }
    this.root.add(body);

    // main rotor: tilt group (flapping) → spin group (blades)
    const hubY = def.rotor.hubHeight / s0;
    this.rotorTilt = new THREE.Group();
    this.rotorTilt.position.set(0, hubY, 0);
    this.rotorSpin = new THREE.Group();
    const R = 0.357;
    const bladeMat = new THREE.MeshStandardMaterial({ color: look.blade, roughness: 0.5, transparent: true });
    this.bladeMat = bladeMat;
    for (const side of [1, -1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(R - 0.03, 0.004, 0.034), bladeMat);
      b.position.set(side * (0.03 + (R - 0.03) / 2), 0, 0); b.castShadow = true;
      this.rotorSpin.add(b);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.014, 0.018), metal);
    this.rotorSpin.add(head);
    this.discMat = new THREE.MeshBasicMaterial({ map: discTexture(look.blade), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 64), this.discMat);
    disc.rotation.x = -Math.PI / 2;
    this.rotorTilt.add(this.rotorSpin, disc);
    this.root.add(this.rotorTilt);

    // tail rotor on the right side, axis along z
    const tr = def.tail.radius / s0;
    this.tail = new THREE.Group();
    this.tail.position.set(-0.43, 0.025, 0.025);
    this.tailSpin = new THREE.Group();
    for (const side of [1, -1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(tr - 0.008, 0.012, 0.002), bladeMat);
      b.position.set(side * (0.008 + (tr - 0.008) / 2), 0, 0);
      this.tailSpin.add(b);
    }
    this.tailDiscMat = this.discMat.clone();
    const tdisc = new THREE.Mesh(new THREE.CircleGeometry(tr, 32), this.tailDiscMat);
    this.tail.add(this.tailSpin, tdisc);
    this.root.add(this.tail);

    this.root.scale.setScalar(s0);
    this.spinAngle = 0;
  }

  /** Copy sim state onto the mesh. */
  update(heli, dt) {
    this.root.position.set(heli.pos.x, heli.pos.y, heli.pos.z);
    this.root.quaternion.set(heli.q.x, heli.q.y, heli.q.z, heli.q.w);
    // disc tilt: beta.p tilts forward (toward +x) = rotation about -z; beta.r tilts right = rotation about +x
    this.rotorTilt.rotation.set(heli.beta.r, 0, -heli.beta.p, "XZY");
    const spin = heli.omega / heli.omegaNom;
    // the eye can't follow real blade speed; cap the drawn speed and fade to the disc
    const drawn = Math.min(heli.omega, 18);
    this.spinAngle = (this.spinAngle + drawn * dt * -heli.def.rotor.direction) % (Math.PI * 2);
    this.rotorSpin.rotation.y = -this.spinAngle;
    this.tailSpin.rotation.z = this.spinAngle * 3;
    const fade = smooth(0.12, 0.55, spin);
    this.bladeMat.opacity = 1 - 0.7 * fade;
    this.discMat.opacity = fade;
    this.tailDiscMat.opacity = heli.def.tail.driven === "motor" ? (heli.crashed ? 0 : 0.8) : fade * 0.8;
  }
}
