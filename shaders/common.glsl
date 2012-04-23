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
uniform sampler2D uNoiseSampler;
uniform float uTileSize; // always integer, but used as float

uniform bool uStipple;
uniform bool uFocusCue;
