# The Good Parts: prototype notes

> A claw machine run by a Reaper. Grab body parts, stitch them into monsters, send them to fight, earn tokens, grab again.

## 1. The question

**Is grabbing parts with a physics claw fun enough to be the heart of a monster-building game?**

That question breaks into two things to watch for:

1. **The grab creates "one more try" tension.** You spend a token, the claw drops, closes, lifts, and you wonder whether it will hold.
2. **Winning a part that way makes you care about the creature you stitch from it.** Your creatures fall apart when they die, and their parts go back into the machine.

Everything else (the slab, the battles, the Reaper) exists only to give the grab stakes. If the grab isn't fun, nothing downstream will save it.

## 2. How to play

Open `index.html` in any modern browser. It's one self-contained file and works offline.

| Where | Controls |
|---|---|
| Shop (hub) | Click the signs: **COLLECT** (claw), **COMBINE** (slab), **COMMAND** (graveyard). Keyboard: ↑↓ and Space. |
| Claw | **← →** move (or **hold the mouse or a finger on the glass** to steer toward the pointer) · **Space/Enter/Z** drop (press again mid-drop to stop early) · steer to the chute · **Space** releases · **Esc/X** back. There are on-screen buttons for mouse and touch, and a gamepad works too (d-pad, A, B). |
| The Rig (claw) | **Q / E** nudge the glass · **1** quake · **2** iron grip (press again to take it back) · **3** order (then pick a slot with **1-6** or the mouse) · **4** redo after a failed grab. Gamepad: LB / RB nudge, X quake, Y iron grip. Hover a lever for its cost and effect. See §10. |
| Slab | Click a part to stitch it on. Click a slot to take it off. **BRING TO LIFE** when you're ready. You can have up to 3 creatures; click a portrait twice to unstitch it. |
| Graveyard | **FIGHT**, then **ZAP** (heals 30% and hastes, on a cooldown). **RETREAT** keeps survivors but earns no reward. |
| Anywhere | **M** mutes · **F** goes fullscreen · **`** (backquote) or the ⚙ button opens the tuning panel · **P** opens the playtest report. |

**The loop:** tokens pay for grabs, grabs give parts, parts become creatures, creatures win battles, and battles pay tokens and drop new parts into the machine. Dead creatures go back into the pile too.

Handy URL flags for testing:

- `?scene=claw|slab|battle` starts in a scene.
- `?parts=1` fills the bag with parts.
- `?party=1` gives you two ready creatures.
- `?tokens=30` sets your tokens.
- `?seed=7` makes the pile the same every time.
- `?luck=8` sets your Luck. `?rig=0` turns the Rig off entirely (the original claw).

## 3. Scope (kept deliberately small)

- One machine, one graveyard lane, one enemy family. It has three sizes: Wisp, Shade, and a Wraith boss every 5 stages.
- 24 part types filling 8 attachment points (head, torso, 2 arms, 2 legs, heart, back). There are 4 rarities and 15 traits, such as Wolf Skull *Bite*, Tentacle *Reach*, Black Heart *Undying* and Heart of Gold *+1 token per kill*.
- Any combination of parts is a valid creature. No legs means it crawls, no arms means it bites, no torso means it's mostly stitches. Names come from the parts ("Barnaby No-Legs", "Gus the Tentacular").
- **No save system, on purpose.** Refreshing starts a new run. No meta-progression and no shop upgrades.
- **The Rig** (§10) is the one layer added on top of the claw: a Luck meter and five levers that bend the claw's luck. `?rig=0` removes it, so the original question can still be tested.

## 4. How the claw works (the part that has to feel good)

- **Physics.** The pile, the cable and the claw are real rigid bodies (planck.js, a Box2D port). The claw hangs on a cable that pays out as it drops. It detects landing when the cable goes slack, closes two motor-driven prongs, winches up, and swings as you steer.
- **Hybrid grip.** Pure friction grip was unplayable (see §6). The prongs still close physically, but whatever ends up inside the claw's cavity can get a springy grip. The chance depends on how centered it is, how big it is, how slippery it is (hearts and eyeballs are wet), and whether the prongs actually closed.
- **Slips.** Slipping is an explicit, tunable chance:
  - a small risk every second while carrying
  - extra risk if the part swings hard
  - a classic arcade "jolt" at the top of the lift
  - a chance that a living part twitches out of the claw (hands, tentacles, hearts and tails twitch in the pile too)
- **Juice.** The key feedback, in the order it happens:
  - **Machine noise:** the motor hum's pitch follows the carriage speed and the load.
  - **Landing:** a thunk, dust and a small screen shake. The prongs ratchet as they close and the winch spins up.
  - **Held part:** its name and rarity are labelled while you carry it.
  - **Win:** the chute catch hit-pauses, the bulbs chase, and the prize flies into your bag. Rare catches get slow-mo; legendaries get a gold flash.
  - **Life in the pile:** eyeballs follow the claw, hearts pulse, and legendaries sparkle.
  - **The Reaper** comments on everything.

## 5. Tools for finding the fun

- **In-game tuning panel** (the **`** key). Every number in `src/js/01_config.js` gets a live slider: claw speeds and torques, slip odds, twitchiness, pile size, economy and battle multipliers, and juice amounts. **Copy values** puts your changes on the clipboard so you can paste them back into the config. It also has cheats: +5 tokens, refill the machine, drop in a legendary, +6 parts, win the battle.
- **Playtest report** (the **P** key). It logs grabs, wins, slips (with the reason), misses and doubles. It also counts **one-more-try retries**, meaning the player drops again within 6 seconds of a fail, versus leaving the machine after a fail. Plus creatures made, battles, stages reached, and time spent per scene. Copy it after watching someone play.
- **`tools/tune.mjs`** runs the *real* claw simulation headless in Node, with a bot that aims with human-like noise. Example: `node tools/tune.mjs 300 '{"gripAssist":0.2}' gripTorque=40,60,80` sweeps any setting.
- **`tools/battle_sim.mjs`** runs the real battle code headless against random parties to check the difficulty curve.
- **`tools/rig_check.mjs`** runs the Rig's physics and rules headless and asserts on them (quake shuffle quality and safety, exact rewind, Iron Grip odds, the odds badge, Luck economy, TILT, a random-action fuzz). Run it after any change to `11_clawsim.js`, `12_clawrig.js` or `29_rig.js`.
- **`tools/physdebug.html`** draws a grab as a filmstrip of physics shapes. That's how the grip problems in §6 were found.

## 6. What I tested and what happened

These tests were automated (bots and headless simulation), not human playtests. They tune the machine; they don't answer the question. The human tests in §7 do that.

1. **Friction-only grip was hopeless: 0–14% of grabs lifted anything.** Parts wedged in the pile block the prongs. Round parts get squeezed out downward like watermelon seeds. Real rigged claw machines behave exactly like this, but in a game it reads as broken. **I switched to the hybrid grip above.**
2. **Claw size relative to the parts mattered more than any torque setting.** Doubling the claw's inner cavity took lifts from about 7% to about 30%. Changing the torque from 120 to 700 moved lifts by only about 1 point.
3. **The machine cuts the claw's power after it closes,** so it closes hard and then holds weakly. That's how real arcade claws behave. It also produces the "it had it, then dropped it at the top" moment.
4. **"Slips" came mostly from how the sim measured the grip, not from what the player did.** Spinning the winch up smoothly and damping held parts fixed most of it.
5. **Current baseline** (200 bot grabs, 5 px aim noise):

   | Outcome | Rate |
   |---|---|
   | Win something | ~50% |
   | Lift something | ~63% |
   | Slip mid-carry | ~12% |
   | Win two parts at once | ~7% |
   | Win the exact part aimed at | ~25–28% |

   Aim decides *which* part you get more than *whether* you get one.
6. **Carry skill doesn't matter yet.** Gentle and jerky steering bots win about the same (52% vs 50%). The slip risk is dominated by the part wobbling inside the prongs, and with digital input there's no way to steer gently. *This is an open design problem* (see §8).
7. **Battle curve** (headless, Zap used on cooldown). The Stage 5 boss is a deliberate wall that needs a full party of three.

   | Party | S1 | S2 | S3 | S4 | S5 (boss) | S8 | S10 |
   |---|---|---|---|---|---|---|---|
   | 1 creature, 3 parts | 100% | 93% | 40% | 18% | 0% | 0% | 0% |
   | 1 creature, 5 parts | 100% | 100% | 95% | 60% | 5% | 10% | 0% |
   | 2 creatures, 4 parts | 100% | 100% | 100% | 83% | 18% | 5% | 3% |
   | 3 creatures, 5 parts | 100% | 100% | 100% | 100% | 95% | 70% | 35% |
   | 3 creatures, 7 parts | 100% | 100% | 100% | 100% | 100% | 98% | 73% |

   By Stage 5 you've earned about 28 tokens, which is roughly 14 parts at the current odds. That's enough for three 5-part creatures if you spend them well.
8. **Soak test.** Four bots mashed random keys and clicks for 90 seconds each across all four scenes (stitching, winning and losing battles, retreating). There were no script errors.
9. **Bugs the tools caught before any human saw them:**
   - Claw bodies fell asleep, so the motors did nothing.
   - The "landed" check fired at the top of the machine.
   - Parts spilled into the chute on their own. The guard was raised.
   - A part-roll bug put skulls where hearts or torsos should be.

## 7. How to playtest it (the real test)

Don't explain anything. Hand over the laptop and watch. Afterwards press **P** and copy the report.

Watch for:

- **The first 60 seconds.** Do they find the claw, understand move → drop → steer → release, and see that the chute is the goal?
- **One more try.** After a slip or miss, do they drop again immediately? The report's *retried within 6s* counts this, and *left the machine* counts giving up. Watch for leaning in and any reaction when a part slips at the top.
- **Wanting specific parts.** Do they chase the glowing rare or legendary part, or grab whatever is closest? Do they talk about a *specific* part they want?
- **Attachment.** Do they read their creature's name out loud? Do they rebuild or unstitch? Do they react when a creature falls apart?
- **Where the time goes.** Check the report's time per scene. If the slab and graveyard feel like chores between grabs, that's useful information too.
- **The ending.** Do they ask to keep going after the Stage 5 Wraith, or after losing?
- **The Rig.** Do they find the Luck meter and try a lever within a few grabs? Do they reach for Redo after every miss (which would kill the tension of a token)? Is TILT a fair warning or a trap? Do they aim at the green-badged part? For an A/B, run the same kind of tester on `?rig=0` and compare the report's one-more-try rate and grabs per session. The report's "THE RIG" lines show lever use, Luck flow and the win rate of grabs made after a lever versus plain grabs.

Log each session with this template:

| Tester | Minutes | Grabs | Win % | Retries <6s / fails | Best stage | Creatures | Notable moments / quotes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 8. Next steps

**If the answer is yes**, meaning people retry and chase parts:

- Make carrying a skill. Tie the slip risk to carriage acceleration, not wobble. Or give the carriage momentum so holding a direction speeds it up and tapping is gentle. Or show a wobble meter.
- Give parts from the same creature a set bonus (e.g. a full ogre), so players chase *specific* parts.
- Let players see the next restock falling into the machine before they fight, to set up "I want that".
- Only then look at meta-progression: claw upgrades, more machines, more enemy families.

**If the answer is no**, stop. Kill signals:

- Testers stop grabbing as soon as the free tokens run out.
- Slips feel unfair rather than dramatic ("it's rigged").
- The fun turns out to be in stitching or battling rather than the claw. If so, follow that surprise: it's a different game.

## 9. Code map

Plain JavaScript files with no framework. `node tools/build.mjs` joins `src/js/*.js` in filename order with the vendored planck.js into a single `index.html`. `dev.html` loads the same files separately for quick edit-and-refresh.

| File | What it does |
|---|---|
| `01_config.js` | every tunable number, and the metadata the panel's sliders are built from |
| `03_palette.js` `04_sprites_core.js` `05_sprites_parts.js` `06_sprites_world.js` | pixel-art palette, sprite system, body parts and claw, characters, props and icons |
| `07_font.js` | hand-made bitmap fonts |
| `08_audio.js` | all sound effects and 4 music loops, synthesized with WebAudio (no audio files) |
| `10_parts.js` | the part list, traits and rarity |
| `11_clawsim.js` | the machine: physics, claw state machine, grip and slip model (runs headless) |
| `12_clawrig.js` | the Rig's physics, mixed into the sim: quake, nudge, chute lid, drop lock, odds preview, turn recording and rewind (runs headless) |
| `20_engine.js` | canvas, input, scenes, shake, hit-pause, slow-mo, particles, UI |
| `21_backgrounds.js` | shop, lab and graveyard backgrounds |
| `29_rig.js` | the Rig's rules: Luck, costs, TILT heat, `Rig.use()` (runs headless) |
| `30_game.js` `31`–`35` scenes | game state, claw, creatures and rig, slab, battle, shop |
| `40_telemetry.js` `41_debug.js` | playtest report and tuning panel |

## 10. The Rig: the RNG manipulation layer

**Why.** The claw is the purest luck machine there is, and the open problem in §6 and §8 is that slips feel "rigged". A luck game stays fun while the player can *push* the luck, so the claw gets a layer for that: bad luck becomes a resource, and the resource buys levers.

**What.** A **Luck** meter (8 horseshoes) fills from misses (+1), slips (+2) and battles (+1). Five levers spend it, each bending a different random decision:

| Lever | Cost | Re-rolls | How |
|---|---|---|---|
| **Quake** | 3 | the layout | About 1.8 s of shaped velocity shocks to every part: a P-wave, a rumble of coherent slosh, an aftershock. Drops lock until the pile settles. |
| **Nudge ◀ ▶** | free | the layout, locally | A sideways bump with a hop, strongest under the claw. The fourth quick nudge trips **TILT** (claw locks ~3 s, -1 Luck). |
| **Iron Grip** | 2 | grip and slip | Next drop only: hold chance x1.4, slip odds cut to 12%. Does not fix aim. |
| **Order** | 4 | composition | Pick a slot; one part of that slot drops in at a random spot. Rarity is still rolled. |
| **Redo** | 3 | the outcome | After a miss or slip, rewinds the world to the moment before the drop (every part and the claw are recorded ~30x/s), refunds the token, and rolls again. |

A **Lens** shows the odds: the estimated hold chance of the part under the claw on the drop guide, and the real roll when the claw closes. It uses the same function as the dice.

**Safety rails.** While anything shakes the machine, and until the next drop, an invisible wall (parts only, the claw ignores it) stops shaken parts spilling into the chute: without it 8 of 40 quakes spilled a part, with it none. Redo is cancelled by anything that changes the world. Luck is capped at 8. With no lever used, every grab result is bit-identical to the pre-Rig claw (`tools/tune.mjs` output diffed seed for seed).

**Tuned by measurement, not by feel.** Every number is in the tuning panel's **Rig** group. They were set by running the real sim headless (see `tools/rig_check.mjs`), so they are defensible but unproven with people. The things only a human can answer are listed in [docs/RNG_LAYER.md](docs/RNG_LAYER.md) §12, with the kill signals.

Full plan, design rationale and backlog (Magnet, Levitate, Hold, Scry): [docs/RNG_LAYER.md](docs/RNG_LAYER.md).

This is prototype code. When the question has an answer, throw it away and keep the notes.
