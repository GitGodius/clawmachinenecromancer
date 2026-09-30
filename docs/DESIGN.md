# The Good Parts: design

> **The promise.** Every monster you send to fight is built from parts you won from the claw, and every part it loses goes back in the machine.

That sentence is the game. A feature that makes it false is cut, or it is a setting the player opts into knowingly (see the assists in [ACCESSIBILITY.md](ACCESSIBILITY.md)). A feature that makes it truer gets built.

The pillars below say what the promise means in enough detail to settle an argument. Each one names what it **forbids**, the **system that tests it** (an enemy or a rule that would break if the pillar were only decoration), and the **check** that keeps it true. Checks run with `node tools/test.mjs` and `node tools/balance.mjs --check`.

---

## 1. The claw is the only door

A part enters your bag only by dropping down the chute. That includes a stray that drops in between grabs (the Reaper calls it a free one). It does not include anything else.

- **Forbids:** a battle that hands you the part you wanted; tokens that buy parts; pity that gives parts; any "pick your reward" screen.
- **Allows:** battles that pay **tokens**, and drop parts into the **machine**, where they are as hard to get as any other part.
- **Tested by:** the restock rule. A win puts 3 parts in the pile, never in the bag. The pity floor gives tokens, never parts.
- **Check:** the run bot (`tools/run_sim.mjs`) audits every run: bag additions must equal chute wins.

## 2. Nothing is wasted

The rules never destroy a part. A creature that dies falls apart into the machine. Unstitching returns parts to the bag. The machine tops itself up before it runs dry.

- **Forbids:** durability, permanent death of parts, any "lost forever" outcome, a run that ends because the pile emptied.
- **Allows:** losing time: a dead creature costs you the grabs it takes to win its parts back, and the stitching.
- **Tested by:** defeat. It is the only place the pillar is under pressure, so the defeat screen says exactly where the parts went.
- **Check:** the run bot's conservation audit. Parts in the world = parts at the start + restocks - parts that physically left the machine.

## 3. The carry is the skill

Winning a part is decided in two places: where you drop the claw, and how you steer once it has something. The second one is the one you can be good at.

- **Forbids:** a claw that carries for you by default; slip odds that ignore how you steer.
- **Allows:** an opt-in **auto-carry** assist, which is honest about costing a little grip (see [BALANCE.md](BALANCE.md)); a longer carry timer.
- **Tested by:** the swing model. Held parts swing on their grip, and slip odds rise with how hard they swing. The wobble meter shows it so the cause is never a mystery.
- **Check:** `node tools/balance.mjs`: the careful bot must beat the masher by a fixed margin, and the assist must land between them.

## 4. Build for the graveyard

Each enemy asks a different question of your parts, and the Reaper tells you which one is coming.

- **Wisps** are quick and slippery. They ask: *can you catch me, and can you hit often enough?*
- **Shades** are armoured. They ask: *does a single hit hurt?*
- **Wraiths** are bosses. They ask: *can you last?*

- **Forbids:** one build that is best against everything; a stage preview that lies.
- **Allows:** a build that is bad against one enemy on purpose.
- **Tested by:** the enemies themselves, and the stage preview on the slab and in the shop, so the claw has a shopping list.
- **Check:** `node tools/matchups.mjs`: no single archetype may top every column of the matchup table.

## Time rules

The fight is live. Everything you decide, you decide **before** you press FIGHT (stitching) or in real time during it (ZAP on its cooldown, RETREAT). The pause menu freezes the clock and accepts **no** game actions: you cannot ZAP, retreat, stitch or steer the claw while paused. A fight you can plan frame by frame is not a fight.

Pausing is available everywhere (**P**, or the pause button), because a game you cannot stop is a game you cannot play on a bus.

---

## Things we said no to

Kept here so the argument is not had twice.

| Idea | Why not |
|---|---|
| Battle drops go straight into your bag | Breaks pillar 1. The claw would become optional. |
| Parts wear out | Breaks pillar 2. |
| A shop where tokens buy specific parts | Breaks pillar 1. Tokens buy grabs. |
| New part types to add depth | The 24 we have already cover every slot. Depth comes through the claw, the carry and the enemies, not through more catalogue. |
| More than three creatures in a party | The party cap is what makes the slot economy tight. |
