in float material;
in vec2 roadMain;
in vec2 roadPath;
in vec2 roadSpur;

out vec3 vWorld;
flat out float vMaterial;
out vec2 vRoadMain;
out vec2 vRoadPath;
out vec2 vRoadSpur;

void main() {
  vec4 local = vec4(position, 1.0);

#ifdef USE_INSTANCING
  local = instanceMatrix * local;
#endif

  vec4 world = modelMatrix * local;

  vWorld = world.xyz;
  vMaterial = material;

#ifdef USE_INSTANCING
  vRoadMain = vec2(0.0);
  vRoadPath = vec2(0.0);
  vRoadSpur = vec2(0.0);
#else
  vRoadMain = roadMain;
  vRoadPath = roadPath;
  vRoadSpur = roadSpur;
#endif

  gl_Position = projectionMatrix * viewMatrix * world;
}
