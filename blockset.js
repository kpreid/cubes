// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var BlockSet = (function () {
  var BlockSet = {};
  
  // This block ID is always empty air.
  BlockSet.ID_EMPTY = 0;
  
  // This block ID is used when an invalid block ID is met
  BlockSet.ID_BOGUS = 1;

  BlockSet.colors = Object.freeze({
    length: 256,
    textured: false,
    texture: null,
    writeColor: function (blockID, scale, target, offset) {
      target[offset] = (blockID & 3) / 3 * scale;
      target[offset+1] = ((blockID >> 2) & 3) / 3 * scale;
      target[offset+2] = ((blockID >> 4) & 3) / 3 * scale;
      target[offset+3] = blockID == BlockSet.ID_EMPTY ? 0 : scale;
    },
    isOpaque: function (blockID) { return blockID != BlockSet.ID_EMPTY },
    generateBlockTextures: function () {},
    worldFor: function (blockID) { return null; }
  });

  // Texture parameters
  // TODO: make tile counts depend on blockset size
  var TILE_COUNT_U = 16;
  var TILE_COUNT_V = 16;
  var TILE_SIZE_U = 1/TILE_COUNT_U;
  var TILE_SIZE_V = 1/TILE_COUNT_V;
  var TILE_MAPPINGS = [
    // in this matrix layout, the input (column) vector is the tile coords
    // and the output (row) vector is the world space coords
    // so the lower row is the translation component.
    ["lz", mat4.create([
      // low z face
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ])],
    ["hz", mat4.create([
      // high z face
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, -1, 0,
      0, 0, 15, 1
    ])],
    ["lx", mat4.create([
      // low x face
      0, 1, 0, 0,
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 0, 0, 1
    ])],
    ["hx", mat4.create([
      // high x face
      0, 1, 0, 0,
      0, 0, 1, 0,
      -1, 0, 0, 0,
      15, 0, 0, 1
    ])],
    ["ly", mat4.create([
      // low y face
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1
    ])],
    ["hy", mat4.create([
      // high y face
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, -1, 0, 0,
      0, 15, 0, 1
    ])],
  ];

  BlockSet.newTextured = function (worlds) {
    if (worlds.length < 1) {
      throw new Error("Textured block set must have at least one world");
    }
    var tilings = [];
    var opacities = [false];
    for (var i = 0; i < worlds.length; i++) tilings.push({});
    
    // Texture holding tiles
    // TODO: Confirm that WebGL garbage collects these, or add a delete method to BlockSet for use as needed
    var blockTexture = gl.createTexture();
    
    // ImageData object used to buffer calculated texture data
    var blockTextureData = document.createElement("canvas").getContext("2d")
      .createImageData(World.TILE_SIZE * TILE_COUNT_U, World.TILE_SIZE * TILE_COUNT_V);
    
    return Object.freeze({
      length: worlds.length + 1,
      textured: true,
      texture: blockTexture,
      texTileSizeU: TILE_SIZE_U,
      texTileSizeV: TILE_SIZE_V,
      writeColor: function (blockID, scale, target, offset) {
        target[offset] = scale;
        target[offset+1] = scale;
        target[offset+2] = scale;
        target[offset+3] = scale;
      },
      tilings: tilings,
      generateBlockTextures: function () {
        // TODO: Optimize this by not rebuilding the entire texture, but only those worldblocks which have changed (eg when the user exits a block world). This will require a dynamic allocator for the texture tiles.
        
        // (tileu,tilev) is the position in the texture of each block-face tile as they are generated.
        var tileu = -1;
        var tilev = 0;
        var alloc = true;

        for (var wi = 0; wi < worlds.length; wi++) {
          var world = worlds[wi];
          var opaque = true;
          
          // To support non-cubical objects, we slice the entire volume of the block and generate as many tiles as needed. sliceWorld generates one such slice.
        
          function sliceWorld(faceName, layer, transform, layers) {
            // allocate next position
            if (alloc) {
              tileu++;
              if (tileu >= TILE_COUNT_U) {
                tileu = 0;
                tilev++;
              }
              if (tilev >= TILE_COUNT_V) {
                if (typeof console !== 'undefined') 
                  console.error("blockTexture too small to contain all tiles!");
                // TODO: report problem on-screen or generate larger texture
                tileu = 0;
                tilev = 0;
              }
            }

            var thisLayerNotEmpty = false;
            var pixu = tileu*World.TILE_SIZE;
            var pixv = tilev*World.TILE_SIZE;
            // extract surface plane of block from world
            for (var u = 0; u < World.TILE_SIZE; u++)
            for (var v = 0; v < World.TILE_SIZE; v++) {
              var c = ((pixu+u) * blockTextureData.width + pixv+v) * 4;
              var vec = vec3.create([u,v,layer]);
              mat4.multiplyVec3(transform, vec, vec);
              var view = vec3.create([u,v,layer-1]);
              mat4.multiplyVec3(transform, view, view);
              
              var value = world.g(vec[0],vec[1],vec[2]);
              world.blockSet.writeColor(value, 255, blockTextureData.data, c);
              if (blockTextureData.data[c+3] < 255) {
                // A block is opaque if all of its outside (layer-0) pixels are opaque.
                if (layer == 0)
                  opaque = false;
              } else if (!world.opaque(view[0],view[1],view[2])) {
                // A layer has significant content only if there is an UNOBSCURED (hence the above check) opaque pixel.
                thisLayerNotEmpty = true;
              }
            }
            
            // We can reuse this tile iff it was blank
            alloc = thisLayerNotEmpty;
            if (thisLayerNotEmpty) {
              // u,v coordinates of this tile for use by the vertex generator

              // TODO: If opacities change, we need to trigger rerender of chunks.
            }
            layers[layer] = thisLayerNotEmpty ? [tileu / TILE_COUNT_U, tilev / TILE_COUNT_V] : null;
            //console.log("id ", wi + 1, " face ", faceName, " layer ", layer, thisLayerNotEmpty ? " allocated" : " skipped");
          }
          TILE_MAPPINGS.forEach(function (m) {
            var faceName = m[0];
            var transform = m[1];
            var layers = [];
            tilings[wi][faceName] = layers;
            opacities[wi + 1] = opaque;
            for (var layer = 0; layer < World.TILE_SIZE; layer++) {
              sliceWorld(faceName, layer, transform, layers);
            }
          });
        }
        
        gl.bindTexture(gl.TEXTURE_2D, blockTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blockTextureData);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.bindTexture(gl.TEXTURE_2D, null);
      },
      isOpaque: function (blockID) { return opacities[blockID] || !(blockID in opacities); },
      worldFor: function (blockID) {
        return worlds[blockID - 1] || null;
      }
    });
  };

  return Object.freeze(BlockSet);
})();
