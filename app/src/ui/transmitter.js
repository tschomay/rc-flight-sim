// Settings → Transmitter, and the setup wizard that finds each stick and switch. Mixed into UI.

import { h, seg } from "./dom.js";
import { FUNCTIONS, SWITCHES, snapshot, firstGamepad, channelFromCaptures, readMapped } from "../input/gamepad.js";

export const transmitterMethods = {
  tab_tx(s) {
    const gp = firstGamepad(s.input.map?.id);
    const status = gp ? `Connected: ${gp.id}` : "No transmitter seen. Plug in the dongle and move a stick.";
    const mon = h("div", { class: "monitor" });
    const draw = () => {
      const g = firstGamepad(s.input.map?.id);
      const r = g && readMapped(g, s.input.map);
      mon.replaceChildren(...["coll", "yaw", "pitch", "roll"].map((k) => {
        const v = r ? r[k] : 0;
        return h("div", { class: "mon-row" }, h("span", {}, { coll: "Collective", yaw: "Rudder", pitch: "Elevator", roll: "Aileron" }[k]),
          h("div", { class: "bar" }, h("i", { style: `left:${50 + v * 50}%` })), h("code", {}, r ? v.toFixed(2) : "—"));
      }), h("div", { class: "mon-row" }, h("span", {}, "Switches"), h("code", {}, r ? Object.entries(r.switches).map(([k, on]) => `${k}:${on ? "on" : "off"}`).join("  ") || "none mapped" : "—")));
    };
    clearInterval(this.monitorT);
    this.monitorT = setInterval(draw, 100);
    draw();
    return [
      h("p", { class: "status" }, status),
      h("div", { class: "row" },
        h("button", { type: "button", class: "primary", onclick: () => this.startWizard() }, s.input.map ? "Set up again" : "Set up transmitter"),
        s.input.map ? h("button", { type: "button", onclick: () => { s.input.map = null; this.changed("input"); this.openSheet("tx"); } }, "Forget mapping") : null),
      s.input.map ? mon : null,
      seg("On-screen sticks", [["auto", "Auto"], ["on", "Always"], ["off", "Never"]], s.input.touch, (v) => { s.input.touch = v; this.changed("input"); }),
      h("p", { class: "hint" }, "Auto shows the touch sticks whenever no transmitter is set up. Left stick: collective (stays put) and rudder. Right stick: elevator and aileron."),
      h("details", {}, h("summary", {}, "DX6i sim setup"),
        h("ol", {},
          h("li", {}, "Make a new model memory and set it to ACRO (airplane) type, so the radio sends raw sticks."),
          h("li", {}, "Dual rates 100%, expo 0, no mixes, all trims centred. The sim does curves, expo and flight modes."),
          h("li", {}, "Bind the radio to the WS2000 (hold the dongle's button while plugging it in, then bind as usual)."),
          h("li", {}, "Pick two switches (GEAR and FLAP/MIX) for idle-up and throttle hold in the wizard."))),
      h("details", {}, h("summary", {}, "More switches on a DX6i (only one recognised?)"),
        h("p", { class: "hint" }, "The DX6i sends six channels, so the sim can see at most two switch channels: ch 5 and ch 6. In an ACRO model:"),
        h("ol", {},
          h("li", {}, "GEAR drives ch 5. That's usually the one that works."),
          h("li", {}, "FLAP drives ch 6, but only through the FLAPS menu. If both its positions are set to 0 (common), the switch moves nothing. In FLAPS, set NORM to 0 and LAND to 100 (leave the elevator values at 0), then run the wizard again and use FLAP for throttle hold."),
          h("li", {}, "Want a third switch (e.g. reset)? Two switches can share one channel if each moves it to a different value. If your radio can mix a switch into ch 6 (a programmable mix turned on by the MIX switch), FLAP and MIX can then give ch 6 three positions. The wizard checks that each switch is distinguishable."),
          h("li", {}, "The dual-rate, trainer and throttle-cut switches don't send channels in sim mode, so they can't be used."))),
      h("details", {}, h("summary", {}, "Heli model memory vs ACRO: what's the difference?"),
        h("p", { class: "hint" }, "A heli model memory works, but the radio shapes the sticks before the sim sees them:"),
        h("ol", {},
          h("li", {}, "Flight mode (F MODE) and throttle hold don't get channels of their own. They switch the throttle and pitch curves, so the sim can't see them as switches. That is why your switches didn't show up."),
          h("li", {}, "The collective comes through the pitch curve, so its range and centre depend on the flight mode you're in. If the wizard picked the throttle channel instead, idle up turns it into a V-shaped curve."),
          h("li", {}, "The radio's dual rates and expo stack with the sim's, which can make the sticks feel twitchy or uneven."),
          h("li", {}, "If the swash type is CCPM (120°) rather than 1-servo, aileron, elevator and pitch are mixed together and the sticks won't separate cleanly."),
          h("li", {}, "The gyro gain is usually on the GEAR channel, which then can't be a switch.")),
        h("p", { class: "hint" }, "In ACRO, channels 1–4 are the raw sticks and channels 5–6 are the GEAR and FLAP/MIX switches. That gives the sim clean, linear sticks and two real switches, and the sim does the heli part (curves, idle up, hold) itself. Keep your heli model for the real heli and use a separate ACRO memory for the sim.")),
      h("p", { class: "hint" }, "Keyboard (desktop): W/S collective, A/D rudder, arrow keys cyclic, 1/2/3 flight mode, R reset."),
    ];
  },

  // ---------- transmitter wizard ----------
  startWizard() {
    const steps = [];
    for (const f of FUNCTIONS) {
      steps.push({ kind: "stick", f, end: "lo", text: `Move the ${f.label.toLowerCase()} stick ${f.lo} and hold it there.` });
      steps.push({ kind: "stick", f, end: "hi", text: `Now move the ${f.label.toLowerCase()} stick ${f.hi} and hold it.` });
    }
    steps.push({ kind: "center", text: "Centre the rudder, elevator and aileron sticks and let go." });
    for (const sw of SWITCHES) {
      steps.push({ kind: "switch", sw, end: "off", text: `${sw.label}: set the switch you want to use to ${sw.off}.` });
      steps.push({ kind: "switch", sw, end: "on", text: `${sw.label}: now flip it to ${sw.on}.` });
    }
    const caps = {};
    let i = 0;
    const wiz = this.el.wizard;
    const live = h("div", { class: "live" });
    const render = () => {
      const st = steps[i];
      const optional = st.kind === "switch";
      wiz.replaceChildren(h("div", { class: "wiz-card" },
        h("p", { class: "wiz-step" }, `Step ${i + 1} of ${steps.length}`),
        h("p", { class: "wiz-text" }, st.text),
        live,
        h("div", { class: "row" },
          h("button", { type: "button", onclick: () => { wiz.hidden = true; clearInterval(t); } }, "Cancel"),
          optional ? h("button", { type: "button", onclick: () => skipSwitch(st.sw) }, "No switch for this") : null,
          h("button", { type: "button", class: "primary", onclick: next }, "Next"))));
    };
    // Which channels the sticks are on, from the captures so far.
    const stickChannels = () => {
      const used = [];
      for (const f of FUNCTIONS) {
        const ch = caps[`${f.key}-lo`] && channelFromCaptures(caps[`${f.key}-lo`], caps[`${f.key}-hi`], used);
        if (ch) used.push(ch.index);
      }
      return used;
    };
    // Two switches may share a channel (a 3-position channel, or one channel fed by two
    // switches through a radio mix) as long as each one moves it to its own value.
    const switchProblem = (c, sw) => {
      const off = c[`sw-${sw.key}-off`], on = c[`sw-${sw.key}-on`];
      const sticks = stickChannels();
      const ch = channelFromCaptures(off, on, sticks);
      if (ch) {
        const twin = SWITCHES.find((o) => {
          if (o === sw || c[`sw-${o.key}`] === "skip" || !c[`sw-${o.key}-on`]) return false;
          const oc = channelFromCaptures(c[`sw-${o.key}-off`], c[`sw-${o.key}-on`], sticks);
          return oc && oc.index === ch.index && Math.abs(oc.hi - ch.hi) < 0.25;
        });
        return twin ? `That switch moves ch ${ch.index + 1} to the same place as the ${twin.label.toLowerCase()} switch, so the sim can't tell them apart. Pick a different switch.` : null;
      }
      const any = channelFromCaptures(off, on);
      if (any && sticks.includes(any.index)) {
        const fn = FUNCTIONS[sticks.indexOf(any.index)];
        return `That switch moved the ${fn.label.toLowerCase()} channel (ch ${any.index + 1}) instead of a channel of its own. In a helicopter model memory, flight-mode and hold switches change the throttle and pitch curves rather than sending their own channel, so the sim can't see them as switches.`;
      }
      return "That switch didn't change any channel the dongle sends. On a DX6i in an ACRO model, only GEAR (ch 5) and FLAP (ch 6) send channels, and FLAP only moves ch 6 if the radio's FLAPS menu gives its positions different values.";
    };
    const showProblem = (text, sw) => {
      wiz.replaceChildren(h("div", { class: "wiz-card" },
        h("p", { class: "wiz-step" }, sw.label),
        h("p", { class: "wiz-text" }, "Switch not found"),
        h("p", {}, text),
        h("p", { class: "hint" }, "Fix: use an ACRO (airplane) model memory for the sim with the GEAR and FLAP switches (see Transmitter \u2192 \u201cMore switches\u201d). Or skip it and use the on-screen flight-mode buttons."),
        h("div", { class: "row" },
          h("button", { type: "button", onclick: () => skipSwitch(sw) }, "Skip this switch"),
          h("button", { type: "button", class: "primary", onclick: () => { i = steps.findIndex((x) => x.sw === sw); render(); } }, "Try another switch"))));
    };
    const skipSwitch = (sw) => {
      caps[`sw-${sw.key}`] = "skip";
      while (steps[i] && steps[i].sw === sw) i++;
      i < steps.length ? render() : finish();
    };
    const next = () => {
      const gp = firstGamepad();
      if (!gp) { this.toast("No transmitter seen. Move a stick first."); return; }
      const st = steps[i];
      const snap = snapshot(gp);
      caps.id = gp.id;
      if (st.kind === "stick") caps[`${st.f.key}-${st.end}`] = snap;
      if (st.kind === "center") caps.center = snap;
      if (st.kind === "switch") caps[`sw-${st.sw.key}-${st.end}`] = snap;
      if (st.kind === "switch" && st.end === "on") {
        const problem = switchProblem(caps, st.sw);
        if (problem) { showProblem(problem, st.sw); return; }
      }
      i++;
      i < steps.length ? render() : finish();
    };
    const finish = () => {
      clearInterval(t);
      const map = { id: caps.id, axes: {}, switches: {} };
      const used = [];
      for (const f of FUNCTIONS) {
        const ch = channelFromCaptures(caps[`${f.key}-lo`], caps[`${f.key}-hi`], used);
        if (!ch) { this.toast(`Couldn't find the ${f.label.toLowerCase()} channel. Try again and move the stick all the way.`, 4000); wiz.hidden = true; return; }
        used.push(ch.index);
        map.axes[f.key] = { index: ch.index, lo: ch.lo, hi: ch.hi, center: f.centering ? caps.center[ch.index] : undefined };
      }
      for (const sw of SWITCHES) {
        if (caps[`sw-${sw.key}`] === "skip") continue;
        const ch = channelFromCaptures(caps[`sw-${sw.key}-off`], caps[`sw-${sw.key}-on`], used);  // only stick channels are off limits
        if (ch) map.switches[sw.key] = { index: ch.index, off: ch.lo, on: ch.hi };
      }
      this.app.settings.input.map = map;
      this.changed("input");
      wiz.hidden = true;
      this.toast("Transmitter set up");
      this.openSheet("tx");
    };
    const t = setInterval(() => {
      const gp = firstGamepad();
      live.replaceChildren(...(gp ? snapshot(gp).slice(0, 12).map((v, k) => h("div", { class: "live-ch" }, h("span", {}, `ch ${k + 1}`), h("div", { class: "bar" }, h("i", { style: `left:${50 + Math.max(-1, Math.min(1, v)) * 50}%` })))) : [h("p", { class: "hint" }, "Waiting for the transmitter…")]));
    }, 60);
    wiz.hidden = false;
    render();
  },
};
