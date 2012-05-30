// Copyright 2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var CubesObjectUI;

(function () {
  "use strict";
  
  function ObjectUI(persistencePool) {
    var ui = this;
    
    var normalFocusElement;
    
    // --- Object chips ---
    
    function ObjectChip() {
      var bound = false;
      var menuE;
      var target = null, targetName = null;
      
      // Construct DOM
      var nameE = document.createElement("span");
      var menuButtonE = document.createElement("button");
      menuButtonE.textContent = "▾";
      menuButtonE.addEventListener("mousedown", openMenu, false);
      menuButtonE.addEventListener("click", openMenu, false);
      var chipE = document.createElement("span");
      chipE.className = "presentation object-chip";
      chipE.style.position = "relative";
      chipE.appendChild(nameE);
      chipE.appendChild(menuButtonE);
      
      this.bindByName = function (name) {
        if (bound) throw new Error("ObjectChip already bound");
        bound = true;
        targetName = name;
        updateChip();
      };
      this.bindByObject = function (object) {
        if (bound) throw new Error("ObjectChip already bound");
        bound = true;
        target = object;
        updateChip();
      };
      
      function updateChip() {
        if (target !== null && targetName !== null) {
          throw new Error("Inconsistent");
          
        } else if (target !== null) {
          // Examine object
          var label = null;
          if (target.persistence) {
            label = persistencePool.getObjectName(target);
            chipE.classList.add("object-chip-live");
          }
          if (label === null) {
            var label = "a ";
            
            if (target instanceof World) {
              label += target.wx + "×" + target.wy + "×" + target.wz + " ";
            }
            label += Persister.findType(target.constructor);
            
            chipE.classList.add("object-chip-ephemeral");
          }
          
          nameE.textContent = label;
          
        } else if (targetName !== null) {
          nameE.textContent = targetName;
          chipE.classList.add(persistencePool.getIfLive(targetName) ? "object-chip-live" : "object-chip-named");

        } else {
          throw new Error("Can't happen");
        }
      }
      
      function openMenu(event) {
        event.stopPropagation();
        
        updateChip();
        
        if (menuE) {
          return;
        }
        
        menuE = document.createElement("div");
        menuE.tabIndex = 0; // make focusable
        menuE.className = "command-menu";
        menuE.style.position = "absolute";
        menuE.style.zIndex = "1";
        menuE.style.right = (0) + "px";
        menuE.style.top = (menuButtonE.offsetTop + menuButtonE.offsetHeight) + "px";
        
        var menuListE = document.createElement("ul");
        menuE.appendChild(menuListE);
        
        function addControl(label, fn) {
          var b = document.createElement("button");
          b.textContent = label;
          b.addEventListener("click", function (e) {
            e.stopPropagation();
            dismiss();
            fn();
            updateChip(); // TODO kludge; updates should be based on notifications
            return true;
          }, false);
          var li = document.createElement("li");
          li.appendChild(b);
          menuListE.appendChild(li);
        }
        
        if (targetName !== null) {
          addControl("Delete", function () {
            if (window.confirm("Really delete “" + targetName + "”?")) {
              persistencePool.ephemeralize(targetName);
            }
          });
          
          // TODO add rename
        }
        
        if (targetName === null && target !== null) {
          addControl("Save As...", function () {
            var response = window.prompt("Save " + nameE.textContent + " as:", nameE.textContent);
            if (response !== null) {
              persistencePool.persist(target, response);
            }
          });
        }
        
        //addControl("Export", function () {
        //  // TODO put serialization text up in a dialog box.
        //});
        
        chipE.appendChild(menuE);
        var el;
        menuE.addEventListener("blur", el = function () {
          setTimeout(dismiss, 0); // undeferred blur effects have caused trouble
        }, false);
        menuE.focus();
        
        function dismiss() {
          if (!menuE) return;
          menuE.parentElement.removeChild(menuE);
          menuE.removeEventListener("blur", el);
          menuE = undefined;
        }
      }
      
      
      // Final initialization
      
      this.element = chipE;
      
      Object.freeze(this);
    }
    this.ObjectChip = ObjectChip;
    
    // --- Panel manager ---
    
    this.refocus = function () {
      if (normalFocusElement) normalFocusElement.focus();
    };
    
    var onymousPanels = {};
    var currentlyOpenPanel = null;
    
    function closePanel(element) {
      element.style.display = "none";
      if (currentlyOpenPanel === element) currentlyOpenPanel = null;
    }
    
    this.registerPanel = function (name, element) {
      onymousPanels[name] = element;
      
      element.style.display = "none";
      
      element.addEventListener("click", function (event) {
        if (event.target.tagName == "INPUT" ||
            event.target.tagName == "LABEL" ||
            event.target.tagName == "BUTTON" ||
            event.target.tagName == "TEXTAREA") {
          return true;
        } else {
          closePanel(element);
          ui.refocus();
        }
      })
    };
    this.openPanel = function (name) {
      if (!Object.prototype.hasOwnProperty.call(onymousPanels, name)) throw new Error("unregistered panel");
      var element = onymousPanels[name];
      
      if (currentlyOpenPanel) closePanel(currentlyOpenPanel);
      
      element.style.display = "block";
      currentlyOpenPanel = element;
    };
    
    this.setNormalFocusElement = function (v) {
      normalFocusElement = v;
    }
    
  }
  ObjectUI.prototype.openPanelFromButton = function (name) {
    this.openPanel(name);
    this.refocus();
  };
  
  CubesObjectUI = ObjectUI;
})();