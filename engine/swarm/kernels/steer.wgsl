// Pass 8: seek toward proxy 0 (along the flow field while one is committed and the goal is far), separation
// from the 3×3 bins, soft push from pushing proxies. Writes only the unit's own velocity. Slowed units steer
// at half speed, stunned ones don't seek, and knockback above the limit decays instead of being clipped.
// Twin: engine/swarm/reference/steer.js.
#include "swarm-common.wgsl"

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= L.unitCap) { return; }
  let info = U[L.uInfo + i];
  if ((info & UNIT_ALIVE) == 0u) { return; }
  let x = bitcast<i32>(U[L.uPosX + i]);
  let y = bitcast<i32>(U[L.uPosY + i]);
  let st0 = U[L.uSt0 + i];
  let stunned = (st0 >> 24u) != 0u;
  var spd = typeWord(info, TY_SPEED);
  if (((st0 >> 16u) & 0xffu) != 0u) { spd = spd >> 1u; }
  let ri = typeWord(info, TY_RADIUS);
  let W = i32(L.gridW);
  let pairCap = i32(L.pairCap);
  let cx = cellX(x);
  let cy = cellY(y);
  var sx = 0;
  var sy = 0;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    let ny = cy + oy;
    if (ny < 0 || ny >= W) { continue; }
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let nx = cx + ox;
      if (nx < 0 || nx >= W) { continue; }
      let c = u32(ny * W + nx);
      let n = A[L.aBinCount + c];
      if (n == 0) { continue; }
      if (n <= pairCap) {
        let start = L.aBinEntries + u32(A[L.aBinStart + c]);
        for (var e = 0u; e < u32(n); e = e + 1u) {
          let j = u32(A[start + e]);
          if (j == i) { continue; }
          let r = ri + typeWord(U[L.uInfo + j], TY_RADIUS);
          let dx = x - bitcast<i32>(U[L.uPosX + j]);
          let dy = y - bitcast<i32>(U[L.uPosY + j]);
          if (dx >= r || dx <= -r || dy >= r || dy <= -r) { continue; }
          if (dx == 0 && dy == 0) {
            sx = sx + select(r, -r, i < j);
          } else {
            sx = sx + rep(dx, r);
            sy = sy + rep(dy, r);
          }
        }
      } else {
        let mx = bitcast<i32>(L.originX) + (nx << L.cellShift) + A[L.aBinSumX + c] / n;
        let my = bitcast<i32>(L.originY) + (ny << L.cellShift) + A[L.aBinSumY + c] / n;
        let r = ri + ri;
        let dx = x - mx;
        let dy = y - my;
        if (dx < r && dx > -r && dy < r && dy > -r) {
          sx = sx + rep(dx, r) * pairCap;
          sy = sy + rep(dy, r) * pairCap;
        }
      }
    }
  }
  let own = A[L.aBinCount + u32(cy * W + cx)];
  if (own > pairCap) {
    var left = own;
    var right = own;
    var down = own;
    var up = own;
    if (cx > 0) { left = A[L.aBinCount + u32(cy * W + cx - 1)]; }
    if (cx < W - 1) { right = A[L.aBinCount + u32(cy * W + cx + 1)]; }
    if (cy > 0) { down = A[L.aBinCount + u32((cy - 1) * W + cx)]; }
    if (cy < W - 1) { up = A[L.aBinCount + u32((cy + 1) * W + cx)]; }
    sx = sx + (left - right) * i32(PRESSURE);
    sy = sy + (down - up) * i32(PRESSURE);
  }
  var seek = vec2<i32>(0, 0);
  var px = 0;
  var py = 0;
  let proxies = TP.inBase + L.inProxies;
  for (var k = 0u; k < TP.proxies; k = k + 1u) {
    let q = proxies + k * PROXY_WORDS;
    let qx = I[q + 1u];
    let qy = I[q + 2u];
    if (k == 0u && !stunned) {
      var word = 0u;
      if (TP.field != FIELD_NONE) { word = bitcast<u32>(G[TP.field * L.cells + u32(cy * W + cx)]); }
      let dist = word >> 16u;
      if (dist != FIELD_NO_PATH && dist > FIELD_DIRECT) {
        let a = word & 0xffffu;
        seek = vec2<i32>(fx_mulShr(spd, fx_cosB(a), 14u), fx_mulShr(spd, fx_sinB(a), 14u));
      } else {
        seek = scaleTo(qx - x, qy - y, spd);
      }
    }
    if (((bitcast<u32>(I[q + 4u]) >> 16u) & PROXY_PUSHES) == 0u) { continue; }
    let r = I[q + 3u] + ri;
    let dx = x - qx;
    let dy = y - qy;
    if (dx >= r || dx <= -r || dy >= r || dy <= -r) { continue; }
    px = px + rep(dx, r);
    py = py + rep(dy, r);
  }
  let v = U[L.uVel + i];
  let lim = spd + spd;
  let ax = approach(lo16(v), seek.x);
  let ay = approach(hi16(v), seek.y);
  let vx = ax + clamp(sx >> SEP_SHIFT, -spd, spd) + clamp(px >> PUSH_SHIFT, -lim, lim);
  let vy = ay + clamp(sy >> SEP_SHIFT, -spd, spd) + clamp(py >> PUSH_SHIFT, -lim, lim);
  let limX = max(lim, abs(ax));
  let limY = max(lim, abs(ay));
  U[L.uVel + i] = packVel(clamp(vx, -limX, limX), clamp(vy, -limY, limY));
}
