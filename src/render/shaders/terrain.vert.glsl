in float material;

out vec3 vWorld;
flat out float vMaterial;

void main() {
  vec4 local = vec4(position, 1.0);

#ifdef USE_INSTANCING
  local = instanceMatrix * local;
#endif

  vec4 world = modelMatrix * local;

  vWorld = world.xyz;
  vMaterial = material;

  gl_Position = projectionMatrix * viewMatrix * world;
}
