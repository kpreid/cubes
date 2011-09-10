var BlockSet = (function () {
  function BlockSet() {
    'use strict';
  }

  BlockSet.colors = Object.freeze({
    textured: false,
    writeColor: function (blockID, scale, target, offset) {
      target[offset] = (blockID & 3) / 3 * scale;
      target[offset+1] = ((blockID >> 2) & 3) / 3 * scale;
      target[offset+2] = ((blockID >> 4) & 3) / 3 * scale;
      target[offset+3] = scale;
    },
    generateBlockTextures: function () {}
  });

  BlockSet.newTextured = function (worlds) {
    var tilings = [];
    for (var i = 0; i < worlds.length; i++) tilings.push({});
    return Object.freeze({
      textured: true,
      writeColor: function (blockID, scale, target, offset) {
        target[offset] = scale;
        target[offset+1] = scale;
        target[offset+2] = scale;
        target[offset+3] = scale;
      },
      tilings: tilings,
      generateBlockTextures: function (data) {
        // (tileu,tilev) is the position in the texture of each block-face tile as they are generated.
        var tileu = -1;
        var tilev = 0;

        for (var wi = 0; wi < worlds.length; wi++) {
          var world = worlds[wi];
        
          function sliceWorld(name, transform) {
            // allocate next position
            tileu++;
            if (tileu >= TILE_COUNT_U) {
              tileu = 0;
              tilev++;
            }
            if (tilev >= TILE_COUNT_V) {
              console.error("blockTexture too small to contain all tiles!");
              tileu = 0;
              tilev = 0;
            }

            var pixu = tileu*TILE_SIZE;
            var pixv = tilev*TILE_SIZE;
            // extract surface plane of block from world
            for (var u = 0; u < TILE_SIZE; u++)
            for (var v = 0; v < TILE_SIZE; v++) {
              var c = ((pixu+u) * data.width + pixv+v) * 4;
              var vec = vec3.create([u,v,0]);
              mat4.multiplyVec3(transform, vec, vec);
              var value = world.g(vec[0],vec[1],vec[2]);
              world.blockSet.writeColor(value, 255, data.data, c);
            }

            // u,v coordinates of this tile for use by the vertex generator
            tilings[wi][name] = [tileu / TILE_COUNT_U, tilev / TILE_COUNT_V];
          }
          TILE_MAPPINGS.forEach(function (m) { // TODO: global variable TILE_MAPPINGS
            sliceWorld.apply(undefined, m);
          });
        }
      },
      worldFor: function (blockID) {
        // TODO: make the fallback block block 0
        return worlds[Math.min(blockID - 1, worlds.length - 1)];
      }
    });
  };

  return Object.freeze(BlockSet);
})();
