// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var World = (function () {
  "use strict";
  
  var spontaneousBaseRate = 0.0003; // probability of block spontaneous effect call per block per second
  
  var LIGHT_MAX = 255;
  var LIGHT_SKY = LIGHT_MAX;
  var RAYCOUNT = 20;
  var reflectivity = 0.9;
  
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
  
  function World(sizes, blockSet) {
    if (!blockSet) {
      // early catch of various mistakes that can lead to this
      throw new Error("missing BlockSet for new World");
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
    
    // Computed data arrays.
    var rotations = new Uint8Array(cubeCount);
    var lighting = new Uint8Array(cubeCount);
    for (var i = lighting.length - 1; i >= 0; i--) lighting[i] = LIGHT_MAX/2; // better initial value than 0
    
    // Maps from cube to its circuit object if any
    var blockCircuits = new IntVectorMap();
    
    // Maps from an arbitrary cube in each circuit to that circuit (no duplicates)
    var circuits = new IntVectorMap();
    
    // Blocks which are to be modified according to circuit outputs
    var effects = new IntVectorMap();
    
    // Blocks which a body is touching the top surface of (TODO: generalize this)
    var standingOn = new IntVectorMap();
    
    var numToDisturbPerSec = cubeCount * spontaneousBaseRate;
    
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
        debugger;
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
      while (block = q.pop()) {
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
      var circuit = undefined;
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
    function g(x,y,z) {
      if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
        return 0;
      else
        return blocks[x*wy*wz + y*wz + z];
    }
    // Return the block type at the given coordinates
    function gt(x,y,z) {
      return blockSet.get(g(x,y,z));
    }
    // Return the block subdatum at the given coordinates
    function gSub(x,y,z) {
      if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
        return 0;
      else
        return subData[x*wy*wz + y*wz + z];
    }
    // Return the block rotation at the given coordinates
    function gRot(x,y,z) {
      if (x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz)
        return 0;
      else
        return rotations[x*wy*wz + y*wz + z];
    }
    function s(x,y,z,val,subdatum) { // TODO revisit making this not take a vec
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
      
      var newType = blockSet.get(val);
      reeval(vec, newType);
      
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
        })
      }
      
      // Update neighbors, which may have circuit inputs depending on this block
      neighbors.forEach(function (neighbor) {
        reeval(neighbor, gt(neighbor[0],neighbor[1],neighbor[2]));
        
        // note: this duplicates work if the same circuit neighbors this block more than once
        var circuit = blockCircuits.get(neighbor);
        if (circuit) {
          circuit.refreshLocal();
        }
      });
      
      notifier.notify("dirtyBlock", vec);
      self.persistence.dirty();
    }
    function sSub(x,y,z,subdatum) {
      s(x,y,z,g(x,y,z),subdatum);
    }
    function solid(x,y,z) {
      return gt(x,y,z).solid;
    }
    function opaque(x,y,z) {
      return gt(x,y,z).opaque;
    }
    function selectable(x,y,z) {
      return g(x,y,z) != 0;
    }
    function inBounds(x,y,z) {
      return !(x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz);
    }
    
    /**
     * Call the callback with (x,y,z,value,face) of all blocks along the line
     * segment from pt1, through pt2, of length 'radius'.
     *
     * 'face' is the normal vector of the face of that block that was entered.
     * It should not be used after the callback returns.
     *
     * If the callback returns a true value, the traversal will be stopped.
     */
    function raycast(pt1, pt2, radius, callback) {
      // From "A Fast Voxel Traversal Algorithm for Ray Tracing"
      // by John Amanatides and Andrew Woo, 1987
      // http://www.cse.yorku.ca/~amana/research/grid.pdf
      // http://citeseer.ist.psu.edu/viewdoc/summary?doi=10.1.1.42.3443
      // The radius limit is my addition.
      var x = Math.floor(pt1[0]);
      var y = Math.floor(pt1[1]);
      var z = Math.floor(pt1[2]);
      var dx = pt2[0] - pt1[0];
      var dy = pt2[1] - pt1[1];
      var dz = pt2[2] - pt1[2];
      var stepX = signum(dx);
      var stepY = signum(dy);
      var stepZ = signum(dz);
      var tMaxX = intbound(pt1[0], dx);
      var tMaxY = intbound(pt1[1], dy);
      var tMaxZ = intbound(pt1[2], dz);
      var tDeltaX = stepX/dx;
      var tDeltaY = stepY/dy;
      var tDeltaZ = stepZ/dz;
      var face = vec3.create();
      
      // 't' is in units of (pt2-pt1), so adjust radius in blocks by that
      radius /= Math.sqrt(dx*dx+dy*dy+dz*dz);
      
      //console.log(stepX, stepY, stepZ, dx, dy, dz, tDeltaX, tDeltaY, tDeltaZ);
      while (/* ray has not gone past bounds of world */
             (stepX > 0 ? x < wx : x >= 0) &&
             (stepY > 0 ? y < wy : y >= 0) &&
             (stepZ > 0 ? z < wz : z >= 0)) {
        
        if (!(x < 0 || y < 0 || z < 0 || x >= wx || y >= wy || z >= wz))
          if (callback(x, y, z, blocks[x*wy*wz + y*wz + z], face))
            break;
        
        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) {
            if (tMaxX > radius) break;
            x += stepX;
            tMaxX += tDeltaX;
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
      var val;
      var vec = [0,0,0];
      var types = blockSet.getAll();
      for (var x = 0; x < wx; x++) {
        vec[0] = x;
        var xbase = x*wy*wz;
        for (var y = 0; y < wy; y++) {
          vec[1] = y;
          var ybase = xbase + y*wz;
          for (var z = 0; z < wz; z++) {
            vec[2] = z;
            var index = ybase + z;
            blocks[index] = val = func(x,y,z,blocks[index]);
            subData[index] = 0;
            reeval([x,y,z], types[val]);
          }
        }
      }
      notifier.notify("dirtyAll");
      self.persistence.dirty();
    }
    
    // Perform actions related to block circuits immediately after a change
    function reeval(cube, newType) {
      var x = cube[0];
      var y = cube[1];
      var z = cube[2];
      var index = x*wy*wz + y*wz + z;
      if (newType.hasCircuits) {
        queueEffect(cube, Circuit.executeCircuitInBlock(newType.world, self, cube, subData[index], null));
        
      } else {
        rotations[index] = 0;
      }
      evaluateLightAt(x,y,z);
    }
    
    function queueEffect(cube, effect) {
      if (effect !== null) {
        var list = effects.get(cube);
        if (!list) effects.set(cube, list = []);
        list.push(effect);
      }
    }
    
    // Called by clients which modify the raw state arrays
    function notifyRawEdit() {
      // Rebuild world circuits and reeval block circuits
      notifier.notify("dirtyAll");
      self.persistence.dirty();
      
      blockCircuits = new IntVectorMap(); // TODO clear op instead of replacing objects?
      circuits = new IntVectorMap();
      var types = blockSet.getAll();
      var vec = [0,0,0];
      for (var x = 0; x < wx; x++) {
        vec[0] = x;
        var xbase = x*wy*wz;
        for (var y = 0; y < wy; y++) {
          vec[1] = y;
          var ybase = xbase + y*wz;
          for (var z = 0; z < wz; z++) {
            vec[2] = z;
            reeval(vec, types[blocks[ybase + z]]);
          }
        }
      }
      
      // In-block circuits (handled by reeval) determine rotations, which determine in-this-world circuit connectivity, so all floodCircuit must happen after all reeval.
      for (var x = 0; x < wx; x++) {
        vec[0] = x;
        var xbase = x*wy*wz;
        for (var y = 0; y < wy; y++) {
          vec[1] = y;
          var ybase = xbase + y*wz;
          for (var z = 0; z < wz; z++) {
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
      var curEffects = effects;
      effects = new IntVectorMap(); // for effects caused by these updates
      curEffects.forEach(function (effectList, cube) {
        var effect = effectList[0]; // TODO note and react to conflicts
        var index = (cube[0]*wy + cube[1])*wz + cube[2];
        blocks[index] = effect[0];
        subData[index] = effect[1];
      });
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
        var index = x*wy*wz + y*wz + z;
        
        // The input value given is chosen so that if you want a rate of k, you can
        // multiply k*value to get the chance you should do your thing.
        // TODO: Maybe k should be an input to the spontaneous-event-detector circuit block?
        var type = gt(x,y,z);
        if (type.hasCircuits) {
          // TODO: this seems a bit overly coupled
          var cube = [x,y,z];
          queueEffect(cube, Circuit.executeCircuitInBlock(type.world, self, cube, gSub(x,y,z), {
            blockIn_spontaneous: 1/spontaneousBaseRate
          }));
        }
      }

      // Lighting updates
      // TODO: Make this biased towards where people are looking
      for (var i = 0; i < 100; i++) {
        var x = Math.floor(Math.random() * wx);
        var y = Math.floor(Math.random() * wy);
        var z = Math.floor(Math.random() * wz);
      
        // Skip blocks which are not adjacent to a solid block and therefore irrelevant
        if (!(g(x-1,y,z) ||
              g(x+1,y,z) ||
              g(x,y+1,z) ||
              g(x,y-1,z) ||
              g(x,y,z+1) ||
              g(x,y,z-1))) continue;
        evaluateLightAt(x,y,z);
      }
    }
    
    function evaluateLightAt(x, y, z) {
      var index = x*wy*wz + y*wz + z;
      
      var incomingLight = 0;
      for (var ray = 0; ray < RAYCOUNT; ray++) {
        var pt1 = [x+0.5,y+0.5,z+0.5];
        var pt2 = [x + Math.random(),y + Math.random(),z + Math.random()];
        var found = false;
        raycast(pt1, pt2, 30/*TODO magic number */, function (rx, ry, rz, id, face) {
          if (id === 0) {
            // empty air -- pass through
            return false;
          } else if (!blockSet.get(id).opaque) {
            // not quite empty air, but for now we'll not bother picking up some of it
            return false;
          } else {
            var emptyx = rx+face[0];
            var emptyy = ry+face[1];
            var emptyz = rz+face[2];
            
            // No loss if we hit right here
            var factor = (emptyx === x && emptyy === y && emptyz === z) ? 1 : reflectivity;
            
            var lightFromThatBlock = (id === 1) ? LIGHT_MAX : lighting[emptyx*wy*wz + emptyy*wz + emptyz];
            
            incomingLight += factor * lightFromThatBlock;
            found = true;
            return true;
          }
        });
        if (!found) {
          incomingLight += LIGHT_SKY;
        }
      }
      var newSample = incomingLight / RAYCOUNT;
      var newValue = (0.75 * lighting[index] + 0.25 * newSample);
      var newStoredValue = Math.round(Math.min(LIGHT_MAX, newValue));
      
      if (lighting[index] !== newStoredValue) {
        lighting[index] = newStoredValue;
        if (Math.random() < 0.005) // TODO kludge for fewer updates
          notifier.notify("dirtyBlock", [x,y,z]);
      }
    }
    
    // for use by bodies only
    function setStandingOn(cube, value) {
      if (value) {
        standingOn.set(cube, true);
      } else {
        standingOn.delete(cube);
      }
      reeval(cube, gt(cube[0],cube[1],cube[2])); // should this be deferred?
      var circuit = blockCircuits.get(cube);
      if (circuit) circuit.refreshLocal();
    }
    
    function getStandingOn(cube) {
      return !!standingOn.get(cube);
    }
    
    function audioEvent(cube, mode) {
      notifier.notify("audioEvent", vec3.add([0.5,0.5,0.5], cube), gt(cube[0],cube[1],cube[2]), mode);
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
        blockSet: subSerialize(blockSet),
        blockCodeBase: RLE_BASE,
        blocks: rleBytes(blocks),
        subData: rleBytes(subData)
      };
      subSerialize.setUnserializer(json, World);
      return json;
    }
    
    // --- Final init ---
    
    this.g = g;
    this.gt = gt;
    this.gRot = gRot;
    this.gSub = gSub;
    this.s = s;
    this.sSub = sSub;
    this.solid = solid;
    this.opaque = opaque;
    this.selectable = selectable;
    this.inBounds = inBounds;
    this.raw = blocks;
    this.rawSubData = subData;
    this.rawRotations = rotations;
    this.rawLighting = lighting;
    this.notifyRawEdit = notifyRawEdit;
    this.raycast = raycast;
    this.getCircuits = function () { return circuits; }; // TODO should be read-only interface
    this.getCircuit = function (block) { return blockCircuits.get(block) || null; }
    this.edit = edit;
    this.step = step;
    this.setStandingOn = setStandingOn;
    this.getStandingOn = getStandingOn;
    this.audioEvent = audioEvent;
    this.listen = notifier.listen;
    this.serialize = serialize;
    
    this.wx = wx;
    this.wy = wy;
    this.wz = wz;
    this.blockSet = blockSet;
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
    
    var world = new World([json.wx, json.wy, json.wz], unserialize(json.blockSet, BlockSet));
    var str = json.blocks;
    unrleBytes(json.blocks, world.raw);
    unrleBytes(json.subData, world.rawSubData);
    world.notifyRawEdit();
    return world;
  }
  
  World.subdatumBound = 256;
  
  Object.freeze(World);
  
  return World;
}());
