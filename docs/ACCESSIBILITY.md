# Accessibility

Designed in from the start of this pass, not bolted on: **nothing important is carried by colour alone, and every key can be rebound.** This file lists what is there, how it is checked, and what is not covered. If something here is untrue, that is a bug.

## What is in the game

### Playing without holding keys or aiming precisely
| Feature | Where | Notes |
|---|---|---|
| Rebind every key, two per action | Settings > Key bindings | A movement action can never be left with no key. A key can belong to one action only; taking one shows who lost it. |
| Tap-to-toggle steering | Settings > Steering | Tap a direction once to start moving, again to stop. Nothing needs holding. |
| Auto-carry assist | Settings > Auto-carry assist | The machine carries a grabbed part to the chute at a steady, deliberately unhurried speed. Where you drop the claw is still yours. |
| Longer or no carry timer | Settings > Carry time | 8 s, 16 s or unlimited. |
| Mouse and touch | Hold on the glass to steer; on-screen buttons | Every screen works by pointer alone. |
| Keyboard alone | Arrows + confirm + back | Menus, shop, claw, fight, and the slab (arrows move a focus ring over the parts and buttons). |
| Gamepad | d-pad, A, B | Fixed mapping. Not rebindable. |
| One-handed layouts | Rebind | Move, drop and back can all sit on one side of the keyboard. |

### Seeing it
| Feature | Notes |
|---|---|
| Rarity is stars as well as colour | ★ uncommon, ★★ rare, ★★★ legendary on parts in the bag and slab. In the machine the glow pulses faster the rarer the part. |
| Whose health bar is whose | ♥ marks yours, × marks theirs. A hurt bar is dashed, and your creatures show their health as a number. |
| The carry meter says it in words | STEADY / STRAINED / SLIPPING!, with a bar that is solid, dotted or striped. Colour is a bonus. |
| Out of tokens | The button says NO TOKENS; the counter is not only red. |
| Carry timer | A bar and, in the last three seconds, a number. |
| Reduce flashing | Settings > Reduce flashing. No full-screen flashes, and every blinking light and chase runs at 1.5 per second or slower. Checked by a lint (see below). |
| Screen shake | Off / Low / Full. |
| Slow-motion | Can be turned off. |
| Text | Fixed pixel fonts scaled to fit the window. See the gaps below. |

### Hearing it
Nothing the game needs from you is audio-only. Every sound cue has a visual twin (a slip is a Reaper line and a dropped part; a hit is a number; a win is text and the part flying to the bag). Music, effects and master volume are separate sliders, and there is a mute key.

### Thinking about it
- **Pause is available everywhere** (`P`, the Menu button, or the tab losing focus) and stops everything: no game action works while paused. This is on purpose (docs/DESIGN.md).
- The next stage's enemies and what beats them are shown before you go.
- Failure is never final: a lost fight pays, the Reaper adds a little more after repeated failures, and the parts always come back to the machine.

### Screen readers
The Reaper's lines, menu rows and their values, and fight results are announced through a live region. The page has a labelled canvas and an on-page Menu button.

## How it is checked

| Claim | Check |
|---|---|
| Nothing blinks faster than 1.5 Hz in calm mode | `node tools/test.mjs flashing` scans the source for on/off blinkers and chases that are not routed through `blinkOn()` or guarded. It caught a lantern flicker that was missed by hand. |
| Full-screen flashes are off | e2e: with the setting on, `Engine.flash()` leaves no flash. |
| Keys rebind, persist, and never collide | `tools/test.mjs` (settings) and `tools/e2e.mjs` (rebind, reload). |
| The slab works from the keyboard | e2e: arrow keys move a focus ring; confirm stitches. |
| Tap-to-toggle steering | e2e. |
| Screen-reader text is produced | e2e checks the live region has text after starting. |

## What is not covered (known gaps)

- **Not playable without sight.** The claw is a physics toy you steer by watching it. The narration makes the menus and results readable, not the game.
- **Small text.** The pixel fonts are drawn at the canvas's native 480x270 and scaled up. Fullscreen and the browser's zoom help; there is no separate large-text mode.
- **No real screen reader has been used.** The live region is standard, but NVDA, JAWS, VoiceOver and TalkBack have not been tried. Verbosity may be too high (every Reaper line is announced).
- **No colour-vision testing with real people.** The cues above are redundant on purpose. The slab and a fight were looked at under simulated protanopia, deuteranopia and tritanopia (Machado 2009 matrices, applied as an SVG filter in Chromium). Rarity stars and the heart/cross markers stayed readable, and under deuteranopia both sides' health bars turn the same tan, which is exactly what the markers are for. The claw screen, the carry meter and the menus were not put through that, and a simulation is not a person telling us it reads.
- **Gamepad cannot be rebound.**
- **No captions for music mood**, if that matters to you. There is no speech, only gibberish blips that go with the Reaper's text.
- **Motor:** timing-sensitive moments exist (the carry, and the ZAP cooldown). The assist and the longer timer help the first; nothing helps the second yet.

## Rules for new code

1. If it is a colour, it needs a word, a shape, a pattern or a count next to it.
2. If it blinks, use `blinkOn(t, hz)`. If it flashes the screen, use `Engine.flash()`, which already respects the setting.
3. If it is a key, it goes through `Settings.v.keys` and `Input.hit(action)`. Never test `e.code` directly.
4. If it is a new screen, it works with the keyboard (`uiNav` on the scene, or a `ListMenu`) and with a pointer, and it says something to `Announce`.
5. If it stops the world (a menu), it is an overlay and nothing behind it may act.
