// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var WorldGen = (function () {
  "use strict";

  var TS = World.TILE_SIZE;
  var TL = TS - 1;
  var blockWorldSize = [TS,TS,TS];
  
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
      function vx(b) { return b[0]; }
      function vy(b) { return b[1]; }
      function vz(b) { return b[2]; }
      function te(b) { return b[1] == TL ?1:0; }
      function tp(b) { return b[1] == TL-1 ?1:0; }
      function be(b) { return b[1] == 0 ?1:0; }
      function bp(b) { return b[1] == 1 ?1:0; }
      function se(b) { return (b[2] == 0 || b[2] == TL   || b[0] == 0 || b[0] == TL  ) ?1:0; }
      function sp(b) { return (b[2] == 1 || b[2] == TL-1 || b[0] == 1 || b[0] == TL-1) ?1:0; }
      function xe(b) { return (b[0] == 0 || b[0] == TL) ?1:0; }
      function ze(b) { return (b[2] == 0 || b[2] == TL) ?1:0; }
      function s(b) { return te(b) + be(b) + xe(b) + ze(b); }
      function e(b) { return s(b) > 1 ?1:0; }
      function c(b) { return s(b) > 2 ?1:0; }
      function rad(b) { 
        return Math.sqrt(
          Math.pow(b[0]-TL/2, 2) +
          Math.pow(b[1]-TL/2, 2) +
          Math.pow(b[2]-TL/2, 2)
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
      function sphere(x,y,z,r,fill) {
        return function (b) {
          return Math.pow(b[0]-x+0.5, 2) +
                 Math.pow(b[1]-y+0.5, 2) +
                 Math.pow(b[2]-z+0.5, 2)
                 < r*r
                 ? fill(b) : 0;
        }
      }
      function plane(dim, low, high, fill) {
        return function (b) {
          var v = b[dim] + 0.5;
          return v > low && v < high ? fill(b) : 0;
        }
      }
      function union(p1, p2) { // p2 wherever p1 is empty, else p1
        return function (b) {
          return p1(b) || p2(b);
        }
      }
      function intersection(p1, p2) { // p1 wherever p2 is nonempty, else empty
        return function (b) {
          return p2(b) ? p1(b) : 0;
        }
      }
      function subtract(p1, p2) { // p1 wherever p2 is empty, else empty
        return function (b) {
          return p2(b) ? 0 : p1(b);
        }
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
        speckle: speckle,
        sphere: sphere,
        plane: plane,
        union: union,
        intersection: intersection,
        subtract: subtract
      });
    })(),
    
    addLogicBlocks: function (blockSet, colorKit, optLogicSetHere) {
      var ids = {};
      var type;
      var f = WorldGen.blockFunctions;
      
      // appearance utilities
      var boxColor = colorKit.colorToID(0,1,1);
      var functionShapeColor = colorKit.colorToID(0.5,0.5,0.5);
      var functionShapePat = f.flat(functionShapeColor);
      function boxed(insidePat) {
        return function (b) {
          return (f.e(b) && (b[0]+b[1]+b[2])%2) ? boxColor : insidePat(b);
        };
      }
      function genedit(pattern) {
        var type = WorldGen.newProceduralBlockType(colorKit.blockset, boxed(pattern));
        blockSet.add(type);
        return type;
      }

      // Add a rotate-based-on-subdata circuit
      function selfRotating(y) {
        if (optLogicSetHere) {
          type.world.s(TS/2,y,TS/2, optLogicSetHere.getSubDatum);
          type.world.s(TS/2,y,TS/2-1, optLogicSetHere.setRotation);
        }
      }
      
      // wire
      ids.wire = blockSet.length;
      type = genedit(f.flat(0));
      type.behavior = Circuit.behaviors.wire;

      // junction block
      ids.junction = blockSet.length;
      type = genedit(f.sphere(TS/2,TS/2,TS/2, TS*3/16, f.flat(functionShapeColor)));
      type.behavior = Circuit.behaviors.junction;

      // step pad block
      ids.pad = blockSet.length;
      var specklePat = f.speckle(f.flat(functionShapeColor),
                                 f.flat(colorKit.colorToID(0.75,0.75,0.75)));
      type = genedit(f.sphere(TS/2,TS-0.5,TS/2,TS/2,specklePat));
      selfRotating(TL-1);
      type.behavior = Circuit.behaviors.pad;

      // indicator block
      ids.indicator = blockSet.length;
      type = genedit(function (b) {
        return f.rad([b[0],b[1],b[2]]) > TS*6/16 ? 0 :
               b[1] < TS/2 ? colorKit.colorToID(1,1,1) : colorKit.colorToID(0,0,0);
      });
      selfRotating(TS/2-1);
      type.behavior = Circuit.behaviors.indicator;

      // nor block
      ids.nor = blockSet.length;
      type = genedit(f.union(f.sphere(TS/2-TS*.2,TS/2,TS/2, TS*3/16, f.flat(functionShapeColor)),
                             f.sphere(TS/2+TS*.2,TS/2,TS/2, TS*3/16, f.flat(functionShapeColor))));
      type.behavior = Circuit.behaviors.nor;

      // get-subdata block
      ids.getSubDatum = blockSet.length;
      type = genedit(function (b) {
        return Math.abs(Math.sqrt(Math.pow(b[0]-TL/2,2)+Math.pow(b[2]-TL/2,2))*4 - b[1]) <= 1 ? functionShapeColor : 0;
      });
      type.behavior = Circuit.behaviors.getSubDatum;

      // set-rotation block
      ids.setRotation = blockSet.length;
      type = genedit(f.intersection(
        f.subtract(
          f.sphere(TS/2,TS/2,TS/2, TS/2, functionShapePat),
          f.sphere(TS/2,TS/2,TS/2, TS/2-2, functionShapePat)),
        f.union(
          f.plane(0, TS/2-1, TS/2+1, functionShapePat),
          f.union(
            f.plane(1, TS/2-1, TS/2+1, functionShapePat),
            f.plane(2, TS/2-1, TS/2+1, functionShapePat)))))
      type.behavior = Circuit.behaviors.setRotation;

      // emit-value block
      ids.emitUniform = blockSet.length;
      type = genedit(function (b) {
        return Math.abs(b[0]-TL/2)+Math.abs(b[1]-TL/2)+Math.abs(b[2]-TL/2) < TS/2+0.5 ? functionShapeColor : 0;
      });
      type.behavior = Circuit.behaviors.emitUniform;

      // IC blocks (require logic blocks on the next level down)
      if (optLogicSetHere) {
        ids.emitConstant = blockSet.length;
        type = genedit(function (b) {
          var r = f.rad(b);
          return r < TS/2 && r > TL/2 && f.plane(0, TS/2-1, TS/2+1, function(){return true;})(b) && Math.abs(b[1]-TL/2) > (b[2]-TL/2) ? functionShapeColor : 0;
        });
        type.world.s(1,1,1, optLogicSetHere.getSubDatum);
        type.world.s(1,1,2, optLogicSetHere.emitUniform);
        type.automaticRotations = [0,1,2,3,4,5,6,7]; // TODO kludge
        type.behavior = Circuit.behaviors.ic;
      }

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

  var TS = World.TILE_SIZE;
  var TL = TS - 1;

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
  function rgbPat(b) { return brgb(b[0]/TL,b[1]/TL,b[2]/TL); }
  
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
    if (Math.abs(b[0] - TL/2) + Math.abs(b[1] - TL/2) > (TS-0.5)-b[2])
      return 0;
    return brgb(mod((b[2]+2)/(TS/2), 1), Math.floor((b[2]+2)/(TS/2))*0.5, 0);
  }));
  // rotate-based-on-subdatum circuit
  type.world.s(1,1,0, ls.getSubDatum);
  type.world.s(1,2,0, ls.setRotation);
  type.automaticRotations = sixFaceRotations;
  
  // "leaf block" transparency test
  blockset.add(type = genedit(function (b) {
    return f.s(b) ? f.speckle(f.flat(0), f.flat(brgb(0,1,0)))(b) : 0;
  }));

  // pillar thing
  blockset.add(type = genedit(function (b) {
    return Math.max(Math.abs(b[0] - TS/2), Math.abs(b[2] - TS/2)) <= TS/4 ? brgb(.5,.5,0) : 0;
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
      }
    }
  }
  topWorld.notifyRawEdit();
  
  // circuit test
  (function () {
    var x = 182, y = Math.floor(wy/2)+3, z = 191;
    topWorld.s(x+0,y,z+1,l.pad);
    topWorld.s(x+0,y,z+2,l.wire);
    topWorld.s(x+0,y,z+3,l.indicator);                    
    topWorld.s(x+0,y,z+4,l.wire);
    topWorld.s(x+0,y,z+5,l.nor);
    
    topWorld.s(x-1,y,z+5,l.wire);
    topWorld.s(x-2,y,z+5,l.pad);

    topWorld.s(x+1,y,z+5,l.wire);
    topWorld.s(x+2,y,z+5,l.junction);
    topWorld.s(x+2,y,z+4,l.wire);
    topWorld.s(x+2,y,z+3,l.nor);
    topWorld.s(x+3,y,z+3,l.wire);
    topWorld.s(x+4,y,z+3,l.pad);
  })();
  
  return topWorld;
}
