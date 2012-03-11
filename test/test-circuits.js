// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Circuit", function() {
  
  // For looking at the test case in-game for debugging.
  function dumpWorld(world, name) {
    var pool = new PersistencePool(localStorage, "cubes.object.");
    if (pool.has(name)) pool.get(name).persistence.ephemeralize();
    world.persistence.persist(pool, name);
    pool.flushNow();
  }
  
  var TS = 16;
  var blockset, ls;
  beforeEach(function () {
    // TODO: This code is duplicative of generateWorlds.
    if (blockset) return;
    // layer 1
    var pureColors = WorldGen.colorBlocks(4, 4, 4);

    // layer 2
    var baseLogicAndColors = WorldGen.colorBlocks(4, 4, 4);
    WorldGen.addLogicBlocks(TS, baseLogicAndColors, pureColors);

    // layer 3
    blockset = WorldGen.colorBlocks(4, 4, 4);
    WorldGen.addLogicBlocks(TS, blockset, baseLogicAndColors);
    ls = {};
    for (var i = 0; i < blockset.length; i++) {
      ls[(blockset.get(i).name || "").replace(/^logic\./, "")] = i;
    }
  });

  it("should indicate 0", function () {
    var world = new World([4, 4, 4], blockset);
    world.s(1,1,1, ls.emitConstant, 0);
    world.s(1,1,2, ls.indicator);
    expect(world.gRot(1,1,2)).toEqual(0);
  });

  it("should indicate 1", function () {
    var world = new World([4, 4, 4], blockset);
    world.s(1,1,1, ls.emitConstant, 42);
    world.s(1,1,2, ls.indicator);
    expect(world.gRot(1,1,2)).toEqual(1);
  });

  it("should reevaluate on subdata updates", function () {
    var world = new World([4, 4, 4], blockset);
    world.s(1,1,1, ls.emitConstant, 0);
    world.s(1,1,2, ls.indicator);
    expect(world.gRot(1,1,2)).toEqual(0);
    world.s(1,1,1, ls.emitConstant, 42);
    expect(world.gRot(1,1,2)).toEqual(1);
  });

  it("should have connectivity acording to rotations", function () {
    var world = new World([4, 4, 4], blockset);

    // unrotated gate
    world.s(1,1,1, ls.gate, CubeRotation.identity.code);
    world.s(0,1,1, ls.emitConstant, 2); // connected emitter
    world.s(1,1,0, ls.emitConstant, 3); // unconnected emitter
    world.s(1,1,2, ls.indicator); // connected indicator
    world.s(2,1,1, ls.indicator); // unconnected indicator
    expect(world.gRot(2,1,1)).toEqual(1);
    expect(world.gRot(1,1,2)).toEqual(0);
    
    // rotated case
    world.s(1,1,1, ls.gate, CubeRotation.y270.code);
    expect(world.gRot(2,1,1)).toEqual(0);
    expect(world.gRot(1,1,2)).toEqual(1);

    //dumpWorld(world, "rotation test");
  });
});