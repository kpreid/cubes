// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

(function () {
  "use strict";
  
  var AAB = cubes.util.AAB;
  var Circuit = cubes.Circuit;
  var Blockset = cubes.Blockset;
  var DirtyQueue = cubes.util.DirtyQueue;
  var IntVectorMap = cubes.util.IntVectorMap;
  var measuring = cubes.measuring;
  var mod = cubes.util.mod;
  var Notifier = cubes.util.Notifier;
  var Persister = cubes.storage.Persister;
  var signum = cubes.util.signum;
  
  var spontaneousBaseRate = 0.0003; // probability of block spontaneous effect call per block per second
  
  var LIGHT_MAX = 255;
  var LIGHT_SCALE = 4/LIGHT_MAX;
  var LIGHT_SKY = Math.round(1/LIGHT_SCALE);
  var MAX_LIGHTING_QUEUE = 3000;
  
  // not physically based but DWIM - we want lights to have significant contribution but non-lights not to be too shadowing. TODO make it block-analysis-based?
  var transparentLightSourceCoverage = 0.5;
  var transparentBlockCoverage = 0.15;
  
  var lightRays = [];
  (function () {
    for (var dim = 0; dim < 3; dim++)
    for (var dir = -1; dir <= 1; dir += 2) {
      var origin = [0.5,0.5,0.5];
      origin[dim] += dir * -0.25;
      var reflectFace = [0,0,0];
      reflectFace[dim] = -dir;
      var raysForDir = [];
      for (var rayx = -1; rayx <= 1; rayx += 1)
      for (var rayy = -1; rayy <= 1; rayy += 1) {
        var ray = vec3.create();
        ray[dim] = 0.1*dir;
        ray[mod(dim + 1, 3)] = 0.1*rayx;
        ray[mod(dim + 2, 3)] = 0.1*rayy;
        raysForDir.push({origin: origin, direction: ray});
      }
      lightRays.push({reflectFace:reflectFace, rays:raysForDir});
    }
  }());
  
  function isCircuitPart(type) {
    return !!type.behavior;
  }
  
  function intbound(s, ds) {
    // Find the smallest positive t such that s+t*ds is an integer.
    if (ds < 0) {
      return intbound(-s, -ds);
    } else {
      s = mod(s, 1);
      // problem is now s+t*ds = 1
      return (1-s)/ds;
    }
  }
  
  function World(sizes, blockset) {
    if (!blockset) {
      // early catch of various mistakes that can lead to this
      throw new Error("missing Blockset for new World");
    }
    
    var self = this;
    
    var wx = sizes[0];
    var wy = sizes[1];
    var wz = sizes[2];
    if (wx !== Math.floor(wx) || wx !== Math.floor(wx) || wx !== Math.floor(wx)) {
      // early catch of various mistakes that can lead to this
      throw new Error("invalid size for new World: " + vec3.str(sizes));
    }
    var cubeCount = wx * wy * wz;

    // Persistent data arrays.
    var blocks = new Uint8Array(cubeCount);
    var subData = new Uint8Array(cubeCount);
    var lighting = new Uint8Array(cubeCount);
    
    // Computed data arrays.
    var rotations = new Uint8Array(cubeCount);
    
    // Maps from cube to its circuit object if any
    var blockCircuits = new IntVectorMap();
    
    // Maps from an arbitrary cube in each circuit to that circuit (no duplicates)
    var circuits = new IntVectorMap();
    
    // Blocks which are to be modified according to circuit outputs
    var effects = new IntVectorMap();
    
    // Blocks which a body is touching. Values are of the form {facevector: true}.
    var contacts = new IntVectorMap();
    
    var bodies = [];
    
    var numToDisturbPerSec = cubeCount * spontaneousBaseRate;
    
    var lightingUpdateQueue = new DirtyQueue(function (a,b) { return a.priority - b.priority; });
    
    var notifier = new Notifier("World");
    
    this.persistence = new Persister(this);
    
    // --- Internal functions ---
    
    function deleteCircuit(circuit) {
      circuit.blocks.forEach(function (block) {
        circuits.delete(block);
        blockCircuits.delete(block);
      });
      
      notifier.notify("deletedCircuit", circuit);
    }
    
    function touchedCircuit(circuit) {
      if (circuits.get(circuit.getOrigin()) !== circuit) {
        // This is a check for trouble in the circuit fill logic
        if (typeof console !== "undefined")
          console.warn("Unindexed circuit at " + circuit.getOrigin() + "!");
      }
      circuit.compile();
      circuit.refreshLocal();
      notifier.notify("dirtyCircuit", circuit);
    }
    
    // Flood-fill additional circuit parts adjacent to 'start'
    function floodCircuit(circuit, start) {
      if (!circuit) throw new Error("floodCircuit not given a circuit");
      var q = [start.slice()];
      
      var block;
      while ((block = q.pop())) {
        if (isCircuitPart(gt(block[0],block[1],block[2]))) {
          var existing = blockCircuits.get(block);
          if (existing === circuit) {
            continue; // don't add and don't traverse
          } else if (existing !== circuit && existing !== undefined) {
            deleteCircuit(existing);
          }
          circuit.add(block);
          blockCircuits.set(block, circuit);
          
          for (var dim = 0; dim < 3; dim++) {
            var b2 = block.slice();
            b2[dim]++;
            q.push(b2);
            b2 = block.slice();
            b2[dim]--;
            q.push(b2);
          }
        }
      }
      
      touchedCircuit(circuit);
    }
    
    function becomeCircuit(block) {
      var x = block[0];
      var y = block[1];
      var z = block[2];

      var adjCircuits = [blockCircuits.get([x-1,y,z]),
                         blockCircuits.get([x,y-1,z]),
                         blockCircuits.get([x,y,z-1]),
                         blockCircuits.get([x+1,y,z]),
                         blockCircuits.get([x,y+1,z]),
                         blockCircuits.get([x,y,z+1])];
      var circuit;
      adjCircuits.forEach(function (c) {
        if (!c) return;
        if (!circuit) {
          circuit = c;
        }
      });
      if (!circuit) {
        circuit = new Circuit(self);
        circuits.set(block, circuit);
      }
      floodCircuit(circuit, block);
    }
    
    // --- Methods ---
    
    // Return the block ID at the given coordinates
    function gv(v) { return g(v[0], v[1], v[2]); }
    function g(x,y,z) {
      if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
        return 0;
      else
        return blocks[x*wy*wz + y*wz + z];
    }
    // Return the block type at the given coordinates
    function gtv(v) { return gt(v[0], v[1], v[2]); }
    function gt(x,y,z) {
      return blockset.get(g(x,y,z));
    }
    // Return the block subdatum at the given coordinates
    function gSubv(v) { return gSub(v[0], v[1], v[2]); }
    function gSub(x,y,z) {
      if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
        return 0;
      else
        return subData[x*wy*wz + y*wz + z];
    }
    // Return the block rotation at the given coordinates
    function gRotv(v) { return gRot(v[0], v[1], v[2]); }
    function gRot(x,y,z) {
      if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
        return 0;
      else
        return rotations[x*wy*wz + y*wz + z];
    }
    // Return the block lighting value at the given coordinates
    function gLightv(v) { return gLight(v[0], v[1], v[2]); }
    function gLight(x,y,z) {
      if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
        return LIGHT_SKY;
      else
        return lighting[x*wy*wz + y*wz + z];
    }
    function sv(v,val,subdatum) { return s(v[0], v[1], v[2], val, subdatum); }
    function s(x,y,z,val,subdatum) {
      if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
        return;
      
      var index = (x*wy + y)*wz + z;
      
      if (blocks[index] === val && subData[index] === +subdatum)
        return;
        
      blocks[index] = val;
      subData[index] = subdatum;

      handleSet([x,y,z]);
    }
    // Perform the side-effects of a block modification.
    // This is split so that synchronized changes don't do partial updates
    // vec must not be mutated
    function handleSet(vec) {
      var x = vec[0];
      var y = vec[1];
      var z = vec[2];
      var val = blocks[(x*wy + y)*wz + z];
      var neighbors = [[x-1,y,z], [x,y-1,z], [x,y,z-1], [x+1,y,z], [x,y+1,z], [x,y,z+1]];
      
      var newType = blockset.get(val);
      reeval(vec, newType);
      queueLightAt(x,y,z);
      
      // Update circuits
      var cp = isCircuitPart(newType);
      if (cp) {
        var circuit = blockCircuits.get(vec);
        if (circuit) {
          touchedCircuit(circuit);
        } else {
          becomeCircuit(vec);
        }
      } else if (!cp && blockCircuits.has(vec)) {
        // No longer a circuit part.
        deleteCircuit(blockCircuits.get(vec));
        neighbors.forEach(function (neighbor) {
          if (isCircuitPart(gt(neighbor[0],neighbor[1],neighbor[2]))) becomeCircuit(neighbor);
        });
      }
      
      // Update neighbors, which may have circuit inputs depending on this block
      neighbors.forEach(function (neighbor) {
        reeval(neighbor, gt(neighbor[0],neighbor[1],neighbor[2]));
        queueLightAt(neighbor[0], neighbor[1], neighbor[2]);
        
        // note: this duplicates work if the same circuit neighbors this block more than once
        var circuit = blockCircuits.get(neighbor);
        if (circuit) {
          circuit.refreshLocal();
        }
      });
      
      notifier.notify("dirtyBlock", vec);
      self.persistence.dirty();
    }
    function sSubv(v, s) { return sSub(v[0], v[1], v[2], s); }
    function sSub(x,y,z,subdatum) {
      s(x,y,z,g(x,y,z),subdatum);
    }
    function opaquev(v) { return opaque(v[0], v[1], v[2]); }
    function opaque(x,y,z) {
      return gt(x,y,z).opaque;
    }
    function selectablev(v) { return selectable(v[0], v[1], v[2]); }
    function selectable(x,y,z) {
      return g(x,y,z) !== 0;
    }
    function inBoundsv(v) { return inBounds(v[0], v[1], v[2]); }
    function inBounds(x,y,z) {
      return !(x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz);
    }
    
    /**
     * Call the callback with (x,y,z,value,face) of all blocks along the line
     * segment from point 'origin' in vector direction 'direction' of length
     * 'radius'. 'radius' may be infinite.
     * 
     * 'face' is the normal vector of the face of that block that was entered.
     * It should not be used after the callback returns.
     * 
     * If the callback returns a true value, the traversal will be stopped.
     */
    function raycast(origin, direction, radius, callback) {
      // From "A Fast Voxel Traversal Algorithm for Ray Tracing"
      // by John Amanatides and Andrew Woo, 1987
      // <http://www.cse.yorku.ca/~amana/research/grid.pdf>
      // <http://citeseer.ist.psu.edu/viewdoc/summary?doi=10.1.1.42.3443>
      // Extensions to the described algorithm:
      //   • Imposed a distance limit.
      //   • The face passed through to reach the current cube is provided to
      //     the callback.
      
      // The foundation of this algorithm is a parameterized representation of
      // the provided ray,
      //                    origin + t * direction,
      // except that t is not actually stored; rather, at any given point in the
      // traversal, we keep track of the *greater* t values which we would have
      // if we took a step sufficient to cross a cube boundary along that axis
      // (i.e. change the integer part of the coordinate) in the variables
      // tMaxX, tMaxY, and tMaxZ.
      
      // Cube containing origin point.
      var x = Math.floor(origin[0]);
      var y = Math.floor(origin[1]);
      var z = Math.floor(origin[2]);
      // Break out direction vector.
      var dx = direction[0];
      var dy = direction[1];
      var dz = direction[2];
      // Direction to increment x,y,z when stepping.
      var stepX = signum(dx);
      var stepY = signum(dy);
      var stepZ = signum(dz);
      // See description above. The initial values depend on the fractional
      // part of the origin.
      var tMaxX = intbound(origin[0], dx);
      var tMaxY = intbound(origin[1], dy);
      var tMaxZ = intbound(origin[2], dz);
      // The change in t when taking a step (always positive).
      var tDeltaX = stepX/dx;
      var tDeltaY = stepY/dy;
      var tDeltaZ = stepZ/dz;
      // Buffer for reporting faces to the callback.
      var face = vec3.create();
      
      // Avoids an infinite loop.
      if (dx === 0 && dy === 0 && dz === 0)
        throw new RangeError("Raycast in zero direction!");
      
      // Rescale from units of 1 cube-edge to units of 'direction' so we can
      // compare with 't'.
      radius /= Math.sqrt(dx*dx+dy*dy+dz*dz);
      
      while (/* ray has not gone past bounds of world */
             (stepX > 0 ? x < wx : x >= 0) &&
             (stepY > 0 ? y < wy : y >= 0) &&
             (stepZ > 0 ? z < wz : z >= 0)) {
        
        // Invoke the callback, unless we are not *yet* within the bounds of the
        // world.
        if (!(x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz))
          if (callback(x, y, z, blocks[x*wy*wz + y*wz + z], face))
            break;
        
        // tMaxX stores the t-value at which we cross a cube boundary along the
        // X axis, and similarly for Y and Z. Therefore, choosing the least tMax
        // chooses the closest cube boundary. Only the first case of the four
        // has been commented in detail.
        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) {
            if (tMaxX > radius) break;
            // Update which cube we are now in.
            x += stepX;
            // Adjust tMaxX to the next X-oriented boundary crossing.
            tMaxX += tDeltaX;
            // Record the normal vector of the cube face we entered.
            face[0] = -stepX;
            face[1] = 0;
            face[2] = 0;
          } else {
            if (tMaxZ > radius) break;
            z += stepZ;
            tMaxZ += tDeltaZ;
            face[0] = 0;
            face[1] = 0;
            face[2] = -stepZ;
          }
        } else {
          if (tMaxY < tMaxZ) {
            if (tMaxY > radius) break;
            y += stepY;
            tMaxY += tDeltaY;
            face[0] = 0;
            face[1] = -stepY;
            face[2] = 0;
          } else {
            // Identical to the second case, repeated for simplicity in
            // the conditionals.
            if (tMaxZ > radius) break;
            z += stepZ;
            tMaxZ += tDeltaZ;
            face[0] = 0;
            face[1] = 0;
            face[2] = -stepZ;
          }
        }
      }
    }
    
    function edit(func) {
      for (var x = 0; x < wx; x++) {
        var xbase = x*wy*wz;
        for (var y = 0; y < wy; y++) {
          var ybase = xbase + y*wz;
          for (var z = 0; z < wz; z++) {
            var index = ybase + z;
            blocks[index] = func(x,y,z,blocks[index]);
            subData[index] = 0;
          }
        }
      }
      self.notifyRawEdit();
    }
    
    // Perform actions related to block circuits immediately after a change
    function reeval(cube, newType) {
      var x = cube[0];
      var y = cube[1];
      var z = cube[2];
      var index = x*wy*wz + y*wz + z;
      if (newType.hasCircuits) {
        queueEffects(Circuit.executeCircuitInBlock(newType.world, self, cube, subData[index], null));
        
      } else {
        rotations[index] = 0;
      }
      measuring.blockEvals.inc(1);
    }
    
    function queueEffects(addEffects) {
      addEffects.forEach(function (record) {
        var cube = record[0];
        var effect = record[1];
        if (!inBoundsv(cube)) return;
        var list = effects.get(cube);
        if (!list) effects.set(cube, list = []);
        list.push(effect);
      });
    }
    
    // Called by clients which modify the raw state arrays
    function notifyRawEdit() {
      var x, y, z, xbase, ybase;
      var vec = [0,0,0];
      var types = blockset.getAll();
      
      // Rebuild world circuits and reeval block circuits
      notifier.notify("dirtyAll");
      self.persistence.dirty();
      
      blockCircuits = new IntVectorMap(); // TODO clear op instead of replacing objects?
      circuits = new IntVectorMap();
      
      for (x = 0; x < wx; x++) {
        vec[0] = x;
        xbase = x*wy*wz;
        for (y = 0; y < wy; y++) {
          vec[1] = y;
          ybase = xbase + y*wz;
          for (z = 0; z < wz; z++) {
            vec[2] = z;
            reeval(vec, types[blocks[ybase + z]]);
          }
        }
      }
      
      // In-block circuits (handled by reeval) determine rotations, which determine in-this-world circuit connectivity, so all floodCircuit must happen after all reeval.
      for (x = 0; x < wx; x++) {
        vec[0] = x;
        xbase = x*wy*wz;
        for (y = 0; y < wy; y++) {
          vec[1] = y;
          ybase = xbase + y*wz;
          for (z = 0; z < wz; z++) {
            vec[2] = z;
            var value = blocks[ybase + z];
            if (isCircuitPart(types[value]) && !blockCircuits.get(vec)) {
              var circuit = new Circuit(self);
              circuits.set(vec, circuit);
              floodCircuit(circuit, vec);
            }
          }
        }
      }
    }
    
    function step(timestep) {
      // Handle delayed effects ("become") — first update everything, then
      // perform reactions.
      
      // Save current effect buffer and start new one, in case of effects caused
      // by these updates.
      var curEffects = effects;
      effects = new IntVectorMap(); // for effects caused by these updates
      // Apply effects.
      curEffects.forEach(function (effectList, cube) {
        var index = (cube[0]*wy + cube[1])*wz + cube[2];

        var effect = effectList[0];
        var newID = effect[0];
        var newSubdatum = effect[1] === undefined ? subData[index] : effect[1];
        var noConflict = true;
        for (var i = 1; i < effectList.length; i++) {
          effect = effectList[i];
          if (!(newID === effect[0] && (newSubdatum === effect[1] || effect[1] === undefined))) {
            noConflict = false;
            break;
          }
        }
        
        if (noConflict && (blocks[index] !== newID || subData[index] !== newSubdatum)) {
          blocks[index] = newID;
          subData[index] = newSubdatum;
          transientEvent(cube, "become");
        } else {
          curEffects.delete(cube); // inhibit update
        }
      });
      // Apply side-effects of effects.
      curEffects.forEach(function (effect, cube) {
        handleSet(cube);
      });
      
      // turn fractional part of number of iterations into randomness - 1.25 = 1 3/4 and 2 1/4 of the time
      var numToDisturb = numToDisturbPerSec * timestep;
      var roundedNum = Math.floor(numToDisturb) + (Math.random() < (numToDisturb % 1) ? 1 : 0);
      
      for (var i = 0; i < roundedNum; i++) {
        var x = Math.floor(Math.random() * wx);
        var y = Math.floor(Math.random() * wy);
        var z = Math.floor(Math.random() * wz);
        
        // The input value given is chosen so that if you want a rate of k, you can
        // multiply k*value to get the chance you should do your thing.
        // TODO: Maybe k should be an input to the spontaneous-event-detector circuit block?
        var type = gt(x,y,z);
        if (type.hasCircuits) {
          // TODO: this seems a bit overly coupled
          var cube = [x,y,z];
          queueEffects(Circuit.executeCircuitInBlock(type.world, self, cube, gSub(x,y,z), {
            blockIn_spontaneous: 1/spontaneousBaseRate
          }));
        }
      }
      
      evaluateLightsInQueue();
      
      var someBodyChanged = false;
      function signal() { someBodyChanged = true; }
      for (var bi = bodies.length - 1; bi >= 0; bi--) {
        var body = bodies[bi];
        body.step(timestep, signal);
      }
      if (someBodyChanged) {
        self.persistence.dirty();
        notifier.notify("bodiesChanged");
      }
    }
    
    function polishLightInVicinity(center, radius, count) {
      var lx = Math.max(center[0] - radius, 0);
      var ly = Math.max(center[1] - radius, 0);
      var lz = Math.max(center[2] - radius, 0);
      var rx = Math.min(center[0] + radius, wx) - lx;
      var ry = Math.min(center[1] + radius, wy) - ly;
      var rz = Math.min(center[2] + radius, wz) - lz;
      for (var i = 0; i < count; i++) {
        var x = Math.round(lx + Math.random() * rx);
        var y = Math.round(ly + Math.random() * ry);
        var z = Math.round(lz + Math.random() * rz);
        
        // Skip blocks which are empty and surrounded by emptiness and therefore irrelevant
        if (!(g(x,y,z) ||
              g(x-1,y,z) ||
              g(x+1,y,z) ||
              g(x,y+1,z) ||
              g(x,y-1,z) ||
              g(x,y,z+1) ||
              g(x,y,z-1))) continue;
        
        queueLightAt(x,y,z,LIGHT_MAX);
      }
    }
    
    function queueLightAt(x, y, z, priority) {
      if (lightingUpdateQueue.size() < MAX_LIGHTING_QUEUE) {
        var lqe = [x,y,z];
        lqe.priority = priority || 0;
        lightingUpdateQueue.enqueue(lqe);
      }
    }
    
    function evaluateLightsInQueue() {
      measuring.lightingQueueSize.inc(lightingUpdateQueue.size());
      
      var rayOrigin = vec3.create();
      var types = blockset.getAll();
      var opaques = types.map(function (t) { return t.opaque; });
      var here;
      
      // hoisted here so that it is only created once
      // NOTE: uses outer variables incomingLight, rayHits, found, rayAlpha
      function rayCallback(rx, ry, rz, id, face) {
        if (id === 0) {
          // empty air -- pass through
          return false;
        }
        var type = types[id];
        if (!opaques[id]) {
          // TODO: implement blocks with some opaque faces.
          var coverage = type.light > 0 ? transparentLightSourceCoverage : transparentBlockCoverage;
          incomingLight += rayAlpha * coverage * type.light/LIGHT_SCALE;
          rayAlpha *= 1 - coverage;
          rayHits.push([rx,ry,rz]);
          return false;
        } else {
          var emptyx = rx+face[0];
          var emptyy = ry+face[1];
          var emptyz = rz+face[2];
        
          var lightFromThatBlock =
            type.light/LIGHT_SCALE                         // Emission
            + lighting[emptyx*wy*wz + emptyy*wz + emptyz]; // Diffuse reflection
        
          incomingLight += rayAlpha * type.reflectivity * lightFromThatBlock;
          rayHits.push([emptyx,emptyy,emptyz]);
        
          found = true;
          return true;
        }
      }
      
      var updateCount = 0;
      var dirtied = false;
      while ((here = lightingUpdateQueue.dequeue()) && updateCount++ < 120) {
        
        var x = here[0];
        var y = here[1];
        var z = here[2];
      
        if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
          continue;
      
        var index = x*wy*wz + y*wz + z;
        var thisBlock = blocks[index];
      
        var incomingLight = 0;
        var rayHits = [];
        var totalRays = 0;
        if (opaques[thisBlock]) {
          // Opaque blocks are always dark inside
          totalRays = 1;
        } else {
          for (var raySetI = lightRays.length - 1; raySetI >= 0; raySetI--)   {
            var raySetData = lightRays[raySetI];
            
            // If this is empty space, then...
            if (!thisBlock) {
              // Cast rays only from adjacent surfaces
              var reflectFace = raySetData.reflectFace;
              if (!g(x+reflectFace[0], y+reflectFace[1], z+reflectFace[2])) // TODO perhaps use reflectance or anything but "nonzero id"
                continue;
            }
            
            var rays = raySetData.rays;
            for (var rayi = rays.length - 1; rayi >= 0; rayi--) {
              var rayData = rays[rayi];
              vec3.add(here, rayData.origin, rayOrigin);
              var found = false;
              var rayAlpha = 1;
              raycast(rayOrigin, rayData.direction, 30/*TODO magic number */, rayCallback);
              if (!found) {
                incomingLight += rayAlpha * LIGHT_SKY;
              }
              totalRays++;
            }
          }
        }
        var newSample = incomingLight / (totalRays || 1);
        var oldStoredValue = lighting[index];
        var newValue = newSample /* 0.75 * oldStoredValue + 0.25 * newSample -- old for softening randomization */;
        var newStoredValue = Math.round(Math.min(LIGHT_MAX, newValue));
      
        if (oldStoredValue !== newStoredValue) {
          lighting[index] = newStoredValue;
          dirtied = true;
          notifier.notify("relitBlock", here);
        
          if (lightingUpdateQueue.size() < MAX_LIGHTING_QUEUE) {
            rayHits.push([x,y,z]);
            for (var i = rayHits.length - 1; i >= 0; i--) {
              var lqe = rayHits[i];
              lqe.priority = Math.abs(newStoredValue - oldStoredValue); // queue priority
              lightingUpdateQueue.enqueue(lqe);
            }
          }
        }
      }
      
      measuring.lightUpdateCount.inc(updateCount);
      if (dirtied) self.persistence.dirty();
    }
    
    // for use by bodies only
    function setContacts(cube, faces) {
      // TODO extend this to handle the existence of multiple bodies
      if (faces) {
        contacts.set(cube, faces);
      } else {
        contacts.delete(cube);
      }
      reeval(cube, gt(cube[0],cube[1],cube[2])); // should this be deferred?
      var circuit = blockCircuits.get(cube);
      if (circuit) circuit.refreshLocal();
    }
    
    function getContacts(cube) {
      return contacts.get(cube);
    }
    
    function transientEvent(cube, mode) {
      notifier.notify("transientEvent", cube, gt(cube[0],cube[1],cube[2]), mode);
    }
    
    function addBody(body) {
      if (bodies.indexOf(body) !== -1) return;
      if (body.world !== self && body.world !== null) {
        throw new Error("the provided body already belongs to another world");
      }
      body.world = self;
      bodies.push(body);
      self.persistence.dirty();
    }
    function forEachBody(f) {
      bodies.forEach(function (body) {
        f(body);
      });
    }
    function getPlayerBody() {
      // TODO optimize?
      var playerBody = null;
      bodies.forEach(function (candidate) {
        if (candidate.isPlayerBody && !playerBody) {
          playerBody = candidate;
        }
      });
      return playerBody;
    }
    
    var RLE_BASE = 0xA1;
    function rleBytes(bytes) {
      var ser = [];
      
      var seen = null;
      var count = 0;
      var len = bytes.length;
      for (var i = 0; i < len; i++) {
        var value = bytes[i];
        if (seen === value || seen === null) {
          count++;
        } else {
          ser.push(String.fromCharCode(RLE_BASE + seen) + count);
          count = 1;
        }
        seen = value;
      }
      if (count > 0) {
        ser.push(String.fromCharCode(RLE_BASE + seen) + count);
      }
      return ser.join("");
    }
    
    function serialize(subSerialize) {
      var json = {
        wx: wx,
        wy: wy,
        wz: wz,
        blockset: subSerialize(blockset),
        blockCodeBase: RLE_BASE,
        blocks: rleBytes(blocks),
        subData: rleBytes(subData),
        lightCache: rleBytes(lighting),
        bodies: bodies.map(subSerialize)
      };
      subSerialize.setUnserializer(json, World);
      return json;
    }
    
    // --- Final init ---
    
    this.g = g;
    this.gv = gv;
    this.gt = gt;
    this.gtv = gtv;
    this.gRot = gRot;
    this.gRotv = gRotv;
    this.gLight = gLight;
    this.gLightv = gLightv;
    this.gSub = gSub;
    this.gSubv = gSubv;
    this.s = s;
    this.sv = sv;
    this.sSub = sSub;
    this.sSubv = sSubv;
    this.opaque = opaque;
    this.opaquev = opaquev;
    this.selectable = selectable;
    this.selectablev = selectablev;
    this.inBounds = inBounds;
    this.inBoundsv = inBoundsv;

    this.raw = blocks;
    this.rawSubData = subData;
    this.rawRotations = rotations;
    this.rawLighting = lighting;
    this.notifyRawEdit = notifyRawEdit;

    this.raycast = raycast;
    this.getCircuits = function () { return circuits; }; // TODO should be read-only interface
    this.getCircuit = function (block) { return blockCircuits.get(block) || null; };
    this.edit = edit;
    
    this.addBody = addBody;
    this.forEachBody = forEachBody;
    this.getPlayerBody = getPlayerBody;
    
    this.step = step;
    this.polishLightInVicinity = polishLightInVicinity;
    
    this.setContacts = setContacts;
    this.getContacts = getContacts;
    this.transientEvent = transientEvent;
    
    this.listen = notifier.listen;
    this.serialize = serialize;
    
    this.wx = wx;
    this.wy = wy;
    this.wz = wz;
    this.lightMax = LIGHT_MAX;     // Maximum value in lighting array
    this.lightScale = LIGHT_SCALE; // Value which should be a unity/"normal" light level
    this.lightOutside = LIGHT_SKY; // Ambient outside-the-world light level
    
    Object.defineProperties(this, {
      blockset: {
        enumerable: true,
        get: function () {
          return blockset;
        },
        set: function (v) {
          if (blockset !== v) {
            blockset = v;
            notifier.notify("changedBlockset");
            self.persistence.dirty();
          }
        }
      }
    });
    
    Object.freeze(this);
  }
  
  Persister.types["World"] = World;
  World.unserialize = function (json, unserialize) {
    var base = json.blockCodeBase;
    
    function unrleBytes(str, array) {
      var pat = /(.)([0-9]+)/g;
      var length = array.length;
      var i, match;
      for (i = 0; (match = pat.exec(str)) && i < length;) {
        var blockID = match[1].charCodeAt(0) - base;
        var limit = Math.min(length, i + parseInt(match[2], 10));
        for (; i < limit; i++) {
          array[i] = blockID;
        }
      }
    }
    
    var world = new World([json.wx, json.wy, json.wz], unserialize(json.blockset || json.blockSet, Blockset));
    
    unrleBytes(json.blocks, world.raw);
    unrleBytes(json.subData, world.rawSubData);
    unrleBytes(json.lightCache, world.rawLighting);
    world.notifyRawEdit();
    
    (json.bodies || []).forEach(function (bodyJson) {
      world.addBody(unserialize(bodyJson));
    });
    if (json.playerBody) { // obsolete serialization
      var body = unserialize(json.playerBody);
      body.isPlayerBody = true;
      world.addBody(body);
    }

    return world;
  };
  
  World.subdatumBound = 256;
  
  cubes.World = Object.freeze(World);
  
  // --- Selection objects ---
  
  function Selection(world) {
    var bounds = new AAB(Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity);
    // TODO: Implement non-box selection. Bitmask array within the bounds.
    
    Object.defineProperties(this, {
      world: {
        enumerable: true,
        get: function () { return world; }
      },
      bounds: {
        enumerable: true,
        get: function () { return bounds; }
      }
    });
    
    this.setToAAB = function (aab) {
      bounds = aab;
    };
  }
  // Invoke the callback with (cube, world) for each cube in the selection.
  // Note that the cube argument is mutated and reused.
  Selection.prototype.forEachCube = function (callback) {
    var world = this.world;
    var aab = this.bounds;
    var lx = aab[0];
    var hx = aab[1];
    var ly = aab[2];
    var hy = aab[3];
    var lz = aab[4];
    var hz = aab[5];
    var vec = vec3.create();
    for (var x = lx; x < hx; x++) {
      vec[0] = x;
      for (var y = ly; y < hy; y++) {
        vec[1] = y;
        for (var z = lz; z < hz; z++) {
          vec[2] = z;
          callback(vec, world);
        }
      }
    }
  };
  cubes.Selection = Object.freeze(Selection);
}());
