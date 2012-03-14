// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Circuit", function() {
  var TS = 16;

  var t;
  beforeEach(function () {
    t = makeTester();
  });
  
  function makeTester() {
    // TODO: This code is duplicative of generateWorlds.
    // layer 1
    var pureColors = WorldGen.colorBlocks(4, 4, 4);

    // layer 2
    var baseLogicAndColors = WorldGen.colorBlocks(4, 4, 4);
    WorldGen.addLogicBlocks(TS, baseLogicAndColors, pureColors);

    // layer 3
    var blockset = WorldGen.colorBlocks(4, 4, 4);
    WorldGen.addLogicBlocks(TS, blockset, baseLogicAndColors);
    var ls = {};
    for (var i = 0; i < blockset.length; i++) {
      ls[(blockset.get(i).name || "").replace(/^logic\./, "")] = i;
    }

    var self = {
      world: new World([TS, TS, TS], blockset),
      center: [5, 5, 5],
      blockset: blockset,
      ls: ls,

      // For looking at the test case in-game for debugging.
      dumpWorld: function (name) {
        var pool = new PersistencePool(localStorage, "cubes.object.");
        if (pool.has(name)) pool.get(name).persistence.ephemeralize();
        self.world.persistence.persist(pool, name);
        pool.flushNow();
      },

      putBlockUnderTest: function (id, subdatum) {
        self.world.s(this.center[0],this.center[1],this.center[2], id, subdatum);
      },
      putNeighbor: function (offset, id, subdatum) {
        self.world.s(this.center[0]+offset[0],
                     this.center[1]+offset[1],
                     this.center[2]+offset[2],
                     id, subdatum);
      },
      putInput: function (offset, value) {
        if (typeof value !== "number" || value < 0 || value >= 256) {
          throw new Error("Can't yet define a test input value of " + value);
        }
        self.putNeighbor(offset, t.ls.constant, value);
      },
      putOutput: function (offset) {
        self.putNeighbor(offset, t.ls.indicator);
      },
      readOutput: function (offset) {
        return self.world.getCircuit(this.center).getBlockOutput(this.center, offset);
      }
    };
    return self;
  }

  function makeCircuitBlock(t) {
    var inner = makeTester();
    var type = new BlockType.World(inner.world);
    type.behavior = Circuit.behaviors.ic;
    inner.id = t.blockset.length;
    t.blockset.add(type);
    return inner;
  }
  
  //////////////////////////////////////////////////////////////////////

  it("should indicate 0", function () {
    t.putBlockUnderTest(t.ls.indicator);
    t.putInput(UNIT_NX, 0);
    expect(t.world.gRot(t.center[0],t.center[1],t.center[2])).toEqual(CubeRotation.identity.code);
  });

  it("should indicate 1", function () {
    t.putBlockUnderTest(t.ls.indicator);
    t.putInput(UNIT_NX, 2); // any value other than 1 should give the same result
    expect(t.world.gRot(t.center[0],t.center[1],t.center[2])).toEqual(CubeRotation.z180.code);
  });

  it("should reevaluate on subdata updates", function () {
    t.putBlockUnderTest(t.ls.junction);
    t.putInput(UNIT_NX, 0);
    expect(t.readOutput(UNIT_PX)).toEqual(0);
    t.putInput(UNIT_NX, 1);
    expect(t.readOutput(UNIT_PX)).toEqual(1);
  });

  it("should have connectivity according to rotations", function () {
    // unrotated gate
    t.putBlockUnderTest(t.ls.gate, CubeRotation.identity.code);
    t.putInput(UNIT_NX, 2); // connected emitter
    t.putInput(UNIT_NZ, 3); // unconnected emitter
    expect(t.readOutput(UNIT_PX)).toEqual(2);
    expect(t.readOutput(UNIT_PZ)).toBeFalsy();
    
    // rotated case
    t.putBlockUnderTest(t.ls.gate, CubeRotation.y270.code);
    expect(t.readOutput(UNIT_PX)).toBeFalsy();
    expect(t.readOutput(UNIT_PZ)).toEqual(3);

    // Regression test: rotation connectivity works after unserialization (that is, the notifyRawEdit path)
    t.world = cyclicUnserialize(cyclicSerialize(t.world, Persister.types), Persister.types);
    expect(t.readOutput(UNIT_PX)).toBeFalsy();
    expect(t.readOutput(UNIT_PZ)).toEqual(3);
  });
  
  describe("icOutput", function () {
    it("should cause a block to emit values", function () {
      var inner = makeCircuitBlock(t);
      inner.putBlockUnderTest(t.ls.icOutput, CubeRotation.identity.code);
      inner.putInput(UNIT_NX, 101);
      inner.putInput(UNIT_PX, 102);
      inner.putInput(UNIT_NY, 103);
      inner.putInput(UNIT_PY, 104);
      inner.putInput(UNIT_NZ, 105);
      inner.putInput(UNIT_PZ, 106);
      
      t.putBlockUnderTest(inner.id);
      expect(t.readOutput(UNIT_PX)).toEqual(101);
      expect(t.readOutput(UNIT_NX)).toEqual(102);
      expect(t.readOutput(UNIT_PY)).toEqual(103);
      expect(t.readOutput(UNIT_NY)).toEqual(104);
      expect(t.readOutput(UNIT_PZ)).toEqual(105);
      expect(t.readOutput(UNIT_NZ)).toEqual(106);
      
      // TODO: Test effects when there are multiple icOutput elements, multiple circuits containing icOutput elements, or unconnected faces.
    });
  });

  describe("getNeighborID", function () {
    it("should report inner block IDs according to rotation", function () {
      t.putBlockUnderTest(t.ls.getNeighborID, CubeRotation.identity.code);
      expect(t.readOutput(UNIT_PX)).toEqual(0);
      t.putNeighbor(UNIT_NZ, 2); // should be irrelevant
      expect(t.readOutput(UNIT_PX)).toEqual(0);
      t.putNeighbor(UNIT_NX, 3); // should be detected
      expect(t.readOutput(UNIT_PX)).toEqual(3);

      // rotated cases
      t.putBlockUnderTest(t.ls.getNeighborID, CubeRotation.y270.code);
      expect(t.readOutput(UNIT_PX)).toEqual(2);
    });

    it("should report outer block IDs when in a block", function () {
      // Create a block which does the same thing, but on -z axis
      var inner = makeCircuitBlock(t);
      inner.putBlockUnderTest(t.ls.getNeighborID, CubeRotation.y270.code);
      inner.putNeighbor(UNIT_PX, t.ls.icOutput);
      inner.world.s(0,0,0, t.ls.getSubDatum);
      inner.world.s(0,0,1, t.ls.setRotation);
      
      t.putBlockUnderTest(inner.id, CubeRotation.identity.code);
      expect(t.readOutput(UNIT_PX)).toEqual(0);
      t.putNeighbor(UNIT_NZ, 2);
      expect(t.readOutput(UNIT_PX)).toEqual(2);

      // rotated on the outside
      t.putNeighbor(UNIT_PX, 3);
      t.putBlockUnderTest(inner.id, CubeRotation.y270.code); // rotated 90ª twice, should now read +x
      expect(t.readOutput(UNIT_PZ /* since the output was rotated */)).toEqual(3);
      
      t.dumpWorld("getNeighborID rotation test");
    });
  });
});