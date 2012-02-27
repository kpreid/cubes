// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.
//
// Exception: The overall structure of WebGL initialization and context
// management is derived from Learning WebGL, Lesson 16, at
// http://learningwebgl.com/blog/?p=1786 (as of September 2011). No license is
// stated on that site, but I (Kevin Reid) believe that it is obviously the
// authors' intent to make this code free to use.

// Main loop scheduling, scene drawing, performance statistics, etc.

// TODO: Eliminate this global variable...if it seems appropriate.
var config = {};
(function () {
  function defineOption(name, type, value) {
    config[name] = new PersistentCell("cubes.option." + name, type, value);
  }
  Object.defineProperty(config, "resetAllOptions", {value: function () {
    Object.keys(config).forEach(function (k) { config[k].setToDefault(); });
  }});
  defineOption("fov", "number", 60);
  defineOption("renderDistance", "number", 100);
  defineOption("mouseTurnRate", "number", 4); // radians/second/half-screen-width
  defineOption("lighting", "boolean", true);
  defineOption("bumpMapping", "boolean", true);
  defineOption("sound", "boolean", true);
  defineOption("noclip", "boolean", false);
  defineOption("alwaysGenerateWorld", "boolean", false);
  defineOption("debugTextureAllocation", "boolean", false);
  defineOption("debugForceRender", "boolean", false);
  defineOption("debugPlayerCollision", "boolean", false);

  defineOption("generate_wx", "number", 400);
  defineOption("generate_wy", "number", 128);
  defineOption("generate_wz", "number", 400);
  defineOption("generate_shape", "string", "fill");
  defineOption("generate_slope", "number", 0.9);
  defineOption("generate_tileSize", "number", 16);
  defineOption("generate_name", "string", "Untitled");

  defineOption("currentTopWorld", "string", "Untitled");
}());

var CubesMain = (function () {
  
  function CubesMain(timestep) {
    var main = this;
    var timestep_ms = timestep*1000;
    var maxCatchup_ms = timestep_ms*3; // arbitrary/tuned, not magic
    
    // GL objects
    var gl;
    var theCanvas;
    var renderer;
    
    var sceneInfo;
    var cursorInfoElem;
    var cursorInfo;
    var chunkProgressBar;
    var persistenceProgressBar;
    
    var focusCell = new Cell("focus", false);
    focusCell.whenChanged(function () {
      scheduleDraw();
      return true;
    });
    
    // Game state, etc. objects
    var player;
    var worldH;
    var input;
    var audio = new CubesAudio(config);
    
    var readyToDraw = false;
    
    var lastGLErrors = [];
    function drawScene(playerRender) {
        var wrend = playerRender.getWorldRenderer();

        renderer.setViewToSkybox(playerRender, focusCell.get());
        renderer.skybox.draw();
        gl.clear(gl.DEPTH_BUFFER_BIT);
        
        renderer.setViewToEye(playerRender, focusCell.get());
        wrend.draw();
        player.render.characterRender.draw();
        player.render.selectionRender.draw();
        
        var e, errs = [];
        while ((e = gl.getError()) !== gl.NO_ERROR && e !== gl.CONTEXT_LOST_WEBGL) {
          errs.push(e);
        }
        // Note: The above comparison is an != rather than !== because webgl-debug.js's wrapped context returns numeric strings (!) instead of numbers for error enums. TODO: File bug.
        
        // Selection info
        cursorInfo.data = "";
        var sel = player.getSelection();
        if (sel !== null) {
          var sx = Infinity;
          var sy = -Infinity;
          var cube = sel.cube;
          for (var dx = 0; dx <= 1; dx++)
          for (var dy = 0; dy <= 1; dy++)
          for (var dz = 0; dz <= 1; dz++) {
            var vec = [cube[0]+dx,cube[1]+dy,cube[2]+dz,1];
            renderer.transformPoint(vec);
            sx = Math.min(sx, vec[0]/vec[3]);
            sy = Math.max(sy, vec[1]/vec[3]);
          }
          if (isFinite(sx) && isFinite(sy)) {
            cursorInfoElem.style.left = (sx + 1) / 2 * theCanvas.width + "px";
            cursorInfoElem.style.bottom = (sy + 1) / 2 * theCanvas.height + "px";
            
            var world = player.getWorld();
            var value = world.g(cube[0],cube[1],cube[2]);
            var sub = world.gSub(cube[0],cube[1],cube[2]);
            var type = world.gt(cube[0],cube[1],cube[2]);
            var text = 
              value
              + (sub ? ":" + sub : "")
              + " at " + sel.cube;

            var circuit = world.getCircuit(cube);
            if (circuit !== null) {
              text += "\nCircuit: " + type.behavior.name + " " + circuit.describeBlock(cube);
            }
            cursorInfo.data = text;
          }
        }
        
        // Per-frame debug/stats info
        frameDesc = "";
        {
          var pp = player.render.getPosition();
          var d = 2;
          frameDesc += "XYZ: " + pp[0].toFixed(d) + "," + pp[1].toFixed(d) + "," + pp[2].toFixed(d) + "\n";
        }
        if (errs.length) {
          lastGLErrors = errs;
          frameDesc += "GL errors:";
          errs.forEach(function (e) {
            frameDesc += " " + WebGLDebugUtils.glEnumToString(e);
          });
          frameDesc += "\n";
        } else if (lastGLErrors.length) {
          frameDesc += "Previous GL errors:";
          lastGLErrors.forEach(function (e) {
            frameDesc += " " + WebGLDebugUtils.glEnumToString(e);
          });
          frameDesc += "\n";
        }
        frameDesc += renderer.verticesDrawn + " vertices\n";
        updateInfoText();
        
        chunkProgressBar.setByTodoCount(wrend.chunkRendersToDo());
        persistenceProgressBar.setByTodoCount(Persister.status.get());
        
        renderer.verticesDrawn = 0;
        renderCount++;
    }
    
    var fpsDesc = "", frameDesc = "", stepCount = 0, renderCount = 0, chunkRenders = 0;
    
    var lastStepTime = null;
    function doOneStep() {
      player.stepYourselfAndWorld(timestep);
      input.step(timestep);
      stepCount++;
    }
    function doStep() {
      // perform limited catch-up
      var now = Date.now();
      if (lastStepTime === null)
        lastStepTime = now;
      if ((now - lastStepTime) > maxCatchup_ms)
        lastStepTime = now - maxCatchup_ms;
      
      while ((now - lastStepTime) > timestep_ms) {
        doOneStep();
        lastStepTime += timestep_ms;
      }
    }
    
    var animFrameWasRequested = false;
    function scheduleDraw() {
      if (!animFrameWasRequested && readyToDraw && !renderer.contextLost) {
        window.requestAnimFrame(function () {
          animFrameWasRequested = false;

          // done here because chunk updating should be deprioritized at the same time drawing would be
          chunkRenders += player.render.getWorldRenderer().updateSomeChunks();

          drawScene(player.render);

          if (config.debugForceRender.get()) scheduleDraw();
        }, theCanvas);
        animFrameWasRequested = true;
      }
    }
    config.debugForceRender.listen({changed: function () { scheduleDraw(); return true; }});

    // statistics are reset once per second
    setInterval(function () {
      fpsDesc = stepCount + " steps/s, " + renderCount + " frames/s, " + chunkRenders + " chunk rebuilds";
      stepCount = renderCount = chunkRenders = 0;
      updateInfoText();
    }, 1000);
    function updateInfoText() {
      if (readyToDraw) {
        sceneInfo.data = frameDesc + fpsDesc;
      }
    }
    
    var t0 = undefined;
    function startupMessage(text) {
      var t1 = Date.now();
      sceneInfo.data += text + "\n";
      if (typeof console !== 'undefined')
        console.log(t0 ? "(+"+(t1-t0)+" ms)" : "        ", text);
      t0 = t1;
    }
    
    // for making our loading more async
    var ABORT = {};
    function sequence(actions, catcher) {
      function sub(i) {
        if (i >= actions.length) {
          return;
        } else {
          setTimeout(function () {
            var a = actions[i];
            if (typeof a === "string") {
              startupMessage(a);
            } else {
              try {
                if (a(function () { sub(i+1); }) === ABORT) { return; }
              } catch (e) {
                catcher(e);
              }
            }
            sub(i+1);
          }, 1);
        }
      }
      sub(0);
    }
    
    this.start = function (pageElements) {
      var sceneInfoOverlay = pageElements.sceneInfoOverlay;
      
      // Overall info overlay
      var sceneInfoTextElem = document.createElement("pre");
      sceneInfoOverlay.appendChild(sceneInfoTextElem);
      sceneInfo = dynamicText(sceneInfoTextElem);
      
      // Progress bars
      chunkProgressBar = new ProgressBar();
      persistenceProgressBar = new ProgressBar();
      sceneInfoOverlay.appendChild(chunkProgressBar.element);
      sceneInfoOverlay.appendChild(persistenceProgressBar.element);
      
      // Info that follows the cursor
      cursorInfoElem = pageElements.cursorInfoOverlay;
      var cursorInfoTextElem = document.createElement("pre");
      cursorInfoElem.appendChild(cursorInfoTextElem);
      cursorInfo = dynamicText(cursorInfoTextElem);
      
      var shaders;

      // Save button
      if (pageElements.saveButton) (function () {
        var saveButton = pageElements.saveButton;
        var originalUIText = saveButton.textContent;
        var saveButtonText = dynamicText(saveButton);
        var lastSavedTime = Date.now();
        Persister.status.nowAndWhenChanged(function (count) {
          if (count === 0) {
            lastSavedTime = Date.now();
            saveButton.style.visibility = "hidden";
          } else {
            saveButton.style.visibility = "visible";
            saveButtonText.data = originalUIText + " (last " + Math.round((Date.now() - lastSavedTime) / (1000*60)) + " min ago)";
          }
          return true;
        });
      }());
      
      // World list
      if (pageElements.worldSelect) {
        var worldSelect = pageElements.worldSelect;
        function updateWorldList() {
          while (worldSelect.firstChild) worldSelect.removeChild(worldSelect.firstChild);
          Persister.forEach(function (name, type) {
            if (Object.create(type.prototype) instanceof World) {
              var c = document.createElement("option");
              c.appendChild(document.createTextNode(name));
              if (config.currentTopWorld.get() === name) c.selected = true;
              worldSelect.appendChild(c);
            }
          });
          return true;
        }
        worldSelect.addEventListener("change", function () {
          main.setTopWorld(Persister.get(worldSelect.value));
        });
        updateWorldList();
        Persister.listen({
          added: updateWorldList,
          deleted: updateWorldList
        });
      }

      var shallLoadWorld = !config.alwaysGenerateWorld.get() && Persister.has(config.currentTopWorld.get());

      // Main startup sequence
      sequence([
        function () {
          if (typeof testSettersWork === 'undefined' || !testSettersWork()) {
            var notice = pageElements.featureError[0];
            var text   = pageElements.featureError[1];
            notice.style.removeProperty("display");
            text.appendChild(document.createTextNode("ECMAScript 5 property accessors on frozen objects"));
          }
        },
        "Downloading resources...",
        function (cont) {
          Renderer.fetchShaders(function (s) {
            if (s === null) {
              // TODO abstract error handling; this duplicates the sequence catcher
              var notice = pageElements.loadError[0];
              var text   = pageElements.loadError[1];
              notice.style.removeProperty("display");
              text.appendChild(document.createTextNode("Failed to download shader files."));
              return;
            }
            shaders = s;
            cont();
          });
          return ABORT; // actually continue by calling cont()
        },
        "Setting up WebGL...",
        function () {
          theCanvas = pageElements.viewCanvas;
          try {
          renderer = main.renderer = new Renderer(theCanvas, shaders, scheduleDraw);
          } catch (e) {
            if (e instanceof Renderer.NoWebGLError) {
              pageElements.webglError[0].style.removeProperty("display");
              return ABORT;
            } else {
              throw e;
            }
          }
          gl = renderer.context;
        },
        shallLoadWorld ? "Loading saved worlds..." : "Creating worlds...",
        function () {
          // Save-on-exit
          window.addEventListener("unload", function () {
            Persister.flushNow();
            return true;
          }, false);
          
          var world;
          if (shallLoadWorld) {
            try {
              world = Persister.get(config.currentTopWorld.get());
            } catch (e) {
              if (typeof console !== 'undefined')
                console.error(e);
              alert("Failed to load saved world!");
            }
          } else if (!Persister.available) {
            console.warn("localStorage not available; world will not be saved.");
          }
          if (!world) {
            world = generateWorlds();
            if (Persister.available && !config.alwaysGenerateWorld.get()) {
              // TODO this crashes if "Default" exists but config.currentTopWorld doesn't.
              world.persistence.persist("Default");
            }
          }
          main.setTopWorld(world);
        },
        "Creating your avatar...",
        function () {
          player = new Player(worldH, renderer/*TODO facet? */, audio/*TODO facet? */, scheduleDraw);
        },
        "Painting blocks...",
        function () {
          // force lazy init to happen now rather than on first frame
          player.getWorld().blockSet.getRenderData(renderer/*TODO facet?*/);
        },
        "Finishing...",
        function () {
          input = new Input(theCanvas, player.input, pageElements.menu, renderer, focusCell);
          theCanvas.focus();
          readyToDraw = true;

          setInterval(doStep, timestep_ms);
        },
        "Ready!"
      ], function (exception) {
        startupMessage(exception);
        var notice = pageElements.loadError[0];
        var text   = pageElements.loadError[1];
        notice.style.removeProperty("display");
        text.appendChild(document.createTextNode(String(exception)));
        throw exception; // propagate to browser console
      });
    };
    
    this.regenerate = function () {
      if (Persister.has(config.generate_name.get())) {
        // TODO pass through pageElements or refactor; this is excessive coupling
        pageElements.nameConflict.style.display = "block";
        return;
      } else {
        pageElements.nameConflict.style.display = "none";
      }
      var world = generateWorlds();
      world.persistence.persist(config.generate_name.get());
      this.setTopWorld(world);
    };
    
    this.setTopWorld = function (world) {
      worldH = world;
      if (player) player.setWorld(world);

      var name = world.persistence.getName();
      if (name !== null) config.currentTopWorld.set(name);
    };
    this.getTopWorld = function () { return worldH; };
    
    this.save = function () {
      Persister.flushAsync();
    };
  }
  
  return CubesMain;
}());
