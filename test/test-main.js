// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("CubesMain", function() {
  beforeEach(function () {
    // We are using sessionStorage as a temporary Storage object for testing.
    sessionStorage.clear();
  });
  
  function stubElem() { 
    return document.createElement("div");
  }

  var parts = {
    // TODO: Reduce the amount of this boilerplate needed.
    viewCanvas: document.createElement("canvas"),
    menu: stubElem(),
    sceneInfoOverlay: stubElem(),
    cursorInfoOverlay: stubElem(),
    loadError: [stubElem(), stubElem()]
  };

  var main, done;
  it("should be instantiable", function () {
    main = new CubesMain(1/60, sessionStorage);

    main.start(parts, function (optError) {
      done = [optError];
    });
  });

  waitsFor(function () { return !!done; }, 10000);    
  
  it("should startup successfully", function() {
    // successful startup
    runs(function () {
      expect(done).toEqual([null]);
      expect(parts.loadError[1].textContent).toEqual("");
    });
  });
});