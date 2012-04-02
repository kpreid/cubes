uniform float uParticleInterp;  // particle system evolution time, [0.0, 1.0]
uniform bool uParticleExplode; // particles explode or appear/fade?

attribute vec3 aParticleSubcube;

void main(void) {
  float animationScale = 1.0 - pow(uParticleInterp * 1.0, 2.0);

  vec3 subcubeVertex = (aVertexPosition * animationScale) + 0.5;
  vec3 particlePosition = aParticleSubcube - 0.5;
  
  // pseudorandom vector constant for the point
  vec3 scramble = normalize(vec3(
    sin(dot(aParticleSubcube, vec3(24121.9, 2398.1, 234.8))),
    sin(dot(aParticleSubcube, vec3(1024.0, 28.0, 1834.0))),
    sin(dot(aParticleSubcube, vec3(486.0, 282.4, 7.215)))
  ));
  
  vec3 vertexPosition = subcubeVertex + particlePosition +
    (uParticleExplode
      ? (1.0 * scramble + 0.5 * particlePosition) * pow(uParticleInterp, 3.0)
      : particlePosition * (0.1 + uParticleInterp * 0.1));
  basicVertex(vertexPosition);
  vGridPosition = subcubeVertex + particlePosition; // excluding motion
  
#if !CUBE_PARTICLES
  // Compute pixel scale for points
  vec4 testPosition = eyePosition;
  testPosition.x = uPixelsPerClipUnit.x / uTileSize * 1.2/*appearance fudge factor*/;
  testPosition.y = 0.0;
  testPosition = uPMatrix * testPosition;
  gl_PointSize = testPosition.x / testPosition.w * animationScale;
#endif
}
