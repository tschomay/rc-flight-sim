// Helicopter definitions. Numbers come from published specs where they exist (mass,
// rotor diameter, motor size) and engineering estimates elsewhere (inertias, hub
// stiffness, drag areas). Every value is meant to be tuned by feel; see docs/physics.md.
//
// Body axes: x forward (nose), y up (mast), z right. Angles in degrees here, converted
// to radians by the model on load.

export const MODELS = {
  "fbl450": {
    name: "450 FBL 3D",
    blurb: "Generic 450-size flybarless 3D heli: 715 mm rotor, 3S, ~780 g.",
    mass: 0.78,
    inertia: { roll: 0.010, yaw: 0.030, pitch: 0.028 },  // kg·m², about body x, y, z
    rotor: {
      radius: 0.357, chord: 0.034, blades: 2,
      liftSlope: 5.8, cd0: 0.012, cd2: 0.6, tipLoss: 0.97,
      hubHeight: 0.14,            // m above CG
      hubStiffness: 18,           // N·m per rad of disc tilt at nominal headspeed
      flapTau: 0.030,             // s, disc response time at nominal headspeed
      inflowTau: 0.06,            // s, lag of induced flow (the "float" after a punch)
      inertia: 0.0035,            // kg·m² about the shaft
      direction: -1,              // -1 = clockwise seen from above
      maxTilt: 14,                // deg, mechanical cyclic + flapping limit
    },
    headspeed: { normal: 2400, idle: 2800 },  // rpm
    pitch: { normal: [-4, 12], idle: [-12, 12], hold: [-12, 12] },  // deg at stick bottom / top
    maxCyclic: 12,                // deg of swash cyclic
    motor: { maxPower: 700, spool: 900 },  // W, rpm/s soft-start
    tail: { arm: 0.42, thrust: [-5, 2], tau: 0.015, driven: "main", damping: 0.25, radius: 0.08 },
    rates: { roll: 360, pitch: 360, yaw: 450 },  // deg/s at full stick
    drag: { x: 0.012, y: 0.06, z: 0.04 },        // CdA, m²
    geometry: {
      skidY: -0.17, skidX: [-0.12, 0.11], skidZ: 0.09,
      tailY: 0.02, finY: -0.10, noseX: 0.24, noseY: -0.03,
    },
    look: { canopy: 0xf2f2f0, trim: 0xd9381e, frame: 0x222222, blade: 0x1a1a1a },
  },

  "fbl600": {
    name: "600 FBL 3D",
    blurb: "Generic 600-size flybarless 3D heli: 1350 mm rotor (600 mm blades), 12S, ~3.7 kg. Slower headspeed and more inertia: steadier and more deliberate than a 450.",
    mass: 3.7,
    inertia: { roll: 0.15, yaw: 0.46, pitch: 0.43 },
    rotor: {
      radius: 0.675, chord: 0.048, blades: 2,
      liftSlope: 5.9, cd0: 0.011, cd2: 0.55, tipLoss: 0.97,
      hubHeight: 0.26,
      hubStiffness: 340,
      flapTau: 0.032,
      inflowTau: 0.09,
      inertia: 0.06,
      direction: -1,
      maxTilt: 14,
    },
    headspeed: { normal: 1750, idle: 2050 },
    pitch: { normal: [-4, 12], idle: [-12, 12], hold: [-12, 12] },
    maxCyclic: 12,
    motor: { maxPower: 3500, spool: 600 },
    tail: { arm: 0.78, thrust: [-20, 8], tau: 0.02, driven: "main", damping: 1.0, radius: 0.125 },
    rates: { roll: 360, pitch: 360, yaw: 450 },
    drag: { x: 0.04, y: 0.2, z: 0.13 },
    geometry: {
      skidY: -0.31, skidX: [-0.22, 0.2], skidZ: 0.17,
      tailY: 0.04, finY: -0.19, noseX: 0.45, noseY: -0.06,
    },
    look: { canopy: 0x22324f, trim: 0xff8a1f, frame: 0x1c1c1c, blade: 0x1a1a1a },
  },

  "mcpx": {
    name: "mCP X BL2 class",
    blurb: "Micro collective-pitch 3D heli: 263 mm rotor, 2S, ~62 g, motor-driven fixed-pitch tail.",
    mass: 0.062,
    inertia: { roll: 0.00006, yaw: 0.00015, pitch: 0.00014 },
    rotor: {
      radius: 0.1315, chord: 0.021, blades: 2,
      liftSlope: 5.5, cd0: 0.024, cd2: 0.7, tipLoss: 0.96,
      hubHeight: 0.05,
      hubStiffness: 0.15,
      flapTau: 0.025,
      inflowTau: 0.04,
      inertia: 0.000025,
      direction: -1,
      maxTilt: 14,
    },
    headspeed: { normal: 3800, idle: 4500 },
    pitch: { normal: [-4, 12], idle: [-12, 12], hold: [-12, 12] },
    maxCyclic: 12,
    motor: { maxPower: 75, spool: 1600 },
    tail: { arm: 0.135, thrust: [-0.35, 0], tau: 0.04, driven: "motor", damping: 0.02, radius: 0.025 },
    rates: { roll: 400, pitch: 400, yaw: 600 },
    drag: { x: 0.0012, y: 0.006, z: 0.0035 },
    geometry: {
      skidY: -0.06, skidX: [-0.045, 0.04], skidZ: 0.035,
      tailY: 0.0, finY: -0.035, noseX: 0.07, noseY: -0.01,
    },
    look: { canopy: 0x1f5fbf, trim: 0xf5c518, frame: 0x1c1c1c, blade: 0x111111 },
  },
};

export const DEFAULT_MODEL = "fbl450";
