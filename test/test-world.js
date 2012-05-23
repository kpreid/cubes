// Copyright 2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("World", function() {
  it("should terminate an infinite raycast", function () {
    var world = new World([1, 1000, 1000], new Blockset([]));
    var t0 = Date.now();
    world.raycast([-10, 0.5, 0.5], [20, 0.5000001, 0.5000001], Infinity, function () {});
    var t1 = Date.now();
    expect(t1 - t0).toBeLessThan(500); // arbitrary cutoff just to make sure someone doesn't *assume* this test should be really slow
  });
});
