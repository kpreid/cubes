// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

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
      if (reds*greens*blues >= 256)
        throw new Error("Color resolution would result in " + reds*greens*blues + " > 255 colors.");
    
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
      var count = 0;
      var table = {};
      function colorToID(r,g,b) {
        var key = r+","+g+","+b;
        if (!(key in table)) {
          var matches = [];
          // Compute Euclidean distance for each color in the set.
          for (var i = blockset.length - 1; i >= 0; i--) {
            var color = blockset.get(i).color;
            if (!color || color[3] <= 0.0) continue; // transparent or not a color block
            var dr = r-color[0];
            var dg = g-color[1];
            var db = b-color[2];
            matches.push([i, Math.sqrt(dr*dr+dg*dg+db*db)]);
          }
          // Sort from lowest to highest distance.
          matches.sort(function (a,b) { return a[1] - b[1]; });
          // Find the maximum distance allowed for picking dither colors.
          var ditherBound = matches[0][1] * dithering;
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
    
    addLogicBlocks: function (TS, targetKit, baseKit) {
      var ids = {};
      var type;
      var targetSet = targetKit.blockset;
      var TL = TS-1;
      var HALF = TL/2;
      var f = WorldGen.blockFunctions(TS);
      
      // appearance utilities
      var colorToID = WorldGen.colorPicker(baseKit.blockset);
      var boxColor = colorToID(0,1,1);
      var functionShapeColor = colorToID(0.5,0.5,0.5);
      var functionShapePat = f.flat(functionShapeColor);
      function boxed(insidePat) {
        return function (b) {
          return (f.e(b) && (b[0]+b[1]+b[2])%2) ? boxColor : insidePat(b);
        };
      }
      function genedit(pattern) {
        var type = WorldGen.newProceduralBlockType(TS, baseKit.blockset, boxed(pattern));
        type.solid = false;
        targetSet.add(type);
        return type;
      }

      // Add a rotate-based-on-subdata circuit
      function selfRotating(y) {
        if (baseKit.logic) {
          type.world.s(TS/2,y,TS/2, baseKit.logic.getSubDatum);
          type.world.s(TS/2,y,TS/2-1, baseKit.logic.setRotation);
        }
      }
      
      // wire
      ids.wire = targetSet.length;
      type = genedit(f.flat(0));
      type.behavior = Circuit.behaviors.wire;

      // junction block
      ids.junction = targetSet.length;
      type = genedit(f.sphere(TS/2,TS/2,TS/2, TS*3/16, functionShapePat));
      type.behavior = Circuit.behaviors.junction;

      // step pad block
      ids.pad = targetSet.length;
      var specklePat = f.cond(f.speckle,
                              functionShapePat,
                              f.flat(colorToID(0.75,0.75,0.75)));
      type = genedit(f.sphere(TS/2,TS-0.5,TS/2,TS/2,specklePat));
      selfRotating(TL-1);
      type.behavior = Circuit.behaviors.pad;
      type.solid = true; // override circuit-block default

      // indicator block
      ids.indicator = targetSet.length;
      type = genedit(function (b) {
        return f.rad([b[0],b[1],b[2]]) > TS*6/16 ? 0 :
               b[1] < TS/2 ? colorToID(1,1,1) : colorToID(0,0,0);
      });
      selfRotating(TS/2-1);
      type.behavior = Circuit.behaviors.indicator;

      // nor block
      ids.nor = targetSet.length;
      type = genedit(f.union(f.sphere(TS/2-TS*.2,TS/2,TS/2, TS*3/16, functionShapePat),
                             f.sphere(TS/2+TS*.2,TS/2,TS/2, TS*3/16, functionShapePat)));
      type.behavior = Circuit.behaviors.nor;

      // gate block
      ids.gate = targetSet.length;
      type = genedit(f.subtract(f.plane(0, TS/2-1, TS/2+1,
                                        f.sphere(TS/2,TS/2,TS/2, TS/2, functionShapePat)),
                                f.sphere(TS/2,TS/2,TS/2, TS*3/16, functionShapePat)));
      type.behavior = Circuit.behaviors.gate;

      // get-subdata block
      ids.getSubDatum = targetSet.length;
      type = genedit(function (b) {
        return Math.abs(Math.sqrt(Math.pow(b[0]-HALF,2)+Math.pow(b[2]-HALF,2))*4 - b[1]) <= 1 ? functionShapeColor : 0;
      });
      type.behavior = Circuit.behaviors.getSubDatum;

      // spontaneous event detector block
      ids.spontaneous = targetSet.length;
      type = genedit(function (b) {
        // TODO: make this look more like a lightning bolt
        return Math.abs(Math.sqrt(Math.pow(b[0]-HALF,2)+Math.pow(b[2]-HALF,2))*4 - b[1]) <= 1 ? colorToID(1,1,0) : 0;
      });
      type.behavior = Circuit.behaviors.spontaneous;

      // set-rotation block
      ids.setRotation = targetSet.length;
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

      // set-block-id block
      ids.become = targetSet.length;
      type = genedit(f.cube(TS/2,TS/2,TS/2, TS/4, functionShapePat));
      type.behavior = Circuit.behaviors.become;

      // emit-value block
      ids.emitUniform = targetSet.length;
      type = genedit(function (b) {
        return Math.abs(b[0]-HALF)+Math.abs(b[1]-HALF)+Math.abs(b[2]-HALF) < TS/2+0.5 ? functionShapeColor : 0;
      });
      type.behavior = Circuit.behaviors.emitUniform;

      // IC blocks (require logic blocks on the next level down)
      if (baseKit.logic) {
        ids.emitConstant = targetSet.length;
        type = genedit(function (b) {
          var r = f.rad(b);
          return r < TS/2 && r > HALF && f.plane(0, TS/2-1, TS/2+1, function(){return true;})(b) && Math.abs(b[1]-HALF) > (b[2]-HALF) ? functionShapeColor : 0;
        });
        type.world.s(1,1,1, baseKit.logic.getSubDatum);
        type.world.s(1,1,2, baseKit.logic.emitUniform);
        type.automaticRotations = [0,1,2,3,4,5,6,7]; // TODO kludge
        type.behavior = Circuit.behaviors.ic;
      }

      targetKit.logic = ids;
      return ids;
    }
  };
  
  return Object.freeze(WorldGen);
}());
  
// TODO: refactor this into WorldGen methods
function generateWorlds() {
  "use strict";

  // Given an object facing the +z direction, these will rotate that face to...
  var sixFaceRotations = [0/*+z*/, 2/*-z*/, 4/*+y*/, 4+2/*-y*/, 16+8/*-x*/, 16+11/*+x*/];

  var TS = Math.round(config.generate_tileSize.get());
  var TL = TS - 1;
  var HALF = TL/2;

  function normalish() {
    return (Math.random()+Math.random()+Math.random()+Math.random()+Math.random()+Math.random()) / 6 - 0.5;
  }
  
  // --- base blockset ---
  
  // layer 1
  var pureColors = {blockset: WorldGen.colorBlocks(7, 7, 5)};
  
  // layer 2
  var baseLogicAndColors = {blockset: WorldGen.colorBlocks(7, 6, 5)};
  WorldGen.addLogicBlocks(TS, baseLogicAndColors, pureColors);
  
  // layer 3
  var fullLogicAndColors = {blockset: WorldGen.colorBlocks(6, 6, 6)};
  var onlyColorCount = fullLogicAndColors.blockset.length; // before logic added
  WorldGen.addLogicBlocks(TS, fullLogicAndColors, baseLogicAndColors);
  var colorSet = fullLogicAndColors.blockset;
  var brgb = WorldGen.colorPicker(colorSet, 0);
  var brgbDither = WorldGen.colorPicker(colorSet, 1.2);
  var ls = fullLogicAndColors.logic;

  // --- block world generation utilities ---
  
  function genedit(patfunc) {
    return WorldGen.newProceduralBlockType(TS, colorSet, patfunc);
  }
  var f = WorldGen.blockFunctions(TS);

  function rgbPat(b) { return brgb(b[0]/TL,b[1]/TL,b[2]/TL); }
  
  function addSpontaneousConversion(type, targetID) {
    if (!ls.emitConstant) throw new Error("don't have constant block available");
    type.world.s(1,1,1, ls.emitConstant, targetID);
    type.world.s(2,1,1, ls.gate);  type.world.s(2,1,2, ls.spontaneous);
    type.world.s(3,1,1, ls.become);
  }
  function addRotation(type) {
    type.world.s(1,3,0, ls.getSubDatum);
    type.world.s(1,4,0, ls.setRotation);
    type.automaticRotations = sixFaceRotations;
  }
  
  // --- default block worlds and block set ---

  var type;
  var blockset = new BlockSet([]);
  var ids = {};

  // color cube - world base and bogus-placeholder
  blockset.add(type = genedit(function (b) {
    return rgbPat(b);
  }));
  
  // ground block
  blockset.add(type = genedit(function (b) {
    return (f.te(b) ? f.cond(f.speckle, f.flat(brgb(.67,.34,.34)), f.flat(brgb(.67,0,0))) :
            f.tp(b) ? f.flat(brgb(1,.34,.34)) :
            f.cond(f.speckle, f.flat(brgb(.34,0,0)), f.flat(brgb(0,0,0))))(b);
  }));
  
  // ground block #2
  blockset.add(type = genedit(function (b) {
    return (f.te(b) ? f.cond(f.speckle, f.flat(brgb(.34,.67,.34)), f.flat(brgb(0,.34,0))) :
            f.tp(b) ? f.flat(brgb(.34,1,.34)) :
            f.cond(f.speckle, f.flat(brgb(0,.34,0)), f.flat(brgb(0,1,1))))(b);
  }));
  
  // pyramid thing
  var pyr1 = blockset.length;
  blockset.add(type = genedit(function (b) {
    if (Math.abs(b[0] - HALF) + Math.abs(b[1] - HALF) > (TS-0.5)-b[2])
      return 0;
    return brgb(mod((b[2]+2)/(TS/2), 1), Math.floor((b[2]+2)/(TS/2))*0.5, 0);
  }));
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
  
  // leaves/hedge
  ids.greenery = blockset.length;
  blockset.add(type = genedit(function (b) {
    var edgeness = f.maxrad(b);
    if (Math.random() >= edgeness*0.2) return 0;
    var green = Math.random() * 0.75 + 0.25;
    var notgreen = Math.random() * green*0.3 + green*0.25;
    return brgb(notgreen,green*edgeness,notgreen*(1-edgeness));
  }));
  addRotation(type); // allows random orientation to reduce uniformity

  // pillar thing
  blockset.add(type = genedit(function (b) {
    return Math.max(Math.abs(b[0] - TS/2), Math.abs(b[2] - TS/2)) <= TS/4 ? brgbDither(.5,.5,0) : 0;
  }));
  
  // glass sheet for buildings
  ids.glass = blockset.length;
  blockset.add(type = genedit(function (b) {
    return (f.xe(b) || f.te(b) || f.be(b)) && b[2] == TL ? brgb(.9,.9,.9) : 0;
  }));
  addRotation(type);
  
  // "big chunk of stone" block
  ids.slab = blockset.length;
  blockset.add(type = genedit(function (b) {
    var g = Math.pow(f.maxrad(b), 0.25) * 0.7 + f.rad(b)/HALF * 0.1 + normalish() * 0.2;
    g = Math.min(1, g * 0.8);
    return /* b[2] >= 8 ? 0 : */ brgbDither(g,g,g);
  }));
  

  // random block types
  ids.firstRandom = blockset.length;
  ids.lastRandom = ids.firstRandom + 3;
  while (blockset.length <= ids.lastRandom) {
    blockset.add(WorldGen.newRandomBlockType(TS, colorSet));
  }

  var l = WorldGen.addLogicBlocks(TS, {blockset: blockset}, fullLogicAndColors);
  
  
  // --- big world ---
  

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

    // Using raw array access because it lets us cache the altitude computation by iterating over y last, not because the overhead of .edit() is especially high.
    var raw = topWorld.raw;
    var rawSubData = topWorld.rawSubData;
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
          raw[index] = y < bottom ? 0 :
                       altitude > 1 ? 0 :
                       altitude < 0 ? 1 :
                       altitude == 0 ? 2 :
                       /* altitude == 1 */ random() > 0.99 ? (rawSubData[index] = 4, 4) : 0;
        }
      }
    }
    topWorld.notifyRawEdit();
  }
  
  function generateCity() {
    // --- Parameters ---
    
    // Blocks
    var air = BlockSet.ID_EMPTY;
    var bedrock = BlockSet.ID_BOGUS;
    var ground = 3; // TODO magic number
    var road = ids.slab;
    
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
    
    function roadBuilder(pos, vel, width) {
      return posLoop(pos, vel, 
          function (p) { return topWorld.g(p[0],p[1],p[2]) == ground; }, 
          function (pos) {
        var perp = counterclockwise(vel);
        setvec(maddy(pos, 1, perp, -width-1), ids.greenery, Math.floor(Math.random()*applyCubeSymmetry.COUNT));
        setvec(maddy(pos, 1, perp, +width+1), ids.greenery, Math.floor(Math.random()*applyCubeSymmetry.COUNT));
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
    
    function buildingBuilder(origin, u, v, usize, vsize) {
      var buildingFloorHeight = 3 + Math.floor(Math.random() * 3);
      
      var material = f.pick([
        ids.firstRandom+0, // TODO use ids.lastRandom
        ids.firstRandom+1,
        ids.firstRandom+2,
        ids.firstRandom+3,
        ids.slab,
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
          fill(madd(worigin, wdir, 1), maddy(worigin, buildingFloorHeight-2, wdir, size-2), ids.glass, frontFaceTo(clockwise(wdir)));
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
    var x = 182/400*wx, y = Math.floor(wy/2)+3, z = 191/400*wx;
    topWorld.s(x+0,y,z+1,l.pad);
    topWorld.s(x+0,y,z+2,l.wire);
    topWorld.s(x+0,y,z+3,l.indicator);                    
    topWorld.s(x+0,y,z+4,l.wire);
    topWorld.s(x+0,y,z+5,l.nor);
    
    topWorld.s(x-1,y,z+5,l.wire);
    topWorld.s(x-2,y,z+5,l.gate);
    topWorld.s(x-3,y,z+5,l.emitConstant,42);
    topWorld.s(x-2,y,z+4,l.pad);

    topWorld.s(x+1,y,z+5,l.wire);
    topWorld.s(x+2,y,z+5,l.junction);
    topWorld.s(x+2,y,z+4,l.wire);
    topWorld.s(x+2,y,z+3,l.nor);
    topWorld.s(x+3,y,z+3,l.wire);
    topWorld.s(x+4,y,z+3,l.pad);
  }());
  
  return topWorld;
}
