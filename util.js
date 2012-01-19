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

function cyclicSerialize(root) {
  "use strict";
  var seen = [];
  function serialize(obj) {
    var i;
    for (i = 0; i < seen.length; i++) {
      if (seen[i] === obj) // TODO use WeakMap if available
        return i;
    }
    seen.push(obj);
    var json = obj.serialize(serialize);
    json["#"] = i;
    return json;
  }
  return serialize(root);
}

function cyclicUnserialize(json, constructor) {
  "use strict";
  var seen = [];
  function unserialize(json, constructor) {
    if (typeof json === "number" && json >= 0) {
      return seen[json];
    } else if (typeof json === "object") {
      return seen[+(json["#"])] = constructor.unserialize(json, unserialize);
    } else {
      throw new Error("Don't know how to unserialize from a " + typeof json);
    }
  }
  return unserialize(json, constructor);
}

function Cell(label, initialValue) {
  "use strict";

  var value = initialValue;

  var notifier = new Notifier(label);
  var notify = notifier.notify;
  
  function get() {
    return value;
  }
  function set(newV) {
    value = newV;
    notify("changed", newV);
  }

  this.get = get;
  this.set = set;
  this.listen = notifier.listen;
}
// Returns a function to trigger the function now.
Cell.prototype.whenChanged = function (func) {
  this.listen({
    changed: func,
  });
  var self = this;
  return function () { func(self.get()); };
};
Cell.prototype.nowAndWhenChanged = function (func) {
  this.whenChanged(func)();
};

function PersistentCell(storageName, type, defaultValue) {
  "use strict";
  Cell.call(this, storageName, defaultValue);
  
  this.type = type;
  var bareSet = this.set;
  this.set = function (newV) {
    bareSet(newV);
    localStorage.setItem(storageName, JSON.stringify(newV));
  }
  this.setToDefault = function () { this.set(defaultValue); };
  
  var valueString = localStorage.getItem(storageName);
  if (valueString !== null) {
    var value;
    try {
      value = JSON.parse(valueString);
    } catch (e) {
      if (typeof console !== "undefined")
        console.error("Failed to parse stored value " + storageName + ":", e);
    }
    if (typeof value !== type) {
      if (typeof console !== "undefined")
        console.error("Stored value " + storageName + " not a " + type + ":", value);
    }
    this.set(value); // canonicalize/overwrite
  }
}
PersistentCell.prototype = Object.create(Cell.prototype);
PersistentCell.prototype.bindControl = function (id) {
  var elem = document.getElementById(id);
  var self = this;
  
  var listener;
  switch (elem.type == "text" ? "T"+self.type : "E"+elem.type) {
    case "Echeckbox":
      listener = function(value) {
        elem.checked = value;
        return true;
      }
      elem.onchange = function () {
        self.set(elem.checked);
        return true;
      };
      break;
    case "Erange":
      listener = function(value) {
        elem.value = value;
        return true;
      };
      elem.onchange = function () {
        self.set(parseFloat(elem.value));
        return true;
      };
      break;
    case "Tstring":
    case "Eselect-one":
      listener = function(value) {
        elem.value = value;
        return true;
      };
      elem.onchange = function () {
        self.set(elem.value);
        return true;
      };
      break;
    case "Enumber":
    case "Tnumber":
      listener = function(value) {
        elem.value = value;
        return true;
      };
      elem.onchange = function () {
        // TODO: Should be parseFloat iff the step is not an integer
        self.set(parseInt(elem.value, 10));
        return true;
      };
      break;
    default:
      console.warn("Insufficient information to bind control", id, "(input type ", elem.type, ", value type", self.type, ")");
      listener = function(value) {
        elem.value = value;
        return true;
      };
      elem.disabled = true;
  }

  this.listen({
    changed: listener
  });
  listener(this.get());
};

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

function prepareShader(gl, type, text, declarations) {
  // See note in license statement at the top of this file.  
  "use strict";
  
  var prelude = "";
  for (var prop in declarations) {
    var value = declarations[prop];
    prelude += "#define " + prop + " (" + value + ")\n";
  }
  if (prelude !== "") {
    text = prelude + "#line 1\n" + text;
  }
  
  var shader = gl.createShader(type);
  
  gl.shaderSource(shader, text);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (typeof console !== "undefined") console.log("Shader text:\n" + text);
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

  rootElem.className += " progress-bar";
  var fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  rootElem.appendChild(fill);
  
  this.set = function (value) {
    rootElem.style.display = value < 1 && value > 0 ? "block" : "none";
    fill.style.width = value * 100 + "%";
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
