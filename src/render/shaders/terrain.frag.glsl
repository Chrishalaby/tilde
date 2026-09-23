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

void main() {
  vec3 faceNormal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float lambert = max(0.0, dot(faceNormal, normalize(uSunDir)));
  float light = clamp(0.15 + 0.85 * lambert * uSunStrength, 0.0, 1.0);

  if (uIsWater > 0.5) {
    float ripple = 0.5 * sin(vWorld.x * 0.21 + uTime * 0.8) + 0.5 * sin(vWorld.z * 0.17 - uTime * 0.55);
    light = clamp(0.55 + ripple * 0.08, 0.0, 1.0);
  }

  float span = max(uFogFar - uFogNear, 1.0);
  float dist = distance(cameraPosition, vWorld);
  float fog = clamp(1.0 - exp(-max(dist - uFogNear, 0.0) / span * 2.2), 0.0, 1.0);

  float material = floor(vMaterial + 0.5);

  float letter = 0.0;
  if (material > 5.5 && material < 6.5 && uLetterIndex >= 0.0) {
    letter = clamp(uLetterIndex, 0.0, 255.0) / 255.0;
  }

  gBuffer = vec4(light, fog, letter, material / 255.0);
}
