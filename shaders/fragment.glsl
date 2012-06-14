const float cModEpsilon = 1e-20;
const float cTileCurvature = 0.2;
const float cTileBumpDistance = 2.0;

const float cLightAmbient = 0.875;
const float cLightDirectional = 0.5;
const vec3 cLight1Dir = vec3(0.4,-0.1,0);
const vec3 cLight2Dir = vec3(-0.4,0.35,0.25);

const vec4 luminanceCoeff = vec4(0.2126, 0.7152, 0.0722, 0);

// Simple directional lighting used to give corners definition.
float lightEnv(vec3 dir) {
  return cLightAmbient + cLightDirectional * (max(0.0, dot(cLight1Dir, dir)) +
                                              max(0.0, dot(cLight2Dir, dir)));
}

// Componentwise x^7. pow() is unsuitable for negative arguments.
vec3 pow7vec3(vec3 x) {
  vec3 y = x*x*x;
  return y*y*x;
}

// Make over-1.0-in-some-component colors go to white
vec3 spill(vec3 v) {
  vec3 overv = luminanceCoeff.rgb * (v - vec3(1.0));
  float over = 1.4 * max(overv.r, max(overv.g, overv.b));
  return mix(clamp(v, 0.0, 1.0), vec3(1.0), clamp(over, 0.0, 1.0));
}

vec4 sliceTexture3D(sampler2D sampler, vec3 coord) {
  ivec3 gridCell = ivec3(floor(mod(coord, vec3(float(LIGHT_TEXTURE_SIZE)))));
  ivec2 textureIndex = ivec2(
    gridCell.z,
    gridCell.x * LIGHT_TEXTURE_SIZE + gridCell.y
  );
  vec2 textureCoord = (vec2(textureIndex) + vec2(0.5)) / vec2(float(LIGHT_TEXTURE_SIZE), float(LIGHT_TEXTURE_SIZE*LIGHT_TEXTURE_SIZE));
  
  return texture2D(uLightSampler, textureCoord);
}

bool validSample(vec4 sample) {
  // TODO distinguish "invalid" (inside block) from "zero light" by using more than a luminance texture
  return sample.r != 0.0;
}
vec4 lightSample(vec3 coord) {
  vec4 v = sliceTexture3D(uLightSampler, coord);
  // We stuff amount-of-valid-samples in the alpha channel, and then divide by that at the end (in interpolateLight).
  v.a = validSample(v) ? 1.0 : 0.0;
  return v;
}
const float lin_lo = -0.5;
const float lin_hi = +0.5;
vec4 interpolateLight(vec3 coord, vec3 dirA, vec3 dirB, vec3 bump) {
  // Find interpolation coefficients
  float mixA = mod(dot(coord, dirA) - 0.5, 1.0);
  float mixB = mod(dot(coord, dirB) - 0.5, 1.0);
  
  // Ensure that mix <= 0.5, i.e. the 'near' side below is the side we are on
  if (mixA > 0.5) {
    dirA *= -1.0;
    mixA = 1.0 - mixA;
  }
  if (mixB > 0.5) {
    dirB *= -1.0;
    mixB = 1.0 - mixB;
  }
  
  // Apply bump direction
  mixA += dot(bump, dirA);
  mixB += dot(bump, dirB);
  
  // Retrieve texture samples
  vec4 nearAB    = lightSample(coord + lin_lo * dirA + lin_lo * dirB);
  vec4 nearAfarB = lightSample(coord + lin_lo * dirA + lin_hi * dirB);
  vec4 nearBfarA = lightSample(coord + lin_hi * dirA + lin_lo * dirB);
  vec4 farAB     = lightSample(coord + lin_hi * dirA + lin_hi * dirB);
  
  // Perform bilinear interpolation
  if (!validSample(nearAfarB) && !validSample(nearBfarA)) {
    // The far corner is on the other side of a diagonal wall, so should be
    // omitted; there is only one sample to use.
    return nearAB;
  } else {
    vec4 v = mix(mix(nearAB,    nearAfarB, mixB),
                 mix(nearBfarA, farAB,     mixB),
                 mixA);
    // Scale result by number of good samples
    return v.a == 0.0 ? vec4(0.0) : v / v.a;
  }
}

float lighting() {
#if BUMP_MAPPING
  // 'cell' is a vector with components in [-1.0, 1.0] indicating this point's
  // offset from the center of its sub-cube
  vec3 cell = (mod(vGridPosition * uTileSize + cModEpsilon, 1.0) - vec3(0.5)) * 2.0;
  vec3 bump = cTileCurvature / max(1.0, vDistanceFromEye / cTileBumpDistance) * pow7vec3(cell);
#else
  vec3 bump = vec3(0.0);
#endif
  
  // TODO: Try performing the light lookups in the vertex shader (if supported).
  
  vec3 textureLookupPoint = vGridPosition + 0.1*vNormal;
#if SMOOTH_LIGHTING
  vec3 perp1, perp2;
  if (vNormal.x != 0.0) {
    perp1 = vec3(0.0, 1.0, 0.0);
    perp2 = vec3(0.0, 0.0, 1.0);
  } else {
    perp1 = vec3(1.0, 0.0, 0.0);
    perp2 = normalize(abs(cross(perp1, vNormal)));
  }
  vec4 textureValue = interpolateLight(textureLookupPoint, perp1, perp2, 0.3 * bump);
#else
  vec4 textureValue = sliceTexture3D(uLightSampler, textureLookupPoint);
#endif
  float localLight = textureValue.r * 4.0/*TODO magic number */;
  
  return localLight * lightEnv(normalize(vNormal + bump));
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
  
  // Exposure
#if LIGHTING
  color.rgb *= uExposure;
#endif
  
  // Overbright goes to white
  color.rgb = spill(color.rgb);
  
  // Focus desaturation
  if (!uFocusCue) {
    float gray = dot(color, luminanceCoeff);
    color = mix(color, vec4(gray, gray, gray, color.a), 0.5);
  }
  
  gl_FragColor = color;
}
