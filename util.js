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

// Given an element, replace its contents with a text node and return that, so that the element's text can be updated by setting the .data property of the result.
function dynamicText(elem) {
  while (elem.firstChild) elem.removeChild(info.firstChild);
  var textNode = document.createTextNode("");
  elem.appendChild(textNode);
  textNode.data = "";
  return textNode;
}
