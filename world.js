// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

function World(sizes, blockSet) {
  "use strict";
  
  var self = this;

  var wx = sizes[0];
  var wy = sizes[1];
  var wz = sizes[2];
  var blocks = new Uint8Array(wx*wy*wz);
  var subData = new Uint8Array(wx*wy*wz);
  
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
  
  // --- Methods ---
  
  function g(x,y,z) {
    if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
      return 0;
    else
      return blocks[x*wy*wz + y*wz + z];
  }
  function gt(x,y,z) {
    return blockSet.get(g(x,y,z));
  }
  function gRot(x,y,z) {
    if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
      return 0;
    else
      return blocks[x*wy*wz + y*wz + z];
  }
  function s(x,y,z,val,subdatum) { // TODO revisit making this not take a vec
    if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
      return;
    
    var index = x*wy*wz + y*wz + z
    blocks[index] = val;
    subData[index] = subdatum;
    
    var vec = [x,y,z];
    if (changeListener) changeListener.dirtyBlock(vec);
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
  
  function serialize() {
    return {
      wx: wx,
      wy: wy,
      wz: wz,
      blockSet: blockSet.serialize(),
      blockCodeBase: RLE_BASE,
      blocks: rleBytes(blocks),
      subData: rleBytes(subData)
    };
  }
  
  // --- Final init ---
  
  this.g = g;
  this.gt = gt;
  this.gRot = gRot;
  this.s = s;
  this.solid = solid;
  this.opaque = opaque;
  this.raw = blocks;
  // TODO: Defining the rotations as being identical to the subdata is a placeholder until we have circuits.
  this.rawRotations = this.rawSubData = subData;
  this.raycast = raycast;
  this.edit = edit;
  this.step = step;
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

World.unserialize = function (json) {
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
  
  var world = new World([json.wx, json.wy, json.wz], BlockSet.unserialize(json.blockSet));
  var str = json.blocks;
  unrleBytes(json.blocks, world.raw);
  unrleBytes(json.subData, world.rawSubData);
  return world;
};

Object.freeze(World);