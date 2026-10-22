// Keyboard fallback for desktop testing: W/S collective, A/D rudder, arrows cyclic.

export class Keyboard {
  constructor() {
    this.down = new Set();
    this.coll = -1;
    this.used = false;
    addEventListener("keydown", (e) => {
      if (e.target.closest?.("input, select, textarea")) return;
      this.down.add(e.code); this.used = true;
      if (e.code.startsWith("Arrow")) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.down.delete(e.code));
    addEventListener("blur", () => this.down.clear());
  }

  read(dt) {
    const k = (c) => (this.down.has(c) ? 1 : 0);
    this.coll = Math.max(-1, Math.min(1, this.coll + (k("KeyW") - k("KeyS")) * dt * 1.2));
    return {
      coll: this.coll,
      yaw: k("KeyD") - k("KeyA"),
      pitch: (k("ArrowUp") - k("ArrowDown")) * 0.6,
      roll: (k("ArrowRight") - k("ArrowLeft")) * 0.6,
    };
  }
}
