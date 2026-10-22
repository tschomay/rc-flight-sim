# rc-heli-sim

A phone-based RC helicopter training simulator, in the spirit of HELI-X: flown with a real Spektrum DX6i through a wireless USB sim dongle, with a flat-screen mode and a Cardboard VR mode, realistic enough in feel and look to train for real flying. Its core is HELI-X-style hover training: held altitude, a target circle, automatic heading rotation, and inverted.

**Status:** `prototyping`. A working web app ("Hover Trainer") with the flight model, hover trainer, transmitter setup, touch sticks and Cardboard VR. Not yet tested on the real phone or transmitter.

## Run it

```sh
cd app
npm install
npm run dev     # builds and serves http://localhost:8080, rebuilding on change
npm test        # flight-model and trainer checks
npm run build   # dist/index.html (one self-contained file) + manifest and icon
```

The phone needs the app served over **HTTPS** for motion sensors (VR head tracking) and installing to the home screen. Any static host works: upload `app/dist/`.

Desktop keys: W/S collective, A/D rudder, arrow keys cyclic, 1/2/3 flight mode, R reset.

## What's in the app

- **Helis:** a generic 450 FBL 3D heli and an mCP X BL2-class micro.
- **Flight model:** 1 kHz, blade-element rotor with dynamic inflow, ground effect, vortex ring, flapping, governor, autorotation, FBL rate control with heading-hold tail. See [docs/physics.md](docs/physics.md).
- **Hover trainer:** pick which of collective, cyclic or rudder the trainer flies. Set the height, circle size (1–4 m), which side faces you, upright or inverted, heading hold, rotate left or right at a set speed, or ±90° swing. Scores time in the circle. One-tap presets: rotating hover, inverted hover, inverted rotating, nose-in.
- **Inputs:** transmitter via the Gamepad API with a setup wizard (finds each stick and switch, any channel order or direction), on-screen mode 2 sticks, keyboard.
- **Flight modes:** Normal, Idle up (symmetric ±12° for inverted), Hold. Set from TX switches or on-screen buttons.
- **Views:** flat, which follows the heli with auto-zoom; Cardboard stereo with lens correction and head tracking; WebXR when the phone offers it.
- **Wind:** speed, direction, gusts. A windsock shows it.

## Docs

- [Feasibility study](docs/feasibility.md): verdict per requirement, platform choice, open questions.
- [Flight model](docs/physics.md): equations, tuning knobs, test results.

## Spikes

- [`spikes/input-probe/`](spikes/input-probe/index.html): one-page browser check for the dongle, WebXR, sensors and GPU.

## Next steps (handoff)

1. Host `app/dist/` over HTTPS (e.g. Vercel or GitHub Pages) and open it in Chrome on the Galaxy S24.
2. Plug in the WS2000, run Settings → Transmitter → Set up transmitter, and fly the 450 in the "Rotating hover" preset.
3. Tune feel against the real heli in `app/src/sim/models.js` (see docs/physics.md "Model parameters"), and re-run `npm test`.
4. Try VR (Cardboard): tap once to centre the view, twice to reset. Adjust lens sliders under View & wind.
5. Open questions: whether the trainer's assists feel like a buddy box; whether the HeliFreak guide's stages (paywalled to us) should become presets.
