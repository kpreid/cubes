// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Body = (function () {
  "use strict";
  
  // physics constants
  var GRAVITY = 20; // cubes/s^2
  var MAX_STEP_UP = 0.57; // cubes
  var EPSILON = 1e-3;
  
  function Body(config, world, aabb) {
    this.world = world;
    this.aabb = aabb;
    this.pos = vec3.create();
    this.vel = vec3.create();
    this.yaw = Math.PI/4 * 5;
    this.worldContacts = null;
    this.flying = false;
    this.cameraYLag = 0;
    this.debugHitAABBs = []; // filled by collision code
    
    this._config = config; // TODO should be private
  }
  
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
    if (vec3.length(curVel) <= 0) return;
          
    var nextPos = vec3.scale(curVel, timestep, vec3.create());
    vec3.add(nextPos, curPos);
    
    // --- collision ---

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
      for (var x = lx; x <= hx; x++)
      for (var y = ly; y <= hy; y++)
      for (var z = lz; z <= hz; z++) {
        var type = iworld.gt(x,y,z);
        if (!type.solid) continue;
        var pos = [x, y, z];
        if (ignore.get(pos)) continue;
        if (!type.opaque && type.world && level == 0) {
          var scale = type.world.wx;
          var rotCode = iworld.gRot(x,y,z);
          if (rotCode === 0) {
            var rot = null;
            var scaledCollideAABB = aabb.translate([-x, -y, -z]).scale(scale);
          } else {
            var rot = CubeRotation.byCode[rotCode];
            var scaledCollideAABB = aabb.translate([-x, -y, -z]).rotate(rot.inverse).scale(scale);
          }
          var subhit = intersectWorld(
                scaledCollideAABB,
                type.world,
                IntVectorMap.empty,
                level + 1);
          if (subhit) subhit.forEach(function (subHitAAB, subPos) {
            hit.set(pos.concat(subPos), 
              rot ? subHitAAB.scale(1/scale).rotate(rot).translate([x, y, z])
                  : subHitAAB.scale(1/scale)            .translate([x, y, z]));
          });
        } else {
          hit.set(pos, AAB.unitCube(pos));
        }
      }
      return hit.length ? hit : null;
    }
    
    function intersectBodyAt(pos, ignore) {
      return intersectWorld(bodyAABB.translate(pos), world, ignore || IntVectorMap.empty, 0);
    }
    
    function unionHits(hit) {
      var union = [Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];
      hit.forEach(function (aabb) {
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
    var nextPosIncr = vec3.create(curPos);
    if (this._config.noclip.get()) {
      nextPosIncr = nextPos;
      this.flying = true;
    } else {
      for (var dimi = 0; dimi < 3; dimi++) {
        var dim = [1,0,2][dimi]; // TODO: doing the dims in another order makes the slope walking glitch out, but I don't understand *why*.
        var dir = curVel[dim] >= 0 ? 1 : 0;
        nextPosIncr[dim] = nextPos[dim]; // TODO: Sample multiple times if velocity exceeds 1 block/step
        //console.log(dir, dim, bodyAABB.get(dim, dir), front, nextPosIncr);
        var hit = intersectBodyAt(nextPosIncr, alreadyColliding);
        if (hit) {
          var hitAABB = unionHits(hit);
          resolveDirection: {
            // Walk-up-slopes
            if (dim !== 1 /*moving horizontally*/ && previousContacts /*not in air*/) {
              var upward = vec3.create(nextPosIncr);
              upward[1] = hitAABB.get(1, 1) - bodyAABB.get(1,0) + EPSILON;
              var delta = upward[1] - nextPosIncr[1];
              //console.log("upward test", delta, !!intersectBodyAt(upward));
              if (delta > 0 && delta < MAX_STEP_UP && !intersectBodyAt(upward)) {
                this.cameraYLag += delta;
                nextPosIncr = upward;
                break resolveDirection;
              }
            }
        
            var surfaceOffset = hitAABB.get(dim, 1-dir) - (nextPosIncr[dim] + bodyAABB.get(dim, dir));
            nextPosIncr[dim] += surfaceOffset - (dir ? 1 : -1) * EPSILON;
            curVel[dim] /= 10; // TODO justify this constant
            
            if (hit) {
              if (!curContacts) curContacts = new IntVectorMap();
              hit.forEach(function (aab, cube) {
                var key = cube.slice(0, 3);
                var faces = curContacts.get(key);
                if (!faces) curContacts.set(key, faces = {});
                var fkey = [0,0,0];
                fkey[dim] = dir ? -1 : 1;
                faces[fkey] = true;
              });
            }
            if (dim === 1 && dir === 0) { // touched ground
              this.flying = false;
            }
          }
        }
      }
    }
    
    this.worldContacts = curContacts;
    
    if (nextPosIncr[1] < 0) {
      // Prevent falling downward indefinitely, without preventing flying under the world (e.g. for editing the bottom of a block).
      this.flying = true;
    }
    
    if (vec3.length(vec3.subtract(nextPosIncr, this.pos, vec3.create())) >= EPSILON) {
      vec3.set(nextPosIncr, this.pos);
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

  Body.prototype.addVelocity = function (dv) {
    vec3.add(this.vel, dv);
  };
  
  Body.prototype.jump = function (jumpVel) {
    if (this.worldContacts) {
      this.addVelocity(jumpVel);
    }
  }
  
  return Body;
}());
