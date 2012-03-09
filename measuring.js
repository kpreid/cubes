// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var measuring = (function () {
  "use strict";
  var measuring = {};
  
  function numberWithCommas(x) {
    // source: http://stackoverflow.com/a/2901298/99692
    return (+x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  
  // Tests whether an element may be visible to the user.
  function elementIsVisible(element) {
    // Note: The offsetWidth test tests for display:none; it does not test for obscuration.
    return element.offsetWidth > 0;
  }
  
  function ViewGroup(label, elements) {
    this.label = label;
    this.elements = elements;
  }
  ViewGroup.prototype.createDisplay = function (document, stateContext) {
    var subContext = stateContext + "." + this.label;
    var container = document.createElement("div");
    container.className = "measuring-item measuring-group";
    var list = document.createElement("ul");
    list.className = "measuring-group-contents";
    if (this.label) {
      var header = document.createElement("div");
      header.className = "measuring-group-header";
      var toggleState = new PersistentCell(localStorage, subContext + ".visible", "boolean", true);
      var toggler = document.createElement("a");
      toggleState.nowAndWhenChanged(function (v) {
        if (v) {
          list.style.removeProperty("display");
          toggler.textContent = "[-]";
        } else {
          list.style.display = "none";
          toggler.textContent = "[+]";
        }
        return true;
      });
      toggler.addEventListener("click", function () {
        toggleState.set(!toggleState.get());
        return false;
      }, false);
      header.appendChild(toggler);
      header.appendChild(document.createTextNode(" " + this.label));
      container.appendChild(header);
    }
    container.appendChild(list);
    var updaters = [];
    this.elements.forEach(function (thing) {
      var elem = document.createElement("li");
      elem.className = "measuring-group-element";
      list.appendChild(elem);
      var subdisplay = thing.createDisplay(document, subContext);
      elem.appendChild(subdisplay.element);
      updaters.push(subdisplay.update.bind(subdisplay));
    });

    var animFrameWasRequested = false;
    return {
      element: container,
      update: function () {
        if (elementIsVisible(list)) {
          updaters.forEach(function (f) { f(); });
        }
      },
      updateIfVisible: function () {
        if (!animFrameWasRequested) {
          window.requestAnimFrame(function () {
            animFrameWasRequested = false;
            this.update();
          }.bind(this), container);
          animFrameWasRequested = true;
        }
      }
    };
  }
  ViewGroup.prototype.start = function () {
    this.elements.forEach(function (e) { e.start(); });
  };
  ViewGroup.prototype.end = function () {
    this.elements.forEach(function (e) { e.end(); });
  };
  
  function Quantity(label) {
    this.label = label;
    this.value = null;
    this.history = new Float32Array(100); // TODO magic number
    this.historyIndex = 0;
  }
  Quantity.prototype.createDisplay = function (document, stateContext) {
    var container = document.createElement("div");
    container.className = "measuring-item measuring-quantity";
    var labelElem = document.createElement("span");
    labelElem.className = "measuring-label";
    labelElem.textContent = this.label + ": ";
    var valueElem = document.createElement("span");
    valueElem.className = "measuring-value";
    var valueText = document.createTextNode("");
    valueElem.appendChild(valueText);
    
    // sparkline
    var sparkCanvas = document.createElement("canvas");
    sparkCanvas.className = "measuring-sparkline";
    var sparkLength = sparkCanvas.width  = this.history.length;
    var sparkHeight = sparkCanvas.height = 9; // TODO magic number
    var sparkContext = sparkCanvas.getContext("2d");
    var lastUpdateIndex = 0;

    container.appendChild(labelElem);
    container.appendChild(valueElem);
    container.appendChild(sparkCanvas);

    var fillColor = "rgba(127,127,127,0.5)";
    
    return {
      element: container,
      update: function () {
        valueText.data = String(this.show());
        
        var indexOffset = this.historyIndex;
        if (elementIsVisible(sparkCanvas)
            && lastUpdateIndex !== indexOffset /* there is new data */) {
          lastUpdateIndex = indexOffset;

          var history = this.history;
          var fgColor = window.getComputedStyle(sparkCanvas, null).color;
          
          sparkContext.clearRect(0, 0, sparkLength, sparkHeight);

          // Find maximum and minimum of graph
          var miny = 0 /* Infinity */; // assume 0 is a meaningful minimum
          var maxy = -Infinity;
          for (var i = sparkLength - 1; i >= 0; i--) {
            var y = history[i];
            miny = Math.min(y, miny);
            maxy = Math.max(y, maxy);
          }
          
          // Establish viewport of graph. The maximum zoom is 1 value unit = 1px.
          var viewScale = -Math.min(1, (sparkHeight - 1)/(maxy - miny));
          var viewOffset = -miny * viewScale + sparkHeight - 1;

          // Draw graph: first background fill, then line
          sparkContext.fillStyle = fillColor;
          for (var i = sparkLength - 1; i >= 0; i--) {
            var scaley = history[(i + indexOffset) % sparkLength] * viewScale + viewOffset;
            sparkContext.fillRect(i, scaley, 1, sparkHeight);
          }
          sparkContext.fillStyle = fgColor;
          for (var i = sparkLength - 1; i >= 0; i--) {
            var scaley = history[(i + indexOffset) % sparkLength] * viewScale + viewOffset;
            sparkContext.fillRect(i, scaley, 1, 1);
          }
        }
      }.bind(this)
    };
  }
  Quantity.prototype.start = function () {};
  Quantity.prototype.end = function () {
    var hi = this.historyIndex;
    this.history[hi] = this.value;
    this.historyIndex = mod(hi + 1, this.history.length);
  };
  
  
  function Timer(label) {
    Quantity.call(this, label);
    var souper = Object.getPrototypeOf(this);
    
    var t0 = null;
    this.start = function () {
      t0 = Date.now();
      souper.start.call(this);
    };
    this.end = function () {
      var t1 = Date.now();
      this.value = t1 - t0;
      souper.end.call(this);
    };
  }
  Timer.prototype = Object.create(Quantity.prototype);
  Timer.prototype.show = function () {
    return this.value + " ms";
  };
  
  function Counter(label) {
    Quantity.call(this, label);
    var souper = Object.getPrototypeOf(this);
    
    var counter = 0;
    this.inc = function (amount) {
      if (amount === undefined) amount = 1;
      counter += amount;
    };
    this.start = function () {
      counter = 0;
      souper.start.call(this);
    };
    this.end = function () {
      this.value = counter;
      souper.end.call(this);
    };
  }
  Counter.prototype = Object.create(Quantity.prototype);
  Counter.prototype.show = function () {
    return numberWithCommas(this.value);
  };
  
  function TaskGroup(label, elements) {
    var timer = new Timer("Time");
    ViewGroup.call(this, label, [timer].concat(elements));
    
    this.start = function () {
      timer.start();
      Object.getPrototypeOf(this).start.call(this);
    };
    this.end = function () {
      timer.end();
      Object.getPrototypeOf(this).end.call(this);
    };
  }
  TaskGroup.prototype = Object.create(ViewGroup.prototype);
  
  measuring.all = new ViewGroup("Performance", [
    measuring.second = new ViewGroup("Per second", [
      measuring.simCount = new Counter("Steps"),
      measuring.frameCount = new Counter("Frames"),
      measuring.chunkCount = new Counter("Chunk calcs"),
    ]),
    measuring.sim = new TaskGroup("Simulation", [
      measuring.collisionTests = new Counter("Collision tests")
    ]),
    measuring.chunk = new TaskGroup("Chunk calc", []),
    measuring.frame = new TaskGroup("Frame", [
      measuring.vertices = new Counter("Vertices")
    ])
  ]);
  
  return measuring;
}());