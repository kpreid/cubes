// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

// This file contains implementation of persistent storage.

var SERIAL_TYPE_NAME = "()"; // TODO local variable

function cyclicSerialize(root, typeNameFunc, getName) {
  "use strict";
  if (!getName) getName = function () { return null; };
  var seen = [];
  function serialize(obj) {
    // named objects
    var name = getName(obj);
    if (typeof name === "string") {
      return name;
    }
    
    // break cycles
    var i;
    for (i = 0; i < seen.length; i++) {
      if (seen[i] === obj) // TODO use WeakMap if available
        return i;
    }
    
    // regular serialization
    seen.push(obj);
    var json = obj.serialize(serialize);
    json["#"] = i;
    return json;
  }
  serialize.setUnserializer = function (json, constructor) {
    var name = typeNameFunc(constructor);
    if (name !== null) {
      json[SERIAL_TYPE_NAME] = name;
    } else {
      throw new Error("Don't know how to serialize the constructor " + constructor);
    }
  };
  return serialize(root);
}

function cyclicUnserialize(json, unserializers, lookupName) {
  "use strict";
  if (!lookupName) lookupName = function () { throw new Error("got name w/ no lookup function"); };
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
    } else if (typeof json === "string") {
      return lookupName(json);
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
  var interest = true;
  this.listen({
    interest: function () { return interest; },
    changed: function () { interest = func.apply(null, arguments); }
  });
  var self = this;
  return function () { interest = func(self.get()); };
};
Cell.prototype.nowAndWhenChanged = function (func) {
  this.whenChanged(func)();
};

function PersistentCell(storage, storageName, type, defaultValue) {
  "use strict";
  Cell.call(this, storageName, defaultValue);
  
  this.type = type;
  var bareSet = this.set;
  this.set = function (newV) {
    bareSet(newV);
    storage.setItem(storageName, JSON.stringify(newV));
  }
  this.setToDefault = function () { this.set(defaultValue); };
  
  var valueString = storage.getItem(storageName);
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
      }
      elem.onchange = function () {
        self.set(elem.checked);
        return true;
      };
      break;
    case "Erange":
      listener = function(value) {
        elem.value = value;
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
      };
      elem.disabled = true;
  }

  this.listen({
    interest: function () { return true; },
    changed: listener
  });
  listener(this.get());
};

function PersistencePool(storage, objectPrefix) {
  "use strict";
  var pool = this;
  
  // constants
  var hop = Object.prototype.hasOwnProperty;
  
  // global state
  var currentlyLiveObjects = {};
  var dirtyQueue = new DirtyQueue();
  var notifier = new Notifier();
  
  var status = new Cell("PersistencePool("+objectPrefix+").status", 0);
  function updateStatus() {
    status.set(dirtyQueue.size());
  }
  
  function handleDirty(name) {
    if (hop.call(currentlyLiveObjects, name)) {
      currentlyLiveObjects[name].persistence.commit(); // TODO: spoofable (harmlessly)
    }
  }
  
  function register(object, name) {
    object.persistence._registerName(pool, name);
    currentlyLiveObjects[name] = object;
  }
  
  this.flushAsync = function () {
    var currentlyDirty = [];
    var n = dirtyQueue.size();
    function loop() {
      if (n-- <= 0) return; // avoid inf loop if things are constantly dirty
      var name = dirtyQueue.dequeue();
      if (name !== null) {
        handleDirty(name);
        setTimeout(loop, 0);
      }
      updateStatus();
    }
    setTimeout(loop, 0);
  };
  this.flushNow = function () {
    var name;
    while ((name = dirtyQueue.dequeue()) !== null) {
      handleDirty(name);
    }
    updateStatus();
  };
  this.get = function (name) {
    if (hop.call(currentlyLiveObjects, name)) {
      console.log("Persister: already live", name);
      return currentlyLiveObjects[name];
    }
    var data = storage.getItem(objectPrefix + name);
    if (data === null) {
      console.log("Persister: no object for", name);
      return null;
    } else {
      console.log("Persister: retrieving", name);
      var object = cyclicUnserialize(JSON.parse(data), Persister.types, function (name) {
        var obj = pool.get(name);
        if (obj) {
          return obj;
        } else {
          throw new Error("Serialized object contained reference to missing object: " + name);
        }
      });
      register(object, name);
      return object;
    }
  };
  this.getIfLive = function (name) {
    return hop.call(currentlyLiveObjects, name) ? currentlyLiveObjects[name] : null;
  };
  this.getSize = function (name) {
    return storage.getItem(objectPrefix + name).length;
  };
  this.has = function (name) {
    return this.available &&
        (hop.call(currentlyLiveObjects, name) || storage.getItem(objectPrefix + name) !== null);
  };
  this.forEach = function (f) {
    // TODO Instead of this expensive unserialize-and-inspect, examine the db on startup and cache
    for (var i = storage.length - 1; i >= 0; i--) {
      var key = storage.key(i);
      if (key.length >= objectPrefix.length && key.substring(0, objectPrefix.length) == objectPrefix) {
        f(key.substring(objectPrefix.length),
          Persister.types[JSON.parse(storage.getItem(key))[SERIAL_TYPE_NAME]]);
      }
    }
  };
  this.persist = function (object, name) {
    if (pool.has(name)) {
      throw new Error("The name " + newName + " is already in use.");
    }
    if (!pool.available) {
      throw new Error("localStorage not supported by this browser; persistence not available");
    }
    if (object.persistence.getName() === name) {
      return;
    }
    if (object.persistence.getName() !== null) {
      throw new Error("This object already has the name " + name);
    }
    register(object, name);
    // TODO should take the persister, not the object, so we aren't assuming .persistence is correct
    object.persistence.dirty();
    object.persistence.commit(); // TODO all we really need to do here is ensure that it appears in the forEach list; this is just a kludge for that.
    notifier.notify("added", name);
    console.log("Persister: persisted", name);
  };
  this._write = function (name, data) { // TODO internal
    storage.setItem(objectPrefix + name, data);
  };
  this._ephemeralize = function (name) { // TODO internal
    console.log("Persister: ephemeralized", name);
    storage.removeItem(objectPrefix + name);
    delete currentlyLiveObjects[name];
    name = null;
    notifier.notify("deleted", name);
  };
  this._dirty = function (name) {
    dirtyQueue.enqueue(name);
    updateStatus();
  }
  this.listen = notifier.listen;
  this.available = !!storage;
  this.status = status.readOnly;

  Object.freeze(this);
}

// TODO: Refactor Persister and PersistencePool so that they don't need to call back and forth so much. .persist should probably go on the pool.

function Persister(object) {
  "use strict";
  
  var persister = this;
  var pool = null;
  var name = null;
  var dirty = false;
  
  function getObjName(obj) {
    // TODO confirm that these are in the same pool.
    if (obj && obj !== object && obj && obj.persistence && obj.persistence.getName() !== null) {
      return obj.persistence.getName();
    }
  }
  
  this._registerName = function (newPool, newName) { // TODO internal, should not be published
    pool = newPool;
    name = newName;
  };
  this.getName = function () { return name; };
  this.ephemeralize = function () {
    if (name) {
      pool._ephemeralize(name);
      name = null;
      pool = null;
    }
  }
  this.dirty = function () {
    if (name !== null && !dirty) {
      console.log("Persister: dirtied", name);
      dirty = true;
      pool._dirty(name);
    }
  };
  this.commit = function () {
    if (name === null) return;
    if (!dirty) {
      console.log("Persister: not writing clean", name);
      return;
    } else {
      console.log("Persister: writing dirty", name);
      pool._write(name, JSON.stringify(cyclicSerialize(object, Persister.findType, getObjName)));
      dirty = false;
    }
  };
}
Persister.types = {}; // TODO global mutable state

// TODO kludge
Persister.findType = function (constructor) {
  var ts = Persister.types;
  for (var k in ts) {
    if (ts[k] === constructor
        && Object.prototype.hasOwnProperty.call(ts, k)) {
      return k;
    }
  }
  return null;
};
