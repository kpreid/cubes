// Except as noted,
// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.
//
// Exception: The code of prepareShader and prepareProgram is derived from
// the Learning WebGL lessons, at http://learningwebgl.com/blog/?p=1786 (as of
// September 2011). No license is stated on that site, but I (Kevin Reid)
// believe that it is obviously the authors' intent to make this code free to
// use.

function testSettersWork() {
  "use strict";
  try {
    var y = 0;
    var o = Object.freeze({
      set x(v) { y = v; }
    });
    o.x = 43;
    return y === 43;
  } catch (e) {
    return false;
  }
}

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

function prepareShader(gl, type, sources, declarations) {
  // See note in license statement at the top of this file.  
  "use strict";
  
  var strings = [];
  for (var prop in declarations) {
    var value = declarations[prop];
    if (typeof value == "boolean") {
      value = value ? 1 : 0; // GLSL preprocessor doesn't do booleans
    }
    strings.push("#define ", prop, " (", value, ")\n");
  }
  sources.forEach(function (text, index) {
    strings.push("#line 1 ", index.toString(), "\n", text);
  });
  
  var shader = gl.createShader(type);
  
  gl.shaderSource(shader, strings.join(""));
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (typeof console !== "undefined") console.log("Shader text:\n" + strings.join(""));
    throw new Error(gl.getShaderInfoLog(shader));
  }
  
  return shader;
}

function prepareProgram(gl, declarations, boundAttribLocations, vertexSources, fragmentSources) {
  // See note in license statement at the top of this file.  
  "use strict";
  
  var vertexShader = prepareShader(gl, gl.VERTEX_SHADER, vertexSources, declarations);
  var fragmentShader = prepareShader(gl, gl.FRAGMENT_SHADER, fragmentSources, declarations);
  
  var program = gl.createProgram();

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);

  for (var attribName in boundAttribLocations) {
    var index = boundAttribLocations[attribName];
    if (typeof index === "number") {
      gl.bindAttribLocation(program, index, attribName);
    } else {
      if (typeof console !== "undefined") {
        console.warn("Enumerable non-number", attribName, "in boundAttribLocations object", boundAttribLocations);
      }
    }
  }
  
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  
  var attribs = Object.create(boundAttribLocations);
  for (var i = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) - 1; i >= 0; i--) {
    var name = gl.getActiveAttrib(program, i).name;
    attribs[name] = gl.getAttribLocation(program, name);
  }
  var uniforms = {};
  for (var i = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) - 1; i >= 0; i--) {
    var name = gl.getActiveUniform(program, i).name;
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  
  return {
    program: program,
    attribs: attribs,
    uniforms: uniforms
  };
}

// Axis-Aligned Box data type. (We'd usually say Axis-Aligned Bounding Box, but that's what it's being used for, not what it does.
var AAB = (function () {
  "use strict";

  function AAB(lx,hx,ly,hy,lz,hz) {
    // Data properties are named numerically so that code can be written generically across dimensions.
    // TODO: Check that l < h? Do we want to require that?
    this[0] = lx;
    this[1] = hx;
    this[2] = ly;
    this[3] = hy;
    this[4] = lz;
    this[5] = hz;
  }
  
  // Convenience for looking up a face by indexes:
  //   dim -- axis: x=0 y=1 z=2
  //   dir -- face: low=0 high=1
  AAB.prototype.get = function (dim, dir) {
    return this[dim*2+dir];
  };
  
  // Intersection test
  AAB.prototype.intersects = function (other) {
    for (var dim = 0; dim < 3; dim++)
      if (this[dim*2] < other[dim*2+1] || a2[dim*2+1] < a1[dim*2])
        return false;
    return true;
  };
  
  // The AABB of two AABs
  AAB.prototype.boundingUnion = function (other) {
    var out = new AAB();
    for (var dimb = 0; dimb < 6; dimb += 2) {
      out[dimb  ] = Math.min(this[dimb  ], other[dimb  ]);
      out[dimb+1] = Math.max(this[dimb+1], other[dimb+1]);
    }
    return out;
  };
  
  // Return this AAB translated by the specified offset
  AAB.prototype.translate = function (offset) {
    return new AAB(offset[0] + this[0],
                   offset[0] + this[1],
                   offset[1] + this[2],
                   offset[1] + this[3],
                   offset[2] + this[4],
                   offset[2] + this[5]);
  };

  AAB.prototype.scale = function (scale) {
    return new AAB(scale * this[0],
                   scale * this[1],
                   scale * this[2],
                   scale * this[3],
                   scale * this[4],
                   scale * this[5]);
  };
  
  // TODO: This is not strictly rotation as it includes reflections.
  AAB.prototype.rotate = function (symmetry) {
    var v0 = applyCubeSymmetry(rotation, 0, [this[0], this[2], this[4]]);
    var v1 = applyCubeSymmetry(rotation, 0, [this[1], this[3], this[5]]);
    return new AAB(v0[0],
                   v1[0],
                   v0[1],
                   v1[1],
                   v0[2],
                   v1[2]);
  };
  
  // The distance from the origin to the closest point not in this AAB.
  // Probably not useful unless this AAB contains the origin.
  AAB.prototype.minimumRadius = function () {
    return Math.max(0, Math.min(-this[0], this[1],
                                -this[2], this[3],
                                -this[4], this[5]));
  };
  
  // Create the AAB whose negative corner is at the given point.
  AAB.unitCube = function (point) {
    return new AAB(point[0], point[0] + 1,
                   point[1], point[1] + 1,
                   point[2], point[2] + 1);
  };
  
  return Object.freeze(AAB);
}());

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
applyCubeSymmetry.isReflection = function (symmetry) { return !!(symmetry & 32); };
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

// A map from keys of the form [i, j, ...], which may be Arrays or typed arrays.
var IntVectorMap = (function () {
  "use strict";
  var hop = Object.prototype.hasOwnProperty;
  var join = Array.prototype.join;
  var tag = " ";
  var tagLength = tag.length;
  var sep = ",";
  function IntVectorMap() {
    var table = {};
    var count = 0;
    
    this.get = function (key) {
      var skey = tag + join.call(key, sep);
      return table[skey];
    };
    this.set = function (key, value) {
      var skey = tag + join.call(key, sep);
      if (!hop.call(table, skey)) count++;
      table[skey] = value;
    };
    this.has = function (key) {
      var skey = tag + join.call(key, sep);
      return hop.call(table, skey);
    };
    this.delete = function (key) {
      var skey = tag + join.call(key, sep);
      if (hop.call(table, skey)) count--;
      delete table[skey];
    };
    this.forEach = function (f) {
      for (var skey in table) {
        if (!hop.call(table, skey)) continue;
        // TODO profile and figure out whether it'd be better to store the keys
        // (note that the above passed-in key might be mutated)
        var key = skey.substring(tagLength).split(sep);
        for (var i = key.length - 1; i >= 0; i--) {
          key[i] = parseInt(key[i], 10);
        }
        f(table[skey], key);
      }
    };
    Object.defineProperty(this, "length", {
      get: function () { return count; }
    });
  }
  
  IntVectorMap.empty = {
    get: function () { return undefined; },
    has: function () { return false; },
    length: 0,
    forEach: function (f) { }
  };
  
  return Object.freeze(IntVectorMap);
}());

// Utility for change/event listeners.
// Each listener function must return true/false indicating whether it wants further events.
// TODO: Add prompt removal
function Notifier(label) {
  "use strict";
  if (!(this instanceof Notifier))
    throw new Error("bad constructor call");

  var listeners = [];
  this.notify = function (method) {
    //console.log("notify",label,method,Array.prototype.slice.call(arguments, 1));
    for (var i = 0; i < listeners.length; i++) {
      var listener = listeners[i];
      var res;
      try {
        res = listener[method].apply(listener, Array.prototype.slice.call(arguments, 1));
      } catch (e) {
        if (!(method in listener)) {
          throw new Error("Listener(" + label + ") is missing method " + method);
        } else {
          throw e;
        }
      }
      if (res !== true) {
        if (res !== false && typeof console !== "undefined") {
          console.warn("Listener", listener, " did not return boolean.");
        }
        if (i < listeners.length - 1) {
          listeners[i] = listeners.pop();
        } else {
          listeners.pop();
        }
      }
    }
  };
  this.listen = function (f) {
    listeners.push(f);
    if (listeners.length > 50 && typeof console !== "undefined") {
      console.warn("Notifier", this, "has over 50 listeners. Leak?");
    }
  };
  this.listen.cancel = function (f) {
    for (var i = 0; i < listeners.length; i++) {
      if (listeners[i] === f) {
        if (i < listeners.length - 1) {
          listeners[i] = listeners.pop();
        } else {
          listeners.pop();
        }
      }
        
    }
  }
  return Object.freeze(this);
}

// Data structure which
//    contains a set of elements at most once,
//    has efficient insertion and remove-one operations,
//    and returns the items in FIFO order or approximately sorted order.
// The elements must be strings or consistently and uniquely stringify.
// The comparison function need not be consistent between calls to DirtyQueue.
function DirtyQueue(optCompareFunc) {
  var index = {};
  var queueNear = [];
  var queueFar = [];
  var hop = Object.prototype.hasOwnProperty;
  var flusher = null;
  var flushing = false;
  function flushLoop() {
    if (self.size() && flushing) {
      flusher(self.dequeue());
      setTimeout(flushLoop, 0);
    } else {
      flushing = false;
    }
  }
  var self = Object.freeze({
    size: function () {
      return queueNear.length + queueFar.length;
    },
    clear: function () {
      index = {};
      queueNear = [];
      queueFar = [];
    },
    enqueue: function (key) {
      if (hop.call(index, key)) return;
      index[key] = true;
      queueFar.push(key);

      if (flusher && !flushing) {
        flushing = true;
        setTimeout(flushLoop, 0);
      }
    },
    // Return a value if available or null.
    dequeue: function () {
      if (!queueNear.length) {
        queueNear = queueFar;
        queueFar = [];
        if (optCompareFunc) {
          // Reversed because the *last* elements of queueNear dequeue first
          queueNear.sort(function (a,b) { return optCompareFunc(b,a); });
        } else {
          queueNear.reverse(); // use insertion order
        }
        if (!queueNear.length) {
          return null;
        }
      }
      var key = queueNear.pop();
      delete index[key];
      return key;
    },
    // Automatically call the handler function on elements of the queue in the background.
    setBackgroundFlusher: function (handler) {
      flusher = handler;
      if (flusher) {
        if (self.size() && !flushing) {
          flushing = true;
          setTimeout(flushLoop, 0);
        }
      } else {
        flushing = false;
      }
    }
  });
  
  return self;
}

function ProgressBar(rootElem) {
  "use strict";
  
  if (!rootElem) {
    rootElem = document.createElement("div");
  }
  this.element = rootElem;

  rootElem.className += " progress-bar";
  var fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  rootElem.appendChild(fill);
  
  this.set = function (value) {
    rootElem.style.display = value < 1 && value > 0 ? "block" : "none";
    fill.style.width = (value * 100).toFixed(2) + "%";
  };
  
  this.set(0);
}
// Update progress bar from an 'items remaining to do' count.
// Infer progress bar range from the highest count seen since a zero.
ProgressBar.prototype.setByTodoCount = function (count) {
  "use strict";

  if (count === 0) {
    this._rangeEstimate = 0;
  } else {
    this._rangeEstimate = Math.max(count, (this._rangeEstimate || 0));
  }
  this.set(1 - count/this._rangeEstimate); // if this produces +Infinity that's fine
};

// 'type' is an xhr.responseType value such as 'text' or 'arraybuffer'
// The callback will be called with parameters (response), or (null)
// in the event of a failure.
function fetchResource(url, type, callback) {
  "use strict";
  // TODO: review this code
  if (typeof console !== "undefined")
    console.log("Fetching", url);
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.responseType = type;
  xhr.onreadystatechange = function () {
    if (xhr.readyState != XMLHttpRequest.DONE) {
      return;
    }
    if (typeof console !== "undefined")
      console.log("completed", url);
    if (xhr.status == 200) {
      callback(xhr.response);
    } else {
      if (typeof console !== "undefined")
        console.error("XHR fail:", xhr.readyState, xhr.status);
      callback(null);
    }
  };
  xhr.send(null);
}
