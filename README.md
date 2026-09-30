# THE GOOD PARTS

**Collect · Reanimate · Conquer.** A claw-machine necromancer prototype that runs in the browser.

A hooded Reaper runs a claw machine full of body parts. Grab parts with a physics claw, stitch them into mismatched monsters on the slab, and send them to fight the shades in the graveyard. Winning earns more tokens, and the graveyard restocks the machine. Creatures that die go back into the pile.

![scenes: shop · claw · slab · graveyard](docs/screens.png)

## Play

- **Easiest:** open `index.html`. It's a single self-contained file (about 700 KB) that works offline with no server.
- **Development:** open `dev.html`. It loads `src/js/*.js` directly, so you can edit and refresh.

Controls:

- **Claw:** ← → move, Space to drop, steer to the chute, Space to release, Esc to go back.
- **Everything else:** mouse (touch works too). Gamepad works on the claw.
- **Shortcuts:** M to mute, ` for the tuning panel, P for the playtest report.

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
node tools/tune.mjs 300         # headless claw bot: grab odds, what the claw really held, why grips slipped
node tools/battle_sim.mjs 60    # headless battle balance per stage
node tools/play.mjs "dev.html?scene=claw" out '[{"hold":"ArrowLeft","ms":800},{"press":"Space"},{"wait":6000},{"shot":"grab"}]'
```

## Credits

- Game code, pixel art, bitmap font, synthesized audio and music were all made for this prototype.
- Physics is [planck.js](https://github.com/piqnt/planck.js) v1.5.0 (MIT, © Erin Catto and Ali Shakiba). It's vendored in `vendor/`, with its license alongside.
- Art direction follows the concept board the prototype was built from.
