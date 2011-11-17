// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var Renderer = (function () {
  "use strict";
  
  function Renderer(canvas) {
    // --- State ---
    
    var context = null;

    // --- Internals ---
    
    function getContext() {
      context = theCanvas.getContext("experimental-webgl", {
        antialias: false // MORE FILLRATE!!!
      });
      if (DEBUG) { // TODO global variable
        context = WebGLDebugUtils.makeDebugContext(context);
      } else {
        WebGLDebugUtils.init(context);
      }  
    }
    
    function sendViewUniforms() {
        gl.uniformMatrix4fv(uniforms.uMVMatrix, false, mvMatrix);
        gl.uniform3fv(uniforms.uViewPosition, viewPosition);
        calculateFrustum();
    }

    // --- Public components ---
    
    Object.defineProperty(this, "context", {
      enumerable: true,
      get: function () { return context; }
    });
    
    // View-switching: Each of these produces a self-consistent state of variables and uniforms.
    // The state managed by these view routines is:
    //   * Projection matrix
    //   * Modelview matrix and viewPosition
    //   * Fog distance
    //   * Depth test
    function setViewToSkybox(playerRender) {
      // The skybox exceeeds the fog distance, so it is rendered fully fogged
      // and only the fog-shading determines the sky color. This ensures that
      // normal geometry fades smoothly into the sky rather than turning
      // a possibly-different fog color.
      gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
      mat4.identity(mvMatrix);
      playerRender.applyViewRot(mvMatrix);
      viewPosition = [0,0,0];
      sendViewUniforms();
      gl.uniform1f(uniforms.uFogDistance, 1); // 0 would be div-by-0
      gl.disable(gl.DEPTH_TEST);
    }
    this.setViewToSkybox = setViewToSkybox;
    function setViewToEye(playerRender) {
      gl.enable(gl.DEPTH_TEST);
      viewPosition = playerRender.getPosition();
      playerRender.applyViewTranslation(mvMatrix);

      gl.uniform1f(uniforms.uFogDistance, config.renderDistance.get());
      gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
      sendViewUniforms();
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
      sendViewUniforms();
    }
    this.setViewToBlock = setViewToBlock;
    function saveView() {
      var saveMVMatrix = mvMatrix; mvMatrix = mat4.create();
      var savePMatrix = pMatrix;  pMatrix = mat4.create();
      var saveView = viewPosition;
      return function () {
        mvMatrix = saveMVMatrix;
        pMatrix = savePMatrix;
        viewPosition = saveView;

        gl.uniformMatrix4fv(uniforms.uPMatrix, false, pMatrix);
        sendViewUniforms();
      }
    }
    this.saveView = saveView;
    
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
    function RenderBundle(primitive, optTexture, calcFunc, options) {
      options = options || {};
      
      var v = new BufferAndArray(3);
      var n = new BufferAndArray(3);
      if (!optTexture) var c = new BufferAndArray(4);
      if (optTexture) var t = new BufferAndArray(2);
      
      if (calcFunc != null) {
        this.recompute = function () {
          var vertices = [];
          var normals = [];
          var colors = optTexture ? null : [];
          var texcoords = optTexture ? [] : null;
          calcFunc(vertices, normals, optTexture ? texcoords : colors);

          v.load(vertices);
          v.send(gl.STATIC_DRAW);
          n.load(normals, v);
          n.send(gl.STATIC_DRAW);

          if (optTexture) {
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
        v.attrib(attribs.aVertexPosition);
        n.attrib(attribs.aVertexNormal);
        
        gl.uniform1i(uniforms.uTextureEnabled, optTexture ? 1 : 0);

        if (optTexture) {
          gl.enableVertexAttribArray(attribs.aTextureCoord);
          gl.disableVertexAttribArray(attribs.aVertexColor);
          
          t.attrib(attribs.aTextureCoord);
  
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, optTexture);
          gl.uniform1i(uniforms.uSampler, 0);
        } else {
          gl.disableVertexAttribArray(attribs.aTextureCoord);
          gl.enableVertexAttribArray(attribs.aVertexColor);

          c.attrib(attribs.aVertexColor);
        }
        var count = v.countVertices();
        totalVertices += count;
        gl.drawArrays(primitive, 0, count);
      };
      this.draw = options.aroundDraw ? function () { options.aroundDraw(draw); } : draw;
      
      this.deleteResources = function () {
        v.deleteResources();        this.vertices  = v = null;
        n.deleteResources();        this.normals   = n = null;
        if (c) c.deleteResources(); this.colors    = c = null;
        if (t) t.deleteResources(); this.texcoords = t = null;
      }
    }
    this.RenderBundle = RenderBundle;
    
    function BlockParticles(location, blockType, destroyMode, symm) {
      var blockWorld = blockType.world;
      var k = 2;
      var t0 = Date.now();
      var rb = new renderer.RenderBundle(gl.POINTS, null, function (vertices, normals, colors) {
        var TILE_SIZE = World.TILE_SIZE;
        for (var x = 0; x < TILE_SIZE; x++) {
          for (var y = 0; y < TILE_SIZE; y++) {
            for (var z = 0; z < TILE_SIZE; z++) {
              if (!destroyMode) {
                if (!(x < k || x >= TILE_SIZE-k || y < k || y >= TILE_SIZE-k || z < k || z >= TILE_SIZE-k))
                  continue;
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
                (x+0.5)/TILE_SIZE,
                (y+0.5)/TILE_SIZE,
                (z+0.5)/TILE_SIZE
              ]);
              
              vertices.push(location[0]+v[0],
                            location[1]+v[1],
                            location[2]+v[2]);
              normals.push(0,0,0); // disable lighting
            }
          }
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
    
    // --- Initialization ---
    
    getContext();
    
    Object.freeze(this);
  }
  
  return Renderer;
})();