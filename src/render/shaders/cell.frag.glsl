uniform sampler2D uScene;
uniform sampler2D uRamp;
uniform sampler2D uPalette;
uniform vec2 uCells;
uniform float uTime;
uniform float uNight;
uniform mat3 uCamBasis;
uniform vec3 uCamPos;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uSunPos;
uniform vec3 uMoonPos;
uniform vec3 uLightDir;
uniform float uTwilight;
uniform vec3 uZenith;
uniform vec3 uBand;
uniform vec3 uHorizon;
uniform vec3 uHorizonSun;
uniform vec3 uFogNear;
uniform vec3 uSeaFar;
uniform vec3 uSunTint;
uniform vec3 uMoonTint;
uniform vec3 uMoonGlowTint;
uniform vec3 uStar;
uniform vec3 uStars[64];
uniform vec3 uCloudBright;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloudCover;
uniform float uCloudY;
uniform float uCloudScale;
uniform vec2 uWind;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec4 uEdgeGlyphs;
uniform vec4 uCloudGlyphs;
uniform float uStarGlyph;
uniform float uFoamGlyph;
uniform float uGlyphStrength;

out vec4 outColor;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 q) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 q, float detail) {
  float n = 0.5 * vnoise(q) + 0.25 * vnoise(q * 2.03 + vec2(17.1, 31.7));
  n += detail * (0.125 * vnoise(q * 4.12 + vec2(34.2, 63.4)) + 0.0625 * vnoise(q * 8.36 + vec2(51.3, 95.1)));
  return n / (0.75 + 0.1875 * detail);
}

vec2 azim(vec3 v) {
  return v.xz / max(length(v.xz), 1e-4);
}

vec3 screen(vec3 c, vec3 g) {
  return c + g * (1.0 - c);
}

vec3 horizonAt(vec3 d) {
  float toward = max(dot(azim(d), azim(uSunPos)), 0.0);
  return mix(uHorizon, uHorizonSun, uTwilight * toward * toward);
}

vec3 skyGradient(vec3 d) {
  float e = d.y;
  if (e >= 0.15) return mix(uBand, uZenith, pow((e - 0.15) / 0.85, 0.6));
  if (e >= 0.0) return mix(horizonAt(d), uBand, pow(e / 0.15, 0.7));
  return mix(horizonAt(d), uSeaFar, smoothstep(0.0, 0.12, -e));
}

float sunVis() {
  return smoothstep(-0.08, 0.05, uSunPos.y);
}

float moonVis() {
  return uNight * smoothstep(-0.05, 0.05, uMoonPos.y);
}

vec3 sunGlow(vec3 d) {
  float sd = max(dot(d, uSunPos), 0.0);
  float disc = 0.45 * uTwilight * smoothstep(0.9990, 0.9997, sd);
  return uSunTint * sunVis() * (0.16 * pow(sd, 8.0) + 0.30 * pow(sd, 48.0) + disc);
}

vec3 moonGlow(vec3 d) {
  float md = max(dot(d, uMoonPos), 0.0);
  return moonVis() * (uMoonGlowTint * 0.22 * pow(md, 40.0) + uMoonTint * 0.70 * smoothstep(0.9990, 0.9997, md));
}

vec3 skyColour(vec3 d) {
  return screen(screen(skyGradient(d), sunGlow(d)), moonGlow(d));
}

vec3 palette(int m, int k) {
  return texelFetch(uPalette, ivec2(k, m), 0).rgb;
}

vec4 sceneAt(ivec2 p) {
  ivec2 hi = ivec2(uCells + 0.5) * 2 - 1;
  return texelFetch(uScene, clamp(p, ivec2(0), hi), 0);
}

int materialOf(vec4 t) {
  return int(floor(t.a * 255.0 + 0.5));
}

float fogOf(vec4 t, int m) {
  return m == 7 ? 1.0 : t.g;
}

vec3 rayFor(vec2 cell) {
  vec2 ndc = ((cell + 0.5) / uCells) * 2.0 - 1.0;
  vec3 dirCam = vec3(ndc.x * uTanHalf * uAspect, ndc.y * uTanHalf, -1.0);
  return normalize(uCamBasis * dirCam);
}

float rampGlyph(int m, int at) {
  return texelFetch(uRamp, ivec2(at, m), 0).r * 255.0;
}

float edgeGlyph(float gx, float gy) {
  float ax = abs(gx);
  float ay = abs(gy);
  if (ax > ay * 2.4) return uEdgeGlyphs.x;
  if (ay > ax * 2.4) return uEdgeGlyphs.y;
  if (gx * gy < 0.0) return uEdgeGlyphs.z;
  return uEdgeGlyphs.w;
}

float cloudGlyph(int i) {
  if (i <= 0) return uCloudGlyphs.x;
  if (i == 1) return uCloudGlyphs.y;
  if (i == 2) return uCloudGlyphs.z;
  return uCloudGlyphs.w;
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float densityFor(float s, float fog, float lighter) {
  float shadeD = 0.12 + 0.88 * (1.0 - s);
  float litD = 0.12 + 0.88 * s;
  return clamp(mix(shadeD, litD, lighter) * (1.0 - fog * 0.75), 0.0, 0.999);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 cell = ivec2(px.x / 2, px.y);
  int side = px.x - cell.x * 2;
  vec2 cellF = vec2(cell);
  vec3 dir = rayFor(cellF);

  ivec2 base = cell * 2;
  vec4 t00 = sceneAt(base);
  vec4 t10 = sceneAt(base + ivec2(1, 0));
  vec4 t01 = sceneAt(base + ivec2(0, 1));
  vec4 t11 = sceneAt(base + ivec2(1, 1));
  int m00 = materialOf(t00);
  int m10 = materialOf(t10);
  int m01 = materialOf(t01);
  int m11 = materialOf(t11);
  float f00 = fogOf(t00, m00);
  float f10 = fogOf(t10, m10);
  float f01 = fogOf(t01, m01);
  float f11 = fogOf(t11, m11);

  vec4 win = t00;
  int m = m00;
  float fmin = f00;
  if (f10 < fmin) { win = t10; m = m10; fmin = f10; }
  if (f01 < fmin) { win = t01; m = m01; fmin = f01; }
  if (f11 < fmin) { win = t11; m = m11; fmin = f11; }

  float keySum = 0.0;
  float fogSum = 0.0;
  float count = 0.0;
  if (m00 == m) { keySum += t00.r; fogSum += f00; count += 1.0; }
  if (m10 == m) { keySum += t10.r; fogSum += f10; count += 1.0; }
  if (m01 == m) { keySum += t01.r; fogSum += f01; count += 1.0; }
  if (m11 == m) { keySum += t11.r; fogSum += f11; count += 1.0; }
  float key = keySum / max(count, 1.0);
  float fog = fogSum / max(count, 1.0);
  float B = win.b;

  float lit[9];
  float depth[9];
  int mats[9];
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      ivec2 n = cell + ivec2(i - 1, j - 1);
      vec4 tap = sceneAt(n * 2 + 1);
      int tm = materialOf(tap);
      float tf = fogOf(tap, tm);
      lit[j * 3 + i] = tm == 7 ? 0.0 : tap.r * (1.0 - tf);
      depth[j * 3 + i] = tf;
      mats[j * 3 + i] = tm;
    }
  }

  float gxL = (lit[2] + 2.0 * lit[5] + lit[8]) - (lit[0] + 2.0 * lit[3] + lit[6]);
  float gyL = (lit[6] + 2.0 * lit[7] + lit[8]) - (lit[0] + 2.0 * lit[1] + lit[2]);
  float gxD = (depth[2] + 2.0 * depth[5] + depth[8]) - (depth[0] + 2.0 * depth[3] + depth[6]);
  float gyD = (depth[6] + 2.0 * depth[7] + depth[8]) - (depth[0] + 2.0 * depth[1] + depth[2]);
  bool silhouette = length(vec2(gxD, gyD)) > 0.9;
  bool litEdge = length(vec2(gxL, gyL)) > 3.0;
  bool edgeMaterial = m == 0 || m == 1 || m == 2 || m == 3 || m == 4 || m == 9 || m == 12;
  bool isEdge = (edgeMaterial && (silhouette || litEdge)) || (m == 8 && silhouette);
  float gx = silhouette ? gxD : gxL;
  float gy = silhouette ? gyD : gyL;

  vec3 bg = vec3(0.0);
  vec3 gl = vec3(0.0);
  float glyph = uCloudGlyphs.x;
  float weight = 0.0;
  bool fogged = true;
  float cellHash = hash21(cellF);

  if (m == 7) {
    fogged = false;
    vec3 col = skyColour(dir);
    bg = col;
    gl = col;
    float cover = 0.0;

    if (dir.y > 0.0) {
      float t = uCloudY / (dir.y + 0.12);
      vec2 drift = uWind * mod(uTime, 20000.0);
      vec2 uv = (uCamPos.xz + dir.xz * t) / uCloudScale + drift;
      float detail = clamp(1.5 - t / 3000.0, 0.0, 1.0);
      float d = fbm(uv, detail);

      vec3 dirUp = rayFor(cellF + vec2(0.0, 1.0));
      float tUp = uCloudY / (max(dirUp.y, 0.0) + 0.12);
      vec2 uvUp = (uCamPos.xz + dirUp.xz * tUp) / uCloudScale + drift;
      vec2 du = uvUp - uv;
      float dU = fbm(uv + du / max(length(du), 1e-5) * 0.05, detail);
      float dS = fbm(uv + azim(uLightDir) * 0.05 * (1.0 - clamp(uLightDir.y, 0.0, 1.0)), detail);

      float haze = 1.0 - exp(-t / 12000.0);
      cover = smoothstep(uCloudCover, uCloudCover + 0.14, d) * smoothstep(0.0, 0.06, dir.y);
      float coverQ = floor(cover * 3.0 + 0.66) / 3.0;

      float topness = clamp(0.5 + (d - dU) * 7.0, 0.0, 1.0);
      float sunness = clamp(0.5 + (d - dS) * 7.0, 0.0, 1.0);
      float litness = clamp(0.62 + (0.55 * (topness - 0.5) + 0.45 * (sunness - 0.5)) * 1.4, 0.0, 1.0);
      vec3 cloudCol = litness < 0.5
        ? mix(uCloudShade, uCloudLit, litness * 2.0)
        : mix(uCloudLit, uCloudBright, (litness - 0.5) * 2.0);
      float body = smoothstep(uCloudCover + 0.08, uCloudCover + 0.34, d);
      cloudCol = mix(cloudCol, uCloudShade, body * (1.0 - topness) * 0.5);
      float sd = max(dot(dir, uSunPos), 0.0);
      cloudCol = screen(cloudCol, uSunTint * sunVis() * 0.4 * pow(sd, 6.0));
      cloudCol = mix(cloudCol, horizonAt(dir), haze * 0.6);

      bg = mix(col, cloudCol, coverQ);
      gl = mix(bg, uCloudShade, 0.45);
      glyph = cloudGlyph(int(clamp(cover, 0.0, 0.999) * 4.0));
      weight = cover * 0.5;
    }

    if (uNight > 0.02 && dir.y > 0.02) {
      for (int i = 0; i < 64; i++) {
        vec3 sv = uStars[i] * uCamBasis;
        if (sv.z >= 0.0) continue;
        vec2 ndc = vec2(-sv.x / sv.z / (uTanHalf * uAspect), -sv.y / sv.z / uTanHalf);
        if (abs(ndc.x) >= 1.0 || abs(ndc.y) >= 1.0) continue;
        if (all(equal(ivec2(floor((ndc * 0.5 + 0.5) * uCells)), cell))) {
          glyph = uStarGlyph;
          gl = uStar;
          float twinkle = 0.65 + 0.35 * sin(uTime * 1.1 + float(i) * 2.4);
          weight = uNight * uNight * twinkle * (1.0 - cover);
          break;
        }
      }
    }
  } else if (m == 5) {
    vec3 r = normalize(vec3(dir.x, max(-dir.y, 0.02), dir.z));
    vec3 sunPath = uSunTint * sunVis() * 0.35 * pow(max(dot(r, uSunPos), 0.0), 48.0);
    vec3 moonPath = uMoonTint * moonVis() * 0.25 * pow(max(dot(r, uMoonPos), 0.0), 60.0);
    vec3 skyRefl = mix(screen(screen(skyGradient(r), sunPath), moonPath), uSeaFar, 0.2);
    float fresnel = 0.15 + 0.55 * pow(1.0 - clamp(-dir.y, 0.0, 1.0), 2.0);
    float s = clamp((key - 0.35) / 0.30, 0.0, 1.0);
    vec3 baseCol = mix(palette(5, 1), palette(5, 0), s);
    vec3 water = mix(baseCol, skyRefl, fresnel);

    int land = 0;
    for (int k = 0; k < 9; k++) {
      if (mats[k] != 5 && mats[k] != 7) land++;
    }
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        if (abs(i) <= 1 && abs(j) <= 1) continue;
        int tm = materialOf(sceneAt((cell + ivec2(i, j)) * 2 + 1));
        if (tm != 5 && tm != 7) land++;
      }
    }
    float shore = clamp(float(land) / 6.0, 0.0, 1.0);
    water = mix(water, uShallow, shore * 0.7);

    bg = water;
    gl = mix(palette(5, 3), palette(5, 2), s);
    float lighter = step(luma(bg), luma(gl));
    int rs = (int(densityFor(s, fog, lighter) * 16.0) + int(uTime * 0.6 + cellHash * 4.0)) % 16;
    glyph = rampGlyph(5, rs);
    if (shore > 0.3) {
      glyph = uFoamGlyph;
      gl = uFoam;
      weight = shore * (0.35 + 0.35 * sin(uTime * 0.8 + cellHash * 6.2832));
    } else {
      weight = pow(1.0 - fog, 1.5) * uGlyphStrength;
    }
  } else if (m == 10) {
    bg = palette(10, 0);
    gl = palette(10, 2);
    float lighter = step(luma(bg), luma(gl));
    int rs = (int(densityFor(1.0, fog, lighter) * 16.0) + int(uTime * 0.6 + cellHash * 4.0)) % 16;
    glyph = rampGlyph(10, rs);
    weight = uGlyphStrength;
  } else if (m == 6 || m == 11) {
    float s = key;
    bg = mix(palette(m, 1), palette(m, 0), s);
    gl = mix(palette(m, 3), palette(m, 2), s);
    glyph = floor(B * 255.0 + 0.5);
    weight = pow(1.0 - fog, 1.5) * uGlyphStrength;
  } else {
    float s = key;
    float alt = B * 200.0;
    vec3 c0 = palette(m, 0);
    vec3 c1 = palette(m, 1);
    vec3 c2 = palette(m, 2);
    vec3 c3 = palette(m, 3);
    if (m == 0 || m == 1 || m == 12) {
      float k = 0.5 * smoothstep(60.0, 90.0, alt);
      c0 = mix(c0, palette(2, 0), k);
      c1 = mix(c1, palette(2, 1), k);
      c2 = mix(c2, palette(2, 2), k);
      c3 = mix(c3, palette(2, 3), k);
    } else if (m == 2) {
      float k = 0.6 * smoothstep(105.0, 125.0, alt);
      c0 = mix(c0, palette(4, 0), k);
      c1 = mix(c1, palette(4, 1), k);
      c2 = mix(c2, palette(4, 2), k);
      c3 = mix(c3, palette(4, 3), k);
    }
    bg = mix(c1, c0, s);
    gl = mix(c3, c2, s);
    float lighter = step(luma(bg), luma(gl));
    int rs = int(densityFor(s, fog, lighter) * 16.0);
    glyph = rampGlyph(m, rs);
    if (isEdge) {
      glyph = edgeGlyph(gx, gy);
      gl = c3;
    }
    weight = pow(1.0 - fog, 1.5) * uGlyphStrength;
  }

  if (fogged) {
    vec3 fogFar = m == 5 ? mix(skyGradient(dir), uSeaFar, 0.5) : skyGradient(dir);
    vec3 fogCol = mix(uFogNear, fogFar, fog);
    float fogAmount = clamp(fog * 1.08, 0.0, 1.0);
    bg = mix(bg, fogCol, fogAmount);
    gl = mix(gl, fogCol, fogAmount);
  }

  if (side == 0) {
    outColor = vec4(bg, clamp(glyph, 0.0, 255.0) / 255.0);
  } else {
    outColor = vec4(gl, clamp(weight, 0.0, 1.0));
  }
}
