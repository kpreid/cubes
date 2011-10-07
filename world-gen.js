function generateWorlds() {
  "use strict";
  
  var TILE_SIZE = World.TILE_SIZE;
  
  var blockWorldSize = [TILE_SIZE,TILE_SIZE,TILE_SIZE];
  var blockWorldCount = 16;
  var blockWorlds = [];
  for (var i = 0; i < blockWorldCount; i++) blockWorlds.push(new World(blockWorldSize, BlockSet.colors));

  // --- block worlds ---

  // TODO: move to BlockSet.colors
  function brgb(r,g,b) {
    return (((b * 3) << 4) + ((g * 3) << 2) + (r * 3) << 0) || 0xC0;
  }
  
  // condition functions for procedural block generation
  // Takes a coordinate vector and returns a boolean.
  // TODO: Parameterize on TILE_SIZE.
  function vx(b) { return b[0]; }
  function vy(b) { return b[1]; }
  function vy(b) { return b[2]; }
  function vz(b) { return b[1]; }
  function te(b) { return b[1] == 15 ?1:0; }
  function tp(b) { return b[1] == 14 ?1:0; }
  function be(b) { return b[1] == 0 ?1:0; }
  function bp(b) { return b[1] == 1 ?1:0; }
  function se(b) { return (b[2] == 0 || b[2] == 15 || b[0] == 0 || b[0] == 15) ?1:0; }
  function sp(b) { return (b[2] == 1 || b[2] == 14 || b[0] == 1 || b[0] == 14) ?1:0; }
  function xe(b) { return (b[0] == 0 || b[0] == 15) ?1:0; }
  function ze(b) { return (b[2] == 0 || b[2] == 15) ?1:0; }
  function s(b) { return te(b) + be(b) + xe(b) + ze(b); }
  function e(b) { return s(b) > 1 ?1:0; }
  function c(b) { return s(b) > 2 ?1:0; }
  function rad(b) { 
    return Math.sqrt(
      Math.pow(b[0]-TILE_SIZE/2+0.5, 2) +
      Math.pow(b[1]-TILE_SIZE/2+0.5, 2) +
      Math.pow(b[2]-TILE_SIZE/2+0.5, 2)
    );
  }
  
  function pick(a) {
    return a[Math.floor(Math.random() * a.length)];
  }
  function pickColor() {
    return Math.floor(Math.random() * 256);
  }
  function pickCond(p1, p2) {
    var cond = pick([te,tp,be,bp,se,sp,s,e,c]);
    return function (b) { return cond(b) ? p1(b) : p2(b); }
  }
  
  function flat(color) {
    return function (b) { return color; }
  }
  function rgbPat(b) { return brgb(b[0]/16*1.34,b[1]/16*1.34,b[2]/16*1.34); }
  function speckle(p1, p2) {
    return function (b) {
      return (Math.floor(b[0]/4) + b[1] + Math.floor(b[2]/2)) % 4 ? p1(b) : p2(b);
    };
  }
  
  function genedit(world, patfunc) {
    world.edit(function (x,y,z,value) {
      return patfunc([x,y,z]);
    });
  }
  
  // color cube - world base
  genedit(blockWorlds[0], function (b) {
    return rgbPat(b);
  });
  
  // ground block
  genedit(blockWorlds[1], function (b) {
    return (te(b) ? speckle(flat(brgb(.67,.34,.34)), flat(brgb(.67,0,0))) :
            tp(b) ? flat(brgb(1,.34,.34)) :
            speckle(flat(brgb(.34,0,0)), flat(brgb(0,0,0))))(b);
  });
  
  // ground block #2
  genedit(blockWorlds[2], function (b) {
    return (te(b) ? speckle(flat(brgb(.34,.67,.34)), flat(brgb(0,.34,0))) :
            tp(b) ? flat(brgb(.34,1,.34)) :
            speckle(flat(brgb(0,.34,0)), flat(brgb(0,1,1))))(b);
  });
  
  // pyramid thing
  genedit(blockWorlds[3], function (b) {
    return Math.abs(b[0] - 8) + Math.abs(b[2] - 8) <= 16-b[1] ? b[1]/2 : 0;
  });
  
  // "leaf block" transparency test
  genedit(blockWorlds[4], function (b) {
    return s(b) ? speckle(flat(0), flat(brgb(0,1,0)))(b) : 0;
  });

  // pillar thing
  genedit(blockWorlds[5], function (b) {
    return Math.max(Math.abs(b[0] - 8), Math.abs(b[2] - 8)) <= 4 ? 18 : 0;
  });
  
  // wire
  genedit(blockWorlds[6], function (b) {
    return (e(b) && (b[0]+b[1]+b[2])%2) ? brgb(0,1,1) : 0;
  });
  
  // or/bend block
  genedit(blockWorlds[7], function (b) {
    return (e(b) && (b[0]+b[1]+b[2])%2) ? brgb(0,1,1) :
           rad(b) < 3 ? brgb(0.5,0.5,0.5) : 0;
  });
  
  // input and output have block appearances for now
  
  for (var i = 8; i < blockWorldCount; i++) {
    var c = pickCond(flat(pickColor()), 
              pickCond(flat(pickColor()), 
                speckle(flat(pickColor()), flat(pickColor()))));
    genedit(blockWorlds[i], c);
  }
  
  // --- big world ---
  
  var blockset = BlockSet.newTextured(blockWorlds);
  
  var CW,CI,CO,COR;
  blockset.setBehavior((CW=7) -1, Circuit.B_WIRE);
  blockset.setBehavior((COR=8)-1, Circuit.B_OR);
  blockset.setBehavior((CI=9) -1, Circuit.B_INPUT);
  blockset.setBehavior((CO=10)-1, Circuit.B_OUTPUT);
  
  var topWorld = new World([400,128,400], blockset);
  var wx = topWorld.wx;
  var wy = topWorld.wy;
  var wz = topWorld.wz;
  var mid = wy / 2;
  var sin = Math.sin;
  var round = Math.round;
  // Using raw array access because it lets us cache the altitude computation, not because the overhead of .edit() is especially high.
  var raw = topWorld.raw;
  for (var x = 0; x < wx; x++) {
    var xbase = x*wy*wz;
    for (var z = 0; z < wz; z++) {
      var terrain = mid + round(
        (sin(x/8) + sin(z/8))*1
        + (sin(x/14) + sin(z/14))*3
        + (sin(x/2) + sin(z/2))*0.6
      );
      for (var y = 0; y < wy; y++) {
        var index = xbase + y*wz + z;
        var altitude = y - terrain;
        raw[index] = altitude > 1 ? 0 :
                     altitude < 0 ? 1 :
                     altitude == 0 ? 2 :
                     /* altitude == 1 */ Math.random() > 0.99 ? 4 : 0;
      }
    }
  }    
  
  // circuit test
  topWorld.s(200,72,203,CI);
  topWorld.s(201,72,203,CW);
  topWorld.s(202,72,203,CW);
  topWorld.s(203,72,203,CO);
  topWorld.s(204,72,203,CW);
  topWorld.s(205,72,203,COR);
  topWorld.s(205,72,202,CW);
  topWorld.s(205,72,201,CI);

  topWorld.rebuildCircuits();
  
  return topWorld;
}
