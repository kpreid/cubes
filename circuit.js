// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Circuit = (function () {
  function Circuit(world) {
    var blockSet = world.blockSet;
    var behaviors = blockSet.behaviors;
    
    var blocks = [];
    var aabb = null;
    var blockState = {};
    
    this.world = world;
    this.blocks = blocks;
    this.getOrigin = function () {
      return this.blocks[0];
    };
    this.add = function (blockVec) {
      blocks.push(blockVec);
      blockState[blockVec] = {};
      if (aabb == null) {
        aabb = [[blockVec[0], blockVec[0] + 1],[blockVec[1], blockVec[1] + 1],[blockVec[2], blockVec[2] + 1]];
      } else {
        for (var dim = 0; dim < 3; dim++) {
          aabb[dim][0] = Math.min(aabb[dim][0], blockVec[0]);
          aabb[dim][1] = Math.max(aabb[dim][1], blockVec[1] + 1);
        }
      }
    };
    this.getAABB = function () {
      return aabb;
    };
    this.compile = function () {
      var outputs = [];
      
      // Clear and initialize blockState
      blocks.forEach(function (block) {
        blockState[block] = {};
        var beh = behaviors[world.g(block[0],block[1],block[2])];
        switch (beh) {
          case Circuit.B_OUTPUT:
            blockState[block].signalFrom = [];
            break;
          case Circuit.B_INPUT:
            blockState[block].signalTo = [];
            break;
        }
      });
      
      // Find connectivity
      blocks.forEach(function (block) {
        var beh = behaviors[world.g(block[0],block[1],block[2])];
        if (beh == Circuit.B_OUTPUT) {
          outputs.push(block);
          UNIT_AXES.forEach(function (direction) {
            direction = Array.prototype.slice.call(direction);
            var bn = block.slice();
            vec3.add(bn, direction, bn);
            for (;; vec3.add(bn, direction, bn)) {
              var bnBeh = behaviors[world.g(bn[0],bn[1],bn[2])];
              if (bnBeh == Circuit.B_WIRE) {
                blockState[bn]["wireTo "+direction] = block;
              } else if (bnBeh == Circuit.B_INPUT) {
                // link input/output pairs
                blockState[bn].signalTo.push(block);
                blockState[block].signalFrom.push(bn.slice());
                break;
              } else { // not a wire
                break;
              }
            }
          });
        }
      });
    };
    this.getBlockState = function (block) {
      return blockState[block];
    };
    
    Object.freeze(this);
  }
  
  // block behavior enums
  Circuit.B_WIRE = "W";
  Circuit.B_INPUT = "I";
  Circuit.B_OUTPUT = "O";

  return Object.freeze(Circuit);
})();
