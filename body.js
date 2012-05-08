// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

(function () {
  "use strict";
  
  var AAB = cubes.util.AAB;
  var abs = Math.abs;
  var CubeRotation = cubes.util.CubeRotation;
  var IntVectorMap = cubes.util.IntVectorMap;
  var measuring = cubes.measuring;
  var Persister = cubes.storage.Persister;
  
  // physics constants
  var GRAVITY = 20; // cubes/s^2
  var MAX_STEP_UP = 0.57; // cubes
  var POSITION_EPSILON = 1e-6; // close-but-not-intersecting objects are set to this separation
  var VELOCITY_EPSILON = 1e-6; // velocities below this are treated as zero
  
  function Body(world, aabb, skin) {
    this.aabb = aabb;
    this.pos = new Float64Array(3);
    this.vel = new Float64Array(3);
    this.yaw = Math.PI/4 * 5;
    this.flying = false;
    this.noclip = false;
    this.isPlayerBody = false;
    this.skin = skin || null;
    
    // non-persisted properties
    this.world = world;
    this.worldContacts = null; // TODO should be private
    this.cameraYLag = 0;
    this.debugHitAABBs = []; // filled by collision code
  }
  
  Body.prototype.serialize = function (subSerialize) {
    var json = {};
    subSerialize.setUnserializer(json, Body);
    json.aabb = this.aabb.toArray();
    json.pos = Array.prototype.slice.call(this.pos);
    json.vel = Array.prototype.slice.call(this.vel);
    json.yaw = this.yaw;
    if (this.flying !== false)
      json.flying = this.flying;
    if (this.noclip !== false)
      json.noclip = this.noclip;
    if (this.isPlayerBody !== false)
      json.isPlayerBody = this.isPlayerBody;
    if (this.skin !== null)
      json.skin = subSerialize(this.skin);
    return json;
  };
  
  Persister.types["Body"] = Body;
  Body.unserialize = function (json, unserialize) {
    var body = new Body(null, AAB.fromArray(json.aabb));
    if ("pos" in json) vec3.set(json.pos, body.pos);
    if ("vel" in json) vec3.set(json.vel, body.vel);
    if ("yaw" in json) body.yaw = +json.yaw;
    if ("flying" in json) body.flying = !!json.flying;
    if ("noclip" in json) body.noclip = !!json.noclip;
    if ("isPlayerBody" in json) body.isPlayerBody = !!json.isPlayerBody;
    if ("skin" in json) body.skin = unserialize(json.skin);
    return body;
  };

  
  Body.prototype.getListenerParameters = function () {
    var yaw = this.yaw;
    return [
      this.pos,
      [-Math.sin(yaw), 0, -Math.cos(yaw)],
      this.vel];
  };

  Body.prototype.step = function (timestep, didMoveCallback) {
    var body = this;
    var bodyAABB = this.aabb;
    var world = this.world;
    var curPos = this.pos;
    var curVel = this.vel;
    
    // gravity
    if (!this.flying) {
      curVel[1] -= timestep * GRAVITY;
    }
    
    // early exit
    if (vec3.length(curVel) <= VELOCITY_EPSILON) return;
          
    var nextPos = vec3.scale(curVel, timestep, new Float64Array(3));
    vec3.add(nextPos, curPos);
    
    // --- collision ---
    
    function intersectBodyAt(pos, ignore) {
      return intersectWorld(bodyAABB.translate(pos), world, ignore || IntVectorMap.empty, 0);
    }
    
    function unionHits(hit) {
      var union = [Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];
      hit.forEachValue(function (aabb) {
        body.debugHitAABBs.push(aabb); // TODO: misplaced for debug
        union[0] = Math.min(union[0], aabb[0]);
        union[1] = Math.max(union[1], aabb[1]);
        union[2] = Math.min(union[2], aabb[2]);
        union[3] = Math.max(union[3], aabb[3]);
        union[4] = Math.min(union[4], aabb[4]);
        union[5] = Math.max(union[5], aabb[5]);
      });
      return new AAB(union[0],union[1],union[2],union[3],union[4],union[5]);
    }
    
    this.debugHitAABBs.splice(0, this.debugHitAABBs.length);
    
    var alreadyColliding = intersectBodyAt(curPos);
    
    // To resolve diagonal movement, we treat it as 3 orthogonal moves, updating nextPosIncr.
    var previousContacts = this.worldContacts;
    var curContacts = null;
    var nextPosIncr = new Float64Array(curPos);
    
    var dim, dir;
    function hitCallback(aab, cube) {
      var key = cube.slice(0, 3);
      var faces = curContacts.get(key);
      if (!faces) curContacts.set(key, faces = {});
      var fkey = [0,0,0];
      fkey[dim] = dir ? -1 : 1;
      faces[fkey] = true;
    }
    
    if (this.noclip) {
      nextPosIncr = nextPos;
      this.flying = true;
    } else {
      for (var dimi = 0; dimi < 3; dimi++) {
        dim = [1,0,2][dimi]; // TODO: doing the dims in another order makes the slope walking glitch out, but I don't understand *why*.
        var dimvel = curVel[dim];
        dir = dimvel >= 0 ? 1 : 0;
        if (abs(dimvel) <= VELOCITY_EPSILON) { 
          // If no velocity in this direction, don't move and no test needed
          continue;
        }
        nextPosIncr[dim] = nextPos[dim]; // TODO: Sample multiple times if velocity exceeds 1 block/step
        //console.log(dir, dim, bodyAABB.get(dim, dir), front, nextPosIncr);
        var hit = intersectBodyAt(nextPosIncr, alreadyColliding);
        if (hit) {
          var hitAABB = unionHits(hit);
          resolveDirection: do /* dummy loop to satisfy lint */ {
            // Walk-up-slopes
            if (dim !== 1 /*moving horizontally*/ && this.getFloor() /*not in air*/) {
              var upward = new Float64Array(nextPosIncr);
              upward[1] = hitAABB.get(1, 1) - bodyAABB.get(1,0) + POSITION_EPSILON;
              var delta = upward[1] - nextPosIncr[1];
              //console.log("upward test", delta, !!intersectBodyAt(upward));
              if (delta > 0 && delta < MAX_STEP_UP && !intersectBodyAt(upward)) {
                this.cameraYLag += delta;
                nextPosIncr = upward;
                break resolveDirection;
              }
            }
        
            var surfaceOffset = hitAABB.get(dim, 1-dir) - (nextPosIncr[dim] + bodyAABB.get(dim, dir));
            nextPosIncr[dim] += surfaceOffset - (dir ? 1 : -1) * POSITION_EPSILON;
            curVel[dim] /= 10; // TODO justify this constant
            
            if (hit) {
              if (!curContacts) curContacts = new IntVectorMap();
              hit.forEach(hitCallback);
            }
            if (dim === 1 && dir === 0) { // touched ground
              this.flying = false;
            }
          } while (false);
        }
      }
    }
    
    this.worldContacts = curContacts;
    
    if (nextPosIncr[1] < 0) {
      // Prevent falling downward indefinitely, without preventing flying under the world (e.g. for editing the bottom of a block).
      this.flying = true;
    }
    
    if (nextPosIncr[0] !== curPos[0] ||
        nextPosIncr[1] !== curPos[1] ||
        nextPosIncr[2] !== curPos[2]) {
      vec3.set(nextPosIncr, curPos);
      didMoveCallback();
    }
    
    if (curContacts) curContacts.forEach(function (faces, cube) {
      // TODO adjust this for multiple bodies touching the same thing
      world.setContacts(cube, faces);
    });
    if (previousContacts) previousContacts.forEach(function (faces, cube) {
      if (!(curContacts && curContacts.has(cube))) {
        world.setContacts(cube, null);
      }
    });
  };
  
  function intersectWorld(aabb, iworld, ignore, level) {
    var hit = new IntVectorMap();
    var lx = Math.max(0, Math.floor(aabb.get(0, 0)));
    var ly = Math.max(0, Math.floor(aabb.get(1, 0)));
    var lz = Math.max(0, Math.floor(aabb.get(2, 0)));
    var hx = Math.min(iworld.wx - 1, Math.floor(aabb.get(0, 1)));
    var hy = Math.min(iworld.wy - 1, Math.floor(aabb.get(1, 1)));
    var hz = Math.min(iworld.wz - 1, Math.floor(aabb.get(2, 1)));
    measuring.collisionTests.inc(Math.max(0, hx-lx+1) *
                                 Math.max(0, hy-ly+1) *
                                 Math.max(0, hz-lz+1));
    var pos, rot, scaledCollideAABB;
    function subHitCallback(subHitAAB, subPos) {
      hit.set(pos.concat(subPos),
        rot ? subHitAAB.scale(1/scale).rotate(rot).translate([x, y, z])
            : subHitAAB.scale(1/scale)            .translate([x, y, z]));
    }
    for (var x = lx; x <= hx; x++)
    for (var y = ly; y <= hy; y++)
    for (var z = lz; z <= hz; z++) {
      var type = iworld.gt(x,y,z);
      if (!type.solid) continue;
      pos = [x, y, z];
      if (ignore.get(pos)) continue;
      if (!type.opaque && type.world && level === 0) {
        var scale = type.world.wx;
        var rotCode = iworld.gRot(x,y,z);
        if (rotCode === 0) {
          rot = null;
          scaledCollideAABB = aabb.translate([-x, -y, -z]).scale(scale);
        } else {
          rot = CubeRotation.byCode[rotCode];
          scaledCollideAABB = aabb.translate([-x, -y, -z]).rotate(rot.inverse).scale(scale);
        }
        var subhit = intersectWorld(
              scaledCollideAABB,
              type.world,
              IntVectorMap.empty,
              level + 1);
        if (subhit) subhit.forEach(subHitCallback);
      } else {
        hit.set(pos, AAB.unitCube(pos));
      }
    }
    return hit.length ? hit : null;
  }
  
  // Public version of intersectWorld -- made available for block-placement checks.
  // If aab intersects any of the blocks of world, return an IntVectorMap whose keys are the cube coordinates (concatenated with subcube coordinates if any) and values are the colliding cubes or subcubes.
  // If 'ignore' is provided then it is a IntVectorMap listing cube collisions which should *not* be reported.
  Body.intersectAABAndWorld = function (aab, world, ignore) {
    return intersectWorld(aab, world, ignore || IntVectorMap.empty, 0);
  };
  
  Body.prototype.getFloor = function () {
    var floor = null;
    (this.worldContacts || IntVectorMap.empty).forEach(function (faces, cube) {
      if (faces["0,1,0"]) {
        floor = cube;
      }
    });
    return floor;
  };
  
  Body.prototype.addVelocity = function (dv) {
    vec3.add(this.vel, dv);
  };
  
  Body.prototype.jump = function (jumpVel) {
    if (this.getFloor()) {
      this.addVelocity(jumpVel);
    }
  };
  
  Body.GRAVITY = GRAVITY;
  
  cubes.Body = Object.freeze(Body);
}());
