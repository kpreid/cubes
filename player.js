var Player = (function () {
  var PLAYER_SPEED = 6;
  var movement = vec3.create([0,0,0]);
  
  // a Place stores a world and location in it; used for push/pop
  function Place(world) {
    this.world = world;
    this.pos = vec3.create([0,0,0]);
    this.vel = vec3.create([0,0,0]);
    this.yaw = Math.PI/4 * 5;

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
      needsDraw = true; // because this routine is also 'view direction changed'

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
        needsDraw = true; // TODO: global variables
      }
    }

    this.step = function () {
      vec3.set(movement, currentPlace.vel);
      
      if (vec3.length(currentPlace.vel) > 0) {
        var rotmat = mat4.rotateY(mat4.identity(mat4.create()), currentPlace.yaw);
        var velOriented = mat4.multiplyVec3(rotmat, currentPlace.vel, vec3.create());
        var velStep = vec3.scale(velOriented, timestep*PLAYER_SPEED, vec3.create());
        vec3.add(currentPlace.pos, velStep);

        aimChanged();
      }
    };
    this.render = {
      applyViewTransform: function (matrix) {
        // look direction
        mat4.rotate(matrix, -pitch, [1, 0, 0]);
        mat4.rotate(matrix, -currentPlace.yaw, [0, 1, 0]);
      
        // position
        var positionTrans = vec3.negate(currentPlace.pos, vec3.create());
        mat4.translate(matrix, positionTrans);
      }
    };
    this.getPosition = function() {
      return vec3.create(currentPlace.pos);
    };
    this.setPosition = function(p) {
      vec3.set(p, currentPlace.pos);
    };
    this.getWorld = function() {
      return currentPlace.world;
    };
    this.getWorldRenderer = function() {
      return currentPlace.wrend;
    };
    
    this.input = Object.freeze({
      click: function (button /* currently defunct */) {
        var changed = false;
        if (currentPlace.tool == BlockSet.ID_EMPTY) {
          // delete block
          // TODO: global variables
          if (cubeSelection != null) {
            var x = cubeSelection[0], y = cubeSelection[1], z = cubeSelection[2];
            if (currentPlace.world.solid(x,y,z)) {
              currentPlace.world.s(x,y,z,0);
              currentPlace.wrend.dirtyBlock(x,z);
              changed = true;
            }
          }
        } else {
          // create block
          if (emptySelection != null) {
            var x = emptySelection[0], y = emptySelection[1], z = emptySelection[2];
            if (!currentPlace.world.solid(x,y,z)) {
              currentPlace.world.s(x,y,z, currentPlace.tool);
              currentPlace.wrend.dirtyBlock(x,z);
              changed = true;
            }
          }
        }
        if (changed) {
          aimChanged(); // block aimed at moved...
          needsDraw = true;
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
            vec3.set([World.TILE_SIZE/2, World.TILE_SIZE + 2, World.TILE_SIZE/2], currentPlace.pos);
            placeStack.push(oldPlace);
            aimChanged();
            
            break;
          case -1:
            if (placeStack.length <= 0) break;
            currentPlace = placeStack.pop();
            currentPlace.wrend.rebuildBlockTexture(); // TODO: kludge
            aimChanged();
            break;
        }
      }
    });
  }
  
  return Player;
})();