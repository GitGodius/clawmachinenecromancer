// ---------------------------------------------------------------------------
// PART DEFINITIONS — what you can grab, what it does when stitched on.
// slot: head | torso | arm | leg | heart | back
// mat: impact sound family. alive: twitches in the machine.
// shape: 'hull' (convex hull of the sprite) or 'circle'. density ~ weight.
// ---------------------------------------------------------------------------
const PART_DEFS = {
  // heads
  skull:      { name: 'Skull',         slot: 'head',  rarity: 'common',    sprite: 'p_skull',      mat: 'bone',   density: 1.0, hp: 6,  atk: 2 },
  wolfskull:  { name: 'Wolf Skull',    slot: 'head',  rarity: 'uncommon',  sprite: 'p_wolfskull',  mat: 'bone',   density: 1.0, hp: 8,  atk: 5, trait: 'bite' },
  eyeball:    { name: 'Big Eyeball',   slot: 'head',  rarity: 'rare',      sprite: 'p_eyeball',    mat: 'squish', density: 0.9, hp: 5,  atk: 1, trait: 'keen', shape: 'circle', alive: true, restitution: 0.45, grip: 0.7 },
  demonskull: { name: 'Demon Skull',   slot: 'head',  rarity: 'rare',      sprite: 'p_demonskull', mat: 'bone',   density: 1.1, hp: 10, atk: 4, trait: 'hellfire' },
  crownskull: { name: 'Crowned Skull', slot: 'head',  rarity: 'legendary', sprite: 'p_crownskull', mat: 'metal',  density: 1.5, hp: 14, atk: 5, trait: 'royal', grip: 0.9 },
  // torsos
  ribcage:    { name: 'Ribcage',        slot: 'torso', rarity: 'common',   sprite: 'p_ribcage',  mat: 'bone',  density: 0.8, hp: 20 },
  stitched:   { name: 'Stitched Torso', slot: 'torso', rarity: 'common',   sprite: 'p_stitched', mat: 'flesh', density: 1.0, hp: 26 },
  armor:      { name: 'Rusty Cuirass',  slot: 'torso', rarity: 'uncommon', sprite: 'p_armor',    mat: 'metal', density: 1.5, hp: 24, def: 2, trait: 'plated' },
  ogregut:    { name: 'Ogre Gut',       slot: 'torso', rarity: 'rare',     sprite: 'p_ogregut',  mat: 'flesh', density: 1.1, hp: 50, trait: 'hefty', grip: 0.8 },
  // arms
  bonearm:    { name: 'Bony Arm',   slot: 'arm', rarity: 'common',   sprite: 'p_bonearm',  mat: 'bone',   density: 1.0, atk: 3, alive: true },
  fleshArm:   { name: 'Fleshy Arm', slot: 'arm', rarity: 'common',   sprite: 'p_fleshArm', mat: 'flesh',  density: 1.0, atk: 4, hp: 2, alive: true },
  clawarm:    { name: 'Ghoul Claw', slot: 'arm', rarity: 'uncommon', sprite: 'p_clawarm',  mat: 'flesh',  density: 1.0, atk: 5, trait: 'rend', alive: true },
  swordarm:   { name: 'Sword Arm',  slot: 'arm', rarity: 'uncommon', sprite: 'p_swordarm', mat: 'metal',  density: 1.2, atk: 7, grip: 0.9 },
  tentacle:   { name: 'Tentacle',   slot: 'arm', rarity: 'rare',     sprite: 'p_tentacle', mat: 'squish', density: 0.9, atk: 5, trait: 'reach', alive: true, grip: 0.8 },
  ogrearm:    { name: 'Ogre Arm',   slot: 'arm', rarity: 'rare',     sprite: 'p_ogrearm',  mat: 'flesh',  density: 1.2, atk: 11, trait: 'smash', alive: true, grip: 0.85 },
  // legs
  boneleg:    { name: 'Bony Leg',   slot: 'leg', rarity: 'common',   sprite: 'p_boneleg',  mat: 'bone',  density: 1.0, spd: 3 },
  fleshLeg:   { name: 'Fleshy Leg', slot: 'leg', rarity: 'common',   sprite: 'p_fleshLeg', mat: 'flesh', density: 1.0, spd: 3, hp: 3 },
  pegleg:     { name: 'Peg Leg',    slot: 'leg', rarity: 'common',   sprite: 'p_pegleg',   mat: 'wood',  density: 0.9, spd: 1, hp: 6 },
  goatleg:    { name: 'Goat Leg',   slot: 'leg', rarity: 'uncommon', sprite: 'p_goatleg',  mat: 'flesh', density: 1.0, spd: 5, trait: 'nimble' },
  // hearts
  heart:      { name: 'Heart',         slot: 'heart', rarity: 'common',    sprite: 'p_heart',      mat: 'squish', density: 1.0, hp: 10, trait: 'regen', shape: 'circle', alive: true, grip: 0.8 },
  blackheart: { name: 'Black Heart',   slot: 'heart', rarity: 'rare',      sprite: 'p_blackheart', mat: 'squish', density: 1.0, hp: 8,  trait: 'undying', shape: 'circle', alive: true, grip: 0.8 },
  goldheart:  { name: 'Heart of Gold', slot: 'heart', rarity: 'legendary', sprite: 'p_goldheart',  mat: 'metal',  density: 2.0, hp: 20, trait: 'golden', shape: 'circle', grip: 0.85 },
  // back
  wings:      { name: 'Bat Wings', slot: 'back', rarity: 'rare',     sprite: 'p_wings', mat: 'flesh', density: 0.6, trait: 'flutter' },
  tail:       { name: 'Bone Tail', slot: 'back', rarity: 'uncommon', sprite: 'p_vert',  mat: 'bone',  density: 1.2, atk: 2, trait: 'whip', chain: 6, alive: true },
};

const TRAITS = {
  bite:     { name: 'Bite',        desc: 'Heals 30% of damage dealt' },
  keen:     { name: 'Keen Eye',    desc: '30% chance to crit for x2' },
  hellfire: { name: 'Hellfire',    desc: 'Every 3rd attack: burning fireball' },
  royal:    { name: 'Royal Decree', desc: 'All allies +25% ATK' },
  plated:   { name: 'Plated',      desc: 'Takes 2 less damage per hit' },
  hefty:    { name: 'Hefty',       desc: 'Takes 20% less damage' },
  rend:     { name: 'Rend',        desc: 'Hits cause bleeding' },
  reach:    { name: 'Reach',       desc: 'Attacks from further away' },
  smash:    { name: 'Smash',       desc: 'Slow, but 30% chance to stun' },
  nimble:   { name: 'Nimble',      desc: '+15% dodge per goat leg' },
  regen:    { name: 'Heartbeat',   desc: 'Regenerates 2% HP per second' },
  undying:  { name: 'Undying',     desc: 'Revives once at 40% HP' },
  golden:   { name: 'Heart of Gold', desc: 'Regen, and +1 token per kill' },
  flutter:  { name: 'Flutter',     desc: '+25% dodge, moves faster' },
  whip:     { name: 'Tail Whip',   desc: '25% chance to strike twice' },
};

const SLOT_NAMES = { head: 'Head', torso: 'Torso', arm: 'Arm', leg: 'Leg', heart: 'Heart', back: 'Back' };
// creature layout: which slot keys exist and what part slot they take
const RIG_SLOTS = [
  ['head', 'head'], ['torso', 'torso'], ['armL', 'arm'], ['armR', 'arm'],
  ['legL', 'leg'], ['legR', 'leg'], ['heart', 'heart'], ['back', 'back'],
];
const RIG_SLOT_LABEL = { head: 'Head', torso: 'Torso', armL: 'Left Arm', armR: 'Right Arm', legL: 'Left Leg', legR: 'Right Leg', heart: 'Heart', back: 'Back' };

const RARITY_WEIGHT = { common: 60, uncommon: 26, rare: 11, legendary: 3 };

function randomPartType(opts = {}) {
  const boost = CONFIG.rareBoost * (opts.boost || 1);
  const w = [
    ['common', RARITY_WEIGHT.common],
    ['uncommon', RARITY_WEIGHT.uncommon * Math.sqrt(boost)],
    ['rare', RARITY_WEIGHT.rare * boost],
    ['legendary', RARITY_WEIGHT.legendary * boost],
  ];
  const bySlot = Object.keys(PART_DEFS).filter((k) => !opts.slot || PART_DEFS[k].slot === opts.slot);
  // only roll among rarities this slot actually has (there's no legendary torso, no common back part...)
  const avail = w.filter(([r]) => bySlot.some((k) => PART_DEFS[k].rarity === r));
  let rarity = opts.rarity && avail.some(([r]) => r === opts.rarity) ? opts.rarity : weightedPick(avail);
  const pool = bySlot.filter((k) => PART_DEFS[k].rarity === rarity);
  return pool.length ? pick(pool) : pick(bySlot);
}

let _partUid = 1;
function makePartItem(type) { return { uid: _partUid++, type }; }
