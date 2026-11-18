// Measures how fast the simulation really runs against the clock. On a slow phone the
// frame time can exceed what the 1 kHz physics can catch up on, and the sim then runs
// slower than real time without saying so: training at 70% feels easier than the heli.

export class Pace {
  constructor(tau = 2) {
    this.tau = tau;       // s, smoothing time
    this.ratio = 1;       // simulated time / wanted simulated time
  }

  /**
   * One frame: `real` s of clock time passed, `wanted` s of sim time were due (real × sim
   * speed), `done` s were simulated. Long gaps (a hidden tab, a debugger) are ignored.
   */
  sample(real, wanted, done) {
    if (!(real > 0) || real > 0.5 || !(wanted > 0)) return this.ratio;
    const a = Math.min(1, real / this.tau);
    this.ratio += (Math.min(1, done / wanted) - this.ratio) * a;
    return this.ratio;
  }

  get slow() { return this.ratio < 0.9; }
}
