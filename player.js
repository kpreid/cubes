// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Player = (function () {
  "use strict";
  
  // physics constants
  var WALKING_SPEED = 4; // cubes/s
  var FLYING_SPEED = 10; // cubes/s
  var GRAVITY = 20; // cubes/s^2
  var JUMP_SPEED = 8; // cubes/s
  var MAX_STEP_UP = 0.57; // cubes
  
  var playerAABB = new AAB(
    -0.35, 0.35, // x
    -1.75, 0.15, // y
    -0.35, 0.35 // z
  );

  var PLACEHOLDER_ROTATIONS = [];
  for (var i = 0; i < CubeRotation.countWithoutReflections; i++) {
    PLACEHOLDER_ROTATIONS.push(i);
  }
  
  function Player(config, initialWorld, renderer, audio, scheduleDraw) {
    var player = this;
    var gl = renderer.context;
    
    // a Place stores a world and location in it; used for push/pop
    function Place(world) {
      // Body state
      this.world = world;
      this.pos = vec3.create([0,0,0]);
      this.vel = vec3.create([0,0,0]);
      this.yaw = Math.PI/4 * 5;
      this.standingOn = null;
      this.flying = false;
      this.cameraYLag = 0;

      // Selection
      this.selection = null;

      // Current tool/block id
      this.tool = 2; // first non-bogus block id

      // must happen late
      this.wrend = new WorldRenderer(world, this /* TODO: facet */, renderer, audio, scheduleDraw, true);

    }

    // Worlds we've been in
    var placeStack = [];
    var currentPlace;

    // kludge: Since UI sets pitch absolutely, it's not a place variable
    var pitch = 0;

    var movement = vec3.create([0,0,0]);
    var mousePos = null; // or an [screen x, screen y] vector. Immutable value.
  
    var selectionR = new renderer.RenderBundle(gl.LINE_LOOP, null, function (vertices, normals, colors) {
      var sel = currentPlace ? currentPlace.selection : null;
      if (sel !== null) {
        var p = vec3.create(sel.cube);

        // This works, but don't ask me to justify it. We're taking the face normal vector and deriving a selection box.
        var qp = vec3.subtract(vec3.create(), sel.face);
        var qr = [-qp[1], -qp[2], -qp[0]]; // first perpendicular vector 
        var qs = vec3.cross(qp, qr, vec3.create()); // second perpendicular vector
        
        if (qp[0]+qp[1]+qp[2] > 0) {
          vec3.subtract(p, qr);
        } else {
          vec3.subtract(p, qp);
        }
        
        colors.push(1,1,1,1); normals.push(0,0,0); vertices.push(p[0],p[1],p[2]);
        colors.push(1,1,1,1); normals.push(0,0,0); vertices.push(p[0]+qr[0],p[1]+qr[1],p[2]+qr[2]);
        colors.push(1,1,1,1); normals.push(0,0,0); vertices.push(p[0]+qr[0]+qs[0],p[1]+qr[1]+qs[1],p[2]+qr[2]+qs[2]);
        colors.push(1,1,1,1); normals.push(0,0,0); vertices.push(p[0]+qs[0],p[1]+qs[1],p[2]+qs[2]);
      }
    }, {
      aroundDraw: function (draw) {
        gl.lineWidth(1);
        gl.disable(gl.DEPTH_TEST);
        draw();
        gl.enable(gl.DEPTH_TEST);
      }
    });
    
    var debugHitAABBs = []; // filled by collision code
    var axisPermutationsForBoxes = [[0,1,2], [1,2,0], [2,0,1]];
    var aabbR = new renderer.RenderBundle(gl.LINES, null, function (vertices, normals, colors) {
      if (!(config.debugPlayerCollision.get() && currentPlace)) return;

      var p = vec3.create();
      function renderAABB(offset, aabb, r, g, b) {
        axisPermutationsForBoxes.forEach(function (dims) {
          for (var du = 0; du < 2; du++)
          for (var dv = 0; dv < 2; dv++)
          for (var dw = 0; dw < 2; dw++) {
            vec3.set(offset, p);
            p[dims[0]] += aabb.get(dims[0], du);
            p[dims[1]] += aabb.get(dims[1], dv);
            p[dims[2]] += aabb.get(dims[2], dw);

            vertices.push(p[0],p[1],p[2]);
            normals.push(0,0,0);
            colors.push(r,g,b,1);
          }
        });
      }
      renderAABB(currentPlace.pos, playerAABB, 0,0,1);
      debugHitAABBs.forEach(function (aabb) {
        renderAABB([0,0,0], aabb, 0,1,0);
      })
    }, {aroundDraw: function (draw) {
      if (!config.debugPlayerCollision.get()) return;
      gl.lineWidth(2);
      draw();
    }});
  
    function aimChanged() {
      scheduleDraw(); // because this routine is also 'view direction changed'

      var foundCube = null, foundFace = null;
      if (mousePos !== null) {
        var w = currentPlace.world;
        var pts = renderer.getAimRay(mousePos, player.render);
        w.raycast(pts[0], pts[1], 20, function (x,y,z,value,face) {
          if (w.selectable(x,y,z)) {
            foundCube = Object.freeze([x,y,z]);
            foundFace = face;
            return true;
          }
        });
        // Note: If we ever want to enable selection of the edges of the world,
        // then that can be done by noting the last cube the raycast hit.
      }
      
      var newSel;
      if (foundCube !== null) {
        newSel = Object.freeze({
          cube: foundCube,
          face: foundFace,
          toString: function () { return this.cube + ";" + this.face; }
        });
      } else {
        newSel = null;
      }
      
      if (String(currentPlace.selection) !== String(newSel)) {
        currentPlace.selection = newSel;
        selectionR.recompute();
        scheduleDraw();
      }
    }
    
    var EPSILON = 1e-3;
    function stepPlayer(timestep) {
      var world = currentPlace.world;
      
      // apply movement control to velocity
      var controlOrientation = mat4.rotateY(mat4.identity(mat4.create()), currentPlace.yaw);
      var movAdj = vec3.create();
      mat4.multiplyVec3(controlOrientation, movement, movAdj);
      vec3.scale(movAdj, currentPlace.flying ? FLYING_SPEED : WALKING_SPEED);
      //console.log(vec3.str(movAdj));
      currentPlace.vel[0] += (movAdj[0] - currentPlace.vel[0]) * 0.4;
      if (currentPlace.flying) {
        currentPlace.vel[1] += (movAdj[1] - currentPlace.vel[1]) * 0.4;
      } else {
        if (movAdj[1] !== 0) {
          currentPlace.vel[1] += (movAdj[1] - currentPlace.vel[1]) * 0.4 + timestep * GRAVITY;
        }
      }
      currentPlace.vel[2] += (movAdj[2] - currentPlace.vel[2]) * 0.4;
      
      // gravity
      if (!currentPlace.flying)
        currentPlace.vel[1] -= timestep * GRAVITY;
      
      // early exit
      if (vec3.length(currentPlace.vel) <= 0) return;
      
      var curPos = currentPlace.pos;
      var curVel = currentPlace.vel;
      var nextPos = vec3.scale(currentPlace.vel, timestep, vec3.create());
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
          if (!type.opaque && type.world && !iworld.gRot(x,y,z) /* rotating-and-unrotating not yet supported */ && level == 0) {
            var scale = type.world.wx;
            var subhit = intersectWorld(
                  aabb.translate([-x, -y, -z]).scale(scale),
                  type.world,
                  IntVectorMap.empty,
                  level + 1);
            if (subhit) subhit.forEach(function (subHitAAB, subPos) {
              hit.set(pos.concat(subPos), subHitAAB.scale(1/scale).translate([x, y, z]));
            });
          } else {
            hit.set(pos, AAB.unitCube(pos));
          }
        }
        return hit.length ? hit : null;
      }
      
      function intersectPlayerAt(pos, ignore) {
        return intersectWorld(playerAABB.translate(pos), world, ignore || IntVectorMap.empty, 0);
      }
      
      function unionHits(hit) {
        var union = [Infinity,-Infinity,Infinity,-Infinity,Infinity,-Infinity];
        hit.forEach(function (aabb) {
          debugHitAABBs.push(aabb); // TODO: misplaced for debug
          union[0] = Math.min(union[0], aabb[0]);
          union[1] = Math.max(union[1], aabb[1]);
          union[2] = Math.min(union[2], aabb[2]);
          union[3] = Math.max(union[3], aabb[3]);
          union[4] = Math.min(union[4], aabb[4]);
          union[5] = Math.max(union[5], aabb[5]);
        });
        return new AAB(union[0],union[1],union[2],union[3],union[4],union[5]);
      }
      
      debugHitAABBs = [];
      
      var alreadyColliding = intersectPlayerAt(curPos);
      
      // To resolve diagonal movement, we treat it as 3 orthogonal moves, updating nextPosIncr.
      var previousStandingOn = currentPlace.standingOn;
      currentPlace.standingOn = null;
      var nextPosIncr = vec3.create(curPos);
      if (config.noclip.get()) {
        nextPosIncr = nextPos;
        currentPlace.flying = true;
      } else {
        for (var dimi = 0; dimi < 3; dimi++) {
          var dim = [1,0,2][dimi]; // TODO: doing the dims in another order makes the slope walking glitch out, but I don't understand *why*.
          var dir = curVel[dim] >= 0 ? 1 : 0;
          nextPosIncr[dim] = nextPos[dim]; // TODO: Sample multiple times if velocity exceeds 1 block/step
          //console.log(dir, dim, playerAABB.get(dim, dir), front, nextPosIncr);
          var hit = intersectPlayerAt(nextPosIncr, alreadyColliding);
          if (hit) {
            var hitAABB = unionHits(hit);
            resolveDirection: {
              // Walk-up-slopes
              if (dim !== 1 /*moving horizontally*/ && currentPlace.standingOn /*not in air*/) {
                var upward = vec3.create(nextPosIncr);
                upward[1] = hitAABB.get(1, 1) - playerAABB.get(1,0) + EPSILON;
                var delta = upward[1] - nextPosIncr[1];
                //console.log("upward test", delta, !!intersectPlayerAt(upward));
                if (delta > 0 && delta < MAX_STEP_UP && !intersectPlayerAt(upward)) {
                  currentPlace.cameraYLag += delta;
                  nextPosIncr = upward;
                  break resolveDirection;
                }
              }
          
              var surfaceOffset = hitAABB.get(dim, 1-dir) - (nextPosIncr[dim] + playerAABB.get(dim, dir));
              nextPosIncr[dim] += surfaceOffset - (dir ? 1 : -1) * EPSILON;
              curVel[dim] /= 10;
              if (dim === 1 && dir === 0) {
                if (hit) {
                  // TODO: eliminate the need for this copy
                  var standingOnMap = new IntVectorMap();
                  hit.forEach(function (aab, cube) {
                    standingOnMap.set(cube.slice(0, 3), true);
                  });
                  currentPlace.standingOn = standingOnMap;
                } else {
                  currentPlace.standingOn = null;
                }
                currentPlace.flying = false;
              }
            }
          }
        }
      }
      
      if (nextPosIncr[1] < 0) {
        // Prevent falling downward indefinitely, without preventing flying under the world (e.g. for editing the bottom of a block).
        currentPlace.flying = true;
      }
      
      if (vec3.length(vec3.subtract(nextPosIncr, currentPlace.pos, vec3.create())) >= EPSILON) {
        vec3.set(nextPosIncr, currentPlace.pos);
        audio.setListener(
          currentPlace.pos,
          [-Math.sin(currentPlace.yaw), 0, -Math.cos(currentPlace.yaw)],
          currentPlace.vel);
        aimChanged();
      }
      if (config.debugPlayerCollision.get()) {
        aabbR.recompute();
        scheduleDraw();
      }
      
      var currentStandingOn = currentPlace.standingOn || IntVectorMap.empty;
      currentStandingOn.forEach(function (aab, cube) {
        world.setStandingOn(cube, true);
      });
      if (previousStandingOn) previousStandingOn.forEach(function (aab, cube) {
        if (!currentStandingOn.has(cube)) {
          world.setStandingOn(cube, false);
        }
      });
    }
    
    this.stepYourselfAndWorld = function (timestep) {
      stepPlayer(timestep);
      currentPlace.world.step(timestep);
    };
    
    // --- The facet for rendering ---
    
    this.render = Object.freeze({
      applyViewRot: function (matrix) {
        mat4.rotate(matrix, -pitch, [1, 0, 0]);
        mat4.rotate(matrix, -currentPlace.yaw, [0, 1, 0]);
      },
      applyViewTranslation: function (matrix) {
        var positionTrans = vec3.negate(currentPlace.pos, vec3.create());
        positionTrans[1] += currentPlace.cameraYLag;
        currentPlace.cameraYLag *= 0.75; /*Math.exp(-timestep*10) TODO we should be like this */
        mat4.translate(matrix, positionTrans);
      },
      getPosition: function() {
        return vec3.create(currentPlace.pos);
      },
      selectionRender: selectionR,
      characterRender: {
        draw: function () {
          if (config.debugPlayerCollision.get()) aabbR.draw();
        }
      },
      getWorldRenderer: function () {
        return currentPlace.wrend;
      }
    });
    this.setPosition = function(p) {
      vec3.set(p, currentPlace.pos);
    };
    this.getWorld = function() {
      return currentPlace.world;
    };
    this.getSelection = function() {
      return currentPlace.selection;
    };
    this.setWorld = function (world) {
      while (placeStack.length) placeStack.pop().wrend.deleteResources();
      currentPlace = new Place(world);
      // TODO: move this position downward to free space rather than just imparting velocity
      this.setPosition([world.wx/2, world.wy - playerAABB.get(1, 0) + EPSILON, world.wz/2]);
      vec3.set([0,-120,0], currentPlace.vel);
      notifyChangedPlace();
    };
    
    // --- The facet for user input ---
    
    var inputNotifier = new Notifier("player.input");
    this.input = Object.freeze({
      listen: inputNotifier.listen,
      
      useTool: function () {
        if (currentPlace.tool === BlockSet.ID_EMPTY) {
          this.deleteBlock();
        } else {
          // create block
          if (currentPlace.selection !== null) {
            var cube = currentPlace.selection.cube;
            var face = currentPlace.selection.face;
            var x = cube[0]+face[0], y = cube[1]+face[1], z = cube[2]+face[2];
            var type = currentPlace.world.blockSet.get(currentPlace.tool);
            if (currentPlace.world.g(x,y,z) === 0) {
              // TODO: rotation on create should be more programmable.
              var raypts = renderer.getAimRay(mousePos, player.render); // TODO depend on player orientation instead?
              var rotation = CubeRotation.nearestToDirection(
                  vec3.subtract(raypts[0], raypts[1]),
                  [0,0,1],
                  type.automaticRotations.map(
                      function (code) { return CubeRotation.byCode[code]; }));
              currentPlace.world.s(x,y,z, currentPlace.tool, rotation.code);
              
              currentPlace.wrend.renderCreateBlock([x,y,z]);
              currentPlace.world.audioEvent([x,y,z], "create");
              aimChanged();
            }
          }
        }
      },
      deleteBlock: function () {
        if (currentPlace.selection !== null) {
          var cube = currentPlace.selection.cube;
          var x = cube[0], y = cube[1], z = cube[2];
          if (currentPlace.world.g(x,y,z) !== 0 /* i.e. would destruction do anything */) { 
            var value = currentPlace.world.g(x,y,z);
            currentPlace.wrend.renderDestroyBlock(cube);
            currentPlace.world.audioEvent(cube, "destroy");
            currentPlace.world.s(x, y, z, 0);
            aimChanged();
          }
        }
      },
      tweakSubdata: function (delta) {
        if (currentPlace.selection !== null) {
          var cube = currentPlace.selection.cube;
          var x = cube[0], y = cube[1], z = cube[2];
          currentPlace.world.sSub(x, y, z,
              mod(currentPlace.world.gSub(x,y,z) + delta, 256)); // TODO magic number
        }
      },
      get blockSet () { return currentPlace.world.blockSet; },
      set blockSet (value) { throw new TypeError("player.input.blockSet read-only"); },
      get movement () { throw new TypeError("player.input.movement write-only"); },
      set movement (value) { 
        vec3.set(value, movement);
        if (movement[1] > 0) {
          currentPlace.flying = true;
        }
      },
      get mousePos () { throw new TypeError("player.input.mousePos write-only"); },
      set mousePos (value) { mousePos = value; aimChanged(); },
      get pitch () { return pitch; },
      set pitch (value) { pitch = value; aimChanged(); },
      get yaw () { return currentPlace.yaw; },
      set yaw (value) { currentPlace.yaw = value; aimChanged(); },
      get tool () { return currentPlace.tool; },
      set tool (value) { 
        currentPlace.tool = value; 
        inputNotifier.notify("changedTool");
      },
      enterWorld: function (blockID) {
        var world = currentPlace.world.blockSet.get(blockID).world;

        if (!world) { return; } // TODO: UI message about this

        var oldPlace = currentPlace;

        currentPlace = new Place(world);
        currentPlace.forBlock = blockID;
        vec3.set([world.wx/2, world.wy - playerAABB.get(1, 0) + EPSILON, world.wz/2], currentPlace.pos);
        placeStack.push(oldPlace);
        aimChanged();

        notifyChangedPlace();
      }, 
      changeWorld: function (direction) {
        switch (direction) {
          case 1:
            if (currentPlace.selection === null) break;
            var cube = currentPlace.selection.cube;
            var x = cube[0], y = cube[1], z = cube[2];
            
            var oldPlace = currentPlace;
            var blockID = currentPlace.world.g(x,y,z);
            
            var world = currentPlace.world.blockSet.worldFor(blockID);
            if (world == null) return; // TODO: UI message about this
            var tileSize = world.wx;
            
            currentPlace = new Place(world);
            
            // This is needed because the routine in aimChanged assumes currentPlace knows the old state of the selection. TODO: Kludgy.
            selectionR.recompute();
            
            // Initial adjustments:
            // Make new position same relative to cube
            vec3.subtract(oldPlace.pos, cube, currentPlace.pos);
            vec3.scale(currentPlace.pos, tileSize);
            // ... but not uselessly far away.
            vec3.scale(currentPlace.pos, Math.min(1.0, (tileSize+40)/vec3.length(currentPlace.pos))); // TODO make relative to center of world, not origin
            // Same velocity, scaled
            vec3.set(oldPlace.vel, currentPlace.vel);
            vec3.scale(currentPlace.vel, tileSize);
            // Same view direction
            currentPlace.yaw = oldPlace.yaw;
            // And not falling.
            currentPlace.flying = true;
            
            placeStack.push(oldPlace);
            aimChanged();
            
            break;
          case -1:
            if (placeStack.length <= 0) return;
            currentPlace.wrend.deleteResources();
            currentPlace = placeStack.pop();
            aimChanged();
            break;
        }
        
        aabbR.recompute();
        notifyChangedPlace();
      },
      jump: function () {
        if (currentPlace.standingOn) currentPlace.vel[1] = JUMP_SPEED;
      }
    });
    
    function notifyChangedPlace() {
      inputNotifier.notify("changedWorld");
    }
    
    // --- Initialization ---
    
    config.debugPlayerCollision.listen({
      changed: function (v) {
        scheduleDraw();
        return true;
      }
    });
    
    this.setWorld(initialWorld);
  }
  
  Player.aabb = playerAABB;
  
  return Player;
}());;
