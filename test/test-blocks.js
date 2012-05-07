// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("BlockType", function () {
  it("should persist block type attributes", function () {
    var type = new BlockType.Color([1,1,1,1]);
    type.automaticRotations = [1,2];
    type.behavior = Circuit.behaviors.wire;
    type.name = "foo";
    type.solid = false;
    var roundtrip = cyclicUnserialize(cyclicSerialize(type, Persister.findType), Persister.types);
    expect(roundtrip.automaticRotations).toEqual([1,2]);
    expect(roundtrip.behavior).toEqual(Circuit.behaviors.wire);
    expect(roundtrip.name).toEqual("foo");
    expect(roundtrip.solid).toEqual(false);
  });
});

describe("BlockSet", function () {
  it("should know when it is dirty", function () {
    sessionStorage.clear();
    var pool = new PersistencePool(sessionStorage, "BlockSet-dirty-test.");
    
    // creating a blockset
    var blockset = new BlockSet([]);
    pool.persist(blockset, "obj");
    expect(pool.status.get()).toEqual(1);
    pool.flushNow();
    expect(pool.status.get()).toEqual(0);
    
    // adding block types
    var btc = new BlockType.Color([1,1,1,1]);
    var btw = new BlockType.World(new World([16,16,16], WorldGen.colorBlocks(2,2,2)));
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
    var type1 = new BlockType.Color([1,1,1,1]);
    type1.name = "foo";
    var type2 = new BlockType.Color([1,1,1,1]);
    type2.name = "bar";
    var blockset = new BlockSet([type1, type2]);
    expect(blockset.lookup("foo")).toBe(1);
    expect(blockset.lookup("bar")).toBe(2);
  });
  
  it("should give null for an unknown block name", function () {
    var blockset = new BlockSet([]);
    expect(blockset.lookup("foo")).toBe(null);
  });
  
  it("should correctly delete a block type", function () {
    var type1 = new BlockType.Color([1,1,1,1]);
    var type2 = new BlockType.Color([1,1,0,1]);
    var type3 = new BlockType.Color([1,0,0,1]);
    var blockset = new BlockSet([type1, type2, type3]);
    
    expect(blockset.get(0)).toBe(BlockType.air);
    expect(blockset.get(1)).toBe(type1);
    expect(blockset.get(2)).toBe(type2);
    expect(blockset.get(3)).toBe(type3);
    
    var listener = {
      tableChanged: function (id) { return true; },
      texturingChanged: function (id) { return true; },
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
    var blockset = new BlockSet([]);
    
    expect(blockset.length).toBe(1);
    expect(blockset.get(0)).toBe(BlockType.air);
    
    expect(function () {
      blockset.deleteLast();
    }).toThrow();
    
    expect(blockset.length).toBe(1);
    expect(blockset.get(0)).toBe(BlockType.air);
  });
});
