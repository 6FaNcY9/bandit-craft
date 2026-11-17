'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.OV = root.OV || {}).blocks = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // Passable or tiny things that are never drawn: air and plants/torches/rails/signs (a model of them would add noise, not information).
  const NOT_DRAWN = /^(air|cave_air|void_air|short_grass|tall_grass|grass|fern|large_fern|seagrass|tall_seagrass|kelp|kelp_plant|vine|cave_vines|cave_vines_plant|glow_lichen|dead_bush|sugar_cane|snow|cobweb|fire|torch|wall_torch|soul_torch|soul_wall_torch|redstone_torch|redstone_wall_torch|redstone_wire|ladder|rail|powered_rail|detector_rail|activator_rail|lever|[a-z_]*(_flower|_sapling|_carpet|_sign|_wall_sign|_button|_pressure_plate|_tulip|_orchid|_bluet|_mushroom)|dandelion|poppy|azure_bluet|cornflower|lily_of_the_valley|sweet_berry_bush|wheat|carrots|potatoes|beetroots)$/;
  // Same colours as the plan view in index.html (PLANCOL); first match wins.
  const PLANCOL = [[/glass/, 0xbfe8f5], [/water/, 0x3366ff], [/lantern|torch|glowstone|lamp/, 0xffe080], [/deepslate|blackstone|basalt/, 0x4a4a55], [/^brick|mud_brick/, 0x9a4a3a], [/quartz/, 0xeee8dc], [/purpur|amethyst/, 0xa070c0], [/copper/, 0xc07040],
    [/stone|cobble|andesite|tuff|diorite|granite/, 0x8a8a8a], [/dark_oak/, 0x4a3018], [/spruce/, 0x6b4a2a], [/leaves/, 0x2f7d2f], [/oak|birch|planks|log|wood/, 0xb08850], [/grass_block|moss/, 0x5fa83a], [/dirt/, 0x7a5230]];

  // 'minecraft:oak_stairs[facing=east]' -> 'oak_stairs'
  const nameOf = (state) => state.replace(/^minecraft:/, '').replace(/\[.*$/, '');
  const drawn = (name) => !NOT_DRAWN.test(name);
  // HSL to RGB (0..255) as planColor's fallback: three.js setHSL stores linear values, getHex encodes them to sRGB.
  function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    return [f(0), f(8), f(4)].map((v) => Math.round(srgb(v) * 255));
  }
  function rgb(name) {
    for (const [re, c] of PLANCOL) if (re.test(name)) return [c >> 16, (c >> 8) & 255, c & 255];
    let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return hslToRgb((h % 360) / 360, 0.3, 0.55);
  }
  return {NOT_DRAWN, nameOf, drawn, rgb};
});
