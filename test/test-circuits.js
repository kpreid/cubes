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
    var blockset = WorldGen.colorBlocks(2, 2, 2);
    WorldGen.addLogicBlocks(TS, blockset, baseLogicAndColors);
    var ls = {};
    for (var i = 0; i < blockset.length; i++) {
      var name = (blockset.get(i).name || "");
      if (/^logic\./.test(name)) {
        ls[name.replace(/^logic\./, "")] = i;
      }
    }

    var self = {
      world: new World([TS, TS, TS], blockset),
      center: [5, 5, 5],
      blockset: blockset,
      ls: ls,

      // For looking at the test case in-game for debugging.
      dumpWorld: function (name) {
        var pool = new PersistencePool(localStorage, "cubes.object.");
        if (pool.has(name)) pool.ephemeralize(name);
        pool.persist(self.world, name);
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
        if (typeof value !== "number" || value < 0 || value >= World.subdatumBound || Math.floor(value) !== value) {
          throw new Error("Can't yet define a test input value of " + value);
        }
        self.putNeighbor(offset, t.ls.constant, value);
      },
      readOutput: function (face) {
        var circuit = self.world.getCircuit(this.center);
        if (!circuit)
          throw new Error("There is no circuit at the center!");
        return circuit.getBlockOutput(this.center, face);
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
    expect(t.world.gRotv(t.center)).toEqual(CubeRotation.identity.code);
  });

  it("should indicate 1", function () {
    t.putBlockUnderTest(t.ls.indicator);
    t.putInput(UNIT_NX, 2); // any value other than 1 should give the same result
    expect(t.world.gRotv(t.center)).toEqual(CubeRotation.z180.code);
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
    t.world = cyclicUnserialize(cyclicSerialize(t.world, Persister.findType), Persister.types);
    expect(t.readOutput(UNIT_PX)).toBeFalsy();
    expect(t.readOutput(UNIT_PZ)).toEqual(3);
  });
  
  describe("count", function () {
    it("should count its inputs equal to -X", function () {
      t.putBlockUnderTest(t.ls.count);

      // sample data
      t.putInput(UNIT_NY, 10);
      t.putInput(UNIT_NZ, 12);
      t.putInput(UNIT_PY, 20);
      t.putInput(UNIT_PZ, 20);
      
      // test cases
      t.putInput(UNIT_NX, 43);
      expect(t.readOutput(UNIT_PX)).toEqual(0);
      t.putInput(UNIT_NX, 10);
      expect(t.readOutput(UNIT_PX)).toEqual(1);
      t.putInput(UNIT_NX, 12);
      expect(t.readOutput(UNIT_PX)).toEqual(1);
      t.putInput(UNIT_NX, 20);
      expect(t.readOutput(UNIT_PX)).toEqual(2);
      // TODO add non-integer input test cases once we can putInput them
    });
  });

  describe("icOutput", function () {
    it("should pass values out of an IC", function () {
      var inner = makeCircuitBlock(t);
      inner.putBlockUnderTest(t.ls.icOutput, CubeRotation.identity.code);
      inner.putInput(UNIT_NX, 101);
      inner.putInput(UNIT_PX, 102);
      inner.putInput(UNIT_NY, 103);
      inner.putInput(UNIT_PY, 104);
      inner.putInput(UNIT_NZ, 105);
      inner.putInput(UNIT_PZ, 106);
      
      // permit rotation
      inner.world.s(0,0,0, t.ls.getSubDatum);
      inner.world.s(0,0,1, t.ls.setRotation);
      
      t.putBlockUnderTest(inner.id);
      expect(t.readOutput(UNIT_PX)).toEqual(101);
      expect(t.readOutput(UNIT_NX)).toEqual(102);
      expect(t.readOutput(UNIT_PY)).toEqual(103);
      expect(t.readOutput(UNIT_NY)).toEqual(104);
      expect(t.readOutput(UNIT_PZ)).toEqual(105);
      expect(t.readOutput(UNIT_NZ)).toEqual(106);
      
      // TODO: Test effects when there are multiple icOutput elements, multiple circuits containing icOutput elements, or unconnected faces.
      
      // rotated case
      t.putBlockUnderTest(inner.id, CubeRotation.y90.code);
      expect(t.readOutput(UNIT_PX)).toEqual(105);
      expect(t.readOutput(UNIT_NX)).toEqual(106);
      expect(t.readOutput(UNIT_PY)).toEqual(103);
      expect(t.readOutput(UNIT_NY)).toEqual(104);
      expect(t.readOutput(UNIT_PZ)).toEqual(102);
      expect(t.readOutput(UNIT_NZ)).toEqual(101);
    });
  });

  describe("icInput", function () {
    it("should pass values into an IC", function () {
      // Note: This test relies on output functionality, because it is not currently possible to read the state of an executing circuit in a block. inner.readOutput() would just give us the "local" block-independent result.
      
      var inner = makeCircuitBlock(t);
      inner.putBlockUnderTest(t.ls.icInput);
      inner.putNeighbor(UNIT_PX, t.ls.icOutput);
      inner.putNeighbor(UNIT_NY, t.ls.icOutput);
      inner.putNeighbor(UNIT_PZ, t.ls.icOutput);
      
      t.putBlockUnderTest(inner.id);
      t.putInput(UNIT_NX, 101);
      t.putInput(UNIT_PY, 102);
      t.putInput(UNIT_NZ, 103);

      expect(t.readOutput(UNIT_PX)).toEqual(101);
      expect(t.readOutput(UNIT_NY)).toEqual(102);
      expect(t.readOutput(UNIT_PZ)).toEqual(103);
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
    });
  });
  
  it("should not crash given nonsense", function () {
    var rots = [CubeRotation.identity.code,
                CubeRotation.y90.code,
                CubeRotation.y180.code,
                CubeRotation.y270.code];
    var blocks = Object.keys(t.ls).map(function (k) { return t.ls[k]; });
    function pickBlock(x,y,z,cont) {
      blocks.forEach(function (id) {
        rots.forEach(function (subdatum) {
          t.world.s(x,y,z,id,subdatum);
          cont();
        });
      });
    }
    
    t.world.s(0,1,1, t.ls.emitConstant, 0);
    t.world.s(1,1,0, t.ls.emitConstant, 1);
    t.world.s(2,1,1, t.ls.indicator);
    pickBlock(1,1,1, function () {
      pickBlock(1,1,2, function () {
      });
    });
  });
});