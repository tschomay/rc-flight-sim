# Flight model

_How `app/src/sim/heli.js` works, what each term is for, and where to tune feel._

The model runs at a fixed **1 kHz** step. Axes: world y up, pilot at the origin looking down −z. Body x is the nose, y the mast, z the right side.

## Pieces, in the order the step runs them

| Piece | What it does | Why it matters for feel |
|---|---|---|
| **Governor + motor** | PI loop holds the flight mode's headspeed; motor torque is capped by max power. Throttle hold sets motor torque to 0. A soft-start ramp spools up after hold. | Headspeed sags a little on a hard punch and recovers. Throttle hold leads straight into a real autorotation. |
| **Flybarless controller** | Rate controller on roll, pitch and yaw: feed-forward plus P plus I, with anti-windup. Full stick gives the configured rate. Releasing the stick holds attitude. The I-term bleeds off while sitting on the skids, as real FBL units do. | This is why a modern heli doesn't self-level: it stays where you leave it. Tail is heading-hold. |
| **Main rotor thrust** | Blade-element thrust `CT = σa/2·[θ(1/3 + μ²/2) − λ/2]`, with inflow from momentum theory (Glauert) solved by Newton each step. | Correct thrust for any climb, descent or forward speed. Gives translational lift for free. |
| **Dynamic inflow** | Induced velocity lags its steady value (`inflowTau`). | A collective punch overshoots, then settles: the "float". |
| **Ground effect** | Cheeseman–Bennett `1/(1 − (R/4z)²)`, fading with airspeed and bank. | The cushion near the ground. |
| **Vortex ring state** | Descending at 0.3–1.8× hover induced velocity at low airspeed: random thrust loss and wobble. | Punishes straight-down descents like the real thing. |
| **Rotor torque** | Induced + climb + profile drag, `CQ = CT·λ + σCd/8·(1 + 4.6μ²)`, profile drag rising with blade loading. | Loads the governor. In autorotation λ goes negative and the air drives the rotor. |
| **Disc flapping** | Disc tilt is a first-order state. It chases the swash cyclic plus blowback with time constant `flapTau`, and lags fuselage rotation. | Rotor damping, a short control lag, and the nose-up pitch with forward speed that the FBL works against. |
| **Hub moment** | `hubStiffness·tilt` plus thrust acting at the hub above the CG. | Control power. Inverted, thrust-offset reverses and the stiff hub carries control, like a 3D head. |
| **Tail rotor** | Thrust with a lag (`tau`), limited to its range. A main-driven tail loses authority with headspeed; a motor-driven tail (mCP X) doesn't, but only pushes one way. Aerodynamic damping gives yaw damping and weathervaning. | Torque on collective changes, tail blow-out limits, weathervane in wind. Tail thrust also causes the real translating-tendency drift. |
| **Fuselage drag** | Quadratic drag per body axis. | Top speed, wind push. |
| **Ground contact** | Spring-damper skids with stick-slip friction. Blade or tail strikes, nose or fin hits, and landing faster than 3 m/s end the flight. | Takeoffs and landings, and the crash rules trainees learn by. |

## Model parameters

`app/src/sim/models.js`. Mass and rotor size come from published specs (mCP X BL2: 263 mm rotor, 62 g). Inertias, hub stiffness and drag areas are engineering estimates, meant to be tuned by feel:

- **Twitchier / softer cyclic:** `hubStiffness` (control power), `flapTau` (lag and rotor damping), or just the in-app rate slider.
- **Floatier collective:** `inflowTau`.
- **More / less power:** `motor.maxPower`.
- **Tail authority:** `tail.thrust` range and `tail.tau`.
- **Headspeed per mode:** `headspeed`. Pitch range per mode: `pitch`.

## Checked behaviour

`npm test` runs these on both helis (all pass):

| Check | 450 FBL | mCP X class |
|---|---|---|
| Hover blade pitch at idle-up headspeed | 3.7° | 4.2° |
| Hover power (shaft) | ~90 W | ~6 W |
| Inverted hover stick mirrors upright | ✓ | ✓ |
| Full cyclic reaches set rate (360 / 400°/s) | ✓ | ✓ |
| Full rudder reaches set rate, stops within 0.3 s | ✓ | ✓ (slower stop in the one-way tail direction) |
| Attitude holds after stick release | ✓ | ✓ |
| Full collective climb | ~11 m/s | ~7 m/s |
| Throttle-hold autorotation descent | ~5.5 m/s | ~4 m/s |
| Sits still on skids; takes off and lands | ✓ | ✓ |
| Drop from 8 m, or a bank near the ground, ends the flight | ✓ | ✓ |
| Trainer holds hover in a 3 m circle, upright and inverted, in 3 m/s gusty wind | ✓ | ✓ |
| Trainer heading tracks left/right rotation and ±90° swing within 15° | ✓ | ✓ |

## Hover trainer assists

`app/src/sim/trainer.js`. Each assist drives the same sticks a pilot would, through the same FBL, so the heli still moves like a heli:

- **Collective:** height error → wanted vertical acceleration → thrust along the mast (sign flips when inverted) → blade pitch from the current inflow → stick.
- **Cyclic:** position error → wanted horizontal acceleration (capped at 25° tilt) → wanted mast direction (flipped when inverted) → attitude error in body axes → roll/pitch rate → stick.
- **Rudder:** heading error plus the target's own rotation rate → yaw rate about the mast → stick.

"Trainer strength" scales all three loops from gentle to tight.
