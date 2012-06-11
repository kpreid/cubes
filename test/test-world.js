// Copyright 2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("World", function() {
  var Blockset = cubes.Blockset;
  var BlockType = cubes.BlockType;
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
});
