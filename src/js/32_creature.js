// ---------------------------------------------------------------------------
// CREATURES — stats from parts, a name, and a paper-doll rig renderer used on
// the slab (2x), in battle and in portraits. Any combination of parts is legal:
// no legs = it crawls, no arms = it bites, no torso = it's mostly stitches.
// ---------------------------------------------------------------------------
SPR.def('p_lump', { // stand-in torso when none is stitched on
  rows: [
    '...kkkkkk...',
    '.kkFFFFFgkk.',
    'kfFFhFhFFFgk',
    'kFFFFhFFFFgk',
    'kFgFFFFFhFgk',
    'kFFhFFFFFhgk',
    'kgFFFFFhFFgk',
    '.kggFhFFFgk.',
    '..kkggggkk..',
    '....kkkk....',
  ],
  anchor: [6, 5],
  points: { neck: [6, 1], shL: [1, 3], shR: [10, 3], hipL: [3, 8], hipR: [8, 8], heart: [6, 4], back: [6, 4] },
});

const GHOST_SPRITE = { head: 'p_skull', torso: 'p_ribcage', armL: 'p_bonearm', armR: 'p_bonearm', legL: 'p_boneleg', legR: 'p_boneleg', heart: 'p_heart', back: 'p_wings' };

const CREATURE_NAMES = ['Gerald', 'Mortimer', 'Bonnie', 'Doug', 'Patches', 'Nibbles', 'Frank', 'Helga', 'Moss', 'Pip', 'Barnaby', 'Igor Jr.',
  'Clive', 'Mabel', 'Ruth', 'Lefty', 'Grub', 'Old Tom', 'Bartholomew', 'Ribsy', 'Wendell', 'Gus', 'Agatha', 'Norbert', 'Ingrid', 'Chad',
  'Beatrix', 'Humphrey', 'Dot', 'Sir Limbsworth', 'Lady Gristle', 'Kevin', 'Tibia', 'Femurella', 'Stanley', 'Marrow', 'Deborah', 'Knuckles'];
const TITLE_FALLBACK = ['the Stitched', 'the Unlikely', 'the Earnest', 'the Lumpy', 'the Brave', 'the Damp', 'the Adequate', 'the Probably Fine', 'the Reassembled', 'the Second-Hand'];

let _creatureId = 1;
class Creature {
  constructor(slots) {
    this.id = _creatureId++;
    this.slots = Object.assign({ head: null, torso: null, armL: null, armR: null, legL: null, legR: null, heart: null, back: null }, slots);
    this.compute();
    this.hp = this.maxHp;
    this.name = Creature.makeName(this.slots);
    this.born = 0;
    this.kills = 0;
  }
  parts() { return Object.values(this.slots).filter(Boolean); }
  has(trait) { return this.traits.includes(trait); }
  compute() {
    const S = this.slots, D = (t) => (t ? PART_DEFS[t] : null);
    const all = this.parts().map(D);
    const arms = [S.armL, S.armR].filter(Boolean).map(D);
    const legs = [S.legL, S.legR].filter(Boolean).map(D);
    const head = D(S.head);
    let hp = 8 + all.reduce((a, d) => a + (d.hp || 0), 0);
    let atk = arms.reduce((a, d) => a + (d.atk || 0), 0);
    if (head) atk += arms.length ? (head.atk || 0) * 0.4 : head.atk || 0; // no arms? it bites
    if (S.back && D(S.back).atk) atk += D(S.back).atk;
    if (atk <= 0) atk = 1; // it flops at them, aggressively
    const spd = legs.reduce((a, d) => a + (d.spd || 0), 0);
    this.traits = [...new Set(all.map((d) => d.trait).filter(Boolean))];
    this.maxHp = Math.round(hp);
    this.atk = Math.round(atk * 10) / 10;
    this.def = all.reduce((a, d) => a + (d.def || 0), 0);
    this.spd = spd;
    this.moveSpeed = (legs.length ? 12 + spd * 4 : 7) + (this.traits.includes('flutter') ? 10 : 0);
    this.atkTime = 1.25 + (arms.some((d) => d.trait === 'smash') ? 0.45 : 0) - Math.min(0.35, spd * 0.03);
    this.range = 26 + (this.traits.includes('reach') ? 22 : 0);
    const goats = legs.filter((d) => d.trait === 'nimble').length;
    this.dodge = Math.min(0.5, goats * 0.15 + (this.traits.includes('flutter') ? 0.25 : 0));
    this.crit = this.traits.includes('keen') ? 0.3 : 0.05;
    this.power = Math.round(this.maxHp * 0.5 + this.atk * 6 / this.atkTime + this.spd * 2);
  }
  static makeName(S) {
    const t = Object.values(S).filter(Boolean);
    const count = (pred) => t.filter((x) => pred(PART_DEFS[x], x)).length;
    let title = null;
    if (S.head === 'crownskull') title = 'the Magnificent';
    else if (S.heart === 'goldheart') title = 'Heart of Gold';
    else if (count((d, k) => k.startsWith('ogre')) >= 2) title = 'the Enormous';
    else if (t.includes('tentacle')) title = 'the Tentacular';
    else if (S.head === 'wolfskull') title = 'the Hungry';
    else if (S.head === 'eyeball') title = 'the Watcher';
    else if (S.head === 'demonskull') title = 'the Damned';
    else if (S.back === 'wings') title = 'the Flappy';
    else if (!S.legL && !S.legR) title = 'No-Legs';
    else if (!S.head) title = 'the Headless';
    else if ((S.legL === 'pegleg') !== (S.legR === 'pegleg') && S.legL && S.legR) title = 'the Lopsided';
    else if (count((d) => d.mat === 'bone') >= 4) title = 'the Rattly';
    else if (!S.heart && t.length >= 5) title = 'the Heartless';
    return pick(CREATURE_NAMES) + ' ' + (title || pick(TITLE_FALLBACK));
  }
}

// ------------------------------------------------------------------- rig
// Returns joint positions relative to the feet (0,0), in art px.
function rigLayout(S) {
  const spr = (t) => (t ? SPR.get(PART_DEFS[t].sprite) : null);
  const torso = spr(S.torso) || SPR.get('p_lump');
  const P = torso.pts;
  const lL = spr(S.legL), lR = spr(S.legR);
  const lenL = lL ? lL.h - lL.ay : 0, lenR = lR ? lR.h - lR.ay : 0;
  const hipH = Math.max(lenL, lenR);
  const hipAvgY = (P.hipL[1] + P.hipR[1]) / 2;
  const tx = 0;
  const ty = hipH > 0 ? -hipH - (hipAvgY - torso.ay) : -(torso.h - torso.ay);
  const j = (pt) => [tx + pt[0] - torso.ax, ty + pt[1] - torso.ay];
  let tilt = 0;
  if (lL && lR && lenL !== lenR) tilt = Math.atan2(lenR - lenL, (P.hipR[0] - P.hipL[0]) * 3) * 0.9;
  return {
    torso, tx, ty, tilt,
    neck: j(P.neck), shL: j(P.shL), shR: j(P.shR), hipL: j(P.hipL), hipR: j(P.hipR), heart: j(P.heart), back: j(P.back),
    lenL, lenR, hipH,
    top: ty - torso.ay - (S.head ? SPR.get(PART_DEFS[S.head].sprite).h : 0),
  };
}

// Draw a creature with its feet at (x, y).
// o: { scale, t, anim:'idle'|'walk'|'attack'|'dead', animT (0..1), flip, flash, alpha, eyes (color), ghost (empty-slot silhouettes), dim }
function drawCreature(ctx, slots, x, y, o = {}) {
  const L = rigLayout(slots);
  const t = o.t || 0;
  const sc = o.scale || 1;
  const anim = o.anim || 'idle';
  let bob = 0, legA = 0, armA = 0, armB = 0, lunge = 0, headDX = 0, headDY = 0, lean = 0;
  if (anim === 'idle') {
    bob = Math.round(Math.sin(t * 2.6) * 0.8 + 0.3);
    armA = Math.sin(t * 2.6) * 0.07; armB = -armA;
  } else if (anim === 'walk') {
    const w = t * 9;
    legA = Math.sin(w) * 0.42;
    bob = Math.round(Math.abs(Math.cos(w)) * -1.4 + 0.7);
    armA = -Math.sin(w) * 0.35; armB = -armA;
    if (!slots.legL && !slots.legR) { legA = 0; bob = Math.round(Math.sin(w) * 1); lean = Math.sin(w * 0.5) * 0.1; }
  } else if (anim === 'attack') {
    const a = o.animT || 0;
    if (a < 0.4) { const k = easeOutCubic(a / 0.4); armA = 0.7 * k; lunge = -1 * k; lean = -0.08 * k; }
    else if (a < 0.6) { const k = easeOutCubic((a - 0.4) / 0.2); armA = lerp(0.7, -1.9, k); armB = lerp(0, -0.6, k); lunge = lerp(-1, 5, k); lean = lerp(-0.08, 0.14, k); }
    else { const k = easeInOutQuad((a - 0.6) / 0.4); armA = lerp(-1.9, 0, k); armB = lerp(-0.6, 0, k); lunge = lerp(5, 0, k); lean = lerp(0.14, 0, k); }
    if (!slots.armL && !slots.armR) { headDX = lunge * 1.2; headDY = lunge > 2 ? 1 : 0; }
  }
  const S = slots;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (o.flip) ctx.scale(-sc, sc); else ctx.scale(sc, sc);
  ctx.translate(Math.round(lunge), 0);
  const alpha = o.alpha == null ? 1 : o.alpha;
  ctx.globalAlpha = alpha;
  const flash = o.flash ? '#fff6e3' : null;
  const ghost = o.ghost;
  const part = (slot, spX, spY, rot, extra = {}) => {
    const type = S[slot];
    if (!type) {
      if (ghost) SPR.draw(ctx, GHOST_SPRITE[slot], spX, spY, { rot, solid: ghost, alpha: 0.9 * alpha, flip: extra.flip });
      return;
    }
    const d = PART_DEFS[type];
    SPR.draw(ctx, d.sprite, spX, spY, Object.assign({ rot: rot || 0.0001, solid: flash || o.solid || undefined }, extra));
  };
  const up = bob; // negative = up
  // upper body pivot (pelvis) for lean/tilt
  const pelvisY = L.hipH > 0 ? -L.hipH : 0;
  ctx.save();
  ctx.translate(0, pelvisY);
  ctx.rotate(L.tilt + lean);
  ctx.translate(0, -pelvisY + up);
  // back parts
  if (S.back === 'wings' || (!S.back && ghost)) {
    const flap = S.back ? Math.sin(t * (anim === 'walk' ? 14 : 4)) * 0.12 : 0;
    part('back', L.back[0], L.back[1] + 2, flap);
  } else if (S.back === 'tail') {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const px = L.back[0] - 3 - i * 4 + Math.sin(t * 3 + i * 0.8) * i * 0.6;
      const py = L.hipL[1] - 2 + i * 1.5 - Math.sin(k * 3) * 3;
      SPR.draw(ctx, i === n - 1 ? 'p_tailtip' : 'p_vert', px, py, { rot: 0.0001 + i * 0.25, solid: flash || undefined });
    }
  }
  ctx.restore();
  // legs (not tilted, they carry the body)
  const legSwing = (side) => (anim === 'walk' ? (side ? legA : -legA) : 0);
  part('legR', L.hipR[0] + 1, L.hipR[1] + 1 + Math.max(0, up), legSwing(0) + 0.0001);
  part('legL', L.hipL[0] - 1, L.hipL[1] + 1 + Math.max(0, up), legSwing(1) + 0.0001, { flip: false });
  ctx.save();
  ctx.translate(0, pelvisY);
  ctx.rotate(L.tilt + lean);
  ctx.translate(0, -pelvisY + up);
  // heart sits behind the torso (visible through ribs)
  if (S.heart) {
    const beat = Math.sin(t * 7) > 0.6 ? 1 : 0;
    part('heart', L.heart[0] - beat * 0, L.heart[1], 0.0001);
  } else if (ghost && S.torso === 'ribcage') part('heart', L.heart[0], L.heart[1], 0.0001);
  // torso
  if (S.torso) part('torso', 0, L.ty, 0.0001);
  else {
    if (ghost) SPR.draw(ctx, GHOST_SPRITE.torso, 0, L.ty - 4, { solid: ghost });
    if (!o.noLump) SPR.draw(ctx, 'p_lump', 0, L.ty, { solid: flash || undefined });
  }
  // arms: far arm (right side of the picture = leading arm when facing right)
  part('armR', L.shR[0] + 1, L.shR[1], armA + 0.0001);
  part('armL', L.shL[0] - 1, L.shL[1], armB + 0.0001);
  // head
  const hx = L.neck[0] + headDX, hy = L.neck[1] + 1 + headDY + (anim === 'idle' ? Math.round(Math.sin(t * 2.6 - 0.6) * 0.5) : 0);
  if (S.head) {
    part('head', hx, hy, 0.0001);
    if (o.eyes && !flash) {
      const hs = SPR.get(PART_DEFS[S.head].sprite);
      const E = hs.pts;
      if (S.head === 'eyeball') drawIris(ctx, hx - hs.ax + E.iris[0], hy - hs.ay + E.iris[1], o.lookX || 1, 0, o.eyes);
      else if (E.eyeL) {
        ctx.fillStyle = o.eyes;
        const blink = Math.sin(t * 1.3 + x) > 0.985;
        if (!blink) {
          ctx.fillRect(Math.round(hx - hs.ax + E.eyeL[0]), Math.round(hy - hs.ay + E.eyeL[1]), 2, 1);
          ctx.fillRect(Math.round(hx - hs.ax + E.eyeR[0]), Math.round(hy - hs.ay + E.eyeR[1]), 2, 1);
        }
      }
    }
  } else if (ghost) part('head', hx, hy, 0);
  ctx.restore();
  ctx.restore();
  ctx.globalAlpha = 1;
  return L;
}

// Eyeball iris (the eyeball part has no baked iris so it can look around)
function drawIris(ctx, cx, cy, dx, dy, tint) {
  const L = Math.hypot(dx, dy) || 1;
  const ox = Math.round((dx / L) * 1.6), oy = Math.round((dy / L) * 1.6);
  const x = Math.round(cx + ox), y = Math.round(cy + oy);
  ctx.fillStyle = tint && tint !== true ? tint : PAL.v;
  ctx.fillRect(x - 2, y - 1, 4, 2); ctx.fillRect(x - 1, y - 2, 2, 4);
  ctx.fillStyle = PAL.C; ctx.fillRect(x - 2, y - 1, 1, 1);
  ctx.fillStyle = PAL.k; ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.fillStyle = PAL.j; ctx.fillRect(x - 1, y - 1, 1, 1);
}

// Pixel-perfect icon of a part scaled to fit a box (used for inventory cells).
function drawPartIcon(ctx, type, cx, cy, maxSize = 22, opts = {}) {
  const d = PART_DEFS[type];
  const s = SPR.get(d.sprite);
  if (d.chain) { // bone tail: little curl of vertebrae
    for (let i = 0; i < 4; i++) SPR.draw(ctx, i === 3 ? 'p_tailtip' : 'p_vert', cx - 6 + i * 4, cy + Math.round(Math.sin(i * 1.2) * 3), { rot: 0.0001 + i * 0.3, alpha: opts.alpha });
    return;
  }
  const big = Math.max(s.w, s.h) > maxSize;
  const rot = big ? -Math.PI / 4 : 0.0001;
  const o = { rot, alpha: opts.alpha, solid: opts.solid };
  if (opts.outline) {
    const ol = SPR.outline(d.sprite, opts.outline);
    ctx.save(); ctx.translate(Math.round(cx), Math.round(cy)); ctx.rotate(rot); ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.drawImage(ol, -s.w / 2 - 1, -s.h / 2 - 1); ctx.restore(); ctx.globalAlpha = 1;
  }
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));
  ctx.rotate(rot);
  ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
  ctx.drawImage(o.solid ? SPR.solid(d.sprite, o.solid) : s.c, -Math.round(s.w / 2), -Math.round(s.h / 2));
  ctx.restore();
  ctx.globalAlpha = 1;
  if (type === 'eyeball') drawIris(ctx, cx, cy, 1, 0.3);
}
