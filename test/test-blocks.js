// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("BlockType", function () {
  it("should persist block type attributes", function () {
    var type = new BlockType.Color([1,1,1,1]);
    type.automaticRotations = [1,2];
    type.behavior = Circuit.behaviors.wire;
    type.name = "foo";
    type.solid = false;
    var roundtrip = cyclicUnserialize(cyclicSerialize(type, Persister.types), Persister.types);
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
    
    var blockset = new BlockSet([]);
    blockset.persistence.persist(pool, "obj");
    expect(pool.status.get()).toEqual(1);
    pool.flushNow();
    expect(pool.status.get()).toEqual(0);
    
    blockset.add(new BlockType.Color([1,1,1,1]));
    expect(pool.status.get()).toEqual(1);
    pool.flushNow();

    // TODO also when a block type is modified
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
});