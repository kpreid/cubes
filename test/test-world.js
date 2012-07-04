// Copyright 2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("World", function() {
  var Blockset = cubes.Blockset;
  var BlockType = cubes.BlockType;
  var Body = cubes.Body;
  var Player = cubes.Player;
  var World = cubes.World;

  it("should terminate an infinite raycast", function () {
    var world = new World([1, 1000, 1000], new Blockset([]));
    var t0 = Date.now();
    world.raycast([-10, 0.5, 0.5], [30, 0.0000001, 0.0000001], Infinity, function () {});
    var t1 = Date.now();
    expect(t1 - t0).toBeLessThan(500); // arbitrary cutoff just to make sure someone doesn't *assume* this test should be really slow
  });

  it("should allow replacing the blockset", function () {
    var b1 = new Blockset([new BlockType([1, 1, 1, 0.5], null)]);
    var b2 = new Blockset([new BlockType([1, 1, 1, 1], null)]);
    var world = new World([1, 1000, 1000], b1);
    world.s(0, 0, 0, 1);
    
    var l = {
      interest: function () { return true; },
      changedBlockset: jasmine.createSpy("changedBlockset")
    }
    world.listen(l);
    
    expect(world.opaque(0,0,0)).toBe(false);
    
    world.blockset = b2;
    
    expect(l.changedBlockset).toHaveBeenCalled();
    expect(world.blockset).toBe(b2);
    expect(world.opaque(0,0,0)).toBe(true);
    // TODO test that it dirties
  });
  
  it("should step the bodies", function () {
    var world = new World([1, 1, 1], new Blockset([]));
    var body = new Body(world, Player.aabb);
    world.addBody(body); // TODO proper add/remove interface
    world.step(1/60);
    expect(body.vel[1]).toBeLessThan(0);
    expect(body.pos[1]).toBeLessThan(0);
  });
});

describe("Selection", function() {
  var AAB = cubes.util.AAB;
  var Selection = cubes.Selection;
  var World = cubes.World;
  var Blockset = cubes.Blockset;

  var world;
  beforeEach(function () {
    world = new World([10, 10, 10], new Blockset([]));
  });
  
  it("should exist", function () {
    var selection = new Selection(world);
  });
  
  it("should select a box", function () {
    var selection = new Selection(world);
    var b = new AAB(1, 3, 5, 7, 9, 11);
    selection.setToAAB(b);
    
    expect(selection.bounds).toEqual(b);
    
    var calls = [
      [1, 5, 9 ],
      [1, 5, 10],
      [1, 6, 9 ],
      [1, 6, 10],
      [2, 5, 9 ],
      [2, 5, 10],
      [2, 6, 9 ],
      [2, 6, 10]
    ];
    selection.forEachCube(function (cube, w) {
      expect(w).toBe(world);
      expect(Array.prototype.slice.call(cube)).toEqual(calls.shift());
    });
    expect(calls.length).toBe(0);
  });
});
