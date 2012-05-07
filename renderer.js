// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

/*
GL/shader state management policies
-----------------------------------

This is what you can assume/should do:
  useProgram: Do not use directly; use switchProgram().
  FRAMEBUFFER: Null.
  DEPTH_TEST: Enabled.
  CULL_FACE: Enabled.
  lineWidth: Undefined.
  depthMask: True.
  activeTexture: Undefined.
  uParticleMode: False.
  Viewpoint-related properties (viewport, matrices, fog) are managed as a group by setViewTo*. They may be saved and restored using renderer.saveView.
  Vertex property arrays are managed as a group by RenderBundle and are otherwise undefined.
  Texture 0: RenderBundle-associated texture
  Texture 1: Skybox
  Texture 2: Luminance white noise
*/

var Renderer = (function () {
  "use strict";
  
  var DEBUG_GL = false;
  
  // Attributes which are bound in order to give consistent locations across all shader programs.
  // The numbers are arbitrary.
  var permanentAttribs = {
    aVertexPosition: 0,
    aVertexNormal: 1,
    aTextureCoord: 2,
    aVertexColor: 3
  };
  
  function Renderer(config, canvas, shaders, scheduleDraw) {
    //canvas = WebGLDebugUtils.makeLostContextSimulatingCanvas(canvas);
    //canvas.loseContextInNCalls(5000);
    //canvas.setRestoreTimeout(2000);
    
    // --- State ---
    
    var renderer = this;
    
    var gl = null;
    
    // View and projection transformation globals.
    var pixelScale;
    var pagePixelWidth, pagePixelHeight;
    var pMatrix = mat4.create();
    var mvMatrix = mat4.create();
    var viewPosition = vec3.create();
    var viewFrustum = {}; // computed
    
    // Other local mirrors of GL state
    var fogDistance = 0;
    var stipple = 0;
    var tileSize = 1;
    var focusCue = false;
    var currentTexture = undefined; // undefined=unknown/invalid, null=none, or texture

    // Shader programs, and attrib and uniform locations
    var blockProgramSetup = null;
    var particleProgramSetup = null;
  
    var currentProgramSetup = null;
    var attribs, uniforms;
    
    var contextLost = false;
    // Incremented every time we lose context
    var contextSerial = 0;
    
    var skyTexture;
    var noiseTexture;
    
    // --- Internals ---
    
    function buildProgram() {
      // Every config option mentioned here should be listened to by rebuildProgramL below.
      
      attribs = {};
      uniforms = {};
      
      var decls = {
        LIGHTING: config.lighting.get(),
        BUMP_MAPPING: config.bumpMapping.get(),
        CUBE_PARTICLES: config.cubeParticles.get()
      };
      
      blockProgramSetup = prepareProgram(gl, decls, permanentAttribs,
        [shaders.common, shaders.vertex_common, shaders.vertex_block],
        [shaders.common, shaders.fragment]);
      particleProgramSetup = prepareProgram(gl, decls, permanentAttribs,
        [shaders.common, shaders.vertex_common, shaders.vertex_particle],
        [shaders.common, shaders.fragment]);

      // initialize common constant uniforms. TODO: Do this more cleanly
      switchProgram(particleProgramSetup);
      initConstantUniforms();
      switchProgram(blockProgramSetup); // leave this as first program
      initConstantUniforms();
    }
    
    function switchProgram(newP) {
      gl.useProgram(newP.program);
      attribs = newP.attribs;
      uniforms = newP.uniforms;
      currentTexture = undefined;
    }
    
    function initContext() {
      contextSerial++;
      
      buildProgram();
      
      gl.enableVertexAttribArray(permanentAttribs.aVertexPosition);
      gl.enableVertexAttribArray(permanentAttribs.aVertexNormal);
      
      // Mostly-constant GL state
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      
      // Config-based GL state
      sendViewUniforms();
      
      createResources();
    }
    
    function initConstantUniforms() {
      gl.uniform1i(uniforms.uSkySampler, 1);
      gl.uniform1i(uniforms.uNoiseSampler, 2);
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
      var computedStyle = window.getComputedStyle(canvas,null);
      pagePixelWidth = parseInt(computedStyle.width, 10);
      pagePixelHeight = parseInt(computedStyle.height, 10);
      
      // Specify canvas resolution
      pixelScale = config.fsaa.get() ? 2 : 1;
      canvas.width = pagePixelWidth * pixelScale;
      canvas.height = pagePixelHeight * pixelScale;
      
      // WebGL is not guaranteed to give us that resolution; instead, what it
      // can supply is returned in .drawingBuffer{Width,Height}. However, those
      // properties are not supported by, at least, Firefox 6.0.2.
      if (typeof gl.drawingBufferWidth !== "number") {
        gl.drawingBufferWidth = pagePixelWidth;
        gl.drawingBufferHeight = pagePixelHeight;
      }
      
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      sendPixels();

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
      
      sendProjection();
      // uFogDistance is handled by drawScene because it is changed.
    }
    
    function sendViewUniforms() {
      // TODO: We used to be able to avoid sending the projection matrix when only the view changed. Re-add that, if worthwhile.
      sendProjection();
      gl.uniformMatrix4fv(uniforms.uMVMatrix, false, mvMatrix);
      gl.uniform3fv(uniforms.uViewPosition, viewPosition);
      gl.uniform1i(uniforms.uFocusCue, focusCue);
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
    
    // --- Uniform variable senders ---
    
    // Due to program switching, we need to be able to resend all of the uniforms to the new program.
    
    function sendPixels() {
      gl.uniform2f(uniforms.uPixelsPerClipUnit, gl.drawingBufferWidth / 2,
                                                gl.drawingBufferHeight / 2);
    }
    
    function sendTileSize() {
      gl.uniform1f(uniforms.uTileSize, tileSize);
    }
    
    function sendStipple() {
      gl.uniform1i(uniforms.uStipple, stipple);
    }
    
    function sendProjection() {
      gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
      gl.uniform1f(uniforms.uFogDistance, fogDistance);
    }
    
    function sendAllUniforms() {
      sendPixels();
      sendTileSize();
      sendProjection();
      sendViewUniforms();
    }

    // --- Config bindings ---
    
    var rebuildProgramL = {interest: function () { return true; }, changed: function (v) {
      buildProgram();
      updateViewport(); // note this is only to re-send uPixelsPerClipUnit; TODO have better updating scheme
      scheduleDraw();
    }};
    var viewportL = {interest: function () { return true; }, changed: function (v) {
      updateViewport();
      scheduleDraw();
    }};
    var projectionL = {interest: function () { return true; }, changed: function (v) {
      updateProjection();
      scheduleDraw();
    }};
    config.lighting.listen(rebuildProgramL);
    config.bumpMapping.listen(rebuildProgramL);
    config.cubeParticles.listen(rebuildProgramL);
    config.fov.listen(projectionL);
    config.renderDistance.listen(projectionL);
    config.fsaa.listen(viewportL);

    // --- Initialization ---
    
    gl = WebGLUtils.create3DContext(canvas, {
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

    Object.defineProperty(this, "bundlesDrawn", {
      enumerable: true,
      writable: true,
      value: 0
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
      fogDistance = 1; // 0 would be div-by-0
      focusCue = focus;
      sendViewUniforms();
      gl.disable(gl.DEPTH_TEST);
    }
    this.setViewToSkybox = setViewToSkybox;
    function setViewToEye(playerRender, focus) {
      gl.enable(gl.DEPTH_TEST);
      viewPosition = playerRender.getPosition();
      playerRender.applyViewTranslation(mvMatrix);
      
      fogDistance = config.renderDistance.get();
      focusCue = focus;
      sendProjection();
      sendViewUniforms();
    }
    this.setViewToEye = setViewToEye;
    function setViewToBlock() { // Ortho view of block at 0,0,0
      mat4.identity(mvMatrix);
      mat4.rotate(mvMatrix, Math.PI/4 * 0.6, [1, 0, 0]);
      mat4.rotate(mvMatrix, Math.PI/4 * 0.555, [0, 1, 0]);
      mat4.translate(mvMatrix, [-0.5,-0.5,-0.5]);

      fogDistance = 100;
      focusCue = true;
      mat4.ortho(-0.8, 0.8, -0.8, 0.8, -1, 1, pMatrix);
      sendProjection();
      sendViewUniforms();
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
      focusCue = true;
      sendViewUniforms();
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

        sendProjection();
        sendViewUniforms();
      };
    }
    this.saveView = saveView;
    
    function setStipple(val) {
      stipple = val ? 1 : 0;
      sendStipple();
    }
    this.setStipple = setStipple;
    
    function setTileSize(val) {
      tileSize = val;
      sendTileSize();
    }
    this.setTileSize = setTileSize;
    
    function setLineWidth(val) {
      gl.lineWidth(val * pixelScale);
    }
    this.setLineWidth = setLineWidth;
    
    function setTexture(texture) {
      if (currentTexture === texture) return;
      currentTexture = texture;
      
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.uSampler, 0);
      
      gl.enableVertexAttribArray(permanentAttribs.aTextureCoord);
      gl.disableVertexAttribArray(permanentAttribs.aVertexColor);
    }
    //this.setTexture = setTexture; // currently used only inside RenderBundle
    
    function unsetTexture() {
      if (currentTexture === null) return;
      currentTexture = null;
      
      gl.disableVertexAttribArray(permanentAttribs.aTextureCoord);
      gl.enableVertexAttribArray(permanentAttribs.aVertexColor);
    }
    //this.unsetTexture = unsetTexture;
    
    function BufferAndArray(numComponents) {
      this.numComponents = numComponents;
      this.buffer = gl.createBuffer();
      this.array = null;
    }
    BufferAndArray.prototype.countVertices = function () {
      return this.array.length / this.numComponents;
    };
    BufferAndArray.prototype.load = function (jsArray, checkAgainst) {
      if (jsArray.override) { // kludge for BlockParticles
        this.buffer = jsArray.override.buffer;
        this.array = jsArray.override.array;
      } else {
        this.array = new Float32Array(jsArray);
      }
      if (checkAgainst && this.countVertices() !== checkAgainst.countVertices()) {
        throw new Error("Inconsistent number of vertices.");
      }
      return !jsArray.override;
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

          v.load(vertices) && v.send(gl.STATIC_DRAW);
          n.load(normals, v) && n.send(gl.STATIC_DRAW);

          if (optGetTexture) {
            t.load(texcoords, v) && t.send(gl.STATIC_DRAW);
          } else {
            c.load(colors, v) && c.send(gl.STATIC_DRAW);
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
        
        v.attrib(permanentAttribs.aVertexPosition);
        n.attrib(permanentAttribs.aVertexNormal);
        
        gl.uniform1i(uniforms.uTextureEnabled, optGetTexture ? 1 : 0);

        if (optGetTexture) {
          setTexture(optGetTexture());
          t.attrib(permanentAttribs.aTextureCoord);
        } else {
          unsetTexture();
          c.attrib(permanentAttribs.aVertexColor);
        }
        var count = v.countVertices();
        renderer.bundlesDrawn += 1;
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
    
    // Table of [vertex, normal] tuples for a unit cube
    var genericCubeVertices = [];
    [CubeRotation.identity, CubeRotation.y90, CubeRotation.y180, CubeRotation.y270, CubeRotation.x90, CubeRotation.x270].forEach(function (face) {
      [[0,0,1], [1,0,1], [1,1,1], [1,1,1], [0,1,1], [0,0,1]].forEach(function (vertex) {
        genericCubeVertices.push([face.transformPoint(vertex), face.transformVector([0,0,1])]);
      });
    });
    
    var blockParticleVerticesCache = new IntVectorMap();
    function getBlockParticleVertices(tileSize, symm, cubeParticles) {
      var verticesPerParticle = cubeParticles ? genericCubeVertices.length : 1;
      var cacheKey = [tileSize, symm, cubeParticles ? 0 : 1];
      var geometry = blockParticleVerticesCache.get(cacheKey);
      function arr() { 
        return new Float32Array(tileSize*tileSize*tileSize * verticesPerParticle * 3);
      }
      if (!geometry) {
        var r = CubeRotation.byCode[symm];
        var positions = new BufferAndArray(3);
        var subcubes  = new BufferAndArray(3);
        var normals   = new BufferAndArray(3);
        var pa = positions.array = arr();
        var sa = subcubes .array = arr();
        var na = normals  .array = arr();
        var index = 0;
        for (var x = 0; x < tileSize; x++)
        for (var y = 0; y < tileSize; y++)
        for (var z = 0; z < tileSize; z++) {
          var subcube = r.transformPoint([(x+0.5)/tileSize, (y+0.5)/tileSize, (z+0.5)/tileSize]);
          if (cubeParticles) {
            genericCubeVertices.forEach(function (record) {
              var v = r.transformPoint(record[0]);
              var normal = r.transformVector(record[1]);
              pa[index+0] = (v[0] - 0.5)/tileSize;
              pa[index+1] = (v[1] - 0.5)/tileSize;
              pa[index+2] = (v[2] - 0.5)/tileSize;
              sa[index+0] = subcube[0];
              sa[index+1] = subcube[1];
              sa[index+2] = subcube[2];
              na[index+0] = normal[0];
              na[index+1] = normal[1];
              na[index+2] = normal[2];
              index += 3;
            });
          } else {
            pa[index+0] = 0;
            pa[index+1] = 0;
            pa[index+2] = 0;
            sa[index+0] = subcube[0];
            sa[index+1] = subcube[1];
            sa[index+2] = subcube[2];
            na[index+0] = 0;
            na[index+1] = 0;
            na[index+2] = 0;
            index += 3;
          }
        }
        positions.send(gl.STATIC_DRAW);
        subcubes .send(gl.STATIC_DRAW);
        normals  .send(gl.STATIC_DRAW);
        geometry = {
          positions: positions,
          subcubes: subcubes,
          normals: normals,
          ticket: currentContextTicket(),
          vpp: verticesPerParticle
        };
        blockParticleVerticesCache.set(cacheKey, geometry);
      }
      if (geometry.ticket()) {
        geometry.positions.renew();
        geometry.subcubes .renew();
        geometry.normals  .renew();
        geometry.positions.send(gl.STATIC_DRAW);
        geometry.subcubes .send(gl.STATIC_DRAW);
        geometry.normals  .send(gl.STATIC_DRAW);
        geometry.ticket = currentContextTicket();
      }
      return geometry;
    }
    
    function BlockParticles(location, tileSize, blockType, destroyMode, symm) {
      var blockWorld = blockType.world;
      var k = 2;
      var colorbuf = [0,0,0,0];
      var cubeParticles = config.cubeParticles.get();
      var geometry = getBlockParticleVertices(tileSize, symm, cubeParticles);
      var rb = new renderer.RenderBundle(cubeParticles ? gl.TRIANGLES : gl.POINTS, null,
          function (vertices, normals, colors) {
        for (var x = 0; x < tileSize; x++)
        for (var y = 0; y < tileSize; y++)
        for (var z = 0; z < tileSize; z++) {
          if (!destroyMode) {
            if (x < k || x >= tileSize-k ||
                y < k || y >= tileSize-k ||
                z < k || z >= tileSize-k) {
              var c = 1.0 - Math.random() * 0.04;
              colorbuf[0] = colorbuf[1] = colorbuf[2] = c;
              colorbuf[3] = 1;
            } else {
              colorbuf[0] = colorbuf[1] = colorbuf[2] = colorbuf[3] = 0;
            }
          } else if (blockWorld) {
            blockWorld.gt(x,y,z).writeColor(1, colorbuf, 0);
          } else if (blockType.color) {
            blockType.writeColor(1, colorbuf, 0);
          }
          for (var i = 0; i < geometry.vpp; i++) {
            colors.push(colorbuf[0], colorbuf[1], colorbuf[2], colorbuf[3]);
          }
        }
        vertices.override = geometry.positions;
        normals.override = geometry.normals;
      }, {
        aroundDraw: function (draw) {
          switchProgram(particleProgramSetup);
          sendAllUniforms();
          gl.uniform1i(uniforms.uParticleExplode, destroyMode ? 1 : 0);
          gl.uniform1f(uniforms.uParticleInterp, t());
          
          geometry.subcubes.attrib(attribs.aParticleSubcube);
          gl.enableVertexAttribArray(attribs.aParticleSubcube);
          
            var matrix = mat4.create(mvMatrix);
            mat4.translate(matrix, location);
            gl.uniformMatrix4fv(uniforms.uMVMatrix, false, matrix);
              
              draw();
              
            gl.uniformMatrix4fv(uniforms.uMVMatrix, false, mvMatrix);
            
          gl.disableVertexAttribArray(attribs.aParticleSubcube);
          switchProgram(blockProgramSetup);
        }
      });
      
      var t0 = Date.now();
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
          screenPoint[0] / pagePixelWidth * 2 - 1, 
        -(screenPoint[1] / pagePixelHeight * 2 - 1)
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
    
    // --- Non-core game-specific rendering utilities ---
    
    function createResources() {
      generateSkyTexture();
      generateNoiseTexture();
    }
    
    function generateNoiseTexture() {
      var texSize = 512;
      var texPixels = texSize*texSize*4;
      var image = new Uint8Array(texPixels);
      var random = Math.random;
      for (var i = 0; i < texPixels; i++) {
        image[i] = random() * 256;
      }
      
      noiseTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, texSize, texSize, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.activeTexture(gl.TEXTURE0);
    }
    
    function generateSkyTexture() {
      // Sky texture
      var skyTexSize = 256;
      var log = Math.log;
      var cSky = vec3.create([0.1,0.3,0.5]);
      var cHorizon = vec3.create([0.7,0.8,1.0]);
      var cGround = vec3.create([0.5,0.4,0.4]);
      function clamp(x, low, high) {
        return Math.min(Math.max(x, low), high);
      }
      function mix(a, b, val) {
        return vec3.add(vec3.scale(a, (1-val), vec3.create()), vec3.scale(b, val, vec3.create()));
      }
      function plot(sine) {
        // Note: this was formerly a GLSL function, which is why it uses the above utilities.
        // TODO: Try out doing this as render-to-texture
        return sine < 0.0
            ? mix(cHorizon, cGround, clamp(log(1.0 + -sine * 120.0), 0.0, 1.0))
            : mix(cHorizon, cSky, clamp(log(1.0 + sine * 2.0), 0.0, 1.0));
      }
      function proceduralImage(f) {
        var image = new Uint8Array(skyTexSize*skyTexSize*4);
        for (var x = 0; x < skyTexSize; x++)
        for (var y = 0; y < skyTexSize; y++) {
          var base = (x + y*skyTexSize)*4;
          var ncx = x/skyTexSize-0.5;
          var ncy = y/skyTexSize-0.5;
          var ncz = 0.5;
          var color = f(base,ncx,ncy,ncz);
          image[base]   = color[0]*255;
          image[base+1] = color[1]*255;
          image[base+2] = color[2]*255;
          image[base+3] = 255;
        }
        return image;
      }
      var side = proceduralImage(function (base,x,y,z) {
        return plot(-y / Math.sqrt(x*x+y*y+z*z));
      });
      var top = proceduralImage(function (base,x,y,z) {
        return plot(z / Math.sqrt(x*x+y*y+z*z));
      });
      var bottom = proceduralImage(function (base,x,y,z) {
        return plot(-z / Math.sqrt(x*x+y*y+z*z));
      });
      skyTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyTexture);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGBA, skyTexSize, skyTexSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, side);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, gl.RGBA, skyTexSize, skyTexSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, top);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, gl.RGBA, skyTexSize, skyTexSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, side);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, gl.RGBA, skyTexSize, skyTexSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, side);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, gl.RGBA, skyTexSize, skyTexSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, bottom);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, gl.RGBA, skyTexSize, skyTexSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, side);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
    }
    
    var skyboxR = new RenderBundle(gl.TRIANGLES, null, function (vertices, normals, colors) {
      // abstracted in case this becomes useful elsewhere ...
      function cube(vertices, colors, size, outward) {
        function ppush(a, b, c) {
          var v = [];
          v[dim] = a;
          v[da] = b;
          v[db] = c;
          vertices.push(v[0], v[1], v[2]);
          normals.push(0,0,0);
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

    this.config = config; // TODO eliminate this; it is used only for WorldRenderer getting the render distance (which we should provide directly) and for the texture debug (which should not be done by WorldRenderer since it leaks into block renders)
    
    Object.seal(this); // TODO freeze all but verticesDrawn
  }
  
  Renderer.NoWebGLError = function () {
    Error.call(this);
  };
  Renderer.NoWebGLError.prototype = Object.create(Error.prototype);
  
  Renderer.fetchShaders = function (directory, callback) {
    var table = {
      common: undefined,
      vertex_common: undefined,
      vertex_block: undefined,
      vertex_particle: undefined,
      fragment: undefined
    };
    var names = Object.keys(table);
    var done = false;
    
    names.forEach(function (filename) {
      fetchResource(directory+"shaders/"+filename+".glsl", "text", function (data) { 
        table[filename] = data;
        check();
      });
    });
    
    function check() {
      if (names.every(function (f) { return table[f] !== undefined; })) {
        if (done) return; // in case of multiple failures
        done = true;
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
