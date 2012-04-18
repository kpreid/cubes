// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

function Input(config, eventReceiver, playerInput, hud, renderer, focusCell, save) {
  "use strict";

  var keymap = {};
  var interfaceMode;
  var expectingPointerLock = false;

  var mousePos = null;

  var quickSlots;
  var quickSlotLRU;

  // --- Utilities ---

  function evalVel(pos, neg) {
    return pos ? neg ? 0 : 1 : neg ? -1 : 0;
  }
  
  function quick(n) {
    playerInput.tool = quickSlots[n];
  }
  
  function clearChildren(elem) {
    while (elem.firstChild) elem.removeChild(elem.firstChild);
  }
  
  // --- Focus ---
  
  eventReceiver.addEventListener("focus", function (event) {
    focusCell.set(true);
    return true;
  }, false);
  eventReceiver.addEventListener("blur", function (event) {
    focusCell.set(false);
    keymap = {};
    return true;
  }, false);

  // This is used as the conditiopn to inhibit focus-granting clicks from modifying the world. Simply checking focusCell is insufficient (due to focusiing happening before the event) in at least one case: when focus is on Chrome's Web Inspector.
  var delayedFocus = false;
  
  focusCell.whenChanged(function (value) {
    setTimeout(function () { 
      delayedFocus = value;
      
      if (!value) {
        // Blur is probably a good time to autosave
        save();
      }
      interfaceMode.focus(value);
    }, 0);
    return true;
  });
  
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
        switchMode(interfaceMode.mouselookKeyTransition);
        return false;
      case "R": playerInput.changeWorld(1);  return false;
      case "\x1B"/*Esc*/:
      case "F": playerInput.changeWorld(-1); return false;
      case "Z": playerInput.tweakSubdata(-1); return false;
      case "X": playerInput.tweakSubdata(1);  return false;
      case "B": 
        switchMode(fullMenuMode);
        eventReceiver.blur();
        return false;
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
  
  var CENTER = {};
  var dx = 0;
  var prevx = 0;
  
  function applyMousePosition() {
    var cs = window.getComputedStyle(eventReceiver, null);
    var w = parseInt(cs.width, 10);
    var h = parseInt(cs.height, 10);

    if (mousePos === CENTER) {
      playerInput.mousePos = [w/2, h/2];
      return;
    }
    
    if (!focusCell.get()) {
      playerInput.mousePos = null;
      dx = 0;
      return;
    } else {
      playerInput.mousePos = mousePos;
    }
    
    if (mousePos === null) { return; }

    var swingY = mousePos[1] / (h*0.5) - 1;
    var swingX = mousePos[0] / (w*0.5) - 1;
    
    var directY = -Math.PI/2 * swingY;
    var directX = -Math.PI/2 * swingX;

    if (interfaceMode.mouselook) {
      playerInput.pitch = directY;
      playerInput.yaw += (directX - prevx);
      dx = -(config.mouseTurnRate.get()) * deadzone(swingX, 0.1);
    } else {
      dx = 0;
    }
    prevx = directX;
  }
  focusCell.whenChanged(function (value) {
    applyMousePosition();
    return true;
  });
  
  function updateMouseFromEvent(event) {
    if (document.pointerLockEnabled/*shimmed*/ || expectingPointerLock) {
      mousePos = CENTER;
      dx = 0;
    } else if (event && !expectingPointerLock) {
      mousePos = [event.clientX, event.clientY];
    }
    applyMousePosition();
  }
  
  eventReceiver.addEventListener("mousemove", function (event) {
    updateMouseFromEvent(event);
    
    if (document.pointerLockEnabled/*shimmed*/ || expectingPointerLock) {
      // This is not in updateMouseFromEvent because movement* are updated only on mousemove events, even though they are provided on all events.
      
      // TODO this is duplicative-ish of applyMousePosition. We need a refactoring...
      
      var my = event.movementY/*shimmed*/;
      var mx = event.movementX/*shimmed*/;
      mx = mx || 0; // TODO Why are movement* sometimes undefined?
      my = my || 0;
      
      var swingY = -Math.PI/2 * my / 300; // TODO user config
      var swingX = -Math.PI/2 * mx / 300;

      playerInput.pitch = Math.min(Math.PI/2, Math.max(-Math.PI/2, playerInput.pitch + swingY));
      playerInput.yaw += swingX;
    }
  }, false);
  eventReceiver.addEventListener("mouseout", function (event) {
    mousePos = null;
    applyMousePosition();
    return true;
  }, false);
  
  // --- Fullscreen and pointer lock (experimental browser APIs) ---
  
  // game-shim.js provides these facilities as stubs if the browser does not, so this code contains no conditionals.
  
  var fullScreenElement = document.body;
  
  //console.log("Pointer lock supported:", GameShim.supports.pointerLock);
  
  document.addEventListener("fullscreenchange"/*shimmed*/, updatePointerLock, false);
  document.addEventListener("fullscreenerror"/*shimmed*/, function (event) {
    console.info("Fullscreen entry error", event);
  }, false);
  
  this.requestFullScreen = function () {
    fullScreenElement.requestFullScreen/*shimmed*/(Element.ALLOW_KEYBOARD_INPUT /* TODO this is a webkitism */);
  };

  function updatePointerLock() {
    if (interfaceMode.mouselook) {
      eventReceiver.requestPointerLock/*shimmed*/();
      expectingPointerLock = GameShim.supports.pointerLock;
      updateMouseFromEvent(null);
      setTimeout(function () {
         // TODO should be on pointer lock callback but that's not supported by the shim
         expectingPointerLock = false;
         updateMouseFromEvent(null);
      }, 20);
    } else {
      document.exitPointerLock/*shimmed*/();
    }
  };
  
  // --- Clicks ---
  
  // Note: this has the side effect of inhibiting text selection on drag
  eventReceiver.addEventListener("mousedown", function (event) {
    updateMouseFromEvent(event);
    if (delayedFocus) {
      switch (event.button) {
        case 0: playerInput.deleteBlock(); break;
        case 2: playerInput.useTool(); break;
      }
    } else {
      eventReceiver.focus();
    }
    event.preventDefault(); // inhibits text selection
    return false;
  }, false);
  
  // TODO: Implement repeat on held down button
  
  eventReceiver.addEventListener("contextmenu", function (event) {
    event.preventDefault(); // inhibits context menu (on the game world only) since we use right-click for our own purposes
  }, false);

  // --- Stepping ---
  
  function step(timestep) {
    if (dx !== 0) {
      playerInput.yaw += dx*timestep;
    }
  }
  
  // --- Interface modes ---
  
  function switchMode(newMode) {
    interfaceMode = newMode;
    var e = document.body;
    e.className = e.className.replace(/\s*ui-mode-\w+/, "") + " ui-mode-" + interfaceMode.uiClass;
    updatePointerLock();
    applyMousePosition();
  }
  
  var mouselookIMode = {
    mouselook: true,
    uiClass: "hidden",
    focus: function () {}
  };
  
  var menuMode = {
    mouselook: false,
    mouselookKeyTransition: mouselookIMode,
    uiClass: "menu",
    focus: function () {}
  };
  mouselookIMode.mouselookKeyTransition = menuMode;
  
  var fullMenuMode = {
    mouselook: false,
    mouselookKeyTransition: menuMode,
    uiClass: "full",
    focus: function (focused) { if (focused) switchMode(mouselookIMode); }
  };
  
  interfaceMode = mouselookIMode;
  
  // --- Block menu ---
  
  var QUICK_SLOT_COUNT = 10;
  
  var menuItemsByBlockId;
  var canvasesByBlockId;
  var quickItemsByBlockId;
  var blockSetInMenu;

  function deferrer(func) {
    var set = false;
    return function () {
      if (!set) {
        setTimeout(function () {
          set = false;
          func();
        }, 0);
        set = true;
      }
    }
  }

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
    for (var i = 1; i < blockSetInMenu.length; i++) f(i, menuItemsByBlockId[i], canvasesByBlockId[i]);
  }
  
  var updateDeferred = deferrer(updateMenuBlocks);
  var menuListener = {
    // deferred because otherwise we act while in the middle of a rebuild
    texturingChanged: function (id) { updateDeferred(); return true; },
    tableChanged:     function (id) { updateDeferred(); return true; }
  };
  
  function setupIconButton(item, icon, blockID) {
    icon.onclick = function () {
      playerInput.tool = blockID;
      
      var quickSlot = quickSlots.indexOf(blockID);
      if (quickSlot === -1) {
        // promote to recently-used menu
        quickSlot = quickSlotLRU.shift();
        quickSlots[quickSlot] = blockID;
        updateQuickBar();
      } else {
        // touch LRU entry
        quickSlotLRU.splice(quickSlotLRU.indexOf(quickSlot), 1);
      }
      quickSlotLRU.push(quickSlot);
      
      return false;
    };
    icon.onmousedown = icon.onselectstart = function () {
      item.className = "menu-item selectedTool";
      return false; // inhibit selection
    };
    icon.oncontextmenu = function () {
      playerInput.enterWorld(blockID);
      return false;
    };
    icon.onmouseout = function () {
      item.className = "menu-item " + (blockID === playerInput.tool ? " selectedTool" : "");
      return true;
    };
  }
  
  function updateMenuBlocks() {
    if (playerInput.blockSet !== blockSetInMenu) {
      if (blockSetInMenu) blockSetInMenu.listen.cancel(menuListener);
      blockSetInMenu = playerInput.blockSet;
      if (blockSetInMenu) blockSetInMenu.listen(menuListener);
    }
    
    menuItemsByBlockId = [];
    canvasesByBlockId = [];
    quickItemsByBlockId = [];
    resetQuick();

    var blockRenderer = new BlockRenderer(blockSetInMenu, renderer);
  
    var sidecount = Math.ceil(Math.sqrt(blockSetInMenu.length));
    var size = Math.min(64, 300 / sidecount);
    
    clearChildren(hud.blocksetAll);
  
    forAllMenuBlocks(function (blockID) {
      var blockType = blockSetInMenu.get(blockID);
      
      // element structure and style
      var item = menuItemsByBlockId[blockID] = document.createElement("tr");
      item.className = "menu-item";
      var canvas = canvasesByBlockId[blockID] = document.createElement("canvas");
      canvas.width = canvas.height = 64; // TODO magic number
      canvas.style.width = canvas.style.height = size + "px"; // TODO don't do this in full menu mode
      
      function cell() {
        var cell = document.createElement("td");
        cell.className = "block-details";
        item.appendChild(cell);
        return cell;
      }
      
      cell().appendChild(document.createTextNode(blockID.toString()));
            
      var iconCell = cell();
      iconCell.className = ""; // always shown
      iconCell.appendChild(canvas);
      
      // TODO: This code duplicates functionality of PersistentCell.bindControl — refactor so we can use that code here.
      
      var name = document.createElement("input");
      name.className = "block-details";
      name.type = "text";
      name.value = blockType.name;
      name.onchange = function () {
        blockType.name = name.value;
        return true;
      };
      cell().appendChild(name);
            
      var behavior = document.createElement("select");
      behavior.className = "block-details";
      var currentBehavior = (blockType.behavior || {name:""}).name;
      var o = document.createElement("option");
      o.textContent = "—";
      o.selected = name === currentBehavior;
      behavior.appendChild(o);
      Object.keys(Circuit.behaviors).forEach(function (name) {
        var o = document.createElement("option");
        o.textContent = name;
        o.value = name;
        o.selected = name === currentBehavior;
        behavior.appendChild(o);
      })
      behavior.onchange = function () {
        blockType.behavior = Circuit.behaviors[behavior.value];
        return true;
      };
      cell().appendChild(behavior);
      
      var solid = document.createElement("input");
      solid.className = "block-details";
      solid.type = "checkbox";
      solid.checked = blockType.solid;
      solid.onchange = function () {
        blockType.solid = solid.checked;
        return true;
      };
      cell().appendChild(solid);
      
      // render block
      var cctx = canvas.getContext('2d');
      cctx.putImageData(blockRenderer.blockToImageData(blockID, cctx), 0, 0);
      
      setupIconButton(item,canvas,blockID);
      
      hud.blocksetAll.appendChild(item);
    });
    
    blockRenderer.deleteResources();
    
    updateQuickBar();
  }
  
  function updateQuickBar() {
    clearChildren(hud.quickBar);
    quickItemsByBlockId = [];
    quickSlots.forEach(function (blockID, index) {
      var canvas = canvasesByBlockId[blockID];
      if (canvas) {
        var item = document.createElement("span");
        item.className = "menu-item";

        // keyboard shortcut hint
        var hint = document.createElement("kbd");
        hint.appendChild(document.createTextNode(((index+1) % 10).toString()));
        hint.className = "menu-shortcut-key";
        item.appendChild(hint);

        var icon = document.createElement("img");
        icon.src = canvas.toDataURL("image/png");
        //canvas.style.width = canvas.style.height = size + "px";
        item.appendChild(icon);

        setupIconButton(item,icon,blockID);
        hud.quickBar.appendChild(item);
        
        quickItemsByBlockId[blockID] = item;
      }
    });
    
    updateMenuSelection();
  }
  
  function updateMenuSelection() {
    var tool = playerInput.tool;
    forAllMenuBlocks(function (i, item) {
      item.className = i === tool ? "menu-item selectedTool" : "menu-item";
    });
    quickItemsByBlockId.forEach(function (item, i) {
      if (item !== undefined)
        item.className = i === tool ? "menu-item selectedTool" : "menu-item";
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
    
  // --- Methods ---
  
  this.step = step;
  
  // TODO these two blockset-editing operations are assuming the sub-blockset to use is the blockset of the #1 block. We should either explicitly declare there is only one sub-blockset or provide a way to choose.
  
  // invoked from UI
  this.addBlock = function () {
    playerInput.blockSet.add(WorldGen.newRandomBlockType(playerInput.blockSet.tileSize, playerInput.blockSet.get(1).world.blockSet));
  };
  
  // invoked from UI
  this.addCircuitBlocks = function () {
    WorldGen.addLogicBlocks(playerInput.blockSet.tileSize, playerInput.blockSet, playerInput.blockSet.get(1).world.blockSet);
  };
  
  // invoked from UI
  this.editBlockset = function () {
    switchMode(fullMenuMode);
  };
  
  // --- Late initialization ---
  
  switchMode(interfaceMode);
}
