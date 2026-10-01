# The claw: grab fix and feel plan

> **Status in the integrated build.** This page is the record of one of two rival fixes for the grab (pull request #2), kept because its diagnosis and its feel plan shaped the game. The grab itself is now the other fix, the **soul grip** (PROTOTYPE.md §4): on the same 1000 seeded piles it won the part inside the claw 91% of the time against 51% here, and the part aimed at 50% against 25%. What this page contributed lives on top of it:
>
> - **Strain against hold**, rebuilt on the physics with nothing rolled: lurches and speed past the steady speed strain the grip, a grip whose catch can't take it frays and slides, easing off re-seats it ("Phew."), and a grip frayed through tears and the jaws sag open.
> - **One carry meter** under the held part (the catch against the strain, in words: STEADY, STRAINED, SLIPPING!), the creak and the grit of a sliding part, the HOLD STILL hint on the first slip, and the motor groaning lower as the grip strains.
> - **Feedback:** the drop guide's brackets as wide as the closed claw, "Just clipped it." when the claw closed on a part without catching it, grip quality at the close in the playtest report, and the **Grip** group in the tuning panel.
>
> The numbers below are this branch's own and were not regenerated. docs/BALANCE.md has the current ones.

Players reported parts sitting right in the middle of the claw that the claw ignored. The bug wasn't in the physics. The game decided the grab with a hidden dice roll, and the test behind the roll didn't match the claw on screen. This page covers what was wrong, what changed, how it measures now, and the plan for getting the claw feel right.

## 1. Why parts in the claw weren't grabbed

The headless tuner ran 200 grabs through the real simulation. At the moment the claw finished closing, each grab traced the claw's actual cavity (the inner edges of both prongs) and checked what was inside it.

In 68% of grabs, a part was clearly in the claw: its middle was in the cavity, or at least 40% of it was. **In 37% of those grabs, nothing got a grip.** There were four causes:

| Cause | Share of those failures | What the player saw |
|---|---|---|
| **Hidden dice roll.** A part perfectly centered with the prongs fully closed still had only a 50–90% chance (tentacle 50%, sword arm 57%, wings 63%, heart 72%). | 29 of 50 | The claw closes around the part and lifts without it. |
| **Wrong part ranked first.** Candidates were ranked by distance to a fixed point, so the part inside the prongs often came second and got only a 0.3× bonus roll. | 12 of 50 | The part in the middle stays behind. |
| **A box instead of the claw.** "In the claw" meant the part's center point was inside a fixed 32×37 px box. The real cavity is a diamond that changes shape as the prongs open. | 6 of 50 | A part between the prongs doesn't count. |
| **Only two candidates rolled.** | 3 of 50 | |

The same flaws caused the reverse too. **24% of grips attached to a part outside the prongs**, because the box reached below the prong tips. The claw lifted it by magic while the part inside stayed behind.

There were two more problems:

- **A third of well-aimed drops closed on nothing.** The claw is light, and it lands on its open prong tips. The closing prongs (torque 150) out-lever its weight (about 90 N), so the claw climbs back out of the pile and closes on air, right above the part the player aimed at.
- **Long, thin limbs counted as big.** Grab odds used `max(width, height)`, so an 8 px-wide arm was penalized like a torso.

## 2. What changed

### The grab is geometry, not dice

- **The cavity.** `ClawSim.cavity()` traces the claw's real cavity from the prongs' current pose, using the inner outline in `CLAW_GEO.inner`.
- **What counts as grabbed.** A part is grabbed when any one of these holds. There's no roll.
  - its middle is in the cavity
  - at least half of its area is in the cavity (`grabInside`)
  - both prongs squeeze at least a quarter of it
- **Which part it takes.** The claw takes the part it visibly holds best. On a tie, it takes the one nearest its center line, never one picked by an invisible stat like slipperiness.
- **Doubles.** A second part gets a grip only if it's caged or pinched as well. That makes doubles a treat (5–6% of grabs) rather than a regular event.
- **Where the grip attaches.** The grip spring attaches where the claw actually holds the part: the centroid of the enclosed area. A part caught by its end dangles and swings; one held in the middle sits still.
- **Digging in.** While closing, the claw pushes down with twice its weight (`closeDig`), so the prongs dig into the pile instead of levering the claw out.

### Hold: how well it's gripped, out in the open

- **The formula.** Hold runs from 0 to 1 and comes from things the player can see:
  - how much of the part is inside the cavity
  - **caged**: the prongs closed under it, so it can't fall through the mouth
  - **pinched**: both prongs squeeze it
  - slipperiness (hearts and eyeballs are wet)
- **Re-measured on the way up.** Hold is re-measured about 10 times a second as the claw lifts. Once the prongs are free of the pile they keep closing, so a small part becomes caged on the way up and its hold rises.
- **Loose drops.** A part that works its way out of the cavity drops as **loose**.

### Strain versus hold: slips you can see coming, and stop

- **Strain.** Strain is how hard the part is being yanked right now. It's the sum of:
  - the part's weight
  - the carriage lurching
  - the claw swinging
  - spikes from the jolt at the top and from squirming
- **Slipping.** When strain beats hold, the part starts to slide down in the claw. The meter flashes red, the claw creaks, grit falls and the part shudders.
- **Recovering.** Ease off and the claw re-seats it ("Phew.").
- **Dropping.** Keep yanking and the slide feeds on itself: a part that has slid is held by less of the claw. Then the prongs sag open, like a weak arcade claw, and the part drops.
- **Momentum while carrying.** The loaded carriage speeds up and coasts gently (`carryAccel`). It brakes hard only when pushed against its motion (`clawAccel`), and hitting the end stop at speed is worst of all. Aiming is unchanged.

This answers the open problem from PROTOTYPE.md §6.6, that carry skill didn't matter. The old slip signal was the part rattling inside the prongs, which the player can't control. The new strain comes from carriage lurch and claw-head swing, which the player does control.

### Feedback

- **GRIP meter** under the held part. The bar's length shows how good the grab is: a claw closed around the part fills most of it, and a part held by the tips gets a sliver. The bright part is what's left after the current strain. It flashes red while the part slides.
- **Claw status light.** It follows the grip: green, yellow, or flickering red while slipping.
- **Grab flash.** A ring flashes around whatever the claw caught, colored by hold, so the player knows the grab registered.
- **Reaper lines** say what happened:
  - a solid or a loose grab
  - "It's slipping! Hold still!", "Phew."
  - the jolt, yanking, "Only had it by the tips", "pinned under the others", squirming
  - "Just clipped it." when the claw only caught a corner
- **First slip hint.** The first slip shows "HOLD STILL AND IT SETTLES".
- **Sound.** A new `creak` sound plays when a slip starts, and the motor groans lower as strain rises.
- **Drop guide.** The guide now shows brackets as wide as the closed claw, marking what will end up inside it.
- **Tuning panel.** The **Draw physics shapes** toggle used to do nothing. It now draws the collision shapes, the claw's cavity, the grip springs and live hold/strain numbers. The grip settings have their own **Grip** group.
- **Playtest report (P).** It adds grip quality at close, near misses, and slips started versus held on.

## 3. Results

These come from the headless bot with 300 grabs and 5 px of aim noise. The "old" column is the code before this change; the "new" column shows three carry styles.

| | Old (gentle / jerky) | New: careful | New: hasty | New: reckless |
|---|---|---|---|---|
| Win something | 57% / 56% | **66%** | 54% | 55% |
| Nothing lifted | 35% | 23% | 24% | 24% |
| Lifted, then lost | 8% / 9% | 10% | 22% | 21% |
| Won the exact part aimed at | 25% | 28% | 23% | 24% |
| Won two at once | 9% | 6% | 5% | 5% |
| A part's middle in the claw, but not gripped | about 37%* | **1%** | 1% | 1% |
| Gripped a part outside the claw | 24%* | **0%** | 0% | 0% |

\* Measured with the cavity trace in §1, on 200 grabs.

The carry styles are:

- **Careful:** waits for the meter to settle, then eases over.
- **Hasty:** full speed the moment the claw reaches the top.
- **Reckless:** reverses halfway, then slams into the end stop.

What this shows:

- **Recognition is fixed.** The claw takes what's in it.
- **Carrying well pays.** Careful beats hasty by 12 points; before, the gap was 1 point.
- **Fewer empty drops.** Drops with nothing in the claw fell from 35% to 23%.
- **The economy holds.** A mix of careful and hasty players lands near the old win rate, so the token economy still works.

Many parts that were hard to get now do much better, including big ones the old size rule punished. Won-the-part-aimed-at over 800 grabs, old to new:

| Part | Old | New |
|---|---|---|
| Wolf Skull | 19% | 48% |
| Bat Wings | 18% | 41% |
| Ogre Arm | 28% | 40% |
| Stitched Torso | 27% | 38% |
| Crowned Skull | 13% | 25% |
| Heart | 12% | 24% |

Skulls are unchanged, at 25% before and 26% after.

Reproduce with:

```sh
AIM_NOISE=5 STYLE=careful node tools/tune.mjs 300   # also hasty, reckless
```

## 4. The plan

### What "feels right" means here

1. **What you see is what you get.** If a part is in the claw when it lifts, the claw takes it.
2. **Every failure has a cause the player can name.** "I only clipped it", "it slid out of the tips", "it shook loose at the top", "I yanked it", "it squirmed".
3. **Tension lives after the grab, where the player can act on it.** The lift, the jolt and the carry are where you wonder whether it will hold, and where holding still or easing off can save it.
4. **Luck stays, but in the open.** Jolt size, squirming and the pile's physics vary; the rules don't.

### Step 1: playtest this build

Run the PROTOTYPE.md §7 protocol, and also watch for:

- **"It was right there and it didn't take it."** This should be gone. If anyone says it, press **`**, turn on **Draw physics shapes**, and note what the cavity outline shows: was the part really inside the dashed outline?
- **Can players name why they failed?** Ask after a slip or a miss. If they say "random" or "rigged", the feedback isn't landing yet.
- **Do they hold still when the meter flashes?** The report's "started slipping / held on" line counts this. If "held on" stays near zero after the first hint, the save is too hard or too hidden.
- **Does the carry feel sluggish?** Momentum applies only while carrying. If it drags, raise `carryAccel`.
- **The jolt at the top.** It causes the most slips for players who move straight away. If it reads as unfair even with the meter, lower `strainJolt`. If it reads as dramatic, keep it.

These targets are a starting point; move them after the first sessions:

| Signal (from the P report) | Target |
|---|---|
| Win rate for new players | 45–60% |
| Near misses ("only clipped it") | under 15% of grabs |
| Slips held on / slips started | at least 30% once players have seen the hint |
| Retried within 6 s after a fail (the one-more-try rate) | at least 60% |
| "It didn't take it" complaints | none |

### Step 2: tune from what you saw

Every value has a live slider under **`** → **Grip** / **Claw**. Check a change headless before and after:

```sh
AIM_NOISE=5 STYLE=careful node tools/tune.mjs 300
AIM_NOISE=5 STYLE=hasty   node tools/tune.mjs 300
node tools/tune.mjs 300 '{}' strainJolt=0.3,0.5,0.7   # sweep one knob
```

Keep `in-claw-but-ignored` near 0% and `gripped-outside-claw` at 0%. Keep careful at least 8 points ahead of hasty, or carrying stops mattering.

| Symptom | Try |
|---|---|
| Too many drops come up empty | `closeDig` up, or aim practice (check with the drop-guide brackets) |
| Grabs feel solid but boring, nothing ever slips | `strainJolt` up, or `holdFull` down |
| Slips feel random or sudden | `slideRate` down (a slower, more readable slide), `slideMax` up |
| Waiting doesn't save anything | `strainJolt` down, or `slideRate` down |
| Careless carrying never gets punished | `strainLurch` or `strainSwing` up, or `swingSafe` down |
| The carry feels sluggish | `carryAccel` up (at 200 it matches aiming, which removes the momentum) |
| Big parts (torsos, wings) are never worth trying for | `holdFull` up; or see Step 3.4 |
| Too many doubles | a second part needs to be caged or pinched; tighten that in `tryGrab` if needed |

### Step 3: next improvements, in order

These are ordered by expected impact per unit of effort. Items 1 to 3 are small; only move past item 4 once playtests say the grab is fun.

1. **Hear the strain, not just see it.** Add a continuous strain tone that rises with load, like a fishing reel's line tension. Players watch the claw, not the meter. The motor already dips in pitch, so this extends it.
2. **Gamepad rumble** on strain and slips, using the Gamepad API's `vibrationActuator`. The tension becomes physical.
3. **Telegraph twitches.** A living part shivers for about 0.3 s before it twitches, so a squirming slip can be seen coming, like every other slip.
4. **Claw size versus part size.** The earlier tuning found claw size mattered more than any torque. Torsos and wings rarely end up caged (their hold is at most about 0.6). Try a 10–15% larger cavity, or slightly smaller big parts, and measure the caged rate per part.
5. **Show what the claw is about to take.** Before the drop, faintly outline the parts between the drop-guide brackets.
6. **Celebrate saves and heartbreaks.** A beat of slow-mo when a slipping part re-seats, and when a part slips just before the chute. The game already does this for rare parts falling into the chute.
7. **Replays for bug reports.** Log inputs and frame times so a complaint ("it didn't take it!") can be replayed exactly. The real-time sim depends on frame timing, so seeds alone don't reproduce a session.
8. **Recheck the economy after playtests.** Careful players now win about 66% of grabs. If battles get too easy, adjust the Economy sliders, not the grip. The grip should stay honest.
9. **Only if the core is fun: machine personalities.** Claws with different size, strength and momentum, as meta-progression. The hold and strain numbers make "a weak claw" something players can read.

### Open questions

- Is "hold still and it settles" discoverable without the hint? Try a session with the hint off.
- Should the jolt at the top stay random in size, or be the same every time so players can learn it?
- Loose grabs (a part half out of the claw) rise and then slide out. Is that a satisfying near-miss, or a disappointment? If it's a disappointment, drop them sooner, before the part leaves the pile.

## 5. Where the code lives

| What | Where |
|---|---|
| Cavity outline | `CLAW_GEO.inner` in `src/js/05_sprites_parts.js` |
| Grab detection | `cavity`, `clawFrame`, `measurePart`, `holdOf`, `tryGrab`, `attachGrip` in `src/js/11_clawsim.js` |
| Grip, strain and slip model | `updateGrips`, `kickGrip`, `loseGrip` in `src/js/11_clawsim.js` |
| Carry momentum | `driveCarriage(target, h, loaded)` in `src/js/11_clawsim.js` |
| Meter, status light, lines, debug view | `src/js/31_scene_claw.js` |
| `creak` sound | `src/js/08_audio.js` |
| Report counters | `src/js/40_telemetry.js` |
| Tunables | the **Grip** group in `src/js/01_config.js` |
| Bot carry styles and the regression guard | `tools/tune.mjs` |
| Cavity outline in the filmstrip | `tools/physdebug.html` |
