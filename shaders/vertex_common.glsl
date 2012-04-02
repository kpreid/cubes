attribute vec3 aVertexPosition;
attribute vec4 aVertexColor;
attribute vec3 aVertexNormal;
attribute vec2 aTextureCoord;

vec4 eyePosition; // written by basicVertex

void basicVertex(vec3 vertexPosition) {
  vFixedOrientationPosition = vertexPosition - uViewPosition;
  eyePosition = uMVMatrix * vec4(vertexPosition, 1.0);
  gl_Position = uPMatrix * eyePosition;
  
  vTextureCoord = aTextureCoord;
  
  // linear distance from eye, scaled to 1.0 = 100% fog
  vDistanceFromEye = length(vec3(eyePosition));
  
  // fog color mixing parameter
  vFog = clamp(pow(vDistanceFromEye/uFogDistance, 4.0), 0.0, 1.0);
  
  vColor = uTextureEnabled ? vec4(1.0) : aVertexColor;
  vNormal = aVertexNormal;
}
