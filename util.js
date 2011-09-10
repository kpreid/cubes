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

