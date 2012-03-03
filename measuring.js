// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var measuring = (function () {
  "use strict";
  var measuring = {};
  
  function ViewGroup(elements) {
    this.elements = elements;
  }
  ViewGroup.prototype.createDisplay = function (document) {
    var list = document.createElement("ul");
    var updaters = [];
    this.elements.forEach(function (thing) {
      var elem = document.createElement("li");
      list.appendChild(elem);
      var subdisplay = thing.createDisplay(document);
      elem.appendChild(subdisplay.element);
      updaters.push(subdisplay.update);
    });
    return {
      element: list,
      update: function () {
        updaters.forEach(function (f) { f(); });
      }
    }
  }
  
  function Quantity(label) {
    this.label = label;
  }
  Quantity.prototype.createDisplay = function (document) {
    var container = document.createElement("pre");
    var valueText = document.createTextNode("");
    container.appendChild(document.createTextNode(this.label + ": "));
    container.appendChild(valueText);
    return {
      element: container,
      update: function () {
        valueText.data = String(this.get());
      }.bind(this)
    };
  }
  
  function Timer(label) {
    Quantity.call(this, label);
    
    var t0 = null, value = null;
    this.start = function () {
      t0 = Date.now();
    };
    this.end = function () {
      var t1 = Date.now();
      value = t1 - t0;
    };
    this.get = function () {
      return value;
    };
  }
  Timer.prototype = Object.create(Quantity.prototype);
  
  measuring.sim = new Timer("Simulation time");
  measuring.chunk = new Timer("Chunk calc time");
  measuring.frame = new Timer("Frame time");
  
  measuring.all = new ViewGroup([
    measuring.sim,
    measuring.chunk,
    measuring.frame
  ]);
  
  return measuring;
}());