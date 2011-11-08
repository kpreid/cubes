// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

// TODO: global variable 'gl'

var WorldRenderer = (function () {
  "use strict";
  
  // The side length of the chunks the world is broken into for rendering.
  // Smaller chunks are faster to update when the world changes, but have a higher per-frame cost.
  var CHUNKSIZE = 10;

  // 2D Euclidean distance, squared (for efficiency).
  function dist2sq(v) {
    return v[0]*v[0]+v[1]*v[1];
  }

  // Block rotation precalculations
  var ROT_DATA = [];
  for (var i = 0; i < applyCubeSymmetry.COUNT; i++) {
    ROT_DATA.push({
      pos:  applyCubeSymmetry(i, 1, [1,1,1]),
      zero: applyCubeSymmetry(i, 1, [0,0,0]),
      nx:   applyCubeSymmetry(i, 0, UNIT_NX),
      ny:   applyCubeSymmetry(i, 0, UNIT_NY),
      nz:   applyCubeSymmetry(i, 0, UNIT_NZ),
      px:   applyCubeSymmetry(i, 0, UNIT_PX),
      py:   applyCubeSymmetry(i, 0, UNIT_PY),
      pz:   applyCubeSymmetry(i, 0, UNIT_PZ)
    });
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

    var textureDebugR = new RenderBundle(gl.TRIANGLE_STRIP, world.blockSet.texture, function (vertices, normals, texcoords) {
      var x = 2;
      var y = 2;
      var z = -5;
      vertices.push(-x, -y, z);
      vertices.push(x, -y, z);
      vertices.push(-x, y, z);
      vertices.push(x, y, z);
      
      normals.push(0,0,0);
      normals.push(0,0,0);
      normals.push(0,0,0);
      normals.push(0,0,0);

      texcoords.push(0, 0);
      texcoords.push(1, 0);
      texcoords.push(0, 1);
      texcoords.push(1, 1);
    }, {
      aroundDraw: function (draw) {
        var mvsave = mvMatrix;
        mvMatrix = mat4.identity(mat4.create());
        sendViewUniforms();
        gl.disable(gl.DEPTH_TEST);
        draw();
        mvMatrix = mvsave;
        gl.enable(gl.DEPTH_TEST);
        sendViewUniforms();
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
      var toCompute = chunkQueue.length > 30 ? 6 : 1;
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

    function renderDestroyBlock(block) {
      var blockWorld = world.blockSet.worldFor(world.g(block[0],block[1],block[2]));
      // TODO: add particles for color blocks
      if (blockWorld)
        particles.push(new BlockParticles(world, block, blockWorld, world.gRot(block[0],block[1],block[2])));
    }
    this.renderDestroyBlock = renderDestroyBlock;

    function renderCreateBlock(block, value) {
      particles.push(new BlockParticles(world, block, null, 0));
    }
    this.renderCreateBlock = renderCreateBlock;

    function draw() {
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        var chunk = chunks[index];
        if (aabbInView(chunk.aabb))
          chunk.draw();
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
        var rawRotations = world.rawRotations;
        var chunkOriginX = xzkey[0];
        var chunkOriginZ = xzkey[1];
        var chunkLimitX = Math.min(wx, xzkey[0] + CHUNKSIZE);
        var chunkLimitZ = Math.min(wz, xzkey[1] + CHUNKSIZE);
        var blockSet = world.blockSet;
        var TILE_SIZE = World.TILE_SIZE;
        var PIXEL_SIZE = 1/TILE_SIZE;
        var ID_EMPTY = BlockSet.ID_EMPTY;
        chunks[xzkey] = new RenderBundle(gl.TRIANGLES,
                                         blockTexture,
                                         function (vertices, normals, texcoords) {
                                           
          var tilings = blockSet.tilings; // has side effect of updating tiling if needed
          var BOGUS_TILING = tilings.bogus;

          var TILE_SIZE_UV = blockSet.getTexTileSize();

          var vecbuf = vec3.create();

          function pushVertex(vec) {
            vertices.push(vec[0], vec[1], vec[2]);
          }
          function pushNormal(vec) {
            normals.push(vec[0], vec[1], vec[2]);
          }
          function pushTileCoord(tileKey, u, v) {
            texcoords.push(tileKey[1] + u,
                           tileKey[0] + v);
          }

          function square(origin, v1, v2, tileKey, texO, texD, normal) {
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
            
            pushNormal(normal);
            pushNormal(normal);
            pushNormal(normal);
            pushNormal(normal);
            pushNormal(normal);
            pushNormal(normal);
          }
          
          var c1 = vec3.create();
          var c2 = vec3.create();
          var depthOriginBuf = vec3.create();
          var thiso; // used by squares, assigned by loop
          function squares(origin, v1, v2, vDepth, vFacing, tileLayers, texO, texD) {
            if (thiso && world.opaque(x+vFacing[0],y+vFacing[1],z+vFacing[2])) {
              // this face is invisible
              return
            } else if (tileLayers == null) {
              square(origin, v1, v2, null, texO, texD);
            } else {
              vec3.set(origin, depthOriginBuf);
              for (var i = 0; i < TILE_SIZE; i++) {
                square(depthOriginBuf, v1, v2, tileLayers[i], texO, texD, vFacing);
                depthOriginBuf[0] += vDepth[0]*PIXEL_SIZE;
                depthOriginBuf[1] += vDepth[1]*PIXEL_SIZE;
                depthOriginBuf[2] += vDepth[2]*PIXEL_SIZE;
              }
            }
          }

          for (var x = chunkOriginX; x < chunkLimitX; x++)
          for (var y = 0;            y < wy         ; y++)
          for (var z = chunkOriginZ; z < chunkLimitZ; z++) {
            // raw array access inlined and simplified for efficiency
            var rawIndex = (x*wy+y)*wz+z;
            var value = rawBlocks[rawIndex];

            if (value === ID_EMPTY) continue;

            var rot = ROT_DATA[rawRotations[rawIndex]];
            var rzero = rot.zero;
            var rpos = rot.pos;
            c1[0] = x+rzero[0]; c2[0] = x+rpos[0];
            c1[1] = y+rzero[1]; c2[1] = y+rpos[1];
            c1[2] = z+rzero[2]; c2[2] = z+rpos[2];

            var btype = blockSet.get(value);
            var tiling = tilings[value] || BOGUS_TILING;
            thiso = btype.opaque; // -- Note used by squares()

            squares(c1, rot.pz, rot.py, rot.px, rot.nx, tiling.lx, 0, TILE_SIZE_UV);
            squares(c1, rot.px, rot.pz, rot.py, rot.ny, tiling.ly, 0, TILE_SIZE_UV);
            squares(c1, rot.py, rot.px, rot.pz, rot.nz, tiling.lz, 0, TILE_SIZE_UV);
            squares(c2, rot.ny, rot.nz, rot.nx, rot.px, tiling.hx, TILE_SIZE_UV, 0);
            squares(c2, rot.nz, rot.nx, rot.ny, rot.py, tiling.hy, TILE_SIZE_UV, 0);
            squares(c2, rot.nx, rot.ny, rot.nz, rot.pz, tiling.hz, TILE_SIZE_UV, 0);
          }
        });
        
        chunks[xzkey].aabb = [
          [chunkOriginX, chunkLimitX],
          [0, world.wy],
          [chunkOriginZ, chunkLimitZ]
        ];
        
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

