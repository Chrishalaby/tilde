in vec2 vUv;

uniform sampler2D uPaint;
uniform sampler2D uAtlas;
uniform vec2 uCells;
uniform vec2 uCellPx;
uniform vec2 uResolution;
uniform vec2 uAtlasCells;
uniform vec2 uGlyphPx;
uniform float uAtlasLod;
uniform float uGlyphCount;
uniform float uTime;
uniform float uGrain;

out vec4 outColor;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 cellSize = max(uCellPx, vec2(1.0));
  vec2 cell = clamp(floor(frag / cellSize), vec2(0.0), max(uCells - 1.0, vec2(0.0)));
  vec2 inset = min(0.5 * exp2(uAtlasLod) / max(uGlyphPx, vec2(1.0)), vec2(0.45));
  vec2 inCell = clamp((frag - cell * cellSize) / cellSize, inset, 1.0 - inset);

  ivec2 c = ivec2(cell);
  vec4 p0 = texelFetch(uPaint, ivec2(c.x * 2, c.y), 0);
  vec4 p1 = texelFetch(uPaint, ivec2(c.x * 2 + 1, c.y), 0);

  float glyphIndex = clamp(floor(p0.a * 255.0 + 0.5), 0.0, max(uGlyphCount - 1.0, 0.0));
  vec2 atlasCell = vec2(mod(glyphIndex, uAtlasCells.x), floor(glyphIndex / uAtlasCells.x));
  vec2 atlasUv = (atlasCell + vec2(inCell.x, 1.0 - inCell.y)) / uAtlasCells;
  float coverage = textureLod(uAtlas, atlasUv, uAtlasLod).r;

  vec3 col = mix(p0.rgb, p1.rgb, clamp(coverage * p1.a, 0.0, 1.0));

  col += (hash21(frag + mod(uTime, 64.0)) - 0.5) * uGrain;

  vec2 screenUv = uResolution.x > 0.0 ? frag / uResolution : vUv;
  col *= 1.0 - 0.10 * smoothstep(0.5, 1.2, length(screenUv - 0.5) * 1.6);
  col = col * 0.97 + 0.015;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
