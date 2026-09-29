// The ground plane (z = 0) as a full-screen triangle: a two-tone checker in world space, an edge line at the
// arena bounds and a darker outside. Drawn first; no depth write.
#include "frame.wgsl"

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 1.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  // Pixel (column, row from the top) to world px at z = 0; each pixel samples its lower-left corner.
  let col = floor(p.x);
  let row = floor(p.y);
  let u = col - F.halfW + F.camU;
  let v = (F.ih - F.halfH - 1.0 - row) + F.camV;
  let edge = F.arenaHalf * F.ppm;
  let a = F.groundColors & 0xffu;
  let b = (F.groundColors >> 8u) & 0xffu;
  var c = select(b, a, ((i32(floor(u / F.tilePx)) + i32(floor(v / F.tilePx))) & 1) == 0);
  let ax = abs(u + 0.5);
  let ay = abs(v + 0.5);
  if (ax > edge || ay > edge) {
    c = (F.groundColors >> 24u) & 0xffu;
  } else if (ax > edge - 1.0 || ay > edge - 1.0) {
    c = (F.groundColors >> 16u) & 0xffu;
  }
  return S.palette[c];
}
