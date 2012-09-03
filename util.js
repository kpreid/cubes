// Except as noted,
// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.
//
// Exception: The code of prepareShader and prepareProgram is derived from
// the Learning WebGL lessons, at http://learningwebgl.com/blog/?p=1786 (as of
// September 2011). No license is stated on that site, but I (Kevin Reid)
// believe that it is obviously the authors' intent to make this code free to
// use.

/*global WeakMap: false */

(function () {
  "use strict";
  var util = cubes.util = {};
  
  function missingPlatformFeatures() {
    var failures = "";
    
    var setterError = "ECMAScript 5 property accessors on frozen objects\n";
    try {
      var y = 0;
      var o = Object.freeze({
        get x() { return 17; },
        set x(v) { y = v; }
      });
      o.x = 43;
      if (y !== 43) failures += setterError;
    } catch (e) {
      failures += setterError;
    }
    
    var nullo = Object.create(null);
    var nullError = "Object.create(null)\n";
    if (nullo.toString !== undefined) {
      failures += nullError;
    } else {
      for (var p in nullo) {
        /*jshint expr: true */ p;
        failures += nullError;
        break;
      }
    }
    
    return failures;
  }
  util.missingPlatformFeatures = missingPlatformFeatures;
  
  function mod(value, modulus) {
    return (value % modulus + modulus) % modulus;
  }
  util.mod = mod;
  
  function signum(x) {
    return x > 0 ? 1 : x < 0 ? -1 : 0;
  }
  util.signum = signum;
  
  function exponentialStep(val0, zeroOffset, timestep, constant, cutoff) {
    var decayDerivative = constant * Math.exp(constant * timestep);
    var val1 = val0 + (val0 - zeroOffset) * decayDerivative * timestep;
    if (Math.abs(val1 - zeroOffset) < cutoff) {
      return zeroOffset;
    } else {
      return val1;
    }
  }
  util.exponentialStep = exponentialStep;
  
  function fixedmultiplyVec3(matrix, vector) {
    // glMatrix's multiplyVec3 doesn't work if the implicit fourth OUTPUT is not 1, so doesn't work for matrices such as inverted projection matrices
    var four = [vector[0], vector[1], vector[2], 1];
    mat4.multiplyVec4(matrix, four);
    vector[0] = four[0]/four[3];
    vector[1] = four[1]/four[3];
    vector[2] = four[2]/four[3];
    return vector;
  }
  util.fixedmultiplyVec3 = fixedmultiplyVec3;
  
                util.ZEROVEC = vec3.createFrom(0,0,0);
  var UNIT_PX = util.UNIT_PX = vec3.createFrom(1,0,0);
  var UNIT_PY = util.UNIT_PY = vec3.createFrom(0,1,0);
  var UNIT_PZ = util.UNIT_PZ = vec3.createFrom(0,0,1);
  var UNIT_NX = util.UNIT_NX = vec3.createFrom(-1,0,0);
  var UNIT_NY = util.UNIT_NY = vec3.createFrom(0,-1,0);
  var UNIT_NZ = util.UNIT_NZ = vec3.createFrom(0,0,-1);
  
  // Helper for constructing DOM.
  function mkelement(name, classes/* , child, child, ... */) {
    var element = document.createElement(name);
    element.className = classes;
    var i;
    for (i = 2; i < arguments.length; i++) {
      var childDes = arguments[i];
      if (typeof childDes === "string") {
        childDes = document.createTextNode(childDes);
      }
      element.appendChild(childDes);
    }
    return element;
  }
  util.mkelement = mkelement;
  
  function prepareShader(gl, type, sources, declarations) {
    // See note in license statement at the top of this file.
    
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
    
    var i, name;
    var attribs = Object.create(boundAttribLocations);
    for (i = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) - 1; i >= 0; i--) {
      name = gl.getActiveAttrib(program, i).name;
      attribs[name] = gl.getAttribLocation(program, name);
    }
    var uniforms = {};
    for (i = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) - 1; i >= 0; i--) {
      name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    
    return {
      program: program,
      attribs: attribs,
      uniforms: uniforms
    };
  }
  util.prepareProgram = prepareProgram;
  
  // Axis-Aligned Box data type. (We'd usually say Axis-Aligned Bounding Box, but that's what it's being used for, not what it does.
  util.AAB = (function () {
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
    
    // Convenience arraylikeness
    Object.defineProperty(AAB.prototype, "length", {value: 6});
    
    // Convenience for looking up a face by indexes:
    //   dim -- axis: x=0 y=1 z=2
    //   dir -- face: low=0 high=1
    AAB.prototype.get = function (dim, dir) {
      return this[dim*2+dir];
    };
    
    // Intersection test
    // TODO this may be incorrect; write test cases for it
    AAB.prototype.intersects = function (other) {
      for (var dim = 0; dim < 3; dim++)
        if (this[dim*2+1] < other[dim*2] || other[dim*2+1] < this[dim*2])
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
    
    AAB.prototype.rotate = function (rot) {
      var v0 = [this[0], this[2], this[4]]; rot.transformPoint(v0, v0);
      var v1 = [this[1], this[3], this[5]]; rot.transformPoint(v1, v1);
      return new AAB(Math.min(v0[0], v1[0]),
                     Math.max(v0[0], v1[0]),
                     Math.min(v0[1], v1[1]),
                     Math.max(v0[1], v1[1]),
                     Math.min(v0[2], v1[2]),
                     Math.max(v0[2], v1[2]));
    };
    
    // The distance from the origin to the closest point not in this AAB.
    // Probably not useful unless this AAB contains the origin.
    AAB.prototype.minimumRadius = function () {
      return Math.max(0, Math.min(-this[0], this[1],
                                  -this[2], this[3],
                                  -this[4], this[5]));
    };
    
    AAB.prototype.toArray = function () {
      return [this[0], this[1], this[2], this[3], this[4], this[5]];
    };
    
    AAB.fromArray = function (array) {
      return new AAB(array[0], array[1], array[2], array[3], array[4], array[5]);
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
    while (elem.firstChild) elem.removeChild(elem.firstChild);
    var textNode = document.createTextNode("");
    elem.appendChild(textNode);
    textNode.data = "";
    return textNode;
  }
  util.dynamicText = dynamicText;
  
  // Utilities for working with those rotations (and improper rotations) which
  // are symmetries of the cube.
  util.CubeRotation = (function () {
    var RANGE = 64; // contains some duplicates due to "120-ness" having 3 possibilities in 2 bits
  
    function computeSymmetry(code, size, vec, result) {
      // Contributed by Jack Schmidt; see: <http://math.stackexchange.com/questions/78573/what-is-a-natural-way-to-enumerate-the-symmetries-of-a-cube>
      
      var x = vec[0];
      var y = vec[1];
      var z = vec[2];
      
       var t;
       // Peel off the "are we a reflection?" bit
       if( code & 32 ) { t=x; x=y; y=t; }
       // Peel off the "do we swap the tetrahedrons?" bit
       if( code & 16 ) { t=x; x=y; y=t; z=size-z; }
       // Now we are in tetrahedral group, peel off the "120-ness"
       switch( (code & (4+8) ) >> 2 ) {
         case 0: break;
         case 1: t=x; x=y; y=z; z=t; break;
         case 2: t=z; z=y; y=x; x=t; break;
         case 3: /* redundant w/ 0 */ break;
       }
       // Now we are in the Klein four group, peel off the "180-ness"
       switch( code & (1+2) ) {
         case 0: break;
         case 1: x=size-x; y=size-y; break;
         case 2: y=size-y; z=size-z; break;
         case 3: z=size-z; x=size-x; break;
       }
       if (!result) result = vec3.create();
       result[0] = x;
       result[1] = y;
       result[2] = z;
       return result;
    }
    
    function CubeRotation(code) {
      this.code = code;
      this.isReflection = code & 32;
      this._compositions = [];
      
      // Pre-rotated unit vectors
      this.px = this.transformVector(UNIT_PX);
      this.py = this.transformVector(UNIT_PY);
      this.pz = this.transformVector(UNIT_PZ);
      this.nx = this.transformVector(UNIT_NX);
      this.ny = this.transformVector(UNIT_NY);
      this.nz = this.transformVector(UNIT_NZ);
    }
    CubeRotation.prototype.after = function (firstRotation) {
      return this._compositions[firstRotation.code];
    };
    CubeRotation.prototype.transformVector = function (vec, result) {
      // TODO: Find out if using a matrix is faster.
      return computeSymmetry(this.code, 0, vec, result);
    };
    CubeRotation.prototype.transformPoint = function (vec, result) {
      return computeSymmetry(this.code, 1, vec, result);
    };
    
    // "Static methods"
    CubeRotation.canonicalCode = function (code) {
      code = mod(code | 0, RANGE);
      if ((code & (4+8)) >> 2 === 3) code &= ~(4+8); // remove nonexistent 4th case
      return code;
    };
    // Among the specified rotations, choose the one which minimizes the angle between the rotated 'toRotate' and 'direction'.
    CubeRotation.nearestToDirection = function (target, toRotate, rotations) {
      var cosine = -Infinity;
      var best = null;
      var vecbuf = vec3.create();
      for (var i = 0; i < rotations.length; i++) {
        var ia = vec3.dot(target, rotations[i].transformVector(toRotate, vecbuf));
        if (ia > cosine) {
          cosine = ia;
          best = rotations[i];
        }
      }
      return best;
    };
  
    // Precompute all rotations
    var table = [];
    var lastSeenUnique;
    for (var i = 0; i < RANGE; i++) {
      var reduced = CubeRotation.canonicalCode(i);
      if (reduced !== i) {
        table[i] = table[reduced];
      } else {
        table[i] = new CubeRotation(i);
        lastSeenUnique = i;
      }
    }
    CubeRotation.byCode = table;
  
    function similarVector(a,b) {
      return vec3.length(vec3.subtract(a, b, vec3.create())) < 1e-3;
    }
  
    // Compute compositions and inverses
    var exampleVec = [1,2,3];
    table.forEach(function (rot1) {
      table.forEach(function (rot2) {
        var compResult = rot2.transformVector(rot1.transformVector(exampleVec));
        testing: for (var k = 0; k < RANGE; k++) {
          var candidate = table[k];
          if (similarVector(candidate.transformVector(exampleVec), compResult)) {
            rot2._compositions[rot1.code] = candidate;
            if (similarVector(exampleVec, compResult)) { // found an inverse
              rot1.inverse = rot2;
              rot2.inverse = rot1;
            }
            break testing;
          }
        }
      });
    });
    
    CubeRotation.codeRange = RANGE;
    CubeRotation.count = lastSeenUnique + 1;
    CubeRotation.countWithoutReflections = 27;
    
    // rotations are named according to the right-hand rule (counterclockwise looking opposite the named axis)
    CubeRotation.identity = table[0];
    CubeRotation.x90  = table[16+4  ];
    CubeRotation.x180 = table[     2];
    CubeRotation.x270 = table[16+4+2];
    CubeRotation.y90  = table[16+8+3];
    CubeRotation.y180 = table[     3];
    CubeRotation.y270 = table[16+8  ];
    CubeRotation.z90  = table[16  +3];
    CubeRotation.z180 = table[     1];
    CubeRotation.z270 = table[16  +2];
    
    return CubeRotation;
  }());
  
  // A map from keys of the form [i, j, ...], which may be Arrays or typed arrays.
  util.IntVectorMap = (function () {
    var join = Array.prototype.join;
    var sep = ",";
    function IntVectorMap() {
      var table = Object.create(null);
      var count = 0;
    
      this.get = function (key) {
        var skey = join.call(key, sep);
        return table[skey];
      };
      this.set = function (key, value) {
        var skey = join.call(key, sep);
        if (!(skey in table)) count++;
        table[skey] = value;
      };
      this.has = function (key) {
        var skey = join.call(key, sep);
        return skey in table;
      };
      this.delete = function (key) {
        var skey = join.call(key, sep);
        if (skey in table) count--;
        delete table[skey];
      };
      this.forEach = function (f) {
        for (var skey in table) {
          // TODO profile and figure out whether it'd be better to store the keys
          // (note that the above passed-in key might be mutated)
          var key = skey.split(sep);
          for (var i = key.length - 1; i >= 0; i--) {
            key[i] = parseInt(key[i], 10);
          }
          f(table[skey], key);
        }
      };
      // Iterate over values without keys (more efficient)
      this.forEachValue = function (f) {
        for (var skey in table) {
          f(table[skey]);
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
  
  // A map from objects to objects. This is a substitute for the future feature WeakMap <http://wiki.ecmascript.org/doku.php?id=harmony:weak_maps>. Unlike the real thing, it has O(n) lookup and keeps garbage around.
  util.ObjectMap = (function () {
    if (typeof WeakMap !== "undefined") return WeakMap;
    
    var warned = false;
    
    function ObjectMap() {
      var keys = [];
      var values = [];
      this.get = function (keyObj) {
        return values[keys.indexOf(keyObj)];
      };
      this.has = function (keyObj) {
        return keys.indexOf(keyObj) in values;
      };
      this.set = function (keyObj, value) {
        var index = keys.indexOf(keyObj);
        if (index == -1) {
          index = keys.length;
          keys.push(keyObj);
          if (index >= 20 && !warned && typeof console !== "undefined") {
            warned = true;
            console.warn("ObjectMap got more than 20 keys; time to fix the implementation?");
          }
        }
        values[index] = value;
      };
    }
    
    return ObjectMap;
  }());
  
  // Utility for change/event listeners.
  // Each listener object must have a method "interest" yielding a boolean indicating whether it wants further events (if false, the listener will be removed and not notified).
  function Notifier(label) {
    if (!(this instanceof Notifier))
      throw new Error("bad constructor call");
    
    var listeners = [];
    this.notify = function (method) {
      //console.log("notify",label,method,Array.prototype.slice.call(arguments, 1));
      var i, listener;
      
      function checkInterest() {
        if (!listener.interest()) {
          if (i < listeners.length - 1) {
            listeners[i] = listeners.pop();
          } else {
            listeners.pop();
          }
          i--;
          return false;
        } else {
          return true;
        }
      }
      
      for (i = 0; i < listeners.length; i++) {
        listener = listeners[i];
        if (checkInterest()) {
          try {
            listener[method].apply(listener, Array.prototype.slice.call(arguments, 1));
          } catch (e) {
            if (!(method in listener)) {
              throw new Error("Listener(" + label + ") is missing method " + method);
            } else {
              throw e;
            }
          }
          checkInterest(); // allow removal immediately afterward
        }
      }
    };
    this.listen = function (f) {
      listeners.push(f);
      if (listeners.length > 50 && typeof console !== "undefined") {
        console.warn("Notifier", label, "has over 50 listeners. Leak?");
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
    };
    return Object.freeze(this);
  }
  util.Notifier = Notifier;
  
  // Data structure which
  //    contains a set of elements at most once,
  //    has efficient insertion and remove-one operations,
  //    and returns the items in FIFO order or approximately sorted order.
  // The elements must be strings or consistently and uniquely stringify.
  // The comparison function need not be consistent between calls to DirtyQueue.
  function DirtyQueue(optCompareFunc) {
    var index = Object.create(null);
    var queueNear = [];
    var queueFar = [];
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
        index = Object.create(null);
        queueNear = [];
        queueFar = [];
      },
      enqueue: function (key) {
        if (key in index) return;
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
  util.DirtyQueue = DirtyQueue;
  
  // Queue data structure which can have multiple readers at different positions. Unlike DirtyQueue, does not deduplicate. A new reader (getHead()) always sees the most-recent (empty) view.
  function CatchupQueue() {
    function makeLink() {
      var head = {};
      var value, next;
      Object.defineProperties(head, {
        available: {
          enumerable: true,
          get: function () { return !!next; }
        },
        value: {
          enumerable: true,
          get: function () {
            if (!next) throw new Error("not yet resolved");
            return value;
          }
        },
        next: {
          enumerable: true,
          get: function () {
            if (!next) throw new Error("not yet resolved");
            return next;
          }
        },
      });
      function resolve(v, n) {
        value = v;
        next = n;
      }
      return {head: head, resolve: resolve};
    }
    
    var l = makeLink();
    
    function enqueue(value) {
      var nextLink = makeLink();
      l.resolve(value, nextLink.head);
      l = nextLink;
    }
    
    function getHead() {
      return l.head;
    }
    
    return {getHead: getHead, enqueue: enqueue};
  }
  util.CatchupQueue = CatchupQueue;
  
  function ProgressBar(rootElem) {
    if (!rootElem) {
      rootElem = document.createElement("div");
    }
    this.element = rootElem;
    
    rootElem.classList.add("progress-bar");
    var fill = mkelement("div", "progress-bar-fill");
    rootElem.appendChild(fill);
    
    this.set = function (value) {
      if (value !== value /* NaN test */) {
        value = 0.5; // obviously bogus
      } else {
        value = Math.min(1, Math.max(0, value));
      }
      rootElem.style.display = value < 1 && value > 0 ? "block" : "none";
      fill.style.width = (value * 100).toFixed(2) + "%";
    };
    
    this.set(0);
  }
  // Update progress bar from an 'items remaining to do' count.
  // Infer progress bar range from the highest count seen since a zero.
  ProgressBar.prototype.setByTodoCount = function (count) {

    if (count === 0) {
      this._rangeEstimate = 0;
      this.set(1);
    } else {
      this._rangeEstimate = Math.max(count, (this._rangeEstimate || 0));
      this.set(1 - count/this._rangeEstimate);
    }
  };
  util.ProgressBar = ProgressBar;
  
  // 'type' is an xhr.responseType value such as 'text' or 'arraybuffer'
  // The callback will be called with parameters (response), or (null,
  // opt exception) in the event of a failure.
  function fetchResource(url, type, callback) {
    // TODO: review this code
    //if (typeof console !== "undefined")
    //  console.log("Fetching", url);
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = type;
    xhr.onreadystatechange = function () {
      if (xhr.readyState != XMLHttpRequest.DONE) {
        return;
      }
      //if (typeof console !== "undefined")
      //  console.log("completed", url, xhr.status);
      if (xhr.status == 200) {
        callback(xhr.response, null);
      } else {
        if (typeof console !== "undefined")
          console.error("XHR reported failure:", xhr.readyState, xhr.status);
        callback(null, null);
      }
    };
    try {
      xhr.send(null);
    } catch (e) {
      if (typeof console !== "undefined")
        console.error("XHR send crashed:", e);
      setTimeout(function () {
        callback(null, e);
      }, 0);
    }
  }
  util.fetchResource = fetchResource;
  
  Object.freeze(util);
}());
