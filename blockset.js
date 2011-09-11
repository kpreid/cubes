var BlockSet = (function () {
  var BlockSet = {};
  
  // This block ID is always empty air.
  BlockSet.ID_EMPTY = 0;
  
  // This block ID is used when an invalid block ID is met
  BlockSet.ID_BOGUS = 1;

  BlockSet.colors = Object.freeze({
    length: 256,
    textured: false,
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

  BlockSet.newTextured = function (worlds) {
    if (worlds.length < 1) {
      throw new Error("Textured block set must have at least one world");
    }
    var tilings = [];
    var opacities = [false];
    for (var i = 0; i < worlds.length; i++) tilings.push({});
    return Object.freeze({
      length: worlds.length + 1,
      textured: true,
      writeColor: function (blockID, scale, target, offset) {
        target[offset] = scale;
        target[offset+1] = scale;
        target[offset+2] = scale;
        target[offset+3] = scale;
      },
      tilings: tilings,
      generateBlockTextures: function (data, layout) {
        // (tileu,tilev) is the position in the texture of each block-face tile as they are generated.
        var tileu = -1;
        var tilev = 0;
        var alloc = true;

        for (var wi = 0; wi < worlds.length; wi++) {
          var world = worlds[wi];
          var opaque = true;
          
          // TODO: To support non-cubical objects, we should slice the entire volume of the block and generate as many tiles as needed.
        
          function sliceWorld(faceName, layer, transform, layers) {
            // allocate next position
            if (alloc) {
              tileu++;
              if (tileu >= layout.TILE_COUNT_U) {
                tileu = 0;
                tilev++;
              }
              if (tilev >= layout.TILE_COUNT_V) {
                console.error("blockTexture too small to contain all tiles!");
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
              var c = ((pixu+u) * data.width + pixv+v) * 4;
              var vec = vec3.create([u,v,layer]);
              mat4.multiplyVec3(transform, vec, vec);
              var view = vec3.create([u,v,layer-1]);
              mat4.multiplyVec3(transform, view, view);
              
              var value = world.g(vec[0],vec[1],vec[2]);
              world.blockSet.writeColor(value, 255, data.data, c);
              if (data.data[c+3] < 255) {
                opaque = false;
              } else if (!world.opaque(view[0],view[1],view[2])) {
                thisLayerNotEmpty = true;
              }
            }
            
            // We can reuse this tile iff it was blank
            alloc = thisLayerNotEmpty;
            if (thisLayerNotEmpty) {
              // u,v coordinates of this tile for use by the vertex generator

              // TODO: If opacities change, we need to trigger rerender of chunks.
            }
            layers[layer] = thisLayerNotEmpty ? [tileu / layout.TILE_COUNT_U, tilev / layout.TILE_COUNT_V] : null;
            //console.log("id ", wi + 1, " face ", faceName, " layer ", layer, thisLayerNotEmpty ? " allocated" : " skipped");
          }
          layout.TILE_MAPPINGS.forEach(function (m) {
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
      },
      isOpaque: function (blockID) { return blockID in opacities ? opacities[blockID] : true },
      worldFor: function (blockID) {
        return worlds[blockID - 1] || null;
      }
    });
  };

  return Object.freeze(BlockSet);
})();
