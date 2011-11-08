// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Circuit = (function () {
  "use strict";
  var DEBUG_WIRE = false;
  
  function blockOutputKeys(block) {
    return UNIT_AXES.map(function (direction) {
      direction = Array.prototype.slice.call(direction);
      return block + "/" + direction;
    });
  }
  
  function Circuit(world) {
    var blockSet = world.blockSet;
    function getBehavior(block) {
      return world.gt(block[0],block[1],block[2]).behavior;
    }
    
    // Blocks making up the circuit
    var blocks = [];
    var aabb = null;
    
    // Circuit topology
    var cGraph = {};
    var cEdges = []; // used for circuit viewing only
    
    var localState = {};
    
    var evaluate = function (state) {throw new Error("uncompiled");};
    
    function refreshLocal() {
      localState = {
        allowWorldEdit: true
      };
      evaluate(localState);
    }
    
    function behaviorFaceIsOutput(beh, direction) {
      var evaluator;
      switch (beh) {
        case Circuit.B_OUTPUT:
          return false;
        case Circuit.B_INPUT:
          return true;
        case Circuit.B_NOR:
          return !direction[0];
        default:
          return false;
      }
    }
    
    // --- Methods ---
    
    this.world = world;
    this.blocks = blocks;
    this.getOrigin = function () {
      return this.blocks[0];
    };
    this.add = function (blockVec) {
      blocks.push(blockVec);
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
    this.compile = function () { // TODO should be implicit
      if (DEBUG_WIRE) console.info("Recompiling a circuit");
      var outputs = [];
      var nodes = [];
      var netSerial = 0;
      
      // Clear and initialize; find active nodes and outputs
      cGraph = {};
      cEdges = [];
      blocks.forEach(function (block) {
        var beh = getBehavior(block);
        if (beh && beh != Circuit.B_WIRE) {
          // Initialize state
          cGraph[block] = {};
          
          // Build indexes
          nodes.push(block);
          if (beh == Circuit.B_OUTPUT) {
            outputs.push(block);
          }
        }
      });
      
      // Build graph edges
      function traceNet(net, block, direction) {
        if (DEBUG_WIRE) console.group("traceNet " + net + " " + block + ":" + getBehavior(block) + " : " + direction);
        direction = Array.prototype.slice.call(direction);
        var bn = block.slice();
        vec3.add(bn, direction, bn);
        for (;; vec3.add(bn, direction, bn)) {
          if (DEBUG_WIRE) console.log("walk " + bn);
          var bnBeh = getBehavior(bn);
          var comingFrom = vec3.negate(direction, []);
          if (!bnBeh) {
            return false; // not a circuit element
          } else if (bnBeh == Circuit.B_WIRE) {
            continue; // pass-through
          } else if (cGraph[bn][comingFrom] && cGraph[bn][comingFrom] !== net) {
            throw new Error("met different net!");
          } else if (cGraph[bn][comingFrom] && cGraph[bn][comingFrom] === net) {
            return true; // already traced -- TODO: this case unnecessary/can'thappen?
          } else {
            // found new unclaimed node
            cGraph[bn][comingFrom] = net;
            net.push([bn,comingFrom]);
            traceIntoNode(net, bn, comingFrom);
            cEdges.push([net,block,bn]);
            return true;
          }
        }
        if (DEBUG_WIRE) console.groupEnd();
      }
      function traceIntoNode(net, block, comingFrom) {
        if (DEBUG_WIRE) console.group("traceIntoNode " + net + " " + block + ":" + getBehavior(block) + " " + comingFrom);
        UNIT_AXES.forEach(function (direction) {
          direction = Array.prototype.slice.call(direction);
          if (""+direction === ""+comingFrom) {
            // don't look backward
            return;
          }
          
          if (cGraph[block][direction]) {
            // already traced
            return;
          }
          
          // non-junctions get separate nets, junctions extend nets
          if (getBehavior(block) !== Circuit.B_JUNCTION) {
            net = [];
            net.serial = netSerial++;
            net.toString = function () { return "net" + net.serial; };
          }
          
          cGraph[block][direction] = net;
          net.push([block,direction]);
          var found = traceNet(net, block, direction);
          
          if (!found) {
            // nothing found, useless net. (Note net will still have entries)
            cGraph[block][direction] = null;
          }
        });
        if (DEBUG_WIRE) console.groupEnd();
      }
      nodes.forEach(function (block) {
        if (DEBUG_WIRE) console.group("root " + block + ":" + getBehavior(block));
        if (getBehavior(block) == Circuit.B_JUNCTION) {
          // do not trace from junctions (not implemented yet)
          if (DEBUG_WIRE) console.groupEnd();
          return;
        }
        traceIntoNode(null, block, null);
        if (DEBUG_WIRE) console.groupEnd();
      });
      
      var evaluators = [];
      var seen = {};
      
      function blockEvaluator(block, faceDirection) {
        compile(block);
        var key = ""+block+"/"+faceDirection;
        return function (state) { return state[key]; };
      }
      
      function netEvaluator(net) {
        compileNet(net);
        var key = net.serial;
        return function (state) { return state[key]; };
      }
      
      function compileNet(net) {
        var key = net.serial;

        if (seen[key]) return;
        seen[key] = true;
        
        var getters = [];
        net.forEach(function (record) {
          var block = record[0];
          var faceDirection = record[1];
          if (behaviorFaceIsOutput(getBehavior(block), faceDirection))
            getters.push(blockEvaluator(block, faceDirection));
        });
        evaluators.push(function (state) {
          var flag = false;
          getters.forEach(function (f) {
            flag = flag || f(state);
          });
          state[key] = flag;
        });
      }
      
      function compile(block, caller) {
        var blockKey = ""+block;
        if (seen[blockKey]) return;
        seen[blockKey] = true;
        
        var outputKeys = blockOutputKeys(block);
        function uniformOutput(state, value) {
          outputKeys.forEach(function (k) {
            state[k] = value;
          });
        }
        
        var beh = getBehavior(block);
        var evaluator;
        switch (beh) {
          case Circuit.B_OUTPUT:
            
            var inputEvals = [];
            UNIT_AXES.forEach(function (direction) {
              direction = Array.prototype.slice.call(direction);
              var net = cGraph[block][direction];
              if (net)
                inputEvals.push(netEvaluator(net));
            });
            evaluator = function (state) {
              var flag = false;
              inputEvals.forEach(function (f) {
                flag = flag || f(state);
              });
              var cur = world.gSub(block[0],block[1],block[2]);
              if (!flag != !cur && state.allowWorldEdit) {
                world.sSub(block[0],block[1],block[2], flag ? 1 : 0);
                player.render.getWorldRenderer().renderCreateBlock(block); // TODO global variable/wrong world
                scheduleDraw();
              }
            };
            break;
          case Circuit.B_INPUT:
            evaluator = function (state) {
              uniformOutput(state, world.gSub(block[0],block[1],block[2]));
            }
            break;
          case Circuit.B_NOR:
            var inputEvals = [];
            [UNIT_PX,UNIT_NX].forEach(function (direction) {
              direction = Array.prototype.slice.call(direction);
              var net = cGraph[block][direction];
              if (net)
                inputEvals.push(netEvaluator(net));
            });
            evaluator = function (state) {
              var flag = false;
              inputEvals.forEach(function (f) {
                flag = flag || f(state);
              });
              state[block + "/0,0,1"] = !flag;
              state[block + "/0,0,-1"] = !flag;
              state[block + "/0,1,0"] = !flag;
              state[block + "/0,-1,0"] = !flag;
            };
            break;
          default:
            evaluator = function (state) {
            }
        }
        evaluators.push(evaluator);
      }
      outputs.forEach(compile);
      
      evaluate = function (state) {
        if (!state) state = {};
        evaluators.forEach(function (f) { f(state); });
      };
      
      //refreshLocal(); // TODO: do later, in case of inf update loops
    };
    this.getEdges = function () {
      return cEdges;
    };
    this.getNetValue = function (net) {
      return localState[net.serial];
    };
    this.describeBlock = function (block) {
      var graph = cGraph[block];
      if (!graph) return "Wire";
      var s = "";
      UNIT_AXES.forEach(function (direction) {
        direction = Array.prototype.slice.call(direction);
        var net = graph[direction];
        if (net)
          s += "\n" + direction + " " + net + " ← " + localState[block+"/"+direction]
      });
      return s;
    }
    
    this.setStandingOn = function (cube,value) {
      if (getBehavior(cube) === Circuit.B_INPUT) {
        if (!world.gSub(cube[0],cube[1],cube[2]) != !value) {
          world.sSub(cube[0],cube[1],cube[2],value);
          refreshLocal();
        }
      }
    }
    
    Object.freeze(this);
  }
  
  // block behavior enums
  Circuit.B_WIRE = "W";
  Circuit.B_INPUT = "I";
  Circuit.B_OUTPUT = "O";
  Circuit.B_JUNCTION = "*";
  Circuit.B_NOR = "NOR";

  return Object.freeze(Circuit);
})();
