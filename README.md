# THE GOOD PARTS

**Collect · Reanimate · Conquer.** A claw-machine necromancer prototype that runs in the browser.

A hooded Reaper runs a claw machine full of body parts. Grab parts with a physics claw, stitch them into mismatched monsters on the slab, and send them to fight the shades in the graveyard. Winning earns more tokens, and the graveyard restocks the machine. Creatures that die go back into the pile.

![scenes: shop · claw · slab · graveyard](docs/screens.png)

## Play

- **Easiest:** open `index.html`. It's a single self-contained file (about 750 KB) that works offline with no server.
- **Development:** open `dev.html`. It loads `src/js/*.js` directly, so you can edit and refresh.

Controls:

- **Claw:** ← → move, Space to drop, steer to the chute, Space to release, Esc to go back.
- **The Rig** (the claw's luck-bending levers, see below): **Q / E** nudge the glass, **1** quake, **2** iron grip, **3** order, **4** redo. Or click the panel.
- **Everything else:** mouse (touch works too). Gamepad works on the claw (LB / RB nudge, X quake, Y iron grip).
- **Shortcuts:** M to mute, ` for the tuning panel, P for the playtest report.

## The Rig: rig the machine back

![a quake in the claw machine, with the Rig panel on the right](docs/rig_quake.png)

The claw is a luck machine, and the Reaper admits it's rigged. So the machine now has a panel of switches on the side. Bad luck fills your **LUCK** meter (a miss is +1, a slip is +2, a battle won is +1), and Luck buys levers that bend the odds:

| Lever | Key | Cost | What it does |
|---|---|---|---|
| **Quake** | 1 | 3 | An earthquake. The pile churns into a new layout. |
| **Nudge ◀ ▶** | Q E | free | Bump the glass. Do it too fast and the machine **TILT**s. |
| **Iron Grip** | 2 | 2 | The next drop holds harder and slips far less. |
| **Order** | 3 | 4 | Pick a slot; the Reaper drops one in from the back room. |
| **Redo** | 4 | 3 | After a miss or slip, turn back time: same pile, token back, fresh dice. |

A **Lens** shows the odds: a badge on the drop guide before you drop, and the actual roll when the claw closes. Open `?rig=0` for the original claw, to compare. The full plan, numbers and safety rails are in [docs/RNG_LAYER.md](docs/RNG_LAYER.md).

## What this prototype is testing

Is the claw grab fun enough to be the core of a monster-building game? [PROTOTYPE.md](PROTOTYPE.md) covers:

- the exact question and the scope
- how to playtest it (what to watch for, plus a log template)
- what the automated tuning found
- what to do if the answer is yes, or no

## Build and tools

```sh
npm install                     # dev tools only: planck (vendored copy is in vendor/), playwright-core
node tools/build.mjs            # -> index.html + dev.html
node tools/tune.mjs 300         # headless claw bot: grab/slip odds per part
node tools/battle_sim.mjs 60    # headless battle balance per stage
node tools/rig_check.mjs        # headless checks of the Rig: quake, rewind, economy, fuzz
node tools/play.mjs "dev.html?scene=claw" out '[{"hold":"ArrowLeft","ms":800},{"press":"Space"},{"wait":6000},{"shot":"grab"}]'
```

## Credits

- Game code, pixel art, bitmap font, synthesized audio and music were all made for this prototype.
- Physics is [planck.js](https://github.com/piqnt/planck.js) v1.5.0 (MIT, © Erin Catto and Ali Shakiba). It's vendored in `vendor/`, with its license alongside.
- Art direction follows the concept board the prototype was built from.
