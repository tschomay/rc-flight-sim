# rc-heli-sim

A phone-based RC helicopter training simulator, in the spirit of HELI-X: flown with a real Spektrum DX6i through a wireless USB sim dongle, with a flat-screen mode and a Cardboard VR mode, realistic enough in feel and look to train for real flying. Its core is HELI-X-style hover training: held altitude, a target circle, and automatic heading rotation.

**Status:** `exploring`. Feasibility study done; waiting on hardware probe results from the real phone and dongle.

## Docs

- [Feasibility study](docs/feasibility.md): verdict per requirement, platform choice, physics/graphics/VR approach, open questions.

## Runnable

- [`spikes/input-probe/`](spikes/input-probe/index.html): one-page browser check. Plug the dongle into the phone, open the page in Chrome, wiggle the sticks, copy the report. Shows whether the Gamepad API sees the transmitter, each axis's range and update rate, WebXR VR support, motion sensors and the GPU.
