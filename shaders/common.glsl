precision mediump float;

varying vec4 vColor;
varying vec3 vGridPosition;
varying vec3 vFixedOrientationPosition;
varying vec2 vTextureCoord;
varying float vFog;
varying vec3 vNormal;
varying float vDistanceFromEye;

uniform mat4 uPMatrix;
uniform mat4 uMVMatrix;
uniform vec3 uViewPosition;
uniform float uFogDistance;
uniform vec2 uPixelsPerClipUnit;

uniform bool uTextureEnabled;
uniform sampler2D uSampler;
uniform samplerCube uSkySampler;
uniform float uTileSize; // always integer, but used as float

uniform bool uParticleMode;     // flag we're rendering point particles
uniform float uParticleInterp;  // particle system evolution time, [0.0, 1.0]
uniform bool uParticleExplode; // particles explode or appear/fade?

uniform bool uStipple;
uniform bool uFocusCue;
