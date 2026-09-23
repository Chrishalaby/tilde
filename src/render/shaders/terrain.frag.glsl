in vec3 vWorld;
flat in float vMaterial;

uniform vec3 uSunDir;
uniform float uSunStrength;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uIsWater;
uniform float uLetterIndex;

out vec4 gBuffer;

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

void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float material = floor(vMaterial + 0.5);

  float lambert = max(0.0, dot(n, normalize(uSunDir)));
  float hemi = 0.12 * (0.5 + 0.5 * n.y);

  float scrub = 1.0;
  if (material < 1.5) {
    float p = 0.6 * vnoise(vWorld.xz / 9.0) + 0.4 * vnoise(vWorld.xz / 27.0);
    scrub = 1.0 - 0.35 * smoothstep(0.55, 0.80, p);
  }

  float light = clamp((lambert * uSunStrength + hemi) * scrub, 0.0, 1.0);

  if (uIsWater > 0.5) {
    float ripple = 0.5 * sin(vWorld.x * 0.21 + uTime * 0.8) + 0.5 * sin(vWorld.z * 0.17 - uTime * 0.55);
    light = 0.5 + 0.15 * ripple;
  }

  float span = max(uFogFar - uFogNear, 1.0);
  float dist = distance(cameraPosition, vWorld);
  float fog = clamp(1.0 - exp(-max(dist - uFogNear, 0.0) / span * 2.2), 0.0, 1.0);

  float b = clamp(vWorld.y / 200.0, 0.0, 1.0);
  bool glyphMaterial = (material > 5.5 && material < 6.5) || (material > 10.5 && material < 11.5);
  if (glyphMaterial && uLetterIndex >= 0.0) {
    b = clamp(uLetterIndex, 0.0, 255.0) / 255.0;
  }

  gBuffer = vec4(light, fog, b, material / 255.0);
}
