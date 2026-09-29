// The per-frame uniform and the palette, shared by the scene passes (engine/render/renderer.js writes them
// in this field order). Render code: floats are fine.

struct Frame {
  iw: f32, ih: f32, halfW: f32, halfH: f32,      // internal size; the snapped camera sits at pixel (halfW, halfH)
  camU: f32, camV: f32, camYp: f32, ppm: f32,    // snapped camera on the screen plane (px); camera ground y (px)
  alpha: f32, depthRange: f32, arenaHalf: f32, tilePx: f32,
  uPosX: u32, uPosY: u32, uVel: u32, uInfo: u32, // swarm unit columns (words into U)
  pPosX: u32, pPosY: u32, pVel: u32, pInfo: u32, // shot columns (words into P)
  unitCap: u32, shotCap: u32, actorCount: u32, groundColors: u32, // ground: a | b << 8 | edge << 16 | outside << 24
  kPosX: u32, kPosY: u32, kInfo: u32, pickCap: u32, // pickup columns (words into P)
}

struct Styles {
  palette: array<vec4f, 32>,
  // Box styles: w, d, h in px, then top | front << 8 | z px << 16 (colors are palette indices).
  // UNIT_STYLES + swarm type, ACTOR_STYLES + actor style, SHOT_STYLE, PICKUP_STYLE.
  styles: array<vec4u, STYLE_COUNT>,
}

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> S: Styles;

/** Internal pixel (u, v relative to the snapped camera, v up) plus depth to clip space. */
fn toClip(u: f32, v: f32, depthPx: f32) -> vec4f {
  let x = (u + F.halfW) * 2.0 / F.iw - 1.0;
  let y = (v + F.halfH) * 2.0 / F.ih - 1.0;
  let z = clamp(0.5 + depthPx / F.depthRange, 0.0, 1.0);
  return vec4f(x, y, z, 1.0);
}
