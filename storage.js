// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

// This file contains implementation of persistent storage.

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

