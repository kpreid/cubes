describe("CubesMain", function() {
  sessionStorage.clear();
  
  function stubElem() { 
    return document.createElement("div");
  }
  
  it("should be instantiable", function() {
    var main = new CubesMain(1/60, sessionStorage);
    
    var parts = {
      // TODO: Reduce the amount of this boilerplate needed.
      viewCanvas: document.createElement("canvas"),
      menu: stubElem(),
      sceneInfoOverlay: stubElem(),
      cursorInfoOverlay: stubElem(),
      loadError: [stubElem(), stubElem()]
    };
    
    var done;
    main.start(parts, function (optError) {
      done = [optError];
    });
    waitsFor(function () { return !!done; }, 10000);    
    
    // successful startup
    runs(function () {
      expect(done).toEqual([null]);
      expect(parts.loadError[1].textContent).toEqual("");
    });
  });
});