// Except as noted,
// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.
//
// Exception: The code of prepareShader and prepareProgram is derived from
// the Learning WebGL lessons, at http://learningwebgl.com/blog/?p=1786 (as of
// September 2011). No license is stated on that site, but I (Kevin Reid)
// believe that it is obviously the authors' intent to make this code free to
// use.

function mod(value, modulus) {
  "use strict";
  return (value % modulus + modulus) % modulus;
}

function deadzone(value, radius) {
  "use strict";
  if (value < 0) {
    return -deadzone(-value, radius);
  } else if (value < radius) {
    return 0;
  } else {
    return value - radius;
  }
}

function signum(x) {
  "use strict";
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function fixedmultiplyVec3(matrix, vector) {
  "use strict";
  // glMatrix's multiplyVec3 doesn't work if the implicit fourth OUTPUT is not 1, so doesn't work for matrices such as inverted projection matrices
  var four = [vector[0], vector[1], vector[2], 1];
  mat4.multiplyVec4(matrix, four);
  vector[0] = four[0]/four[3];
  vector[1] = four[1]/four[3];
  vector[2] = four[2]/four[3];
  return vector;
}

var UNIT_PX = vec3.create([1,0,0]);
var UNIT_PY = vec3.create([0,1,0]);
var UNIT_PZ = vec3.create([0,0,1]);
var UNIT_NX = vec3.create([-1,0,0]);
var UNIT_NY = vec3.create([0,-1,0]);
var UNIT_NZ = vec3.create([0,0,-1]);
var UNIT_AXES = Object.freeze([
  UNIT_PX,
  UNIT_PY,
  UNIT_PZ,
  UNIT_NX,
  UNIT_NY,
  UNIT_NZ,
]);

function prepareShader(gl, id) {
  // See note in license statement at the top of this file.  
  "use strict";
  var scriptElement = document.getElementById(id);
  var text = "";
  for (var k = scriptElement.firstChild; k !== null; k = k.nextSibling)
    if (k.nodeType == 3)
      text += k.textContent;
  
  var shader;
  if (scriptElement.type == "x-shader/x-fragment") {
    shader = gl.createShader(gl.FRAGMENT_SHADER);
  } else if (scriptElement.type == "x-shader/x-vertex") {
    shader = gl.createShader(gl.VERTEX_SHADER);
  } else {
    throw new Error("unknown shader script type");
  }
  
  gl.shaderSource(shader, text);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  
  return shader;
}

function prepareProgram(gl, vertexShader, fragmentShader, attribs, uniforms) {
  // See note in license statement at the top of this file.  
  "use strict";
  var program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }

  gl.useProgram(program);
  
  for (var i = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) - 1; i >= 0; i--) {
    var name = gl.getActiveAttrib(program, i).name;
    attribs[name] = gl.getAttribLocation(program, name);
  }
  for (var i = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) - 1; i >= 0; i--) {
    var name = gl.getActiveUniform(program, i).name;
    uniforms[name] = gl.getUniformLocation(program, name);
  }
}

function intersectAABB(a1, a2) {
  for (var dim = 0; dim < 3; dim++)
    if (a1[dim][1] < a2[dim][0] || a2[dim][1] < a1[dim][0])
      return false;
  return true;
}

// Given an element, replace its contents with a text node and return that, so that the element's text can be updated by setting the .data property of the result.
function dynamicText(elem) {
  "use strict";
  while (elem.firstChild) elem.removeChild(elem.firstChild);
  var textNode = document.createTextNode("");
  elem.appendChild(textNode);
  textNode.data = "";
  return textNode;
}

function applyCubeSymmetry(which, size, vec) {
  // Contributed by Jack Schmidt; see:
  // <http://math.stackexchange.com/questions/78573/what-is-a-natural-way-to-enumerate-the-symmetries-of-a-cube>
  "use strict";
  
  var x = vec[0];
  var y = vec[1];
  var z = vec[2];
  
   var t;
   // Peel off the "are we a reflection?" bit
   if( which & 32 ) { t=x; x=y; y=t; }
   // Peel off the "do we swap the tetrahedrons?" bit
   if( which & 16 ) { t=x; x=y; y=t; z=size-z; }
   // Now we are in tetrahedral group, peel off the "120-ness"
   switch( (which & (4+8) ) >> 2 ) {
     case 0: break;
     case 1: t=x; x=y; y=z; z=t; break;
     case 2: t=z; z=y; y=x; x=t; break;
     case 3: /* redundant w/ 0 */ break;
   }
   // Now we are in the Klein four group, peel off the "180-ness"
   switch( which & (1+2) ) {
     case 0: break;
     case 1: x=size-x; y=size-y; break;
     case 2: y=size-y; z=size-z; break;
     case 3: z=size-z; x=size-x; break;
   }
   vec = vec3.create();
   vec[0] = x;
   vec[1] = y;
   vec[2] = z;
   return vec;
}
applyCubeSymmetry.COUNT = 60;
applyCubeSymmetry.NO_REFLECT_COUNT = 27;

// Find the cube symmetry (as in 'applyCubeSymmetry') which minimizes the angle between the rotation of the vector 'cubeVec' and the vector 'direction', among those listed in 'symmetries'.
function nearestCubeSymmetry(direction, cubeVec, symmetries) {
  var cosine = -Infinity;
  var best = null;
  for (var i = 0; i < symmetries.length; i++) {
    var ia = vec3.dot(direction, applyCubeSymmetry(symmetries[i], 0, cubeVec));
    if (ia > cosine) {
      cosine = ia;
      best = symmetries[i];
    }
  }
  return best;
}
