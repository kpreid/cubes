// Except as noted,
// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.
//
// Exception: The code in the function prepareProgram is derived from from
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

function prepareProgram(gl, vertexShader, fragmentShader, attribs, uniforms) {
  // See note in license statement at the top of this file.
  
  "use strict";
  var shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    if (typeof console !== 'undefined')
      console.error(gl.getProgramInfoLog(shaderProgram));
    throw new Error("Could not link shader program; see console");
  }

  gl.useProgram(shaderProgram);
  
  function map(table, getter) {
    for (var name in table) {
      if (!table.hasOwnProperty(name)) continue;
      table[name] = gl[getter](shaderProgram, name);
      if (table[name] === -1 || table[name] === null) { // -1 for attrib, null for uniform
        if (typeof console !== 'undefined')
          console.error(getter + "(" + name + ") failed for shader");
      }
    }
  }
  map(attribs, "getAttribLocation");
  map(uniforms, "getUniformLocation");

  gl.enableVertexAttribArray(attribs.aVertexPosition);
  gl.enableVertexAttribArray(attribs.aVertexColor);
}
