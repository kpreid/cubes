// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("WorldGen", function() {
  "use strict";
  
  var WorldGen = cubes.WorldGen;
  
  var TS = 8;
  
  it("should add logic blocks idempotently", function () {
    var pureColors = WorldGen.colorBlocks(4, 4, 4);
    var baseLogicAndColors = WorldGen.colorBlocks(4, 4, 4);
    WorldGen.addLogicBlocks(TS, baseLogicAndColors, pureColors);

    var blockset = WorldGen.colorBlocks(2, 2, 2);
    WorldGen.addLogicBlocks(TS, blockset, baseLogicAndColors);
    
    var count = blockset.length;
    
    WorldGen.addLogicBlocks(TS, blockset, baseLogicAndColors);
    
    expect(blockset.length).toEqual(count);
  });
});
