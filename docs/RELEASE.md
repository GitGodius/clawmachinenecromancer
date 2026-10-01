# Shipping

The game ships as **one HTML file** (about 760 KB, roughly 200 KB zipped). Nothing loads from a network and there is no server.

## Build and package

```sh
npm install
npm run verify            # build + rules tests + balance check + browser tests. Must be green.
```

`npm run build` writes:

| File | What it is |
|---|---|
| `index.html` | The game as players get it. No tuning panel, cheats or URL flags. Version stamped from `package.json`. |
| `dist/the-good-parts-<version>-itch.zip` | **Upload this to itch.io.** `index.html` at the root. Deterministic: the same source gives the same bytes. |
| `dev.html` | The developer page: tuning panel, cheats, `?scene=`, `?seed=`, `?parts=1`, `?party=1`, `?tokens=`, `?stage=`. Never ship it. |
| `dist/artifact.html` | The release page as a fragment, for hosts that wrap it in their own `<html>`. |

## itch.io settings

- Kind of project: **HTML**. Upload the zip; tick *This file will be played in the browser*.
- Viewport: **960 x 540** (the game is 16:9 and scales to fit whatever it gets).
- Tick **Fullscreen button** (the `F` key works too where the frame allows fullscreen).
- Tick **Mobile friendly** only after the phone checks below have been done by a person.
- Leave scrollbars off. Leave "SharedArrayBuffer" off; the game does not use it.

## Saves survive updates

The save is one JSON string under `thegoodparts.save` in `localStorage`, holding `{ v, settings, records, run }`.

- **Changing the shape of a saved run:** bump `SAVE_VERSION` in `src/js/09_store.js` and add `MIGRATIONS[oldVersion] = (save) => newSave`. Never edit an old migration.
- **Renaming or removing a part id:** add it to `PART_ALIASES`. A part that maps nowhere is dropped and the player is told once. (Nothing is wasted, so prefer an alias.)
- A save from a **newer** build is read but never overwritten, so an old page cannot clobber it. A save that cannot be parsed is copied to `thegoodparts.save.corrupt` and the game starts fresh. Every write keeps the previous one in `thegoodparts.save.bak`.
- The run is written only after the player has started or continued one this session. (Before that rule the boot-time blank game overwrote the waiting save on every page load. `tools/test.mjs` and the e2e suite both check it now.)
- Storage can be blocked (sandboxed frames, private windows). The game then runs without saving and says so on the title screen.

## When something breaks in the field

- A scene that throws does not freeze the game. It shows a small report box; after 30 failed frames in a row it drops back to the shop.
- **Settings > Copy debug info** produces a paste-able report: version, browser, graphics card, whether it is framed, whether storage works, what the game was doing, the errors, and the last events. **Report a problem** opens a prefilled GitHub issue.
- The last crash is also kept in `localStorage` (`thegoodparts.crash`) so the next launch's report includes it.
- There is **no server and nothing is sent anywhere.** People send it, or they do not. Read issues; when three reports share a graphics string or browser, that is the bug.

## What has and has not been tested

Everything in this list was run on **headless Chromium with software rendering**, inside this repository's CI-less sandbox. That is not the same as your players' machines.

| Area | Status |
|---|---|
| Rules, economy, saves, keys, flashing lint | Automated. `npm test`. |
| Balance and its targets | Automated. `npm run balance:check`. |
| Real-browser flows (title, pause, rebind, continue, victory, crash recovery, layouts, 60 s random-input soak) | Automated. `npm run e2e`. Chromium only. |
| Framed page: sandboxed (storage blocked) and cross-origin (`allow-same-origin`) iframes | Automated against **a frame I built to look like itch's**. Not the real itch page. |
| **The real itch.io page** (its actual iframe attributes, its fullscreen button, its focus behaviour, autoplay policy, its mobile embed) | **Not tested.** |
| **Real GPUs and drivers** (Intel, AMD, NVIDIA, Apple, mobile). The game uses a 2D canvas only, so the risk is lower than for WebGL, but frame pacing on weak hardware is unmeasured. | **Not tested.** |
| **Firefox and Safari** (desktop) | **Not tested.** Audio (WebAudio) and pointer capture are the likeliest differences. |
| **iOS Safari and Android Chrome** (touch, audio unlock, address-bar resize, pause on tab switch) | **Not tested.** |
| **Audio, at all** (the mix, the new menu and silence beats, latency, crackle, the music loops) | **Not listened to in this pass.** Headless Chromium has no audio device. The code paths run without errors; whether they sound right is unknown. The pause dimming, the silence before the last boss and the defeat heartbeats are the new things to hear first. |
| **Gamepads** | **Not tested** with a physical pad. |
| **Screen readers, colour-blind players, anyone else** | Not tested with people. See [ACCESSIBILITY.md](ACCESSIBILITY.md). |
| **Anyone playing it** | **No human has played this build.** The bots say it is finishable and the carry is a skill; they cannot say it is fun. |

## Before you call it 1.0 (a person does these)

1. Upload the zip as a **draft**, restricted, and open it on itch. Check: it draws, the first click gives it the keys, music starts after the first click, `F` goes fullscreen (or does nothing gracefully), the title says nothing about blocked storage.
2. Play a full run on a laptop with an integrated GPU, in Firefox and Chrome. Watch for dropped frames in the claw scene (the busiest one) and in a five-enemy fight.
3. Play the first five minutes on a phone in both orientations. Can you steer, drop, reach the pause button, and stitch?
4. Have someone who has never seen it play the first 60 seconds without help (see the playtest notes in [PROTOTYPE.md](../PROTOTYPE.md)). Copy their debug info at the end.
5. Refresh mid-run, mid-fight and on the end screen. The run comes back after the first two.
6. Open the game in a window with site data blocked. It should say so and still play.
7. Read the first five issues that arrive before doing anything else.

## Changelog and versions

[CHANGELOG.md](../CHANGELOG.md) is written for players. The heading matches the version in the corner of the title screen. Bump `package.json`, rebuild, upload, then write the entry.
