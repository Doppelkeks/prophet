// 32-bit state hash: the WGSL twin of engine/core/hash32.js.

fn hash_step(h0: u32, w: u32) -> u32 {
  var k = w * 0xcc9e2d51u;
  k = (k << 15u) | (k >> 17u);
  k = k * 0x1b873593u;
  var h = h0 ^ k;
  h = (h << 13u) | (h >> 19u);
  return h * 5u + 0xe6546b64u;
}

fn hash_end(h0: u32, words: u32) -> u32 {
  var h = h0 ^ (words * 4u);
  h = h ^ (h >> 16u);
  h = h * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = h * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
