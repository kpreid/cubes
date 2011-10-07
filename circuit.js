// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Circuit = (function () {
  function Circuit(world) {
    var blockSet = world.blockSet;
    var behaviors = blockSet.behaviors;
    
    var blocks = [];
    var aabb = null;
    var blockState = {};
    var evaluate = function () {};

    var state = false;
    
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
            blockState[block].outstate = false;
            break;
          case Circuit.B_INPUT:
            blockState[block].signalTo = [];
            break;
          case Circuit.B_OR:
            blockState[block].signalTo = [];
            blockState[block].signalFrom = [];
            break;
        }
      });
      
      // Find connectivity
      blocks.forEach(function (block) {
        var beh = behaviors[world.g(block[0],block[1],block[2])];
        if (beh == Circuit.B_OUTPUT) {
          outputs.push(block);
        }
        if (beh == Circuit.B_OUTPUT || beh == Circuit.B_OR) {
          UNIT_AXES.forEach(function (direction) {
            direction = Array.prototype.slice.call(direction);
            var bn = block.slice();
            vec3.add(bn, direction, bn);
            for (;; vec3.add(bn, direction, bn)) {
              var bnBeh = behaviors[world.g(bn[0],bn[1],bn[2])];
              if (bnBeh == Circuit.B_WIRE) {
                blockState[bn]["wireTo "+direction] = block;
              } else if (bnBeh == Circuit.B_INPUT || bnBeh == Circuit.B_OR) {
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
      
      var evaluators = [];
      var seen = {};
      
      function compile(block) {
        if (seen[block]) {
          console.error("circuit loop!");
          return;
        }
        seen[block] = true;
        
        var beh = behaviors[world.g(block[0],block[1],block[2])];
        var state = blockState[block];
        var evaluator;
        switch (beh) {
          case Circuit.B_OUTPUT:
            var inputEvals = state.signalFrom.map(compile);
            evaluator = function () {
              var flag = false;
              inputEvals.forEach(function (f) {
                flag = flag || f();
              });
              state.value = flag;
              if (flag != state.outstate) {
                state.outstate = flag;
                player.render.getWorldRenderer().renderCreateBlock(block); // TODO global variable/wrong world
                scheduleDraw();
              }
            }
            break;
          case Circuit.B_INPUT:
            evaluator = function () {
              state.value = state.st;
            }
            break;
          case Circuit.B_OR:
            var inputEvals = state.signalFrom.map(compile);
            evaluator = function () {
              var flag = false;
              inputEvals.forEach(function (f) {
                flag = flag || f();
              });
              state.value = flag;
            }
            break;
          default:
            evaluator = function () {
              state.value = false;
            }
        }
        evaluators.push(evaluator);
        return function () { return state.value; };
      }
      outputs.forEach(compile);
      
      evaluate = function () {
        evaluators.forEach(function (f) { f(); });
      }
    };
    this.getBlockState = function (block) {
      return blockState[block];
    };
    
    this.setStandingOn = function (cube,value) {
      blockState[cube].st = value;
      evaluate();
    }
    
    Object.freeze(this);
  }
  
  // block behavior enums
  Circuit.B_WIRE = "W";
  Circuit.B_INPUT = "I";
  Circuit.B_OUTPUT = "O";
  Circuit.B_OR = "OR";

  return Object.freeze(Circuit);
})();
