// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var BlockType = (function () {
  "use strict";
  
  // Global non-persistent serial numbers for block types, used in the sound render queue.
  var nextBlockTypeSerial = 0;
  
  function BlockType() {
    throw new Error("abstract");
  }
  BlockType.prototype.reflectivity = 0.9; // This is not an instance property because I don't yet want to hardcode a particular value that gets saved.
  
  function _BlockTypeSuper() {
    if (!(this instanceof BlockType)) {
      throw new Error("bad constructor call");
    }
    
    var n = new Notifier("BlockType");
    this._notify = n.notify; // should be private
    this.listen = n.listen;
    
    this._serial = nextBlockTypeSerial++;
    
    // (In principle) user-editable properties of block types.
    this.automaticRotations = [0]; // TODO: This property is to be replaced by circuits.
    this.behavior = null;
    this.name = null;
    this.solid = true;
    this.light = 0; // Light emission — float scale where 1.0 is an "ordinary light"
  }
  
  BlockType.prototype.serialize = function (serialize) {
    var json = {};
    serialize.setUnserializer(json, BlockType);
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
  
  BlockType.World = function (world) {
    _BlockTypeSuper.call(this);
    
    this.world = world;
    this.opaque = undefined;
    this.hasCircuits = false;
    
    // TODO: update listener if world is set, or reject world setting
    // note there is no opportunity here to remove listener, but it is unlikely to be needed.
    var self = this;
    function rebuild() {
      recomputeWorldBlockProperties.call(self);
      self._notify("appearanceChanged");
    }
    function checkCircuits() {
      self.hasCircuits = self.world.getCircuits().length > 0;
    }
    world.listen({
      interest: function () { return true; },
      dirtyBlock: rebuild,
      dirtyAll: rebuild,
      dirtyCircuit: checkCircuits,
      deletedCircuit: checkCircuits,
      audioEvent: function () {}
    });
    
    recomputeWorldBlockProperties.call(this);
    checkCircuits();
    
    Object.seal(this);
  };
  BlockType.World.prototype = Object.create(BlockType.prototype);
  BlockType.World.prototype.constructor = BlockType.World;
  
  BlockType.World.prototype.toString = function () {
    return "[BlockType #" + this.serial + " world]";
  };
  
  Object.defineProperty(BlockType.World.prototype, "color", {
    enumerable: true,
    value: null
  });
  
  BlockType.World.prototype.writeColor =
      function (scale, target, offset) {
    var color = this._color;
    target[offset  ] = scale * color[0];
    target[offset+1] = scale * color[1];
    target[offset+2] = scale * color[2];
    target[offset+3] = this.opaque ? scale : 0;
  };
  
  // Internal function: Recalculate all the properties derived from a BlockType.World's world.
  function recomputeWorldBlockProperties() {
    // Compute opacity and representative color.
    var world = this.world;
    var tileSize = world.wx; // assumed cubical
    var tileLastIndex = tileSize - 1;
    var opaque = true;
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
    this.opaque = opaque;
    this._color = vec3.scale(color, 1/colorCount); // TODO make property private
  }
  
  BlockType.World.prototype.serialize = function (serialize) {
    var json = BlockType.prototype.serialize.call(this, serialize);
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
  
  BlockType.Color.prototype.toString = function () {
    return "[BlockType #" + this.serial + " color " + this.color + "]";
  };
  
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
    var json = BlockType.prototype.serialize.call(this, serialize);
    json.color = this.color;
    return json;
  };
  
  BlockType.air = new BlockType.Color([0,0,0,0]);
  BlockType.air.solid = false;
  
  Persister.types["BlockType"] = BlockType;
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
  
  return Object.freeze(BlockType);
}());

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
  function calcTexCoords(texgen, usageIndex, flipped) {
    var uv = texgen.uvFor(usageIndex);
    var tileUVSize = texgen.tileUVSize;
    var texO = flipped ? tileUVSize : 0;
    var texD = flipped ? 0 : tileUVSize;
    var uo = uv[0];
    var vo = uv[1];
    return [
      uo + texO,       vo + texO,
      uo,              vo + tileUVSize,
      uo + tileUVSize, vo,
      uo + texD,       vo + texD,
      uo + tileUVSize, vo,
      uo,              vo + tileUVSize
    ];
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
    // TODO: Confirm that WebGL garbage collects these, or add a delete method to BlockSet for use as needed
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
  
  function BlockSet(initialTypes) {
    var self = this;
    
    var tileSize = NaN;

    // All block sets unconditionally have the standard empty block at ID 0.
    var types = [BlockType.air];
    
    var listenersForTypes = [null];
    
    var renderDataTable = new ObjectMap(); // per-GL-context
    
    var notifier = new Notifier("BlockSet");
    
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
      return types[blockID] || types[BlockSet.ID_BOGUS] || types[BlockSet.ID_EMPTY];
    };
      
    // Return an ID_LIMIT-element array snapshotting the results of get().
    this.getAll = function () {
      var array = types.slice();
      var bogus = types[BlockSet.ID_BOGUS] || types[BlockSet.ID_EMPTY];
      for (var i = array.length; i < BlockSet.ID_LIMIT; i++) {
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
        renderDataTable.set(renderer, rdf = new BlockSetRenderDataGenerator(this, renderer, notifier, appearanceChangedQueue));
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
      serialize.setUnserializer(json, BlockSet);
      return json;
    };

    this.persistence = new Persister(self);
    
    initialTypes.forEach(this.add);
  }
  
  // This block ID is always empty air.
  BlockSet.ID_EMPTY = 0;
  
  // This block ID is used when an invalid block ID is met
  BlockSet.ID_BOGUS = 1;
  
  // The maximum number of possible block types.
  // This value arises because worlds store blocks as bytes.
  BlockSet.ID_LIMIT = 256;
  
  Persister.types["BlockSet"] = BlockSet;
  BlockSet.unserialize = function (json, unserialize) {
    if (json.type === "colors") {
      // obsolete serialization type
      var colors = WorldGen.colorBlocks(4,4,4);
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
  
  function BlockSetRenderDataGenerator(blockSet, renderer, notifier /* TODO make this arg unnecessary */, appearanceChangedQueue) {
    var toRerender = appearanceChangedQueue.getHead();
    
    var texgen = null;
    var rotatedBlockFaceData = [EMPTY_BLOCKRENDER];
    var allTypesCached;
    
    function rebuildOne(blockID) {
      //if (typeof console !== "undefined") console.info("Rendering block type", blockID);
      var tileSize = texgen.tileSize; // shadowing
      var tileLastIndex = tileSize - 1;
      var blockType = blockSet.get(blockID);
      var rotatedFaceData = rotatedBlockFaceData[blockID] || (rotatedBlockFaceData[blockID] = {});
      
      var texWidth = texgen.textureSize;
      var texData = texgen.image;
      
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
          pushQuad(verticesL, texcoords, false, transform, 0, usageIndex);
          pushQuad(verticesH, [],        true,  transform, 1, usageIndex);
          faceData["l" + dimName] = {vertices: verticesL, texcoords: texcoords};
          faceData["h" + dimName] = {vertices: verticesH, texcoords: texcoords};
        });
        for (var i = 0; i < CubeRotation.codeRange; i++) {
          rotatedFaceData[i] = faceData;
        }
      } else if (blockType.world) {
        (function () {
          var world = blockType.world;
          var types = world.blockSet.getAll();
          var opaques = types.map(function (t) { return t.opaque; });
          
          // To support non-cubical objects, we slice the entire volume of the block and generate as many tiles as needed. sliceWorld generates one such slice.
          
          // data structures for slice loop
          var vec = vec3.create();
          var viewL = vec3.create();
          var viewH = vec3.create();
          
          function sliceWorld(dimName, layer, transform, texcoordsL, texcoordsH, verticesL, verticesH) {
            var usageIndex = blockID + "," + dimName + "," + layer;
            
            var coord = texgen.imageCoordsFor(usageIndex);
            var pixu = coord[0], pixv = coord[1];
            
            var thisLayerNotEmptyL = false;
            var thisLayerNotEmptyH = false;
            
            // viewL is the offset of the subcube which would block the view
            // of this subcube if it is opaque.
            viewL[0] = 0; viewL[1] = 0; viewL[2] = -1;
            viewH[0] = 0; viewH[1] = 0; viewH[2] = +1;
            mat4.multiplyVec3(transform, viewL, viewL);
            mat4.multiplyVec3(transform, viewH, viewH);
            
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
                if (!opaques[world.g(vec[0]+viewL[0],vec[1]+viewL[1],vec[2]+viewL[2])]) {
                  thisLayerNotEmptyL = true;
                }
                if (!opaques[world.g(vec[0]+viewH[0],vec[1]+viewH[1],vec[2]+viewH[2])]) {
                  thisLayerNotEmptyH = true;
                }
              }
            }
            
            if (!thisLayerNotEmptyL && !thisLayerNotEmptyH) {
              // We can reuse this tile iff it was blank or fully obscured
              texgen.deallocateUsage(usageIndex);
            } else {
              texgen.completed(usageIndex);
              
              // If the layer has unobscured content, and it is not an interior surface of an opaque block, then add it to rendering. Note that the TILE_MAPPINGS loop skips slicing interiors of opaque blocks, but they still need to have the last layer excluded because the choice of call to sliceWorld does not express that.
              if (thisLayerNotEmptyL && (!blockType.opaque || layer === 0)) {
                pushQuad(verticesL, texcoordsL, false, transform, layer/tileSize, usageIndex);
              }
              if (thisLayerNotEmptyH && (!blockType.opaque || layer === tileLastIndex)) {
                pushQuad(verticesH, texcoordsH, true, transform, (layer+1)/tileSize, usageIndex);
              }
            }
            
            // TODO: trigger rerender of chunks only if we made changes to the texcoords, not if only the colors changed
            
            //console.log("id ", wi + 1, " dim ", dimName, " layer ", layer, (thisLayerNotEmptyL || thisLayerNotEmptyH) ? " allocated" : " skipped");
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
      } else {
        throw new Error("Don't know how to render the BlockType");
      }
      
      // NOTE: This function does not notify texturingChanged because this is called lazily when clients ask about the new render data.
    }
    
    function freshenTexture() {
      var someChanged = false;
      var allChanged = false;
      var l = blockSet.length;
      
      // TODO: Losing GL context should not require us to re-calculate texture data.
      if (!texgen || texgen.mustRebuild()) {
        texgen = new Texgen(blockSet.tileSize, renderer);
      }
      
      // If necessary, rebuild everything
      while (texgen.textureLost) {
        //if (typeof console !== "undefined") console.info("Performing full block texture rebuild.");
        texgen.textureLost = false;
        for (var id = BlockSet.ID_EMPTY + 1; id < l && !texgen.textureLost; id++)
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
        for (var id = BlockSet.ID_EMPTY + 1; id < l; id++)
          notifier.notify("texturingChanged", id);
      }
      if (someChanged) {
        texgen.send();
        allTypesCached = blockSet.getAll();
      }
    }
    return function () {
      freshenTexture();
      rotatedBlockFaceData.bogus = rotatedBlockFaceData[BlockSet.ID_BOGUS] || EMPTY_BLOCKRENDER;
      return {
        texture: texgen.texture,
        rotatedBlockFaceData: rotatedBlockFaceData,
        types: allTypesCached
      };
    }
  }
  
  return Object.freeze(BlockSet);
}());
