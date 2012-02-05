uniform float uParticleInterp;  // particle system evolution time, [0.0, 1.0]
uniform bool uParticleExplode; // particles explode or appear/fade?

void main(void) {
  // center of block
  vec3 blockPart = floor(aVertexPosition) + 0.5;
  // offset from center of block
  vec3 particlePart = mod(aVertexPosition, 1.0) - 0.5;
  
  // pseudorandom vector constant for the point
  vec3 scramble = normalize(vec3(
    sin(dot(aVertexPosition, vec3(24121.9, 2398.1, 234.8))),
    sin(dot(aVertexPosition, vec3(1024.0, 28.0, 1834.0))),
    sin(dot(aVertexPosition, vec3(486.0, 282.4, 7.215)))
  ));
  
  vec3 vertexPosition = uParticleExplode
    ? aVertexPosition + (1.0 * scramble + 0.5 * particlePart) * pow(uParticleInterp, 3.0)
    : aVertexPosition + particlePart * (0.1 + uParticleInterp * 0.1);
  basicVertex(vertexPosition);

  float animationScale = 1.0 - pow(uParticleInterp * 1.0, 2.0);

  // Compute pixel scale for particles
  vec4 testPosition = eyePosition;
  testPosition.x = uPixelsPerClipUnit.x / uTileSize * 1.2/*appearance fudge factor*/;
  testPosition.y = 0.0;
  testPosition = uPMatrix * testPosition;
  gl_PointSize = testPosition.x / testPosition.w * animationScale;
}
