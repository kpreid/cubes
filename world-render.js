// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

// TODO: global variable 'gl'

var WorldRenderer = (function () {
  // The side length of the chunks the world is broken into for rendering.
  // Smaller chunks are faster to update when the world changes, but have a higher per-frame cost.
  var CHUNKSIZE = 10;

  // 2D Euclidean distance, squared (for efficiency).
  function dist2sq(v) {
    return v[0]*v[0]+v[1]*v[1];
  }
    
  var distanceInfoCache = {}, lastSeenRenderDistance = null;
  function renderDistanceInfo() {
    if (configRenderDistance !== lastSeenRenderDistance) {
      // The distance at which invisible chunks are dropped from memory. Semi-arbitrary figure...
      distanceInfoCache.dropChunkDistanceSquared = Math.pow(configRenderDistance + 2*CHUNKSIZE, 2);

      // A static table of the offsets of the chunks visible from the player location
      var nearChunkOrder = [];
      var chunkDistance = Math.ceil(configRenderDistance/CHUNKSIZE);
      var boundSquared = Math.pow(configRenderDistance + CHUNKSIZE, 2);
      for (var x = -chunkDistance-1; x <= chunkDistance; x++)
      for (var z = -chunkDistance-1; z <= chunkDistance; z++) {
        var v = [x*CHUNKSIZE,z*CHUNKSIZE];
        if (dist2sq(v) <= boundSquared) {
          nearChunkOrder.push(v);
        }
      }
      nearChunkOrder.sort(function (a,b) {
        return dist2sq(b) - dist2sq(a);
      });
      distanceInfoCache.nearChunkOrder = Object.freeze(nearChunkOrder);
    }
    return distanceInfoCache;
  }
  
  function WorldRenderer(world, place) {
    world.setChangeListener(this);
    
    // Object holding all world rendering chunks which have RenderBundles created, indexed by "<x>,<z>" where x and z are the low coordinates (i.e. divisible by CHUNKSIZE).
    var chunks = {};

    // Queue of chunks to rerender. Array (first-to-do at the end); each element is [x,z] where x and z are the low coordinates of the chunk.
    var dirtyChunks = [];

    // Queue of chunks to render for the first time. Distinguished from dirtyChunks in that it can be flushed if the view changes.
    var addChunks = [];
    
    // The origin of the chunk which the player is currently in. Changes to this are used to decide to recompute chunk visibility.
    var playerChunk = null;
    
    var blockTexture = world.blockSet.texture;
    
    var particles = [];

    var textureDebugR = new RenderBundle(gl.TRIANGLE_STRIP, blockTexture, function (vertices, texcoords) {
      var x = 2;
      var y = 2;
      var z = -5;
      vertices.push(-x, -y, z);
      vertices.push(x, -y, z);
      vertices.push(-x, y, z);
      vertices.push(x, y, z);

      texcoords.push(0, 0);
      texcoords.push(1, 0);
      texcoords.push(0, 1);
      texcoords.push(1, 1);
    }, {
      aroundDraw: function (draw) {
        var mvsave = mvMatrix;
        mvMatrix = mat4.identity(mat4.create());
        gl.disable(gl.DEPTH_TEST);
        draw();
        mvMatrix = mvsave;
        gl.enable(gl.DEPTH_TEST);
      },
    });
    
    // --- methods, internals ---
    
    function deleteChunks() {
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        chunks[index].deleteResources();
      }
      
      chunks = {};
      dirtyChunks = [];
      addChunks = [];
    }
    
    function rerenderChunks() {
      // TODO: not in near-to-far order.
      dirtyChunks = [];
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        chunks[index].dirtyChunk = true;
        var indexparts = index.split(",");
        dirtyChunks.push([parseInt(indexparts[0],10),
                          parseInt(indexparts[1],10)]);
      }
    }
    
    function rebuildBlock(blockID) {
      world.blockSet.rebuildBlockTexture(blockID);
      // TODO: we don't need to flush the chunks if the texture tiling has not changed at all.
      rerenderChunks();
    }
    this.rebuildBlock = rebuildBlock;

    function deleteResources() {
      deleteChunks();
      textureDebugR.deleteResources();
      world.setChangeListener(null);
    };
    this.deleteResources = deleteResources;

    function changedRenderDistance() {
      playerChunk = null; // TODO kludge. The effect of this is to reevaluate which chunks are visible
      addChunks = [];
    }
    this.changedRenderDistance = changedRenderDistance;

    function chunkIntersectsWorld(chunkOrigin) {
      var x = chunkOrigin[0];
      var z = chunkOrigin[1];
      return x >= 0 && x - CHUNKSIZE < world.wx &&
             z >= 0 && z - CHUNKSIZE < world.wz;
    }

    // x,z must be multiples of CHUNKSIZE
    function setDirtyChunk(x, z) {
      var k = [x, z];
      if (!chunkIntersectsWorld(k)) return;
      var c = chunks[k];
      if (c) {
        // This routine is used only for "this block changed", so if there is
        // not already a chunk, we don't create it.
        c.dirtyChunk = true;
        dirtyChunks.push(k);
      }
    }

    function dirtyBlock(vec) {
      var x = vec[0];
      var z = vec[2];
      
      var xm = mod(x, CHUNKSIZE);
      var zm = mod(z, CHUNKSIZE);
      x -= xm;
      z -= zm;

      setDirtyChunk(x,z);
      if (xm == 0)           setDirtyChunk(x-CHUNKSIZE,z);
      if (zm == 0)           setDirtyChunk(x,z-CHUNKSIZE);
      if (xm == CHUNKSIZE-1) setDirtyChunk(x+CHUNKSIZE,z);
      if (zm == CHUNKSIZE-1) setDirtyChunk(x,z+CHUNKSIZE);

      // TODO: This is actually "Schedule updateSomeChunks()" and shouldn't actually require a frame redraw
      scheduleDraw();
    }
    this.dirtyBlock = dirtyBlock;

    function updateSomeChunks() {
      // Determine if chunks' visibility to the player has changed
      var newPlayerChunk = [place.pos[0] - mod(place.pos[0], CHUNKSIZE),
                            place.pos[2] - mod(place.pos[2], CHUNKSIZE)];
      if (playerChunk == null || newPlayerChunk[0] != playerChunk[0] || newPlayerChunk[1] != playerChunk[1]) {
        //console.log("nPC ", newPlayerChunk[0], newPlayerChunk[1]);
        
        playerChunk = newPlayerChunk;
        
        // Add chunks which are in viewing distance.
        renderDistanceInfo().nearChunkOrder.forEach(function (offset) {
          var chunkKey = [playerChunk[0] + offset[0], playerChunk[1] + offset[1]];
          if (!chunks[chunkKey] && chunkIntersectsWorld(chunkKey)) {
            addChunks.push(chunkKey);
          }
        });

        // Drop now-invisible chunks. Has a higher boundary so that we're not constantly reloading chunks if the player is moving back and forth.
        var dds = renderDistanceInfo().dropChunkDistanceSquared;
        for (var key in chunks) {
          if (!chunks.hasOwnProperty(key)) continue;
          var xz = key.split(",");
          if (xz.length != 2) continue;
          
          if (dist2sq([xz[0]-playerChunk[0],xz[1]-playerChunk[1]]) > dds) {
            chunks[key].deleteResources();
            delete chunks[key];
          }
        }
      }

      var chunkQueue = dirtyChunks.length > 0 ? dirtyChunks : addChunks;
      var toCompute = chunkQueue.length > 30 ? 3 : 1;
      for (var i = 0; i < toCompute && chunkQueue.length > 0; i++) {
        if (calcChunk(chunkQueue.pop())) {
          // Chunk wasn't actually dirty; take another chunk
          i--;
        }
      }
      
      if (chunkQueue.length > 0) {
        // Schedule rendering more chunks
        scheduleDraw();
      }
      
      return i;
    }
    this.updateSomeChunks = updateSomeChunks;

    function renderDestroyBlock(block, value) {
      var blockWorld = world.blockSet.worldFor(value);
      // TODO: add particles for color blocks
      if (blockWorld)
        particles.push(new BlockParticles(block, blockWorld));
    }
    this.renderDestroyBlock = renderDestroyBlock;

    function renderCreateBlock(block, value) {
      particles.push(new BlockParticles(block, null));
    }
    this.renderCreateBlock = renderCreateBlock;

    function draw() {
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        chunks[index].draw();
      }
      
      for (var i = 0; i < particles.length; i++) {
        var particleSystem = particles[i];
        if (particleSystem.expired()) {
          if (i < particles.length - 1) {
            particles[i] = particles.pop();
          } else {
            particles.pop();
          }
          i--;
        } else {
          particleSystem.draw();
        }
      }
      if (particles.length > 0) {
        // If there are any particle systems, we need to continue animating.
        scheduleDraw();
      }
      
      if (configDebugTextureAllocation) {
        var mvsave = mvMatrix;
        mvMatrix = mat4.identity(mat4.create());
        textureDebugR.draw();
        mvMatrix = mvsave;
      }
    }
    this.draw = draw;

    // returns whether no work was done
    function calcChunk(xzkey) {
      // This would call scheduleDraw() to render the revised chunks, except that calcChunk is only called within a draw. Therefore, the calls are commented out (to be reenabled if the architecture changes).
      var c = chunks[xzkey];
      if (c) {
        if (c.dirtyChunk) {
          c.dirtyChunk = false;
          c.recompute();
          //scheduleDraw();
          return false;
        } else {
          return true;
        }
      } else {
        var wx = world.wx;
        var wy = world.wy;
        var wz = world.wz;
        var rawBlocks = world.raw; // for efficiency
        var chunkOriginX = xzkey[0];
        var chunkOriginZ = xzkey[1];
        var chunkLimitX = xzkey[0] + CHUNKSIZE;
        var chunkLimitZ = xzkey[1] + CHUNKSIZE;
        var blockSet = world.blockSet;
        var tilings = blockSet.tilings;
        var TILE_SIZE = World.TILE_SIZE;
        var PIXEL_SIZE = 1/TILE_SIZE;
        var ID_EMPTY = BlockSet.ID_EMPTY;
        var BOGUS_TILING = tilings[BlockSet.ID_BOGUS];
        chunks[xzkey] = new RenderBundle(gl.TRIANGLES,
                                         blockTexture,
                                         function (vertices, texcoords) {
          var TILE_SIZE_UV = blockSet.getTexTileSize();

          var vecbuf = vec3.create();

          function pushVertex(vec) {
            vertices.push(vec[0], vec[1], vec[2]);
          }
          function pushTileCoord(tileKey, u, v) {
            texcoords.push(tileKey[1] + u,
                           tileKey[0] + v);
          }

          function square(origin, v1, v2, tileKey, texO, texD) {
            // texO and texD are the originward and v'ward texture coordinates, used to flip the texture coords vs. origin for the 'positive side' squares

            if (tileKey == null) return; // transparent or obscured layer
            
            pushTileCoord(tileKey, texO, texO);
            pushTileCoord(tileKey, TILE_SIZE_UV, 0);
            pushTileCoord(tileKey, 0, TILE_SIZE_UV);
            pushTileCoord(tileKey, texD, texD);
            pushTileCoord(tileKey, 0, TILE_SIZE_UV);
            pushTileCoord(tileKey, TILE_SIZE_UV, 0);

            pushVertex(origin);
            pushVertex(vec3.add(origin, v1, vecbuf));
            pushVertex(vec3.add(origin, v2, vecbuf));

            pushVertex(vec3.add(vec3.add(origin, v1, vecbuf), v2, vecbuf));
            pushVertex(vec3.add(origin, v2, vecbuf));
            pushVertex(vec3.add(origin, v1, vecbuf));
          }
          var depthOriginBuf = vec3.create();
          function squares(origin, v1, v2, vDepth, tileLayers, texO, texD) {
            if (tileLayers == null) {
              square(origin, v1, v2, null, texO, texD);
            } else {
              vec3.set(origin, depthOriginBuf);
              for (var i = 0; i < TILE_SIZE; i++) {
                square(depthOriginBuf, v1, v2, tileLayers[i], texO, texD);
                depthOriginBuf[0] += vDepth[0]*PIXEL_SIZE;
                depthOriginBuf[1] += vDepth[1]*PIXEL_SIZE;
                depthOriginBuf[2] += vDepth[2]*PIXEL_SIZE;
              }
            }
          }

          for (var x = chunkOriginX; x < chunkLimitX; x++)
          for (var y = 0;            y < wy         ; y++)
          for (var z = chunkOriginZ; z < chunkLimitZ; z++) {
            var value = x < wx && z < wz ? rawBlocks[(x*wy+y)*wz+z] : ID_EMPTY; // inlined and simplified for efficiency
            var btype = blockSet.get(value);
            var thiso = btype.opaque; // If this and its neighbor are opaque, then hide surfaces
            if (value != ID_EMPTY) {
              var tiling = tilings[value] || BOGUS_TILING;
              var c1 = [x,y,z];
              var c2 = [x+1,y+1,z+1];
              if (!thiso || !world.opaque(x-1,y,z)) squares(c1, UNIT_PZ, UNIT_PY, UNIT_PX, tiling.lx, 0, TILE_SIZE_UV);
              if (!thiso || !world.opaque(x,y-1,z)) squares(c1, UNIT_PX, UNIT_PZ, UNIT_PY, tiling.ly, 0, TILE_SIZE_UV);
              if (!thiso || !world.opaque(x,y,z-1)) squares(c1, UNIT_PY, UNIT_PX, UNIT_PZ, tiling.lz, 0, TILE_SIZE_UV);
              if (!thiso || !world.opaque(x+1,y,z)) squares(c2, UNIT_NY, UNIT_NZ, UNIT_NX, tiling.hx, TILE_SIZE_UV, 0);
              if (!thiso || !world.opaque(x,y+1,z)) squares(c2, UNIT_NZ, UNIT_NX, UNIT_NY, tiling.hy, TILE_SIZE_UV, 0);
              if (!thiso || !world.opaque(x,y,z+1)) squares(c2, UNIT_NX, UNIT_NY, UNIT_NZ, tiling.hz, TILE_SIZE_UV, 0);
            }
          }
        });
        //scheduleDraw();
        return false;
      }
    }

    function debugText() {
      var text = "";
      if (dirtyChunks.length > 0 || addChunks.length > 0) {
        text += "Chunk Q: " + dirtyChunks.length + " dirty, " + addChunks.length + " new\n";
      }
      return text;
    }
    this.debugText = debugText;

    // --- init ---

    Object.freeze(this);
  }

  return WorldRenderer;
})();

