// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

// This file contains implementation of persistent storage.

var SERIAL_TYPE_NAME = "()"; // TODO local variable

function cyclicSerialize(root, unserializers) {
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
  serialize.setUnserializer = function (json, constructor) {
    for (var k in unserializers) {
      if (unserializers[k] === constructor
          && Object.prototype.hasOwnProperty.call(unserializers, k)) {
        json[SERIAL_TYPE_NAME] = k;
        return;
      }
    }
    throw new Error("Don't know how to serialize the constructor " + constructor);
  };
  return serialize(root);
}

function cyclicUnserialize(json, unserializers) {
  "use strict";
  var seen = [];

  function findConstructor(json) {
    var typename = json[SERIAL_TYPE_NAME];
    if (Object.prototype.hasOwnProperty.call(unserializers, typename))
      return unserializers[typename];
    throw new Error("Don't know how to unserialize type name: " + typename);
  }

  function unserialize(json) {
    if (typeof json === "number" && json >= 0) {
      return seen[json];
    } else if (typeof json === "object") {
      return seen[+(json["#"])] = findConstructor(json).unserialize(json, unserialize);
    } else {
      throw new Error("Don't know how to unserialize from a " + typeof json);
    }
  }
  return unserialize(json);
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
  this.readOnly = Object.create(Cell.prototype);
  this.readOnly.get = get;
  this.readOnly.listen = notifier.listen;
  Object.freeze(this.readOnly);
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

var Persister = (function () {
  // constants
  var hop = Object.prototype.hasOwnProperty;
  var objectPrefix = "cubes.object."; // TODO not hardcoded
  
  // global state
  var currentlyLiveObjects = {};
  var dirtyQueue = new DirtyQueue();
  var notifier = new Notifier();
  
  var status = new Cell("Persister.status", 0);
  function updateStatus() {
    status.set(dirtyQueue.size());
  }
  
  function handleDirty(name) {
    if (hop.call(currentlyLiveObjects, name)) {
      currentlyLiveObjects[name].persistence.commit(); // TODO: spoofable (safely)
    }
  }
  
  function Persister(object) {
    var persister = this;
    var name = null;
    var dirty = false;
    
    this._registerName = function (newName) { // TODO internal
      if (!Persister.available) {
        throw new Error("localStorage not supported by this browser; persistence not available");
      }
      if (name === newName) {
        return;
      }
      if (name !== null) {
        throw new Error("This object already has the name " + name);
      }
      name = newName;
      currentlyLiveObjects[name] = object;
      console.log("Persister: persisted", name, ":", object);
    };
    this.persist = function (newName) {
      persister._registerName(newName);
      persister.dirty();
      persister.commit(); // TODO all we really need to do here is ensure that it appears in the forEach list; this is just a kludge for that.
      notifier.notify("added", name);
    };
    this.ephemeralize = function () {
      if (name) {
        console.log("Persister: ephemeralized", name);
        localStorage.removeItem(objectPrefix + name);
        delete currentlyLiveObjects[name];
        name = null;
        notifier.notify("deleted", name);
      }
    }
    this.dirty = function () {
      if (name) {
        console.log("Persister: dirtied", name);
        dirty = true;
        dirtyQueue.enqueue(name);
        updateStatus();
      }
    };
    this.commit = function () {
      if (name === null) return;
      if (!dirty) {
        console.log("Persister: not writing clean", name);
        return;
      } else {
        console.log("Persister: writing dirty", name);
        localStorage.setItem(
          // TODO prefix should be configurable
          objectPrefix + name,
          JSON.stringify(cyclicSerialize(object, Persister.types)));
        dirty = false;
      }
    };
  }
  Persister.flushAsync = function () {
    function loop() {
      var name = dirtyQueue.dequeue();
      if (name !== null) {
        handleDirty(name);
        setTimeout(loop, 0);
      }
      updateStatus();
    }
    setTimeout(loop, 0);
  };
  Persister.flushNow = function () {
    var name;
    while ((name = dirtyQueue.dequeue()) !== null) {
      handleDirty(name);
    }
    updateStatus();
  };
  Persister.get = function (name) {
    // TODO: Don't multiply instantiate the same object
    if (hop.call(currentlyLiveObjects, name)) {
      console.log("Persister: already live", name);
      return currentlyLiveObjects[name];
    }
    var data = localStorage.getItem(objectPrefix + name);
    if (data === null) {
      console.log("Persister: no object for", name);
      return null;
    } else {
      console.log("Persister: retrieving", name);
      var object = cyclicUnserialize(JSON.parse(data), Persister.types);
      object.persistence._registerName(name);
      return object;
    }
  };
  Persister.forEach = function (f) {
    // TODO Instead of this expensive unserialize-and-inspect, examine the db on startup and cache
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var key = localStorage.key(i);
      if (key.length >= objectPrefix.length && key.substring(0, objectPrefix.length) == objectPrefix) {
        f(key.substring(objectPrefix.length),
          Persister.types[JSON.parse(localStorage.getItem(key))[SERIAL_TYPE_NAME]]);
      }
    }
  };
  Persister.listen = notifier.listen;
  Persister.available = typeof localStorage !== "undefined";
  Persister.types = []; // TODO global mutable state
  Persister.status = status.readOnly;

  return Object.freeze(Persister);
})();