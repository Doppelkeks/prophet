// Pass 14: stamps the outbound header. Twin: engine/swarm/reference/finalize.js.
#include "swarm-common.wgsl"

@compute @workgroup_size(1)
fn main() {
  O[OH_MAGIC] = bitcast<i32>(OUT_MAGIC);
  O[OH_TICK] = i32(TP.tick);
  O[OH_FLAGS] = i32(TP.flags);
}
