// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

function World(sizes, blockSet) {
  "use strict";
  
  var self = this;

  var world = this;

  var wx = sizes[0];
  var wy = sizes[1];
  var wz = sizes[2];
  var blocks = new Uint8Array(wx*wy*wz);
  var rotations = new Uint8Array(wx*wy*wz);
  var subData = new Uint8Array(wx*wy*wz);
  
  // Maps from "x,y,z" to circuit object
  var blockCircuits = {};
  
  // Maps from an arbitrary block "x,y,z" to circuit object (no duplicate circuits)
  var circuits = {};
  
  var spontaneousBaseRate = 0.00003; // probability of block spontaneous effect call per block per second
  var numToDisturb = wx*wy*wz * TIMESTEP * spontaneousBaseRate;
  
  var changeListener = null;
  
  // --- Internal functions ---
  
  function intbound(s, ds) {
    // Find the smallest positive t such that s+t*ds is an integer.
    if (ds < 0) {
      return intbound(-s, -ds);
    } else {
      s = mod(s, 1);
      // problem is now s+t*ds = 1
      return (1-s)/ds;
    }
  }
  
  function isCircuitPart(value) {
    return !!blockSet.get(value).behavior;
  }
  
  function deleteCircuit(circuit) {
    circuit.blocks.forEach(function (block) {
      delete circuits[block];
      delete blockCircuits[block];
    });

    if (changeListener) changeListener.deletedCircuit(circuit);
  }
  
  // Flood-fill additional circuit parts adjacent to 'start'
  function floodCircuit(circuit, start) {
    if (!circuit) throw new Error("floodCircuit not given a circuit");
    var q = [start];
    
    var block;
    while (block = q.pop()) {
      if (isCircuitPart(g(block[0],block[1],block[2]))) {
        var existing = blockCircuits[block];
        if (existing === circuit) {
          continue; // don't add and don't traverse
        } else if (existing !== circuit && existing !== undefined) {
          console.log("floodCircuit met a different circuit!");
          deleteCircuit(existing);
        }
        circuit.add(block);
        blockCircuits[block] = circuit;

        for (var dim = 0; dim < 3; dim++) {
          var b2 = block.slice();
          b2[dim]++;
          q.push(b2);
          b2 = block.slice();
          b2[dim]--;
          q.push(b2);
        }
      }
    }
    
    circuit.compile();
    if (changeListener) changeListener.dirtyCircuit(circuit);
  }
  
  function becomeCircuit(block) {
    var x = block[0];
    var y = block[1];
    var z = block[2];

    var adjCircuits = [blockCircuits[[x-1,y,z]], blockCircuits[[x,y-1,z]], blockCircuits[[x,y,z-1]],
                       blockCircuits[[x+1,y,z]], blockCircuits[[x,y+1,z]], blockCircuits[[x,y,z+1]]];
    var circuit = null;
    adjCircuits.forEach(function (c) {
      if (c == null) return;
      if (circuit == null) {
        circuit = c;
      }
    });
    if (!circuit) {
      circuit = new Circuit(world);
      circuits[block] = circuit;
    }
    floodCircuit(circuit, block);
  }
  
  // --- Methods ---
  
  // Return the block ID at the given coordinates
  function g(x,y,z) {
    if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
      return 0;
    else
      return blocks[x*wy*wz + y*wz + z];
  }
  // Return the block type at the given coordinates
  function gt(x,y,z) {
    return blockSet.get(g(x,y,z));
  }
  // Return the block subdatum at the given coordinates
  function gSub(x,y,z) {
    if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
      return 0;
    else
      return subData[x*wy*wz + y*wz + z];
  }
  // Return the block rotation at the given coordinates
  function gRot(x,y,z) {
    if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
      return 0;
    else
      return rotations[x*wy*wz + y*wz + z];
  }
  function s(x,y,z,val,subdatum) { // TODO revisit making this not take a vec
    if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
      return;
    
    var index = x*wy*wz + y*wz + z

    if (blocks[index] === val && subData[index] === +subdatum)
      return;

    blocks[index] = val;
    subData[index] = subdatum;
    
    var vec = [x,y,z];
    reeval(vec);
    if (changeListener) changeListener.dirtyBlock(vec);

    // Update circuits
    var vec = [x,y,z];
    var cp = isCircuitPart(val);
    if (cp && !blockCircuits[vec]) {
      becomeCircuit(vec);
    } else if (!cp && blockCircuits[vec]) {
      // No longer a circuit part.
      console.log("deleting dead circuit");
      deleteCircuit(blockCircuits[vec]);
      [[x-1,y,z], [x,y-1,z], [x,y,z-1], [x+1,y,z], [x,y+1,z], [x,y,z+1]].forEach(function (neighbor) {
        if (isCircuitPart(g(neighbor[0],neighbor[1],neighbor[2]))) becomeCircuit(neighbor);
      })
    }
  }
  function sSub(x,y,z,subdatum) {
    s(x,y,z,g(x,y,z),subdatum);
  }
  function solid(x,y,z) {
    return g(x,y,z) != 0;
  }
  function opaque(x,y,z) {
    return gt(x,y,z).opaque;
  }
  
  /**
   * Call the callback with (x,y,z,value,face) of all blocks along the line
   * segment from pt1, through pt2, of length radius. 'face' is the normal
   * vector of the face of that block that was entered.
   *
   * If the callback returns a true value, the traversal will be stopped.
   */
  function raycast(pt1, pt2, radius, callback) {
    // From "A Fast Voxel Traversal Algorithm for Ray Tracing"
    // by John Amanatides and Andrew Woo, 1987
    // http://www.cse.yorku.ca/~amana/research/grid.pdf
    // http://citeseer.ist.psu.edu/viewdoc/summary?doi=10.1.1.42.3443
    // The radius limit is my addition.
    var x = Math.floor(pt1[0]);
    var y = Math.floor(pt1[1]);
    var z = Math.floor(pt1[2]);
    var dx = pt2[0] - pt1[0];
    var dy = pt2[1] - pt1[1];
    var dz = pt2[2] - pt1[2];
    var stepX = signum(dx);
    var stepY = signum(dy);
    var stepZ = signum(dz);
    var tMaxX = intbound(pt1[0], dx);
    var tMaxY = intbound(pt1[1], dy);
    var tMaxZ = intbound(pt1[2], dz);
    var tDeltaX = stepX/dx;
    var tDeltaY = stepY/dy;
    var tDeltaZ = stepZ/dz;
    var face = [0,0,0];
    
    // 't' is in units of (pt2-pt1), so adjust radius in blocks by that
    radius /= Math.sqrt(dx*dx+dy*dy+dz*dz);
    
    //console.log(stepX, stepY, stepZ, dx, dy, dz, tDeltaX, tDeltaY, tDeltaZ);
    while (true) {
      if (!(x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz))
        if (callback(x, y, z, blocks[x*wy*wz + y*wz + z], face))
          break;

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          if (tMaxX > radius) break;
          x += stepX;
          tMaxX += tDeltaX;
          face = [-stepX,0,0];
        } else {
          if (tMaxZ > radius) break;
          z += stepZ;
          tMaxZ += tDeltaZ;
          face = [0,0,-stepZ];
        }
      } else {
        if (tMaxY < tMaxZ) {
          if (tMaxY > radius) break;
          y += stepY;
          tMaxY += tDeltaY;
          face = [0,-stepY,0];
        } else {
          if (tMaxZ > radius) break;
          z += stepZ;
          tMaxZ += tDeltaZ;
          face = [0,0,-stepZ];
        }
      }
    }
  };
  
  function edit(func) {
    for (var x = 0; x < wx; x++) {
      var xbase = x*wy*wz;
      for (var y = 0; y < wy; y++) {
        var ybase = xbase + y*wz;
        for (var z = 0; z < wz; z++) {
          var index = ybase + z;
          blocks[index] = func(x,y,z,blocks[index]);
          subData[index] = 0;
          reeval([x,y,z]);
        }
      }
    }
  }
  
  // Perform actions related to block circuits immediately after a change
  function reeval(cube) {
    var x = cube[0];
    var y = cube[1];
    var z = cube[2];
    var index = x*wy*wz + y*wz + z;
    var subWorld = blockSet.get(blocks[index]).world;
    // TODO: optimize this path so we don't need to look up circuits
    if (subWorld)
      Circuit.executeCircuitInChangedBlock(subWorld, self, cube, subData[index]);
  }
  this.forceReeval = reeval; // Exposed only for the sake of raw editing
  
  function rebuildCircuits() {
    blockCircuits = {};
    circuits = {};
    var vec;
    for (var x = 0; x < wx; x++) {
      var xbase = x*wy*wz;
      for (var y = 0; y < wy; y++) {
        var ybase = xbase + y*wz;
        for (var z = 0; z < wz; z++) {
          var value = blocks[ybase + z];
          if (isCircuitPart(value) && !blockCircuits[vec = [x,y,z]]) {
            var circuit = new Circuit(this);
            circuits[vec] = circuit;
            floodCircuit(circuit, vec);
          }
        }
      }
    }
  }
  
  function step() {
    // turn fractional part of number of iterations into randomness - 1.25 = 1 3/4 and 2 1/4 of the time
    var roundedNum = Math.floor(numToDisturb) + (Math.random() < (numToDisturb % 1) ? 1 : 0);
    
    for (var i = 0; i < roundedNum; i++) {
      var x = Math.floor(Math.random() * wx);
      var y = Math.floor(Math.random() * wy);
      var z = Math.floor(Math.random() * wz);
      
      gt(x,y,z).doSpontaneousEffect(self, [x,y,z], spontaneousBaseRate);
    }
  }
  
  function setStandingOn(cube, value) {
    var circuit = blockCircuits[cube];
    if (circuit) {
      circuit.setStandingOn(cube, value);
    }
  }
  
  function setChangeListener(l) {
    if (changeListener !== l && changeListener !== null && l !== null) {
      throw new Error("conflicting change listeners");
    }
    changeListener = l;
  }
  
  var RLE_BASE = 0xA1;
  function rleBytes(bytes) {
    var ser = [];
    
    var seen = null;
    var count = 0;
    var len = bytes.length;
    for (var i = 0; i < len; i++) {
      var value = bytes[i];
      if (seen === value || seen === null) {
        count++;
      } else {
        ser.push(String.fromCharCode(RLE_BASE + seen) + count);
        count = 1;
      }
      seen = value;
    }
    if (count > 0) {
      ser.push(String.fromCharCode(RLE_BASE + seen) + count);
    }
    return ser.join("");
  }
  
  function serialize(subSerialize) {
    return {
      wx: wx,
      wy: wy,
      wz: wz,
      blockSet: subSerialize(blockSet),
      blockCodeBase: RLE_BASE,
      blocks: rleBytes(blocks),
      subData: rleBytes(subData)
    };
  }
  
  // --- Final init ---
  
  this.g = g;
  this.gt = gt;
  this.gRot = gRot;
  this.gSub = gSub;
  this.s = s;
  this.sSub = sSub;
  this.solid = solid;
  this.opaque = opaque;
  this.raw = blocks;
  this.rebuildCircuits = rebuildCircuits;
  // TODO: Defining the rotations as being identical to the subdata is a placeholder until we have circuits.
  this.rawSubData = subData;
  this.rawRotations = rotations;
  this.raycast = raycast;
  this.getCircuits = function () { return circuits; }; // TODO should be read-only interface
  this.getCircuit = function (block) { return blockCircuits[block] || null; }
  this.edit = edit;
  this.step = step;
  this.setStandingOn = setStandingOn;
  this.setChangeListener = setChangeListener;
  this.serialize = serialize;
  
  this.wx = wx;
  this.wy = wy;
  this.wz = wz;
  this.blockSet = blockSet;
  Object.freeze(this);
}

// The size of a texture tile, and therefore the size of a block-defining-block
World.TILE_SIZE = 16;

World.unserialize = function (json, unserialize) {
  var base = json.blockCodeBase;
  
  function unrleBytes(str, array) {
    var pat = /(.)([0-9]+)/g;
    var length = array.length;
    var i, match;
    for (i = 0; (match = pat.exec(str)) && i < length;) {
      var blockID = match[1].charCodeAt(0) - base;
      var limit = Math.min(length, i + parseInt(match[2]));
      for (; i < limit; i++) {
        array[i] = blockID;
      }
    }
  }
  
  var world = new World([json.wx, json.wy, json.wz], unserialize(json.blockSet, BlockSet));
  var str = json.blocks;
  unrleBytes(json.blocks, world.raw);
  unrleBytes(json.subData, world.rawSubData);
  world.rebuildCircuits();
  return world;
};

Object.freeze(World);