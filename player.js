var Player = (function () {
  var PLAYER_SPEED = 6;
  
  function Player() {
    "use strict";
  
    var pos = vec3.create([8,18,8]);
    var vel = vec3.create([0,0,0]);
    var yaw = Math.PI/4 * 5;
    var pitch = 0;

    function aimChanged() {
      needsDraw = true; // because this routine is also 'view direction changed'

      var oldSel = ""+cubeSelection+""+emptySelection;
      cubeSelection = emptySelection = null;

      raytraceFromScreen([0,0], 20, function (x,y,z) {
        var wx = world.wx;
        var wy = world.wy;
        var wz = world.wz;
        if (world.solid(x,y,z)) {
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
        needsDraw = true;
      }
    }

    this.step = function () {
      if (vec3.length(vel) > 0) {
        var rotmat = mat4.rotateY(mat4.identity(mat4.create()), yaw);
        var velOriented = mat4.multiplyVec3(rotmat, vel, vec3.create());
        var velStep = vec3.scale(velOriented, timestep*PLAYER_SPEED, vec3.create());
        vec3.add(pos, velStep);

        aimChanged();
      }
    }
    this.render = {
      applyViewTransform: function (matrix) {
        // look direction
        mat4.rotate(matrix, -pitch, [1, 0, 0]);
        mat4.rotate(matrix, -yaw, [0, 1, 0]);
      
        // position
        var positionTrans = vec3.negate(pos, vec3.create());
        mat4.translate(matrix, positionTrans);
      }
    };
    this.input = Object.freeze({
      click: function (pos, button) {
        var changed = false;
        if (button == 0) {
          // delete block
          if (cubeSelection != null) {
            var x = cubeSelection[0], y = cubeSelection[1], z = cubeSelection[2];
            if (world.solid(x,y,z)) {
              world.s(x,y,z,0);
              dirtyBlock(x,z);
              changed = true;
            }
          }
        } else if (button == 1) {
          // create block
          if (emptySelection != null) {
            var x = emptySelection[0], y = emptySelection[1], z = emptySelection[2];
            if (!world.solid(x,y,z)) {
              world.s(x,y,z, 64);
              dirtyBlock(x,z);
              changed = true;
            }
          }
        }
        if (changed) {
          aimChanged(); // block aimed at moved...
          needsDraw = true;
        }
      },
      set movement (vec) { vel = vec; },
      get pitch () { return pitch; },
      set pitch (angle) { pitch = angle; aimChanged(); },
      get yaw () { return yaw; },
      set yaw (angle) { yaw = angle; aimChanged(); },
      changeWorld: function (direction) {
        // TODO: global variables
        switch (direction) {
          case 1:
          console.log("worldH");
            world = worldH;
            rebuildWorld();
            break;
          case -1:
          console.log("worldL");
            world = worldL;
            rebuildWorld();
            break;
        }
      }
    });
  }
  
  return Player;
})();