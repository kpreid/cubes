const float cModEpsilon = 1e-20;
const float cTileCurvature = 0.2;
const float cTileBumpDistance = 2.0;

const float cLightAmbient = 0.75;
const vec3 cLight1Dir = vec3(0.4,-0.1,0);
const vec3 cLight2Dir = vec3(-0.4,0.35,0.25);

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
  float scalarLight = length(vNormal);
  // 'cell' is a vector with components in [-1.0, 1.0] indicating this point's
  // offset from the center of its sub-cube
  vec3 normal;
#if BUMP_MAPPING
    vec3 cell = (mod(vGridPosition * uTileSize + cModEpsilon, 1.0) - vec3(0.5)) * 2.0;
    normal = normalize(vNormal/scalarLight + cTileCurvature / max(1.0, vDistanceFromEye / cTileBumpDistance) * pow7vec3(cell));
#else
    normal = vNormal;
#endif
  return scalarLight * (cLightAmbient + lightEnv(normal));
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
  vec4 color = vColor;
  
  // Lighting
  // if the vertex normal is zero, then that means "do not use lighting"
#if LIGHTING
  color.rgb *= (vNormal == vec3(0) ? 1.0 : lighting());
#endif
  
  // Texturing
  if (uTextureEnabled)
    color *= texture2D(uSampler, vTextureCoord);
  
  // Convert alpha channel to stipple
  if (color.a <= whiteNoise() * (254.0/255.0)) {
    discard;
  } else {
    color.a = 1.0;
  }
  
  // Fog/skybox
  vec4 fogColor = textureCube(uSkySampler, normalize(vFixedOrientationPosition));
  color = mix(color, fogColor, vFog);
  
  // Overbright goes to white
  color.rgb = spill(color.rgb);
  
  // Focus desaturation
  if (!uFocusCue) {
    float gray = dot(color, vec4(0.2126, 0.7152, 0.0722, 0));
    color = mix(color, vec4(gray, gray, gray, color.a), 0.5);
  }
  
  gl_FragColor = color;
}
