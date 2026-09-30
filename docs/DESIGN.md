# The Good Parts: design

> **The promise.** Every monster you send to fight is built from parts you won from the claw, and every part it loses goes back in the machine.

That sentence is the game. A feature that makes it false is cut, or it is a setting the player opts into knowingly (see the assists in [ACCESSIBILITY.md](ACCESSIBILITY.md)). A feature that makes it truer gets built.

The pillars below say what the promise means in enough detail to settle an argument. Each one names what it **forbids**, the **system that tests it** (an enemy or a rule that would break if the pillar were only decoration), and the **check** that keeps it true. Checks run with `npm test`, `npm run balance:check` and `npm run e2e`.

---

## 1. The claw is the only door

A part enters your bag only by dropping down the chute. That includes a stray that falls in between grabs (the Reaper calls it a free one). It does not include anything else.

- **Forbids:** a battle that hands you the part you wanted; tokens that buy parts; pity that gives parts; any "pick your reward" screen.
- **Allows:** battles that pay **tokens** and drop parts into the **machine**, where they are as hard to get as any other part.
- **Tested by:** the restock rule. A win puts 3 parts in the pile, never in the bag. The pity floor and the failure ladder pay tokens, never parts.
- **Check:** `tools/test.mjs` (rules): after a win, a defeat and a retreat, the bag has not changed and the dead creatures' parts and the restock are in the machine's queue.

## 2. Nothing is wasted

The rules never destroy a part. A creature that dies falls apart into the machine. Unstitching returns parts to the bag. The machine tops itself up before it runs dry.

- **Forbids:** durability, permanent death of parts, any "lost forever" outcome, a run that ends because the pile emptied.
- **Allows:** losing time. A dead creature costs you the grabs it takes to win its parts back, and the stitching.
- **Tested by:** defeat, the one place the pillar is under pressure. The defeat screen says how many creatures fell apart into the machine.
- **Check:** `tools/test.mjs` (parts in the world change only by the restock across a fight) and the real-physics run bots (`tools/balance.mjs`): no part physically leaves the machine. In 24 physics runs before this pass, and the ones since: zero.
- **What it does not promise:** that a loss is cheap. It was not, and that was a bug of a different kind: see BALANCE.md, "Failing forward".

## 3. The carry is the skill

Winning a part is decided in two places: where you drop the claw, and how you steer once it has something. The second one is the one you can get good at.

- **Forbids:** a claw that carries for you by default; slip odds that ignore how you steer.
- **Allows:** an opt-in **auto-carry assist**, which takes the carry off your hands at a steady, unhurried speed. It removes the skill, not the aim. A careful player who takes the quick steady line does slightly better than the assist, and a masher does worse. A longer or unlimited carry timer, and tap-to-toggle steering, are also allowed.
- **Tested by:** the carry itself. The carriage has momentum (hold a direction to speed up, ease off to steady it), a held part sways more the faster you go, and a slip opens the jaws. A meter says STEADY, SWAYING or SLIPPING! so the cause is never a mystery.
- **Check:** `node tools/balance.mjs`: a careful carrier must win at least 8 points more grabs than a masher (measured: see BALANCE.md), and the assist must land between them.
- **How it was found:** the first bots showed no gap at all (careful 51.6%, masher 55.3%). See BALANCE.md.

## 4. Build for the graveyard

Enemies punish builds, and the Reaper tells you what is coming so the claw has a shopping list.

- **Shades** are armoured. Every arm is its own strike, and armour is taken off each strike, so a build of small hits does almost nothing to them. Big hits answer them.
- **Wraiths** are bosses: huge, slow and armoured. At the strength of the last stages the bruiser (big hits) beats the tank (bulk) on the Wraith by about 20 points of health left; nothing else does.
- **Wisps** swarm: fast, many small hits. Armour and health answer them.
- **Forbids:** a stage preview that lies (it is generated from the same table the fight uses); an enemy that is only a bigger number.
- **Allows:** a build that cannot beat one enemy at all. That is the point.
- **Tested by:** the enemies. At stage 15 strength, three copies of a small-hit "skirmish" build win **0%** against Shades and 10% against the Wraith, and a "plated" build with weak arms wins 23% against Shades (`tools/matchups.mjs`, on an equal budget of rarity: one rare, two uncommons, the rest common). The bruiser keeps the most health against the Wraith, by a wide margin.
- **Check:** `node tools/balance.mjs`: at final-stage strength the best build is not the same in every column, and at least one build fails against at least one enemy.
- **Where it is thin, honestly:** the tank (stack health) is still the best answer to Wisps and Shades, and the Wisps do not yet ask a question of their own: every build beats them. Health is the strongest single stat. That is an open problem, not a solved pillar. What is true is that specialised builds are punished and the boss is not a health race.

## Time rules

The fight is live. Everything you decide, you decide **before** you press FIGHT (stitching) or in real time during it (ZAP on its cooldown, RETREAT). The pause menu freezes the clock and accepts **no** game actions: you cannot ZAP, retreat, stitch or steer the claw while paused. A fight you can plan frame by frame is not a fight.

Pausing is available everywhere (`P`, the Menu button, or the tab losing focus), because a game you cannot stop is a game you cannot play on a bus.

- **Check:** `tools/e2e.mjs`: two screenshots of a paused fight, seconds apart, are identical; clicking ZAP and RETREAT behind the pause menu does nothing; resuming carries on.
- **Not a collision:** a fight can be paused but not planned. That is the whole rule.

## The shape of a run

Fifteen stages in three acts. Every fifth is a boss and the last one, the Landlord, ends the run with a victory screen. There is no endless mode.

- **Why:** the first late-game bots showed a wall at stage 25 (78 losses to 12 wins among the runs that got there) and nothing to end it. A treadmill is not content.
- A run should take a careful player 18 to 35 minutes (bot time), and an average player should almost always finish. Both are targets in BALANCE.md.

---

## Things we said no to

Kept here so the argument is not had twice.

| Idea | Why not |
|---|---|
| Battle drops go straight into your bag | Breaks pillar 1. The claw would become optional. |
| Parts wear out | Breaks pillar 2. |
| A shop where tokens buy specific parts | Breaks pillar 1. Tokens buy grabs. |
| An endless mode after the last boss | The bots showed the wall it would end in. Cut, not deferred. |
| New part types to add depth | The 24 we have already cover every slot. Depth comes through the claw, the carry and the enemies, not through more catalogue. |
| A fourth enemy type | Three types, each asking something. Depth is in how they use the parts you already have. |
| More than three creatures in a party | The party cap is what makes the slot economy tight. |
| A flat "a few tokens for every failed fight" | Pays for pressing FIGHT then RETREAT. The ladder is scaled by damage dealt and capped, and the farm bots earn less than honest play. |
| A colour-blind palette swap | The cues are redundant instead (stars, glyphs, words, patterns), so there is nothing to swap. |
