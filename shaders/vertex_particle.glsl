uniform float uParticleInterp;  // particle system evolution time, [0.0, 1.0]
uniform bool uParticleExplode; // particles explode or appear/fade?
uniform vec3 uParticleSystemPosition; // Location of particle system in world coordinates

attribute vec3 aParticleSubcube;

void main(void) {
  float animationScale = 1.0 - pow(uParticleInterp * 1.0, 2.0);
  
  // For particles, aVertexPosition provides the particle-system-relative coordinates only (due to precomputing the positions); the position of the system is provided by matrix transformation.
  
  // Particle-relative position of the particle's geometry
  vec3 subcubeVertex = (aVertexPosition * animationScale) + 0.5;
  
  // System-relative position of the particle
  vec3 particlePosition = aParticleSubcube - 0.5;
  
  // Pseudorandom vector constant for the point. This is used to choose the particle's direction of flight.
  vec3 scramble = normalize(vec3(
    sin(dot(aParticleSubcube, vec3(24121.9, 2398.1, 234.8))),
    sin(dot(aParticleSubcube, vec3(1024.0, 28.0, 1834.0))),
    sin(dot(aParticleSubcube, vec3(486.0, 282.4, 7.215)))
  ));
  
  // Vertex position in world of the particle's aligned-with-block state
  vGridPosition = uParticleSystemPosition + subcubeVertex + particlePosition;
  
  // Add animated position
  vec3 vertexPosition = vGridPosition +
    (uParticleExplode
      ? (1.0 * scramble + 0.5 * particlePosition) * pow(uParticleInterp, 3.0)
      : particlePosition * (0.1 + uParticleInterp * 0.1));
  basicVertex(vertexPosition);
  
#if !CUBE_PARTICLES
  // Compute pixel scale for points
  vec4 testPosition = eyePosition;
  testPosition.x = uPixelsPerClipUnit.x / uTileSize * 1.2/*appearance fudge factor*/;
  testPosition.y = 0.0;
  testPosition = uPMatrix * testPosition;
  gl_PointSize = testPosition.x / testPosition.w * animationScale;
#endif
}
