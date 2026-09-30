// ---------------------------------------------------------------------------
// FALLBACKS — keep the game running if an optional module is missing/broken.
// ---------------------------------------------------------------------------
if (typeof AudioSys === 'undefined') window.AudioSys = { init() {}, toggleMute() {}, setMuted() {}, setVolumes() {}, muted: false, ctx: null };
if (typeof Sfx === 'undefined') window.Sfx = { play() {}, motor() {}, voice() {} };
if (typeof Music === 'undefined') window.Music = { play() {}, stop() {}, duck() {}, dim() {} };
if (typeof BG === 'undefined') {
  window.BG = {
    fill(ctx, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); },
    shop(ctx) { this.fill(ctx, '#1f1628'); },
    lab(ctx) { this.fill(ctx, '#12201a'); },
    graveyard(ctx) { this.fill(ctx, '#141430'); ctx.fillStyle = '#1d2a22'; ctx.fillRect(0, 214, W, 56); },
    dither(ctx, level, color) { if (level <= 0) return; ctx.globalAlpha = level / 16; ctx.fillStyle = color || '#0e0b16'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; },
  };
}
