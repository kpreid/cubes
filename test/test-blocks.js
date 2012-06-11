// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("BlockType", function () {
  "use strict";
  
  var Blockset = cubes.Blockset;
  var BlockType = cubes.BlockType;
  var Circuit = cubes.Circuit;
  var cyclicSerialize = cubes.storage.cyclicSerialize;
  var cyclicUnserialize = cubes.storage.cyclicUnserialize;
  var Persister = cubes.storage.Persister;
  var World = cubes.World;
  
  it("should persist block type attributes", function () {
    var type = new BlockType([1,0,1,1], new World([1, 1, 1], new Blockset([])));
    type.automaticRotations = [1,2];
    type.behavior = Circuit.behaviors.wire;
    type.name = "foo";
    type.solid = false;
    type.light = Math.PI;
    var roundtrip = cyclicUnserialize(cyclicSerialize(type, Persister.findType), Persister.types);
    expect(roundtrip.color).toEqual([1,0,1,1]);
    expect(roundtrip.world).not.toBeNull();
    expect(roundtrip.automaticRotations).toEqual([1,2]);
    expect(roundtrip.behavior).toEqual(Circuit.behaviors.wire);
    expect(roundtrip.name).toEqual("foo");
    expect(roundtrip.solid).toEqual(false);
    expect(roundtrip.light).toEqual(Math.PI);
  });
});

describe("Blockset", function () {
  "use strict";
  
  var Blockset = cubes.Blockset;
  var BlockType = cubes.BlockType;
  var PersistencePool = cubes.storage.PersistencePool;
  var World = cubes.World;

  it("should know when it is dirty", function () {
    sessionStorage.clear();
    var pool = new PersistencePool(sessionStorage, "Blockset-dirty-test.");
    
    // creating a blockset
    var blockset = new Blockset([]);
    pool.persist(blockset, "obj");
    expect(pool.status.get()).toEqual(1);
    pool.flushNow();
    expect(pool.status.get()).toEqual(0);
    
    // adding block types
    var btc = new BlockType([1,1,1,1], null);
    var btw = new BlockType(null, new World([16,16,16], cubes.WorldGen.colorBlocks(2,2,2)));
    blockset.add(btc);
    blockset.add(btw);
    expect(pool.status.get()).toEqual(1);
    pool.flushNow();
    
    // modifying a block type
    btw.world.s(0,0,0,1);
    expect(pool.status.get()).toEqual(1);
    pool.flushNow();
  });
  
  it("should know block names", function () {
    var type1 = new BlockType([1,1,1,1], null);
    type1.name = "foo";
    var type2 = new BlockType([1,1,1,1], null);
    type2.name = "bar";
    var blockset = new Blockset([type1, type2]);
    expect(blockset.lookup("foo")).toBe(1);
    expect(blockset.lookup("bar")).toBe(2);
  });
  
  it("should give null for an unknown block name", function () {
    var blockset = new Blockset([]);
    expect(blockset.lookup("foo")).toBe(null);
  });
  
  it("should correctly delete a block type", function () {
    var type1 = new BlockType([1,1,1,1], null);
    var type2 = new BlockType([1,1,0,1], null);
    var type3 = new BlockType([1,0,0,1], null);
    var blockset = new Blockset([type1, type2, type3]);
    
    expect(blockset.get(0)).toBe(BlockType.air);
    expect(blockset.get(1)).toBe(type1);
    expect(blockset.get(2)).toBe(type2);
    expect(blockset.get(3)).toBe(type3);
    
    var listener = {
      interest: function () { return true; },
      tableChanged: function (id) {},
      texturingChanged: function (id) {},
    };
    spyOn(listener, "tableChanged");
    blockset.listen(listener);
    
    blockset.deleteLast();
    
    expect(blockset.get(0)).toBe(BlockType.air);
    expect(blockset.get(1)).toBe(type1);
    expect(blockset.get(2)).toBe(type2);
    expect(blockset.get(3)).toBe(type1);
    
    expect(listener.tableChanged).toHaveBeenCalledWith(3);
  });
  
  it("should not allow deletion of the last block type", function () {
    var blockset = new Blockset([]);
    
    expect(blockset.length).toBe(1);
    expect(blockset.get(0)).toBe(BlockType.air);
    
    expect(function () {
      blockset.deleteLast();
    }).toThrow();
    
    expect(blockset.length).toBe(1);
    expect(blockset.get(0)).toBe(BlockType.air);
  });
});
