// Copyright 2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var CubesObjectUI;

(function () {
  "use strict";
  
  function ObjectUI(persistencePool) {
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
      var baseClassName = chipE.className = "presentation object-chip";
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
            label = target.persistence.getName(); // TODO should be per-pool
            chipE.className = baseClassName + " object-chip-live";
          }
          if (label === null) {
            label = "a " + Persister.findType(target.constructor);
            chipE.className = baseClassName + " object-chip-ephemeral";
          }
          
          nameE.textContent = label;
          
        } else if (targetName !== null) {
          nameE.textContent = targetName;
          chipE.className = baseClassName + (persistencePool.getIfLive(targetName) ? " object-chip-live" : " object-chip-named");
          
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
              // TODO unnecessary unserialization - change pool interface
              persistencePool.get(targetName).persistence.ephemeralize();
            }
          });
          
          // TODO add rename
        }
        
        if (targetName === null && target !== null) {
          addControl("Save As...", function () {
            var response = window.prompt("Save " + nameE.textContent + " as:", nameE.textContent);
            if (response !== null) {
              target.persistence.ephemeralize();
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
  }
  
  CubesObjectUI = ObjectUI;
})();