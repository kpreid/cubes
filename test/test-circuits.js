// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Circuit", function() {
  
  var TS = 16;
  var blockset, ls, t;
  beforeEach(function () {
    // TODO: This code is duplicative of generateWorlds.
    //if (!blockset) {
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
    //}
    
    t = makeTester();
  });
  
  function makeTester() {
    var world = new World([TS, TS, TS], blockset);
    var center = [5, 5, 5];
    
    var self = {
      world: world,
      center: center,

      // For looking at the test case in-game for debugging.
      dumpWorld: function (name) {
        var pool = new PersistencePool(localStorage, "cubes.object.");
        if (pool.has(name)) pool.get(name).persistence.ephemeralize();
        world.persistence.persist(pool, name);
        pool.flushNow();
      },

      putBlockUnderTest: function (id, subdatum) {
        world.s(center[0],center[1],center[2], id, subdatum);
      },
      putNeighbor: function (offset, id, subdatum) {
        world.s(center[0]+offset[0],
                center[1]+offset[1],
                center[2]+offset[2],
                id, subdatum);
      },
      putInput: function (offset, value) {
        if (typeof value !== "number" || value < 0 || value >= 256) {
          throw new Error("Can't yet define a test input value of " + value);
        }
        self.putNeighbor(offset, ls.emitConstant, value);
      },
      putOutput: function (offset) {
        self.putNeighbor(offset, ls.indicator);
      },
      readOutput: function (offset) {
        return world.getCircuit(center).getBlockOutput(center, offset);
      }
    };
    return self;
  }

  
  //////////////////////////////////////////////////////////////////////

  it("should indicate 0", function () {
    t.putBlockUnderTest(ls.indicator);
    t.putInput(UNIT_NX, 0);
    expect(t.world.gRot(t.center[0],t.center[1],t.center[2])).toEqual(CubeRotation.identity.code);
  });

  it("should indicate 1", function () {
    t.putBlockUnderTest(ls.indicator);
    t.putInput(UNIT_NX, 2); // any value other than 1 should give the same result
    expect(t.world.gRot(t.center[0],t.center[1],t.center[2])).toEqual(CubeRotation.z180.code);
  });

  it("should reevaluate on subdata updates", function () {
    t.putBlockUnderTest(ls.junction);
    t.putInput(UNIT_NX, 0);
    expect(t.readOutput(UNIT_PX)).toEqual(0);
    t.putInput(UNIT_NX, 1);
    expect(t.readOutput(UNIT_PX)).toEqual(1);
  });

  it("should have connectivity according to rotations", function () {
    // unrotated gate
    t.putBlockUnderTest(ls.gate, CubeRotation.identity.code);
    t.putInput(UNIT_NX, 2); // connected emitter
    t.putInput(UNIT_NZ, 3); // unconnected emitter
    expect(t.readOutput(UNIT_PX)).toEqual(2);
    expect(t.readOutput(UNIT_PZ)).toBeFalsy();
    
    // rotated case
    t.putBlockUnderTest(ls.gate, CubeRotation.y270.code);
    expect(t.readOutput(UNIT_PX)).toBeFalsy();
    expect(t.readOutput(UNIT_PZ)).toEqual(3);

    //dumpWorld("rotation test");
  });

  describe("getNeighborID", function () {
    it("should report inner block IDs according to rotation", function () {
      t.putBlockUnderTest(ls.getNeighborID, CubeRotation.identity.code);
      expect(t.readOutput(UNIT_PX)).toEqual(0);
      t.putNeighbor(UNIT_NZ, 2); // should be irrelevant
      expect(t.readOutput(UNIT_PX)).toEqual(0);
      t.putNeighbor(UNIT_NX, 3); // should be detected
      expect(t.readOutput(UNIT_PX)).toEqual(3);

      // rotated cases
      t.putBlockUnderTest(ls.getNeighborID, CubeRotation.y270.code);
      expect(t.readOutput(UNIT_PX)).toEqual(2);
    });

    it("should report outer block IDs when in a block", function () {
      // Create a block which does the same thing, but on -z axis
      var inner = makeTester();
      inner.putBlockUnderTest(ls.getNeighborID, CubeRotation.y270.code);
      inner.putNeighbor(UNIT_PX, ls.emitUniform);
      inner.world.s(0,0,0, ls.getSubDatum);
      inner.world.s(0,0,1, ls.setRotation);
      var type = new BlockType.World(inner.world);
      type.behavior = Circuit.behaviors.ic;
      var id = blockset.length;
      blockset.add(type); // NOTE: This creates a blockset->blocktype->world->blockset circular reference; might be a problem in the future
      
      t.putBlockUnderTest(id, CubeRotation.identity.code);
      expect(t.readOutput(UNIT_PX)).toEqual(0);
      t.putNeighbor(UNIT_NZ, 2);
      expect(t.readOutput(UNIT_PX)).toEqual(2);

      // rotated on the outside
      t.putNeighbor(UNIT_PX, 3);
      t.putBlockUnderTest(id, CubeRotation.y270.code); // rotated 90ª twice, should now read +x
      expect(t.readOutput(UNIT_PX)).toEqual(3);
    });
  });
});