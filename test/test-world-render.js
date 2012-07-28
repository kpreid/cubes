// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("WorldRenderer", function() {
  "use strict";
  
  var Blockset = cubes.Blockset;
  var Config = cubes.Config;
  var Renderer = cubes.Renderer;
  var World = cubes.World;
  var WorldRenderer = cubes.WorldRenderer;
  
  var shaders, renderer, world, wrend;
  
  function scheduleDraw() {}
  function getViewPosition() { return [1, 1, 1]; }
  
  beforeEach(function () {
    sessionStorage.clear();
    var canvas = document.createElement("canvas");
    var config = new Config(sessionStorage, "cubes-test-dummy.option.");
    Renderer.fetchShaders("../", function (s) {
      if (s === null) throw new Error("shader download failed");
      shaders = s;
    });
    
    waitsFor(function () { return !!shaders; });
    
    runs(function () {
      renderer = new Renderer(config, canvas, shaders, scheduleDraw);

      world = new World([1,1,1], new Blockset([]));
      wrend = new WorldRenderer(world, getViewPosition, renderer, null, scheduleDraw, true);
    })
  });
  
  it("handles particles outside the world", function () {
    // Bug test: this would crash
    world.transientEvent([-1, 0, 0], "create");
  })
});
