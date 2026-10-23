# rc-flight-sim

A phone-based RC helicopter training simulator, in the spirit of HELI-X: flown with a real Spektrum DX6i through a wireless USB sim dongle, with a flat-screen mode and a Cardboard VR mode, realistic enough in feel and look to train for real flying. Its core is HELI-X-style hover training: held altitude, a target circle, automatic heading rotation, and inverted.

**Status:** `building`. A working web app ("Hover Trainer"), flown with a real transmitter on the phone. Incubated in [tschomay/Sandbox](https://github.com/tschomay/Sandbox) as `rc-heli-sim`; deployed on Vercel from `main` (`app/` is the project root, see `app/vercel.json`).

## Run it

```sh
cd app
npm install
npm run dev     # builds and serves http://localhost:8080, rebuilding on change
npm test        # flight-model and trainer checks
npm run build   # dist/index.html (one self-contained file) + manifest and icon
```

The phone needs the app served over **HTTPS** for motion sensors (VR head tracking) and installing to the home screen. Any static host works: upload `app/dist/`.

Desktop keys: W/S collective, A/D rudder, arrow keys cyclic, 1/2/3 flight mode, R reset, [ and ] sim speed.

## What's in the app

- **Helis:** a generic 450 FBL 3D heli and an mCP X BL2-class micro.
- **Flight model:** 1 kHz, blade-element rotor with dynamic inflow, ground effect, vortex ring, flapping, governor, autorotation, FBL rate control with heading-hold tail. See [docs/physics.md](docs/physics.md).
- **Hover trainer:** pick which of collective, cyclic or rudder the trainer flies. Set the height, circle size (1–4 m), which side faces you, upright or inverted, heading hold, rotate left or right at a set speed, or ±90° swing. Scores time in the circle (a column at any height, or a ±1/±2 m window); leaving it can count as a crash, like HELI-X. One-tap presets: rotating hover, inverted hover, inverted rotating, nose-in.
- **Flight school (optional):** ArchmageAU's guide ["From tail-in to all 8s and funnels in 6 months"](https://www.helifreak.com/showthread.php?t=531380) (HeliFreak, 2013), built in with credit. Lessons 1–12, timed sessions, automatic crash counting, and the guide's log and session rules (speed up/down, alternate direction, hand over the collective, advance). The log is editable, the next session can be overridden, and the log exports as CSV.
- **Sim speed:** 20–100%, as the guide asks for.
- **Stick feel:** Gentle/Sport/3D rate and expo presets, optional self-levelling (stability) mode.
- **Inputs:** transmitter via the Gamepad API with a setup wizard (finds each stick and switch, any channel order or direction), on-screen mode 2 sticks, keyboard.
- **Flight modes:** Normal, Idle up (symmetric ±12° for inverted), Hold. Set from TX switches or on-screen buttons.
- **Views:** flat, which follows the heli with auto-zoom; Cardboard stereo with lens correction and head tracking (or without, following the heli); WebXR when the phone offers it.
- **Wind:** speed, direction, gusts. A windsock shows it.

## Docs

- [Feasibility study](docs/feasibility.md): verdict per requirement, platform choice, open questions.
- [Flight model](docs/physics.md): equations, tuning knobs, test results.

## Spikes

- [`spikes/input-probe/`](spikes/input-probe/index.html): one-page browser check for the dongle, WebXR, sensors and GPU.

## Transmitter notes

Use an ACRO (airplane) model memory for the sim: channels 1–4 come through as raw sticks and the GEAR and FLAP/MIX switches as channels 5–6. In a heli model memory the flight-mode and hold switches only change the throttle/pitch curves, so the sim can't see them as switches, and the radio's curves, rates and swash mixing shape the sticks. The setup wizard explains this when it happens.

## Next steps

1. Fly the flight school on the phone with the DX6i in an ACRO memory; check the session rules feel right.
2. Tune feel against the real heli in `app/src/sim/models.js` (see docs/physics.md "Model parameters"), and re-run `npm test`.
3. Ideas: compass markers for 8-point piros, circle/8 path guides for lessons 6–12, sound, a lighter phone render mode.
