// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var WorldRenderer = (function () {
  "use strict";
  
  // The side length of the chunks the world is broken into for rendering.
  // Smaller chunks are faster to update when the world changes, but have a higher per-frame cost.
  var LIGHT_TEXTURE_SIZE = 16; // must be power of 2
  var CHUNKSIZE = LIGHT_TEXTURE_SIZE - 2;
  
  // 3D Euclidean distance, squared (for efficiency).
  function dist3sq(v1, v2) {
    var x = v1[0] - v2[0];
    var y = v1[1] - v2[1];
    var z = v1[2] - v2[2];
    return x*x + y*y + z*z;
  }

  var rotationsByCode = CubeRotation.byCode;

  var distanceInfoCache = {}, lastSeenRenderDistance = null;
  function renderDistanceInfo(newRenderDistance) {
    // TODO add some visibility into whether this one-element cache is thrashing
    if (newRenderDistance !== lastSeenRenderDistance) {
      //if (typeof console !== "undefined") console.log("Building renderDistanceInfo for " + newRenderDistance.toFixed(1));
      lastSeenRenderDistance = newRenderDistance;
      
      // The distance in chunk-lengths at which chunks are visible
      var chunkDistance = Math.ceil(newRenderDistance/CHUNKSIZE);
      
      // The squared distance at which chunks should be included.
      // The offset of CHUNKSIZE is to account for the origin of a chunk being at one corner.
      var boundSquared = Math.pow(newRenderDistance + CHUNKSIZE, 2);
      distanceInfoCache.addChunkDistanceSquared = boundSquared;

      // The distance at which invisible chunks are dropped from memory. Semi-arbitrary figure...
      distanceInfoCache.dropChunkDistanceSquared = Math.pow(newRenderDistance + 2*CHUNKSIZE, 2);

      // A static table of the offsets of the chunks visible from the player location
      var nearChunkOrder = [];
      for (var x = -chunkDistance-1; x <= chunkDistance; x++)
      for (var y = -chunkDistance-1; y <= chunkDistance; y++)
      for (var z = -chunkDistance-1; z <= chunkDistance; z++) {
        var v = [x*CHUNKSIZE,y*CHUNKSIZE,z*CHUNKSIZE];
        if (dist3sq(v, ZEROVEC) <= boundSquared) {
          nearChunkOrder.push(v);
        }
      }
      nearChunkOrder.sort(function (a,b) {
        return dist3sq(a, ZEROVEC) - dist3sq(b, ZEROVEC);
      });
      distanceInfoCache.nearChunkOrder = Object.freeze(nearChunkOrder);
    }
    return distanceInfoCache;
  }
  
  function WorldRenderer(world, getViewPosition, renderer, optAudio, scheduleDraw, showBoundaries) {
    var gl = renderer.context;
    var config = renderer.config; // TODO eliminate need for this
    
    // World properties cached and used by chunk calculation
    var wx = world.wx;
    var wy = world.wy;
    var wz = world.wz;
    var g = world.g;
    var rawBlocks = world.raw;
    var rawRotations = world.rawRotations;
    var rawLighting = world.rawLighting;
    var inBounds = world.inBounds;
    var lightOutside = world.lightOutside;
    
    // Table of all world rendering chunks which have RenderBundles created, indexed by [x,y,z] of the low-side coordinates (i.e. divisible by CHUNKSIZE).
    var chunks = new IntVectorMap();
    
    var nonemptyChunks = new IntVectorMap();

    function compareByPlayerDistance(a,b) {
      return dist3sq(a, playerChunk) - dist3sq(b, playerChunk);
    }

    // Queue of chunks to rerender. Array (first-to-do at the end); each element is [x,z] where x and z are the low coordinates of the chunk.
    var dirtyChunks = new DirtyQueue(compareByPlayerDistance);

    // Queue of chunks to render for the first time. Distinguished from dirtyChunks in that it can be flushed if the view changes.
    var addChunks = new DirtyQueue(compareByPlayerDistance);
    
    // The origin of the chunk which the player is currently in. Changes to this are used to decide to recompute chunk visibility.
    var playerChunk = null;
    
    // Like chunks, but for circuits. Indexed by the circuit origin block.
    var circuitRenderers = new IntVectorMap();

    var blockset = world.blockset;
    
    // Cached blockset characteristics
    var tileSize = blockset.tileSize;
    var pixelSize = 1/tileSize;
    var ID_EMPTY = BlockSet.ID_EMPTY;
    
    var particles = [];
    
    var boundaryR = new renderer.RenderBundle(gl.LINES, null, function (vertices, normals, colors) {
      function common() {
        normals.push(0, 0, 0);
        normals.push(0, 0, 0);
        colors.push(0.5,0.5,0.5, 1);
        colors.push(0.5,0.5,0.5, 1);
      }
      var extent = 20;
      
      var vec = [];
      for (var dim = 0; dim < 3; dim++) {
        var ud = mod(dim+1,3);
        var vd = mod(dim+2,3);
        for (var u = 0; u < 2; u++)
        for (var v = 0; v < 2; v++) {
          vec[ud] = [world.wx, world.wy, world.wz][ud]*u;
          vec[vd] = [world.wx, world.wy, world.wz][vd]*v;
          vec[dim] = -extent;
          vertices.push(vec[0],vec[1],vec[2]);
          vec[dim] = [world.wx, world.wy, world.wz][dim] + extent;
          vertices.push(vec[0],vec[1],vec[2]);
          common();
        }
      }
    }, {aroundDraw: function (draw) {
      renderer.setLineWidth(1);
      draw();
    }});

    var textureDebugR = new renderer.RenderBundle(
        gl.TRIANGLE_STRIP,
        function () { return blockset.getRenderData(renderer).texture; },
        function (vertices, normals, texcoords) {
      var x = 1;
      var y = 1;
      var z = 0;
      vertices.push(-x, -y, z);
      vertices.push(x, -y, z);
      vertices.push(-x, y, z);
      vertices.push(x, y, z);
      
      normals.push(0,0,0);
      normals.push(0,0,0);
      normals.push(0,0,0);
      normals.push(0,0,0);

      texcoords.push(0, 1);
      texcoords.push(1, 1);
      texcoords.push(0, 0);
      texcoords.push(1, 0);
    }, {
      aroundDraw: function (draw) {
        var restoreView = renderer.saveView();
        renderer.setViewTo2D();
        gl.disable(gl.DEPTH_TEST); // TODO should be handled by renderer?
        gl.depthMask(false);
        draw();
        restoreView();
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
      }
    });
    
    var blockset = world.blockset;
    var textured = blockset.textured;
    
    // --- methods, internals ---
    
    function deleteChunks() {
      chunks.forEach(function (chunk) {
        chunk.deleteResources();
      });
      circuitRenderers.forEach(function (cr) {
        cr.deleteResources();
      });
      
      chunks = new IntVectorMap();
      nonemptyChunks = new IntVectorMap();
      circuitRenderers = new IntVectorMap();
      dirtyChunks.clear();
      addChunks.clear();
    }
    
    function rerenderChunks() {
      dirtyChunks.clear();
      chunks.forEach(function (chunk, coords) {
        chunk.dirtyChunk = true;
        dirtyChunks.enqueue(coords, chunk);
      });
    }
    
    var listenerBlockset = {
      interest: isAlive,
      // TODO: Optimize by rerendering only if render data (not just texture image) changed, and only
      // chunks containing the changed block ID?
      texturingChanged: dirtyAll,
      tableChanged: dirtyAll
    }
    
    var listenerRenderDistance = {
      interest: isAlive,
      changed: function (v) {
        playerChunk = null; // TODO kludge. The effect of this is to reevaluate which chunks are visible
        addChunks.clear();
        scheduleDraw();
      }
    };

    var listenerRedraw = {
      interest: isAlive,
      changed: function (v) {
        scheduleDraw();
      }
    }

    function deleteResources() {
      deleteChunks();
      textureDebugR.deleteResources();
      world.listen.cancel(listenerWorld);
      blockset.listen.cancel(listenerBlockset);
      config.renderDistance.listen.cancel(listenerRenderDistance);
      world = blockset = chunks = nonemptyChunks = dirtyChunks = addChunks = textureDebugR = null;
    };
    function isAlive() {
      // Are we still interested in notifications etc?
      return !!world;
    }
    this.deleteResources = deleteResources;

    function chunkIntersectsWorld(chunkOrigin) {
      var x = chunkOrigin[0];
      var y = chunkOrigin[1];
      var z = chunkOrigin[2];
      return x >= 0 && x - CHUNKSIZE < world.wx &&
             y >= 0 && y - CHUNKSIZE < world.wy &&
             z >= 0 && z - CHUNKSIZE < world.wz;
    }

    // x,z must be multiples of CHUNKSIZE
    function setDirtyChunk(x, y, z) {
      var k = [x, y, z];
      if (!chunkIntersectsWorld(k)) return;
      var chunk = chunks.get(k);
      if (chunk) {
        // This routine is used only for "this block changed", so if there is
        // not already a chunk, we don't create it.
        chunk.dirtyChunk = true;
        dirtyChunks.enqueue(k, chunk);
      }
    }

    // entry points for change listeners
    function dirtyBlock(vec) {
      if (!isAlive()) return;
      
      var x = vec[0];
      var y = vec[1];
      var z = vec[2];
      
      var xm = mod(x, CHUNKSIZE);
      var ym = mod(y, CHUNKSIZE);
      var zm = mod(z, CHUNKSIZE);
      x -= xm;
      y -= ym;
      z -= zm;
      
      setDirtyChunk(x,y,z);
      if (xm == 0)           setDirtyChunk(x-CHUNKSIZE,y,z);
      if (ym == 0)           setDirtyChunk(x,y-CHUNKSIZE,z);
      if (zm == 0)           setDirtyChunk(x,y,z-CHUNKSIZE);
      if (xm == CHUNKSIZE-1) setDirtyChunk(x+CHUNKSIZE,y,z);
      if (ym == CHUNKSIZE-1) setDirtyChunk(x,y+CHUNKSIZE,z);
      if (zm == CHUNKSIZE-1) setDirtyChunk(x,y,z+CHUNKSIZE);
      
      // TODO: This is actually "Schedule updateSomeChunks()" and shouldn't actually require a frame redraw
      scheduleDraw();
    }

    function dirtyAll() {
      if (!isAlive()) return;
      rerenderChunks();
    }

    function dirtyCircuit(circuit) {
      if (!isAlive()) return;
      var o = circuit.getOrigin();
      var r = circuitRenderers.get(o);
      if (r) {
        r.recompute();
      } else {
        addCircuits();
      }
    }
    
    function deletedCircuit(circuit) {
      if (!isAlive()) return;
      circuitRenderers.delete(circuit.getOrigin());
    }

    var listenerWorld = {
      interest: isAlive,
      dirtyBlock: dirtyBlock,
      dirtyAll: dirtyAll,
      dirtyCircuit: dirtyCircuit,
      deletedCircuit: deletedCircuit,
      audioEvent: function (position, type, kind) {
        if (!isAlive()) return;
        if (optAudio) optAudio.play(position, type, kind, 1);
      }
    };
    
    function addCircuits() {
      // Add circuits which are in viewing distance.
      // Note: This enumerates every circuit in the world. Currently, this is more efficient than the alternatives because there are not many circuits in typical data. When that changes, we should revisit this and use some type of spatial index to make it efficient. Testing per-block is *not* efficient.
      if (!playerChunk) return;
      var renderDistance = config.renderDistance.get();
      var rdi = renderDistanceInfo(renderDistance);
      world.getCircuits().forEach(function (circuit, origin) {
        if (dist3sq(origin, playerChunk) < rdi.addChunkDistanceSquared) {
          if (!circuitRenderers.get(origin)) {
            circuitRenderers.set(origin, makeCircuitRenderer(circuit));
          }
        }
      });
    }
    
    function updateSomeChunks() {
      // Determine if chunks' visibility to the player has changed
      var rdi = renderDistanceInfo(config.renderDistance.get());
      var pos = getViewPosition();
      var newPlayerChunk = [pos[0] - mod(pos[0], CHUNKSIZE),
                            pos[1] - mod(pos[1], CHUNKSIZE),
                            pos[2] - mod(pos[2], CHUNKSIZE)];
      if (playerChunk === null || newPlayerChunk[0] !== playerChunk[0]
                               || newPlayerChunk[1] !== playerChunk[1]
                               || newPlayerChunk[2] !== playerChunk[2]) {
        //console.log("nPC ", newPlayerChunk[0], newPlayerChunk[1], newPlayerChunk[2]);
        
        playerChunk = newPlayerChunk;
        
        // Add chunks which are in viewing distance.
        rdi.nearChunkOrder.forEach(function (offset) {
          var chunkKey = [playerChunk[0] + offset[0], playerChunk[1] + offset[1], playerChunk[2] + offset[2]];
          if (!chunks.has(chunkKey) && chunkIntersectsWorld(chunkKey)) {
            addChunks.enqueue(chunkKey, chunks.get(chunkKey));
          }
        });

        // Drop now-invisible chunks. Has a higher boundary so that we're not constantly reloading chunks if the player is moving back and forth.
        var dds = rdi.dropChunkDistanceSquared;
        chunks.forEach(function (chunk, chunkKey) {
          if (dist3sq(chunkKey, playerChunk) > dds) {
            chunk.deleteResources();
            chunks.delete(chunkKey);
            nonemptyChunks.delete(chunkKey);
          }
        });
        
        addCircuits();
        
        // Drop now-invisible circuits
        // TODO: This works off the origin, but circuits can be arbitrarily large so we should test against their AABB
        circuitRenderers.forEach(function (cr, cube) {
          if (dist3sq(cube, playerChunk) > dds) {
            cr.deleteResources();
            circuitRenderers.delete(cube);
          }
        });
      }
      
      // Update chunks from the queues.
      var deadline = Date.now() + (addChunks.size() > 30 ? 30 : 10);
      var count = 0;
      // Chunks to add
      while (addChunks.size() > 0 && Date.now() < deadline) {
        if (!calcChunk(addChunks.dequeue())) {
          count++;
        }
      }
      // Dirty chunks (only if visible)
      while (dirtyChunks.size() > 0 && Date.now() < deadline) {
        var chunkKey = dirtyChunks.dequeue();
        if (chunks.has(chunkKey)) {
          if (!calcChunk(chunkKey)) {
            count++;
          }
        }
      }
      measuring.chunkCount.inc(count);
      
      if (addChunks.size() > 0 || dirtyChunks.size() > 0) {
        // Schedule rendering more chunks
        scheduleDraw();
      }
    }
    this.updateSomeChunks = updateSomeChunks;

    function renderDestroyBlock(block) {
      particles.push(new renderer.BlockParticles(
        block,
        tileSize,
        world.gtv(block),
        true,
        world.gRotv(block)));
    }
    this.renderDestroyBlock = renderDestroyBlock;

    function renderCreateBlock(block) {
      particles.push(new renderer.BlockParticles(
        block,
        tileSize,
        world.gtv(block),
        false,
        world.gRotv(block)));
    }
    this.renderCreateBlock = renderCreateBlock;
    
    

    function draw() {
      // Draw chunks.
      renderer.setTileSize(blockset.tileSize);
      nonemptyChunks.forEach(function (chunk) {
        if (renderer.aabbInView(chunk.aabb))
          chunk.draw();
      });
      
      // Draw circuits.
      circuitRenderers.forEach(function (cr) {
        cr.draw();
      });
      
      
      // Draw particles.
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
      
      if (showBoundaries) {
        boundaryR.draw();
      }

      // Draw texture debug.
      if (config.debugTextureAllocation.get()) {
        textureDebugR.draw();
      }
    }
    this.draw = draw;
    
    var renderData; // updated as needed by chunk recalculate

    // returns whether no work was done
    function calcChunk(chunkKey) {
      // This would call scheduleDraw() to render the revised chunks, except that calcChunk is only called within a draw. Therefore, the calls are commented out (to be reenabled if the architecture changes).
      var c = chunks.get(chunkKey);
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
        chunks.set(chunkKey, makeChunk(chunkKey));
        return false;
      }
    }
    
    function makeChunk(chunkKey) {
      var chunkOriginX = chunkKey[0];
      var chunkOriginY = chunkKey[1];
      var chunkOriginZ = chunkKey[2];
      var chunkLimitX = Math.min(wx, chunkOriginX + CHUNKSIZE);
      var chunkLimitY = Math.min(wy, chunkOriginY + CHUNKSIZE);
      var chunkLimitZ = Math.min(wz, chunkOriginZ + CHUNKSIZE);
      var nonempty = false;

      var lightTexture;
      var mustRebuild = function () { return true; };
      var ltData = new Uint8Array(LIGHT_TEXTURE_SIZE*LIGHT_TEXTURE_SIZE*LIGHT_TEXTURE_SIZE);
      for (var i = 0; i < ltData.length; i++) {
        ltData[i] = 127;
      }
      
      var chunk = new renderer.RenderBundle(gl.TRIANGLES,
                                            function () { return renderData.texture; },
                                            function (vertices, normals, texcoords) {
        measuring.chunk.start();
        renderData = blockset.getRenderData(renderer);
        var rotatedBlockFaceData = renderData.rotatedBlockFaceData;
        var BOGUS_BLOCK_DATA = rotatedBlockFaceData.bogus;
        var types = renderData.types;
        var opaques = types.map(function (t) { return t.opaque; });
        
        // these variables are used by face() and written by the loop
        var x,y,z;
        var thisOpaque;
        var rawIndex;
        
        function face(vFacing, data) {
          var fx = vFacing[0]; var xfx = x + fx;
          var fy = vFacing[1]; var yfy = y + fy;
          var fz = vFacing[2]; var zfz = z + fz;
          // TODO between the g() and the inBounds() we're testing the neighbor twice
          if (thisOpaque && opaques[g(xfx,yfy,zfz)]) {
            // this face is invisible
            return;
          } else {
            var faceVertices = data.vertices;
            var faceTexcoords = data.texcoords;
            var vl = faceVertices.length / 3;
            for (var i = 0; i < vl; i++) {
              var vi = i*3;
              var ti = i*2;
              vertices.push(faceVertices[vi  ]+x,
                            faceVertices[vi+1]+y,
                            faceVertices[vi+2]+z);
              texcoords.push(faceTexcoords[ti], faceTexcoords[ti+1]);
              normals.push(fx, fy, fz);
            }
          }
        }
        
        for (x = chunkOriginX; x < chunkLimitX; x++)
        for (y = chunkOriginY; y < chunkLimitY; y++)
        for (z = chunkOriginZ; z < chunkLimitZ; z++) {
          // raw array access inlined and simplified for efficiency
          rawIndex = (x*wy+y)*wz+z;
          var value = rawBlocks[rawIndex];
          if (value === ID_EMPTY) continue;
          
          var rotIndex = rawRotations[rawIndex];
          var rot = rotationsByCode[rotIndex];
          var btype = types[value];
          var faceData = (rotatedBlockFaceData[value] || BOGUS_BLOCK_DATA)[rotIndex];
          thisOpaque = opaques[value];
          
          face(rot.nx, faceData.lx);
          face(rot.ny, faceData.ly);
          face(rot.nz, faceData.lz);
          face(rot.px, faceData.hx);
          face(rot.py, faceData.hy);
          face(rot.pz, faceData.hz);
        }
        
        for (x = chunkOriginX - 1; x <= chunkLimitX; x++)
        for (y = chunkOriginY - 1; y <= chunkLimitY; y++)
        for (z = chunkOriginZ - 1; z <= chunkLimitZ; z++) {
          var ltIndex = ( (  mod(x, LIGHT_TEXTURE_SIZE) *LIGHT_TEXTURE_SIZE
                           + mod(y, LIGHT_TEXTURE_SIZE))*LIGHT_TEXTURE_SIZE
                         +   mod(z, LIGHT_TEXTURE_SIZE));
          if (inBounds(x,y,z)) {
            rawIndex = (x*wy+y)*wz+z;
            ltData[ltIndex] = rawLighting[rawIndex];
          } else {
            ltData[ltIndex] = lightOutside;
          }
        }
        
        // Update lighting texture
        if (mustRebuild()) {
          lightTexture = gl.createTexture();
          mustRebuild = renderer.currentContextTicket();
          gl.bindTexture(gl.TEXTURE_2D, lightTexture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, lightTexture);
        }
        gl.texImage2D(gl.TEXTURE_2D,
                      0, // level
                      gl.LUMINANCE, // internalformat
                      LIGHT_TEXTURE_SIZE, // width
                      LIGHT_TEXTURE_SIZE*LIGHT_TEXTURE_SIZE, // height
                      0, // border
                      gl.LUMINANCE, // format
                      gl.UNSIGNED_BYTE, // type
                      ltData);
        gl.bindTexture(gl.TEXTURE_2D, null);
                
        var wasNonempty = nonempty;
        nonempty = vertices.length > 0;
        if (nonempty !== wasNonempty) {
          if (nonempty) {
            nonemptyChunks.set(chunkKey, chunk);
          } else {
            nonemptyChunks.delete(chunkKey);
          }
        }
        
        measuring.chunk.end();
      }, {
        aroundDraw: function (draw) {
          renderer.setLightTexture(lightTexture);
          draw();
        }
      });
      
      // This is needed because when the calc function is first called by constructing the RenderBundle, 'chunk' has not yet been assigned.
      if (nonempty)
        nonemptyChunks.set(chunkKey, chunk);
      
      chunk.aabb = new AAB(
        chunkOriginX, chunkLimitX,
        chunkOriginY, chunkLimitY,
        chunkOriginZ, chunkLimitZ
      );
      
      return chunk;
    }
    
    var CYL_RESOLUTION = 9;
    function calcCylinder(pt1, pt2, radius, vertices, normals) {
      function pushVertex(vec) {
        vertices.push(vec[0], vec[1], vec[2]);
        normals.push(0,0,0);
      }
      //function pushNormal(vec) {
      //  normals.push(vec[0], vec[1], vec[2]);
      //}
      
      var length = vec3.subtract(pt2, pt1, vec3.create());
      var perp1 = vec3.cross(length, length[1] ? UNIT_PX : UNIT_PY, vec3.create());
      var perp2 = vec3.cross(perp1, length, vec3.create());
      vec3.normalize(perp1);
      vec3.normalize(perp2);
      function incr(i, r) {
        return vec3.add(
          vec3.scale(perp1, Math.sin(i/10*Math.PI*2), vec3.create()),
          vec3.scale(perp2, Math.cos(i/10*Math.PI*2), vec3.create()));
      }
      for (var i = 0; i < CYL_RESOLUTION; i++) {
        var p1 = incr(i);
        var p2 = incr(mod(i+1, CYL_RESOLUTION));
        //pushNormal(p2);
        //pushNormal(p2);
        //pushNormal(p1);
        //pushNormal(p1);
        //pushNormal(p1);
        //pushNormal(p2);
        vec3.scale(p1, radius);
        vec3.scale(p2, radius);
        var v0 = vec3.add(pt1, p2, vec3.create());
        var v1 = vec3.add(pt2, p2, vec3.create());
        var v2 = vec3.add(pt2, p1, vec3.create());
        var v3 = vec3.add(pt1, p1, vec3.create());
        pushVertex(v0);
        pushVertex(v1);
        pushVertex(v2);
        pushVertex(v2);
        pushVertex(v3);
        pushVertex(v0);
      }
      return 6*CYL_RESOLUTION;
    }
    
    var CENTER = [.5,.5,.5];
    var CYL_RADIUS = Math.round(.08 * tileSize) / tileSize;
    function makeCircuitRenderer(circuit) {
      var dyns;
      var circuitRenderer = new renderer.RenderBundle(gl.TRIANGLES, null, function (vertices, normals, colors) {
        dyns = [];
        circuit.getEdges().forEach(function (record) {
          var net = record[0];
          var fromBlock = record[1];
          var block = record[2];

          var vbase = vertices.length;
          var cbase = colors.length;
          var numVertices = calcCylinder(
            vec3.add(record[1], CENTER, vec3.create()),
            vec3.add(record[2], CENTER, vec3.create()),
            .1,
            vertices, normals);
          for (var i = 0; i < numVertices; i++)
            colors.push(1,1,1,1); 
            
          dyns.push(function () {
            var carr = circuitRenderer.colors.array;
            var value = circuit.getNetValue(net);
            var color;
            var alpha = 0.5;
            if (value === null || value === undefined) {
              color = [0,0,0,alpha];
            } else if (value === false) {
              color = [0,0,0.2,alpha];
            } else if (value === true) {
              color = [0.2,0.2,1,alpha];
            } else if (typeof value === 'number') {
              // TODO: represent negatives too
              if (value <= 1)
                color = [value, 0, 0, alpha];
              else
                color = [1, 1 - (1/value), 0, alpha];
            } else {
              color = [1,1,1,alpha];
            }
            for (var i = 0, p = cbase; i < numVertices; i++) {
              carr[p++] = color[0];
              carr[p++] = color[1];
              carr[p++] = color[2];
              carr[p++] = color[3];
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
    
    // For info/debug displays
    function chunkRendersToDo() {
      return dirtyChunks.size() + addChunks.size();
    }
    this.chunkRendersToDo = chunkRendersToDo;

    // --- init ---

    world.listen(listenerWorld);
    blockset.listen(listenerBlockset);
    config.renderDistance.listen(listenerRenderDistance);
    config.debugTextureAllocation.listen(listenerRedraw);
    Object.freeze(this);
  }
  
  WorldRenderer.LIGHT_TEXTURE_SIZE = LIGHT_TEXTURE_SIZE; // exposed for shader

  return WorldRenderer;
}());;

