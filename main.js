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
  function resetAllOptions() {
    Object.keys(config).forEach(function (k) { config[k].setToDefault(); });
  }
  defineOption("fov", "number", 60);
  defineOption("renderDistance", "number", 100);
  defineOption("mouseTurnRate", "number", 4); // radians/second/half-screen-width
  defineOption("lighting", "boolean", true);
  defineOption("bumpMapping", "boolean", true);
  defineOption("sound", "boolean", true);
  defineOption("debugTextureAllocation", "boolean", false);
  defineOption("debugForceRender", "boolean", false);
  defineOption("debugPlayerCollision", "boolean", false);

  defineOption("generate_wx", "number", 400);
  defineOption("generate_wy", "number", 128);
  defineOption("generate_wz", "number", 400);
  defineOption("generate_shape", "string", "fill");
  defineOption("generate_slope", "number", 0.9);
  defineOption("generate_tileSize", "number", 16);
})();

var CubesMain = (function () {
  var MAX_CATCHUP_MS = 500;
  
  function CubesMain(timestep) {
    var main = this;
    var timestep_ms = timestep*1000;
    
    // GL objects
    var gl;
    var theCanvas;
    var renderer;
    
    var sceneInfo;
    var cursorInfoElem;
    var cursorInfo;
    var chunkProgressBar;
    var audioProgressBar;
    
    var focusCell = new Cell("focus", false);
    focusCell.whenChanged(function () {
      scheduleDraw();
      return true;
    });
    
    // Game state, etc. objects
    var player;
    var worldH;
    var input;
    
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
        while ((e = gl.getError()) && e != gl.CONTEXT_LOST_WEBGL) {
          errs.push(e);
        }
        // Note: The above comparison is an != rather than !== because webgl-debug.js's wrapped context returns numeric strings (!) instead of numbers for error enums. TODO: File bug.
        
        // Selection info
        cursorInfo.data = "";
        var sel = player.getSelection();
        if (sel != null) {
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
        var text = "";
        {
          var pp = player.render.getPosition();
          var d = 2;
          text += "XYZ: " + pp[0].toFixed(d) + "," + pp[1].toFixed(d) + "," + pp[2].toFixed(d) + "\n";
        }
        if (errs.length) {
          lastGLErrors = errs;
          text += "GL errors:";
          errs.forEach(function (e) {
            text += " " + WebGLDebugUtils.glEnumToString(e);
          });
          text += "\n";
        } else if (lastGLErrors.length) {
          text += "Previous GL errors:";
          lastGLErrors.forEach(function (e) {
            text += " " + WebGLDebugUtils.glEnumToString(e);
          });
          text += "\n";
        }
        text += renderer.verticesDrawn + " vertices\n";
        text += fpsDesc + "\n";
        sceneInfo.data = text;
        
        chunkProgressBar.setByTodoCount(wrend.chunkRendersToDo());
        audioProgressBar.setByTodoCount(BlockType.audioRendersToDo());
        
        renderer.verticesDrawn = 0;
        renderCount++;
    }
    
    var fpsDesc = "", stepCount = 0, renderCount = 0, chunkRenders = 0;
    
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
      if ((now - lastStepTime) > MAX_CATCHUP_MS)
        lastStepTime = now - MAX_CATCHUP_MS;
      
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
    this.scheduleDraw = scheduleDraw();

    // statistics are reset once per second
    setInterval(function () {
      fpsDesc = stepCount + " steps/s, " + renderCount + " frames/s, " + chunkRenders + " chunk rebuilds";
      stepCount = renderCount = chunkRenders = 0;
      
      // audio spatial test
      //var world = player.getWorld();
      //var b = [world.wx/2, world.wy/2+10, world.wz/2];
      //CubesAudio.play(b, world.blockSet.get(2));
      //player.render.getWorldRenderer().renderCreateBlock(b);
    }, 1000);
    
    // for making our loading more async
    var ABORT = {};
    function sequence(actions, catcher) {
      var t0 = undefined;
      function sub(i) {
        if (i >= actions.length) {
          return;
        } else {
          setTimeout(function () {
            var a = actions[i];
            if (typeof a == 'string') {
              var t1 = Date.now();
              sceneInfo.data += a + "\n";
              if (typeof console !== 'undefined')
                console.log(t0 ? "(+"+(t1-t0)+" ms)" : "        ", a);
              t0 = t1;
            } else {
              try {
                if (actions[i](function () { sub(i+1); }) === ABORT) return;
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
    
    this.start = function () {
      sceneInfo = dynamicText(document.getElementById("scene-info-text"));
      cursorInfoElem = document.getElementById("cursor-info");
      cursorInfo = dynamicText(cursorInfoElem);
      chunkProgressBar = new ProgressBar(document.getElementById("chunks-progress-bar"));
      audioProgressBar = new ProgressBar(document.getElementById("audio-progress-bar"));
      var shaders;

      sequence([
        function () {
          if (typeof testSettersWork === 'undefined' || !testSettersWork()) {
            document.getElementById("feature-error-notice").style.removeProperty("display");
            document.getElementById("feature-error-text").appendChild(document.createTextNode("ECMAScript 5 property accessors on frozen objects"));
          }
        },
        "Downloading resources...",
        function (cont) {
          Renderer.fetchShaders(function (s) {
            if (s === null) {
              // TODO abstract error handling; this duplicates the sequence catcher
              document.getElementById("load-error-notice").style.removeProperty("display");
              document.getElementById("load-error-text").appendChild(document.createTextNode("Failed to download shader files."));
              return;
            }
            shaders = s;
            cont();
          });
          return ABORT; // actually continue by calling cont()
        },
        "Setting up WebGL...",
        function () {
          
          theCanvas = document.getElementById('view-canvas');
          try {
          renderer = main.renderer = new Renderer(theCanvas, shaders, scheduleDraw);
          } catch (e) {
            if (e instanceof Renderer.NoWebGLError) {
              document.getElementById("webgl-error-notice").style.removeProperty("display");
              return ABORT;
            } else {
              throw e;
            }
          }
          gl = renderer.context;
        },
        "Loading worlds...",
        function () {
          var hasLocalStorage = typeof localStorage !== 'undefined';
          document.getElementById('local-save-controls').style.display = hasLocalStorage ? 'block' : 'none';
          document.getElementById('local-save-warning').style.display = !hasLocalStorage ? 'block' : 'none';
          if (hasLocalStorage) {
            var worldData = localStorage.getItem("world");
            if (worldData !== null) {
              try {
                worldH = cyclicUnserialize(JSON.parse(worldData), World);
              } catch (e) {
                if (typeof console !== 'undefined')
                  console.error(e);
                alert("Failed to load saved world!");
              }
            }
          } else {
            console.warn("localStorage not available; world will not be saved.");
          }
          if (!worldH) {
            worldH = generateWorlds();
          }
        },
        "Painting blocks...", // this is what takes the time in world renderer construction
        function () {
          // done after some GL init because player creates world renderer object internally
          player = new Player(worldH, renderer/*TODO facet? */, scheduleDraw);
        },
        "Finishing...",
        function () {
          input = new Input(theCanvas, player.input, document.getElementById("menu"), renderer, focusCell);
          theCanvas.focus();
          readyToDraw = true;

          setInterval(doStep, timestep_ms);
        },
        "Ready!"
      ], function (exception) {
        sceneInfo.data += exception;
        document.getElementById("load-error-notice").style.removeProperty("display");
        document.getElementById("load-error-text").appendChild(document.createTextNode("" + exception));
        throw exception; // propagate to browser console
      });
    };
    
    this.setTopWorld = function (world) {
      worldH = world;
      player.setWorld(world);
    };
    this.getTopWorld = function () { return worldH; };
  }
  
  return CubesMain;
})();
