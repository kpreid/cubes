// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("CubeRotation", function () {
  var CubeRotation = cubes.util.CubeRotation;
  
  beforeEach(function() {
    this.addMatchers({
      toEqualVector: function(expected) {
        // default toEqual compares on too much object structure
        if (expected.length !== this.actual.length) return false;
        for (var i = 0; i < this.actual.length; i++) {
          if (Math.abs(expected[i] - this.actual[i]) >= 1e-6) return false;
        }
        return true;
      },
      toBeInstanceOf: function(expected) {
        return this.actual instanceof expected;
      }
    });
  });
  
  it("should preserve a vector rotated by the identity", function () {
    expect(CubeRotation.identity.transformVector([0.1,0.2,0.3])).toEqualVector([0.1,0.2,0.3]);
  });
  it("should preserve a point rotated by the identity", function () {
    expect(CubeRotation.identity.transformPoint([0.1,0.2,0.3])).toEqualVector([0.1,0.2,0.3]);
  });
  it("should reflect a vector", function () {
    expect(CubeRotation.byCode[1].transformVector([0.1,0.2,0.3])).toEqualVector([-0.1,-0.2,0.3]);
  });
  it("should reflect a point", function () {
    expect(CubeRotation.byCode[1].transformPoint([0.1,0.2,0.3])).toEqualVector([0.9,0.8,0.3]);
  });
  
  it("should use the provided result object, else a vec3", function () {
    var aRot = CubeRotation.y90;
    expect(aRot.transformVector([0,0,0])).toBeInstanceOf(vec3.create().constructor);
    expect(aRot.transformVector([0,0,0], [])).toBeInstanceOf(Array);
    expect(aRot.transformVector([0,0,0], new Uint8Array(3))).toBeInstanceOf(Uint8Array);
  });
  
  it("should have paired inverses", function () {
    CubeRotation.byCode.forEach(function (rot) {
      expect(rot.inverse.inverse).toBe(rot);
    });
  });

  it("should have correct inverses", function () {
    CubeRotation.byCode.forEach(function (rot) {
      var vec = [1,2,3];
      expect(rot.inverse.transformVector(rot.transformVector(vec))).toEqualVector(vec);
    });
  });

  it("should have correct compositions", function () {
    CubeRotation.byCode.forEach(function (rot1) {
      CubeRotation.byCode.forEach(function (rot2) {
        var vec = [1,2,3];
        expect(rot2.after(rot1).transformVector(vec))
            .toEqualVector(rot2.transformVector(rot1.transformVector(vec)));
      });
    });
  });
  
  function testNamedRot(name, output) {
    it("should correctly rotate by " + name, function () {
      expect(CubeRotation[name].transformVector([1,2,3])).toEqualVector(output);
    });
  }
  testNamedRot("identity", [1,2,3]);
  testNamedRot("x90",      [1,-3,2]);
  testNamedRot("x180",     [1,-2,-3]);
  testNamedRot("x270",     [1,3,-2]);
  testNamedRot("y90",      [3,2,-1]);
  testNamedRot("y180",     [-1,2,-3]);
  testNamedRot("y270",     [-3,2,1]);
  testNamedRot("z90",      [-2,1,3]);
  testNamedRot("z180",     [-1,-2,3]);
  testNamedRot("z270",     [2,-1,3]);
});
