// Golden-vector harness: runs the WGSL twins on test inputs (4 u32 words per item).
#include "/engine/gpu/wgsl/fixed.wgsl"
#include "/engine/gpu/wgsl/rng.wgsl"
#include "/engine/gpu/wgsl/hash.wgsl"

struct Params { op: u32, count: u32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> IN: array<u32>;
@group(0) @binding(2) var<storage, read_write> OUT: array<u32>;
@group(0) @binding(3) var<storage, read> SIN: array<i32>;

fn fx_sinTable(i: u32) -> i32 { return SIN[i]; }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let a = IN[i * 4u];
  let b = IN[i * 4u + 1u];
  let c = IN[i * 4u + 2u];
  let d = IN[i * 4u + 3u];
  var r = 0u;
  switch P.op {
    case 0u: { r = bitcast<u32>(fx_sinB(a)); }
    case 1u: { r = bitcast<u32>(fx_cosB(a)); }
    case 2u: { r = bitcast<u32>(fx_mulShr(bitcast<i32>(a), bitcast<i32>(b), c)); }
    case 3u: { r = fx_isqrt(a); }
    case 4u: { r = bitcast<u32>(fx_idiv(bitcast<i32>(a), bitcast<i32>(b))); }
    case 5u: { r = bitcast<u32>(fx_imod(bitcast<i32>(a), bitcast<i32>(b))); }
    case 6u: { r = fx_udiv(a, b); }
    case 7u: { r = fx_umod(a, b); }
    case 8u: { r = bitcast<u32>(fx_iabs(bitcast<i32>(a))); }
    case 9u: { r = fx_mulHiU32(a, b); }
    case 10u: { r = rng_mix32(a); }
    case 11u: { r = rng_u32(rng_key(a, b), c, d); }
    case 12u: { r = rng_below(a, b); }
    case 13u: { r = hash_end(hash_step(hash_step(hash_step(a, b), c), d), 3u); }
    default: { r = 0xdeadbeefu; }
  }
  OUT[i] = r;
}
