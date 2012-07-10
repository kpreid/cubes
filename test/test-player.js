// Copyright 2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Player", function() {
  "use strict";
  
  var Blockset = cubes.Blockset;
  var BlockType = cubes.BlockType;
  var Config = cubes.Config;
  var Player = cubes.Player;
  var Renderer = cubes.Renderer;
  var World = cubes.World;
  
  var player, world;
  
  // TODO reduce the need for stubs
  function StubRenderer(config) {
    this.RenderBundle = function () {};
    this.RenderBundle.prototype.recompute = function () {};
    this.aabRenderer = function () { return new this.RenderBundle() };
    this.BlockParticles = function () {};
    this.context = {};
    this.config = config;
    this.getAimRay = function () {
      return {origin: [0,.5,.5], direction: [1,0,0]};
    };
  }
  function stubScheduleDraw() {}
  var stubAudio = {
    setListener: function () {},
    play: function () {}
  };
  var stubObjectUI = {
    ObjectChip: function () {}
  };
  stubObjectUI.ObjectChip.prototype.bindByObject = function () {};
  stubObjectUI.ObjectChip.prototype.element = document.createElement("span");
  
  beforeEach(function () {
    sessionStorage.clear();
    var canvas = document.createElement("canvas");
    var config = new Config(sessionStorage, "cubes-test-dummy.option.");
    var renderer = new StubRenderer(config);

    world = new World([2, 1, 1], new Blockset([new BlockType([1, 1, 1, 1])]))

    player = new Player(config, world, renderer, stubAudio, stubScheduleDraw, stubObjectUI);
  });
  
  it("should add blocks", function () {
    world.s(1, 0, 0, 1);
    
    player.input.mousePos = [1, 1] /* dummy value */;
    
    player.input.tool = 1;
    player.input.useTool();
    expect(world.g(0, 0, 0)).toBe(1);
  });
  
  // TODO more tests
});
