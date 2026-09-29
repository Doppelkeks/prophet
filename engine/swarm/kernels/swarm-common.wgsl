// Shared by every swarm kernel: bindings and the integer helpers of engine/swarm/reference/swarm-math.js.
// The Layout struct and the shared constants are generated from engine/swarm/swarm-layout.js and
// prepended by the pipeline builder. A kernel that needs atomics on A or O defines A_ATOMIC or O_ATOMIC
// before including this file.
#include "../../gpu/wgsl/fixed.wgsl"
#include "../../gpu/wgsl/rng.wgsl"

struct TickParams {
  tick: u32,
  inBase: u32,
  prevFires: u32,
  groups: u32,
  fires: u32,
  proxies: u32,
  requests: u32,
  flags: u32,
}

@group(0) @binding(0) var<uniform> L: Layout;
@group(0) @binding(1) var<uniform> TP: TickParams;
@group(0) @binding(2) var<storage, read_write> U: array<u32>;
@group(0) @binding(3) var<storage, read_write> P: array<u32>;
#ifdef A_ATOMIC
@group(0) @binding(4) var<storage, read_write> A: array<atomic<i32>>;
#else
@group(0) @binding(4) var<storage, read_write> A: array<i32>;
#endif
@group(0) @binding(5) var<storage, read> I: array<i32>;
#ifdef O_ATOMIC
@group(0) @binding(6) var<storage, read_write> O: array<atomic<i32>>;
#else
@group(0) @binding(6) var<storage, read_write> O: array<i32>;
#endif
@group(0) @binding(7) var<storage, read> T: array<i32>;

override WG: u32 = 64u;

fn fx_sinTable(i: u32) -> i32 { return T[L.tSin + i]; }

fn lo16(v: u32) -> i32 { return bitcast<i32>(v << 16u) >> 16u; }
fn hi16(v: u32) -> i32 { return bitcast<i32>(v) >> 16u; }
fn packVel(vx: i32, vy: i32) -> u32 { return (bitcast<u32>(vx) & 0xffffu) | (bitcast<u32>(vy) << 16u); }

fn rep(d: i32, r: i32) -> i32 {
  if (d > 0) { return r - d; }
  if (d < 0) { return -r - d; }
  return 0;
}

fn approach(v: i32, goal: i32) -> i32 {
  let d = goal - v;
  if (d < 4 && d > -4) { return goal; }
  return v + (d >> 2u);
}

fn cellX(x: i32) -> i32 { return clamp((x - bitcast<i32>(L.originX)) >> L.cellShift, 0, i32(L.gridW) - 1); }
fn cellY(y: i32) -> i32 { return clamp((y - bitcast<i32>(L.originY)) >> L.cellShift, 0, i32(L.gridW) - 1); }

fn scaleTo(dx: i32, dy: i32, len: i32) -> vec2<i32> {
  var ax = dx;
  var ay = dy;
  loop {
    if (!(ax >= 16384 || ax <= -16384 || ay >= 16384 || ay <= -16384)) { break; }
    ax = ax >> 1u;
    ay = ay >> 1u;
  }
  let m = i32(fx_isqrt(bitcast<u32>(ax * ax + ay * ay)));
  if (m == 0) { return vec2<i32>(0, 0); }
  return vec2<i32>((ax * len) / m, (ay * len) / m);
}

fn typeWord(info: u32, w: u32) -> i32 { return T[L.tTypes + (info & 0xffu) * TYPE_WORDS + w]; }
