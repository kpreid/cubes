// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var WorldGen = (function () {
  "use strict";

  var blockWorldSize = [World.TILE_SIZE,World.TILE_SIZE,World.TILE_SIZE];
  
  var WorldGen = {
    newWorldBlockType: function (blockSet) {
       return new BlockType.World(new World(blockWorldSize, blockSet));
    },
    
    newProceduralBlockType: function (blockSet, patfunc) {
      var type = WorldGen.newWorldBlockType(blockSet);
      type.world.edit(function (x,y,z,value) {
        return patfunc([x,y,z]);
      });
      return type;
    },

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
    },
    
    blockFunctions: (function () {
      // condition functions for procedural block generation
      // Each takes a coordinate vector and returns a boolean.
      // TODO: Parameterize fully on TILE_SIZE.
      var TILE_SIZE = World.TILE_SIZE;
      function vx(b) { return b[0]; }
      function vy(b) { return b[1]; }
      function vz(b) { return b[2]; }
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

      // Pattern functions: each returns a function from a coordinate vector to a block id.
      function pick(a) {
        return a[Math.floor(Math.random() * a.length)];
      }
      function pickColor() {
        return Math.floor(Math.random() * colorSet.length);
      }
      function pickCond(p1, p2) {
        return cond(pick([te,tp,be,bp,se,sp,s,e,c]), p1, p2);
      }
      function cond(cond, p1, p2) {
        return function (b) { return cond(b) ? p1(b) : p2(b); }
      }
      function flat(id) {
        return function (b) { return id; }
      }
      function speckle(p1, p2) {
        return function (b) {
          return (Math.floor(b[0]/4) + b[1] + Math.floor(b[2]/2)) % 4 ? p1(b) : p2(b);
        };
      }

      return Object.freeze({
        vx: vx,
        vy: vy,
        vz: vz,
        te: te,
        tp: tp,
        be: be,
        bp: bp,
        se: se,
        sp: sp,
        xe: xe,
        ze: ze,
        s: s,
        e: e,
        c: c,
        rad: rad,
        pick: pick,
        pickCond: pickCond,
        cond: cond,
        flat: flat,
        speckle: speckle
      });
    })(),
    
    addLogicBlocks: function (blockSet, colorKit, optLogicSetHere) {
      var ids = {};
      var type;
      var f = WorldGen.blockFunctions;
      
      var boxColor = colorKit.colorToID(0,1,1);
      function boxed(insidePat) {
        return function (b) {
          return (f.e(b) && (b[0]+b[1]+b[2])%2) ? boxColor : insidePat(b);
        };
      }
      
      function selfRotating(y) {
        if (optLogicSetHere) {
          type.world.s(7,y,7, optLogicSetHere.getSubDatum);
          type.world.s(7,y,8, optLogicSetHere.setrotation);
        }
      }
      
      // wire
      ids.wire = blockSet.length;
      blockSet.add(type = WorldGen.newProceduralBlockType(colorKit.blockset, boxed(f.flat(0))));
      type.behavior = Circuit.behaviors.wire;

      // junction block
      ids.junction = blockSet.length;
      blockSet.add(type = WorldGen.newProceduralBlockType(colorKit.blockset, boxed(function (b) {
        return f.rad(b) < 3 ? colorKit.colorToID(0.5,0.5,0.5) : 0;
      })));
      type.behavior = Circuit.behaviors.junction;

      // step pad block
      ids.pad = blockSet.length;
      var specklePat = f.speckle(f.flat(colorKit.colorToID(0.5,0.5,0.5)),
                                 f.flat(colorKit.colorToID(0.75,0.75,0.75)));
      blockSet.add(type = WorldGen.newProceduralBlockType(colorKit.blockset, boxed(function (b) {
        return f.rad([b[0],b[1]-8,b[2]]) < 8 ? specklePat(b) : 0;
      })));
      selfRotating(14);
      type.behavior = Circuit.behaviors.pad;

      // indicator block
      ids.indicator = blockSet.length;
      blockSet.add(type = WorldGen.newProceduralBlockType(colorKit.blockset, boxed(function (b) {
        return f.rad([b[0],b[1],b[2]]) > 6 ? 0 :
               b[1] < 8 ? colorKit.colorToID(1,1,1) : colorKit.colorToID(0,0,0);
      })));
      selfRotating(7);
      type.behavior = Circuit.behaviors.indicator;

      // nor block
      ids.nor = blockSet.length;
      blockSet.add(type = WorldGen.newProceduralBlockType(colorKit.blockset, boxed(function (b) {
        return (f.rad([b[0]-3,b[1],b[2]]) < 3.5 || f.rad([b[0]+3,b[1],b[2]]) < 3.5) ? colorKit.colorToID(0.5,0.5,0.5) : 0;
      })));
      type.behavior = Circuit.behaviors.nor;

      // get-subdata block
      ids.getSubDatum = blockSet.length;
      blockSet.add(type = WorldGen.newProceduralBlockType(colorKit.blockset, boxed(function (b) {
        return Math.abs(Math.sqrt(Math.pow(b[0]-7.5,2)+Math.pow(b[2]-7.5,2))*4 - b[1]) <= 1 ? colorKit.colorToID(0.5,0.5,0.5) : 0;
      })));
      type.behavior = Circuit.behaviors.getSubDatum;

      // set-rotation block
      ids.setrotation = blockSet.length;
      blockSet.add(type = WorldGen.newProceduralBlockType(colorKit.blockset, boxed(function (b) {
        var r = f.rad(b);
        function plane(x) { return x >= 7 && x <= 8; }
        return r < 8 && r > 7 && (plane(b[0]) || plane(b[1]) || plane(b[2])) ? colorKit.colorToID(0.5,0.5,0.5) : 0;
      })));
      type.behavior = Circuit.behaviors.setrotation;

      return ids;
    }
  };
  
  return Object.freeze(WorldGen);
})();
  
// TODO: refactor this into WorldGen methods
function generateWorlds() {
  "use strict";

  // Given an object facing the +z direction, these will rotate that face to...
  var sixFaceRotations = [0/*+z*/, 2/*-z*/, 4/*+y*/, 4+2/*-y*/, 16+8/*-x*/, 16+11/*+x*/];

  // --- base blockset ---
  
  var pureColors = WorldGen.colorBlocks(7,7,5);

  var logicAndColors = WorldGen.colorBlocks(7, 6, 5);
  var colorSet = logicAndColors.blockset;
  var brgb = logicAndColors.colorToID;
  var ls = WorldGen.addLogicBlocks(logicAndColors.blockset, pureColors);

  // --- block world generation utilities ---
  
  function genedit(patfunc) {
    return WorldGen.newProceduralBlockType(colorSet, patfunc);
  }
  var f = WorldGen.blockFunctions;

  function pickColor() {
    return Math.floor(Math.random() * colorSet.length);
  }
  function rgbPat(b) { return brgb(b[0]/15,b[1]/15,b[2]/15); }
  
  // --- default block worlds and block set ---

  var type;
  var blockset = new BlockSet([]);

  // color cube - world base and bogus-placeholder
  blockset.add(type = genedit(function (b) {
    return rgbPat(b);
  }));
  
  // ground block
  blockset.add(type = genedit(function (b) {
    return (f.te(b) ? f.speckle(f.flat(brgb(.67,.34,.34)), f.flat(brgb(.67,0,0))) :
            f.tp(b) ? f.flat(brgb(1,.34,.34)) :
            f.speckle(f.flat(brgb(.34,0,0)), f.flat(brgb(0,0,0))))(b);
  }));
  type.spontaneousConversion = 3;
  
  // ground block #2
  blockset.add(type = genedit(function (b) {
    return (f.te(b) ? f.speckle(f.flat(brgb(.34,.67,.34)), f.flat(brgb(0,.34,0))) :
            f.tp(b) ? f.flat(brgb(.34,1,.34)) :
            f.speckle(f.flat(brgb(0,.34,0)), f.flat(brgb(0,1,1))))(b);
  }));
  type.spontaneousConversion = 2;
  
  // pyramid thing
  blockset.add(type = genedit(function (b) {
    if (Math.abs(b[0] - 7.5) + Math.abs(b[1] - 7.5) > 15.5-b[2])
      return 0;
    return brgb(mod((b[2]+2)/8, 1), Math.floor((b[2]+2)/8)*0.5, 0);
  }));
  // rotate-based-on-subdatum circuit
  type.world.s(1,7,0, ls.getSubDatum);
  type.world.s(1,8,0, ls.setrotation);
  type.automaticRotations = sixFaceRotations;
  
  // "leaf block" transparency test
  blockset.add(type = genedit(function (b) {
    return f.s(b) ? f.speckle(f.flat(0), f.flat(brgb(0,1,0)))(b) : 0;
  }));

  // pillar thing
  blockset.add(type = genedit(function (b) {
    return Math.max(Math.abs(b[0] - 8), Math.abs(b[2] - 8)) <= 4 ? brgb(.5,.5,0) : 0;
  }));
  
  var l = WorldGen.addLogicBlocks(blockset, logicAndColors, ls);
  
  for (var i = 0; i < 4; i++) {
    var c = f.pickCond(f.flat(pickColor()),
              f.pickCond(f.flat(pickColor()),
                f.speckle(f.flat(pickColor()), f.flat(pickColor()))));
    blockset.add(genedit(c));
  }
  
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
        if (raw[index] == 4) topWorld.forceReeval([x,y,z]);
      }
    }
  }    
  
  // circuit test
  topWorld.s(200,72,203,l.pad);
  topWorld.s(201,72,203,l.wire);
  topWorld.s(202,72,203,l.wire);
  topWorld.s(203,72,203,l.indicator);
  topWorld.s(204,72,203,l.wire);
  topWorld.s(205,72,203,l.junction);
  topWorld.s(205,72,202,l.wire);
  topWorld.s(205,72,201,l.pad);

  topWorld.s(205,72,204,l.wire);
  topWorld.s(205,72,205,l.nor);
  topWorld.s(204,72,205,l.wire);
  topWorld.s(203,72,205,l.pad);
  topWorld.s(206,72,205,l.wire);
  topWorld.s(207,72,205,l.pad);

  topWorld.rebuildCircuits();
  
  return topWorld;
}
