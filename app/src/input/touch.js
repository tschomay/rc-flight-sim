// On-screen sticks, mode 2: left stick is collective (stays where you leave it) and
// rudder (springs back to centre); right stick is elevator and aileron (springs back).

export class TouchSticks {
  constructor(root) {
    this.root = root;
    this.values = { coll: -1, yaw: 0, pitch: 0, roll: 0 };
    this.left = this.make("left");
    this.right = this.make("right");
    this.setKnobs();
  }

  make(side) {
    const el = document.createElement("div");
    el.className = `stick stick-${side}`;
    el.innerHTML = `<div class="stick-gate"></div><div class="stick-knob"></div><span class="stick-label">${side === "left" ? "collective · rudder" : "elevator · aileron"}</span>`;
    this.root.append(el);
    const s = { el, knob: el.querySelector(".stick-knob"), id: null };
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      const y = Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
      if (side === "left") { this.values.yaw = x; this.values.coll = y; }
      else { this.values.roll = x; this.values.pitch = y; }
      this.setKnobs();
    };
    el.addEventListener("pointerdown", (e) => { s.id = e.pointerId; el.setPointerCapture(e.pointerId); el.classList.add("active"); move(e); e.preventDefault(); });
    el.addEventListener("pointermove", (e) => { if (e.pointerId === s.id) move(e); });
    const end = (e) => {
      if (e.pointerId !== s.id) return;
      s.id = null; el.classList.remove("active");
      if (side === "left") this.values.yaw = 0; else { this.values.roll = 0; this.values.pitch = 0; }
      this.setKnobs();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return s;
  }

  setKnobs() {
    const v = this.values;
    const place = (s, x, y) => { s.knob.style.left = `${50 + x * 42}%`; s.knob.style.top = `${50 - y * 42}%`; };
    place(this.left, v.yaw, v.coll);
    place(this.right, v.roll, v.pitch);
  }

  set visible(on) { this.root.hidden = !on; }

  read() { return { ...this.values }; }
}
