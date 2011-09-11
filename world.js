function World(sizes, blockSet) {
  "use strict";

  var wx = sizes[0];
  var wy = sizes[1];
  var wz = sizes[2];
  var blocks = new Uint8Array(wx*wy*wz);
  
  var numToDisturb = wx*wy*wz * 0.000001; // TODO needs to be timestep-dependent
  
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
  function s(x,y,z,val) {
    if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
      return;
    else
      blocks[x*wy*wz + y*wz + z] = val;
  }
  function solid(x,y,z) {
    return g(x,y,z) != 0;
  }
  function opaque(x,y,z) {
    return blockSet.isOpaque(g(x,y,z));
  }
  
  /**
   * Call the callback with (x,y,z,value) of all blocks along the line segment
   * from pt1, through pt2, of length radius.
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
    var t = 0;
    var stepX = signum(dx);
    var stepY = signum(dy);
    var stepZ = signum(dz);
    var tMaxX = intbound(pt1[0], dx);
    var tMaxY = intbound(pt1[1], dy);
    var tMaxZ = intbound(pt1[2], dz);
    var tDeltaX = stepX/dx;
    var tDeltaY = stepY/dy;
    var tDeltaZ = stepZ/dz;
    
    // 't' is in units of (pt2-pt1), so adjust radius in blocks by that
    radius /= Math.sqrt(dx*dx+dy*dy+dz*dz);
    
    //console.log(stepX, stepY, stepZ, dx, dy, dz, tDeltaX, tDeltaY, tDeltaZ);
    while (true) {
      if (!(x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz))
        if (callback(x, y, z, blocks[x*wy*wz + y*wz + z]))
          break;

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          if (tMaxX > radius) break;
          x += stepX;
          tMaxX += tDeltaX;
        } else {
          if (tMaxZ > radius) break;
          z += stepZ;
          tMaxZ += tDeltaZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          if (tMaxY > radius) break;
          y += stepY;
          tMaxY += tDeltaY;
        } else {
          if (tMaxZ > radius) break;
          z += stepZ;
          tMaxZ += tDeltaZ;
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
      
      // Placeholder behavior - exchange block ids
      var value = g(x,y,z);
      if (value == 2) value = 3;
      else if (value == 3) value = 2;
      else continue;
      s(x, y, z, value);
      
      player.getWorldRenderer().dirtyBlock(x,z); // TODO global variable
    }
  }
  
  // --- Final init ---
  
  this.g = g;
  this.s = s;
  this.solid = solid;
  this.opaque = opaque;
  this.raw = blocks;
  this.raycast = raycast;
  this.edit = edit;
  this.step = step;
  
  this.wx = wx;
  this.wy = wy;
  this.wz = wz;
  this.blockSet = blockSet;
  Object.freeze(this);
}

// The size of a texture tile, and therefore the size of a block-defining-block
World.TILE_SIZE = 16;

Object.freeze(World);