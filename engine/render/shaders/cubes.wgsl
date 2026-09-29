// Vertex-pulled boxes (docs/engine/04-pixel-art-pipeline.md#projection): each instance draws its top and its
// camera-facing front as two quads, 12 vertices, snapped to whole internal pixels. SOURCE picks the instance
// data: 0 swarm units (U), 1 shots (P), 2 actors (the game's extract: ACTOR_WORDS per actor, x y z vx vy in
// Q10, then its style). Dead slots and instances outside the view collapse to a point.
#include "frame.wgsl"

override SOURCE: u32 = 0u;

@group(0) @binding(2) var<storage, read> U: array<u32>;
@group(0) @binding(3) var<storage, read> P: array<u32>;
@group(0) @binding(4) var<storage, read> A: array<i32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) color: u32,
  @location(1) @interpolate(flat) band: f32,   // front: px from the bottom that get the shadow band; top: -1
  @location(2) ht: f32,                        // front: px above the bottom edge
}

fn lo16(v: u32) -> f32 { return f32((bitcast<i32>(v) << 16u) >> 16u); }
fn hi16(v: u32) -> f32 { return f32(bitcast<i32>(v) >> 16u); }

fn hidden() -> VOut {
  var o: VOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.color = 0u;
  o.band = -1.0;
  o.ht = 0.0;
  return o;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) n: u32) -> VOut {
  // World position (Q10 m) interpolated to the display: pos - vel * (1 - alpha).
  var x: f32; var y: f32; var z: f32;
  var style: vec4u;
  let back = 1.0 - F.alpha;
  if (SOURCE == 0u) {
    let info = U[F.uInfo + n];
    if ((info & UNIT_ALIVE) == 0u) { return hidden(); }
    let vel = U[F.uVel + n];
    x = f32(bitcast<i32>(U[F.uPosX + n])) - lo16(vel) * back;
    y = f32(bitcast<i32>(U[F.uPosY + n])) - hi16(vel) * back;
    z = 0.0;
    style = S.styles[UNIT_STYLES + min(info & 0xffu, 15u)];
  } else if (SOURCE == 1u) {
    let info = P[F.pInfo + n];
    if ((info & SHOT_ALIVE) == 0u) { return hidden(); }
    let vel = P[F.pVel + n];
    x = f32(bitcast<i32>(P[F.pPosX + n])) - lo16(vel) * back;
    y = f32(bitcast<i32>(P[F.pPosY + n])) - hi16(vel) * back;
    z = 0.0;
    style = S.styles[SHOT_STYLE];
  } else {
    let r = n * ACTOR_WORDS;
    x = f32(A[r]) - f32(A[r + 3u]) * back;
    y = f32(A[r + 1u]) - f32(A[r + 4u]) * back;
    z = f32(A[r + 2u]);
    style = S.styles[ACTOR_STYLES + min(u32(A[r + 5u]), 15u)];
  }
  // To whole pixels on the ground (y) and height (z) axes separately, so depth stays exact.
  let s = F.ppm / 1024.0;
  let xp = round(x * s) - F.camU;
  let yp = round(y * s);
  let zp = round(z * s) + f32((style.w >> 16u) & 0xffu);
  let w = f32(style.x);
  let d = f32(style.y);
  let h = f32(style.z);
  let v0 = yp + zp - F.camV - floor(d * 0.5);   // bottom of the front face
  if (abs(xp) > F.halfW + w + 2.0 || v0 > F.halfH + 2.0 || v0 + h + d < -F.halfH - 2.0) { return hidden(); }

  // Two quads: 0 = front (y = near edge, z from zp to zp + h), 1 = top (z = zp + h, y across the depth).
  let quad = vi / 6u;
  let c = vi % 6u;
  let cx = f32((0x32u >> c) & 1u);  // corners per triangle pair: (0,0) (1,0) (0,1) (0,1) (1,0) (1,1)
  let cy = f32((0x2cu >> c) & 1u);
  let u = xp - floor(w * 0.5) + cx * w;
  var o: VOut;
  let yNear = yp - floor(d * 0.5);
  if (quad == 0u) {
    let zz = zp + cy * h;
    o.pos = toClip(u, v0 + cy * h, yNear - zz - F.camYp);
    o.color = (style.w >> 8u) & 0xffu;
    o.band = floor(h / 3.0);
    o.ht = cy * h;
  } else {
    let yy = yNear + cy * d;
    o.pos = toClip(u, v0 + h + cy * d, yy - (zp + h) - F.camYp);
    o.color = style.w & 0xffu;
    o.band = -1.0;
    o.ht = 0.0;
  }
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let c = S.palette[i.color];
  // Three toon bands: the top, the front, and a shadow band at the bottom of the front.
  if (i.ht < i.band) { return vec4f(c.rgb * 0.72, 1.0); }
  return c;
}
