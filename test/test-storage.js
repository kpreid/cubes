// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Cell", function () {
  it("whenChanged should handle interest correctly", function () {
    var cell = new Cell("test1", 0);
    
    var f = jasmine.createSpy("cell listener");
    f.andReturn(true);
    
    cell.whenChanged(f);
    expect(f).not.toHaveBeenCalled();
    
    cell.set(1);
    expect(f).toHaveBeenCalledWith(1);

    f.andReturn(false);

    f.reset();    
    cell.set(2);
    expect(f).toHaveBeenCalledWith(2);
    
    f.reset();    
    cell.set(3);
    expect(f).not.toHaveBeenCalled();
  });
})

describe("Persister", function () {
  it("should preserve references to other persistent objects", function () {
    // using existing types rather than ones invented for test because Persister.types is a global currently.
    sessionStorage.clear();
    
    var pool1 = new PersistencePool(sessionStorage, "Persister-preserve-test.");
    
    var inner = new BlockSet([]);
    var outer = new World([1,1,1], inner);
    pool1.persist(inner, "inner");
    pool1.persist(outer, "outer");
    // TODO also test correct linking if an inner object is persisted after the outer is written. This doesn't matter yet, but it will.
    
    pool1.flushNow();
    
    // new pool so that we are actually unserializing, not reobtaining the above live objects
    var pool2 = new PersistencePool(sessionStorage, "Persister-preserve-test.");
    var inner2 = pool2.get("inner");
    var outer2 = pool2.get("outer");
    
    expect(outer2.blockset).toBe(inner2);
  });

  it("handles renaming", function () {
    sessionStorage.clear();
    var pool = new PersistencePool(sessionStorage, "Persister-preserve-test.");
    
    var obj = new BlockSet([]);
    pool.persist(obj, "foo");
    pool.flushNow();
    pool.ephemeralize("foo");
    pool.persist(obj, "bar");
    
    expect(pool.get("foo")).toBe(null);
    expect(pool.get("bar")).toBe(obj);
  });
});
