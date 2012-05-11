// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("CubesMain", function() {
  var main, done, parts;
  
  function stubElem() { 
    return document.createElement("div");
  }
  
  beforeEach(function () {
    // We are using sessionStorage as a temporary Storage object for testing.
    sessionStorage.clear();

    parts = {
      // TODO: Reduce the amount of this boilerplate needed.
      viewCanvas: document.createElement("canvas"),
      sceneInfoOverlay: stubElem(),
      cursorInfoOverlay: stubElem(),
      loadError: [stubElem(), stubElem()]
    };

    // Make canvas visible
    parts.viewCanvas.width = 320;
    parts.viewCanvas.height = 240;
    var container = document.createElement("div");
    container.style.margin = "3px";
    container.style.background = "#EEE";
    container.style.border = "1px solid gray";
    container.style.display = "inline-block";
    container.style.width = "320px";
    var label = document.createElement("div");
    label.innerText = "View of: " + this.getFullName();
    container.appendChild(label);
    container.appendChild(parts.viewCanvas);
    document.body.appendChild(container);
    
    main = new CubesMain(TEST_URL_ROOT, 1/60, sessionStorage);
    done = undefined;
    
    { // Configure for testing purposes
      var config = main.config;
      
      // Disable sound during tests
      config.sound.set(false);
      
      // Use a small world to speed up tests. (This figure is currently arbitrary.)
      config.generate_wx.set(40);
      config.generate_wy.set(40);
      config.generate_wz.set(40);
    }
    
    main.start(parts, function (optError) {
      done = [optError];
    });
    
    waitsFor(function () { return !!done; }, 10000);    
  });
  
  it("should startup successfully", function() {
    expect(done).toEqual([null]);
    expect(parts.loadError[1].textContent).toEqual("");
  });
  
  it("should support world regeneration", function () {
    var oldWorld = main.getTopWorld();
    main.config.generate_name.set("foofoo");
    main.regenerate();
    expect(main.getTopWorld()).not.toBe(oldWorld);
  });
});