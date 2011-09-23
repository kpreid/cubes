// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Player = (function () {
  // physics constants
  var PLAYER_SPEED = 5; // cubes/s
  var GRAVITY = 20; // cubes/s^2
  var JUMP_SPEED = 10; // cubes/s
  
  var movement = vec3.create([0,0,0]);
  
  // a Place stores a world and location in it; used for push/pop
  function Place(world) {
    this.world = world;
    this.pos = vec3.create([0,0,0]);
    this.vel = vec3.create([0,0,0]);
    this.yaw = Math.PI/4 * 5;
    this.onGround = false;

    // Current tool/block id
    this.tool = 2; // first non-bogus block id

    // must happen late
    this.wrend = new WorldRenderer(world, this); // ideally, would be readonly(this)
    
  }
  
  function Player(initialWorld) {
    "use strict";
    
    // Worlds we've been in
    var placeStack = [];
    var currentPlace = new Place(initialWorld);

    // kludge: Since UI sets pitch absolutely, it's not a place variable
    var pitch = 0;
  
    function aimChanged() {
      scheduleDraw(); // because this routine is also 'view direction changed'

      var oldSel = ""+cubeSelection+""+emptySelection; // TODO: global variables
      cubeSelection = emptySelection = null;

      var w = currentPlace.world;
      raycastFromScreen(20, function (x,y,z) {
        if (w.solid(x,y,z)) {
          cubeSelection = [x,y,z];
          return true;
        } else {
          emptySelection = [x,y,z];
          return false;
        }
      });

      // prevent selecting the edges of the world
      if (cubeSelection === null)
        emptySelection = null;

      // redraw
      if (""+cubeSelection+""+emptySelection !== oldSel) {
        selectionR.recompute();
        scheduleDraw(); // TODO: global variables
      }
    }
    
    var playerAABB = [
      [-.7, .7], // x
      [-3.4, .45], // y
      [-.7, .7], // z
    ];

    this.renderDebug = function (vertices, colors) {
      [[0,1,2], [1,2,0], [2,0,1]].forEach(function (dims) {
        for (var du = 0; du < 2; du++)
        for (var dv = 0; dv < 2; dv++)
        for (var dw = 0; dw < 2; dw++) {
          var p = vec3.create(currentPlace.pos);
          p[dims[0]] += playerAABB[dims[0]][du];
          p[dims[1]] += playerAABB[dims[1]][dv];
          p[dims[2]] += playerAABB[dims[2]][dw];
          
          vertices.push(p[0],p[1],p[2]);
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
      
      vec3.set(nextPosIncr, currentPlace.pos);
      aimChanged();
      
      debugR.recompute();
    };
    
    this.stepYourselfAndWorld = function () {
      stepPlayer();
      currentPlace.world.step(currentPlace.wrend);
    }
    
    // The facet for rendering
    this.render = Object.freeze({
      applyViewPitch: function (matrix) {
        mat4.rotate(matrix, -pitch, [1, 0, 0]);
      },
      applyViewRotTranslation: function (matrix) {
        mat4.rotate(matrix, -currentPlace.yaw, [0, 1, 0]);
        var positionTrans = vec3.negate(currentPlace.pos, vec3.create());
        mat4.translate(matrix, positionTrans);
      },
      getPosition: function() {
        return vec3.create(currentPlace.pos);
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
    
    // The facet for user input
    this.input = Object.freeze({
      click: function (button /* currently defunct */) {
        var changed = false;
        if (currentPlace.tool == BlockSet.ID_EMPTY) {
          // delete block
          // TODO: global variables
          if (cubeSelection != null) {
            var x = cubeSelection[0], y = cubeSelection[1], z = cubeSelection[2];
            if (currentPlace.world.solid(x,y,z)) {
              var value = currentPlace.world.g(x,y,z);
              currentPlace.world.s(x,y,z,0);
              currentPlace.wrend.renderDestroyBlock(cubeSelection, value);
              changed = true;
            }
          }
        } else {
          // create block
          if (emptySelection != null) {
            var x = emptySelection[0], y = emptySelection[1], z = emptySelection[2];
            if (!currentPlace.world.solid(x,y,z)) {
              currentPlace.world.s(x,y,z, currentPlace.tool);
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
        // TODO: global variables cubeSelection, aimChanged
        switch (direction) {
          case 1:
            if (cubeSelection == null) break;
            var x = cubeSelection[0], y = cubeSelection[1], z = cubeSelection[2];
            
            var oldPlace = currentPlace;
            
            var world = currentPlace.world.blockSet.worldFor(currentPlace.world.g(x,y,z));
            if (world == null) return; // TODO: UI message about this
            
            currentPlace = new Place(world);
            vec3.set([World.TILE_SIZE/2, World.TILE_SIZE - playerAABB[1][0] + EPSILON, World.TILE_SIZE/2], currentPlace.pos);
            placeStack.push(oldPlace);
            aimChanged();
            
            break;
          case -1:
            if (placeStack.length <= 0) break;
            currentPlace.wrend.deleteResources();
            currentPlace = placeStack.pop();
            currentPlace.wrend.rebuildBlocks(); // TODO: kludge
            aimChanged();
            break;
        }
      },
      jump: function () {
        if (currentPlace.onGround) currentPlace.vel[1] = JUMP_SPEED;
      }
    });
  }
  
  return Player;
})();