const vec4 cSky = vec4(0.1,0.3,0.5,1.0);   
const vec4 cHorizon = vec4(0.7,0.8,1.0,1.0);  
const vec4 cGround = vec4(0.5,0.4,0.4,1.0);
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
    
    if (uTextureEnabled) {
      color *= texture2D(uSampler, vTextureCoord);

      // alpha test
      if (color.a <= 0.0)
        discard;
    }
    
    color = vec4(spill(vec3(color)), color.a);

    float elevationSine = vFixedOrientationPosition.y / length(vFixedOrientationPosition);
    vec4 fogColor = elevationSine < 0.0
      ? mix(cHorizon, cGround, clamp(log(1.0 + -elevationSine * 120.0), 0.0, 1.0))
      : mix(cHorizon, cSky, clamp(log(1.0 + elevationSine * 2.0), 0.0, 1.0));
    gl_FragColor = color * (1.0-vFog) + fogColor * vFog;
    
    if (!uFocusCue) {
      float gray = 0.2126*gl_FragColor.r
                  +0.7152*gl_FragColor.g
                  +0.0722*gl_FragColor.b;
      gl_FragColor = 0.5 * gl_FragColor + 0.5 * vec4(vec3(gray), gl_FragColor.a);
    }
}
