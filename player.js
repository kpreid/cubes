// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Player = (function () {
  // physics constants
  var PLAYER_SPEED = 5; // cubes/s
  var GRAVITY = 20; // cubes/s^2
  var JUMP_SPEED = 10; // cubes/s
  
  var PLACEHOLDER_ROTATIONS = [];
  for (var i = 0; i < applyCubeSymmetry.NO_REFLECT_COUNT; i++) {
    PLACEHOLDER_ROTATIONS.push(i);
  }
  
  var movement = vec3.create([0,0,0]);
  
  // a Place stores a world and location in it; used for push/pop
  function Place(world) {
    // Body state
    this.world = world;
    this.pos = vec3.create([0,0,0]);
    this.vel = vec3.create([0,0,0]);
    this.yaw = Math.PI/4 * 5;
    this.onGround = false;

    // Selection
    this.selection = null;

    // Current tool/block id
    this.tool = 2; // first non-bogus block id

    // must happen late
    this.wrend = new WorldRenderer(world, this); // ideally, would be readonly(this)
    
  }
  
  function Player(initialWorld) {
    "use strict";
    
    // Worlds we've been in
    var placeStack = [];
    var currentPlace;

    // kludge: Since UI sets pitch absolutely, it's not a place variable
    var pitch = 0;
  
    var selectionR = new RenderBundle(gl.LINE_LOOP, null, function (vertices, normals, colors) {
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
  
    function aimChanged() {
      scheduleDraw(); // because this routine is also 'view direction changed'

      var foundCube = null, foundFace = null;

      var w = currentPlace.world;
      raycastFromScreen(20, function (x,y,z,value,face) {
        if (w.solid(x,y,z)) {
          foundCube = Object.freeze([x,y,z]);
          foundFace = face;
          return true;
        }
      });
      // Note: If we ever want to enable selection of the edges of the world,
      // then that can be done by noting the last cube the raycast hit.
      
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
    
    var playerAABB = [
      [-.7, .7], // x
      [-3.4, .45], // y
      [-.7, .7], // z
    ];

    this.renderDebug = function (vertices, normals, colors) {
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
    }

    var EPSILON = 1e-3;
    function stepPlayer() {
      var world = currentPlace.world;
      
      // apply movement control to velocity
      var controlOrientation = mat4.rotateY(mat4.identity(mat4.create()), currentPlace.yaw);
      var movAdj = vec3.create();
      mat4.multiplyVec3(controlOrientation, movement, movAdj);
      vec3.scale(movAdj, PLAYER_SPEED);
      //console.log(vec3.str(movAdj));
      currentPlace.vel[0] += (movAdj[0] - currentPlace.vel[0]) * 0.4;
      if (movAdj[1] != 0)
      currentPlace.vel[1] += (movAdj[1] - currentPlace.vel[1]) * 0.4 + TIMESTEP * GRAVITY;
      currentPlace.vel[2] += (movAdj[2] - currentPlace.vel[2]) * 0.4;
      
      // gravity
      currentPlace.vel[1] -= TIMESTEP * GRAVITY;
      
      // early exit
      if (vec3.length(currentPlace.vel) <= 0) return;
      
      var curPos = currentPlace.pos;
      var curVel = currentPlace.vel;
      var nextPos = vec3.scale(currentPlace.vel, TIMESTEP, vec3.create()); // TODO global variable timestep
      vec3.add(nextPos, curPos);
      
      // collision
      function sclamp(vec) {
        // TODO: Clean up and optimize this mess
        function nd(dim2,dir2) {return playerAABB[dim2][dir2]; }
        var buf = vec3.create();
        for (var fixed = 0; fixed < 3; fixed++) {
          for (var fdir = 0; fdir < 2; fdir++) {
            var fplane = vec[fixed] + nd(fixed, fdir);
            var a = fixed == 0 ? 1 : 0;
            var b = fixed == 2 ? 1 : 2;
            buf[fixed] = Math.floor(fplane);
            for (var ai = vec[a]+nd(a,0); ai < vec[a]+nd(a,1); ai++) {
              for (var bi = vec[b]+nd(b,0); bi < vec[b]+nd(b,1); bi++) {
                buf[a] = Math.floor(ai);
                buf[b] = Math.floor(bi);
                if (world.solid(buf[0],buf[1],buf[2])) return true;
              }
              buf[b] = Math.floor(vec[b]+nd(b,1));
              if (world.solid(buf[0],buf[1],buf[2])) return true;
            }
            buf[a] = Math.floor(vec[a]+nd(a,1));
            if (world.solid(buf[0],buf[1],buf[2])) return true;
          }
        }
      }
      
      // To resolve diagonal movement, we treat it as 3 orthogonal moves, updating nextPosIncr.
      currentPlace.onGround = false;
      var nextPosIncr = vec3.create(curPos);
      for (var dim = 0; dim < 3; dim++) {
        var dir = curVel[dim] >= 0 ? 1 : 0;
        var front = nextPos[dim] + playerAABB[dim][dir];
        var partial = vec3.create(nextPosIncr);
        partial[dim] = nextPos[dim]; // TODO: Sample multiple times if velocity exceeds 1 block/step
        //console.log(dir, dim, playerAABB[dim][dir], front, partial);
        if (sclamp(partial) || (dim == 1 && front < 0)) {
          //console.log("clamped", dim);
          nextPosIncr[dim] = dir ? Math.ceil(nextPosIncr[dim] + playerAABB[dim][dir] % 1) - playerAABB[dim][dir] % 1 - EPSILON : Math.floor(nextPosIncr[dim] + playerAABB[dim][dir] % 1) - playerAABB[dim][dir] % 1 + EPSILON;
          curVel[dim] = 0;
          if (dim == 1 && dir == 0) {
            currentPlace.onGround = true;
          }
        } else {
          nextPosIncr[dim] = nextPos[dim];
        }
        if (sclamp(nextPosIncr)) {
          // Player got stuck.
          //debugger;
        }
      }
      
      if (vec3.length(vec3.subtract(nextPosIncr, currentPlace.pos, vec3.create())) >= EPSILON) {
        vec3.set(nextPosIncr, currentPlace.pos);
        aimChanged();
      }
      debugR.recompute();
    };
    
    this.stepYourselfAndWorld = function () {
      stepPlayer();
      currentPlace.world.step();
    }
    
    // The facet for rendering
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
      this.setPosition([world.wx/2, world.wy + playerAABB[1][0], world.wz/2]);
      vec3.set([0,-120,0], currentPlace.vel);
    };
    
    // The facet for user input
    this.input = Object.freeze({
      click: function (button /* currently defunct */) {
        var changed = false;
        if (currentPlace.tool == BlockSet.ID_EMPTY) {
          // delete block
          // TODO: global variables
          if (currentPlace.selection !== null) {
            var cube = currentPlace.selection.cube;
            var x = cube[0], y = cube[1], z = cube[2];
            if (currentPlace.world.solid(x,y,z)) {
              var value = currentPlace.world.g(x,y,z);
              currentPlace.wrend.renderDestroyBlock(cube);
              currentPlace.world.s(x, y, z, 0);
              changed = true;
            }
          }
        } else {
          // create block
          if (currentPlace.selection !== null) {
            var cube = currentPlace.selection.cube;
            var face = currentPlace.selection.face;
            var x = cube[0]+face[0], y = cube[1]+face[1], z = cube[2]+face[2];
            var type = currentPlace.world.blockSet.get(currentPlace.tool);
            if (!currentPlace.world.solid(x,y,z)) {
              var raypts = getAimRay();
              var symm = nearestCubeSymmetry(vec3.subtract(raypts[0], raypts[1]), [0,0,1], type.automaticRotations);
              currentPlace.world.s(x,y,z, currentPlace.tool, symm);
              currentPlace.wrend.renderCreateBlock([x,y,z], value);
              changed = true;
            }
          }
        }
        if (changed) {
          aimChanged(); // block aimed at moved...
        }
      },
      get blockSet () { return currentPlace.world.blockSet; },
      set movement (vec) { vec3.set(vec, movement); },
      get pitch () { return pitch; },
      set pitch (angle) { pitch = angle; aimChanged(); },
      get yaw () { return currentPlace.yaw; },
      set yaw (angle) { currentPlace.yaw = angle; aimChanged(); },
      get tool () { return currentPlace.tool; },
      set tool (id) { currentPlace.tool = id; aimChanged(); },
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
            
            currentPlace = new Place(world);
            currentPlace.forBlock = blockID;
            vec3.set([World.TILE_SIZE/2, World.TILE_SIZE - playerAABB[1][0] + EPSILON, World.TILE_SIZE/2], currentPlace.pos);
            placeStack.push(oldPlace);
            aimChanged();
            
            break;
          case -1:
            if (placeStack.length <= 0) break;
            currentPlace.wrend.deleteResources();
            var blockID = currentPlace.forBlock;
            currentPlace = placeStack.pop();
            if (blockID) currentPlace.wrend.rebuildBlock(blockID);
            aimChanged();
            break;
        }
      },
      jump: function () {
        if (currentPlace.onGround) currentPlace.vel[1] = JUMP_SPEED;
      }
    });
    
    this.setWorld(initialWorld);
  }
  
  return Player;
})();