// Except as noted,
// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.
//
// Exception: The code for using framebuffers and renderbuffers is copied from
// Learning WebGL, Lesson 16, at http://learningwebgl.com/blog/?p=1786 (as of
// September 2011). No license is stated on that site, but I (Kevin Reid)
// believe that it is obviously the authors' intent to make this code free to
// use.

(function () {
  "use strict";
  
  var World = cubes.World;
  var WorldRenderer = cubes.WorldRenderer;
  
  // Renders single blocks from a world.
  function BlockRenderer(blockset, renderer, resolution) {
    var gl = renderer.context;
    
    var singleBlockWorld = new World([1,1,1], blockset);
    singleBlockWorld.s(0,0,0,1);
    var singleBlockR = new WorldRenderer(singleBlockWorld, function () { return [0,0,0]; }, renderer, null, function (){}, false);
    
    var rttFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffer);
    rttFramebuffer.width = resolution;
    rttFramebuffer.height = resolution;
    
    var renderbuffer1 = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer1);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, rttFramebuffer.width, rttFramebuffer.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer1);
    
    var renderbuffer2 = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer2);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rttFramebuffer.width, rttFramebuffer.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer2);
    
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    function blockToImageData(blockID, context2d) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffer);
      
      gl.viewport(0, 0, rttFramebuffer.width, rttFramebuffer.height);
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      
      var restoreView = renderer.saveView();
      renderer.setExposure(1.0);
      renderer.setViewToBlock();
      singleBlockWorld.s(0,0,0,blockID);
      singleBlockWorld.rawLighting[0] = singleBlockWorld.lightOutside;
      singleBlockR.updateSomeChunks();
      singleBlockR.draw();
      
      // restore stuff (except for framebuffer which we're about to read)
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      restoreView();
      
      var imageData = context2d.createImageData(rttFramebuffer.width, rttFramebuffer.height);
      var arrayC = imageData.data;
      var arrayGL = new Uint8Array(rttFramebuffer.width * rttFramebuffer.height * 4);
      gl.readPixels(0, 0, rttFramebuffer.width, rttFramebuffer.height, gl.RGBA, gl.UNSIGNED_BYTE, arrayGL);
      
      // copy into canvas data and flip y
      var h = rttFramebuffer.height;
      var w = rttFramebuffer.width * 4; // width in bytes
      for (var y = h; y--; y >= 0) {
        var nyl = (h - y) * w;
        var pyl = y * w;
        for (var i = w - 1; i >= 0; i--)
          arrayC[nyl + i] = arrayGL[pyl + i];
      }
      
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      
      return imageData;
    }
    
    this.blockToImageData = blockToImageData;
    this.deleteResources = function () {
      rttFramebuffer = null;
      gl.deleteRenderbuffer(renderbuffer1);
      gl.deleteRenderbuffer(renderbuffer2);
      gl.deleteFramebuffer(rttFramebuffer);
      singleBlockR.deleteResources();
    };
  }
  
  cubes.BlockRenderer = BlockRenderer;
}());
