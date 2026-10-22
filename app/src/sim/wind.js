// Steady wind plus gusts: each axis is low-pass-filtered noise, so gusts build and fade
// over a second or two instead of jittering every frame.

import { v3, DEG, rng } from "./math.js";

export class Wind {
  constructor(seed = 3) {
    this.rand = rng(seed);
    this.g = v3();
    this.speed = 0;   // m/s
    this.from = 0;    // deg the wind comes FROM, clockwise from straight ahead of the pilot
    this.gust = 0.3;  // gust strength (standard deviation) as a fraction of speed
    this.current = v3();
  }

  set({ speed = this.speed, from = this.from, gust = this.gust } = {}) {
    this.speed = speed; this.from = from; this.gust = gust;
  }

  step(dt) {
    if (this.speed <= 0.05) { this.g = v3(); this.current = v3(); return this.current; }
    const k = Math.min(1, dt / 1.6);
    const sigma = this.gust * this.speed;
    const s = sigma * Math.sqrt((2 - k) / k) * Math.sqrt(3);  // uniform noise scaled so the filtered output has std ≈ sigma
    const n = () => (this.rand() * 2 - 1) * s;
    this.g = v3(this.g.x + (n() - this.g.x) * k, this.g.y + (n() * 0.3 - this.g.y) * k, this.g.z + (n() - this.g.z) * k);
    // the pilot faces -z; wind from 0° blows from -z toward the pilot
    const a = this.from * DEG;
    this.current = v3(-Math.sin(a) * this.speed + this.g.x, this.g.y, Math.cos(a) * this.speed + this.g.z);
    return this.current;
  }
}
