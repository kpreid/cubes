// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var WorldGen = (function () {
  "use strict";

  
  var WorldGen = {
    newWorldBlockType: function (TS, blockSet) {
      return new BlockType.World(new World([TS,TS,TS], blockSet));
    },
    
    newProceduralBlockType: function (TS, blockSet, patfunc) {
      var type = WorldGen.newWorldBlockType(TS, blockSet);
      type.world.edit(function (x,y,z,value) {
        return patfunc([x,y,z]);
      });
      return type;
    },

    newRandomBlockType: function (TS, blockset) {
      var f = WorldGen.blockFunctions(TS);

      var colorCount;
      for (colorCount = 0; colorCount < blockset.length && blockset.get(colorCount).color; colorCount++);
      function pickColor() {
        return Math.random() < 0.2 ? 0 : Math.floor(Math.random() * colorCount);
      }

      // TODO: make this more interesting
      var c = f.pickEdgeCond(f.flat(pickColor()),
                f.pickEdgeCond(f.flat(pickColor()),
                  f.pickFillCond(f.flat(pickColor()), f.flat(pickColor()))));
                  
      return WorldGen.newProceduralBlockType(TS, blockset, c);
    },

    // Generate a blockset containing RGB colors with the specified number of
    // levels in each channel.
    colorBlocks: function (reds, greens, blues) {
      var max = BlockSet.ID_LIMIT - 1;
      if (reds*greens*blues >= max)
        throw new Error("Color resolution would result in " + reds*greens*blues + " (> " + max + ") colors.");
    
      var colors = [];
      for (var i = 0; i < reds*greens*blues; i++) {
        colors.push(new BlockType.Color([
          mod(i, reds) / (reds-1),
          mod(Math.floor(i/reds), greens) / (greens-1),
          mod(Math.floor(i/reds/greens), blues) / (blues-1),
          1
        ]));
      }
      return new BlockSet(colors);
    },
    
    // Given a blockset, return a function which returns the ID of the nearest color block in the blockset, optionally with random dithering. As the color selection process is expensive, the function is memoized; reusing it is cheaper.
    //
    // Colors will be dithered with a variation up to 'dithering' times the distance between the best match and the available color; therefore any value <= 1 means no dithering.
    colorPicker: function (blockset, dithering) {
      if ((dithering || 0) < 1) dithering = 1;
      
      var table = {};
      
      var ditheringSq = Math.pow(dithering, 2);
      var idToColor = blockset.getAll().map(function (t) { return t.color; });
      function compareMatchRecord(a,b) { return a[1] - b[1]; }
      
      function colorToID(r,g,b) {
        // reduce to 8-bit-per-component color from arbitrary float to keep the table small
        var rk,bk,gk;
        r = (rk = r * 255 | 0) / 255;
        g = (gk = g * 255 | 0) / 255;
        b = (bk = b * 255 | 0) / 255;
        var key = rk+","+gk+","+bk;
        if (!(key in table)) {
          var matches = [];
          // Compute Euclidean distance for each color in the set.
          for (var i = blockset.length - 1; i >= 0; i--) {
            var color = idToColor[i];
            if (!color || color[3] <= 0.0) continue; // transparent or not a color block
            var dr = r-color[0];
            var dg = g-color[1];
            var db = b-color[2];
            matches.push([i, dr*dr+dg*dg+db*db]);
          }
          // Sort from lowest to highest distance.
          matches.sort(compareMatchRecord);
          // Find the maximum distance allowed for picking dither colors.
          var ditherBound = matches[0][1] * ditheringSq;
          // Cut off the match list at that point.
          for (var ditherCount = 0; ditherCount < matches.length && matches[ditherCount][1] <= ditherBound; ditherCount++);
          table[key] = matches.slice(0, ditherCount);
        }
        
        var candidates = table[key];
        // Pick a color randomly from the dither candidates.
        // TODO: Do the randomization such that the mean color is the desired color.
        return candidates[Math.floor(Math.random() * candidates.length)][0];
      }
      return colorToID;
    },
    
    blockFunctions: function (TS) {
      var TL = TS - 1;
      var HALF = TL/2; // subtract this to do calculations from block centers

      // non-boolean property functions
      function vx(b) { return b[0]; }
      function vy(b) { return b[1]; }
      function vz(b) { return b[2]; }
      function s(b) { return te(b) + be(b) + xe(b) + ze(b); }
      function rad(b) { 
        return Math.sqrt(
          Math.pow(b[0]-HALF, 2) +
          Math.pow(b[1]-HALF, 2) +
          Math.pow(b[2]-HALF, 2)
        );
      }
      function maxrad(b) { // distance to closest edge, or distance from center per <http://en.wikipedia.org/wiki/Uniform_norm>, normalized to [0,1]
        return Math.max(
          Math.abs(b[0]-HALF),
          Math.abs(b[1]-HALF),
          Math.abs(b[2]-HALF)
        )/HALF;
      }
      function depth(b) { // pixel-count depth from outer surfaces - inverse of maxrad with different scale
        return Math.min(b[0],b[1],b[2],TL-b[0],TL-b[2],TL-b[2]);
      }
      
      // condition functions
      function te(b) { return b[1] == TL ?1:0; }
      function tp(b) { return b[1] == TL-1 ?1:0; }
      function be(b) { return b[1] == 0 ?1:0; }
      function bp(b) { return b[1] == 1 ?1:0; }
      function se(b) { return (b[2] == 0 || b[2] == TL   || b[0] == 0 || b[0] == TL  ) ?1:0; }
      function sp(b) { return (b[2] == 1 || b[2] == TL-1 || b[0] == 1 || b[0] == TL-1) ?1:0; }
      function xe(b) { return (b[0] == 0 || b[0] == TL) ?1:0; }
      function ze(b) { return (b[2] == 0 || b[2] == TL) ?1:0; }
      function e(b) { return s(b) > 1 ?1:0; }
      function c(b) { return s(b) > 2 ?1:0; }
      function speckle(b) { return (Math.floor(b[0]/4) + b[1] + Math.floor(b[2]/2)) % 4; }
      function layers(b) { return b[1] % 2; }

      // Pattern functions: each returns a function from a coordinate vector to a block id.
      function pick(a) {
        return a[Math.floor(Math.random() * a.length)];
      }
      function pickEdgeCond(p1, p2) {
        return cond(pick([te,tp,be,bp,se,sp,xe,ze,s,e,c]), p1, p2);
      }
      function pickFillCond(p1, p2) {
        return cond(pick([speckle,layers]), p1, p2);
      }
      function cond(cond, p1, p2) {
        return function (b) { return cond(b) ? p1(b) : p2(b); }
      }
      function flat(id) {
        return function (b) { return id; }
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
      function cube(x,y,z,r,fill) {
        return function (b) {
          return Math.abs(b[0]-x+0.5) <= r &&
                 Math.abs(b[1]-y+0.5) <= r &&
                 Math.abs(b[2]-z+0.5) <= r
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
        s: s,
        rad: rad,
        maxrad: maxrad,
        depth: depth,
        
        te: te,
        tp: tp,
        be: be,
        bp: bp,
        se: se,
        sp: sp,
        xe: xe,
        ze: ze,
        e: e,
        c: c,
        speckle: speckle,
        layers: layers,

        pick: pick,
        pickEdgeCond: pickEdgeCond,
        pickFillCond: pickFillCond,
        cond: cond,
        
        flat: flat,
        
        sphere: sphere,
        cube: cube,
        plane: plane,

        union: union,
        intersection: intersection,
        subtract: subtract
      });
    },
    
    addLogicBlocks: function (TS, targetSet, baseSet) {
      var type;
      var TL = TS-1;
      var HALF = TL/2;
      var f = WorldGen.blockFunctions(TS);
      
      var baseGetSubDatum = baseSet.lookup("logic.getSubDatum");
      var baseSetRotation = baseSet.lookup("logic.setRotation");
      var baseICOutput = baseSet.lookup("logic.icOutput");
      
      // appearance utilities
      var colorToID = WorldGen.colorPicker(baseSet);
      var boxColor = colorToID(0,1,1);
      var functionShapeColor = colorToID(0.5,0.5,0.5);
      var functionShapePat = f.flat(functionShapeColor);
      function boxed(insidePat) {
        return function (b) {
          return (f.e(b) && (b[0]+b[1]+b[2])%2) ? boxColor : insidePat(b);
        };
      }
      
      function addOrUpdate(name, behavior, pattern) {
        pattern = boxed(pattern);
        var existingID = targetSet.lookup(name);
        var type;
        if (existingID !== null) {
          type = targetSet.get(existingID);
          if (!type.world) {
            // TODO provide a warnings channel so this sort of thing can propagate up to user level sanely
            if (typeof console !== "undefined")
              console.warn("cannot update " + name + " from being a color block");
          }
        } else {
          type = WorldGen.newWorldBlockType(TS, baseSet);
          targetSet.add(type);
          type.name = name;
        }
        type.world.edit(function (x,y,z,value) { // TODO duplicative of newProceduralBlockType
          return pattern([x,y,z]);
        });
        type.solid = false;
        type.behavior = behavior;
        return type;
      }
      
      // Add a rotate-based-on-subdata circuit
      function selfRotating(y) {
        if (baseSetRotation !== null) {
          type.world.s(TS/2,y,TS/2, baseGetSubDatum);
          type.world.s(TS/2,y,TS/2-1, baseSetRotation);
        }
      }
      
      type = addOrUpdate(
          "logic.wire",
          Circuit.behaviors.wire,
          f.flat(0));

      type = addOrUpdate(
          "logic.junction",
          Circuit.behaviors.junction,
          f.sphere(TS/2,TS/2,TS/2, TS*3/16, functionShapePat));

      type = addOrUpdate(
          "logic.become",
          Circuit.behaviors.become,
          f.cube(TS/2,TS/2,TS/2, TS/4, functionShapePat));

      type = addOrUpdate(
          "logic.count",
          Circuit.behaviors.count,
          function (b) {
            var mx = b[0] - TL/2;
            var my = b[1] - TL/2;
            var mz = b[2] - TL/2;
            return (b[0] > 2 &&
                    Math.abs(b[0] - Math.max(Math.abs(my), Math.abs(mz))) < Math.sqrt(2) &&
                   (Math.abs(mz) > 1 && Math.abs(mz) < 2 ||
                    Math.abs(my) > 1 && Math.abs(my) < 2))
                   ? functionShapePat(b) : 0;
          });
      selfRotating(TS/2);

      type = addOrUpdate(
          "logic.gate",
          Circuit.behaviors.gate,
          f.subtract(f.plane(0, TS/2-1, TS/2+1,
                             f.sphere(TS*0.3,TS/2,TS/2, TS*0.5, functionShapePat)),
                     f.sphere(TS*0.3,TS/2,TS/2, TS*0.3, functionShapePat)));
      selfRotating(TS/2);

      type = addOrUpdate(
          "logic.getNeighborID",
          Circuit.behaviors.getNeighborID,
          f.union(function (b) {
            return Math.abs(Math.sqrt(Math.pow(b[1]-HALF,2)+Math.pow(b[2]-HALF,2))*4 - (TS-b[0])) <= 2 ? functionShapeColor : 0;
          }, f.cube(0,TS/2,TS/2,TS/4,functionShapePat)));
      selfRotating(0);

      type = addOrUpdate(
          "logic.getSubDatum",
          Circuit.behaviors.getSubDatum,
          function (b) {
            return Math.abs(Math.sqrt(Math.pow(b[0]-HALF,2)+Math.pow(b[2]-HALF,2))*4 - b[1]) <= 2 ? functionShapeColor : 0;
          });

      type = addOrUpdate(
          "logic.icInput",
          Circuit.behaviors.icInput,
          function (b) {
            var c = b.map(function (coord) { return Math.abs(coord - HALF); }).sort();
            return c[2] > c[0]+c[1]+TS*0.125 ? functionShapeColor : 0;
          });

      type = addOrUpdate(
          "logic.icOutput",
          Circuit.behaviors.icOutput,
          function (b) {
            return Math.abs(b[0]-HALF)+Math.abs(b[1]-HALF)+Math.abs(b[2]-HALF) < TS/2+0.5 ? functionShapeColor : 0;
          });

      type = addOrUpdate(
          "logic.indicator",
          Circuit.behaviors.indicator,
          function (b) {
            return f.rad([b[0],b[1],b[2]]) > TS*6/16 ? 0 :
                   b[1] < TS/2 ? colorToID(1,1,1) : colorToID(0,0,0);
          });
      selfRotating(TS/2-1);

      type = addOrUpdate(
          "logic.nor",
          Circuit.behaviors.nor,
          f.union(f.sphere(TS/2-TS*.2,TS/2,TS/2, TS*3/16, functionShapePat),
                  f.sphere(TS/2+TS*.2,TS/2,TS/2, TS*3/16, functionShapePat)));
      selfRotating(TL-1);

      var specklePat = f.cond(f.speckle,
                              functionShapePat,
                              f.flat(colorToID(0.75,0.75,0.75)));
      type = addOrUpdate(
          "logic.pad",
          Circuit.behaviors.pad,
          f.sphere(TS/2,TS-0.5,TS/2,TS/2,specklePat));
      type.solid = true; // override circuit-block default

      type = addOrUpdate(
          "logic.setRotation",
          Circuit.behaviors.setRotation,
          f.intersection(
            f.subtract(
              f.sphere(TS/2,TS/2,TS/2, TS/2, functionShapePat),
              f.sphere(TS/2,TS/2,TS/2, TS/2-2, functionShapePat)),
            f.union(
              f.plane(0, TS/2-1, TS/2+1, functionShapePat),
              f.union(
                f.plane(1, TS/2-1, TS/2+1, functionShapePat),
                f.plane(2, TS/2-1, TS/2+1, functionShapePat)))));

      type = addOrUpdate(
          "logic.spontaneous",
          Circuit.behaviors.spontaneous,
          function (b) {
            // TODO: make this look more like a lightning bolt
            return Math.abs(Math.sqrt(Math.pow(b[0]-HALF,2)+Math.pow(b[2]-HALF,2))*4 - b[1]) <= 2 ? colorToID(1,1,0) : 0;
          });

      // IC blocks (require logic blocks on the next level down)
      if (baseICOutput !== null) {
        type = addOrUpdate(
            "logic.constant",
            Circuit.behaviors.ic,
            function (b) {
              var r = f.rad(b);
              return r < TS/2 && r > HALF && f.plane(0, TS/2-1, TS/2+1, function(){return true;})(b) && Math.abs(b[1]-HALF) > (b[2]-HALF) ? functionShapeColor : 0;
            });
        type.world.s(2,2,2, baseICOutput);
        type.world.s(1,2,2, baseGetSubDatum);
        type.world.s(3,2,2, baseGetSubDatum);
        type.world.s(2,1,2, baseGetSubDatum);
        type.world.s(2,3,2, baseGetSubDatum);
        type.world.s(2,2,1, baseGetSubDatum);
        type.world.s(2,2,3, baseGetSubDatum);
        type.automaticRotations = [0,1,2,3,4,5,6,7]; // TODO kludge
      }
    },

    newDefaultBlockset: function (TS) {
      var t0 = Date.now();
      // Given an object facing the +z direction, these will rotate that face to...
      var sixFaceRotations = [0/*+z*/, 2/*-z*/, 4/*+y*/, 4+2/*-y*/, 16+8/*-x*/, 16+11/*+x*/];

      var TL = TS - 1;
      var HALF = TL/2;

      function normalish() {
        return (Math.random()+Math.random()+Math.random()+Math.random()+Math.random()+Math.random()) / 6 - 0.5;
      }

      // --- base blockset ---

      // layer 1
      var pureColors = WorldGen.colorBlocks(7, 7, 5);

      // layer 2
      var baseLogicAndColors = WorldGen.colorBlocks(7, 6, 5);
      WorldGen.addLogicBlocks(TS, baseLogicAndColors, pureColors);

      // layer 3
      var fullLogicAndColors = WorldGen.colorBlocks(6, 6, 6);
      var onlyColorCount = fullLogicAndColors.length; // before logic added
      WorldGen.addLogicBlocks(TS, fullLogicAndColors, baseLogicAndColors);
      var colorSet = fullLogicAndColors; // TODO dup
      var brgb = WorldGen.colorPicker(colorSet, 0);
      var brgbDither = WorldGen.colorPicker(colorSet, 1.2);

      // --- block world generation utilities ---

      function genedit(patfunc) {
        return WorldGen.newProceduralBlockType(TS, colorSet, patfunc);
      }
      var f = WorldGen.blockFunctions(TS);

      function rgbPat(b) { return brgb(b[0]/TL,b[1]/TL,b[2]/TL); }

      function addSpontaneousConversion(type, targetID) {
        var constant = colorSet.lookup("logic.constant");
        var gate = colorSet.lookup("logic.gate");
        var spontaneous = colorSet.lookup("logic.spontaneous");
        var become = colorSet.lookup("logic.become");
        if (!constant) {
          if (typeof console !== "undefined")
            console.warn("constant IC block is unavailable; addSpontaneousConversion fails");
        } else {
          type.world.s(1,1,1, constant, targetID);
          type.world.s(2,1,1, gate);  type.world.s(2,1,2, spontaneous);
          type.world.s(3,1,1, become);
        }
      }
      function addRotation(type) {
        var getSubDatum = colorSet.lookup("logic.getSubDatum");
        var setRotation = colorSet.lookup("logic.setRotation");
        type.world.s(1,3,0, getSubDatum);
        type.world.s(1,4,0, setRotation);
        type.automaticRotations = sixFaceRotations;
      }

      var t15 = Date.now();

      // --- default block worlds and block set ---

      var type;
      var blockset = new BlockSet([]);

      // color cube - world base and bogus-placeholder
      blockset.add(type = genedit(rgbPat));

      // ground block
      blockset.add(type = genedit(
        f.cond(f.te, f.cond(f.speckle, f.flat(brgb(.67,.34,.34)), f.flat(brgb(.67,0,0))),
          f.cond(f.tp, f.flat(brgb(1,.34,.34)),
            f.cond(f.speckle, f.flat(brgb(.34,0,0)), f.flat(brgb(0,0,0)))))));
      var ground = type.world;

      // ground block #2
      blockset.add(type = genedit(
        f.cond(f.te, f.cond(f.speckle, f.flat(brgb(.34,.67,.34)), f.flat(brgb(0,.34,0))),
          f.cond(f.tp, f.flat(brgb(.34,1,.34)),
            f.cond(f.speckle, f.flat(brgb(0,.34,0)), f.flat(brgb(0,1,1)))))));

      // pyramid thing
      var pyr1 = blockset.length;
      blockset.add(type = genedit(function (b) {
        if (Math.abs(b[0] - HALF) + Math.abs(b[1] - HALF) > (TS-0.5)-b[2])
          return 0;
        return brgb(mod((b[2]+2)/(TS/2), 1), Math.floor((b[2]+2)/(TS/2))*0.5, 0);
      }));
      type.name = "pyramid";
      addRotation(type);

      // pyramid thing variant
      var pyr2 = blockset.length;
      blockset.add(type = genedit(function (b) {
        if (Math.abs(b[0] - HALF) + Math.abs(b[1] - HALF) > (TS-0.5)-b[2])
          return 0;
        return brgb(0, mod((b[2]+2)/(TS/2), 1), Math.floor((b[2]+2)/(TS/2))*0.5);
      }));
      addRotation(type);

      addSpontaneousConversion(blockset.get(pyr1), pyr2);
      addSpontaneousConversion(blockset.get(pyr2), pyr1);

      // low ground bump
      blockset.add(type = genedit(function (b) {
        return ground.g(b[0],b[1]+Math.max(TS/2, TS-2*f.depth([b[0],TS/2,b[2]])),b[2]);
      }));
      type.name = "bump";

      // leaves/hedge
      blockset.add(type = genedit(function (b) {
        var edgeness = f.maxrad(b);
        if (Math.random() >= edgeness*0.2) return 0;
        var green = Math.random() * 0.75 + 0.25;
        var notgreen = Math.random() * green*0.3 + green*0.25;
        return brgb(notgreen,green*edgeness,notgreen*(1-edgeness));
      }));
      type.name = "greenery";
      addRotation(type); // allows random orientation to reduce uniformity

      // pillar thing
      blockset.add(type = genedit(function (b) {
        return Math.max(Math.abs(b[0] - TS/2), Math.abs(b[2] - TS/2)) <= TS/4 ? brgbDither(.5,.5,0) : 0;
      }));

      // glass sheet for buildings
      blockset.add(type = genedit(
        f.cond(function (b) { return (f.xe(b) || f.te(b) || f.be(b)) && b[2] == TL; },
          f.flat(brgb(.9,.9,.9)),
          f.flat(0))));
      type.name = "glass";
      addRotation(type);

      // "big chunk of stone" block
      blockset.add(type = genedit(function (b) {
        var g = Math.pow(f.maxrad(b), 0.25) * 0.7 + f.rad(b)/HALF * 0.1 + normalish() * 0.2;
        g = Math.min(1, g * 0.8);
        return /* b[2] >= 8 ? 0 : */ brgbDither(g,g,g);
      }));
      type.name = "slab";

      var roundMaterial = brgb(.2,.2,.2);

      // quarter-round (edge) block
      blockset.add(type = genedit(function (b) {
        return b[0]*b[0]+b[2]*b[2] <= TS*TS ? roundMaterial : 0;
      }));
      type.name = "qround";
      addRotation(type);

      // eighth-round (corner) block
      blockset.add(type = genedit(function (b) {
        return b[0]*b[0]+b[1]*b[1]+b[2]*b[2] <= TS*TS ? roundMaterial : 0;
      }));
      type.name = "eround";
      addRotation(type);  

      // random block types
      var firstRandom = blockset.length;
      var lastRandom = firstRandom + 3;
      while (blockset.length <= lastRandom) {
        blockset.add(WorldGen.newRandomBlockType(TS, colorSet));
      }
      blockset.get(firstRandom).name = "random.first";
      blockset.get(lastRandom).name = "random.last";

      var t1 = Date.now();
      WorldGen.addLogicBlocks(TS, blockset, fullLogicAndColors);

      var t2 = Date.now();
      //console.log("Blockset generation", t15 - t0, "ms mid ", t1 - t15, "ms adding logic", t2 - t1, "ms");

      return blockset;
    }
  };
  
  return Object.freeze(WorldGen);
}());
  
// TODO: refactor this into WorldGen methods
function generateWorlds(config, blockset) {
  "use strict";

  var topWorld = new World([
    config.generate_wx.get(),
    config.generate_wy.get(),
    config.generate_wz.get(),
  ], blockset);
  var wx = topWorld.wx;
  var wy = topWorld.wy;
  var wz = topWorld.wz;
  
  var mid = wy / 2;
  var sin = Math.sin;
  var round = Math.round;
  var sqrt = Math.sqrt;
  var random = Math.random;
  
  function generateSimpleBumpy(bottomFunc) {
    // The constant is the maximum slope of the 'terrain' function; therefore generate_slope is the maximum slope of the returned terrain.
    var slopeScaled = config.generate_slope.get() / 0.904087;
    
    var air = 0;
    var bedrock = 1;
    var ground = 2;
    var pyramid = blockset.lookup("pyramid");
    var bump = blockset.lookup("bump");
    
    // Using raw array access because it lets us cache the altitude computation by iterating over y last, not because the overhead of .edit() is especially high.
    var raw = topWorld.raw;
    var rawSubData = topWorld.rawSubData;
    var t0 = Date.now();
    for (var x = 0; x < wx; x++) {
      var xbase = x*wy*wz;
      for (var z = 0; z < wz; z++) {
        var terrain = slopeScaled * (
          (sin(x/8) + sin(z/8))*1
          + (sin(x/14) + sin(z/14))*3
          + (sin(x/2) + sin(z/2))*0.6);
        var top = mid - round(terrain);
        var bottom = bottomFunc(x,z,terrain);
        for (var y = 0; y < wy; y++) {
          var index = xbase + y*wz + z;
          var altitude = y - top;
          raw[index] = y < bottom ? air :
                       altitude > 1 ? air :
                       altitude < 0 ? bedrock :
                       altitude == 0 ? ground :
                       /* altitude == 1 */
                       random() > 0.99 ? (rawSubData[index] = 4, pyramid) :
                       random() > 0.99 ? bump :
                       0;
        }
      }
    }
    var t1 = Date.now();
    topWorld.notifyRawEdit();
    var t2 = Date.now();
    //console.log("Generation", t1 - t0, "ms updating", t2 - t1, "ms");
  }
  
  function generateCity() {
    // --- Parameters ---
    
    // Blocks
    var air = BlockSet.ID_EMPTY;
    var bedrock = BlockSet.ID_BOGUS;
    var ground = 3; // TODO magic number
    var road = blockset.lookup("slab");
    
    // Dimensions
    var roadWidth = 3;
    var center = [Math.round((wx-1)/2),mid,Math.round((wz-1)/2)];

    // --- Utilities ---

    function runAsyncQueue(initial) {
      var qin = initial.slice();
      var qout = [];
      function loop() {
        for (var i = 0; i < 30; i++) {
          if (!qout.length && qin.length) {
            qout = qin;
            qout.reverse();
            qin = [];
          }
          if (qout.length) {
            var add = qout.pop()();
            qin.push.apply(qin, add);
          } else {
            return;
          }
        }
        setTimeout(loop, 1000/80);
      }
      loop();
    }

    function madd(base, delta, scale) {
      var r = vec3.create();
      r[0] = base[0] + delta[0] * scale;
      r[1] = base[1] + delta[1] * scale;
      r[2] = base[2] + delta[2] * scale;
      return r;
    }
    function maddy(base, sy, d1, s1) {
      var r = vec3.create();
      r[0] = base[0] + d1[0] * s1;
      r[1] = base[1] + d1[1] * s1 + sy;
      r[2] = base[2] + d1[2] * s1;
      return r;
    }
    function addy(base, sy) {
      var r = vec3.create(base);
      r[1] += sy;
      return r;
    }
    function madd2y(base, sy, d1, s1, d2, s2) {
      var r = vec3.create();
      r[0] = base[0] + d1[0] * s1 + d2[0] * s2;
      r[1] = base[1] + d1[1] * s1 + d2[1] * s2 + sy;
      r[2] = base[2] + d1[2] * s1 + d2[2] * s2;
      return r;
    }
    function getvec(vec) {
      return topWorld.g(vec[0],vec[1],vec[2]);
    }        
    function setvec(vec, val,subdatum) {
      topWorld.s(vec[0],vec[1],vec[2],val,subdatum);
    }        
    function fill(corner1, corner2, material, subdata) {
      var lx = Math.min(corner1[0], corner2[0]);
      var ly = Math.min(corner1[1], corner2[1]);
      var lz = Math.min(corner1[2], corner2[2]);
      var hx = Math.max(corner1[0], corner2[0]);
      var hy = Math.max(corner1[1], corner2[1]);
      var hz = Math.max(corner1[2], corner2[2]);
      for (var x = lx; x <= hx; x++)
      for (var y = ly; y <= hy; y++)
      for (var z = lz; z <= hz; z++) {
        topWorld.s(x, y, z, material, subdata);
      }
    }
    // Return a rotation to bring the +z vector to match the given axis-aligned unit vector.
    function frontFaceTo(vec) {
      switch (vec3.str(vec)) {
        case "[1, 0, 0]" : return 16+11;
        case "[0, 1, 0]" : return 4;
        case "[0, 0, 1]" : return 0;
        case "[-1, 0, 0]": return 16+8;
        case "[0, -1, 0]": return 4+2;
        case "[0, 0, -1]": return 2;
        default: throw new Error("unsuitable direction vector " + vec3.str(vec));
      }
    }
    function clockwise(v) {
      return vec3.create([-v[2], v[1], v[0]]);
    }
    function counterclockwise(v) {
      return vec3.create([v[2], v[1], -v[0]]);
    }
    
    var greenery = blockset.lookup("greenery");
    function roadBuilder(pos, vel, width) {
      return posLoop(pos, vel, 
          function (p) { return topWorld.g(p[0],p[1],p[2]) == ground; }, 
          function (pos) {
        var perp = counterclockwise(vel);
        setvec(maddy(pos, 1, perp, -width-1), greenery, Math.floor(Math.random()*CubeRotation.count));
        setvec(maddy(pos, 1, perp, +width+1), greenery, Math.floor(Math.random()*CubeRotation.count));
        fill(madd(pos, perp, -width), madd(pos, perp, width), road);
        return [];
      });
    }
    
    function posLoop(initial, delta, condition, body, finish) {
      var pos = vec3.create(initial);
      
      function looper() {
        var extra = body(pos);
        
        pos = vec3.add(pos, delta, vec3.create());
        
        var after = condition(pos) ? [looper] : finish ? [function () { return finish(pos); }] : [];
        return extra.concat(after);
      }
      
      return looper;
    }
    
    function pick(a) {
      return a[Math.floor(Math.random() * a.length)];
    }
    
    var glass = blockset.lookup("glass");
    var firstRandom = blockset.lookup("random.first");
    var slab = blockset.lookup("slab");
    function buildingBuilder(origin, u, v, usize, vsize) {
      var buildingFloorHeight = 3 + Math.floor(Math.random() * 3);
      
      var material = pick([
        firstRandom+0,
        firstRandom+1,
        firstRandom+2,
        firstRandom+3,// TODO use lastRandom
        slab,
      ]);
      var height = origin[1] + Math.floor(Math.random() * (wy-origin[1])/buildingFloorHeight) * buildingFloorHeight;
      // ground floor
      fill(addy(origin, -1), madd2y(origin, -1, u, usize-1, v, vsize-1), material);
      return posLoop(origin, vec3.scale(UNIT_PY, buildingFloorHeight, vec3.create()),
          function (pos) { return topWorld.g(pos[0],pos[1],pos[2]) == air && pos[1] < height; }, 
          function (pos) {
        // building walls ring
        var high = madd(madd(pos, u, usize-1), v, vsize-1);
        function buildingWall(worigin, wdir, size) {
          fill(worigin, maddy(worigin, buildingFloorHeight-2, wdir, size-1), material);
          fill(madd(worigin, wdir, 1), maddy(worigin, buildingFloorHeight-2, wdir, size-2), glass, frontFaceTo(clockwise(wdir)));
        }
        buildingWall(pos, u, usize);
        buildingWall(high, vec3.scale(u, -1, vec3.create()), usize);
        buildingWall(madd(pos, u, usize-1), v, vsize);
        buildingWall(madd(pos, v, vsize-1), vec3.scale(v, -1, vec3.create()), vsize);
        // ceiling/floor
        fill(madd(pos, UNIT_PY, buildingFloorHeight-1), madd(high, UNIT_PY, buildingFloorHeight-1), material);
        return [];
      }, function (pos) {
        
        // doorway
        var mid1 = madd(origin, u, Math.round(usize/2 - 1));
        var mid2 = madd(origin, u, Math.round(usize/2 + 0));
        //console.log("making door", vec3.str(mid1), vec3.str(mdid2));
        fill(mid1, madd(mid2, UNIT_PY, 1/* door height - 1 */), air);
        return [];
      });
    }

    function seedQuadrant(direction) {
      var perp = [direction[2],direction[1],-direction[0]];
      var buildingOffset = 3 + Math.floor(Math.random() * 2);
      var buildingSize = 6 + Math.floor(Math.random() * 7);
      
      var blockBuilder = posLoop(
          madd(madd(center, perp, roadWidth + buildingOffset), direction, roadWidth + buildingOffset),
          vec3.scale(direction, buildingSize + buildingOffset, vec3.create()),
          function (pos) { return topWorld.inBounds(pos[0],pos[1],pos[2]); },
          function (pos) {
        return [posLoop(
            madd(pos, UNIT_PY, 1),
            vec3.scale(perp, buildingSize + buildingOffset, vec3.create()),
            function (pos) { return topWorld.inBounds(pos[0],pos[1],pos[2]); },
            function (pos) {
          if (Math.random() > 0.5)
            return [buildingBuilder(pos, direction, perp, buildingSize, buildingSize)];
          else
            return [];
        })];
      });
      
      return function () {
        return [
          roadBuilder(
            madd(center, direction, roadWidth + 1),
            direction,
            roadWidth),
          blockBuilder,
        ];
      };
    }
    
    // --- Top-level operations ---
    
    topWorld.edit(function (x, y, z) {
      return y > mid ? air : y < mid ? bedrock : ground;
    });
    
    fill(madd2y(center, 0, UNIT_PX, roadWidth, UNIT_PZ, roadWidth), madd2y(center, 0, UNIT_NX, roadWidth, UNIT_NZ, roadWidth), road);
    runAsyncQueue([
      seedQuadrant([+1,0,0]),
      seedQuadrant([-1,0,0]),
      seedQuadrant([0,0,+1]),
      seedQuadrant([0,0,-1]),
    ]);
  }
  
  switch (config.generate_shape.get()) {
    case "fill":
    default:
      generateSimpleBumpy(function () { return 0; });
      break;
    case "island":
      generateSimpleBumpy(function (x,z,terrain) {
        var nx = x/wx*2 - 1;
        var nz = z/wz*2 - 1;
        var negr = 1 - (nx*nx+nz*nz);
        var dome = (negr >= 0 ? sqrt(negr) : -1);
        return mid - (mid-10)*dome + terrain * 2.0;
      });
      break;
    case "city":
      generateCity();
      break;
  }
  
  // circuit test;
  
  (function () {
    var x = Math.floor(182/400*wx), y = Math.floor(wy/2)+3, z = Math.floor(191/400*wx);
    var constant = blockset.lookup("logic.constant");
    var gate = blockset.lookup("logic.gate");
    var indicator = blockset.lookup("logic.indicator");
    var junction = blockset.lookup("logic.junction");
    var nor = blockset.lookup("logic.nor");
    var pad = blockset.lookup("logic.pad");
    var wire = blockset.lookup("logic.wire");
    topWorld.s(x+0,y,z+1,pad);
    topWorld.s(x+0,y,z+2,wire);
    topWorld.s(x+0,y,z+3,indicator);                    
    topWorld.s(x+0,y,z+4,wire);
    topWorld.s(x+0,y,z+5,nor);
                         
    topWorld.s(x-1,y,z+5,wire);
    topWorld.s(x-2,y,z+5,gate);
    topWorld.s(x-3,y,z+5,constant,42);
    topWorld.s(x-2,y,z+4,pad);
                         
    topWorld.s(x+1,y,z+5,wire);
    topWorld.s(x+2,y,z+5,junction);
    topWorld.s(x+2,y,z+4,wire);
    topWorld.s(x+2,y,z+3,nor);
    topWorld.s(x+3,y,z+3,wire);
    topWorld.s(x+4,y,z+3,pad);
  }());
  
  return topWorld;
}
