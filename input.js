// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

// TODO: explicitly connect global vars

function Input(eventReceiver, playerInput, menuElement, renderer, focusCell) {
  "use strict";

  var keymap = {};
  var mouselookMode = true;

  // --- Utilities ---

  function evalVel(pos, neg) {
    return pos ? neg ? 0 : 1 : neg ? -1 : 0;
  }
  
  function setMouselook(value) {
    mouselookMode = value;
    menuElement.style.visibility = mouselookMode ? 'hidden' : 'visible';
  }
  setMouselook(mouselookMode);
  
  function quick(n) {
    playerInput.tool = quickSlots[n];
  }
  
  // --- Focus ---
  
  eventReceiver.addEventListener("focus", function (event) {
    focusCell.set(true);
    return true;
  }, false);
  eventReceiver.addEventListener("blur", function (event) {
    focusCell.set(false);
    keymap = {};
    dx = 0;
    return true;
  }, false);
  
  // --- Keyboard events ---
  
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
      case "1": quick(0); return false;
      case "2": quick(1); return false;
      case "3": quick(2); return false;
      case "4": quick(3); return false;
      case "5": quick(4); return false;
      case "6": quick(5); return false;
      case "7": quick(6); return false;
      case "8": quick(7); return false;
      case "9": quick(8); return false;
      case "0": quick(9); return false;
      case "Q": 
        setMouselook(!mouselookMode);
        return false;
      case "R": playerInput.changeWorld(1);  return false;
      case "\x1B"/*Esc*/:
      case "F": playerInput.changeWorld(-1); return false;
      case " ": playerInput.jump(); return false;
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
  
  // --- Mouselook ---
  
  var dx = 0;
  var prevx = 0;
  
  function updateMouse() {
    playerInput.mousePos = [event.clientX, event.clientY];
  }
  
  eventReceiver.addEventListener("mousemove", function (event) {
    updateMouse(event);

    var cs = window.getComputedStyle(eventReceiver, null);
    var w = parseInt(cs.width);
    var h = parseInt(cs.height);

    var swingY = event.clientY / (h*0.5) - 1;
    var swingX = event.clientX / (w*0.5) - 1;
    
    var directY = -Math.PI/2 * swingY;
    var directX = -Math.PI/2 * swingX;

    if (mouselookMode) {
      playerInput.pitch = directY;
      playerInput.yaw += (directX - prevx);
      dx = -10.0 * deadzone(swingX, 0.1);
    } else {
      dx = 0;
    }
    prevx = directX;
  }, false);
  eventReceiver.addEventListener("mouseout", function (event) {
    playerInput.mousePos = null;
    dx = 0;
    return true;
  }, false);

  // --- Clicks ---

  eventReceiver.addEventListener("click", function (event) {
    updateMouse();
    eventReceiver.focus();
    playerInput.deleteBlock();
    return false;
  }, false);
  eventReceiver.oncontextmenu = function (event) { // On Firefox 5.0.1 (most recent tested 2011-09-10), addEventListener does not suppress the builtin context menu, so this is an attribute rather than a listener.
    updateMouse();
    eventReceiver.focus();
    playerInput.useTool();
    return false;
  };
  
  // inhibit incidental text selection
  eventReceiver.onmousedown/* Chrome/Firefox */ = eventReceiver.onselectstart/* for IE */ = function (event) { return false; };
  
  function step(timestep) {
    if (dx != 0) {
      playerInput.yaw += dx*timestep;
    }
  }
  
  // --- Block menu ---
  
  var QUICK_SLOT_COUNT = 10;
  
  var menuItemsByBlockId;
  var hintTextsByBlockId;
  var blockSetInMenu;
  var quickSlots;
  var quickSlotLRU;

  function resetQuick() {
    quickSlots = [];
    quickSlotLRU = [];
    for (var i = 0; i < QUICK_SLOT_COUNT; i++) {
      quickSlots[i] = i + 1; // block ids starting from 1
      quickSlotLRU[i] = QUICK_SLOT_COUNT - (i + 1); // reverse order
    }
  }
  resetQuick();

  function forAllMenuBlocks(f) {
    for (var i = 1; i < blockSetInMenu.length; i++) f(i, menuItemsByBlockId[i]);
  }
  
  function updateMenuBlocks() {
    blockSetInMenu = playerInput.blockSet;
    menuItemsByBlockId = [];
    hintTextsByBlockId = [];
    resetQuick();

    var blockRenderer = new BlockRenderer(blockSetInMenu, renderer);
  
    var sidecount = Math.ceil(Math.sqrt(blockSetInMenu.length));
    var size = Math.min(64, 300 / sidecount);
  
    forAllMenuBlocks(function (i) {
      // element structure and style
      var item = menuItemsByBlockId[i] = document.createElement("span");
      item.className = "menu-item";
      var canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64; // TODO magic number
      canvas.style.width = canvas.style.height = size + "px";

      // keyboard shortcut hint
      var hint = document.createElement("kbd");
      hint.appendChild(hintTextsByBlockId[i] = document.createTextNode());
      hint.className = "menu-shortcut-key";
      item.appendChild(hint);

      item.appendChild(canvas);
      
      // render block
      var cctx = canvas.getContext('2d');
      cctx.putImageData(blockRenderer.blockToImageData(i, cctx), 0, 0);

      // event handlers
      (function (item,canvas,i) { // TODO remove, now moot
        canvas.onclick = function () {
          playerInput.tool = i;
          
          var quickSlot = quickSlots.indexOf(i);
          if (quickSlot === -1) {
            // promote to recently-used menu
            quickSlot = quickSlotLRU.shift();
            quickSlots[quickSlot] = i;
            updateMenuLayout();
          } else {
            // touch LRU entry
            quickSlotLRU.splice(quickSlotLRU.indexOf(quickSlot), 1);
          }
          quickSlotLRU.push(quickSlot);
          
          return false;
        };
        canvas.onmousedown = canvas.onselectstart = function () {
          item.className = "menu-item selectedTool";
          return false; // inhibit selection
        };
        canvas.oncontextmenu = function () {
          playerInput.enterWorld(i);
          return false;
        };
        canvas.onmouseout = function () {
          item.className = "menu-item " + (i == playerInput.tool ? " selectedTool" : "");
          return true;
        };
      })(item,canvas,i);
    });
    
    blockRenderer.deleteResources();
    
    updateMenuLayout();
  }
  
  function updateMenuLayout() {
    // This is not especially efficient, but it doesn't need to be.
    
    while (menuElement.firstChild) menuElement.removeChild(menuElement.firstChild);

    var quickGroup = document.createElement("div");

    forAllMenuBlocks(function (i, item) {
      menuElement.appendChild(item);
      hintTextsByBlockId[i].data = "";
    });
    quickSlots.forEach(function (blockId, index) {
      var item = menuItemsByBlockId[blockId];
      if (item) {
        quickGroup.appendChild(item);
        hintTextsByBlockId[blockId].data = ((index+1) % 10).toString();
      }
    });

    menuElement.appendChild(quickGroup);
  }
  
  function updateMenuSelection() {
    var tool = playerInput.tool;
    forAllMenuBlocks(function (i, item) {
      item.className = i == tool ? "menu-item selectedTool" : "menu-item";
    });
  }

  playerInput.listen({
    changedWorld: function (v) {
      // TODO: remember quick slot contents across worlds (add an input-state object to player's Places?)
      updateMenuBlocks();
      return true;
    },
    changedTool: function (v) {
      updateMenuSelection();
      return true;
    }
  });

  updateMenuBlocks();
  updateMenuSelection();
    
  // --- Methods ---
  
  this.step = step;
}
