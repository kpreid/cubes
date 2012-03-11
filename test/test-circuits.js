// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Circuit", function() {
  
  var TS = 8;
  var blockset, ls;
  beforeEach(function () {
    // TODO: This code is duplicative of generateWorlds.
    if (blockset) return;
    // layer 1
    var pureColors = WorldGen.colorBlocks(4, 4, 4);

    // layer 2
    var baseLogicAndColors = WorldGen.colorBlocks(4, 4, 4);
    WorldGen.addLogicBlocks(TS, baseLogicAndColors, pureColors);

    // layer 3
    blockset = WorldGen.colorBlocks(4, 4, 4);
    WorldGen.addLogicBlocks(TS, blockset, baseLogicAndColors);
    ls = {};
    for (var i = 0; i < blockset.length; i++) {
      ls[(blockset.get(i).name || "").replace(/^logic\./, "")] = i;
    }
  });

  it("should indicate 0", function () {
    var world = new World([4, 4, 4], blockset);
    world.s(1,1,1, ls.emitConstant, 0);
    world.s(1,1,2, ls.indicator);
    expect(world.gRot(1,1,2)).toEqual(0);
  });

  it("should indicate 1", function () {
    var world = new World([4, 4, 4], blockset);
    world.s(1,1,1, ls.emitConstant, 42);
    world.s(1,1,2, ls.indicator);
    expect(world.gRot(1,1,2)).toEqual(1);
  });

  it("should reevaluate on subdata updates", function () {
    var world = new World([4, 4, 4], blockset);
    world.s(1,1,1, ls.emitConstant, 0);
    world.s(1,1,2, ls.indicator);
    expect(world.gRot(1,1,2)).toEqual(0);
    world.s(1,1,1, ls.emitConstant, 42);
    expect(world.gRot(1,1,2)).toEqual(1);
  });
});