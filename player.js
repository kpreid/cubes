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
  var CONTROL_STIFFNESS = 0.18;
  
  var playerAABB = new AAB(
    -0.35, 0.35, // x
    -1.75, 0.15, // y
    -0.35, 0.35 // z
  );

  function Player(config, initialWorld, renderer, audio, scheduleDraw) {
    var player = this;
    var gl = renderer.context;
    
    // a Place stores a world and location in it; used for push/pop
    function Place(world) {
      this.world = world;
      var body = this.body = new Body(config, world, playerAABB);
      this.selection = null;
      this.tool = 2; // first non-bogus block id

      // must happen late
      this.wrend = new WorldRenderer(world, function () { return body.pos; }, renderer, audio, scheduleDraw, true);
    }
    Place.prototype.delete = function () {
      this.wrend.deleteResources();
    };

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
        renderer.setLineWidth(1);
        gl.disable(gl.DEPTH_TEST);
        draw();
        gl.enable(gl.DEPTH_TEST);
      }
    });
    
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
      renderAABB(currentPlace.body.pos, playerAABB, 0,0,1);
      currentPlace.body.debugHitAABBs.forEach(function (aabb) {
        renderAABB(ZEROVEC, aabb, 0,1,0);
      })
    }, {aroundDraw: function (draw) {
      if (!config.debugPlayerCollision.get()) return;
      renderer.setLineWidth(2);
      draw();
    }});
    
    function _transformPointToSubworld(cube,world,rot,point) {
      var buf = vec3.create(point);
      vec3.subtract(buf, cube);
      rot.transformPoint(buf, buf);
      vec3.scale(buf, world.wx); // cubical assumption
      return buf;
    }
    
    function aimChanged() {
      scheduleDraw(); // because this routine is also 'view direction changed'

      var foundCube = null, foundFace = null;
      if (mousePos !== null) {
        var w = currentPlace.world;
        var pts = renderer.getAimRay(mousePos, player.render);
        w.raycast(pts[0], pts[1], 20, function (x,y,z,value,face) {
          if (w.selectable(x,y,z)) {
            var cube = Object.freeze([x,y,z]);
            var type = w.blockSet.get(value);
            var subfound = false;
            if (!type.opaque && type.world) {
              // test against shape of noncubical block
              var w1 = type.world;
              var rot = CubeRotation.byCode[w.gRot(x,y,z)].inverse;
              w1.raycast(_transformPointToSubworld(cube,w1,rot,pts[0]),
                         _transformPointToSubworld(cube,w1,rot,pts[1]),
                         Infinity,
                         function (x1,y1,z1,v1,f1) {
                if (w1.selectable(x1,y1,z1)) {
                  subfound = true;
                  return true;
                }
              });
              if (!subfound) return;
            }
            foundCube = cube;
            foundFace = Object.freeze(Array.prototype.slice.call(face));
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
    
    function updateAudioListener() {
      audio.setListener.apply(audio, currentPlace.body.getListenerParameters());
    }
    
    var footstepPhase = 0;
    var footstepPeriod = 1.4;
    var footstepY = 0;
    
    var EPSILON = 1e-3;
    function stepPlayer(timestep) {
      var body = currentPlace.body;
      
      // apply movement control to velocity
      var controlOrientation = mat4.rotateY(mat4.identity(mat4.create()), body.yaw);
      var movAdj = vec3.create();
      mat4.multiplyVec3(controlOrientation, movement, movAdj);
      vec3.scale(movAdj, body.flying ? FLYING_SPEED : WALKING_SPEED);

      body.addVelocity([
        (movAdj[0] - body.vel[0]) * CONTROL_STIFFNESS,
        body.flying ? (movAdj[1] - body.vel[1]) * CONTROL_STIFFNESS
        : movAdj[1] !== 0 ? (movAdj[1] - body.vel[1]) * CONTROL_STIFFNESS + timestep * GRAVITY : 0,
        (movAdj[2] - body.vel[2]) * CONTROL_STIFFNESS]);

      body.step(timestep, function () {
        updateAudioListener();
        aimChanged();

        if (vec3.length(movement) < EPSILON) {
          footstepPhase = 0;
        } else {
          footstepPhase += vec3.length(body.vel) * timestep;
        }
        if (footstepPhase > footstepPeriod) {
          footstepPhase = mod(footstepPhase, footstepPeriod);
          playFootstep();
        } else if (body.pos[1] < footstepY || body.pos[1] > footstepY && footstepPhase > 0.4) {
          // footstep sooner if just hit a bump or fell down
          footstepPhase = 0;
          playFootstep();
        }
        function playFootstep() {
          footstepY = body.pos[1];
          var type, pos;
          (body.standingOn || IntVectorMap.empty).forEach(function (junk, pi) {
            pos = pi;
            type = body.world.gtv(pos);
          });
          if (type) {
            audio.play(pos, type, "footstep", 0.5);
          }
        }
      });
    }
    
    this.stepYourselfAndWorld = function (timestep) {
      stepPlayer(timestep);
      currentPlace.world.step(timestep);
      currentPlace.world.polishLightInVicinity(currentPlace.body.pos, config.renderDistance.get(), 1);
      if (config.debugPlayerCollision.get()) {
        aabbR.recompute();
        scheduleDraw();
      }
    };
    
    // --- The facet for rendering ---
    
    this.render = Object.freeze({
      applyViewRot: function (matrix) {
        mat4.rotate(matrix, -pitch, [1, 0, 0]);
        mat4.rotate(matrix, -currentPlace.body.yaw, [0, 1, 0]);
      },
      applyViewTranslation: function (matrix) {
        var positionTrans = vec3.negate(currentPlace.body.pos, vec3.create());
        positionTrans[1] += currentPlace.body.cameraYLag;
        currentPlace.body.cameraYLag *= 0.75; /*Math.exp(-timestep*10) TODO we should be like this */
        mat4.translate(matrix, positionTrans);
      },
      getPosition: function() {
        return vec3.create(currentPlace.body.pos);
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
      vec3.set(p, currentPlace.body.pos);
      updateAudioListener();
    };
    this.getWorld = function() {
      return currentPlace.world;
    };
    this.getSelection = function() {
      return currentPlace.selection;
    };
    this.setWorld = function (world) {
      if (currentPlace) currentPlace.delete();
      while (placeStack.length) placeStack.pop().delete();
      currentPlace = new Place(world);
      // TODO: move this position downward to free space rather than just imparting velocity
      this.setPosition([world.wx/2, world.wy - playerAABB.get(1, 0) + EPSILON, world.wz/2]);
      vec3.set([0,-120,0], currentPlace.body.vel);
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
              mod(currentPlace.world.gSub(x,y,z) + delta, World.subdatumBound));
        }
      },
      get blockSet () { return currentPlace.world.blockSet; },
      set blockSet (value) { throw new TypeError("player.input.blockSet read-only"); },
      get movement () { throw new TypeError("player.input.movement write-only"); },
      set movement (value) { 
        vec3.set(value, movement);
        if (movement[1] > 0) {
          currentPlace.body.flying = true;
        }
      },
      get mousePos () { throw new TypeError("player.input.mousePos write-only"); },
      set mousePos (value) { mousePos = value; aimChanged(); },
      get pitch () { return pitch; },
      set pitch (value) { pitch = value; aimChanged(); },
      get yaw () { return currentPlace.body.yaw; },
      set yaw (value) { currentPlace.body.yaw = value; aimChanged(); },
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
        vec3.set([world.wx/2, world.wy - playerAABB.get(1, 0) + EPSILON, world.wz/2], currentPlace.body.pos);
        placeStack.push(oldPlace);
        updateAudioListener();
        aimChanged();

        notifyChangedPlace();
      }, 
      changeWorld: function (direction) {
        switch (direction) {
          case 1:
            if (currentPlace.selection === null) return;
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
            vec3.subtract(oldPlace.body.pos, cube, currentPlace.body.pos);
            vec3.scale(currentPlace.body.pos, tileSize);
            // ... but not uselessly far away.
            vec3.scale(currentPlace.body.pos, Math.min(1.0, (tileSize+40)/vec3.length(currentPlace.body.pos))); // TODO make relative to center of world, not origin
            // Same velocity, scaled
            vec3.set(oldPlace.body.vel, currentPlace.body.vel);
            vec3.scale(currentPlace.body.vel, tileSize);
            // Same view direction
            currentPlace.body.yaw = oldPlace.body.yaw;
            // And not falling.
            currentPlace.body.flying = true;
            
            placeStack.push(oldPlace);
            
            break;
          case -1:
            if (placeStack.length <= 0) return;
            currentPlace.delete();
            currentPlace = placeStack.pop();
            break;
        }
        
        aimChanged();
        aabbR.recompute();
        updateAudioListener();
        notifyChangedPlace();
      },
      jump: function () {
        currentPlace.body.jump([0, JUMP_SPEED, 0]);
      }
    });
    
    function notifyChangedPlace() {
      inputNotifier.notify("changedWorld");
    }
    
    // --- Initialization ---
    
    config.debugPlayerCollision.listen({
      interest: function () { return true; },
      changed: scheduleDraw
    });
    
    this.setWorld(initialWorld);
  }
  
  Player.aabb = playerAABB;
  
  return Player;
}());;
