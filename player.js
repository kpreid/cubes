// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Player = (function () {
  "use strict";
  
  // physics constants
  var WALKING_SPEED = 4; // cubes/s
  var FLYING_SPEED = 10; // cubes/s
  var GRAVITY = 20; // cubes/s^2
  var JUMP_SPEED = 8; // cubes/s
  
  var playerAABB = [
    [-.35, .35], // x
    [-1.75, .15], // y
    [-.35, .35], // z
  ];

  var PLACEHOLDER_ROTATIONS = [];
  for (var i = 0; i < applyCubeSymmetry.NO_REFLECT_COUNT; i++) {
    PLACEHOLDER_ROTATIONS.push(i);
  }
  
  function Player(initialWorld, renderer, scheduleDraw) {
    "use strict";
    var player = this;
    var gl = renderer.context;
    
    // a Place stores a world and location in it; used for push/pop
    function Place(world) {
      // Body state
      this.world = world;
      this.pos = vec3.create([0,0,0]);
      this.vel = vec3.create([0,0,0]);
      this.yaw = Math.PI/4 * 5;
      this.standingOn = [];
      this.flying = false;

      // Selection
      this.selection = null;

      // Current tool/block id
      this.tool = 2; // first non-bogus block id

      // must happen late
      this.wrend = new WorldRenderer(world, this /* TODO: facet */, renderer, scheduleDraw, true);

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
        
        if (qp[0]+qp[1]+qp[2] > 0)
          vec3.subtract(p, qr);
        else
          vec3.subtract(p, qp);
        
        colors.push(1,1,1,1); normals.push(0,0,0); vertices.push(p[0],p[1],p[2]);
        colors.push(1,1,1,1); normals.push(0,0,0); vertices.push(p[0]+qr[0],p[1]+qr[1],p[2]+qr[2]);
        colors.push(1,1,1,1); normals.push(0,0,0); vertices.push(p[0]+qr[0]+qs[0],p[1]+qr[1]+qs[1],p[2]+qr[2]+qs[2]);
        colors.push(1,1,1,1); normals.push(0,0,0); vertices.push(p[0]+qs[0],p[1]+qs[1],p[2]+qs[2]);
      }
    }, {
      aroundDraw: function (draw) {
        gl.disable(gl.DEPTH_TEST);
        draw();
        gl.enable(gl.DEPTH_TEST);
      }
    });
    
    var aabbR = new renderer.RenderBundle(gl.LINES, null, function (vertices, normals, colors) {
      // TODO: Would be more efficient to use the modelview matrix than recomputing this?
      if (!currentPlace) return;
      [[0,1,2], [1,2,0], [2,0,1]].forEach(function (dims) {
        for (var du = 0; du < 2; du++)
        for (var dv = 0; dv < 2; dv++)
        for (var dw = 0; dw < 2; dw++) {
          var p = vec3.create(currentPlace.pos);
          p[dims[0]] += playerAABB[dims[0]][du];
          p[dims[1]] += playerAABB[dims[1]][dv];
          p[dims[2]] += playerAABB[dims[2]][dw];
          
          vertices.push(p[0],p[1],p[2]);
          normals.push(0,0,0);
          colors.push(0,0,1,1);
        }
      });
    });
  
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
      
      if (foundCube !== null) {
        var newSel = Object.freeze({
          cube: foundCube,
          face: foundFace,
          toString: function () { return this.cube + ";" + this.face; }
        });
      } else {
        var newSel = null;
      }
      
      if ("" + currentPlace.selection !== "" + newSel) {
        currentPlace.selection = newSel;
        selectionR.recompute();
        scheduleDraw(); // TODO: global variable 
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
        if (movAdj[1] != 0)
          currentPlace.vel[1] += (movAdj[1] - currentPlace.vel[1]) * 0.4 + timestep * GRAVITY;
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

      function intersectWorld(aabb, iworld, ignore) {
        ignore = ignore || {};
        var hit = {};
        var hitCount = 0;
        var str;        
        var hx = Math.floor(aabb[0][1]);
        var hy = Math.floor(aabb[1][1]);
        var hz = Math.floor(aabb[2][1]);
        for (var x = Math.floor(aabb[0][0]); x <= hx; x++)
        for (var y = Math.floor(aabb[1][0]); y <= hy; y++)
        for (var z = Math.floor(aabb[2][0]); z <= hz; z++) {
          var type = iworld.gt(x,y,z);
          if (!type.solid) continue;
          if (ignore[str = x+","+y+","+z]) continue;
          if (!type.opaque && type.world) {
            if (!intersectWorld(
                  scaleAABB(type.world.wx, offsetAABB([-x, -y, -z], aabb)),
                  type.world)) continue;
            // TODO: Return information about collision boundaries, so that collision response can be correct
          }

          hit[str] = [x,y,z];
          hitCount++;
        }
        return hitCount > 0 ? hit : null;
      }
      
      function intersectPlayerAt(pos, ignore) {
        return intersectWorld(offsetAABB(pos, playerAABB), world, ignore);
      }
      
      var alreadyColliding = intersectPlayerAt(curPos);
      
      // To resolve diagonal movement, we treat it as 3 orthogonal moves, updating nextPosIncr.
      var previousStandingOn = currentPlace.standingOn;
      currentPlace.standingOn = null;
      var nextPosIncr = vec3.create(curPos);
      for (var dim = 0; dim < 3; dim++) {
        var dir = curVel[dim] >= 0 ? 1 : 0;
        var front = nextPos[dim] + playerAABB[dim][dir];
        var partial = vec3.create(nextPosIncr);
        partial[dim] = nextPos[dim]; // TODO: Sample multiple times if velocity exceeds 1 block/step
        //console.log(dir, dim, playerAABB[dim][dir], front, partial);
        var hit;
        if ((hit = intersectPlayerAt(partial, alreadyColliding))) {
          //console.log("clamped", dim);
          nextPosIncr[dim] = dir 
            ? Math.ceil(nextPosIncr[dim] + playerAABB[dim][dir] % 1) - playerAABB[dim][dir] % 1 - EPSILON
            : Math.floor(nextPosIncr[dim] + playerAABB[dim][dir] % 1) - playerAABB[dim][dir] % 1 + EPSILON;
          curVel[dim] = 0;
          if (dim == 1 && dir == 0) {
            currentPlace.standingOn = hit || {};
            currentPlace.flying = false;
          }
        } else {
          nextPosIncr[dim] = nextPos[dim];          
        }
      }
      
      if (nextPosIncr[1] < 0) {
        // Prevent falling downward indefinitely, without preventing flying under the world (e.g. for editing the bottom of a block).
        currentPlace.flying = true;
      }
      
      if (vec3.length(vec3.subtract(nextPosIncr, currentPlace.pos, vec3.create())) >= EPSILON) {
        vec3.set(nextPosIncr, currentPlace.pos);
        CubesAudio.setListener(
          currentPlace.pos,
          [-Math.sin(currentPlace.yaw), 0, -Math.cos(currentPlace.yaw)],
          currentPlace.vel);
        aimChanged();
      }
      aabbR.recompute();
      
      var seen = {};
      for (var k in currentPlace.standingOn || {}) {
        if (!currentPlace.standingOn.hasOwnProperty(k)) continue;
        var cube = currentPlace.standingOn[k];
        seen[cube] = true;
        world.setStandingOn(cube, true);
      }
      for (var k in previousStandingOn || {}) {
        if (!previousStandingOn.hasOwnProperty(k)) continue;
        var cube = previousStandingOn[k];
        if (!seen[cube]) {
          world.setStandingOn(cube, false);
        }
      }
    };
    
    this.stepYourselfAndWorld = function (timestep) {
      stepPlayer(timestep);
      currentPlace.world.step(timestep);
    }
    
    // --- The facet for rendering ---
    
    this.render = Object.freeze({
      applyViewRot: function (matrix) {
        mat4.rotate(matrix, -pitch, [1, 0, 0]);
        mat4.rotate(matrix, -currentPlace.yaw, [0, 1, 0]);
      },
      applyViewTranslation: function (matrix) {
        var positionTrans = vec3.negate(currentPlace.pos, vec3.create());
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
      this.setPosition([world.wx/2, world.wy - playerAABB[1][0] + EPSILON, world.wz/2]);
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
            if (currentPlace.world.g(x,y,z) == 0) {
              // TODO: rotation on create should be more programmable.
              var raypts = renderer.getAimRay(mousePos, player.render); // TODO depend on player orientation instead?
              var symm = nearestCubeSymmetry(vec3.subtract(raypts[0], raypts[1]), [0,0,1], type.automaticRotations);
              currentPlace.world.s(x,y,z, currentPlace.tool, symm);
              
              currentPlace.wrend.renderCreateBlock([x,y,z]);
              aimChanged();
              CubesAudio.play(vec3.add([0.5,0.5,0.5], cube), type, "create");
            }
          }
        }
      },
      deleteBlock: function () {
        if (currentPlace.selection !== null) {
          var cube = currentPlace.selection.cube;
          var x = cube[0], y = cube[1], z = cube[2];
          if (currentPlace.world.g(x,y,z) != 0 /* i.e. would destruction do anything */) { 
            var value = currentPlace.world.g(x,y,z);
            currentPlace.wrend.renderDestroyBlock(cube);
            currentPlace.world.s(x, y, z, 0);
            aimChanged();
            CubesAudio.play(vec3.add([0.5,0.5,0.5], cube), currentPlace.world.blockSet.get(value), "destroy");
          }
        }
      },
      get blockSet () { return currentPlace.world.blockSet; },
      set movement (vec) { 
        vec3.set(vec, movement);
        if (movement[1] > 0) currentPlace.flying = true;
      },
      set mousePos (vec) { mousePos = vec; aimChanged(); },
      get pitch () { return pitch; },
      set pitch (angle) { pitch = angle; aimChanged(); },
      get yaw () { return currentPlace.yaw; },
      set yaw (angle) { currentPlace.yaw = angle; aimChanged(); },
      get tool () { return currentPlace.tool; },
      set tool (id) { 
        currentPlace.tool = id; 
        inputNotifier.notify("changedTool");
      },
      enterWorld: function (blockID) {
        var world = currentPlace.world.blockSet.get(blockID).world;

        if (!world) return; // TODO: UI message about this

        var oldPlace = currentPlace;

        currentPlace = new Place(world);
        currentPlace.forBlock = blockID;
        vec3.set([world.wx/2, world.wy - playerAABB[1][0] + EPSILON, world.wz/2], currentPlace.pos);
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
            // They'll probably end up in the air...
            currentPlace.flying = true;
            // but in the ground would be bad.
            if (currentPlace.pos[1] + playerAABB[1][0] < 0)
              currentPlace.pos[1] = -playerAABB[1][0] + EPSILON;
            
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
      inputNotifier.notify("changedTool");
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
})();