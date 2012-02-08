// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

/*
GL/shader state management policies
-----------------------------------

This is what you can assume:
  useProgram: Fixed to the one and only program.
  FRAMEBUFFER: Null.
  DEPTH_TEST: Enabled.
  CULL_FACE: Enabled.
  lineWidth: Undefined.
  depthMask: True.
  uParticleMode: False.
  Viewpoint-related properties (viewport, matrices, fog) are managed as a group by setViewTo*. They may be saved and restored using renderer.saveView.
  Vertex property arrays are managed as a group by RenderBundle and are otherwise undefined.
*/

var Renderer = (function () {
  "use strict";
  
  var DEBUG_GL = false;
  
  function Renderer(canvas, shaders, scheduleDraw) {
    //canvas = WebGLDebugUtils.makeLostContextSimulatingCanvas(canvas);
    //canvas.loseContextInNCalls(5000);
    //canvas.setRestoreTimeout(2000);
    
    // --- State ---
    
    var renderer = this;
    
    var gl = null;
    
    // View and projection transformation globals.
    var pMatrix = mat4.create();
    var mvMatrix = mat4.create();
    var viewPosition = vec3.create();
    var viewFrustum = {}; // computed

    // prepareProgram fills in these with the locations of the shader program variables
    var attribs = {};
    var uniforms = {};
    
    var contextLost = false;
    // Incremented every time we lose context
    var contextSerial = 0;
    
    // --- Internals ---
    
    function buildProgram() {
      
      attribs = {};
      uniforms = {};
      
      var decls = {
        LIGHTING: config.lighting.get(),
        BUMP_MAPPING: config.bumpMapping.get()
      };
      
      var program = prepareProgram(gl,
                     prepareShader(gl, gl.VERTEX_SHADER, [shaders.common, shaders.vertex], decls),
                     prepareShader(gl, gl.FRAGMENT_SHADER, [shaders.common, shaders.fragment], decls),
                     attribs, uniforms);          
      gl.useProgram(program);
 
      // Constant program-specific state
      gl.enableVertexAttribArray(attribs.aVertexPosition);
      gl.enableVertexAttribArray(attribs.aVertexNormal);
    }
    
    function initContext() {
      contextSerial++;
      
      buildProgram();
      
      // Mostly-constant GL state
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      
      // Config-based GL state
      sendViewUniforms();
    }
    
    function calculateFrustum() {
      var matrix = mat4.multiply(pMatrix, mvMatrix, mat4.create());
      mat4.inverse(matrix);
      // matrix is now a clip-space-to-model-space conversion
      
      function dehomog(v4) {
        return [v4[0]/v4[3], v4[1]/v4[3], v4[2]/v4[3]];
      }
      // Return a function which tests whether the point is in the half-space bounded by the plane containing origin, pt1, and pt2, and pointed toward by pt1 cross pt2.
      function makeHalfSpaceTest(origin, pt1, pt2) {
        var normal = vec3.cross(
          vec3.subtract(pt1, origin, vec3.create()),
          vec3.subtract(pt2, origin, vec3.create()),
          vec3.create());
        var vecbuf = vec3.create();
        return function (point) {
          vec3.subtract(point, origin, vecbuf);
          return vec3.dot(vecbuf, normal) > 0;
        }
      }
      var lbn = dehomog(mat4.multiplyVec4(matrix, [-1,-1,-1,1]));
      var lbf = dehomog(mat4.multiplyVec4(matrix, [-1,-1, 1,1]));
      var ltn = dehomog(mat4.multiplyVec4(matrix, [-1, 1,-1,1]));
      var ltf = dehomog(mat4.multiplyVec4(matrix, [-1, 1, 1,1]));
      var rbn = dehomog(mat4.multiplyVec4(matrix, [ 1,-1,-1,1]));
      var rbf = dehomog(mat4.multiplyVec4(matrix, [ 1,-1, 1,1]));
      var rtn = dehomog(mat4.multiplyVec4(matrix, [ 1, 1,-1,1]));
      var rtf = dehomog(mat4.multiplyVec4(matrix, [ 1, 1, 1,1]));
      
      viewFrustum = [
        makeHalfSpaceTest(lbn, lbf, ltf), // left
        makeHalfSpaceTest(rtn, rtf, rbf), // right
        makeHalfSpaceTest(ltn, ltf, rtf), // top
        makeHalfSpaceTest(rbn, rbf, lbf), // bottom
        makeHalfSpaceTest(lbn, ltn, rtn), // near
        makeHalfSpaceTest(lbf, rbf, ltf)  // far
      ];
    }
    
    function updateViewport() {
      var pagePixelWidth = parseInt(window.getComputedStyle(canvas,null).width, 10);
      var pagePixelHeight = parseInt(window.getComputedStyle(canvas,null).height, 10);
      
      // Specify canvas resolution
      canvas.width = pagePixelWidth;
      canvas.height = pagePixelHeight;
      
      // WebGL is not guaranteed to give us that resolution; instead, what it
      // can supply is returned in .drawingBuffer{Width,Height}. However, those
      // properties are not supported by, at least, Firefox 6.0.2.
      if (typeof gl.drawingBufferWidth !== "number") {
        gl.drawingBufferWidth = pagePixelWidth;
        gl.drawingBufferHeight = pagePixelHeight;
      }
      
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(uniforms.uPixelsPerClipUnit, gl.drawingBufferWidth / 2,
                                                gl.drawingBufferHeight / 2);

      updateProjection();
    }
    
    function updateProjection() {
      var fov = config.fov.get();
      var aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
      
      var nearestApproachToPlayer = Player.aabb.minimumRadius();
      var nearPlane = nearestApproachToPlayer 
                      / Math.sqrt(1 + Math.pow(Math.tan(fov/180*Math.PI/2), 2)
                                      * (Math.pow(aspectRatio, 2) + 1));
      
      mat4.perspective(fov,
                       aspectRatio,
                       nearPlane,
                       config.renderDistance.get(),
                       pMatrix);
      
      gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
      // uFogDistance is handled by drawScene because it is changed.
    }
    
    function sendViewUniforms() {
      // TODO: We used to be able to avoid sending the projection matrix when only the view changed. Re-add that, if worthwhile.
      gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
      gl.uniformMatrix4fv(uniforms.uMVMatrix, false, mvMatrix);
      gl.uniform3fv(uniforms.uViewPosition, viewPosition);
      calculateFrustum();
    }

    function handleContextLost(event) {
      contextLost = true;
      event.preventDefault();
    }
    
    function handleContextRestored() {
      contextLost = false;
      initContext();
      scheduleDraw();
    }

    // --- Config bindings ---
    
    var rebuildProgramL = {changed: function (v) {
      buildProgram();
      updateViewport(); // note this is only to re-send uPixelsPerClipUnit; TODO have better updating scheme
      scheduleDraw();
      return true;
    }};
    var projectionL = {changed: function (v) {
      updateProjection();
      scheduleDraw();
      return true;
    }};
    config.lighting.listen(rebuildProgramL);
    config.bumpMapping.listen(rebuildProgramL);
    config.fov.listen(projectionL);
    config.renderDistance.listen(projectionL);

    // --- Initialization ---
    
    gl = canvas.getContext("experimental-webgl", {
      // Reduces fillrate cost (which is a problem due to the layered block rendering), and also avoids MSAA problems with the meetings of subcube edges. (TODO: Try to fix that in the fragment shader by enlarging the texture.)
      antialias: false
    });
    if (DEBUG_GL) {
      gl = WebGLDebugUtils.makeDebugContext(gl);
    } else {
      WebGLDebugUtils.init(gl);
    }
    this.context = gl;
    
    if (!gl) throw new Renderer.NoWebGLError();
    
    canvas.addEventListener("webglcontextlost", handleContextLost, false);
    canvas.addEventListener("webglcontextrestored", handleContextRestored, false);
    
    initContext();
    updateViewport();
    
    window.addEventListener("resize", function () { // TODO shouldn't be global
      updateViewport();
      scheduleDraw();
      return true;
    }, false);
    
    // --- Public components ---
    
    Object.defineProperty(this, "contextLost", {
      enumerable: true,
      get: function () { return contextLost; }
    });

    Object.defineProperty(this, "verticesDrawn", {
      enumerable: true,
      writable: true,
      value: 0
    });

    // Return a function which returns true when the context currently in effect has been lost.
    function currentContextTicket() {
      var s = contextSerial;
      return function () { return contextSerial !== s; };
    }
    this.currentContextTicket = currentContextTicket;
    
    // View-switching: Each of these produces a self-consistent state of variables and uniforms.
    // The state managed by these view routines is:
    //   * Projection matrix
    //   * Modelview matrix and viewPosition
    //   * Fog distance
    //   * Depth test
    function setViewToSkybox(playerRender, focus) {
      // The skybox exceeeds the fog distance, so it is rendered fully fogged
      // and only the fog-shading determines the sky color. This ensures that
      // normal geometry fades smoothly into the sky rather than turning
      // a possibly-different fog color.
      mat4.identity(mvMatrix);
      playerRender.applyViewRot(mvMatrix);
      viewPosition = [0,0,0];
      sendViewUniforms();
      gl.uniform1f(uniforms.uFogDistance, 1); // 0 would be div-by-0
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1f(uniforms.uFocusCue, focus);
    }
    this.setViewToSkybox = setViewToSkybox;
    function setViewToEye(playerRender, focus) {
      gl.enable(gl.DEPTH_TEST);
      viewPosition = playerRender.getPosition();
      playerRender.applyViewTranslation(mvMatrix);

      gl.uniform1f(uniforms.uFogDistance, config.renderDistance.get());
      gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
      sendViewUniforms();
      gl.uniform1f(uniforms.uFocusCue, focus);
    }
    this.setViewToEye = setViewToEye;
    function setViewToBlock() { // Ortho view of block at 0,0,0
      mat4.identity(mvMatrix);
      mat4.rotate(mvMatrix, Math.PI/4 * 0.6, [1, 0, 0]);
      mat4.rotate(mvMatrix, Math.PI/4 * 0.555, [0, 1, 0]);
      mat4.translate(mvMatrix, [-0.5,-0.5,-0.5]);

      gl.uniform1f(uniforms.uFogDistance, 100);
      gl.uniformMatrix4fv(uniforms.uPMatrix, false,
        mat4.ortho(-0.8, 0.8, -0.8, 0.8, -1, 1, pMatrix));
      gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
      sendViewUniforms();
      gl.uniform1f(uniforms.uFocusCue, true);
    }
    this.setViewToBlock = setViewToBlock;
    function setViewTo2D() { // 2D view with coordinates in [-1..1]
      var aspect = canvas.width / canvas.height;
      var w, h;
      if (aspect > 1) {
        w = aspect;
        h = 1;
      } else {
        w = 1;
        h = 1/aspect;
      }
      
      mat4.ortho(-w, w, -h, h, -1, 1, pMatrix);
      mat4.identity(mvMatrix);
      sendViewUniforms();
      gl.uniform1f(uniforms.uFocusCue, true);
    }
    this.setViewTo2D = setViewTo2D;
    function saveView() {
      var savedMVMatrix = mvMatrix; mvMatrix = mat4.create();
      var savedPMatrix = pMatrix;  pMatrix = mat4.create();
      var savedView = viewPosition;
      return function () {
        mvMatrix = savedMVMatrix;
        pMatrix = savedPMatrix;
        viewPosition = savedView;

        gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
        sendViewUniforms();
      };
    }
    this.saveView = saveView;
    
    function setStipple(val) {
      gl.uniform1i(uniforms.uStipple, val ? 1 : 0);
    }
    this.setStipple = setStipple;
    
    function setTileSize(val) {
      gl.uniform1f(uniforms.uTileSize, val);
    }
    this.setTileSize = setTileSize;
    
    function BufferAndArray(numComponents) {
      this.numComponents = numComponents;
      this.buffer = gl.createBuffer();
      this.array = null;
    }
    BufferAndArray.prototype.countVertices = function () {
      return this.array.length / this.numComponents;
    };
    BufferAndArray.prototype.load = function (jsArray, checkAgainst) {
      this.array = new Float32Array(jsArray);
      if (checkAgainst && this.countVertices() !== checkAgainst.countVertices()) {
        throw new Error("Inconsistent number of vertices.");
      }
    };
    BufferAndArray.prototype.send = function (mode) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.array, mode);
    };
    BufferAndArray.prototype.renew = function (mode) {
      this.buffer = gl.createBuffer();
    };
    BufferAndArray.prototype.attrib = function (attrib) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.vertexAttribPointer(attrib, this.numComponents, gl.FLOAT, false, 0, 0);
    };
    BufferAndArray.prototype.deleteResources = function () {
      gl.deleteBuffer(this.buffer);
      this.buffer = this.array = null;
    };
    this.BufferAndArray = BufferAndArray;
    
    // Manages a set of attribute arrays for some geometry to render.
    // The calcFunc is called and given a set of JS arrays to fill, immediately as well as whenever this.recompute() is called.
    // If calcFunc is null, then the client is expected to fill the arrays manually.
    function RenderBundle(primitive, optGetTexture, calcFunc, options) {
      options = options || {};
      
      var v = new BufferAndArray(3);
      var n = new BufferAndArray(3);
      if (!optGetTexture) var c = new BufferAndArray(4);
      if (optGetTexture) var t = new BufferAndArray(2);
      var mustRebuild = currentContextTicket();
      
      if (calcFunc !== null) {
        this.recompute = function () {
          var vertices = [];
          var normals = [];
          var colors = optGetTexture ? null : [];
          var texcoords = optGetTexture ? [] : null;
          calcFunc(vertices, normals, optGetTexture ? texcoords : colors);

          if (mustRebuild()) {
            v.renew();
            n.renew();
            if (t) t.renew();
            if (c) c.renew();
            mustRebuild = currentContextTicket();
          }

          v.load(vertices);
          v.send(gl.STATIC_DRAW);
          n.load(normals, v);
          n.send(gl.STATIC_DRAW);

          if (optGetTexture) {
            t.load(texcoords, v);
            t.send(gl.STATIC_DRAW);
          } else {
            c.load(colors, v);
            c.send(gl.STATIC_DRAW);
          }
        };

        this.recompute();
      }

      // made available for partial updates
      this.vertices = v;
      this.normals = n;
      this.colors = c;
      this.texcoords = t;
      
      function draw() {
        if (mustRebuild()) {
          v.renew();
          n.renew();
          if (t) t.renew();
          if (c) c.renew();
          v.send(gl.STATIC_DRAW);
          n.send(gl.STATIC_DRAW);
          if (t) t.send(gl.STATIC_DRAW);
          if (c) c.send(gl.STATIC_DRAW);
          mustRebuild = currentContextTicket();
        }
        
        v.attrib(attribs.aVertexPosition);
        n.attrib(attribs.aVertexNormal);
        
        gl.uniform1i(uniforms.uTextureEnabled, optGetTexture ? 1 : 0);

        if (optGetTexture) {
          gl.enableVertexAttribArray(attribs.aTextureCoord);
          gl.disableVertexAttribArray(attribs.aVertexColor);
          
          t.attrib(attribs.aTextureCoord);
  
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, optGetTexture());
          gl.uniform1i(uniforms.uSampler, 0);
        } else {
          gl.disableVertexAttribArray(attribs.aTextureCoord);
          gl.enableVertexAttribArray(attribs.aVertexColor);

          c.attrib(attribs.aVertexColor);
        }
        var count = v.countVertices();
        renderer.verticesDrawn += count;
        gl.drawArrays(primitive, 0, count);
      }
      this.draw = options.aroundDraw ? function () { options.aroundDraw(draw); } : draw;
      
      this.deleteResources = function () {
        v.deleteResources();        this.vertices  = v = null;
        n.deleteResources();        this.normals   = n = null;
        if (c) c.deleteResources(); this.colors    = c = null;
        if (t) t.deleteResources(); this.texcoords = t = null;
      }
    }
    this.RenderBundle = RenderBundle;
    
    function BlockParticles(location, tileSize, blockType, destroyMode, symm) {
      var blockWorld = blockType.world;
      var k = 2;
      var t0 = Date.now();
      var rb = new renderer.RenderBundle(gl.POINTS, null, function (vertices, normals, colors) {
        for (var x = 0; x < tileSize; x++)
        for (var y = 0; y < tileSize; y++)
        for (var z = 0; z < tileSize; z++) {
          if (!destroyMode) {
            if (!(x < k || x >= tileSize-k ||
                  y < k || y >= tileSize-k ||
                  z < k || z >= tileSize-k)) {
              continue;
            }
            var c = 1.0 - Math.random() * 0.04;
            colors.push(c,c,c,1);
          } else if (blockWorld) {
            blockWorld.gt(x,y,z).writeColor(1, colors, colors.length);
            if (colors[colors.length - 1] <= 0.0) {
              // transparent, skip
              colors.length -= 4;
              continue;
            }
          } else if (blockType.color) {
            // destroy mode for color cubes
            blockType.writeColor(1, colors, colors.length);
          }
          var v = applyCubeSymmetry(symm, 1, [
            (x+0.5)/tileSize,
            (y+0.5)/tileSize,
            (z+0.5)/tileSize
          ]);
          
          vertices.push(location[0]+v[0],
                        location[1]+v[1],
                        location[2]+v[2]);
          normals.push(0,0,0); // disable lighting
        }
      }, {
        aroundDraw: function (draw) {
          gl.uniform1i(uniforms.uParticleMode, 1);
          gl.uniform1i(uniforms.uParticleExplode, destroyMode ? 1 : 0);
          gl.uniform1f(uniforms.uParticleInterp, t());
          draw();
          gl.uniform1i(uniforms.uParticleMode, 0);
        }
      });
      
      function t() {
        return Math.min((Date.now() - t0) * 0.003, 1);
      }
      
      rb.expired = function () { return t() >= 1; };
      
      return rb;
    }
    this.BlockParticles = BlockParticles;
    
    // Returns a pair of points along the line through the given screen point.
    function getAimRay(screenPoint, playerRender) {
      var glxy = [
          screenPoint[0] / canvas.width * 2 - 1, 
        -(screenPoint[1] / canvas.height * 2 - 1)
      ];
      
      var unproject = mat4.identity(mat4.create());
      playerRender.applyViewRot(unproject);
      playerRender.applyViewTranslation(unproject);
      mat4.multiply(pMatrix, unproject, unproject);
      mat4.inverse(unproject);

      var pt1 = fixedmultiplyVec3(unproject, vec3.create([glxy[0], glxy[1], 0]));
      var pt2 = fixedmultiplyVec3(unproject, vec3.create([glxy[0], glxy[1], 1]));

      return [pt1, pt2];
    }
    this.getAimRay = getAimRay;
    
    function aabbInView(aabb) {
      for (var i = 0; i < viewFrustum.length; i++) {
        var outside = true;
        for (var xb = 0; xb < 2; xb++)
        for (var yb = 0; yb < 2; yb++)
        for (var zb = 0; zb < 2; zb++) {
          var vec = [aabb.get(0,xb), aabb.get(1,yb), aabb.get(2,zb)];
          if (viewFrustum[i](vec))
            outside = false;
        }
        if (outside)
          return false;
      }
      return true;
    }
    this.aabbInView = aabbInView;
    
    function transformPoint(vec) {
      mat4.multiplyVec4(mvMatrix, vec);
      mat4.multiplyVec4(pMatrix, vec);
    }
    this.transformPoint = transformPoint;
    
    this.setFocusCue = function (v) {
      gl.uniform1i(uniforms.uFocusCue, v ? 1 : 0);
      scheduleDraw();
    }
    
    // --- Non-core game-specific rendering utilities ---
    
    var skyboxR = new RenderBundle(gl.TRIANGLES, null, function (vertices, normals, colors) {
      // abstracted in case this becomes useful elsewhere ...
      function cube(vertices, colors, size, outward) {
        function ppush(a, b, c) {
          var v = [];
          v[dim] = a;
          v[da] = b;
          v[db] = c;
          vertices.push(v[0], v[1], v[2]);
          normals.push(0,0,0); // TODO stub
          colors.push(1, 0, 0, 1);
        }
        for (var dim = 0; dim < 3; dim++) {
          for (var dir = -1; dir < 2; dir+=2) {
            var da = mod(dim + (outward ? 1 : -1) * dir, 3);
            var db = mod(dim + (outward ? 2 : -2) * dir, 3);
            ppush(dir*size, -size, -size);
            ppush(dir*size,  size, -size);
            ppush(dir*size,  size,  size);
            ppush(dir*size,  size,  size);
            ppush(dir*size, -size,  size);
            ppush(dir*size, -size, -size);
          }
        }
      }
      
      // While rendering this, the fog distance is adjusted so that anything
      // farther than 1 unit is fully fogged.
      cube(vertices, colors, 1, false);
    });
    
    this.skybox = skyboxR;
    
    Object.seal(this); // TODO freeze all but verticesDrawn
  }
  
  Renderer.NoWebGLError = function () {
    Error.call(this);
  };
  Renderer.NoWebGLError.prototype = Object.create(Error.prototype);
  
  Renderer.fetchShaders = function (callback) {
    var table = {
      common: undefined,
      vertex: undefined,
      fragment: undefined
    };
    var names = Object.keys(table);
    
    names.forEach(function (filename) {
      fetchResource("shaders/"+filename+".glsl", "text", function (data) { 
        table[filename] = data;
        check();
      });
    });
    
    function check() {
      if (names.every(function (f) { return table[f] !== undefined; })) {
        if (names.some(function (f) { return table[f] === null; })) {
          callback(null); // TODO better error reporting
        } else {
          callback(Object.freeze(table));
        }
      }
    }
  };
  
  return Object.freeze(Renderer);
}());
