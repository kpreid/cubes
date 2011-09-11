// TODO: explicitly connect global vars

function Input(eventReceiver, playerInput) {
  "use strict";

  var keymap = {};
  var mousePos = [0,0];
  
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
  
  eventReceiver.addEventListener("keydown", function (event) {
    // avoid disturbing browser shortcuts
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    
    var code = event.keyCode || event.which;

    // handlers for 'action' keys (immediate effects)
    switch (String.fromCharCode(code)) {
      case "R": hideMenu(); playerInput.changeWorld(1); return false;
      case "F": hideMenu(); playerInput.changeWorld(-1); return false;
    }

    // 'mode' keys such as movement directions go into the keymap
    if (interestingInMap(code)) {
      keymap[code] = true;
      evalKeys();
      return false;
    } else {
      return true;
    }
  }, false);
  document.addEventListener("keyup", function (event) {
    // on document to catch key-ups after focus changes etc.
    var code = event.keyCode || event.which;
    if (interestingInMap(code)) {
      var wasSetInMap = keymap[code];
      keymap[code] = false;
      evalKeys();
      return !wasSetInMap;
    } else {
      return true;
    }
  }, true);
  
  
  var dx = 0;
  
  eventReceiver.addEventListener("mousemove", function (event) {
    mousePos = [event.clientX, event.clientY];

    var swingY = event.clientY / (gl.viewportHeight*0.5) - 1;
    var swingX = event.clientX / (gl.viewportWidth*0.5) - 1;
    
    // y effect
    playerInput.pitch = -Math.PI/2 * swingY;
    
    // x effect
    dx = -0.2 * deadzone(swingX, 0.2);
  }, false);
  eventReceiver.addEventListener("mouseout", function (event) {
    mousePos = [event.clientX, event.clientY];
    dx = 0;
  }, false);
  eventReceiver.onblur = function (event) {
    keymap = {};
    dx = 0;
  };

  eventReceiver.addEventListener("click", function (event) {
    mousePos = [event.clientX, event.clientY];
    if (menuVisible()) {
      hideMenu();
    } else {
      eventReceiver.focus();
      playerInput.click(0);
    }
    return false;
  }, false);
  eventReceiver.oncontextmenu = function (event) { // On Firefox 5.0.1 (most recent tested 2011-09-10), addEventListener does not suppress the builtin context menu, so this is an attribute rather than a listener.
    mousePos = [event.clientX, event.clientY];
    
    if (menuVisible())
      hideMenu();
    else
      showMenu();

    return false;
  };
  
  // inhibit incidental text selection
  eventReceiver.onmousedown/* Chrome/Firefox */ = eventReceiver.onselectstart/* for IE */ = function (event) { return false; };
  
  function step() {
    if (dx != 0) {
      playerInput.yaw += dx;
    }
  }
  
  function menuVisible() {
    return document.getElementById("menu").style.visibility !== "hidden";
  }

  function showMenu() {
    var menu = document.getElementById("menu"); // TODO global id
    while (menu.firstChild) menu.removeChild(menu.firstChild);

    var blockSet = playerInput.blockSet;
    var blockRenderer = new BlockRenderer(blockSet);
    
    var size = Math.min(64, 4096 / blockSet.length);
    
    for (var i = 0; i < blockSet.length; i++) {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64; // TODO magic number
      canvas.style.width = canvas.style.height = size + "px";
      if (i == playerInput.tool) {
        canvas.className = "selectedTool";
      }
      menu.appendChild(canvas);
      var cctx = canvas.getContext('2d');
      cctx.putImageData(blockRenderer.blockToImageData(i, cctx), 0, 0);
      canvas.onclick = (function (i) { return function () {
        hideMenu();
        playerInput.tool = i;
      }; })(i);
      if ((i+1) % 16 == 0) {
        menu.appendChild(document.createElement('br'));
      }
    }
    
    var cs = window.getComputedStyle(menu, null);
    var menuW = parseInt(cs.width);
    var menuH = parseInt(cs.height);
    
    menu.style.visibility = 'visible';
    menu.style.left = (mousePos[0] - menuW/2) + "px";
    menu.style.top  = (mousePos[1] - menuH/2) + "px";
    
    blockRenderer.delete();
  }
  function hideMenu() {
    document.getElementById("menu").style.visibility = 'hidden';
    eventReceiver.focus();
  }
  
  this.step = step;
  this.getMousePos = function () { return mousePos; };
}
