// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("CubeRotation", function() {
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
  
  it("should preserve a vector rotated by the identity", function () {
    expect(CubeRotation.byCode[0].transformVector([0.1,0.2,0.3])).toEqualVector([0.1,0.2,0.3]);
  });
  it("should preserve a point rotated by the identity", function () {
    expect(CubeRotation.byCode[0].transformPoint([0.1,0.2,0.3])).toEqualVector([0.1,0.2,0.3]);
  });
  it("should reflect a vector", function () {
    expect(CubeRotation.byCode[1].transformVector([0.1,0.2,0.3])).toEqualVector([-0.1,-0.2,0.3]);
  });
  it("should reflect a point", function () {
    expect(CubeRotation.byCode[1].transformPoint([0.1,0.2,0.3])).toEqualVector([0.9,0.8,0.3]);
  });
});