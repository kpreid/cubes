// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var BlockType = (function () {
  "use strict";
  
  function BlockType() {
    throw new Error("abstract");
  }
  
  function _BlockTypeSuper() {
    if (!(this instanceof BlockType))
      throw new Error("bad constructor call");
    
    // TODO: Both of these properties are to be replaced by circuits.
    this.automaticRotations = [0];
    this.spontaneousConversion = null;
  }
  
  // Called randomly by the world, at an average rate of 'baseRate' calls per second for each cube.
  BlockType.prototype.doSpontaneousEffect = function (world, cube, baseRate) {
    // TODO: Either remove this or give it a proper setter and a rate parameter and make it serialized
    if (this.spontaneousConversion)
      world.s(cube[0],cube[1],cube[2], this.spontaneousConversion);
  };
  BlockType.prototype.serialize = function (serialize) {
    var json = {};
    if (this.automaticRotations.length !== 1 || this.automaticRotations[0] !== 0)
      json.automaticRotations = this.automaticRotations;
    if (this.spontaneousConversion)
      json.spontaneousConversion = this.spontaneousConversion;
    return json;
  }
  
  BlockType.World = function (world) {
    _BlockTypeSuper.call(this);
    
    this.world = world;
    this.opaque = undefined;
    
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
  
  BlockType.World.prototype._recomputeOpacity = function () {
    var opaque = true;
    for (var dim = 0; dim < 3; dim++) {
      var ud = mod(dim+1,3);
      var vd = mod(dim+2,3);
      for (var u = 0; u < World.TILE_SIZE; u++)
      for (var v = 0; v < World.TILE_SIZE; v++) {
        var vec = [u,v,0];
        opaque = opaque && this.world.opaque(vec[dim],vec[ud],vec[vd]);
        vec[2] = World.TILE_SIZE - 1;
        opaque = opaque && this.world.opaque(vec[dim],vec[ud],vec[vd]);
      }
    }
    this.opaque = opaque;
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
  
  BlockType.unserialize = function (json, unserialize) {
    var self;
    if (json.color) {
      self = new BlockType.Color(json.color);
    } else if (json.world) {
      self = new BlockType.World(unserialize(json.world, World));
    } else {
      throw new Error("unknown BlockType serialization type");
    }
    self.automaticRotations = json.automaticRotations || [0];
    self.spontaneousConversion = json.spontaneousConversion || null;
    return self;
  };
  
  return Object.freeze(BlockType);
})();

var BlockSet = (function () {
  "use strict";
  
  function Texgen() {
    var self = this;
    
    // Texture holding tiles
    // TODO: Confirm that WebGL garbage collects these, or add a delete method to BlockSet for use as needed
    this.texture = gl.createTexture();
    
    var tileCountSqrt = 8; // initial allocation; gets multiplied by 2
    var blockTextureData;
    var tileAllocMap;
    var freePointer;
    var usageMap;
    this.textureLost = false;
    function enlargeTexture() {
      tileCountSqrt *= 2;
      self.tileUVSize = 1/tileCountSqrt;
      
      // ImageData object used to buffer calculated texture data
      self.image = document.createElement("canvas").getContext("2d")
        .createImageData(World.TILE_SIZE * tileCountSqrt, World.TILE_SIZE * tileCountSqrt);
      
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
    if (initialTypes.length < 1) {
      throw new Error("Block set must start with at least one type");
    }
    var types = Array.prototype.slice.call(initialTypes);
    types.unshift(BlockType.air);
    var tilings = [];
    
    for (var i = 0; i < types.length; i++) tilings.push({});
    
    var texgen = null;
    var typesToRerender = [];
    
    function rebuildOne(blockID) {
      var blockType = types[blockID];
      
      var blockTextureData = texgen.image;
      
      if (blockType.color) { // TODO: factor this conditional into BlockType
        var color = blockType.color;
        var usageIndex = blockID.toString();
        var coord = texgen.allocationFor(usageIndex);
        var tileu = coord[0], tilev = coord[1];
        var pixu = tileu*World.TILE_SIZE;
        var pixv = tilev*World.TILE_SIZE;
        for (var u = 0; u < World.TILE_SIZE; u++)
        for (var v = 0; v < World.TILE_SIZE; v++) {
          var c = ((pixu+u) * blockTextureData.width + pixv+v) * 4;
          blockTextureData.data[c+0] = 255 * color[0];
          blockTextureData.data[c+1] = 255 * color[1];
          blockTextureData.data[c+2] = 255 * color[2];
          blockTextureData.data[c+3] = 255 * color[3];
        }
        
        TILE_MAPPINGS.forEach(function (m) {
          var dimName = m[0];
          var transform = m[1];
          var layers = [];
          tilings[blockID]["l" + dimName] = layers;
          tilings[blockID]["h" + dimName] = layers;
          for (var layer = 0; layer < World.TILE_SIZE; layer++) {
            // u,v coordinates of this tile for use by the vertex generator
            layers[layer] = layer == 0 ? texgen.uvFor(usageIndex) : null;
          }
        });
      } else if (blockType.world) {
        (function () {
          var world = blockType.world;
          blockType._recomputeOpacity(); // TODO kludge
          
          // To support non-cubical objects, we slice the entire volume of the block and generate as many tiles as needed. sliceWorld generates one such slice.
          
          function sliceWorld(dimName, layerL, transform, layersL, layersH) {
            var layerH = World.TILE_SIZE - 1 - layerL;
            var usageIndex = [blockID,dimName,layerL].toString();
            
            var coord = texgen.allocationFor(usageIndex);
            var tileu = coord[0], tilev = coord[1];
            
            var thisLayerNotEmptyL = false;
            var thisLayerNotEmptyH = false;
            var pixu = tileu*World.TILE_SIZE;
            var pixv = tilev*World.TILE_SIZE;
            // extract surface plane of block from world
            for (var u = 0; u < World.TILE_SIZE; u++)
            for (var v = 0; v < World.TILE_SIZE; v++) {
              var c = ((pixu+u) * blockTextureData.width + pixv+v) * 4;
              var vec = vec3.create([u,v,layerL]);
              mat4.multiplyVec3(transform, vec, vec);
              var viewL = vec3.create([u,v,layerL-1]);
              mat4.multiplyVec3(transform, viewL, viewL);
              var viewH = vec3.create([u,v,layerL+1]);
              mat4.multiplyVec3(transform, viewH, viewH);
          
              var subType = world.gt(vec[0],vec[1],vec[2]);
              subType.writeColor(255, blockTextureData.data, c);

              if (blockTextureData.data[c+3] > 0) {
                // A layer has significant content only if there is an UNOBSCURED opaque pixel.
                // If a layer is "empty" in this sense, it is not rendered.
                // If it is empty from both directions, then it is deallocated.
                if (!world.opaque(viewL[0],viewL[1],viewL[2])) {
                  thisLayerNotEmptyL = true;
                }
                if (!world.opaque(viewH[0],viewH[1],viewH[2])) {
                  thisLayerNotEmptyH = true;
                }
              }
            }
            
            if (!thisLayerNotEmptyL && !thisLayerNotEmptyH) {
              // We can reuse this tile iff it was blank or fully obscured
              texgen.deallocateUsage(usageIndex);
            } else {
              // u,v coordinates of this tile for use by the vertex generator
              var uv = texgen.uvFor(usageIndex);
              // If the layer has unobscured content, and it is not an interior surface of an opaque block, then add it to rendering. Note that the TILE_MAPPINGS loop skips slicing interiors of opaque blocks, but they still need to have the 15th layer excluded because the choice of call to sliceWorld does not express that.
              layersL[layerL] = thisLayerNotEmptyL && (!blockType.opaque || layerL == 0) ? uv : null;
              layersH[layerH] = thisLayerNotEmptyH && (!blockType.opaque || layerH == 0) ? uv : null;
            }
            
            // TODO: trigger rerender of chunks only if we made changes to the tiling, not if only the colors changed
            
            //console.log("id ", wi + 1, " dim ", dimName, " layer ", layer, (thisLayerNotEmptyL || thisLayerNotEmptyH) ? " allocated" : " skipped");
          }
          TILE_MAPPINGS.forEach(function (m) {
            var dimName = m[0];
            var transform = m[1];
            var layersL = tilings[blockID]["l" + dimName] = [];
            var layersH = tilings[blockID]["h" + dimName] = [];
            if (blockType.opaque) {
              if (texgen.textureLost) return;
              sliceWorld(dimName, 0, transform, layersL, layersH);
              sliceWorld(dimName, 15, transform, layersL, layersH);
            } else {
              for (var layer = 0; layer < World.TILE_SIZE; layer++) {
                if (texgen.textureLost) return;
                sliceWorld(dimName, layer, transform, layersL, layersH);
              }
            }
          });
        })();
      } else {
        throw new Error("Don't know how to render the BlockType");
      }
      
      // TODO: arrange to do this only once if updating several blocks
      gl.bindTexture(gl.TEXTURE_2D, texgen.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blockTextureData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    
    function freshenTexture() {
      if (!texgen) {
        texgen = new Texgen();
      }
      while (texgen.textureLost) {
        //console.info("Performing full block texture rebuild.");
        texgen.textureLost = false;
        var l = self.length;
        for (var id = BlockSet.ID_EMPTY + 1; id < l && !texgen.textureLost; id++)
          rebuildOne(id);
      }
      while (typesToRerender.length) {
        rebuildOne(typesToRerender.pop());
      }
    }
    
    var self = Object.freeze({
      get length () { return types.length; },
      
      add: function (newBlockType) {
        var newID = types.length;
        types.push(newBlockType);
        tilings.push({});
        this.rebuildBlockTexture(newID);
      },
      
      get: function (blockID) {
        return types[blockID] || types[BlockSet.ID_BOGUS];
      },
      
      // TODO: bundle texture/tilings into a facet
      get texture () {
        freshenTexture();
        return texgen.texture;
      },
      getTexTileSize: function () { return texgen.tileUVSize; },
      get tilings () {
        freshenTexture();
        return tilings;
      },
      rebuildBlockTexture: function (blockID) {
        blockID = +blockID;
        if (blockID < 0 || blockID >= types.length) return;
        typesToRerender.push(blockID);
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
    
    return self;
  }
  
  // This block ID is always empty air.
  BlockSet.ID_EMPTY = 0;
  
  // This block ID is used when an invalid block ID is met
  BlockSet.ID_BOGUS = 1;
  
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
  
  BlockSet.unserialize = function (json, unserialize) {
    if (json.type === "colors") {
      throw new Error("BlockSet.colors no longer available");
    } else if (json.type === "textured") {
      // obsolete serialization type
      var blockTypes = json.worlds.map(function (world) {
        return BlockType.world(unserialize(world, World));
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
