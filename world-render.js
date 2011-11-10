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
        return dist2sq(a) - dist2sq(b);
      });
      distanceInfoCache.nearChunkOrder = Object.freeze(nearChunkOrder);
    }
    return distanceInfoCache;
  }
  
  function WorldRenderer(world, place) {
    // Object holding all world rendering chunks which have RenderBundles created, indexed by "<x>,<z>" where x and z are the low coordinates (i.e. divisible by CHUNKSIZE).
    var chunks = {};

    function compareByPlayerDistance(a,b) {
      return dist2sq([a[0]-playerChunk[0], a[1]-playerChunk[1]]) 
           - dist2sq([b[0]-playerChunk[0], b[1]-playerChunk[1]]);
    }

    // Queue of chunks to rerender. Array (first-to-do at the end); each element is [x,z] where x and z are the low coordinates of the chunk.
    var dirtyChunks = new DirtyQueue(compareByPlayerDistance);

    // Queue of chunks to render for the first time. Distinguished from dirtyChunks in that it can be flushed if the view changes.
    var addChunks = new DirtyQueue(compareByPlayerDistance);
    
    // The origin of the chunk which the player is currently in. Changes to this are used to decide to recompute chunk visibility.
    var playerChunk = null;
    
    // Like chunks, but for circuits. Indexed by the circuit origin block.
    var circuitRenderers = {};

    var blockSet = world.blockSet;
    var blockTexture = blockSet.texture;
    
    var particles = [];

    var textureDebugR = new RenderBundle(gl.TRIANGLE_STRIP, blockTexture, function (vertices, normals, texcoords) {
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
    
    var blockSet = world.blockSet;
    var textured = blockSet.textured;
    
    // --- methods, internals ---
    
    function deleteChunks() {
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        chunks[index].deleteResources();
      }
      for (var index in circuitRenderers) {
        if (!circuitRenderers.hasOwnProperty(index)) continue;
        circuitRenderers[index].deleteResources();
      }
      
      chunks = {};
      circuitRenderers = {};
      dirtyChunks.clear();
      addChunks.clear();
    }
    
    function rerenderChunks() {
      dirtyChunks.clear();
      for (var index in chunks) {
        if (!chunks.hasOwnProperty(index)) continue;
        chunks[index].dirtyChunk = true;
        var indexparts = index.split(",");
        dirtyChunks.enqueue([parseInt(indexparts[0],10),
                             parseInt(indexparts[1],10)],
                            chunks[index]);
      }
    }
    
    var listenerB = {
      // TODO: Optimize by rerendering only if *tiling* changed, and only
      // chunks containing the changed block ID?
      texturingChanged: dirtyAll
    }

    function deleteResources() {
      deleteChunks();
      textureDebugR.deleteResources();
      world.listen.cancel(listenerW);
      blockSet.listen.cancel(listenerB);
      world = blockSet = chunks = dirtyChunks = addChunks = textureDebugR = null;
    };
    function isAlive() {
      // Are we still interested in notifications etc?
      return !!world;
    }
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
        dirtyChunks.enqueue(k, chunks[k]);
      }
    }

    // entry points for change listeners
    function dirtyBlock(vec) {
      if (!isAlive()) return false;
      
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
      
      return true;
    }

    function dirtyAll() {
      if (!isAlive()) return false;
      rerenderChunks();
      return true;
    }

    function dirtyCircuit(circuit) {
      if (!isAlive()) return false;
      var o = circuit.getOrigin();
      var r = circuitRenderers[o];
      if (r) r.recompute();
      return true;
    }
    
    function deletedCircuit(circuit) {
      if (!isAlive()) return false;
      delete circuitRenderers[circuit.getOrigin()];
      return true;
    }

    var listenerW = {
      dirtyBlock: dirtyBlock,
      dirtyAll: dirtyAll,
      dirtyCircuit: dirtyCircuit,
      deletedCircuit: deletedCircuit,
    };

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
            addChunks.enqueue(chunkKey, chunks[chunkKey]);
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
        
        // Drop now-invisible circuits
        // TODO: This works off the origin, but circuits can be arbitrarily large so we should test against their AABB
        for (var key in circuitRenderers) {
          if (!circuitRenderers.hasOwnProperty(key)) continue;
          var xyz = key.split(",");
          if (xyz.length != 3) continue;
          
          if (dist2sq([xyz[0]-playerChunk[0],xyz[2]-playerChunk[1]]) > dds) {
            circuitRenderers[key].deleteResources();
            delete circuitRenderers[key];
          }
        }
        
      }

      var chunkQueue = dirtyChunks.size() > 0 ? dirtyChunks : addChunks;
      var toCompute = chunkQueue.size() > 30 ? 6 : 1;
      for (var i = 0; i < toCompute && chunkQueue.size() > 0; i++) {
        if (calcChunk(chunkQueue.dequeue())) {
          // Chunk wasn't actually dirty; take another chunk
          i--;
        }
      }
      
      if (chunkQueue.size() > 0) {
        // Schedule rendering more chunks
        scheduleDraw();
      }
      
      return i;
    }
    this.updateSomeChunks = updateSomeChunks;

    function renderDestroyBlock(block) {
      var blockWorld = blockSet.worldFor(world.g(block[0],block[1],block[2]));
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
      for (var index in circuitRenderers) {
        if (!circuitRenderers.hasOwnProperty(index)) continue;
        circuitRenderers[index].draw();
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
        var TILE_SIZE = World.TILE_SIZE;
        var PIXEL_SIZE = 1/TILE_SIZE;
        var ID_EMPTY = BlockSet.ID_EMPTY;
        chunks[xzkey] = new RenderBundle(gl.TRIANGLES,
                                         blockTexture,
                                         function (vertices, normals, texcoords) {
          // These statements are inside the function because they need to
          // retrieve the most up-to-date values.
          var tilings = blockSet.tilings; // has side effect of updating tiling if needed
          var BOGUS_TILING = tilings.bogus;
          var TILE_SIZE_UV = blockSet.getTexTileSize();
          var rawCircuits = world.getCircuitsByBlock();
          var types = blockSet.getAll();

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

            var btype = types[value];
            var tiling = tilings[value] || BOGUS_TILING;
            thiso = btype.opaque; // -- Note used by squares()

            squares(c1, rot.pz, rot.py, rot.px, rot.nx, tiling.lx, 0, TILE_SIZE_UV);
            squares(c1, rot.px, rot.pz, rot.py, rot.ny, tiling.ly, 0, TILE_SIZE_UV);
            squares(c1, rot.py, rot.px, rot.pz, rot.nz, tiling.lz, 0, TILE_SIZE_UV);
            squares(c2, rot.ny, rot.nz, rot.nx, rot.px, tiling.hx, TILE_SIZE_UV, 0);
            squares(c2, rot.nz, rot.nx, rot.ny, rot.py, tiling.hy, TILE_SIZE_UV, 0);
            squares(c2, rot.nx, rot.ny, rot.nz, rot.pz, tiling.hz, TILE_SIZE_UV, 0);
            var circuit = rawCircuits[x+","+y+","+z]; // TODO: replace this with some other spatial indexing scheme so we don't have to check per-every-block
            if (circuit) {
              var o = circuit.getOrigin();
              var r = circuitRenderers[o];
              if (!r) {
                circuitRenderers[o] = makeCircuitRenderer(circuit);
              }
            }
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
    
    function makeCircuitRenderer(circuit) {
      var dyns;
      var circuitRenderer = new RenderBundle(gl.TRIANGLES, null, function (vertices, normals, colors) {
        dyns = [];
        function pushVertex(vec) {
          vertices.push(vec[0], vec[1], vec[2]);
          normals.push(0,0,0);
        }
        circuit.getEdges().forEach(function (record) {
          var net = record[0];
          var fromBlock = record[1];
          var block = record[2];

          var delta = vec3.subtract(block, fromBlock, vec3.create());
          var perp = vec3.cross(delta, delta[1] ? UNIT_PX : UNIT_PY, vec3.create());
          vec3.normalize(perp);
          vec3.scale(perp, .1);
          var v0 = vec3.add     (vec3.add(fromBlock, [.5, .6, .5], vec3.create()), perp);
          var v1 = vec3.add     (vec3.add(block,     [.5, .6, .5], vec3.create()), perp);
          var v2 = vec3.subtract(vec3.add(block,     [.5, .6, .5], vec3.create()), perp);
          var v3 = vec3.subtract(vec3.add(fromBlock, [.5, .6, .5], vec3.create()), perp);
          var vbase = vertices.length;
          var cbase = colors.length;
          colors.push(1,1,1,1); pushVertex(v0);
          colors.push(1,1,1,1); pushVertex(v1);
          colors.push(1,1,1,1); pushVertex(v2);
          colors.push(1,1,1,1); pushVertex(v2);
          colors.push(1,1,1,1); pushVertex(v3);
          colors.push(1,1,1,1); pushVertex(v0);
          dyns.push(function () {
            var carr = circuitRenderer.colors.array;
            for (var i = 0, p = cbase; i < 6; i++) { // 6 vertices for the square
              carr[p++] = 0;
              carr[p++] = circuit.getNetValue(net);
              carr[p++] = 0;
              carr[p++] = 1;
            }
          });
        });
      }, {
        aroundDraw: function (baseDraw) {
          dyns.forEach(function (f) { f(); });
          circuitRenderer.colors.send(gl.DYNAMIC_DRAW);
          baseDraw();
        }
      });
      
      return circuitRenderer;
    }

    function debugText() {
      var text = "";
      if (dirtyChunks.size() > 0 || addChunks.size() > 0) {
        text += "Chunk Q: " + dirtyChunks.size() + " dirty, " + addChunks.size() + " new\n";
      }
      return text;
    }
    this.debugText = debugText;

    // --- init ---

    world.listen(listenerW);
    blockSet.listen(listenerB);
    Object.freeze(this);
  }

  return WorldRenderer;
})();

