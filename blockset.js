// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var BlockType = (function () {
  "use strict";
  
  // TODO KLUDGE: The scope of this seems wrong; it should be either an more global "unimportant things to do" queue or a more narrow driven-by-the-game-loop thing.
  var soundRenderQueue = new DirtyQueue();
  
  setTimeout(function () { // TODO global variable config (which is the only reason this is deferred)
    config.sound.nowAndWhenChanged(function (enabled) {
      soundRenderQueue.setBackgroundFlusher(enabled ? function (f) { f(); } : null);
      return true;
    });
  }, 0);
  
  // Global non-persistent serial numbers for block types, used in the sound render queue.
  var nextBlockTypeSerial = 0;
  
  function BlockType() {
    throw new Error("abstract");
  }
  
  function _BlockTypeSuper() {
    if (!(this instanceof BlockType))
      throw new Error("bad constructor call");
    
    var n = new Notifier("BlockType");
    this._notify = n.notify; // should be private
    this.listen = n.listen;
    
    this._serial = nextBlockTypeSerial++;
    this.sound = {}; // computed, TODO should be readonly
    
    // TODO: This property is to be replaced by circuits.
    this.automaticRotations = [0]; // editable property
    
    this.solid = true; // editable property
    
    this.behavior = null; // editable property
  }
  
  BlockType.prototype.serialize = function (serialize) {
    var json = {};
    if (this.automaticRotations.length !== 1 || this.automaticRotations[0] !== 0)
      json.automaticRotations = this.automaticRotations;
    if (!this.solid) json.solid = false; // default true
    if (this.behavior && this.behavior.name)
      json.behavior = this.behavior.name;
    return json;
  }
  
  BlockType.World = function (world) {
    _BlockTypeSuper.call(this);
    
    this.world = world;
    this.opaque = undefined;
    this.hasCircuits = false;
    
    // TODO: update listener if world is set, or reject world setting
    // note there is no opportunity here to remove listener, but it is unlikely to be needed.
    var self = this;
    function rebuild() {
      _recomputeOpacity.call(self);
      self._notify("appearanceChanged");
      return true;
    }
    function checkCircuits() {
      self.hasCircuits = false;
      var c = self.world.getCircuits();
      for (var k in c) {
        if (c.hasOwnProperty(k)) {
          self.hasCircuits = true;
          return true;
        }
      }
      return true;
    }
    world.listen({
      dirtyBlock: rebuild,
      dirtyAll: rebuild,
      dirtyCircuit: checkCircuits,
      deletedCircuit: checkCircuits
    });

    _recomputeOpacity.call(this);
    checkCircuits();
    
    Object.seal(this);
  };
  BlockType.World.prototype = Object.create(BlockType.prototype);
  BlockType.World.prototype.constructor = BlockType.World;
  
  Object.defineProperty(BlockType.World.prototype, "color", {
    enumerable: true,
    value: null
  });
  
  // TODO: implement nonstubbily
  BlockType.World.prototype.writeColor =
      function (scale, target, offset) {
    target[offset] = scale;
    target[offset+1] = scale;
    target[offset+2] = scale;
    target[offset+3] = scale;
  };
  
  function _recomputeOpacity() {
    var tileSize = this.world.wx; // assumed cubical
    var tileLastIndex = tileSize - 1;
    var opaque = true;
    for (var dim = 0; dim < 3; dim++) {
      var ud = mod(dim+1,3);
      var vd = mod(dim+2,3);
      for (var u = 0; u < tileSize; u++)
      for (var v = 0; v < tileSize; v++) {
        var vec = [u,v,0];
        opaque = opaque && this.world.opaque(vec[dim],vec[ud],vec[vd]);
        vec[2] = tileLastIndex;
        opaque = opaque && this.world.opaque(vec[dim],vec[ud],vec[vd]);
      }
    }
    this.opaque = opaque;
    
    // audio recalc is done async to reduce initial load delay
    var self = this;
    function f() {
      self.sound = CubesAudio.synthBlock(self.world);
    }
    f.toString = function () { return ""+self._serial; }; // TODO KLUDGE we should use something other than DirtyQueue, or extend it to have 'values as well as keys'
    soundRenderQueue.enqueue(f);
  }
  
  BlockType.World.prototype.serialize = function (serialize) {
    var json = BlockType.prototype.serialize.call(this);
    json.world = serialize(this.world);
    return json;
  };
  
  // rgba is an array of 4 elements in the range [0,1].
  BlockType.Color = function (rgba) {
    _BlockTypeSuper.call(this);
    
    this.color = rgba;
    // TODO set up notification

    Object.seal(this);
  };
  BlockType.Color.prototype = Object.create(BlockType.prototype);
  BlockType.Color.prototype.constructor = BlockType.Color;

  Object.defineProperty(BlockType.Color.prototype, "opaque", {
    enumerable: true,
    get: function () {
      return this.color[3] >= 1;
    }
  });
  Object.defineProperty(BlockType.Color.prototype, "world", {
    enumerable: true,
    value: null
  });
  Object.defineProperty(BlockType.Color.prototype, "hasCircuits", {
    enumerable: true,
    value: false
  });
  
  BlockType.Color.prototype.writeColor =
      function (scale, target, offset) {
    target[offset]   = scale*this.color[0];
    target[offset+1] = scale*this.color[1];
    target[offset+2] = scale*this.color[2];
    target[offset+3] = scale*this.color[3];
  };
  
  BlockType.Color.prototype.serialize = function (serialize) {
    var json = BlockType.prototype.serialize.call(this);
    json.color = this.color;
    return json;
  };
  
  BlockType.air = new BlockType.Color([0,0,0,0]);
  BlockType.air.solid = false;
  
  BlockType.unserialize = function (json, unserialize) {
    var self;
    if (json.color) {
      self = new BlockType.Color(json.color);
    } else if (json.world) {
      self = new BlockType.World(unserialize(json.world, World));
    } else {
      throw new Error("unknown BlockType serialization type");
    }
    
    if (Object.prototype.hasOwnProperty.call(json, "automaticRotations"))
      self.automaticRotations = json.automaticRotations || [0];
    if (Object.prototype.hasOwnProperty.call(json, "solid"))
      self.solid = json.solid;
    if (Object.prototype.hasOwnProperty.call(json, "behavior"))
      self.behavior = Circuit.behaviors.hasOwnProperty(json.behavior) 
          ? Circuit.behaviors[json.behavior] : null;
    
    return self;
  };
  
  BlockType.audioRendersToDo = function () {
    // TODO global variable main
    return config.sound.get() ? soundRenderQueue.size() : 0;
  };
  
  return Object.freeze(BlockType);
})();

var BlockSet = (function () {
  "use strict";
  
  // Texture parameters
  var TILE_MAPPINGS = [
    // in this matrix layout, the input (column) vector is the tile coords
    // and the output (row) vector is the world space coords
    // so the lower row is the translation component.
    ["z", mat4.create([
      // low z face
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ])],
    ["x", mat4.create([
      // low x face
      0, 1, 0, 0,
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 0, 0, 1
    ])],
    ["y", mat4.create([
      // low y face
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1
    ])],
  ];

  var EMPTY_TEXCOORDS = {};
  var EMPTY_VERTICES = {};
  TILE_MAPPINGS.forEach(function (m) {
    var dimName = m[0];
    EMPTY_TEXCOORDS["l" + dimName] =
    EMPTY_TEXCOORDS["h" + dimName] = [];
    var g =
    EMPTY_VERTICES["l" + dimName] =
    EMPTY_VERTICES["h" + dimName] = [];
    for (var rot = 0; rot < applyCubeSymmetry.COUNT; rot++) {
      g.push([]);
    }
  });
  Object.freeze(EMPTY_TEXCOORDS);
  Object.freeze(EMPTY_VERTICES);
  
  function smallestPowerOf2AtLeast(x) {
    var result = Math.pow(2, Math.ceil(Math.log(x)/Math.LN2));
    if (result < x) { // in case of FP rounding down
      result *= 2;
    }
    return result;
  }

  function pushVertex(array, vec) {
    array.push(vec[0], vec[1], vec[2]);
  }
  
  function rotateVertices(rot, vertices) {
    var out = [];
    for (var i = 0; i < vertices.length; i += 3) {
      var t = applyCubeSymmetry(rot, 1, [vertices[i], vertices[i+1], vertices[i+2]]);
      out.push(t[0],t[1],t[2]);
    }
    return out;
  }
  
  // Compute the texture coordinates for a tile as needed by WorldRenderer
  function calcTexCoords(texgen, usageIndex, flipped) {
    var uv = texgen.uvFor(usageIndex);
    var tileUVSize = texgen.tileUVSize;
    var texO = flipped ? tileUVSize : 0;
    var texD = flipped ? 0 : tileUVSize;
    var uo = uv[1];
    var vo = uv[0];
    return [
      uo + texO, vo + texO,
      uo + tileUVSize, vo + 0,
      uo + 0, vo + tileUVSize,
      uo + texD, vo + texD,
      uo + 0, vo + tileUVSize,
      uo + tileUVSize, vo + 0
    ];
  }
  
  function Texgen(tileSize) {
    var renderer = main.renderer; // TODO global variable -- the problem being that BlockSets are not (and should not be) parameterized w/ a renderer.
    var self = this;
    var gl = renderer.context;
    
    this.tileSize = tileSize;
    
    // Texture holding tiles
    // TODO: Confirm that WebGL garbage collects these, or add a delete method to BlockSet for use as needed
    // TODO: Arrange so that if mustRebuild, we only recreate the GL texture rather than repainting
    this.texture = gl.createTexture();
    this.mustRebuild = renderer.currentContextTicket();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    
    var tileCountSqrt = 16; // initial allocation; gets multiplied by 2
    var blockTextureData;
    var tileAllocMap;
    var freePointer;
    var usageMap;
    this.textureLost = false;
    function enlargeTexture() {
      tileCountSqrt *= 2;

      var texturePOTSize = smallestPowerOf2AtLeast(tileSize * tileCountSqrt);
            
      self.tileUVSize = tileSize/texturePOTSize;
      
      // ImageData object used to buffer calculated texture data
      self.image = document.createElement("canvas").getContext("2d")
        .createImageData(texturePOTSize, texturePOTSize);
      
      // tile position allocator
      tileAllocMap = new Uint8Array(tileCountSqrt*tileCountSqrt);
      freePointer = 0;
      
      // table mapping block slices to tile indexes, format 'worldindex,dimName,layerindex'
      usageMap = {};
      
      // Flag indicating reallocation
      self.textureLost = true;
    }
    enlargeTexture();
    
    this.allocationFor = function (usageIndex) {
      if (self.textureLost) {
        // Inhibit adding entries to usageMap until the client acknowledges textureLost
        return [0,0];
      }
      var index;
      if (usageIndex in usageMap) {
        index = usageMap[usageIndex];
      } else {
        index = usageMap[usageIndex] = tileAlloc();
        //console.log("allocating", usageMap[usageIndex], "for", usageIndex);
      }
      return tileCoords(index);
    };
    this.uvFor = function (usageIndex) {
      var c = self.allocationFor(usageIndex);
      c[0] *= self.tileUVSize;
      c[1] *= self.tileUVSize;
      return c;
    };
    this.deallocateUsage = function (usageIndex) {
      if (self.textureLost) {
        return;
      }
      tileFree(usageMap[usageIndex]);
      delete usageMap[usageIndex];
    }
    
    function tileAlloc() {
      var n = 0;
      while (tileAllocMap[freePointer]) {
        if ((++n) >= tileAllocMap.length) {
          if (typeof console !== 'undefined') 
            console.info("Enlarging block texture to hold", (tileAllocMap.length + 1));
          enlargeTexture();
          return 0;
        }
        freePointer = mod(freePointer + 1, tileAllocMap.length);
      }
      tileAllocMap[freePointer] = 1;
      return freePointer;
    }
    function tileFree(index) {
      tileAllocMap[index] = 0;
    }
    function tileCoords(index) {
      return [Math.floor(index / tileCountSqrt), mod(index, tileCountSqrt)];
    }
  }
  
  function BlockSet(initialTypes) {
    var tileSize = NaN;

    // All block sets unconditionally have the standard empty block at ID 0.
    var types = [BlockType.air];
    var texcoordsByFaceByBlock = [EMPTY_TEXCOORDS];
    var verticesByRotationByFaceByBlock = [EMPTY_VERTICES];
    
    var texgen = null;
    var typesToRerender = new DirtyQueue();
    
    function rebuildOne(blockID) {
      var tileSize = texgen.tileSize; // shadowing
      var tileLastIndex = tileSize - 1;
      var blockType = types[blockID];
      var texcoordsByFace = texcoordsByFaceByBlock[blockID];
      var verticesByRotationByFace = verticesByRotationByFaceByBlock[blockID];
      
      var texWidth = texgen.image.width;
      var texData = texgen.image.data;
      
      function pushQuad(vertices, texcoords, flipped, transform, depth, usageIndex) {
        texcoords.push.apply(texcoords, calcTexCoords(texgen, usageIndex, flipped));
        var a = flipped ? 1 : 0;
        var b = flipped ? 0 : 1;
        
        pushVertex(vertices, mat4.multiplyVec3(transform, [a,a,depth]));
        pushVertex(vertices, mat4.multiplyVec3(transform, [0,1,depth]));
        pushVertex(vertices, mat4.multiplyVec3(transform, [1,0,depth]));
        
        pushVertex(vertices, mat4.multiplyVec3(transform, [b,b,depth]));
        pushVertex(vertices, mat4.multiplyVec3(transform, [1,0,depth]));
        pushVertex(vertices, mat4.multiplyVec3(transform, [0,1,depth]));
      }
      
      if (blockType.color) { // TODO: factor this conditional into BlockType
        var color = blockType.color;
        var usageIndex = blockID.toString();
        var coord = texgen.allocationFor(usageIndex);
        var r = 255 * color[0];
        var g = 255 * color[1];
        var b = 255 * color[2];
        var a = 255 * color[3];

        var tileu = coord[0], tilev = coord[1];
        var pixu = tileu*tileSize;
        var pixv = tilev*tileSize;
        for (var u = 0; u < tileSize; u++)
        for (var v = 0; v < tileSize; v++) {
          var c = ((pixu+u) * texWidth + pixv+v) * 4;
          texData[c+0] = r;
          texData[c+1] = g;
          texData[c+2] = b;
          texData[c+3] = a;
        }
        
        TILE_MAPPINGS.forEach(function (m) {
          var dimName = m[0];
          var transform = m[1];
          var verticesL = [];
          var verticesH = [];
          var texcoords = [];
          // Texture is a solid color, so we only need one set of texcoords.
          pushQuad(verticesL, texcoords, false, transform, 0, usageIndex);
          pushQuad(verticesH, [],        true,  transform, 1, usageIndex);
          var rotationsL = [];
          var rotationsH = [];
          for (var i = 0; i < applyCubeSymmetry.COUNT; i++) {
            rotationsL[i] = verticesL;
            rotationsH[i] = verticesH;
          }
          texcoordsByFace["l" + dimName] = texcoords;
          texcoordsByFace["h" + dimName] = texcoords;
          verticesByRotationByFace["l" + dimName] = rotationsL;
          verticesByRotationByFace["h" + dimName] = rotationsH;
        });
      } else if (blockType.world) {
        (function () {
          var world = blockType.world;
          
          // To support non-cubical objects, we slice the entire volume of the block and generate as many tiles as needed. sliceWorld generates one such slice.
          
          // data structures for slice loop
          var vec = vec3.create();
          var viewL = vec3.create();
          var viewH = vec3.create();
          
          function sliceWorld(dimName, layer, transform, texcoordsL, texcoordsH, verticesL, verticesH) {
            var usageIndex = blockID + "," + dimName + "," + layer;
            
            var coord = texgen.allocationFor(usageIndex);
            var tileu = coord[0], tilev = coord[1];
            
            var thisLayerNotEmptyL = false;
            var thisLayerNotEmptyH = false;
            var pixu = tileu*tileSize;
            var pixv = tilev*tileSize;
            
            // viewL is the offset of the subcube which would block the view
            // of this subcube if it is opaque.
            viewL[0] = 0; viewL[1] = 0; viewL[2] = -1;
            viewH[0] = 0; viewH[1] = 0; viewH[2] = +1;
            mat4.multiplyVec3(transform, viewL, viewL);
            mat4.multiplyVec3(transform, viewH, viewH);
            
            // extract surface plane of block from world
            for (var u = 0; u < tileSize; u++)
            for (var v = 0; v < tileSize; v++) {
              var c = ((pixu+u) * texWidth + pixv+v) * 4;
              vec[0] = u; vec[1] = v; vec[2] = layer;
              mat4.multiplyVec3(transform, vec, vec);
          
              world.gt(vec[0],vec[1],vec[2]).writeColor(255, texData, c);

              if (texData[c+3] > 0) {
                // A layer has significant content only if there is an UNOBSCURED opaque pixel.
                // If a layer is "empty" in this sense, it is not rendered.
                // If it is empty from both directions, then it is deallocated.
                if (!world.opaque(vec[0]+viewL[0],vec[1]+viewL[1],vec[2]+viewL[2])) {
                  thisLayerNotEmptyL = true;
                }
                if (!world.opaque(vec[0]+viewH[0],vec[1]+viewH[1],vec[2]+viewH[2])) {
                  thisLayerNotEmptyH = true;
                }
              }
            }
            
            if (!thisLayerNotEmptyL && !thisLayerNotEmptyH) {
              // We can reuse this tile iff it was blank or fully obscured
              texgen.deallocateUsage(usageIndex);
            } else {
              // If the layer has unobscured content, and it is not an interior surface of an opaque block, then add it to rendering. Note that the TILE_MAPPINGS loop skips slicing interiors of opaque blocks, but they still need to have the last layer excluded because the choice of call to sliceWorld does not express that.
              if (thisLayerNotEmptyL && (!blockType.opaque || layer == 0)) {
                pushQuad(verticesL, texcoordsL, false, transform, layer/tileSize, usageIndex);
              }
              if (thisLayerNotEmptyH && (!blockType.opaque || layer == tileLastIndex)) {
                pushQuad(verticesH, texcoordsH, true, transform, (layer+1)/tileSize, usageIndex);
              }
            }
            
            // TODO: trigger rerender of chunks only if we made changes to the texcoords, not if only the colors changed
            
            //console.log("id ", wi + 1, " dim ", dimName, " layer ", layer, (thisLayerNotEmptyL || thisLayerNotEmptyH) ? " allocated" : " skipped");
          }          
          TILE_MAPPINGS.forEach(function (m) {
            var dimName = m[0];
            var transform = m[1];
            var texcoordsL = texcoordsByFace["l" + dimName] = [];
            var texcoordsH = texcoordsByFace["h" + dimName] = [];
            var verticesByRotationL = verticesByRotationByFace["l" + dimName] = [];
            var verticesByRotationH = verticesByRotationByFace["h" + dimName] = [];
            var verticesL = [];
            var verticesH = [];
            if (blockType.opaque) {
              if (texgen.textureLost) return;
              sliceWorld(dimName, 0,             transform, texcoordsL, texcoordsH, verticesL, verticesH);
              sliceWorld(dimName, tileLastIndex, transform, texcoordsL, texcoordsH, verticesL, verticesH);
            } else {
              for (var layer = 0; layer < tileSize; layer++) {
                if (texgen.textureLost) return;
                sliceWorld(dimName, layer, transform, texcoordsL, texcoordsH, verticesL, verticesH);
              }
            }
            for (var rot = 0; rot < applyCubeSymmetry.COUNT; rot++) {
              verticesByRotationL[rot] = rotateVertices(rot, verticesL);
              verticesByRotationH[rot] = rotateVertices(rot, verticesH);
            }
          });
        })();
      } else {
        throw new Error("Don't know how to render the BlockType");
      }
    }
    
    function freshenTexture() {
      var upload = false;
      if (!texgen || texgen.mustRebuild()) {
        texgen = new Texgen(self.tileSize);
      }
      while (texgen.textureLost) {
        //console.info("Performing full block texture rebuild.");
        texgen.textureLost = false;
        var l = self.length;
        for (var id = BlockSet.ID_EMPTY + 1; id < l && !texgen.textureLost; id++)
          rebuildOne(id);
        upload = true;
      }
      while (typesToRerender.size()) {
        rebuildOne(typesToRerender.dequeue());
        upload = true;
      }
      if (upload) {
        var gl = main.renderer.context; // TODO global variable
        gl.bindTexture(gl.TEXTURE_2D, texgen.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texgen.image);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    }
    
    var notifier = new Notifier("BlockSet");
    
    var self = Object.freeze({
      get tileSize () {
        // If tile size is undefined because we have only color blocks, then we treat it as 1
        return isNaN(tileSize) ? 1 : tileSize;
      }, 
      get length () { return types.length; },
      
      add: function (newBlockType) {
        var newID = types.length;
        types.push(newBlockType);
        texcoordsByFaceByBlock.push({});
        verticesByRotationByFaceByBlock.push({});
        typesToRerender.enqueue(newID);
        newBlockType.listen({
          appearanceChanged: function () {
            // TODO: notify applicable world renderers promptly
            typesToRerender.enqueue(newID);
            notifier.notify("texturingChanged", newID);
            return true;
          }
        });
        
        // TODO: This is not correct if BlockTypes are allowed to change their worlds
        if (newBlockType.world) {
          var ts = newBlockType.world.wx; // assuming cubicality
          if (tileSize == ts || isNaN(tileSize)) {
            tileSize = ts;
          } else {
            if (typeof console !== "undefined")
              console.warn("Inconsistent tile size for blockset; set has", tileSize, "and new type has", ts);
          }
        }
      },
      
      get: function (blockID) {
        return types[blockID] || types[BlockSet.ID_BOGUS] || types[BlockSet.ID_EMPTY];
      },
      
      // Return an ID_LIMIT-element array snapshotting the results of get().
      getAll: function () {
        var array = types.slice();
        var bogus = types[BlockSet.ID_BOGUS] || types[BlockSet.ID_EMPTY];
        for (var i = array.length; i < BlockSet.ID_LIMIT; i++) {
          array[i] = bogus;
        }
        return array;
      },
      
      listen: notifier.listen,
      
      // Return the data required to render blocks, updating if it is out of date.
      getRenderData: function () {
        freshenTexture();
        texcoordsByFaceByBlock.bogus = texcoordsByFaceByBlock[BlockSet.ID_BOGUS] || EMPTY_TEXCOORDS;
        verticesByRotationByFaceByBlock.bogus =
            verticesByRotationByFaceByBlock[BlockSet.ID_BOGUS] || EMPTY_VERTICES;
        return {
          texture: texgen.texture,
          texcoordsByFaceByBlock: texcoordsByFaceByBlock,
          verticesByRotationByFaceByBlock: verticesByRotationByFaceByBlock
        };
      },
      worldFor: function (blockID) {
        return types[blockID] ? types[blockID].world : null;
      },
      serialize: function (serialize) {
        return {
          type: "types",
          types: types.slice(1).map(function (type) { return serialize(type); })
        }
      }
    });
    
    initialTypes.forEach(self.add);
    
    return self;
  }
  
  // This block ID is always empty air.
  BlockSet.ID_EMPTY = 0;
  
  // This block ID is used when an invalid block ID is met
  BlockSet.ID_BOGUS = 1;
  
  // The maximum number of possible block types.
  // This value arises because worlds store blocks as bytes.
  BlockSet.ID_LIMIT = 256;
  
  BlockSet.unserialize = function (json, unserialize) {
    if (json.type === "colors") {
      // obsolete serialization type
      var colors = WorldGen.colorBlocks(4,4,4).blockset;
      var list = colors.getAll().slice(1, colors.length);
      list.push(list.shift());
      return new BlockSet(list);
    } else if (json.type === "textured") {
      // obsolete serialization type
      var blockTypes = json.worlds.map(function (world) {
        return new BlockType.World(unserialize(world, World));
      });
      return new BlockSet(blockTypes);
    } else if (json.type === "types") {
      var blockTypes = json.types.map(function (type) {
        return unserialize(type, BlockType);
      });
      return new BlockSet(blockTypes);
    } else {
      throw new Error("unknown BlockSet serialization type");
    }
  };

  return Object.freeze(BlockSet);
})();
