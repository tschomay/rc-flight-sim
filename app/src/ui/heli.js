// Settings → Helicopter: model, stick feel and flight-mode notes. Mixed into UI.

import { h, seg, toggle, slider } from "./dom.js";
import { MODELS } from "../sim/models.js";
import { TUNABLES, bounds, exportTuning } from "../sim/tuning.js";

export const heliMethods = {
  tab_heli(s) {
    const preset = (label, rates, cyc, rud) => h("button", { type: "button", class: `preset ${s.rates === rates && s.expo.cyclic === cyc ? "on" : ""}`, onclick: () => {
      s.rates = rates; s.expo.cyclic = cyc; s.expo.rudder = rud; this.changed("model"); this.openSheet("heli");
    } }, label);
    return [
      seg("Helicopter", Object.entries(MODELS).map(([k, m]) => [k, m.name]), s.model, (v) => { s.model = v; this.changed("model"); }),
      h("p", { class: "hint" }, MODELS[s.model].blurb),
      h("fieldset", { class: "field" }, h("legend", {}, "Stick feel"),
        h("div", { class: "presets" },
          preset("Gentle: 50% rates, 45% expo", 50, 45, 40),
          preset("Sport: 75%, 30%", 75, 30, 30),
          preset("3D: 100%, 20%", 100, 20, 20))),
      slider("Rates", 30, 130, 5, s.rates, (v) => { s.rates = v; this.changed("model"); }, (v) => `${v}%`),
      seg("Idle-up collective range", [[8, "\u00b18\u00b0"], [10, "\u00b110\u00b0"], [12, "\u00b112\u00b0"]], s.idlePitch, (v) => { s.idlePitch = +v; this.changed("model"); }),
      h("p", { class: "hint" }, "Idle up feels twitchier than Normal because the same stick travel covers \u221212\u2026+12\u00b0 instead of \u22124\u2026+12\u00b0, at higher headspeed. A smaller range softens the collective; \u00b112\u00b0 is a typical 3D setup."),
      slider("Cyclic expo", 0, 80, 5, s.expo.cyclic, (v) => { s.expo.cyclic = v; this.changed("expo"); }, (v) => `${v}%`),
      slider("Rudder expo", 0, 80, 5, s.expo.rudder, (v) => { s.expo.rudder = v; this.changed("expo"); }, (v) => `${v}%`),
      seg("Blades", [["dark", "Dark"], ["white", "White"]], s.bladeColor, (v) => { s.bladeColor = v; this.changed("model"); }),
      toggle("Self-levelling (stability mode)", s.selfLevel, (v) => { s.selfLevel = v; this.changed("misc"); }, "the stick sets a tilt and letting go levels the heli, like Blade SAFE. Upright only; off for real 3D practice"),
      h("details", {}, h("summary", {}, "Feels twitchy? Every input over-corrects?"),
        h("ol", {},
          h("li", {}, "Make sure the transmitter isn't adding its own expo or dual rates on top of the sim's: in the radio, D/R 100% and expo 0 for the sim model. Two layers of curves make the centre feel odd and the ends jumpy."),
          h("li", {}, "Start with the Gentle preset. Rates are how fast the heli rolls at full stick; lower rates make small inputs smaller. Raise them as you get steadier."),
          h("li", {}, "Expo softens the centre of the stick, where all hover corrections live. 30–50% is normal for hovering."),
          h("li", {}, "Use small, brief inputs and let go: this is a flybarless heli, so it holds whatever tilt you leave it at. Correct, then centre the stick."),
          h("li", {}, "Slow the sim down (Training → Sim speed). Learning at 60–70% and working up is exactly what the flight school does."),
          h("li", {}, "Turn on self-levelling for a few sessions if you just want to get a feel for it."))),
      toggle("Reset automatically after a crash", s.autoReset, (v) => { s.autoReset = v; this.changed("misc"); }),
      this.tuningPanel(s),
      h("p", { class: "hint" }, "Flight modes: Normal uses lower headspeed and −4…+12° pitch. Idle up uses full headspeed and symmetric −12…+12° for inverted. Hold cuts the motor for autorotation."),
    ];
  },

  /** Live sliders over models.js values, saved per heli, with an export to paste back. */
  tuningPanel(s) {
    const id = s.model, def = MODELS[id];
    const over = (s.tuning[id] ||= {});
    const changed = Object.keys(over).length;
    const out = h("pre", { class: "export" }, exportTuning(id, def, over));
    const refresh = () => { out.textContent = exportTuning(id, def, over); };
    const unit = (u) => (u ? ` ${u}` : "");
    const rows = TUNABLES.map((t) => {
      const b = bounds(def, t);
      const v = over[t.path] ?? b.base;
      const fmt = (x) => `${+(+x).toPrecision(3)}${unit(t.unit)} (\u00d7${(x / b.base).toFixed(2)})`;
      return [
        slider(t.label, b.min, b.max, b.step, v, (x) => {
          if (Math.abs(x - b.base) < b.step / 2) delete over[t.path]; else over[t.path] = x;
          this.changed("tune"); refresh();
        }, fmt),
        t.hint ? h("p", { class: "hint" }, t.hint) : null,
      ];
    });
    const copy = async () => {
      try { await navigator.clipboard.writeText(out.textContent); this.toast("Copied"); } catch { this.toast("Couldn't copy: select the text below instead", 2500); }
    };
    return h("details", { open: changed > 0 || undefined },
      h("summary", {}, `Tuning (advanced)${changed ? ` \u00b7 ${changed} changed` : ""}`),
      h("p", { class: "hint" }, `Change the ${def.name}'s flight model while you fly (close the settings to try it). Each slider starts at the models.js value; changes are saved for this heli only. When it feels like the real heli, copy the values into src/sim/models.js and run npm test.`),
      rows,
      h("div", { class: "row" },
        h("button", { type: "button", onclick: copy }, "Copy for models.js"),
        h("button", { type: "button", onclick: () => { s.tuning[id] = {}; this.changed("tune"); this.openSheet("heli"); } }, "Reset to models.js")),
      out);
  },
};
