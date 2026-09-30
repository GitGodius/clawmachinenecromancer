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

## 3. Scope (kept deliberately small)

- One machine, one graveyard lane, one enemy family. It has three sizes: Wisp, Shade, and a Wraith boss every 5 stages.
- 24 part types filling 8 attachment points (head, torso, 2 arms, 2 legs, heart, back). There are 4 rarities and 15 traits, such as Wolf Skull *Bite*, Tentacle *Reach*, Black Heart *Undying* and Heart of Gold *+1 token per kill*.
- Any combination of parts is a valid creature. No legs means it crawls, no arms means it bites, no torso means it's mostly stitches. Names come from the parts ("Barnaby No-Legs", "Gus the Tentacular").
- **No save system, on purpose.** Refreshing starts a new run. No meta-progression and no shop upgrades.

## 4. How the claw works (the part that has to feel good)

- **Physics.** The pile, the cable and the claw are real rigid bodies (planck.js, a Box2D port). The claw hangs on a cable that pays out as it drops. It detects landing when the cable goes slack, then closes two motor-driven prongs while its weight digs them into the pile. Then it winches up and swings as you steer.
- **Hybrid grip.** Pure friction grip was unplayable (see §6). The prongs still close physically, and whatever is in the claw's cavity gets a springy grip. There's no dice roll: a part counts as grabbed when its middle is inside the cavity traced by the prongs' inner edges, or most of it is, or both prongs squeeze it. How well it's held (its *hold*) depends on things you can see:
  - how much of the part is inside
  - whether the prongs closed under it (caged) or squeeze it from both sides (pinched)
  - how slippery it is (hearts and eyeballs are wet)

  The hold is re-measured on the way up, as the prongs close around the part.
- **Slips.** A slip happens when *strain* beats *hold*. Strain comes from:
  - the part's weight
  - the carriage lurching (starting, braking, reversing, hitting the end stop)
  - the claw swinging
  - a classic arcade "jolt" at the top of the lift
  - a living part squirming (hands, tentacles, hearts and tails twitch in the pile too)

  While it's overstrained the part visibly slides down in the claw. Hold still and the claw re-seats it; keep yanking and it drops. While carrying, the carriage has momentum: it speeds up and coasts gently, and brakes hard only when you push against it. [docs/claw-feel.md](docs/claw-feel.md) has the details and the numbers.
- **Juice.** The key feedback, in the order it happens:
  - **Machine noise:** the motor hum's pitch follows the carriage speed and the load.
  - **Landing:** a thunk, dust and a small screen shake. The prongs ratchet as they close and the winch spins up.
  - **Held part:** a ring flashes around it when the grip takes. Its name, rarity and a **GRIP meter** show while you carry it. The bar's length is how good the grab is, the bright part is what's left after the current strain, and it flashes red while the part slides. The claw's status light follows the grip.
  - **Slipping:** creak, grit, a shudder, and "It's slipping! Hold still!". "Phew." if you save it.
  - **Win:** the chute catch hit-pauses, the bulbs chase, and the prize flies into your bag. Rare catches get slow-mo; legendaries get a gold flash.
  - **Life in the pile:** eyeballs follow the claw, hearts pulse, and legendaries sparkle.
  - **The Reaper** comments on everything, and names the reason whenever you lose a part ("Just clipped it.", "Only had it by the tips.", "The jolt at the top. Classic.").

## 5. Tools for finding the fun

- **In-game tuning panel** (the **`** key). Every number in `src/js/01_config.js` gets a live slider: claw speeds and torques, grip and strain (the **Grip** group), twitchiness, pile size, economy and battle multipliers, and juice amounts. **Copy values** puts your changes on the clipboard so you can paste them back into the config. It also has cheats: +5 tokens, refill the machine, drop in a legendary, +6 parts, win the battle. **Draw physics shapes** overlays the collision shapes, the claw's cavity (what counts as "in the claw") and each grip's spring, with live hold and strain numbers.
- **Playtest report** (the **P** key). It logs grabs, wins, slips (with the reason), misses and doubles, plus how good the grip was when the claw closed, near misses, and slips started versus held on. It also counts **one-more-try retries**, meaning the player drops again within 6 seconds of a fail, versus leaving the machine after a fail. Plus creatures made, battles, stages reached, and time spent per scene. Copy it after watching someone play.
- **`tools/tune.mjs`** runs the *real* claw simulation headless in Node, with a bot that aims with human-like noise. Example: `node tools/tune.mjs 300 '{"gripAssist":0.2}' gripTorque=40,60,80` sweeps any setting. `STYLE=careful|hasty|reckless` changes how the bot carries (compare them to check that carrying well still pays), and `AIM_NOISE=5` sets its aim error. Every run also reports `in-claw-but-ignored` and `gripped-outside-claw`, a regression guard for the bug in §6.10; both should stay near 0%.
- **`tools/battle_sim.mjs`** runs the real battle code headless against random parties to check the difficulty curve.
- **`tools/physdebug.html`** draws a grab as a filmstrip of physics shapes, with the claw's cavity and grip springs. That's how the grip problems in §6 were found.

## 6. What I tested and what happened

These tests were automated (bots and headless simulation), not human playtests. They tune the machine; they don't answer the question. The human tests in §7 do that.

1. **Friction-only grip was hopeless: 0–14% of grabs lifted anything.** Parts wedged in the pile block the prongs. Round parts get squeezed out downward like watermelon seeds. Real rigged claw machines behave exactly like this, but in a game it reads as broken. **I switched to the hybrid grip above.**
2. **Claw size relative to the parts mattered more than any torque setting.** Doubling the claw's inner cavity took lifts from about 7% to about 30%. Changing the torque from 120 to 700 moved lifts by only about 1 point.
3. **The machine cuts the claw's power after it closes,** so it closes hard and then holds weakly. That's how real arcade claws behave. It also produces the "it had it, then dropped it at the top" moment.
4. **"Slips" came mostly from how the sim measured the grip, not from what the player did.** Spinning the winch up smoothly and damping held parts fixed most of it.
5. **Current baseline** (300 bot grabs, 5 px aim noise, after the fix in item 10). "Careful" waits for the grip meter to settle and eases over; "hasty" goes full speed the moment the claw reaches the top:

   | Outcome | Careful | Hasty | Before item 10 |
   |---|---|---|---|
   | Win something | 66% | 54% | 57% |
   | Lift something | 76% | 76% | 65% |
   | Lift, then lose it | 10% | 22% | 8% |
   | Win two parts at once | 6% | 5% | 9% |
   | Win the exact part aimed at | 28% | 23% | 25% |

   Aim decides *which* part you get more than *whether* you get one.
6. **Carry skill used to not matter; now it does.** Gentle and jerky steering bots used to win about the same (57% vs 56% when re-measured). The slip risk was dominated by the part rattling inside the prongs, and with digital input there was no way to steer gently. Now strain comes from carriage lurch and claw swing, the loaded carriage has momentum, and a part that starts slipping can be saved by holding still. Careful carrying beats hasty by about 12 points. See [docs/claw-feel.md](docs/claw-feel.md).
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
10. **"The part was right in the middle of the claw and it didn't take it."** This came from playing, and the tools confirmed it. In 37% of grabs where a part sat inside the claw's cavity, nothing got a grip. The causes:
    - a hidden dice roll (50–90% even when perfectly centered)
    - ranking by distance, which often put the part inside the prongs second
    - a fixed center-point box instead of the real cavity

    The same flaws made 24% of grips land on a part *outside* the prongs. Separately, a third of well-aimed drops closed on air, because the light claw levered itself out of the pile while closing. The fix replaced the roll with geometry and gave the claw weight while closing (§4). Now 1% of in-claw parts go ungripped (borderline cases where two parts compete) and no grips land outside. Details and the feel plan are in [docs/claw-feel.md](docs/claw-feel.md).

## 7. How to playtest it (the real test)

Don't explain anything. Hand over the laptop and watch. Afterwards press **P** and copy the report.

Watch for:

- **The first 60 seconds.** Do they find the claw, understand move → drop → steer → release, and see that the chute is the goal?
- **One more try.** After a slip or miss, do they drop again immediately? The report's *retried within 6s* counts this, and *left the machine* counts giving up. Watch for leaning in and any reaction when a part slips at the top.
- **Wanting specific parts.** Do they chase the glowing rare or legendary part, or grab whatever is closest? Do they talk about a *specific* part they want?
- **Attachment.** Do they read their creature's name out loud? Do they rebuild or unstitch? Do they react when a creature falls apart?
- **Where the time goes.** Check the report's time per scene. If the slab and graveyard feel like chores between grabs, that's useful information too.
- **The ending.** Do they ask to keep going after the Stage 5 Wraith, or after losing?

Log each session with this template:

| Tester | Minutes | Grabs | Win % | Retries <6s / fails | Best stage | Creatures | Notable moments / quotes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 8. Next steps

**If the answer is yes**, meaning people retry and chase parts:

- Carrying is now a skill in a first form: slip risk comes from carriage lurch and swing, the loaded carriage has momentum, and a grip meter shows the strain. Playtest it and follow the plan in [docs/claw-feel.md](docs/claw-feel.md): strain you can hear, gamepad rumble, twitch telegraphs, claw size versus part size.
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
| `20_engine.js` | canvas, input, scenes, shake, hit-pause, slow-mo, particles, UI |
| `21_backgrounds.js` | shop, lab and graveyard backgrounds |
| `30_game.js` `31`–`35` scenes | game state, claw, creatures and rig, slab, battle, shop |
| `40_telemetry.js` `41_debug.js` | playtest report and tuning panel |

This is prototype code. When the question has an answer, throw it away and keep the notes.
