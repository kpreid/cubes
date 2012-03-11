// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Persister", function () {
  it("should preserve references to other persistent objects", function () {
    // using existing types rather than ones invented for test because Persister.types is a global currently.
    sessionStorage.clear();
    
    var pool1 = new PersistencePool(sessionStorage, "Persister-preserve-test.");
    
    var inner = new BlockSet([]);
    var outer = new World([1,1,1], inner);
    inner.persistence.persist(pool1, "inner");
    outer.persistence.persist(pool1, "outer");
    // TODO also test correct linking if an inner object is persisted after the outer is written. This doesn't matter yet, but it will.
    
    pool1.flushNow();
    
    // new pool so that we are actually unserializing, not reobtaining the above live objects
    var pool2 = new PersistencePool(sessionStorage, "Persister-preserve-test.");
    var inner2 = pool2.get("inner");
    var outer2 = pool2.get("outer");
    
    expect(outer2.blockSet).toBe(inner2);
  });
});
