// TODO: global variable 'gl'

var WorldRenderer = (function () {
  // The side length of the chunks the world is broken into for rendering.
  // Smaller chunks are faster to update when the world changes, but have a higher per-frame cost.
  var CHUNKSIZE = 12;
  
  var TILE_COUNT_U = 4;
  var TILE_COUNT_V = 4;
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
      0, 0, 0, 0,
      0, 0, 0, 1
    ])],
    ["hz", mat4.create([
      // high z face
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 0,
      0, 0, 15, 1
    ])],
    ["lx", mat4.create([
      // low x face
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 0,
      0, 0, 0, 1
    ])],
    ["hx", mat4.create([
      // high x face
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 0,
      15, 0, 0, 1
    ])],
    ["ly", mat4.create([
      // low y face
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 1
    ])],
    ["hy", mat4.create([
      // high y face
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 0, 0, 0,
      0, 15, 0, 1
    ])],
  ];
  var DUMMY_TILING = Object.freeze({lx:null,ly:null,lz:null,hx:null,hy:null,hz:null});

  var textureLayoutInfo = Object.freeze({
    TILE_COUNT_U: TILE_COUNT_U,
    TILE_COUNT_V: TILE_COUNT_V,
    TILE_SIZE_U: TILE_SIZE_U,
    TILE_SIZE_V: TILE_SIZE_V,
    TILE_MAPPINGS: TILE_MAPPINGS
  });

  function WorldRenderer(world, place) {
    // Texture holding tiles
    var blockTexture = gl.createTexture();

    // ImageData object used to buffer calculated texture data
    var blockTextureData = document.createElement("canvas").getContext("2d")
      .createImageData(World.TILE_SIZE * TILE_COUNT_U, World.TILE_SIZE * TILE_COUNT_V);

    // Object holding all world rendering chunks which have RenderBundles created, indexed by "<x>,<z>" where x and z are the low coordinates (i.e. divisible by CHUNKSIZE).
    var chunks = {};

    // Queue of chunks to render. Array (first-to-do at the end); each element is [x,z] where x and z are the low coordinates of the chunk.
    var dirtyChunks = [];

    // --- methods, internals ---
    function rebuildBlockTexture() {
      if (!blockTexture) return;

      var data = blockTextureData;

      world.blockSet.generateBlockTextures(blockTextureData, textureLayoutInfo);
      gl.bindTexture(gl.TEXTURE_2D, blockTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    this.rebuildBlockTexture = rebuildBlockTexture;

    this.delete = function() {
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        chunks[index].delete();
      }
    };

    function dirtyBlock(x,z) {
      function _dirty(x,z) {
        if (x < 0 || x >= world.wx || z < 0 || z >= world.wz) return;
        dirtyChunks.push([x,z]); // TODO: de-duplicate
      }

      var xm = mod(x, CHUNKSIZE);
      var zm = mod(z, CHUNKSIZE);
      x -= xm;
      z -= zm;

      _dirty(x,z);
      if (xm == 0)           _dirty(x-CHUNKSIZE,z);
      if (zm == 0)           _dirty(x,z-CHUNKSIZE);
      if (xm == CHUNKSIZE-1) _dirty(x+CHUNKSIZE,z);
      if (zm == CHUNKSIZE-1) _dirty(x,z+CHUNKSIZE);
    }
    this.dirtyBlock = dirtyBlock;

    function depthSortDirty() {
      var pp = place.pos;
      dirtyChunks.sort(function (a,b) {
        return (
          Math.pow(b[0]-pp[0],2)+Math.pow(b[1]-pp[2],2)
          - (Math.pow(a[0]-pp[0],2)+Math.pow(a[1]-pp[2],2))
        );
      });
    }

    function updateSomeChunks() {
      for (var i = 0; i < 3; i++) {
        if (dirtyChunks.length > 0) {
          calcChunk(dirtyChunks.pop());
        }
      }
    }
    this.updateSomeChunks = updateSomeChunks;

    function renderChunks() {
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        chunks[index].draw();
      }
    }
    this.renderChunks = renderChunks;

    function calcChunk(xzkey) {
      if (chunks[xzkey]) {
        chunks[xzkey].recompute();
      } else {
        var wx = world.wx;
        var wy = world.wy;
        var wz = world.wz;
        var chunkOriginX = xzkey[0];
        var chunkOriginZ = xzkey[1];
        var chunkLimitX = xzkey[0] + CHUNKSIZE;
        var chunkLimitZ = xzkey[1] + CHUNKSIZE;
        var blockSet = world.blockSet;
        var textured = blockSet.textured;
        chunks[xzkey] = new RenderBundle(gl.TRIANGLES,
                                         textured ? blockTexture : null, 
                                         function (vertices, colors, texcoords) {
          var t0 = Date.now();
          var blockSet = world.blockSet;
          var tilings = blockSet.tilings;
          var colorbuf = [];
          var vecbuf = vec3.create();

          function pushVertex(vec) {
            vertices.push(vec[0], vec[1], vec[2]);
          }
          function pushTileCoord(tileKey, u, v) {
            texcoords.push(tileKey[1] + u, 
                           tileKey[0] + v);
          }

          function square(origin, v1, v2, tileKey, texO, texD, color) {
            // texO and texD are the originward and v'ward texture coordinates, used to flip the texture coords vs. origin for the 'positive side' squares

            pushVertex(origin);
            pushVertex(vec3.add(origin, v1, vecbuf));
            pushVertex(vec3.add(origin, v2, vecbuf));

            pushVertex(vec3.add(vec3.add(origin, v1, vecbuf), v2, vecbuf));
            pushVertex(vec3.add(origin, v2, vecbuf));
            pushVertex(vec3.add(origin, v1, vecbuf));

            if (textured) {
              pushTileCoord(tileKey, texO, texO);
              pushTileCoord(tileKey, TILE_SIZE_U, 0);
              pushTileCoord(tileKey, 0, TILE_SIZE_V);
              pushTileCoord(tileKey, texD, texD);
              pushTileCoord(tileKey, 0, TILE_SIZE_V);
              pushTileCoord(tileKey, TILE_SIZE_U, 0);
            }

            for (var i=0; i < 6; i++) {
              colors.push(color[0],color[1],color[2],color[3]);
            }
          }

          for (var x = chunkOriginX; x < chunkLimitX; x++)
          for (var y = 0;            y < wy         ; y++)
          for (var z = chunkOriginZ; z < chunkLimitZ; z++) {
            var value = world.g(x,y,z);
            var tiling = textured ?
              blockSet.tilings[value - 1] || blockSet.tilings[0 /* = ID_BOGUS - 1 */]
              : DUMMY_TILING;
            if (world.solid(x,y,z)) {
              blockSet.writeColor(value, 1.0, colorbuf, 0);
              var c1 = [x,y,z];
              var c2 = [x+1,y+1,z+1];
              if (!world.solid(x-1,y,z)) square(c1, UNIT_PZ, UNIT_PY, tiling.lx, 0, TILE_SIZE_V, colorbuf);
              if (!world.solid(x,y-1,z)) square(c1, UNIT_PX, UNIT_PZ, tiling.ly, 0, TILE_SIZE_V, colorbuf);
              if (!world.solid(x,y,z-1)) square(c1, UNIT_PY, UNIT_PX, tiling.lz, 0, TILE_SIZE_V, colorbuf);
              if (!world.solid(x+1,y,z)) square(c2, UNIT_NY, UNIT_NZ, tiling.hx, TILE_SIZE_U, 0, colorbuf);
              if (!world.solid(x,y+1,z)) square(c2, UNIT_NZ, UNIT_NX, tiling.hy, TILE_SIZE_U, 0, colorbuf);
              if (!world.solid(x,y,z+1)) square(c2, UNIT_NX, UNIT_NY, tiling.hz, TILE_SIZE_U, 0, colorbuf);
            }
          }
          var t1 = Date.now();
          //console.log("Geometry regen:", t1-t0, "ms");
        });
      }
      needsDraw = true;
    }

    function debugText() {
      var text = "";
      if (dirtyChunks.length > 0) {
        text += "Chunk Q: " + dirtyChunks.length + "\n";
      }
      return text;
    }
    this.debugText = debugText;

    // --- init ---

    Object.freeze(this);

    rebuildBlockTexture();

    for (var x = 0; x < world.wx; x += CHUNKSIZE)
    for (var z = 0; z < world.wz; z += CHUNKSIZE) (function () {
      dirtyBlock(x+1, z+1);
    })();
    setTimeout(depthSortDirty, 0); // deferred so rest of init can happen and establish player's loc
  }

  return WorldRenderer;
})();

