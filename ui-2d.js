// Copyright 2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

(function () {
  "use strict";
  
  var Blockset = cubes.Blockset;
  var BlockType = cubes.BlockType;
  var Circuit = cubes.Circuit;
  var cyclicSerialize = cubes.storage.cyclicSerialize;
  var mkelement = cubes.util.mkelement;
  var Persister = cubes.storage.Persister;
  var Selection = cubes.Selection;
  var World = cubes.World;
  var WorldGen = cubes.WorldGen;
  
  function offsetGlobal(element) {
    var left = 0, top = 0;
    for (; element !== null; element = element.offsetParent) {
      left += element.offsetLeft;
      top += element.offsetTop;
    }
    return {left: left, top: top};
  }
  
  function ObjectUI(persistencePool) {
    var ui = this;
    
    var normalFocusElement = null;
    var panelContainer = null;
    
    // --- Object chips ---
    
    function refName(name) {
      return {
        getOptName: function () { return name; },
        getObject: function () { return persistencePool.get(name); },
        isObjectAvailable: function () { return !!persistencePool.getIfLive(name); }
      };
    }
    this.refName = refName;
    
    function refObject(object) {
      return {
        getOptName: function () { return persistencePool.getObjectName(object); },
        getObject: function () { return object; },
        isObjectAvailable: function () { return true; }
      };
    }
    this.refObject = refObject;
    
    function ObjectChip(targetRef) {
      var trivial = targetRef.isObjectAvailable() && !targetRef.getObject();
      
      var menuE = null;
      
      // Construct DOM
      var nameE = mkelement("span");
      var chipE = mkelement("span", "presentation", nameE);
      chipE.style.position = "relative";

      chipE.classList.add(trivial ? "trivial-object-chip" : "object-chip");
      if (!trivial) {
        chipE.addEventListener("contextmenu", chipMenu, false);
        var menuButtonE = mkelement("button", "", "▾");
        menuButtonE.addEventListener("mousedown", chipMenu, false);
        menuButtonE.addEventListener("click", chipMenu, false);
        chipE.appendChild(menuButtonE);
      }
      
      function updateChip() {
        if (trivial) {
          nameE.textContent = String(targetRef.getObject());
          
        } else if (targetRef.isObjectAvailable()) {
          var target = targetRef.getObject();
          // Examine object
          var label = null;
          if (target.persistence) {
            label = persistencePool.getObjectName(target);
            chipE.classList.add("object-chip-live");
          }
          if (label === null) {
            label = "a ";
            
            if (target instanceof World) {
              label += target.wx + "×" + target.wy + "×" + target.wz + " ";
            }
            var typeName = Persister.findType(target.constructor);
            if (!typeName) {
              if (target instanceof Selection) { // TODO make this not a special case
                typeName = "selection";
              } else {
                typeName = "object";
              }
            }
            label += typeName;
            if (target instanceof BlockType && target.name !== null) {
              label += " “" + target.name + "”";
            }
            
            chipE.classList.add("object-chip-ephemeral");
          }
          
          nameE.textContent = label;
          
        } else if (targetRef.getOptName() !== null) {
          var targetName = targetRef.getOptName();
          nameE.textContent = targetName;
          chipE.classList.add(targetRef.isObjectAvailable() ? "object-chip-live" : "object-chip-named");

        } else {
          throw new Error("Can't happen");
        }
      }
      
      function chipMenu(event) {
        event.stopPropagation();
        event.preventDefault();
        updateChip();
        if (menuE) return false;
        menuE = openContextMenu(event, targetRef, menuButtonE, function () { menuE = null; });
        return false;
      }
      
      // Final initialization
      this.element = chipE;
      updateChip();
      Object.freeze(this);
    }
    this.ObjectChip = ObjectChip;
    
    function openContextMenu(event, targetRef, optOriginElement, closeCallback) {
      var menuListE;
      var menuE = mkelement("div", "command-menu",
        menuListE = mkelement("ul")
      );
      menuE.tabIndex = 0; // make focusable
      menuE.style.position = "absolute";
      menuE.style.zIndex = "1";
      
      commandsFor(targetRef, function addControl(label, fn) {
        var b;
        menuListE.appendChild(mkelement("li", "",
          b = mkelement("button", "", label)
        ));
        b.addEventListener("mouseup", function (e) {
          e.stopPropagation();
          dismiss();
          fn();
          return true;
        }, false);
      });
      
      // Place on screen
      // This position is in document-global coordinates because the menu is made a child of the body; and this is done because making it a child or sibling of the origin element would allow it to be clipped by the containing elements. We don't bother responding to relayout, because it's not good for a menu to move under the cursor and it shouldn't be up for long, anyway
      document.body.appendChild(menuE); // first so that offsetWidth is valid
      var posX, posY;
      var niceMargin = 10;
      if (optOriginElement) {
        var oa = offsetGlobal(optOriginElement);
        posX = (oa.left + optOriginElement.offsetWidth - menuE.offsetWidth);
        posY = (oa.top + optOriginElement.offsetHeight + 2);
        if (posX < 0) posX = 0;
        if (posY + menuE.offsetHeight > window.innerHeight - niceMargin) {
          posY = oa.top - menuE.offsetHeight;
        }
      } else {
        posX = event.clientX;
        posY = event.clientY;
        if (posX + menuE.offsetWidth > window.innerWidth - niceMargin) {
          posX -= menuE.offsetWidth;
        }
        if (posY + menuE.offsetHeight > window.innerHeight - niceMargin) {
          posY -= menuE.offsetHeight;
        }
      }
      menuE.style.left = posX + "px";
      menuE.style.top  = posY + "px";
      
      var focused = true;
      menuE.addEventListener("focus", function () {
        focused = true;
        return true;
      }, false);
      menuE.addEventListener("blur", function () {
        focused = false;
        setTimeout(function () {
          if (!focused) dismiss();
        }, 0);
        return true;
      }, false);
      menuE.addEventListener("keypress", function () {
        dismiss();
        return true;
      }, false);
      menuE.focus();
      
      function dismiss() {
        if (!menuE) return;
        if (focused) ui.refocus();
        menuE.parentElement.removeChild(menuE);
        menuE = null;
        closeCallback();
      }
      
      return menuE;
    }
    this.openContextMenu = openContextMenu;
    
    // --- Panel manager ---
    
    this.refocus = function () {
      if (normalFocusElement) normalFocusElement.focus();
    };
    
    var onymousPanels = Object.create(null);
    var currentlyOpenPanel = null;
    var currentlyOpenPanelName = null;
    
    function innerOpenPanel(element, name) {
      currentlyOpenPanel = element;
      currentlyOpenPanelName = name;
      panelContainer.classList.add("sidebar-visible");
      panelContainer.classList.remove("sidebar-hidden");
      panelResizeKludge();
    }
    
    function closePanel(element) {
      element.style.display = "none";
      if (currentlyOpenPanel === element) {
        if (currentlyOpenPanelName === null) {
          // anonymous panel is discarded
          element.parentElement.removeChild(element);
          if (typeof element.cubes_elementDiscardCallback === "function") {
            element.cubes_elementDiscardCallback();
          }
        }
        
        currentlyOpenPanel = null;
        currentlyOpenPanelName = null;
        panelContainer.classList.remove("sidebar-visible");
        panelContainer.classList.add("sidebar-hidden");
      }
    }
    
    function addPanelFeatures(element) {
      element.classList.add("sidebar"); // TODO make class name more generic
    }
    
    this.registerPanel = function (name, element) {
      onymousPanels[name] = element;
      
      element.style.display = "none";
      addPanelFeatures(element);
    };
    
    this.openPanel = function (name) {
      if (!(name in onymousPanels)) {
        throw new Error("unregistered panel");
      }
      var element = onymousPanels[name];
      
      if (currentlyOpenPanel) closePanel(currentlyOpenPanel);
      
      element.style.removeProperty("display");
      innerOpenPanel(element, name);
    };
    
    this.openNewPanel = function (closeCallback) {
      var element = document.createElement("div");
      
      // TODO make tree position customizable
      panelContainer.appendChild(element);
      addPanelFeatures(element);
      element.cubes_elementDiscardCallback = closeCallback;
      if (element.cubes_elementDiscardCallback !== closeCallback && typeof console !== "undefined") {
        console.warn("Expando failed to stay");
      }
      
      if (currentlyOpenPanel) closePanel(currentlyOpenPanel);
      
      currentlyOpenPanel = element;
      currentlyOpenPanelName = null;
      innerOpenPanel(element, null);
      
      return element;
    };
    
    this.hidePanels = function () {
      if (currentlyOpenPanel) closePanel(currentlyOpenPanel);
    };
    
    this.setNormalFocusElement = function (v) {
      normalFocusElement = v;
    };
    
    this.setPanelContainer = function (v) {
      panelContainer = v;
    };
    
    // TODO this is overspecific - it is for the layout in our current cubes.html, not general (it is a workaround for Firefox)
    function panelResizeKludge() {
      if (currentlyOpenPanel) {
        currentlyOpenPanel.style.height = window.innerHeight + "px";
      }
      return true;
    }
    window.addEventListener("resize", panelResizeKludge, true);
    
    // --- Inspector ---
    
    this.inspect = function (object) {
      // TODO make this cleanup require less plumbing
      var active = true;
      var cleanups = [];
      var panel = this.openNewPanel(function () {
        active = false;
        cleanups.forEach(function (f) { f(); });
      });
      
      var titleChip = new ObjectChip(refObject(object));
      
      panel.appendChild(mkelement("h2", "", "Inspecting ", titleChip.element));
      
      // TODO refactor this into something less hardcoded
      if (object instanceof World) {
        var blocksetChip = new ObjectChip(refObject(object.blockset));
        
        panel.appendChild(mkelement("table", "",
          mkelement("tr", "",
            mkelement("th", "", "Blockset:"),
            mkelement("td", "", blocksetChip.element)
          ),
          mkelement("tr", "",
            mkelement("th", "", "Size:"),
            mkelement("td", "", String(object.wx), " × ", String(object.wy), " × ", String(object.wz))
          ),
          mkelement("tr", "",
            mkelement("th", "", "Player body:"),
            mkelement("td", "", new ObjectChip(refObject(object.playerBody)).element)
          )
        ));
      } else if (object instanceof Blockset) (function () {
        var blocksList = mkelement("ol");
        panel.appendChild(blocksList);
        var blocksetRender;
        function row(blockID) {
          var blockType = object.get(blockID);
          
          // TODO refactor so we can have an icon for a lone BlockType and make ObjectChip have an icon
          var icon = document.createElement("img");
          icon.style.verticalAlign = "middle"; // TODO stylesheet
          icon.style.width = icon.style.height = "1.2em";
          if (blocksetRender) {
            blocksetRender.icons[blockID].nowAndWhenChanged(function (url) {
              if (url !== null)
                icon.src = url;
              return true;
            });
          }
          
          var blockChip = new ObjectChip(refObject(blockType));
          
          var item = mkelement("li", "", icon, blockChip.element);
          
          blocksList.appendChild(item);
        }
        
        var listener = {
          interest: function () { return active; },
          tableChanged: function (id) {
            blocksList.textContent = ""; // clear
            blocksetRender = renderer ? object.getRenderData(renderer) : null;
            for (var blockID = 1; blockID < object.length; blockID++) row(blockID);
          },
          texturingChanged: function (id) {},
        };
        object.listen(listener);
        cleanups.push(function () {
          object.listen.cancel(listener);
        });
        listener.tableChanged();
        
      }()); else if (object instanceof BlockType) (function () {
        var blockType = object;
        // TODO listen to block type for changes

        var rows;
        var table = mkelement("table", "",
          rows = mkelement("tbody", ""));
        panel.appendChild(table);

        function mkcell(title) {
          var cell;
          rows.appendChild(mkelement("tr", "",
            mkelement("th", "", title + ":"),
            cell = mkelement("td", "")));
          return cell;
        }

        // TODO include large icon/render

        // TODO: This code duplicates functionality of PersistentCell.bindControl — refactor so we can use that code here.
        
        var name = document.createElement("input");
        name.type = "text";
        name.value = blockType.name;
        name.onchange = function () {
          blockType.name = name.value;
          return true;
        };
        mkcell("Codename").appendChild(name);
        
        // TODO bind to changes, permit replacement
        // TODO figure out better handling of null
        if (blockType.world) {
          var worldChip = new ObjectChip(refObject(blockType.world));
          mkcell("World").appendChild(worldChip.element);
        }
        
        // TODO bind to changes, permit replacement
        // TODO get a color-picker
        if (blockType.color) {
          var colorChip = new ObjectChip(refObject(blockType.color));
          mkcell("Color").appendChild(colorChip.element);
        }
        
        // TODO bind to changes, permit editing
        var rotationsChip = new ObjectChip(refObject(blockType.automaticRotations));
        mkcell("Rotations").appendChild(rotationsChip.element);
        
        var behavior = document.createElement("select");
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
        });
        behavior.onchange = function () {
          blockType.behavior = Circuit.behaviors[behavior.value];
          return true;
        };
        mkcell("Behavior").appendChild(behavior);

        var solid = document.createElement("input");
        solid.type = "checkbox";
        solid.checked = blockType.solid;
        solid.onchange = function () {
          blockType.solid = solid.checked;
          return true;
        };
        mkcell("Solid").appendChild(solid);

        var lightT = document.createElement("input");
        lightT.type = "number";
        lightT.min = 0;
        lightT.max = 4;
        lightT.value = blockType.light.toString();
        lightT.onchange = function () {
          lightR.value = lightT.value;
          blockType.light = parseFloat(lightT.value);
          return true;
        };
        var lightR = document.createElement("input");
        lightR.type = "range";
        lightR.min = 0;
        lightR.max = 4;
        lightR.step = "any";
        lightR.value = blockType.light.toString();
        lightR.onchange = function () {
          lightT.value = lightR.value;
          blockType.light = parseFloat(lightR.value);
          return true;
        };
        var lightCell = mkcell("Light emission");
        lightCell.appendChild(lightT);
        lightCell.appendChild(lightR);

      }()); else {
        panel.appendChild(mkelement("p", "", 
          mkelement("em", "", "No details available for this object.")));
      }
      
      commandsFor(refObject(object), function addButton(label, action) {
        var button;
        panel.appendChild(mkelement("div", "", button = mkelement("button", "", label)));
        button.addEventListener("click", function () {
          try {
            action();
          } catch (e) {
            // TODO fold this into a general handling-errors-from-ui-actions infrastructure
            console.error("In button '" + label + "' event handler:", e);
            alert("Sorry, the operation failed unexpectedly.\n\n" + e);
          }
          return true;
        }, false);
      });
    };
    
    // --- Commands ---
    
    var allCommands = [];
    
    allCommands.push({
      title: "Delete",
      applicableToPersisted: function (name) { return true; },
      applicableToObject: function (object) {
        return persistencePool.getObjectName(object) !== null;
      },
      applyToPersisted: function (name) {
        // TODO: non-modal ui
        if (window.confirm("Really delete “" + name + "”?")) {
          persistencePool.ephemeralize(name);
        }
      },
      applyToObject: function (object) {
        this.applyToPersisted(persistencePool.getObjectName(object));
      }
    });
    
    // TODO add rename
    
    allCommands.push({
      title: "Save As...",
      applicableToPersisted: function (name) { return false; },
      applicableToObject: function (object) {
        return object.persistence && persistencePool.getObjectName(object) === null;
      },
      applyToObject: function (object) {
        // TODO: non-modal ui
        // TODO: Reenable giving object name/description for default value, as calculated by ObjectChip
        var response = window.prompt("Save as:", "untitled");
        if (response !== null) {
          persistencePool.persist(object, response);
        }
      }
    });
    
    allCommands.push({
      title: "Inspect",
      applicableToPersisted: function (name) { return true; },
      applicableToObject: function (object) { return true; },
      applyToObject: function (object) {
        ui.inspect(object);
      }
    });
    
    allCommands.push({
      title: "Export",
      applicableToPersisted: function (name) { return true; },
      applicableToObject: function (object) { return !!object.serialize; },
      applyToObject: function (object) {
        var panel = ui.openNewPanel();
        
        var expchip = new ObjectChip(refObject(object));
        panel.appendChild(mkelement("h2", "", "Export of ", expchip.element));
        
        var data = mkelement("textarea");
        data.cols = 20;
        data.rows = 20;
        data.readonly = true;
        // TODO add class for style hooking
        panel.appendChild(data);
        
        try {
          data.value = JSON.stringify(cyclicSerialize(object, Persister.findType));
        } catch (e) {
          data.value = "Error: " + e;
        }
      }
    });
    
    // TODO these blockset-editing operations are assuming the sub-blockset to use is the blockset of the #1 block. We should either explicitly declare there is only one sub-blockset or provide a way to choose.
    allCommands.push({
      title: "New block type",
      applicableToPersisted: function (name) { return false; },
      applicableToObject: function (object) { return object instanceof Blockset; },
      applyToObject: function (object) {
        object.add(WorldGen.newRandomBlockType(object.tileSize, object.get(1).world.blockset));
      }
    });
    allCommands.push({
      title: "Delete last block type",
      applicableToPersisted: function (name) { return false; },
      applicableToObject: function (object) {
        // TODO we have no notification scheme to handle changes such as (for this) a 0 length becoming nonzero, e.g. in inspector buttons.
        return object instanceof Blockset /* && object.length > 0 */;
      },
      applyToObject: function (object) {
        object.deleteLast();
      }
    });
    allCommands.push({
      title: "Add/update standard circuit blocks",
      applicableToPersisted: function (name) { return false; },
      applicableToObject: function (object) { return object instanceof Blockset; },
      applyToObject: function (object) {
        WorldGen.addLogicBlocks(object.tileSize, object, object.get(1).world.blockset);
      }
    });
    
    allCommands.push({
      title: "Clear",
      applicableToPersisted: function (name) { return false; },
      applicableToObject: function (object) { return object instanceof Selection; },
      applyToObject: function (object) {
        object.forEachCube(function (cube, world) {
          world.sv(cube, 0);
        });
      }
    });
    
    function commandsFor(ref, callback) {
      if (ref.isObjectAvailable()) {
        var object = ref.getObject();
        allCommands.forEach(function (command) {
          if (command.applicableToObject(object)) {
            callback(command.title, function () {
              command.applyToObject(object);
            });
          }
        });
      } else {
        var name = ref.getOptName();
        allCommands.forEach(function (command) {
          if (command.applicableToPersisted(name)) {
            callback(command.title, function () {
              if (command.applyToPersisted) {
                command.applyToPersisted(name);
              } else {
                command.applyToObject(persistencePool.get(name));
              }
            });
          }
        });
      }
    }
    
    // --- Support ---
    
    var renderer = null;
    
    this.setRenderer = function (v) {
      renderer = v;
    };
  }
  
  ObjectUI.prototype.openPanelFromButton = function (name) {
    this.openPanel(name);
    this.refocus();
  };
  
  cubes.ObjectUI = Object.freeze(ObjectUI);
})();