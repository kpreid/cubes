function World() {
  "use strict";

  var wx = 32;
  var wy = 16;
  var wz = 32;
  var blocks = new Uint8Array(wx*wy*wz);
  
  for (var x = 0; x < wx; x++)
  for (var y = 0; y < wy; y++)
  for (var z = 0; z < wz; z++) {
    blocks[x*wy*wz + y*wz + z] = (wy-y)*70 - ((x-wx/2)*(x-wx/2) + (z-wz/2)*(z-wz/2)) > 0 ? 255 : 0;
  }
  
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
  
  /**
   * Call the callback with (x,y,z,value) of all blocks along the line segment
   * from pt1, through pt2, of length radius.
   *
   * If the callback returns a true value, the traversal will be stopped.
   */
  function raytrace(pt1, pt2, radius, callback) {
    // voxel traversal algorithm
    // http://citeseer.ist.psu.edu/viewdoc/summary?doi=10.1.1.42.3443
    var x = Math.floor(pt1[0]);
    var y = Math.floor(pt1[1]);
    var z = Math.floor(pt1[2]);
    var t = 0;
    var dx = pt2[0] - pt1[0];
    var dy = pt2[1] - pt1[1];
    var dz = pt2[2] - pt1[2];
    var stepX = signum(dx);
    var stepY = signum(dy);
    var stepZ = signum(dz);
    var boundX = intbound(pt1[0], dx);
    var boundY = intbound(pt1[1], dy);
    var boundZ = intbound(pt1[2], dz);
    var tMaxX = Math.min(boundY, boundZ);
    var tMaxY = Math.min(boundX, boundZ);
    var tMaxZ = Math.min(boundX, boundY);
    var tDeltaX = stepX/dx;
    var tDeltaY = stepY/dy;
    var tDeltaZ = stepZ/dz;
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
  
  // --- Final init ---
  
  this.g = g;
  this.s = s;
  this.solid = solid;
  this.raw = blocks;
  this.raytrace = raytrace;
  this.wx = wx;
  this.wy = wy;
  this.wz = wz;
}