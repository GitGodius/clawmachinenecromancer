# Balance

Every number that decides how the game plays is measured here, by code that plays the game, so the next person can retune without guessing. Nothing in this file is opinion except the **targets**, and those are enforced.

```sh
node tools/balance.mjs           # measure everything (about 10 minutes, all cores) and rewrite this file + balance.json
node tools/balance.mjs --quick   # everything except the slow real-physics parts (about 90 s)
node tools/balance.mjs --check   # CI: fails if a number changed without this file, or a target is missed
node tools/test.mjs              # rules regression: fixed-seed fights and grabs must not move
```

The blocks between `BEGIN` and `END` markers are generated. Do not edit them; change the game, then run the tool.

## What the numbers are for

<!-- BEGIN targets -->
|  | Target | Measured |
|---|---:|---:|
| ✅ | The carry is a skill: a careful carrier wins at least 8 points more grabs than a masher | careful 68% vs masher 57% (gap 11) |
| ✅ | The assist is a fair helper: better than mashing, no better than careful play | masher 57% < assisted 70% <= careful 68% (+5 noise) |
| ✅ | A careful player finishes a run (95% or more) | 100% |
| ✅ | An average player finishes a run (90% or more) | 100% |
| ✅ | A masher can still finish (40% or more), an assisted player too | masher 88%, assisted 97% |
| ✅ | A run takes 18 to 35 minutes for careful and average players (bot time, faster than a human) | careful 19 min, average 19 min |
| ✅ | No early wall: 95% of average players clear the first boss | 100% |
| ✅ | Farming cannot beat playing: retreating at the first scratch earns less per minute than honest play | honest 10.93/min, farm15 4.51, farm50 6.49 |
| ✅ | Nothing is wasted: no part physically leaves the machine in a real-physics run | careful 0, average 0, masher 0, assisted 0 |
| ✅ | Build for the graveyard (1): at final-stage strength the best build is not the same against every enemy | wisps  x4: tank; shades x3: tank; wraith x1: bruiser |
| ✅ | Build for the graveyard (2): a specialised build can be unable to beat an enemy at all (under 25%) | skirmish vs shades x3 2%; skirmish vs wraith x1 18% |
| ✅ | A full party built from good picks beats stage 5 reliably and the final stage more often than not | stage 5: 100%, stage 15: 97% |
<!-- END targets -->

## The numbers

<!-- BEGIN numbers -->
| Number | Value |
|---|---:|
| Start tokens / win pay / restock | 7 / 4 + stage / 3 parts |
| Partial pay (lost or retreated fight) | 0.7 x win pay x damage dealt, plus a ladder of up to 4 |
| Enemy growth per stage | +14% HP and ATK |
| Wisp / Shade / Wraith HP | 10 / 24 / 50 |
| Shade armour | 3 |
| Carry: momentum / steady speed | 60 px/s² / 28 px/s |
| Carry: strain per full-speed lurch / per s over steady / calms over | 1 / 2.5 / 0.6 s |
| Grip: strength / soul hook / fray rate / re-seat rate | 4x a skull / 2x gravity / 2.5/s / 1.2/s |
| Assist speed | 60% of steady |
| Stages | 15, bosses every 5th |
| Fingerprint of all balance numbers | `128480ce45f3` |
<!-- END numbers -->

## Evidence

### The claw

<!-- BEGIN claw -->
| Player | Aim error | Carry | Grabs won | Kept once lifted |
|---|---:|---:|---:|---:|
| careful | 1.5 px | gentle | 68% | 95% |
| average | 3 px | okay | 69% | 95% |
| masher | 5 px | jerky | 57% | 77% |
| assisted | 5 px | auto | 70% | 95% |

300 grabs each on fresh piles, real physics.
<!-- END claw -->

*Grabs won* is the chance a drop ends with a part in the chute. *Kept once lifted* is the number the carry moves: of the grabs that lifted something, how many got it all the way. Aim decides whether you lift anything; the carry decides whether you keep it. The bots that stand for a careful player and a masher differ only in how they steer while carrying.

### Fights

<!-- BEGIN battles -->
| Party (random parts) | S1 | S2 | S3 | S4 | S5 | S6 | S8 | S10 | S12 | S15 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 creature, 3 parts | 100% | 75% | 22% | 10% | 3% | 17% | 0% | 0% | 0% | 0% |
| 1 creature, 5 parts | 100% | 100% | 90% | 45% | 28% | 77% | 3% | 2% | 0% | 0% |
| 2 creatures, 4 parts | 100% | 100% | 85% | 67% | 28% | 70% | 0% | 0% | 0% | 0% |
| 3 creatures, 5 parts | 100% | 100% | 100% | 100% | 95% | 100% | 67% | 45% | 12% | 3% |
| 3 creatures, 7 parts | 100% | 100% | 100% | 100% | 100% | 100% | 97% | 97% | 57% | 15% |

| Party (best of 3 picks per slot) | S1 | S2 | S3 | S4 | S5 | S6 | S8 | S10 | S12 | S15 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 creatures, 8 parts, best of 3 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 97% |
| 2 creatures, 8 parts, best of 3 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 80% |
<!-- END battles -->

Random parts show how far luck alone gets you. The best-of-3 rows are closer to a player, who picks what to aim at. The final stage is meant to be a real wall for a random party and a fair fight for a good one.

### Who asks what

<!-- BEGIN matchups -->
| Build (x3) | wisps  x4 | shades x3 | wraith x1 |
|---|---:|---:|---:|
| tank | 100% (90% HP left) | 100% (82% HP left) | 100% (55% HP left) |
| plated | 100% (83% HP left) | 37% (34% HP left) | 73% (27% HP left) |
| bruiser | 100% (73% HP left) | 98% (62% HP left) | 100% (75% HP left) |
| skirmish | 100% (74% HP left) | 2% (17% HP left) | 18% (36% HP left) |
<!-- END matchups -->

Three copies of one build against one enemy type at stage 15 strength, each build spending the same budget of rarity (one rare, two uncommons, the rest common; see `tools/matchups.mjs`). Wisps swarm. Shades are armoured, and armour is taken off every arm's strike separately, so a build of small hits does almost nothing to them. The Wraith is a huge, slow boss. The point of the table is that its best cell is not always in the same row and that some cells are empty. It also shows the open problem: the tank is best against Wisps and Shades, and Wisps do not yet ask a question that any build fails.

### Whole runs

<!-- BEGIN econ -->
| Player | Finish | ≤30 min | ≤60 min | ≤90 min | Median (min) | Past boss 1 | Grabs | Fights lost | Retreats | Tokens/min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| careful | 100% | 100% | 100% | 100% | 19 | 100% | 48.4 | 0.1 | 0.1 | 10.93 |
| average | 100% | 100% | 100% | 100% | 19 | 100% | 48.4 | 0.1 | 0.1 | 10.93 |
| masher | 88% | 64% | 88% | 88% | 23 | 97% | 88.7 | 9.1 | 7.7 | 6.24 |
| assisted | 97% | 81% | 95% | 97% | 21 | 100% | 74.2 | 3.2 | 2.7 | 7.91 |
| farm15 | 0% | 0% | 0% | 0% | - | 0% | 42.6 | 60 | 60 | 4.51 |
| farm50 | 0% | 0% | 0% | 0% | - | 0% | 42.7 | 60.4 | 60.3 | 6.49 |

200 runs each with the no-physics grab model (grab odds from the claw table).
<!-- END econ -->

*farm15* and *farm50* are adversaries: they fight, retreat as soon as they have done 15% (or 50%) of the enemy's health, and spend what the failure ladder pays. If they ever out-earn honest play the ladder is an exploit. They do not, which is why the ladder is capped where it is.

<!-- BEGIN econPhysics -->
| Player | Finish | Median (min) | Past boss 1 | Grabs | Fights lost | Parts lost from machine |
|---|---:|---:|---:|---:|---:|---:|
| careful | 92% | 22 | 92% | 71.8 | 5.2 | 0 |
| average | 92% | 22 | 92% | 82.2 | 6.2 | 0 |
| masher | 92% | 20 | 100% | 73.8 | 6.8 | 0 |
| assisted | 92% | 18 | 100% | 68.8 | 6.6 | 0 |

12 runs each with the real claw. Small samples: read these as "the model is not lying", not as precise rates.
<!-- END econPhysics -->

## How we got here

Kept so nobody re-runs the same experiments. Numbers in this section are from the day they were measured and are not regenerated.

**1. The first late-game test found three things the early game hid.** Twenty-four real-physics runs to stage 30 (8 each of a careful, an average and a masher bot) under the prototype's rules:

- *A poverty trap at stages 3 to 5.* About a quarter of runs stalled there, often after 14 to 17 lost fights in a row. A defeat paid 1 token and scattered the party's parts back into the machine, and winning them back costs about 30 tokens. Runs that got stuck had ~30 parts in the world against ~110 in healthy runs.
- *An endless wall late.* Stage 25 saw 78 losses against 12 wins across the runs that got there. Nothing ever ended the run, so the wall was just a treadmill. Fix: a run is 15 stages and the last boss ends it. We considered an endless mode and cut it (see DESIGN.md, things we said no to).
- *No skill in the carry.* Grab win rate was 51.6% for the careful bot, 54.1% average, 55.3% for the masher. Pillar 3 was false.
- Good news: across those 24 runs, **zero parts physically fell out of the machine**. "Nothing is wasted" held.

**2. The economy was a cliff, not a slope.** With a fast no-physics model of the grab, a drop from 46% to 40% grab success took the finish rate from 88% to 25%. A player with slightly worse hands could not recover, however long they tried. Things that did not fix it: easing the first boss alone (35% to 53% for a masher, but the late game stayed a wall); a flat failure ladder (worked, and was exploitable, see below). Things that did: enemy growth per stage (the strongest single lever: 0.20 to 0.16 lifted a masher from ~35% to ~65% finishing), a lighter first boss, partial pay for failed fights, retreat heals everyone, and the ladder scaled by damage dealt. (Several of the numbers named here were changed again by 6; the table above always has the current ones.)

**3. The ladder had to be made unfarmable.** A flat "+1 token per consecutive failed fight" pays for pressing FIGHT then RETREAT. The farm bots showed it: at a cap of 8 they out-earned honest play. Scaling the ladder by the damage you did, and capping it at 4, puts them at about 85-90% of honest income, which is the point of the target.

**4. Making the carry a skill took two tries.** Momentum on the carriage and slip odds that grow with carry speed moved the gap only from 4 to 8 points. Sweeping `swingSlip` from 0.4 to 2.2 did nothing more, and that was the clue: a lost grip removed the grip spring, but the prongs form a cup and kept holding the part anyway. 30 swing "slips" cost only 13 dropped parts. When the last grip is lost the jaws now sag open for half a second (`slipOpen`), so a slip is a drop. After that the gap became measurable, and the base slip odds were re-tuned so a steady carry is nearly safe.

**5. The assist first beat careful play** (46% against 44%), which made the skill pointless. It now cruises at 60% of the steady speed, so it costs a little time, and a careful human doing the quick steady line does slightly better.

**6. Pillar 4 failed its own test, and the fix moved the whole economy.** "Build for the graveyard" says no single build should be best against everything. The first matchup table had a hand-made "balanced" build topping every column. That was unfair (it simply had better parts), so the builds were rebuilt on an equal budget of rarity, and then the *tank* topped every column, in every one of 96 combinations of Shade armour, Shade HP, Wisp attack, Wisp speed and ogre-gut health that were tried. The damage model was the cause: a creature's arms were added into one hit, so armour of 2 shaved a quarter off an 8-damage hit and health decided everything. Making each arm its own strike (armour is taken off each one) gave armour teeth: at stage 15 strength a build of small hits wins 0% against Shades. A second search (72 combinations, at the strength where builds actually fail) never gave the Wisp column to a specialist, so the pillar is worded to what the evidence supports: specialised builds are punished and the boss rewards burst over bulk, but bulk is still the best answer to Wisps and Shades. Wisps got faster and harder and the ogre gut lost 8 health. That made the game harder overall (careful 88%, average 85%, masher 20% finishing, and a farm adversary out-earning honest play at 118%). The first fix, softer enemies, undid the identity (growth 0.12 with a lighter boss let the small-hit build beat Shades 54% of the time and cut the bruiser's edge on the Wraith to 5 points). So the identity was held up instead, with armour 3 on Shades and on the Wraith, and the economy was bought back with income: win pay 3 to 4, starting purse 6 to 7, partial pay 0.7, and a lighter Wraith (50 health). The two lessons: **growth per stage trades identity for economy, income does not**; and the bots' finish rates were noisy enough at 60 runs (plus or minus 4 points) that a candidate had to pass with margin in a second sample before it was chosen.

**7. The grab became physical, and the carry needed a new spine.** The soul grip replaced the dice: what the prongs close around is what you get. On the same 1000 seeded piles it won 74% of grabs against the dice grab's 52%, the exact target 50% against 25%, and lost a centred catch 8% of the time against 37%. But it had no carry skill at all (careful minus masher: +0.5 points), because a part locked in the cage rides out any carry. Rolled slips would have contradicted "nothing is rolled", so the carry was rebuilt on the physics: lurches and speed past the steady speed build strain, a grip whose catch can't take the strain frays (the part visibly slides and the meter says so), easing off re-seats it, and a grip frayed through tears and the jaws sag. Sweeping `strainSpeed`: 1 gave a gap of 1 point, 2 gave 5 to 9, 2.5 gives 11 to 13 without moving careful, average or the assist (68-70%), and 3 gave 17 with the masher at 51%, too harsh for a first build. The soul grip also pays out about 1.6 times the parts per token, so runs got shorter and easier: in the fast model careful went from 23 to 19 minutes and from 2.8 to 0.1 fights lost; with real physics from 32 to 22 minutes and from 13.1 to 5.2 fights lost, still 92% finishing. Cutting income (win pay 3, a starting purse of 5, or both) or raising enemy growth to 0.16 barely moved the careful and average rows (at most 0.6 fights lost): with a claw this reliable their party is limited by its slots, not by tokens, and those knobs mostly punish the masher. So the economy was left as it was. If humans find the battles too easy, retune the economy; don't make the claw worse.

## Retuning guide

| To change | Turn | Watch |
|---|---|---|
| How hard the run is overall | `enemyGrowth` | finish rate for masher and assisted; it is the strongest lever |
| How much a lost fight hurts | `partialPay`, `ladderMax` | the farm rows in *Whole runs* must stay under honest play |
| How much the carry matters | `strainSpeed`, `strainLurch`, `swingSafe`, `frayRate`, `carryAccel` | the careful-minus-masher gap in *The claw*; careful and the assist must not move |
| The assist | `assistSpeed` | assisted must stay between masher and careful |
| Who beats whom | `ENEMY_KINDS` (armour, HP, speed) | *Who asks what*: no row may win every column |
| Pace | `winTokens`, `startTokens`, `restockParts` | median minutes and the "past boss 1" column |

After any change: `node tools/balance.mjs`, read the targets block, commit the regenerated files with the change.

## What this does not tell you

- **Bots are not people.** They aim with Gaussian noise and steer with two fixed habits. A human's carry is somewhere between the careful and masher rows and varies from grab to grab. No human has played this build.
- **The grab model in *Whole runs* is a model.** It keeps recycling, depletion and top-ups and drops the physics. The small real-physics table is there to catch it lying. Both bots choose their own targets and stitch by a fixed rule; a human will do worse and better.
- **Times are bot times.** Bots aim instantly. A person takes longer per grab.
- **Nothing here says it is fun.** That is what the playtest section of PROTOTYPE.md is for.
