// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Body", function () {
  "use strict";
  
  var AAB = cubes.util.AAB;
  var Blockset = cubes.Blockset;
  var Body = cubes.Body;
  var cyclicSerialize = cubes.storage.cyclicSerialize;
  var cyclicUnserialize = cubes.storage.cyclicUnserialize;
  var Persister = cubes.storage.Persister;
  var World = cubes.World;
  
  beforeEach(function() {
    this.addMatchers({
      toEqualVector: function(expected) {
        // default toEqual compares on too much object structure
        if (expected.length !== this.actual.length) return false;
        for (var i = 0; i < this.actual.length; i++) {
          if (Math.abs(expected[i] - this.actual[i]) >= 1e-6) return false;
        }
        return true;
      }
    });
  });
  
  it("should serialize", function () {
    var stubWorld = new World([9,1,1], new Blockset([]));
    
    var body = new Body(stubWorld, new AAB(0, 1, 2, 3, 4, 5));
    vec3.set([3, 8, 201], body.pos);
    vec3.set([14, 7, 30], body.vel);
    body.yaw = 1.23;

    var roundtrip = cyclicUnserialize(cyclicSerialize(body, Persister.findType), Persister.types);

    expect(roundtrip.world).toBeNull(); // not serializing redundant backrefs, or cycles
    expect(roundtrip.aab).toEqual(body.aab);
    expect(roundtrip.pos).toEqualVector(body.pos);
    expect(roundtrip.vel).toEqualVector(body.vel);
    expect(roundtrip.yaw).toBe(body.yaw);
    expect(roundtrip.flying).toBe(body.flying);
    expect(roundtrip.noclip).toBe(body.noclip);
    
    // TODO test that the mechanism involving body.worldContacts works across serializations
  });
});
