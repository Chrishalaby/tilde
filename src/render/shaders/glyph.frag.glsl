in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uAtlas;
uniform sampler2D uRamp;
uniform vec2 uCells;
uniform vec2 uCellPx;
uniform vec2 uResolution;
uniform vec2 uAtlasCells;
uniform vec3 uPaper;
uniform vec3 uInks[8];
uniform float uTime;
uniform float uGrain;
uniform float uNight;
uniform vec4 uEdgeGlyphs;
uniform float uGlyphCount;
uniform float uStarGlyph;

out vec4 outColor;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec3 inkFor(int m) {
  if (m == 0) return uInks[0];
  if (m == 1) return uInks[1];
  if (m == 2) return uInks[2];
  if (m == 3) return uInks[3];
  if (m == 4) return uInks[4];
  if (m == 5) return uInks[5];
  if (m == 6) return uInks[6];
  return uInks[7];
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 cellSize = max(uCellPx, vec2(1.0));
  vec2 cell = clamp(floor(frag / cellSize), vec2(0.0), max(uCells - 1.0, vec2(0.0)));
  vec2 inCell = clamp((frag - cell * cellSize) / cellSize, 0.015, 0.985);

  vec2 sceneSize = max(uCells, vec2(1.0)) * 2.0;
  vec2 centreUv = (cell + 0.5) * 2.0 / sceneSize;
  vec2 cellStep = 2.0 / sceneSize;

  vec4 centre = texture(uScene, centreUv);
  int material = int(floor(centre.a * 255.0 + 0.5));
  float fog = centre.g;

  float lit[9];
  float depth[9];
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 offset = vec2(float(i) - 1.0, float(j) - 1.0) * cellStep;
      vec4 tap = texture(uScene, centreUv + offset);
      lit[j * 3 + i] = tap.r * (1.0 - tap.g);
      depth[j * 3 + i] = tap.g;
    }
  }

  float gxL = (lit[2] + 2.0 * lit[5] + lit[8]) - (lit[0] + 2.0 * lit[3] + lit[6]);
  float gyL = (lit[6] + 2.0 * lit[7] + lit[8]) - (lit[0] + 2.0 * lit[1] + lit[2]);
  float gxD = (depth[2] + 2.0 * depth[5] + depth[8]) - (depth[0] + 2.0 * depth[3] + depth[6]);
  float gyD = (depth[6] + 2.0 * depth[7] + depth[8]) - (depth[0] + 2.0 * depth[1] + depth[2]);
  float edgeDepth = length(vec2(gxD, gyD));
  float edgeLit = length(vec2(gxL, gyL));
  bool silhouette = edgeDepth > 0.9;
  bool isEdge = material != 5 && material != 7 && (silhouette || edgeLit > 2.6);
  float gx = silhouette ? gxD : gxL;
  float gy = silhouette ? gyD : gyL;

  float clear = 1.0 - fog * 0.7;
  float shade = (0.06 + (1.0 - centre.r) * 0.66) * clear;
  float glow = (0.06 + centre.r * 0.8) * clear;
  float density = mix(shade, glow, uNight);
  float rampStep = clamp(floor(density * 15.0), 0.0, 15.0);

  if (material == 5) {
    rampStep = mod(rampStep + floor(uTime * 0.6 + hash21(cell) * 4.0), 16.0);
  }

  float glyph = texelFetch(uRamp, ivec2(int(rampStep), material), 0).r * 255.0;

  if (material == 6) {
    glyph = floor(centre.b * 255.0 + 0.5);
  }

  bool star = false;

  if (material == 7) {
    if (uNight > 0.5 && hash21(cell + 11.7) < 0.02 * uNight) {
      glyph = uStarGlyph;
      star = true;
    }
  } else if (isEdge) {
    float ax = abs(gx);
    float ay = abs(gy);
    if (ax > ay * 2.4) {
      glyph = uEdgeGlyphs.x;
    } else if (ay > ax * 2.4) {
      glyph = uEdgeGlyphs.y;
    } else if (gx * gy < 0.0) {
      glyph = uEdgeGlyphs.z;
    } else {
      glyph = uEdgeGlyphs.w;
    }
  }

  float glyphIndex = clamp(floor(glyph + 0.5), 0.0, max(uGlyphCount - 1.0, 0.0));
  vec2 atlasCell = vec2(mod(glyphIndex, uAtlasCells.x), floor(glyphIndex / uAtlasCells.x));
  vec2 atlasUv = (atlasCell + vec2(inCell.x, 1.0 - inCell.y)) / uAtlasCells;
  float coverage = texture(uAtlas, atlasUv).r;

  vec3 ink = star ? uInks[6] : inkFor(material);
  float weight = star ? coverage * (0.35 + 0.65 * uNight) : coverage * (1.0 - fog * 0.85);
  vec3 col = mix(uPaper, ink, clamp(weight, 0.0, 1.0));

  col += (hash21(frag + uTime) - 0.5) * uGrain;

  vec2 screenUv = uResolution.x > 0.0 ? frag / uResolution : vUv;
  float vignette = 1.0 - 0.18 * smoothstep(0.5, 1.2, length(screenUv - 0.5) * 1.6);
  col = mix(uPaper, col, vignette);

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
