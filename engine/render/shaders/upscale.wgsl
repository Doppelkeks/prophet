// Nearest-neighbour upscale of the internal image by the integer factor k, cropping the border and the
// overscan, with the sub-pixel camera remainder as a whole-output-pixel offset
// (docs/engine/04-pixel-art-pipeline.md#camera-snapping).

struct Up {
  crop: vec2f,     // overscan, output px
  offset: vec2f,   // camera remainder, internal px in steps of 1/k
  k: f32,
  border: f32,
  size: vec2f,     // internal size
}

@group(0) @binding(0) var<uniform> P: Up;
@group(0) @binding(1) var src: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let q = (p.xy + P.crop) / P.k + vec2f(P.border) + P.offset;
  let t = clamp(vec2i(floor(q)), vec2i(0), vec2i(P.size) - 1);
  return textureLoad(src, t, 0);
}
