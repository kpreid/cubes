// TODO: explicitly connect global vars

function Input(document, playerInput) {
  "use strict";

  var keymap = [];
  
  function evalVel(pos, neg) {
    return pos ? neg ? 0 : 1 : neg ? -1 : 0;
  }
  function interestingInMap(code) {
    switch (code) {
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
    
    playerInput.movement = [
      evalVel(r, l),
      evalVel(u, d),
      evalVel(b, f)
    ];
  }
  
  document.onkeydown = function (event) {
    // avoid disturbing browser shortcuts
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    
    var code = event.keyCode || event.which;

    // handlers for 'action' keys (immediate effects)
    switch (String.fromCharCode(code)) {
      case "R": playerInput.changeWorld(1); return false;
      case "F": playerInput.changeWorld(-1); return false;
    }

    // 'mode' keys such as movement directions go into the keymap
    if (interestingInMap(code)) {
      keymap[code] = true;
      evalKeys();
      return false;
    } else {
      return true;
    }
  };
  document.onkeyup = function (event) {
    var code = event.keyCode || event.which;
    if (interestingInMap(code)) {
      var wasSetInMap = keymap[code];
      keymap[code] = false;
      evalKeys();
      return !wasSetInMap;
    } else {
      return true;
    }
  };
  
  
  var dx = 0;
  
  document.onmousemove = function (event) {
    var swingY = event.clientY / (gl.viewportHeight*0.5) - 1;
    var swingX = event.clientX / (gl.viewportWidth*0.5) - 1;
    
    // y effect
    playerInput.pitch = -Math.PI/2 * swingY;
    
    // x effect
    dx = -0.2 * deadzone(swingX, 0.2);
  }
  document.onmouseout = function (event) {
    dx = 0;
  }

  document.onclick = function (event) {
    playerInput.click([event.clientX, event.clientY], 0);
    return false;
  }
  document.oncontextmenu = function (event) {
    playerInput.click([event.clientX, event.clientY], 1);
    return false;
  }
  
  function step() {
    if (dx != 0) {
      playerInput.yaw += dx;
    }
  }
  
  this.step = step;
}
