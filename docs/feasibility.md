# Feasibility study: phone-based RC helicopter trainer

_2026-10-21 · status: exploring_

**Question:** Can we build an RC helicopter training sim, that runs on an Android phone, has a flat-screen mode and a Cardboard VR mode, is flown with the owner's real Spektrum DX6i through a wireless USB sim dongle, and flies and looks close enough to the real thing to be useful training?

**Short answer: yes, with one hardware question to settle first.** Every piece has been done before on phones or in browsers. The one real unknown is whether Chrome on Android exposes the dongle through the Gamepad API (the native-app route almost certainly works either way). The [Transmitter Probe](../spikes/input-probe/index.html) spike answers it in five minutes on the actual phone.

## Requirements, as stated

| # | Requirement | Verdict |
|---|---|---|
| R1 | Runs on the phone (web app or native Android) | ✅ Both are viable. Web first, native wrapper as fallback. |
| R2 | Flat-screen mode | ✅ Easy |
| R3 | Cardboard VR mode | ✅ Feasible. Head-only tracking (3DoF) is all a standing RC pilot needs. |
| R4 | Fly with the real DX6i via the USB dongle and OTG adapter | 🟡 Very likely. Native Android: near-certain. Browser: verify with the probe. |
| R5 | One or two helicopters (planes optional) | ✅ Scope fits. |
| R6 | Physics realistic enough to feel like the real heli | ✅ Feasible. Needs careful tuning, not new science. |
| R7 | Graphics that read as a real heli at a real field | ✅ Feasible. Photo-panorama scenery is the trick. |
| R8 | Hover training: fixed-height hover, target circle, auto-rotating heading | ✅ Straightforward once the physics exists. |

## 1. Transmitter input (the critical path)

**Hardware chain:** DX6i → 2.4 GHz DSM2/DSMX → wireless sim dongle → USB-A → USB-C OTG adapter → phone.

- Spektrum's own **WS2000** dongle is sold for "PC, Mac **or Android**" and enumerates as a standard USB HID game controller with no drivers ([Horizon Hobby](https://horizonhobby.com/wireless-simulator-usb-dongle-spmws2000)). Android sims (Absolute RC Plane Sim, FPV FreeRider) are listed as working with it. So the phone side of the chain is proven. (The WS2000 is now listed as discontinued; generic DSM2/DSMX sim dongles behave the same way.)
- **Which dongle the owner has is still open** (WS1000, WS2000 or a third-party one). If it already works on a PC as a joystick, it is almost certainly a plain HID joystick and Android will see it.
- **Native Android:** Android reads HID joysticks as `InputDevice` with `SOURCE_JOYSTICK` and delivers every axis through `MotionEvent.getAxisValue()`. Near-certain to work.
- **Web (Chrome on Android):** Chrome's Gamepad API on Android sits on the same `InputDevice` layer, so it should see the dongle, but we found no first-hand report of an RC dongle in Chrome on Android. Risks: Chrome may drop or reorder some axes, and the DX6i's 6 channels may not all come through. **This is what the probe tests.**
- **Latency:** DSM2 frames are 22 ms (11 ms in DSMX), plus USB polling (~1–8 ms) and one display frame (~16 ms). Total ~40–50 ms is comparable to PC sims with the same dongle. Fine for training.
- **Radio setup:** The DX6i in heli mode applies its own pitch/throttle curves, swashplate mix and gyro channel before transmitting. Two choices:
  1. Use a dedicated **ACRO (airplane) model memory** with everything linear, and do curves, expo and modes in the sim (the usual advice for sims; clean and predictable).
  2. Use the real **heli model memory**, so the pilot trains with their actual curves and throttle-hold switch. Closer to the real thing, but the sim must read pitch from CH6 and treat CH1 as throttle.
  Both should be supported; option 2 is a selling point.

## 2. Platform: web app vs native

| | Web app (PWA, three.js) | Native Android (Unity) |
|---|---|---|
| Transmitter input | Gamepad API: probably fine, verify | `InputDevice`: certain |
| Cardboard VR | WebXR `immersive-vr` if Chrome offers it on this phone, else our own stereo + `deviceorientation` (works everywhere) | Google Cardboard XR Plugin for Unity (open source, but Google stopped active work in 2020) |
| Graphics ceiling | Good (WebGL2; WebGPU where available) | Higher, with better mobile GPU tooling |
| Physics at 500–1000 Hz | Easy in JS, or Rust/C compiled to WASM in a worker | Easy (C#) |
| Iteration speed | Very fast; install via a link; Claude can build and test it in a sandbox | Slower; needs Unity, Android builds, sideloading |
| Head start | none | [HoverHere](https://github.com/zulugithub/HoverHere): open-source (GPLv3) Unity RC heli trainer with rotor flapping, motor/governor, gyro and flybarless models |

**Recommendation:** start as a **web app**. It is the fastest path to "does this feel like flying?", it installs to the home screen, and it can be wrapped as a native Android app later (Capacitor or a TWA) if the browser drops the dongle; the wrapper can read `InputDevice` and pass axes to the web code. Keep HoverHere as the physics reference and as the fallback platform. Its GPL license means copying its code makes our project GPL; reading it for equations does not.

## 3. Flight physics

Established desktop sims use blade-element style models with tunable rotor inflow, ground effect, tip loss, stall and autorotation, with per-model mass, inertia, rotor geometry, RPM and curves. HoverHere uses ~30 coupled ODEs integrated with Runge-Kutta in a high-rate thread. Neither needs a desktop CPU: a single small helicopter's state integrates at 1 kHz in well under 1 ms per frame on a phone.

What "feels like a real heli" needs, in order of importance:

1. **6-DOF rigid body** with real mass and inertia, gravity, quaternion attitude.
2. **Main rotor thrust** from collective and head speed, with **momentum-theory inflow that lags** (the "float" after a collective punch), **translational lift**, and **ground effect** (the cushion and wobble near the ground).
3. **Rotor disc dynamics:** cyclic tilts the disc with a short lag; the fuselage follows. This produces drift and pendulum feel.
4. **Tail rotor and torque:** collective changes main-rotor torque, so the nose wants to swing. The tail gyro (heading hold) fights it with a finite gain.
5. **Flybarless controller:** most modern helis (and certainly 3D ones) fly through a rate-commanded FBL unit. Modelling a simple rate PID on roll, pitch and yaw makes the heli feel right and is easier than modelling a flybar. A flybar/coaxial "trainer" model can come later.
6. **Head speed and governor:** RPM sag under load, throttle hold, autorotation.
7. **Drag, wind and gusts:** airframe drag, steady wind with turbulence. Wind matters a lot for hover training.

Two airframes cover it: a **~450–500 size flybarless 3D heli** and either a **micro (Blade 130/230 class)** or the owner's own heli. Tuning: start from published specs (mass, rotor diameter, head speed), then fly-tune against the owner's sense of the real thing. Desktop sims retune their physics with instructors too, so expect tuning to be iterative work, not a one-off.

**Risk:** "feels right" is subjective and only the pilot can judge it. Mitigation: get a flyable prototype in front of the owner early and expose the key tuning knobs in-app.

## 4. Graphics

The camera is a pilot standing still on the field. That allows a cheap trick desktop sims rely on: **photographic 360° panoramas** as scenery, with an invisible ground plane for shadows and collisions. From a fixed eye point a good panorama looks photoreal, costs almost nothing to render, and works perfectly in VR because the pilot only turns their head. The owner can even shoot their own flying field with a phone's panorama mode or a 360° camera.

On top: a decent glTF helicopter model (CC-licensed models exist; or a commissioned/handmade one), spinning-blade blur discs, a real-time shadow under the heli (a key depth cue for hover), and sound (head-speed whine, tail buzz) for orientation and load. This is comfortably within a mid-range phone's GPU at 60 fps, and in VR at 2 × 60 fps.

**Expected look:** clearly a real heli at a real field; not AAA polish, but closer to a desktop sim like RealFlight than to a phone game.

## 5. VR (Cardboard)

The pilot stands still and only turns their head, so **3DoF head tracking** is enough. That's exactly what Cardboard gives.

- **Path A:** WebXR `immersive-vr`. Chrome on Android's WebXR is mainly for AR via ARCore; Cardboard support in current Chrome is unconfirmed (caniuse lists Android Chrome as "partial"). The probe checks this phone.
- **Path B (works everywhere):** our own side-by-side stereo render with lens-distortion correction, driven by `deviceorientation` (or `Sensor` APIs). three.js has the parts. Phone gyro tracking is a little laggy but fine for following a heli.
- In VR the pilot can't see the screen UI; menus need a gaze or transmitter-switch control.
- **Practical note:** the phone in a Cardboard viewer plus a USB dongle hanging off it is awkward but workable; a short right-angle OTG cable helps. Battery drains fast with the screen, GPU and USB host all busy. Plan sessions of 20–30 minutes, or use an OTG Y-cable that also charges.

## 6. Training modes

What a good desktop sim's trainer offers. The hover trainer is the core of what the owner wants:

- **Hover training:** pick which axes the sim flies for you (e.g. it holds altitude and you fly cyclic), set the height, which side of the heli faces you (tail-in, side-in, nose-in), **constant rotation speed and direction, or "swing"** (oscillate ±90°). Importantly, the assist should fly like a teacher would: it doesn't pin the heli in place, it corrects like a buddy-box instructor, with a fast/robust slider.
- **Target circle / box:** keep the heli inside a ring of chosen diameter (1 m, 3 m) on the ground; time-in-zone scoring.
- **No-collective training:** height held, collective ignored, practice cyclic only.
- **Crash-and-retry:** rewind a few seconds on crash.
- Others for later: autorotation trainer with stall meter, promenade (walk around the heli), reaction (recover from random attitudes), balloons, cargo, cage.

These are simple controllers and game logic on top of the physics. The "teacher-like" assist is a set of PID loops whose outputs mix with the pilot's sticks; the circle game is a distance check and a timer.

## 7. Expected outcome

| Area | Expectation |
|---|---|
| Transmitter on phone | Works natively for sure; in the browser very likely |
| Hover feel | Close to a desktop sim for hover and slow flight after tuning; 3D/aerobatic fidelity harder |
| Visuals | Photoreal field from panoramas, good heli model; well short of AAA but convincing |
| VR | Workable 3DoF Cardboard mode; comfort depends on phone and viewer |
| Training | Full hover trainer with circle, height-hold and auto-rotate: yes |

## 8. Proposed next steps

1. **Run the probe** on the phone with the dongle and send back the report (go/no-go for the web path, axis map, whether WebXR VR is offered).
2. **Physics spike:** a flat-screen web prototype with one 450-class FBL heli, a grass plane, a shadow, and a hover circle. The owner judges the feel. This is the main fidelity risk, so it goes first.
3. **Scenery spike:** one 360° panorama of a real field with a ground shadow.
4. **VR spike:** side-by-side stereo with head tracking; check comfort and frame rate.
5. Then the training-mode work.

## Open questions for the owner

- Which dongle exactly (brand/model)? Does it already work on a PC sim?
- Which phone (model / Android version)? This sets GPU budget and VR quality.
- Which helicopter(s) do you fly now? Size, flybarless or flybar, any SAFE/self-levelling?
- Skill level and training goal right now: tail-in hover, side-in, nose-in, forward flight, 3D?
- Mode 2 (throttle left)? Do you want to train with your real heli curves and throttle hold on the radio, or a neutral sim memory?
- Is Android-only fine, or should iPhone/iPad ever matter? (iOS Safari has no WebXR VR, and USB HID gamepad support there is limited.)
- Do you want sound? It helps a lot with head-speed sense.
- Is "your own field" as scenery appealing (you shoot a 360° photo)?

## Sources

- Spektrum WS2000 dongle: <https://horizonhobby.com/wireless-simulator-usb-dongle-spmws2000>
- HoverHere (GPLv3 Unity RC heli sim): <https://github.com/zulugithub/HoverHere>
- helisim (blade element + finite-state wake model): <https://github.com/plafl/helisim>
- Google Cardboard XR Plugin for Unity: <https://developers.google.com/cardboard/develop/unity/quickstart>, <https://opensource.googleblog.com/2020/05/google-cardboard-xr-plugin-for-unity.html>
- WebXR support table: <https://caniuse.com/webxr>
