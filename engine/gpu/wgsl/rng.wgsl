// Stateless hash RNG: the WGSL twin of engine/core/rng.js. Requires fixed.wgsl (fx_mulHiU32).

fn rng_mix32(x0: u32) -> u32 {
  var x = (x0 ^ (x0 >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}

fn rng_key(seed: u32, stream: u32) -> u32 { return rng_mix32(seed ^ ((stream + 1u) * 0x9e3779b9u)); }
fn rng_u32(key: u32, tick: u32, id: u32) -> u32 { return rng_mix32(rng_mix32(key ^ tick) ^ id); }
fn rng_below(h: u32, n: u32) -> u32 { return fx_mulHiU32(h, n); }
fn rng_chance(h: u32, pQ16: u32) -> bool { return (h >> 16u) < pQ16; }
