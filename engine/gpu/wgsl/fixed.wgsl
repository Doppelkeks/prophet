// Integer fixed-point helpers: the WGSL twin of engine/core/fixed.js. Must stay bit-identical;
// tests/browser/golden.spec.js compares both on the GPU.
// The including shader must define:  fn fx_sinTable(i: u32) -> i32   (the 4096-entry Q14 sine table)

fn fx_sinB(a: u32) -> i32 { return fx_sinTable((a >> 4u) & 4095u); }
fn fx_cosB(a: u32) -> i32 { return fx_sinTable(((a + 16384u) >> 4u) & 4095u); }

// Exact floor((a * b) / 2^s) for 0 <= s <= 31, wrapped to i32 (64-bit product from 16-bit limbs).
fn fx_mulShr(a: i32, b: i32, s: u32) -> i32 {
  let au = bitcast<u32>(a);
  let bu = bitcast<u32>(b);
  let a0 = au & 0xffffu; let a1 = au >> 16u;
  let b0 = bu & 0xffffu; let b1 = bu >> 16u;
  let p00 = a0 * b0; let p01 = a0 * b1; let p10 = a1 * b0; let p11 = a1 * b1;
  let mid = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  let lo = (p00 & 0xffffu) | (mid << 16u);
  var hi = p11 + (p01 >> 16u) + (p10 >> 16u) + (mid >> 16u);
  if (a < 0) { hi = hi - bu; }
  if (b < 0) { hi = hi - au; }
  if (s == 0u) { return bitcast<i32>(lo); }
  return bitcast<i32>((lo >> s) | (hi << (32u - s)));
}

// High 32 bits of the unsigned 64-bit product.
fn fx_mulHiU32(a: u32, b: u32) -> u32 {
  let a0 = a & 0xffffu; let a1 = a >> 16u;
  let b0 = b & 0xffffu; let b1 = b >> 16u;
  let p00 = a0 * b0; let p01 = a0 * b1; let p10 = a1 * b0; let p11 = a1 * b1;
  let mid = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  return p11 + (p01 >> 16u) + (p10 >> 16u) + (mid >> 16u);
}

// floor(sqrt(n)), digit by digit, always 16 iterations.
fn fx_isqrt(n: u32) -> u32 {
  var x = n;
  var r = 0u;
  var bit = 0x40000000u;
  for (var i = 0u; i < 16u; i = i + 1u) {
    let t = r + bit;
    if (x >= t) { x = x - t; r = (r >> 1u) + bit; } else { r = r >> 1u; }
    bit = bit >> 2u;
  }
  return r;
}

// WGSL's native integer division already has the semantics Fixed.idiv/imod/udiv/umod replicate in JS.
fn fx_idiv(a: i32, b: i32) -> i32 { return a / b; }
fn fx_imod(a: i32, b: i32) -> i32 { return a % b; }
fn fx_udiv(a: u32, b: u32) -> u32 { return a / b; }
fn fx_umod(a: u32, b: u32) -> u32 { return a % b; }
fn fx_iabs(a: i32) -> i32 { return abs(a); }
