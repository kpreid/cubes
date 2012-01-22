attribute vec3 aVertexPosition;
attribute vec4 aVertexColor;
attribute vec3 aVertexNormal;
attribute vec2 aTextureCoord;

void main(void) {
    vec3 vertexPosition;
    float pointScale;
    
    if (uParticleMode) {
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
      
      vertexPosition = uParticleExplode
        ? aVertexPosition + (1.0 * scramble + 0.5 * particlePart) * pow(uParticleInterp, 3.0)
        : aVertexPosition + particlePart * (0.1 + uParticleInterp * 0.1);
      pointScale = 1.0 - pow(uParticleInterp * 1.0, 2.0);
    } else {
      vertexPosition = aVertexPosition;
    }
    
    vGridPosition = vertexPosition;
    vFixedOrientationPosition = vertexPosition - uViewPosition;
    vec4 relativePosition = uMVMatrix * vec4(vertexPosition, 1.0);
    gl_Position = uPMatrix * relativePosition;
    
    if (uParticleMode) {
      // Compute particle size
      vec4 testPosition = relativePosition;
      testPosition.x = uPixelsPerClipUnit.x / uTileSize * 1.2/*appearance fudge factor*/;
      testPosition.y = 0.0;
      testPosition = uPMatrix * testPosition;
      gl_PointSize = testPosition.x / testPosition.w * pointScale;
    }
    
    vTextureCoord = aTextureCoord;
    
    // linear distance from eye, scaled to 1.0 = 100% fog
    vDistanceFromEye = length(vec3(relativePosition));
    
    // fog color mixing parameter
    vFog = clamp(pow(vDistanceFromEye/uFogDistance, 4.0), 0.0, 1.0);
    
    vColor = uTextureEnabled ? vec4(1.0) : aVertexColor;
    vNormal = aVertexNormal;
}
