// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Circuit = (function () {
  "use strict";
  var DEBUG_WIRE = false;
  
  // These are slice'd because the circuit code does foo[aDirection] a lot, so we want the toString() behavior of real JS arrays. TODO: Review whether it would be better to use symbol strings (e.g. "px", "py", ...) or numbers for directions.
  var DIRECTIONS = Object.freeze([
    Array.prototype.slice.call(UNIT_PX),
    Array.prototype.slice.call(UNIT_PY),
    Array.prototype.slice.call(UNIT_PZ),
    Array.prototype.slice.call(UNIT_NX),
    Array.prototype.slice.call(UNIT_NY),
    Array.prototype.slice.call(UNIT_NZ),
  ]);
  
  function blockOutputKeys(block) {
    return DIRECTIONS.map(function (direction) {
      return block + "/" + direction;
    });
  }
  
  function dirKeys(value) {
    var o = {};
    DIRECTIONS.forEach(function (direction) {
      o[direction] = value;
    });
    return o;
  }
  
  var IN = "IN";
  var OUT = "OUT";
  var NONE = "NONE";
  
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
      return beh.faces[Array.prototype.slice.call(direction)] == OUT;
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
        if (beh && beh != Circuit.behaviors.wire) {
          // Initialize state
          cGraph[block] = {};
          
          // Build indexes
          nodes.push(block);
          if (beh.hasEffect) {
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
          } else if (bnBeh == Circuit.behaviors.wire) {
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
        DIRECTIONS.forEach(function (direction) {
          if (""+direction === ""+comingFrom) {
            // don't look backward
            return;
          }
          
          if (cGraph[block][direction]) {
            // already traced
            return;
          }
          
          // non-junctions get separate nets, junctions extend nets
          if (getBehavior(block) !== Circuit.behaviors.junction) {
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
        if (getBehavior(block) == Circuit.behaviors.junction) {
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
        
        var beh = getBehavior(block);
        var faces = beh.faces;
        var inputGetters = {};
        DIRECTIONS.forEach(function (direction) {
          var net = cGraph[block][direction];
          if (net)
            inputGetters[direction] = netEvaluator(net);
        });
        
        evaluators.push(beh.compile(world, block, inputGetters));
      }
      outputs.forEach(compile);
      
      evaluate = function (state) {
        if (!state) state = {};
        evaluators.forEach(function (f) { f(state); });
      };
      
      //refreshLocal(); // TODO: do later, in case of inf update loops
    };
    this.evaluate = function (state) {
      evaluate(state);
    };
    this.refreshLocal = function () {
      localState = {
        allowWorldEdit: true
      };
      evaluate(localState);
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
      DIRECTIONS.forEach(function (direction) {
        var net = graph[direction];
        if (net)
          s += "\n" + direction + " " + net + " ← " + localState[block+"/"+direction]
      });
      return s;
    }
    
    this.setStandingOn = function (cube, value) {
      getBehavior(cube).standingOn(this, cube, value);
    }
    
    Object.freeze(this);
  }
  
  var behaviors = Circuit.behaviors = {};
  
  (function () {
    function nb(name, proto) {
      var beh = Object.create(proto);
      beh.name = name;
      behaviors[name] = beh;
      return beh;
    }
    function uniformOutput(block, state, value) {
      blockOutputKeys(block).forEach(function (k) {
        state[k] = value;
      });
    }
    function combineInputs(inputs, faces) {
      // TODO: combine more cleverly than 'or'
      var inputEvals = [];
      faces.forEach(function (direction) {
        if (inputs[direction])
          inputEvals.push(inputs[direction]);
      });
      return function (state) {
        var flag = false;
        inputEvals.forEach(function (f) {
          flag = flag || f(state);
        });
        return flag;
      }
    }
    
    var protobehavior = {};
    protobehavior.faces = dirKeys(NONE);
    protobehavior.hasEffect = false;
    protobehavior.standingOn = function (circuit, cube, value) {};
    protobehavior.executeForBlock = function (world, cube, subDatum) {};

    nb("wire", protobehavior);
    
    var inputOnlyBeh = Object.create(protobehavior);
    inputOnlyBeh.hasEffect = true;
    inputOnlyBeh.faces = dirKeys(IN);
    
    var outputOnlyBeh = Object.create(protobehavior);
    outputOnlyBeh.faces = dirKeys(OUT);
    
    var pad = nb("pad", outputOnlyBeh);
    pad.compile = function (world, block, inputs) {
      return function (state) {
        uniformOutput(block, state, world.gSub(block[0],block[1],block[2]));
      };
    };
    pad.standingOn = function (circuit, cube, value) {
      if (!circuit.world.gSub(cube[0],cube[1],cube[2]) != !value) {
        circuit.world.sSub(cube[0],cube[1],cube[2],value);
        circuit.refreshLocal();
      }
    };
    
    var indicator = nb("indicator", inputOnlyBeh);
    indicator.compile = function (world, block, inputs) {
      var input = combineInputs(inputs, DIRECTIONS);
      return function (state) {
        var flag = input(state);
        var cur = world.gSub(block[0],block[1],block[2]);
        if (!flag != !cur && state.allowWorldEdit) {
          world.sSub(block[0],block[1],block[2], flag ? 1 : 0);
        }
      };
    };
    
    var junction = nb("junction", protobehavior);
    
    var nor = nb("nor", protobehavior);
    nor.faces = dirKeys(OUT);
    nor.faces["1,0,0"] = nor.faces["-1,0,0"] = IN;
    nor.compile = function (world, block, inputs) {
      var input = combineInputs(inputs, [[-1,0,0],[1,0,0]]);
      return function (state) {
        var flag = input(state);
        state[block + "/0,0,1"] = !flag;
        state[block + "/0,0,-1"] = !flag;
        state[block + "/0,1,0"] = !flag;
        state[block + "/0,-1,0"] = !flag;
      };
    };
    
    var getSubDatum = nb("getSubDatum", outputOnlyBeh);
    getSubDatum.compile = function (world, block, inputs) {
      return function (state) {
        uniformOutput(block, state, state.blockIn_subDatum);
      };
    };
    
    var setrotation = nb("setrotation", inputOnlyBeh);
    setrotation.compile = function (world, block, inputs) {
      var input = combineInputs(inputs, DIRECTIONS);
      return function (state) {
        state.blockout_rotation = input(state);
      };
    };
    
    Object.freeze(behaviors);
  })();
  
  Circuit.executeCircuitInChangedBlock = function (blockWorld, outerWorld, cube, subDatum) {
    var circuits = blockWorld.getCircuits();
    for (var ck in circuits) {
      if (!circuits.hasOwnProperty(ck)) continue;
      var state = {blockIn_subDatum: subDatum};
      //debugger;
      circuits[ck].evaluate(state);
      if ("blockout_rotation" in state) {
        outerWorld.rawRotations[cube[0]*outerWorld.wy*outerWorld.wz+cube[1]*outerWorld.wz+cube[2]] // TODO KLUDGE
          = state.blockout_rotation;
      }
    }
  };
  
  return Object.freeze(Circuit);
})();
