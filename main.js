// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.
//
// Exception: The overall structure of WebGL initialization and context
// management is derived from Learning WebGL, Lesson 16, at
// http://learningwebgl.com/blog/?p=1786 (as of September 2011). No license is
// stated on that site, but I (Kevin Reid) believe that it is obviously the
// authors' intent to make this code free to use.

// Main loop scheduling, scene drawing, performance statistics, etc.

var CubesMain = (function () {
  // rootURL should be the directory containing this script (unfortunately not directly available).
  function CubesMain(rootURL, timestep, storage) {
    var main = this;
    
    // configuration
    var config = {};
    (function () {
      function defineOption(name, type, value) {
        config[name] = new PersistentCell(storage, "cubes.option." + name, type, value);
      }
      Object.defineProperty(config, "resetAllOptions", {value: function () {
        Object.keys(config).forEach(function (k) { config[k].setToDefault(); });
      }});
      defineOption("fov", "number", 60);
      defineOption("renderDistance", "number", 100);
      defineOption("mouseTurnRate", "number", 4); // radians/second/half-screen-width
      defineOption("lighting", "boolean", true);
      defineOption("bumpMapping", "boolean", true);
      defineOption("fsaa", "boolean", false);
      defineOption("cubeParticles", "boolean", false);
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
      defineOption("generate_blockset", "string", "Default Blockset"); // TODO UI for this

      defineOption("currentTopWorld", "string", "Untitled");
    }());
    
    var persistencePool = new PersistencePool(storage, "cubes.object."); // note: storage may be undefined, pool  will be a stub
    
    // time parameters
    var timestep_ms = timestep*1000;
    var maxCatchup_ms = timestep_ms*3; // arbitrary/tuned, not magic
    
    // GL objects
    var gl;
    var theCanvas;
    var renderer;
    
    var audio = new CubesAudio(config);
    
    // HTML elements and other UI pieces
    var sceneInfo;
    var cursorInfoElem;
    var cursorInfo;
    var chunkProgressBar;
    var persistenceProgressBar;
    var measureDisplay;
    
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
    
    function getOrDefaultOrMake(selection, defaultName, maker) {
      if (persistencePool.has(selection) && !config.alwaysGenerateWorld.get()) {
        try {
          return persistencePool.get(selection);
        } catch (exception) {
          // TODO: Propagate this to the UI; the user should know of data loss
          if (typeof console !== "undefined") console.log("Failed to load selected:", exception);
        }
      }
      
      if (persistencePool.has(defaultName) && !config.alwaysGenerateWorld.get()) {
        try {
          return persistencePool.get(defaultName);
        } catch (exception) {
          // TODO: Propagate this to the UI; the user should know of data loss
          if (typeof console !== "undefined") console.log("Failed to load default:", exception);
        }
      }
      
      var obj = maker();
      if (persistencePool.available && !config.alwaysGenerateWorld.get() && !persistencePool.has(defaultName)) {
        persistencePool.persist(obj, defaultName);
      }
      return obj;
    }
    
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
            var computedStyle = window.getComputedStyle(theCanvas,null);
            cursorInfoElem.style.left   = (sx + 1) / 2 * parseInt(computedStyle.width,  10) + "px";
            cursorInfoElem.style.bottom = (sy + 1) / 2 * parseInt(computedStyle.height, 10) + "px";
            
            var world = player.getWorld();
            var value = world.g(cube[0],cube[1],cube[2]);
            var sub = world.gSub(cube[0],cube[1],cube[2]);
            var type = world.gt(cube[0],cube[1],cube[2]);
            var text = (
              value
              + (sub ? ":" + sub : "")
              + (type.name ? " (" + type.name + ")" : "")
              + "\nat " + sel.cube
            );

            var circuit = world.getCircuit(cube);
            if (circuit !== null) {
              text += "\nCircuit: " + type.behavior.name + " " + circuit.describeBlock(cube);
            }
            cursorInfo.data = text;
          }
        }
        
        // Per-frame debug/stats info
        var frameDesc = "";
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
        sceneInfo.data = frameDesc;
        
        chunkProgressBar.setByTodoCount(wrend.chunkRendersToDo());
        persistenceProgressBar.setByTodoCount(persistencePool.status.get());
        
        measuring.frameCount.inc();
        measuring.bundles.inc(renderer.bundlesDrawn);
        measuring.vertices.inc(renderer.verticesDrawn);
        renderer.bundlesDrawn = 0;
        renderer.verticesDrawn = 0;
    }
    
    var frameDesc = "";
    
    var lastStepTime = null;
    function doOneStep() {
      measuring.sim.start();
      player.stepYourselfAndWorld(timestep);
      input.step(timestep);
      measuring.sim.end();
      measuring.simCount.inc();
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
      measureDisplay.updateIfVisible();
    }
    
    var animFrameWasRequested = false;
    function scheduleDraw() {
      if (!animFrameWasRequested && readyToDraw && !renderer.contextLost) {
        window.requestAnimationFrame/*shimmed*/(function () {
          animFrameWasRequested = false;

          // done here because chunk updating should be deprioritized at the same time drawing would be
          player.render.getWorldRenderer().updateSomeChunks();

          measuring.frame.start();
          drawScene(player.render);
          measuring.frame.end();
          measureDisplay.updateIfVisible();
          
          if (config.debugForceRender.get()) scheduleDraw();
        }, theCanvas);
        animFrameWasRequested = true;
      }
    }
    config.debugForceRender.listen({changed: function () { scheduleDraw(); return true; }});

    // statistics are reset once per second
    measuring.second.start();
    setInterval(function () {
      measuring.second.end();
      measuring.second.start();
      measureDisplay.updateIfVisible();
    }, 1000);
    
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
    
    this.start = function (pageElements, callback) {
      var sceneInfoOverlay = pageElements.sceneInfoOverlay;
      
      // Overall info overlay
      var sceneInfoTextElem = document.createElement("pre");
      sceneInfoOverlay.appendChild(sceneInfoTextElem);
      sceneInfo = dynamicText(sceneInfoTextElem);
      
      // Performance info
      measureDisplay = measuring.all.createDisplay(document, "cubes.measurement-ui");
      // Inserted later once startup is finished.
      
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
        persistencePool.status.nowAndWhenChanged(function (count) {
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
      
      // Object list
      if (pageElements.objectList) {
        var objectList = pageElements.objectList;
        function updateObjectList() {
          var totalSize = 0;
          while (objectList.firstChild) objectList.removeChild(objectList.firstChild);
          persistencePool.forEach(function (name, type) {
            var row = document.createElement("tr");
            objectList.appendChild(row);
            var typeCell = document.createElement("td");
            var nameCell = document.createElement("td");
            var sizeCell = document.createElement("td");
            row.appendChild(typeCell);
            row.appendChild(nameCell);
            row.appendChild(sizeCell);
            switch (type) {
              case World: typeCell.textContent = "world"; break;
              case BlockSet: typeCell.textContent = "blockset"; break;
              case BlockType: typeCell.textContent = "block type"; break;
              default: typeCell.textContent = "???"; break;
            }
            nameCell.textContent = name;
            var size = persistencePool.getSize(name);
            totalSize += size;
            sizeCell.textContent = (size/1000).toFixed(0) + "K";
            if (persistencePool.getIfLive(name) === worldH) row.className += " selected";
            
            row.addEventListener("click", function () {
              var obj = persistencePool.get(name);
              if (obj instanceof World) {
                main.setTopWorld(obj);
              }
            });
            
            var controlsArea = document.createElement("td");
            row.appendChild(controlsArea);
            
            function addControl(label, fn) {
              var b = document.createElement("button");
              b.textContent = label;
              controlsArea.appendChild(b);
              b.addEventListener("click", fn, false);
            }
            
            addControl("Delete", function () {
              if (window.confirm("Really delete “" + name + "”?")) {
                // TODO unnecessary unserialization - change pool interface
                persistencePool.get(name).persistence.ephemeralize();
              }
            });
            
            //addControl("Export", function () {
            //  // TODO put serialization text up in a dialog box. (Also add "Export Current World")
            //});
            
            // TODO: add rename
          });
          
          var totalRow = document.createElement("tr");
          objectList.appendChild(totalRow);
          var nameCell = document.createElement("th");
          nameCell.textContent = "Total";
          var sizeCell = document.createElement("td");
          sizeCell.textContent = (totalSize/1000).toFixed(0) + "K";
          totalRow.appendChild(document.createElement("td"));
          totalRow.appendChild(nameCell);
          totalRow.appendChild(sizeCell);
          
          return true;
        }
        updateObjectList();
        config.currentTopWorld.whenChanged(updateObjectList); // TODO wrong listener (should be noting changes to worldH) and also unnecessarily rebuilding the list
        persistencePool.listen({
          added: updateObjectList,
          deleted: updateObjectList
        });
      }

      var shallLoadWorld = !config.alwaysGenerateWorld.get() && persistencePool.has(config.currentTopWorld.get());

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
          Renderer.fetchShaders(rootURL, function (s) {
            if (s === null) {
              // TODO abstract error handling; this duplicates the sequence catcher
              var notice = pageElements.loadError[0];
              var text   = pageElements.loadError[1];
              notice.style.removeProperty("display");
              text.appendChild(document.createTextNode("Failed to download shader files."));
              if (/^file:/.test(window.location.href)) {
                text.appendChild(document.createTextNode("\n\nThis is probably because your browser is (rightfully) prohibiting access to local files. Please try accessing Cubes via a web server (http://...) instead."));
              }
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
          renderer = main.renderer = new Renderer(config, theCanvas, shaders, scheduleDraw);
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
            persistencePool.flushNow();
            return true;
          }, false);
          
          var world = getOrDefaultOrMake(config.currentTopWorld.get(), "Default World", function () {
            var blockset = getOrDefaultOrMake(config.generate_blockset.get(), "Default Blockset", function () {
              startupMessage("  Creating default blockset...");
              return WorldGen.newDefaultBlockset(Math.round(config.generate_tileSize.get()));
            });
            startupMessage("  Creating overworld...");
            return generateWorlds(config, blockset);
          });

          main.setTopWorld(world);
        },
        "Creating your avatar...",
        function () {
          player = main.player = new Player(config, worldH, renderer/*TODO facet? */, audio/*TODO facet? */, scheduleDraw);
        },
        "Painting blocks...",
        function () {
          // force lazy init to happen now rather than on first frame
          player.getWorld().blockSet.getRenderData(renderer/*TODO facet?*/);
        },
        "Finishing...",
        function () {
          input = main.input = new Input(config, theCanvas, player.input, pageElements.hud, renderer, focusCell, main.save.bind(main));
          theCanvas.focus();
        },
        "Ready!",
        function () {
          readyToDraw = true;
          sceneInfoOverlay.insertBefore(measureDisplay.element, sceneInfoTextElem.nextSibling);
          setInterval(doStep, timestep_ms);
          callback(null);
        }
      ], function (exception) {
        startupMessage(exception);
        var notice = pageElements.loadError[0];
        var text   = pageElements.loadError[1];
        notice.style.removeProperty("display");
        text.appendChild(document.createTextNode(String(exception)));
        callback(exception);
        throw exception; // propagate to browser console
      });
    };
    
    this.regenerate = function () {
      var world = generateWorlds(config, persistencePool.get(config.generate_blockset.get()));
      persistencePool.persist(world, config.generate_name.get());
      this.setTopWorld(world);
    };
    var genOKCell = new Cell("main.regenerateOK", false);
    this.regenerateOK = genOKCell.readOnly;
    function recalcGenOK() {
      genOKCell.set(!persistencePool.has(config.generate_name.get()));
      return true;
    }
    config.generate_name.whenChanged(recalcGenOK);
    persistencePool.listen({
      added: recalcGenOK,
      deleted: recalcGenOK
    });
    
    this.setTopWorld = function (world) {
      worldH = world;
      if (player) player.setWorld(world);

      var name = world.persistence.getName();
      if (name !== null) config.currentTopWorld.set(name);
    };
    this.getTopWorld = function () { return worldH; };
    
    this.save = function () {
      persistencePool.flushAsync();
    };

    this.requestFullScreen = function () {
      input.requestFullScreen();
    };

    // Exposed for debugging access
    this.config = config;
    this.pool = persistencePool;
    this.player = null;
  }
  
  return CubesMain;
}());
