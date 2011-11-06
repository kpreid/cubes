// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var WorldGen = (function () {
  "use strict";
  
  var WorldGen = {
    // Generate a blockset containing RGB colors with the specified number of
    // levels in each channel, and a function from (r,g,b) to block ID.
    colorBlocks: function (reds, greens, blues) {
      if (reds*greens*blues >= 256)
        throw new Error("Color resolution would result in " + reds*greens*blues + " > 255 colors.");
    
      // convert color components in [0,1] to block ID
      function colorToID(r,g,b) {
        // || 1 is protection against generating air from invalid input
        if (r < 0 || g < 0 || b < 0 || r > 1 || g > 1 || b > 1) {
          throw new Error("bad color " + r + " " + g + " " + b);
        }
        var r = 1 +                Math.floor(r*(reds-1))
                  + reds*(         Math.floor(g*(greens-1))
                          + greens*Math.floor(b*(blues-1)));
        if (r < 1 || r > 245) debugger;
        return r;
      }

      // convert block ID to RGBA tuple
      function idToColor(id) {
        var i = id - 1;
        return [
          mod(i, reds) / (reds-1),
          mod(Math.floor(i/reds), greens) / (greens-1),
          mod(Math.floor(i/reds/greens), blues) / (blues-1),
          1
        ];
      }

      var colors = [];
      for (var i = 1; i < (reds*greens*blues)+1; i++) {
        colors.push(new BlockType.Color(idToColor(i)));
      }
      var colorSet = new BlockSet(colors);

      return {
        blockset: colorSet,
        colorToID: colorToID,
        idToColor: idToColor
      };
    }
  };
  
  return Object.freeze(WorldGen);
})();
  
// TODO: refactor this into WorldGen methods
function generateWorlds() {
  "use strict";

  // Given an object facing the +z direction, these will rotate that face to...
  var sixFaceRotations = [0/*+z*/, 2/*-z*/, 4/*+y*/, 4+2/*-y*/, 16+8/*-x*/, 16+11/*+x*/];

  // --- color worlds ---
  
  var colors = WorldGen.colorBlocks(7,7,5);
  var colorSet = colors.blockset;
  var brgb = colors.colorToID;

  // --- block worlds ---
  
  var TILE_SIZE = World.TILE_SIZE;
  var blockWorldSize = [TILE_SIZE,TILE_SIZE,TILE_SIZE];
  var blockWorldCount = 16;
  var types = [];
  for (var i = 0; i < blockWorldCount; i++)
    types.push(new BlockType.World(new World(blockWorldSize, colorSet)));

  // condition functions for procedural block generation
  // Takes a coordinate vector and returns a boolean.
  // TODO: Parameterize fully on TILE_SIZE.
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
    return Math.floor(Math.random() * colorSet.length);
  }
  function pickCond(p1, p2) {
    var cond = pick([te,tp,be,bp,se,sp,s,e,c]);
    return function (b) { return cond(b) ? p1(b) : p2(b); }
  }
  
  function flat(color) {
    return function (b) { return color; }
  }
  function rgbPat(b) { return brgb(b[0]/15,b[1]/15,b[2]/15); }
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
  genedit(types[0].world, function (b) {
    return rgbPat(b);
  });
  
  // ground block
  genedit(types[1].world, function (b) {
    return (te(b) ? speckle(flat(brgb(.67,.34,.34)), flat(brgb(.67,0,0))) :
            tp(b) ? flat(brgb(1,.34,.34)) :
            speckle(flat(brgb(.34,0,0)), flat(brgb(0,0,0))))(b);
  });
  types[1].spontaneousConversion = 2+1;
  
  // ground block #2
  genedit(types[2].world, function (b) {
    return (te(b) ? speckle(flat(brgb(.34,.67,.34)), flat(brgb(0,.34,0))) :
            tp(b) ? flat(brgb(.34,1,.34)) :
            speckle(flat(brgb(0,.34,0)), flat(brgb(0,1,1))))(b);
  });
  types[2].spontaneousConversion = 1+1;
  
  // pyramid thing
  genedit(types[3].world, function (b) {
    if (Math.abs(b[0] - 7.5) + Math.abs(b[1] - 7.5) > 15.5-b[2])
      return 0;
    return brgb(mod((b[2]+2)/8, 1), Math.floor((b[2]+2)/8)*0.5, 0);
  });
  types[3].automaticRotations = sixFaceRotations;
  
  // "leaf block" transparency test
  genedit(types[4].world, function (b) {
    return s(b) ? speckle(flat(0), flat(brgb(0,1,0)))(b) : 0;
  });

  // pillar thing
  genedit(types[5].world, function (b) {
    return Math.max(Math.abs(b[0] - 8), Math.abs(b[2] - 8)) <= 4 ? brgb(.5,.5,0) : 0;
  });
  
  // wire
  genedit(types[6].world, function (b) {
    return (e(b) && (b[0]+b[1]+b[2])%2) ? brgb(0,1,1) : 0;
  });
  
  // or/bend block
  genedit(types[7].world, function (b) {
    return (e(b) && (b[0]+b[1]+b[2])%2) ? brgb(0,1,1) :
           rad(b) < 3 ? brgb(0.5,0.5,0.5) : 0;
  });
  
  // input and output have block appearances for now
  
  for (var i = 8; i < blockWorldCount; i++) {
    var c = pickCond(flat(pickColor()), 
              pickCond(flat(pickColor()), 
                speckle(flat(pickColor()), flat(pickColor()))));
    genedit(types[i].world, c);
  }
  
  // --- main blockset ---
  
  var blockset = new BlockSet(types);
  
  var CW,CI,CO,COR;
  blockset.get(CW=7 ).behavior = Circuit.B_WIRE;
  blockset.get(COR=8).behavior = Circuit.B_JUNCTION;
  blockset.get(CI=9 ).behavior = Circuit.B_INPUT;
  blockset.get(CO=10).behavior = Circuit.B_OUTPUT;
  
  // --- big world ---

  var topWorld = new World([400,128,400], blockset);
  var wx = topWorld.wx;
  var wy = topWorld.wy;
  var wz = topWorld.wz;
  var mid = wy / 2;
  var sin = Math.sin;
  var round = Math.round;
  // Using raw array access because it lets us cache the altitude computation, not because the overhead of .edit() is especially high.
  var raw = topWorld.raw;
  var rawSubData = topWorld.rawSubData;
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
                     /* altitude == 1 */ Math.random() > 0.99 ? (rawSubData[index] = 4, 4) : 0;
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
