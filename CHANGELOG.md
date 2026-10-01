# Changelog

Player-facing changes first. The version in the corner of the title screen matches the heading here.

## 0.10.0: everything, together

The four open lines of work (the Rig, the soul grip, the polish pass, and the grab-loop and monster fixes) fitted into one build. Same caveat as 0.9.0: checked by bots and a headless browser, not yet on real hardware.

### The claw is honest now
- **What the prongs close around is what you get.** Nothing about a grab is rolled any more. The claw comes down in a narrow pose so its tips land on the part under the guide, spreads, clamps and locks, and a soul hook drags the part under its centre line up into its mouth (outlined in violet before you drop). A part that is inside the claw when it closes is won about 90% of the time (it was about half), the part you aimed at about half the time (it was a quarter), and parts no longer hang on from outside the claw.
- **A drop on the move stops and settles first**, so the claw lands where the guide was. A drop over the chute is refused and costs nothing.
- **An empty claw lets go at the top** instead of making you steer air to the chute.
- "SO CLOSE!" when a part slips within a claw-length of the chute, and "Just clipped it." when the claw closes on a part without catching it.

### The carry is still the skill
- Racing at full speed or stopping hard strains the grip. A grip strained past how well it was caught frays and slides; ease off and it re-seats ("Phew."); keep yanking and it tears and the jaws sag open. This replaces 0.9.0's sway-and-roll slips.
- One carry meter under the part, in words: STEADY, STRAINED, SLIPPING!.
- Bots: a careful carry wins about 69% of grabs, a masher about 56%, and the auto-carry assist lands with the careful player.

### The Rig: rig the machine back
- A maintenance panel beside the glass. Bad luck fills a **LUCK** meter (a miss +1, a slip +2, a battle won +1), and Luck buys levers: **Quake** (3) reshuffles the pile, **Nudge** (free, but a fourth quick one TILTs the machine), **Iron Grip** (2) makes the next drop catch more and shrug off a rough carry, **Order** (4) has the Reaper drop in a part for the slot you pick, **Redo** (3) turns back time after a failed grab.
- The **Lens**: a badge on the drop guide with the chance this drop comes up holding something, calibrated against real drops (77% means about 77%), and a reading of what the claw really caught when it closes.
- The Rig's keys can be rebound like the others, and your Luck is saved with the run. Full plan and safety rails: [docs/RNG_LAYER.md](docs/RNG_LAYER.md).

### Monsters and fights
- **Part sets**: matching parts give a creature a bonus. Tooltips show set progress.
- **Remains keep their names**: a creature that dies falls apart into the machine, and its parts still say whose they were.
- The **IF YOU WIN** panel shows the prize the next fight restocks into the machine.
- Battle **SPEED x1/x2** (remembered), a readable log, and callouts for bleed, burn and whip hits.
- A bigger, hunched Reaper.

### Balance
- The soul grip pays out about 1.6 times the parts per token, so runs are shorter: about 22 minutes for a careful bot with the real claw (it was 32), still finishing 92% of the time. All 12 balance targets hold. [docs/BALANCE.md](docs/BALANCE.md) says what was tried and why the economy was left alone for now.

### For developers
- `tools/rig_check.mjs` covers the Rig on the soul grip, including a check that the grab rolls no dice. `tools/tune.mjs` also reports what the claw really held and why grips were lost.
- [docs/claw-feel.md](docs/claw-feel.md) is kept as the record of the other grab fix, whose strain-against-hold plan the carry is built on.

## 0.9.0: the polish pass

Not yet 1.0: everything below was checked with bots and a headless browser with software rendering. It has not been run on real graphics cards or inside the real itch.io frame. See [docs/RELEASE.md](docs/RELEASE.md) for the checklist that closes that gap.

### A whole run now has a shape
- **A run is 15 stages in three acts. The last boss, the Landlord, ends it.** There is a victory screen with your numbers. (Before, the run never ended, and the bots that got far spent their last hour losing to stage 25.)
- **The Reaper tells you what is coming**: the next stage's enemies and what they are good at, in the shop and on the slab, so the claw has a shopping list.
- Enemies now ask different questions. **Wisps** swarm (faster and harder than before), **Shades** are armoured, **Wraiths** are bosses.
- **Every arm is its own strike**, and armour is taken off each one. Two small arms are worth much less against a Shade than one big one. Small-hit builds simply cannot get through late Shades; the boss rewards big hits over bulk. (The Ogre Gut lost 8 health.) It is not yet true that every build has a home: stacking health is still the best answer to Wisps and Shades. See [docs/DESIGN.md](docs/DESIGN.md).

### Losing is a bad day, not a dead end
- A fight you lose or retreat from now pays for the damage you did. Retreat keeps everyone who is still standing, and everyone standing is healed after any fight.
- Repeated failures earn a few extra tokens from the Reaper, scaled by how hard you fought.
- (Before, a defeat paid 1 token and the parts it scattered cost about 30 to win back. About a quarter of bot runs never got out.)

### The carry is a skill
- The claw has momentum while carrying: hold a direction to speed up, ease off to steady it. **Fast carries sway, and a swinging part slips.** A wobble meter shows it.
- A slip now actually lets go. (Before, the prongs often held a "slipped" part anyway, which hid how you carried.)

### Menus, pause and settings
- A title screen with Continue, New Run, Settings and How to Play. Your run is saved and comes back after a refresh or a closed tab.
- **Pause** (`P`, or the Menu button) freezes everything and allows no game actions. Pausing is available everywhere, phone included.
- **Settings**: volumes, screen shake, reduced flashing, slow-motion, drop guide, auto-carry assist, carry time, tap-to-toggle steering.
- **Every key can be rebound**, two per action.

### Accessibility
- Nothing relies on colour alone: rarity, health, warnings and battle sides also use shape, pattern or text.
- Reduced flashing removes full-screen flashes and slows every blinking light below 1.5 per second.
- The Reaper's lines and the menus are read out to screen readers.
- Full list, and what is not covered: [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).

### Removed
- The tuning panel, cheats, the playtest report key and the URL flags. They are in `dev.html` only. The useful ones are real settings now.
- The permanently greyed-out ABILITIES entry in the battle menu.
- `Z`, `J`, `K` and `Backspace` as extra keys (rebind them if you liked them).

### If something breaks
- The game keeps running when a screen throws an error, shows a small report box, and keeps the details. Settings > Copy debug info gives you something to paste into a bug report.

### Balance
The numbers and the evidence behind them are in [docs/BALANCE.md](docs/BALANCE.md), generated by `node tools/balance.mjs`.

### For developers
- Combat is a pure simulation (`13_battlesim.js`) with no drawing, sound or camera; the scene only listens to its events.
- One shared headless harness for every bot; fixed-seed golden tests (`node tools/test.mjs`).
- Cosmetic and gameplay randomness are separate streams, so a seed reproduces a fight whatever the screen does.
- Bots: whole-run players with skill profiles (`tools/run_sim.mjs`), a build matchup table (`tools/matchups.mjs`), a claw tuner (`tools/tune.mjs`).

## 0.1.0: the prototype
The first playable: a physics claw, stitching, and a graveyard. See PROTOTYPE.md.
