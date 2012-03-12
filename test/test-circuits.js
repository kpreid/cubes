// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Circuit", function() {
  
  var TS = 16;
  var blockset, ls, world;
  beforeEach(function () {
    // TODO: This code is duplicative of generateWorlds.
    if (!blockset) {
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
    }
    
    // world
    world = new World([9, 9, 9], blockset);
  });

  // For looking at the test case in-game for debugging.
  function dumpWorld(name) {
    var pool = new PersistencePool(localStorage, "cubes.object.");
    if (pool.has(name)) pool.get(name).persistence.ephemeralize();
    world.persistence.persist(pool, name);
    pool.flushNow();
  }
  
  var center = [5, 5, 5];
  
  // Utilities for setting up test cases
  function putBlockUnderTest(id, subdatum) {
    world.s(center[0],center[1],center[2], id, subdatum);
  }
  function putNeighbor(offset, id, subdatum) {
    world.s(center[0]+offset[0],
            center[1]+offset[1],
            center[2]+offset[2],
            id, subdatum);
  }
  function putInput(offset, value) {
    if (typeof value !== "number" || value < 0 || value >= 256) {
      throw new Error("Can't yet define a test input value of " + value);
    }
    putNeighbor(offset, ls.emitConstant, value);
  }
  function putOutput(offset) {
    putNeighbor(offset, ls.indicator);
  }
  function readOutput(offset) {
    return world.getCircuit(center).getBlockOutput(center, offset);
  }
  
  //////////////////////////////////////////////////////////////////////

  it("should indicate 0", function () {
    putBlockUnderTest(ls.indicator);
    putInput(UNIT_NX, 0);
    expect(world.gRot(center[0],center[1],center[2])).toEqual(CubeRotation.identity.code);
  });

  it("should indicate 1", function () {
    putBlockUnderTest(ls.indicator);
    putInput(UNIT_NX, 2); // any value other than 1 should give the same result
    expect(world.gRot(center[0],center[1],center[2])).toEqual(CubeRotation.z180.code);
  });

  it("should reevaluate on subdata updates", function () {
    putBlockUnderTest(ls.junction);
    putInput(UNIT_NX, 0);
    putOutput(UNIT_PX);
    expect(readOutput(UNIT_PX)).toEqual(0);
    putInput(UNIT_NX, 1);
    expect(readOutput(UNIT_PX)).toEqual(1);
  });

  it("should have connectivity according to rotations", function () {
    // unrotated gate
    putBlockUnderTest(ls.gate, CubeRotation.identity.code);
    putInput(UNIT_NX, 2); // connected emitter
    putInput(UNIT_NZ, 3); // unconnected emitter
    putOutput(UNIT_PZ, ls.indicator); // connected indicator
    putOutput(UNIT_PX, ls.indicator); // unconnected indicator
    expect(readOutput(UNIT_PX)).toEqual(2);
    expect(readOutput(UNIT_PZ)).toBeFalsy();
    
    // rotated case
    putBlockUnderTest(ls.gate, CubeRotation.y270.code);
    expect(readOutput(UNIT_PX)).toBeFalsy();
    expect(readOutput(UNIT_PZ)).toEqual(3);

    //dumpWorld("rotation test");
  });
});