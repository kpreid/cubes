// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Main", function() {
  "use strict";
  
  var Blockset = cubes.Blockset;
  var Main = cubes.Main;
  var World = cubes.World;
  
  var main, done, parts;
  
  function stubElem() { 
    return document.createElement("div");
  }
  
  function doCreate(spec) {
    // We are using sessionStorage as a temporary Storage object for testing.
    sessionStorage.clear();

    main = new Main(TEST_URL_ROOT, 1/60, sessionStorage);
  }
  
  function doStart(spec) {
    parts = {
      // TODO: Reduce the amount of this boilerplate needed.
      viewCanvas: document.createElement("canvas"),
      sceneInfoOverlay: stubElem(),
      worldOverlays: stubElem(),
      loadError: [stubElem(), stubElem()]
    };

    // Make canvas visible
    parts.viewCanvas.style.width = "320px";
    parts.viewCanvas.style.height = "240px";
    var container = document.createElement("div");
    container.style.margin = "3px";
    container.style.background = "#EEE";
    container.style.border = "1px solid gray";
    container.style.display = "inline-block";
    container.style.width = "320px";
    var label = document.createElement("div");
    label.innerText = "View of: " + spec.getFullName();
    container.appendChild(label);
    container.appendChild(parts.viewCanvas);
    document.body.appendChild(container);
    
    done = undefined;
    
    { // Configure for testing purposes
      var config = main.config;
      
      // Disable sound during tests
      config.sound.set(false);
      
      // Use a small world to speed up tests. (This figure is currently arbitrary.)
      config.generate_wx.set(10);
      config.generate_wy.set(10);
      config.generate_wz.set(10);
    }
    
    main.start(parts, function (optError) {
      done = [optError];
    });
    
    waitsFor(function () { return !!done; }, 10000);    
  }
  
  it("should startup successfully", function() {
    doCreate(this);
    doStart(this);
    runs(function () {
      expect(done).toEqual([null]);
      expect(parts.loadError[1].textContent).toEqual("");      
    });
  });
  
  it("should support world regeneration", function () {
    doCreate(this);
    doStart(this);
    runs(function () {
      var oldWorld = main.getTopWorld();
      main.config.generate_name.set("foofoo");
      main.regenerate();
      expect(main.getTopWorld()).not.toBe(oldWorld);
    });
  });
  
  it("should accept an initial world", function () {
    doCreate(this);
    var world = new World([3, 3, 3], new Blockset([]));
    main.setTopWorld(world);
    doStart(this);
    runs(function () {
      expect(main.getTopWorld()).toBe(world);
    });
  });
});
