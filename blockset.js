// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

(function () {
  "use strict";
  
  var CatchupQueue = cubes.util.CatchupQueue;
  var Cell = cubes.storage.Cell;
  var Circuit = cubes.Circuit;
  var CubeRotation = cubes.util.CubeRotation;
  var max = Math.max;
  var min = Math.min;
  var mod = cubes.util.mod;
  var Notifier = cubes.util.Notifier;
  var ObjectMap = cubes.util.ObjectMap;
  var Persister = cubes.storage.Persister;
  var World = cubes.World;
  
  function noop() {}
  
  // Global non-persistent serial numbers for block types, used in the sound render queue.
  var nextBlockTypeSerial = 0;
  
  // Either color or world should be provided, or both.
  // color is an array of 4 elements in the range [0,1].
  function BlockType(color, world) {
    if (!(this instanceof BlockType)) {
      throw new Error("bad constructor call");
    }
    var self = this;
    
    var n = new Notifier("BlockType");
    this._notify = n.notify; // TODO should be private
    this.listen = n.listen;
    
    this._serial = nextBlockTypeSerial++;
    
    // Appearance/structure
    this.color = color || null;
    this.world = world || null;
    
    // Properties
    this.automaticRotations = [0]; // TODO: This property is to be replaced by circuits.
    this.behavior = null;
    this.name = null;
    this.solid = true;
    this.light = 0; // Light emission — float scale where 1.0 is an "ordinary light"
    
    // Cached calculated properties
    var opaque, hasCircuits, derivedColor;
    var needsAnalysis = true;
    Object.defineProperties(this, {
      derivedColor: {
        // The color which this block exhibits as a subcube.
        enumerable: true,
        get: function () {
          if (needsAnalysis) doAnalysis();
          return derivedColor;
        }
      },
      hasCircuits: {
        // Whether this block has any circuits; if not, they don't need to be reevaluated
        enumerable: true,
        get: function () {
          if (needsAnalysis) doAnalysis();
          return hasCircuits;
        }
      },
      opaque: {
        // Whether this block is 100% opaque at all of its outer faces.
        enumerable: true,
        get: function () {
          if (needsAnalysis) doAnalysis();
          return opaque;
        }
      }
    });
    
    function doAnalysis() {
      needsAnalysis = false;
      if (!world) {
        derivedColor = self.color || [0.5, 0.5, 0.5, 1.0];
        hasCircuits = false;
        opaque = self.color[3] >= 1;
      } else {
        var tileSize = world.wx; // assumed cubical
        var tileLastIndex = tileSize - 1;
        opaque = true;
        var color = vec3.create();
        var colorCount = 0;
        for (var dim = 0; dim < 3; dim++) {
          var ud = mod(dim+1,3);
          var vd = mod(dim+2,3);
          for (var u = 0; u < tileSize; u++)
          for (var v = 0; v < tileSize; v++) {
            var vec = [u,v,0];
            opaque = opaque && world.opaque(vec[dim],vec[ud],vec[vd]);
            vec[2] = tileLastIndex;
            opaque = opaque && world.opaque(vec[dim],vec[ud],vec[vd]);

            // raycast for color -- TODO use both sides
            while (!world.opaque(vec[dim],vec[ud],vec[vd]) && vec[2] < tileSize) {
              vec[2] += 1;
            }
            if (vec[2] < tileSize) {
              var subCubeColor = [];
              world.gt(vec[dim],vec[ud],vec[vd]).writeColor(1, subCubeColor, 0);
              vec3.add(color, subCubeColor);
              colorCount++;
            }
          }
        }
        derivedColor = self.color || vec3.scale(color, 1/colorCount);
        hasCircuits = world.getCircuits().length;
        // opaque is updated as we progress above
      }
    }
    
    // Hook up to world
    if (this.world) (function () {
      // TODO: update listener if world is set, or reject world setting
      // note there is no opportunity here to remove listener, but it is unlikely to be needed.
      function rebuild() {
        needsAnalysis = true;
        self._notify("appearanceChanged");
      }
      function dirtyProperties() {
        needsAnalysis = true;
      }
      world.listen({
        interest: function () { return true; },
        dirtyBlock: rebuild,
        relitBlock: noop,
        dirtyAll: rebuild,
        dirtyCircuit: dirtyProperties,
        deletedCircuit: dirtyProperties,
        changedBlockset: rebuild,
        audioEvent: noop
      });
    }());
    
    Object.seal(this);
  }
  BlockType.prototype.reflectivity = 0.9; // This is not an instance property because I don't yet want to hardcode a particular value that gets saved.
  
  BlockType.prototype.writeColor =
      function (scale, target, offset) {
    var color = this.derivedColor;
    target[offset]   = scale*color[0];
    target[offset+1] = scale*color[1];
    target[offset+2] = scale*color[2];
    target[offset+3] = scale*color[3];
  };  
  
  BlockType.prototype.toString = function () {
    var s = "[BlockType #" + this.serial;
    if (world) s += " world";
    if (color) s += " color " + this.color;
    s += "]";
    return s;
  };
  
  BlockType.prototype.serialize = function (serialize) {
    var json = {};
    serialize.setUnserializer(json, BlockType);
    if (this.color)
      json.color = this.color;
    if (this.world)
      json.world = serialize(this.world);
    if (this.automaticRotations.length !== 1 || this.automaticRotations[0] !== 0)
      json.automaticRotations = this.automaticRotations;
    if (this.behavior && this.behavior.name)
      json.behavior = this.behavior.name;
    if (this.name !== null)
      json.name = this.name;
    if (!this.solid) json.solid = false; // default true
    if (this.light !== 0)
      json.light = this.light;
    return json;
  };
  
  BlockType.air = new BlockType([0,0,0,0], null);
  BlockType.air.solid = false;
  
  Persister.types["BlockType"] = BlockType;
  BlockType.unserialize = function (json, unserialize) {
    var self = new BlockType(
        json.color,
        "world" in json ? unserialize(json.world, World) :  null);
    
    if (Object.prototype.hasOwnProperty.call(json, "automaticRotations"))
      self.automaticRotations = json.automaticRotations || [0];
    if (Object.prototype.hasOwnProperty.call(json, "behavior"))
      self.behavior = Circuit.behaviors.hasOwnProperty(json.behavior) 
          ? Circuit.behaviors[json.behavior] : null;
    if (Object.prototype.hasOwnProperty.call(json, "name"))
      self.name = json.name;
    if (Object.prototype.hasOwnProperty.call(json, "solid"))
      self.solid = json.solid;
    if (Object.prototype.hasOwnProperty.call(json, "light"))
      self.light = json.light;
    
    return self;
  };
  
  cubes.BlockType = Object.freeze(BlockType);
  
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
    ])]
  ];

  var EMPTY_GEOMETRY = {vertices: [], texcoords: []};
  var EMPTY_FACES = [];
  TILE_MAPPINGS.forEach(function (m) {
    var dimName = m[0];
    EMPTY_FACES["l" + dimName] = 
    EMPTY_FACES["h" + dimName] = EMPTY_GEOMETRY;
  });
  var EMPTY_BLOCKRENDER = [];
  for (var rot = 0; rot < CubeRotation.codeRange; rot++) {
    EMPTY_BLOCKRENDER.push(EMPTY_FACES);
  }
  
  
  function pushVertex(array, vec) {
    array.push(vec[0], vec[1], vec[2]);
  }
  
  function rotateVertices(rot, vertices) {
    var out = [];
    var t = [];
    if (rot.isReflection) {
      for (var i = vertices.length - 3; i >= 0; i -= 3) {
        rot.transformPoint([vertices[i], vertices[i+1], vertices[i+2]], t);
        out.push(t[0],t[1],t[2]);
      }
    } else {
      for (var i = 0; i < vertices.length; i += 3) {
        rot.transformPoint([vertices[i], vertices[i+1], vertices[i+2]], t);
        out.push(t[0],t[1],t[2]);
      }
    }
    return out;
  }
  
  function rotateTexcoords(rot, texcoords) {
    if (rot.isReflection) {
      var out = [];
      for (var i = texcoords.length - 2; i >= 0; i -= 2) {
        out.push(texcoords[i],texcoords[i+1]);
      }
      return out;
    } else {
      return texcoords;
    }
  }
  
  function rotateFaceData(rot, faceData) {
    var out = {};
    Object.keys(faceData).forEach(function (face) {
      var f = faceData[face];
      out[face] = {vertices: rotateVertices(rot, f.vertices), texcoords: rotateTexcoords(rot, f.texcoords)};
    });
    return out;
  }
  
  // Compute the texture coordinates for a tile as needed by WorldRenderer
  function calcTexCoords(texgen, usageIndex, flipped, ul, uh, vl, vh) {
    var uv = texgen.uvFor(usageIndex);
    var tileUVSize = texgen.tileUVSize;
    ul *= tileUVSize;
    uh *= tileUVSize;
    vl *= tileUVSize;
    vh *= tileUVSize;
    var uo = uv[0];
    var vo = uv[1];
    var c = [
      uo + ul, vo + vl,
      uo + ul, vo + vh,
      uo + uh, vo + vl,
      uo + uh, vo + vh,
      uo + uh, vo + vl,
      uo + ul, vo + vh
    ];
    if (flipped) {
      // Reverse winding order
      for (var i = 0; i < 6; i += 2) {
        var tu = c[i];
        var tv = c[i+1];
        c[i] = c[10-i];
        c[i+1] = c[11-i];
        c[10-i] = tu;
        c[11-i] = tv;
      }
    }
    return c;
  }
  
  function Texgen(tileSize, renderer) {
    var self = this;
    var gl = renderer.context;
    
    this.tileSize = tileSize;
    this.context = gl;

    // Size of an actual tile in the texture, with borders
    var /*constant*/ borderTileSize = tileSize + 2;

    // Pixel size of texture. Chosen so that current example world data does not need reallocation
    this.textureSize = 1024;
    
    // Values computed from the texture size
    var borderTileUVSize; // Size of one tile, including border, in the texture in UV coordinates
    var borderUVOffset;   // Offset from 0,0 of the corner of a tile
    var tileCountSqrt;    // Number of tiles which fit in one row/column of the texture
    
    // Texture holding tiles
    // TODO: Confirm that WebGL garbage collects these, or add a delete method to Blockset for use as needed
    // TODO: Arrange so that if mustRebuild, we only recreate the GL texture rather than repainting
    this.texture = gl.createTexture();
    this.mustRebuild = renderer.currentContextTicket();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    
    var blockTextureData;
    var tileAllocMap;
    var freePointer;
    var usageMap;
    var overrun = false;
    this.textureLost = false;
    
    function initForSize() {
      var textureSize = self.textureSize;
      
      self.tileUVSize = tileSize/textureSize;
      borderUVOffset = 1/textureSize;
      borderTileUVSize = borderTileSize/textureSize;
      tileCountSqrt = Math.floor(textureSize/borderTileSize);
      
      // Texture data (RGBA)
      self.image = new Uint8Array(textureSize * textureSize * 4);
      
      // tile position allocator
      tileAllocMap = new Uint8Array(tileCountSqrt*tileCountSqrt);
      freePointer = 0;
      
      // table mapping block slices to tile indexes, format 'worldindex,dimName,layerindex'
      usageMap = {};
      
      // Flag indicating reallocation
      self.textureLost = true;
    }
    initForSize();
    
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
      c[0] = borderUVOffset + borderTileUVSize*c[0];
      c[1] = borderUVOffset + borderTileUVSize*c[1];
      return c;
    };
    this.imageCoordsFor = function (usageIndex) {
      var c = self.allocationFor(usageIndex);
      c[0] = 1 + borderTileSize*c[0];
      c[1] = 1 + borderTileSize*c[1];
      return c;
    };
    this.deallocateUsage = function (usageIndex) {
      if (self.textureLost) {
        return;
      }
      tileFree(usageMap[usageIndex]);
      delete usageMap[usageIndex];
    };
    this.completed = function (usageIndex) {
      // generate texture clamp border
      var coords = this.imageCoordsFor(usageIndex);
      var w = this.textureSize;
      var data = self.image;
      function pix(u,v) {
        return (coords[0]+u + w * (coords[1]+v)) * 4;
      }
      function copy(dst, src) {
        data[dst] = data[src];
        data[dst+1] = data[src+1];
        data[dst+2] = data[src+2];
        data[dst+3] = data[src+3];
      }
      for (var x = 0; x < tileSize; x++) {
        copy(pix(x,-1), pix(x,0));
        copy(pix(x,tileSize), pix(x,tileSize-1));
      }
      for (var y = -1; y <= tileSize; y++) {
        copy(pix(-1,y), pix(0,y));
        copy(pix(tileSize,y), pix(tileSize-1,y));
      }
    };
    this.send = function () {
      var gl = this.context;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D,
                    0, // level
                    gl.RGBA, // internalformat
                    this.textureSize, // width
                    this.textureSize, // height
                    0, // border
                    gl.RGBA, // format
                    gl.UNSIGNED_BYTE, // type
                    this.image);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    
    function tileAlloc() {
      var n = 0;
      while (tileAllocMap[freePointer]) {
        if ((++n) >= tileAllocMap.length) {
          if (typeof console !== 'undefined') 
            console.info("Enlarging block texture to hold", (tileAllocMap.length + 1), "tiles.");
          var newSize = self.textureSize * 2;
          if (newSize >= gl.getParameter(gl.MAX_TEXTURE_SIZE)) { // NOTE: this may not be the true limit in the particular case but I don't see proxy textures or allocation failure checking in WebGL
            if (typeof console !== 'undefined' && !overrun)
              console.error("Maximum texture size", newSize, " reached; display will be corrupted.");
            overrun = true;
            break; // overwrite some tile
          } else {
            self.textureSize *= 2;
            initForSize();
            return 0;
          }
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
      return [mod(index, tileCountSqrt), Math.floor(index / tileCountSqrt)];
    }
  }
  
  function Blockset(initialTypes) {
    var self = this;
    
    var tileSize = NaN;

    // All block sets unconditionally have the standard empty block at ID 0.
    var types = [BlockType.air];
    
    var listenersForTypes = [null];
    
    var renderDataTable = new ObjectMap(); // per-GL-context
    
    var notifier = new Notifier("Blockset");
    
    var appearanceChangedQueue = new CatchupQueue();
    
    Object.defineProperty(this, "tileSize", {
      enumerable: true,
      get: function () {
        // If tile size is undefined because we have only color blocks, then we treat it as 1
        return isNaN(tileSize) ? 1 : tileSize;
      }
    });

    Object.defineProperty(this, "length", {
      enumerable: true,
      get: function () {
        return types.length;
      }
    });
      
    this.add = function (newBlockType) {
      var id = types.length;

      var listener = {
        interest: function () { return true; },
        appearanceChanged: function () {
          self.persistence.dirty(); // TODO also need to dirty on other modifications to the block type, but there are no hooks for that. // TODO This is not a good strategy — we should be dirty in general because we contain a dirty unnamed object (and not if it is named).
          appearanceChangedQueue.enqueue(id);
          notifier.notify("texturingChanged", id);
        }
      };

      types.push(newBlockType);
      newBlockType.listen(listener);
      listenersForTypes.push(listener);
      
      // TODO: This is not sufficient if BlockTypes are allowed to change their worlds
      if (newBlockType.world) {
        var ts = newBlockType.world.wx; // assuming cubicality
        if (tileSize == ts || isNaN(tileSize)) {
          tileSize = ts;
        } else {
          if (typeof console !== "undefined")
            console.warn("Inconsistent tile size for blockset; set has", tileSize, "and new type has", ts);
        }
      }
      
      self.persistence.dirty();
      appearanceChangedQueue.enqueue(id);
      notifier.notify("tableChanged", id);
    };
    
    this.deleteLast = function () {
      if (types.length <= 1) {
        throw new Error("The 0th block type in a blockset may not be deleted.");
      }
      
      var type = types.pop();
      var id = types.length;
      
      type.listen.cancel(listenersForTypes.pop());
      
      self.persistence.dirty();
      appearanceChangedQueue.enqueue(id);
      notifier.notify("tableChanged", id);
    };
    
    this.get = function (blockID) {
      return types[blockID] || types[Blockset.ID_BOGUS] || types[Blockset.ID_EMPTY];
    };
      
    // Return an ID_LIMIT-element array snapshotting the results of get().
    this.getAll = function () {
      var array = types.slice();
      var bogus = types[Blockset.ID_BOGUS] || types[Blockset.ID_EMPTY];
      for (var i = array.length; i < Blockset.ID_LIMIT; i++) {
        array[i] = bogus;
      }
      return array;
    };
      
    this.lookup = function (blockName) {
      // TODO revisit making this < O(n)
      for (var i = 0; i < types.length; i++) {
        if (blockName === types[i].name) {
          return i;
        }
      }
      return null;
    };
      
    // Listener protocol:
    // tableChanged(id) -- the given id has a different block type associated with it
    // texturingChanged(id) -- the render data for the given id has changed
    this.listen = notifier.listen;
      
    // Return the data required to render blocks, updating if it is out of date.
    this.getRenderData = function (renderer) {
      var rdf = renderDataTable.get(renderer);
      if (!rdf) {
        renderDataTable.set(renderer, rdf = new BlocksetRenderDataGenerator(this, renderer, notifier, appearanceChangedQueue));
      }
      return rdf();
    };
    this.worldFor = function (blockID) {
      return types[blockID] ? types[blockID].world : null;
    };
    this.serialize = function (serialize) {
      var json = {
        type: "types",
        types: types.slice(1).map(function (type) { return serialize(type); })
      };
      serialize.setUnserializer(json, Blockset);
      return json;
    };

    this.persistence = new Persister(self);
    
    initialTypes.forEach(this.add);
  }
  
  // This block ID is always empty air.
  Blockset.ID_EMPTY = 0;
  
  // This block ID is used when an invalid block ID is met
  Blockset.ID_BOGUS = 1;
  
  // The maximum number of possible block types.
  // This value arises because worlds store blocks as bytes.
  Blockset.ID_LIMIT = 256;
  
  // TODO change this from "BlockSet" to "Blockset" — but we need to keep a migration path for old serializations, and there's no way to specify a preferred name, currently.
  Persister.types["BlockSet"] = Blockset;
  Blockset.unserialize = function (json, unserialize) {
    if (json.type === "colors") {
      // obsolete serialization type
      var colors = WorldGen.colorBlocks(4,4,4);
      var list = colors.getAll().slice(1, colors.length);
      list.push(list.shift());
      return new Blockset(list);
    } else if (json.type === "textured") {
      // obsolete serialization type
      var blockTypes = json.worlds.map(function (world) {
        return new BlockType(null, unserialize(world, World));
      });
      return new Blockset(blockTypes);
    } else if (json.type === "types") {
      var blockTypes = json.types.map(function (type) {
        return unserialize(type, BlockType);
      });
      return new Blockset(blockTypes);
    } else {
      throw new Error("unknown Blockset serialization type");
    }
  };
  
  var blockRenderRes = 128;
  
  function BlocksetRenderDataGenerator(blockset, renderer, notifier /* TODO make this arg unnecessary */, appearanceChangedQueue) {
    var toRerender = appearanceChangedQueue.getHead();
    
    var texgen = null;
    var rotatedBlockFaceData = [EMPTY_BLOCKRENDER];
    var allTypesCached;
    
    var blockIconsW = [];
    var blockIconsR = [];
    var toRerenderIcon = appearanceChangedQueue.getHead();
    var iconRenderer = new cubes./* late lookup */BlockRenderer(blockset, renderer, blockRenderRes);
    var iconCanvas = document.createElement("canvas");
    var iconCtx = iconCanvas.getContext('2d');
    iconCanvas.width = iconCanvas.height = blockRenderRes;
    var iconTodoSet = {};
    var iconRendererInterval;
    for (var i = 0; i < Blockset.ID_LIMIT; i++) {
      blockIconsW[i] = new Cell("block icon", null);
      blockIconsR[i] = blockIconsW[i].readOnly;
      iconTodoSet[i] = true;
    }
    function freshenIcons() {
      var start = false;
      for (; toRerenderIcon.available; toRerenderIcon = toRerenderIcon.next) {
        iconTodoSet[toRerenderIcon.value] = true;
        start = true;
      }
      var nonempty = false;
      if (!iconRendererInterval) {
        iconRendererInterval = window.setInterval(function () {
          for (var idStr in iconTodoSet) if (iconTodoSet.hasOwnProperty(idStr)) { 
            var blockID = parseInt(idStr, 10);
            iconCtx.putImageData(iconRenderer.blockToImageData(blockID, iconCtx), 0, 0);
            blockIconsW[blockID].set(iconCanvas.toDataURL("image/png"));
            delete iconTodoSet[idStr];
            return;
          }
          // if not exited, set is empty
          clearInterval(iconRendererInterval);
          iconRendererInterval = undefined;
        }, 0);
      }
    }
    
    function rebuildOne(blockID) {
      //if (typeof console !== "undefined") console.info("Rendering block type", blockID);
      var tileSize = texgen.tileSize; // shadowing
      var tileLastIndex = tileSize - 1;
      var blockType = blockset.get(blockID);
      var rotatedFaceData = rotatedBlockFaceData[blockID] || (rotatedBlockFaceData[blockID] = {});
      
      var texWidth = texgen.textureSize;
      var texData = texgen.image;
      
      function pushQuad(vertices, texcoords, flipped, transform, depth, usageIndex, ul, uh, vl, vh) {
        texcoords.push.apply(texcoords, calcTexCoords(texgen, usageIndex, flipped, ul, uh, vl, vh));
        
        var v1 = mat4.multiplyVec3(transform, [ul,vl,depth]);
        var v2 = mat4.multiplyVec3(transform, [ul,vh,depth]);
        var v3 = mat4.multiplyVec3(transform, [uh,vl,depth]);
                                                          
        var v4 = mat4.multiplyVec3(transform, [uh,vh,depth]);
        var v5 = mat4.multiplyVec3(transform, [uh,vl,depth]);
        var v6 = mat4.multiplyVec3(transform, [ul,vh,depth]);
        
        if (flipped) {
          pushVertex(vertices, v6);
          pushVertex(vertices, v5);
          pushVertex(vertices, v4);
          pushVertex(vertices, v3);
          pushVertex(vertices, v2);
          pushVertex(vertices, v1);
        } else {
          pushVertex(vertices, v1);
          pushVertex(vertices, v2);
          pushVertex(vertices, v3);
          pushVertex(vertices, v4);
          pushVertex(vertices, v5);
          pushVertex(vertices, v6);
        }
      }
      
      if (blockType.world) {
        (function () {
          var world = blockType.world;
          var types = world.blockset.getAll();
          var opaques = types.map(function (t) { return t.opaque; });
          
          // To support non-cubical objects, we slice the entire volume of the block and generate as many tiles as needed. sliceWorld generates one such slice.
          
          // data structures for slice loop
          var vec = vec3.create();
          var l = makeSliceView(-1);
          var h = makeSliceView(+1);
          
          // Holds the state which is duplicated for the two view directions of a layer.
          function makeSliceView(offset) {
            // the offset of the subcube which would block the view of this subcube if it is opaque.
            var view = vec3.create();
            var ud = vec3.create();
            var vd = vec3.create();
            var transform, vertices, texcoords;
            var boundNU, boundPU, boundNV, boundPV;
            
            var self = {
              init: function (t, vc, tc) {
                transform = t;
                vertices = vc;
                texcoords = tc;
                
                view[0] = 0;
                view[1] = 0;
                view[2] = offset;
                ud[0] = 1;
                ud[1] = 0;
                ud[2] = 0;
                vd[0] = 0;
                vd[1] = 1;
                vd[2] = 0;
                mat4.multiplyVec3(transform, view, view);
                mat4.multiplyVec3(transform, ud, ud);
                mat4.multiplyVec3(transform, vd, vd);
                
                boundNU = boundNV = +Infinity;
                boundPU = boundPV = -Infinity;
              },
              
              visibleCube: function () {
                if (!opaques[world.g(vec[0]+view[0],vec[1]+view[1],vec[2]+view[2])]) {
                  var u = vec3.dot(vec, ud);
                  var v = vec3.dot(vec, vd);
                  boundNU = min(boundNU, u);
                  boundPU = max(boundPU, u+1);
                  boundNV = min(boundNV, v);
                  boundPV = max(boundPV, v+1);
                }
              },
              
              isNotEmpty: function () { return isFinite(boundNU); },
              
              considerQuad: function (usageIndex, layerCoordinate, flipped) {
                if (self.isNotEmpty()) {
                  pushQuad(vertices, texcoords, flipped, transform, layerCoordinate/tileSize, usageIndex, boundNU/tileSize, boundPU/tileSize, boundNV/tileSize, boundPV/tileSize);
                }
              }
            };
            return self;
          }
          
          function sliceWorld(dimName, layer, transform, texcoordsL, texcoordsH, verticesL, verticesH) {
            var usageIndex = blockID + "," + dimName + "," + layer;
            
            var coord = texgen.imageCoordsFor(usageIndex);
            var pixu = coord[0], pixv = coord[1];
            
            l.init(transform, verticesL, texcoordsL);
            h.init(transform, verticesH, texcoordsH);
            
            // extract surface plane of block from world
            for (var u = 0; u < tileSize; u++)
            for (var v = 0; v < tileSize; v++) {
              var texelBase = ((pixv+v) * texWidth + pixu+u) * 4;
              vec[0] = u; vec[1] = v; vec[2] = layer;
              mat4.multiplyVec3(transform, vec, vec);
              
              types[world.gv(vec)].writeColor(255, texData, texelBase);
              
              if (texData[texelBase+3] > 0) {
                // A layer has significant content only if there is an UNOBSCURED opaque pixel.
                // If a layer is "empty" in this sense, it is not rendered.
                // If it is empty from both directions, then it is deallocated.
                l.visibleCube();
                h.visibleCube();
              }
            }
            
            if (!l.isNotEmpty() && !h.isNotEmpty()) {
              // We can reuse this tile iff it was blank or fully obscured
              texgen.deallocateUsage(usageIndex);
            } else {
              texgen.completed(usageIndex);
              
              // If the layer has unobscured content, and it is not an interior surface of an opaque block, then add it to rendering. Note that the TILE_MAPPINGS loop skips slicing interiors of opaque blocks, but they still need to have the last layer excluded because the choice of call to sliceWorld does not express that.
              if (!blockType.opaque || layer === 0)             l.considerQuad(usageIndex, layer, false);
              if (!blockType.opaque || layer === tileLastIndex) h.considerQuad(usageIndex, layer+1, true);
            }
            
            // TODO: trigger rerender of chunks only if we made changes to the texcoords, not if only the colors changed
            
            //console.log("id ", wi + 1, " dim ", dimName, " layer ", layer, (l.isNotEmpty() || h.isNotEmpty()) ? " allocated" : " skipped");
          }
          var faceData = [];
          TILE_MAPPINGS.forEach(function (m) {
            var dimName = m[0];
            var transform = m[1];
            var texcoordsL = [];
            var texcoordsH = [];
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
            faceData["l" + dimName] = {vertices: verticesL, texcoords: texcoordsL};
            faceData["h" + dimName] = {vertices: verticesH, texcoords: texcoordsH};
          });
          // TODO: texcoords are copied and reversed for every reflection; it would be more memory-efficient to arrange to have only one reversed set
          CubeRotation.byCode.forEach(function (rot) {
            rotatedFaceData[rot.code] = rotateFaceData(rot, faceData);
          });
        }());
      } else /* no world, so use solid color */ {
        var color = blockType.derivedColor;
        var usageIndex = blockID.toString();
        var coord = texgen.imageCoordsFor(usageIndex);
        var pixu = coord[0], pixv = coord[1];
        var r = 255 * color[0];
        var g = 255 * color[1];
        var b = 255 * color[2];
        var a = 255 * color[3];
        
        for (var u = 0; u < tileSize; u++)
        for (var v = 0; v < tileSize; v++) {
          var c = ((pixv+v) * texWidth + pixu+u) * 4;
          texData[c  ] = r;
          texData[c+1] = g;
          texData[c+2] = b;
          texData[c+3] = a;
        }
        texgen.completed(usageIndex);
        
        var faceData = [];
        TILE_MAPPINGS.forEach(function (m) {
          var dimName = m[0];
          var transform = m[1];
          var verticesL = [];
          var verticesH = [];
          var texcoords = [];
          // Texture is a solid color, so we only need one set of texcoords.
          pushQuad(verticesL, texcoords, false, transform, 0, usageIndex, 0, 1, 0, 1);
          pushQuad(verticesH, [],        true,  transform, 1, usageIndex, 0, 1, 0, 1);
          faceData["l" + dimName] = {vertices: verticesL, texcoords: texcoords};
          faceData["h" + dimName] = {vertices: verticesH, texcoords: texcoords};
        });
        for (var i = 0; i < CubeRotation.codeRange; i++) {
          rotatedFaceData[i] = faceData;
        }
      }
      
      // NOTE: This function does not notify texturingChanged because this is called lazily when clients ask about the new render data.
    }
    
    function freshenTexture() {
      var someChanged = false;
      var allChanged = false;
      var l = blockset.length;
      
      // TODO: Losing GL context should not require us to re-calculate texture data.
      if (!texgen || texgen.mustRebuild()) {
        texgen = new Texgen(blockset.tileSize, renderer);
      }
      
      // If necessary, rebuild everything
      while (texgen.textureLost) {
        //if (typeof console !== "undefined") console.info("Performing full block texture rebuild.");
        texgen.textureLost = false;
        for (var id = Blockset.ID_EMPTY + 1; id < l && !texgen.textureLost; id++)
          rebuildOne(id);
        someChanged = true;
        allChanged = true;
        toRerender = appearanceChangedQueue.getHead(); // we're caught up by definition
      }
      
      // Else rebuild only what is changed
      var haveRebuilt = [];
      for (; toRerender.available; toRerender = toRerender.next) {
        var id = toRerender.value;
        if (!haveRebuilt[id]) {
          haveRebuilt[id] = true;
          rebuildOne(id);
          someChanged = true;
        }
      }
      
      if (allChanged) {
        // If textureLost, which might occur because it was resized, then we need to notify of *everything* changing
        for (var id = Blockset.ID_EMPTY + 1; id < l; id++)
          notifier.notify("texturingChanged", id);
      }
      if (someChanged) {
        texgen.send();
        allTypesCached = blockset.getAll();
      }
    }
    return function () {
      freshenTexture();
      freshenIcons();
      rotatedBlockFaceData.bogus = rotatedBlockFaceData[Blockset.ID_BOGUS] || EMPTY_BLOCKRENDER;
      return {
        texture: texgen.texture,
        rotatedBlockFaceData: rotatedBlockFaceData,
        types: allTypesCached,
        icons: blockIconsR
        // Note: icons is made up of Cells that can be listened to for the completion of the deferred icon rendering. However, these cells do not update when blocks change appearance unless the render data is re-obtained (i.e. freshenIcons happens). This is deliberate to save CPU time when the blocks are not *visible* (e.g. when a block is itself being edited, so the blockset containing it is not current).
      };
    }
  }
  
  cubes.Blockset = Object.freeze(Blockset);
}());
