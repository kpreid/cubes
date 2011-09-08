// TODO: explicitly connect global vars

// worldClick is a function of ([x, y], buttonNum) where buttonNum is 0 for left and 1 for right.
function Input(document, worldClick) {
  "use strict";

  var keymap = [];
  
  function evalVel(pos, neg) {
    return pos ? neg ? 0 : 1 : neg ? -1 : 0;
  }
  function interesting(code) {
    switch (event.keyCode) {
      case 'A'.charCodeAt(0): case 37:
      case 'W'.charCodeAt(0): case 38:
      case 'D'.charCodeAt(0): case 39:
      case 'S'.charCodeAt(0): case 40:
      case 'E'.charCodeAt(0):
      case 'C'.charCodeAt(0):
        return true;
      default:
        return false;
    }
  }
  function evalKeys() {
    var l = keymap['A'.charCodeAt(0)] || keymap[37];
    var r = keymap['D'.charCodeAt(0)] || keymap[39];
    var f = keymap['W'.charCodeAt(0)] || keymap[38];
    var b = keymap['S'.charCodeAt(0)] || keymap[40];
    var u = keymap['E'.charCodeAt(0)];
    var d = keymap['C'.charCodeAt(0)];
    
    playerVel[0] = evalVel(r, l);
    playerVel[1] = evalVel(u, d);
    playerVel[2] = evalVel(b, f);
  }
  
  document.onkeydown = function (event) {
    if (interesting(event.keyCode)) {
      keymap[event.keyCode] = true;
      evalKeys();
      return false;
    } else {
      return true;
    }
  };
  document.onkeyup = function (event) {
    if (interesting(event.keyCode)) {
      keymap[event.keyCode] = false;
      evalKeys();
      return false;
    } else {
      return true;
    }
  };
  
  var dx = 0;
  
  document.onmousemove = function (event) {
    // TODO: global variables
    var swingY = event.clientY / (gl.viewportHeight*0.5) - 1;
    var swingX = event.clientX / (gl.viewportWidth*0.5) - 1;
    playerPitch = -Math.PI/2 * swingY;
    
    dx = -0.2 * deadzone(swingX, 0.2);
    
    // TODO: global variables
    needsDraw = true;
  }
  document.onmouseout = function (event) {
    dx = 0;
  }

  document.onclick = function (event) {
    worldClick([event.clientX, event.clientY], 0);
    return false;
  }
  document.oncontextmenu = function (event) {
    worldClick([event.clientX, event.clientY], 1);
    return false;
  }
  
  function step() {
    if (dx != 0) {
      // TODO: global variables
      playerYaw += dx;
      needsDraw = true;
    }
  }
  
  this.step = step;
}
