// TODO: explicitly connect global vars

function initInput(document) {
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
  document.onclick = function (event) {
    var swing = event.clientX / (gl.viewportWidth*0.5) - 1;
    var angle = Math.atan(swing);
    console.log("onclick", event.clientX, swing, angle);
    quat4.multiply(playerRot, quat4.calculateW([0, Math.sin(angle/2), 0, 0]));
    needsDraw = true;
  }
}