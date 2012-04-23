const float cModEpsilon = 1e-20;
const float cTileCurvature = 0.2;
const float cTileBumpDistance = 2.0;

const float cLightAmbient = 0.5;
const vec3 cLight1Dir = vec3(0.8,-0.2,0);
const vec3 cLight2Dir = vec3(-0.8,0.7,0.5);

// What is the illumination from the given (unit vector) direction?
float lightEnv(vec3 dir) {
  return max(0.0, dot(cLight1Dir, dir)) + max(0.0, dot(cLight2Dir, dir));
}

// Componentwise x^7. pow() is unsuitable for negative arguments.
vec3 pow7vec3(vec3 x) {
  vec3 y = x*x*x;
  return y*y*x;
}

// Add amount of any component over 1.0 to all components (makes overbright colors turn to white)
vec3 spill(vec3 v) {
  return v + vec3(max(1.0, max(v.r, max(v.g, v.b))) - 1.0);
}

float lighting() {
  // 'cell' is a vector with components in [-1.0, 1.0] indicating this point's
  // offset from the center of its sub-cube
  vec3 normal;
#if BUMP_MAPPING
    vec3 cell = (mod(vGridPosition * uTileSize + cModEpsilon, 1.0) - vec3(0.5)) * 2.0;
    normal = normalize(vNormal + cTileCurvature / max(1.0, vDistanceFromEye / cTileBumpDistance) * pow7vec3(cell));
#else
    normal = vNormal;
#endif
  return cLightAmbient + lightEnv(normal);
}

float whiteNoise() {
  const float noiseTexelScale = 1.0/512.0; // TODO parameter
  
  // By varying the noise with the grid position, we ensure that noise on
  // multiple transparent surfaces doesn't line up.
  vec2 positionVary = 0.1 * (
      vNormal.x != 0.0 ? vGridPosition.yz
    : vNormal.y != 0.0 ? vGridPosition.xz
    : vNormal.z != 0.0 ? vGridPosition.xy
    : vGridPosition.xz + vGridPosition.yy // fallback
  );
  
  vec2 viewVary = gl_FragCoord.xy;
  
  return texture2D(uNoiseSampler, noiseTexelScale * (viewVary + 0.1 * positionVary)).r;
}

void main(void) {
    if (uStipple && mod(gl_FragCoord.x - gl_FragCoord.y, 2.0) < 1.0)
      discard;
    
    // color/lighting calculation
    // if the vertex normal is zero, then that means "do not use lighting"
#if LIGHTING
    vec4 color = vec4(vec3(vColor) * (vNormal == vec3(0,0,0) ? 1.0 : lighting()),
                      vColor.a);
#else
    vec4 color = vColor;
#endif
    
    if (uTextureEnabled)
      color *= texture2D(uSampler, vTextureCoord);
    
    // Note: This alpha test is needed for textures, but also for the block
    // particles, which have static geometry.
    if (color.a <= whiteNoise() * (254.0/255.0))
      discard;
    
    color = vec4(spill(color.rgb), color.a);

    vec4 fogColor = textureCube(uSkySampler, normalize(vFixedOrientationPosition));
    gl_FragColor = color * (1.0-vFog) + fogColor * vFog;
    
    if (!uFocusCue) {
      float gray = 0.2126*gl_FragColor.r
                  +0.7152*gl_FragColor.g
                  +0.0722*gl_FragColor.b;
      gl_FragColor = 0.5 * gl_FragColor + 0.5 * vec4(vec3(gray), gl_FragColor.a);
    }
}
