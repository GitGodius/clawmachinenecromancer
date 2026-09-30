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

**The rule: what the prongs close around is what you get.** Nothing about a grab is rolled. A good grab holds, a bad grab gets nothing, and a part never hangs on from outside the claw.

- **Physics.** The pile, the cable and the claw are real rigid bodies (planck.js, a Box2D port). A grab goes:
  1. **Drop.** The claw comes down in its narrow half-open pose, so its prong tips land on the part under the drop guide rather than on that part's neighbours. A stiff cable mount keeps the head on target instead of letting it skate down the slope of the pile.
  2. **Spread.** When the cable goes slack, the prongs spread around whatever the tips landed on while the head settles in between them.
  3. **Clamp.** The prongs close hard enough to shove the pile aside. The cable carries half the head's weight so the tips aren't pinned under 5 kg of claw.
  4. **Lock.** Once closed, the prongs lock like a worm-gear claw. A claw that kept squeezing would pop rigid parts out through its mouth.
  5. **Lift.** The winch reels the cable in at real speed, so whatever the claw holds feels the lift.
- **The soul grip.** A part is bound to the claw only if its centre of mass is inside the claw's mouth (outlined live by the prongs' inner faces, so a prong jammed open makes a leaky claw) and a prong is touching it. How strongly depends on how it was caught:
  - depth inside the mouth
  - one prong or both
  - slimy (hearts and eyeballs are wet)
  - weight (heavy parts need a better catch)

  The grip is a friction joint, so it resists the part sliding through the claw up to a force limit.
- **The soul hook (the extra magic).** While the claw spreads and clamps, it drags the part straight under its centre line up into its mouth. That's the part the drop guide marks in violet before you drop. It's a real force: the pile pushes back, a buried part stays buried, and the prongs still have to close around whatever comes up. This is what makes aiming count.
- **Slips.** Slips are purely physical: a part slips when it's pushed out of the claw's mouth. Causes, as the playtest report names them:
  - **wedged:** the pile holds on to it as the claw lifts
  - **slid:** it was only half in, or the claw is overstuffed
  - **jolt:** the bounce when the winch hits its stop
  - **twitch:** a living part fights the grip (hands, tentacles, hearts and tails twitch in the pile too)
  - **swing:** a hard swing

  The prongs have grippy pads inside and smooth metal outside, so parts slide off the outside instead of riding along on a prong. A part pinched by just the prong tips can still come along. The Reaper calls it out, and it usually falls.
- **Juice.** The key feedback, in the order it happens:
  - **Machine noise:** the motor hum's pitch follows the carriage speed and the load.
  - **Aim:** the drop guide runs straight down to the part the soul hook will reach for and outlines it in violet.
  - **Landing:** a thunk, dust and a small screen shake. The prongs spread with a ghostly whistle, and a violet tendril reaches from the claw's heart to the part as it's drawn up. The prongs ratchet shut and the winch spins up.
  - **Bind:** a shimmer and a flare where the grip takes hold. Its colour says how firm the catch is: green is firm, amber is loose, and flickering red means it's sliding out. The prongs glow and spectral threads run from them into the part. The part's name and rarity are labelled with five pips of grip; no pips means it's only riding on the prongs.
  - **Snap:** when a grip tears, you get a crack of sparks and a falling whine, and the Reaper says why.
  - **Win:** the chute catch hit-pauses, the bulbs chase, and the prize flies into your bag. Rare catches get slow-mo; legendaries get a gold flash.
  - **Life in the pile:** eyeballs follow the claw, hearts pulse, and legendaries sparkle.
  - **The Reaper** comments on everything.

## 5. Tools for finding the fun

- **In-game tuning panel** (the **`** key). Every number in `src/js/01_config.js` gets a live slider: claw speeds and torques, grip strength and the soul hook, twitchiness, pile size, economy and battle multipliers, and juice amounts. **Draw physics shapes** overlays every collider and the claw's live mouth. **Copy values** puts your changes on the clipboard so you can paste them back into the config. It also has cheats: +5 tokens, refill the machine, drop in a legendary, +6 parts, win the battle.
- **Playtest report** (the **P** key). It logs grabs, wins, slips (with the reason), misses and doubles. It also counts **one-more-try retries**, meaning the player drops again within 6 seconds of a fail, versus leaving the machine after a fail. Plus creatures made, battles, stages reached, and time spent per scene. Copy it after watching someone play.
- **`tools/tune.mjs`** runs the *real* claw simulation headless in Node, with a bot that aims with human-like noise. Example: `node tools/tune.mjs 300 '{"gripAssist":0.2}' hookPull=1,2,3` sweeps any setting. Besides win rates it reports:
  - how often the target was inside the claw when it closed, and how often those were won
  - "phantom carries" (anything carried from outside the claw)
  - wins by aim error
  - why grips were lost
- **`tools/battle_sim.mjs`** runs the real battle code headless against random parties to check the difficulty curve.
- **`tools/physdebug.html`** draws a grab as a filmstrip of physics shapes, with the claw's mouth in magenta and each grip's catch quality. `?part=ribcage&off=3&angle=1.57` drops the claw beside a single part on an empty floor. That's how the grip problems in §6 were found.

## 6. What I tested and what happened

These tests were automated (bots and headless simulation), not human playtests. They tune the machine; they don't answer the question. The human tests in §7 do that.

1. **First pass: friction-only grip was hopeless (0–14% of grabs lifted anything),** so I stood in a "hybrid grip". After closing, anything roughly under the claw was rolled for a springy joint to the claw head, and slips were rolled every second. It played badly, and players hit two problems:
   - Obviously good grabs failed on the roll.
   - Bad grabs dragged in parts that weren't in the claw, which then dangled from the spring.
2. **Second pass: I measured those two complaints and found physics bugs underneath** (150 bot grabs, 4 px aim noise):
   - **The claw drifted off target.** Hanging from a slack cable, the head skated down the slope of the pile while its prongs closed, landing a median 17 px (up to 68 px) from where it was aimed. The claw's mouth is only 23 px wide. A stiff cable mount now keeps it within about 1 px.
   - **The winch never lifted anything.** It shortened the rope joint, and the solver moved the head up by position correction with zero velocity. Nothing the claw held felt the lift, so parts resting on the hooks stayed on the floor. That, not the prongs, is most of why friction-only grip was hopeless. The winch now reels the head in at real speed. In a test that drops the claw over lone parts on an empty floor, that one fix took wins from 28% to 91%.
   - **Squeezing popped parts out.** The prongs' sloped shoulders push a squeezed rigid part down through the mouth (the watermelon seeds). The prongs now lock once closed instead of squeezing.
   - **The prongs never closed in the pile.** They opened wide at the top and came down on the target's neighbours, then were pinned there under the claw's weight, closing above the target. The drop, spread and clamp sequence in §4 fixed that.
   - **Aim barely mattered, even so.** The last piece was the soul hook.
3. **Claw size isn't the lever any more.** Earlier, doubling the claw's cavity took lifts from about 7% to about 30%. Now that the physics works, longer prongs make things *worse*. Before the soul hook existed, the target was won 36% of the time at normal size, 27% at 1.2× and 9% at 1.5×.
4. **Current baseline.** Both columns use the same 300 piles, the same bot and the same metrics (`node tools/tune.mjs 300`, 4 px aim noise):

   | Outcome | Hybrid grip (before) | Soul grip (now) |
   |---|---|---|
   | Win something | 56% | 75% |
   | Win the exact part aimed at | 29% | 51% |
   | Target inside the claw when it closed → won | 63% | 90% |
   | Target centred in the claw → still lost | 20% | 6% |
   | Carried something from outside the claw | 19% of grabs | 1% (tip pinches, parts shoved into the chute) |
   | Win two parts at once | 12% | 21% |
   | Slip | 9% | 2% |

   With sloppier aim (10 px noise), the exact part is won:

   | Aim error | Before | Now |
   |---|---|---|
   | 0–2 px | 33% | 59% |
   | 2–4 px | 21% | 40% |
   | 4–7 px | 28% | 50% |
   | 7–11 px | 17% | 42% |
   | over 11 px | 13% | 18% |

   Centred catches were lost 45% of the time before and 6% now.
5. **Economy side effect.** Grabs now pay out about 0.9 parts per token, up from about 0.6. By Stage 5 that's roughly 25 parts instead of 14, so battles in §7 will feel easier. If they do, `startTokens` or `winTokens` is the knob. Don't make the claw worse.
6. **Carry skill still doesn't matter.** Gentle and jerky steering bots win about the same (76% vs 75%). Held parts sit in a locked cage, and the carriage's capped acceleration never shakes one loose. *This is still an open design problem* (see §8).
7. **Battle curve** (headless, Zap used on cooldown). The Stage 5 boss is a deliberate wall that needs a full party of three.

   | Party | S1 | S2 | S3 | S4 | S5 (boss) | S8 | S10 |
   |---|---|---|---|---|---|---|---|
   | 1 creature, 3 parts | 100% | 93% | 40% | 18% | 0% | 0% | 0% |
   | 1 creature, 5 parts | 100% | 100% | 95% | 60% | 5% | 10% | 0% |
   | 2 creatures, 4 parts | 100% | 100% | 100% | 83% | 18% | 5% | 3% |
   | 3 creatures, 5 parts | 100% | 100% | 100% | 100% | 95% | 70% | 35% |
   | 3 creatures, 7 parts | 100% | 100% | 100% | 100% | 100% | 98% | 73% |

   By Stage 5 you've earned about 28 tokens, which is roughly 25 parts at the current claw odds (see item 5). That's more than enough for three 5-part creatures.
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

Log each session with this template:

| Tester | Minutes | Grabs | Win % | Retries <6s / fails | Best stage | Creatures | Notable moments / quotes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 8. Next steps

**If the answer is yes**, meaning people retry and chase parts:

- Make carrying a skill. Slips are physical now, but at the carriage's capped acceleration a locked claw never shakes a part loose. Options:
  - Give the carriage momentum, so holding a direction speeds it up and tapping is gentle.
  - Let hard stops and reversals jolt the head.
  - Let hard swings weaken the soul grip.

  The grip meter is already there to show it.
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
