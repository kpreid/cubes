// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

// TODO: global variable 'gl'

var WorldRenderer = (function () {
  // The side length of the chunks the world is broken into for rendering.
  // Smaller chunks are faster to update when the world changes, but have a higher per-frame cost.
  var CHUNKSIZE = 12;
  
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

    var textureDebugR = new RenderBundle(gl.TRIANGLE_STRIP, blockTexture, function (vertices, colors, texcoords) {
      var x = 2;
      var y = 2;
      var z = -5;
      vertices.push(-x, -y, z);
      vertices.push(x, -y, z);
      vertices.push(-x, y, z);
      vertices.push(x, y, z);
      
      colors.push(1, 1, 1, 1);
      colors.push(1, 1, 1, 1);
      colors.push(1, 1, 1, 1);
      colors.push(1, 1, 1, 1);

      texcoords.push(0, 0);
      texcoords.push(1, 0);
      texcoords.push(0, 1);
      texcoords.push(1, 1);
    });
    

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
      for (var i = 0; i < 6 && dirtyChunks.length > 0; i++) {
        calcChunk(dirtyChunks.pop());
      }
      return i;
    }
    this.updateSomeChunks = updateSomeChunks;

    function draw() {
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        chunks[index].draw();
      }
      
      if (false) { // TODO: Add a way to turn this on for debugging/amusement value. (Display of the raw texture.)
        var mvsave = mvMatrix;
        mvMatrix = mat4.identity(mat4.create());
        textureDebugR.draw();
        mvMatrix = mvsave;
      }
    }
    this.draw = draw;

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
        var TILE_SIZE = World.TILE_SIZE;
        var PIXEL_SIZE = 1/TILE_SIZE;
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

            if (textured) {
              if (tileKey == null) return; // transparent or obscured layer
              
              pushTileCoord(tileKey, texO, texO);
              pushTileCoord(tileKey, TILE_SIZE_U, 0);
              pushTileCoord(tileKey, 0, TILE_SIZE_V);
              pushTileCoord(tileKey, texD, texD);
              pushTileCoord(tileKey, 0, TILE_SIZE_V);
              pushTileCoord(tileKey, TILE_SIZE_U, 0);
            }

            pushVertex(origin);
            pushVertex(vec3.add(origin, v1, vecbuf));
            pushVertex(vec3.add(origin, v2, vecbuf));

            pushVertex(vec3.add(vec3.add(origin, v1, vecbuf), v2, vecbuf));
            pushVertex(vec3.add(origin, v2, vecbuf));
            pushVertex(vec3.add(origin, v1, vecbuf));

            for (var i=0; i < 6; i++) {
              colors.push(color[0],color[1],color[2],color[3]);
            }
          }
          var depthOriginBuf = vec3.create();
          function squares(origin, v1, v2, vDepth, tileLayers, texO, texD, color) {
            if (tileLayers == null) {
              square(origin, v1, v2, null, texO, texD, color);
            } else {
              vec3.set(origin, depthOriginBuf);
              for (var i = 0; i < TILE_SIZE; i++) {
                square(depthOriginBuf, v1, v2, tileLayers[i], texO, texD, color);
                depthOriginBuf[0] += vDepth[0]*PIXEL_SIZE;
                depthOriginBuf[1] += vDepth[1]*PIXEL_SIZE;
                depthOriginBuf[2] += vDepth[2]*PIXEL_SIZE;
              }
            }
          }

          for (var x = chunkOriginX; x < chunkLimitX; x++)
          for (var y = 0;            y < wy         ; y++)
          for (var z = chunkOriginZ; z < chunkLimitZ; z++) {
            var value = world.g(x,y,z);
            var thiso = world.opaque(x,y,z); // If this and its neighbor are opaque, then hide surfaces
            if (world.solid(x,y,z)) {
              var tiling = textured ?
                blockSet.tilings[value - 1] || blockSet.tilings[0 /* = ID_BOGUS - 1 */]
                : DUMMY_TILING;
              blockSet.writeColor(value, 1.0, colorbuf, 0);
              var c1 = [x,y,z];
              var c2 = [x+1,y+1,z+1];
              if (!thiso || !world.opaque(x-1,y,z)) squares(c1, UNIT_PZ, UNIT_PY, UNIT_PX, tiling.lx, 0, TILE_SIZE_V, colorbuf);
              if (!thiso || !world.opaque(x,y-1,z)) squares(c1, UNIT_PX, UNIT_PZ, UNIT_PY, tiling.ly, 0, TILE_SIZE_V, colorbuf);
              if (!thiso || !world.opaque(x,y,z-1)) squares(c1, UNIT_PY, UNIT_PX, UNIT_PZ, tiling.lz, 0, TILE_SIZE_V, colorbuf);
              if (!thiso || !world.opaque(x+1,y,z)) squares(c2, UNIT_NY, UNIT_NZ, UNIT_NX, tiling.hx, TILE_SIZE_U, 0, colorbuf);
              if (!thiso || !world.opaque(x,y+1,z)) squares(c2, UNIT_NZ, UNIT_NX, UNIT_NY, tiling.hy, TILE_SIZE_U, 0, colorbuf);
              if (!thiso || !world.opaque(x,y,z+1)) squares(c2, UNIT_NX, UNIT_NY, UNIT_NZ, tiling.hz, TILE_SIZE_U, 0, colorbuf);
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

