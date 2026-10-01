// ---------------------------------------------------------------------------
// BUILD — what kind of page is this? tools/build.mjs stamps the version into index.html; dev.html sets
// window.__DEV__ before loading anything. Developer tools (tuning panel, cheats, URL flags) only exist when
// BUILD.dev is true, so the page players get has none of them.
// ---------------------------------------------------------------------------
const BUILD = {
  dev: !!(typeof window !== 'undefined' && window.__DEV__),
  version: '0.0.0-dev', /*@version*/
  name: 'The Good Parts',
  issues: 'https://github.com/GitGodius/clawmachinenecromancer/issues/new',
};
