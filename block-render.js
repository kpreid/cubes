// Except as noted,
// Copyright 2011 Kevin Reid, under the terms of the MIT License as detailed in
// the accompanying file README.md or <http://opensource.org/licenses/MIT>.
//
// Exception: The code for using framebuffers and renderbuffers is copied from
// Learning WebGL, Lesson 16, at http://learningwebgl.com/blog/?p=1786 (as of
// September 2011). No license is stated on that site, but I (Kevin Reid)
// believe that it is obviously the authors' intent to make this code free to
// use.

// Renders single blocks from a world.

function BlockRenderer(blockSet, renderer) {
  var gl = renderer.context;
  
  var singleBlockWorld = new World([1,1,1], blockSet);
  singleBlockWorld.s(0,0,0,1);
  singleBlockR = new WorldRenderer(singleBlockWorld, {pos: [0,0,0]}, renderer, function (){}, false);
  
  var rttFramebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffer);
  rttFramebuffer.width = 64;
  rttFramebuffer.height = 64;

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
    // TODO: global variables gl, renderer
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffer);
    
    gl.viewport(0, 0, rttFramebuffer.width, rttFramebuffer.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    var restoreView = renderer.saveView();
    renderer.setViewToBlock();
    singleBlockWorld.s(0,0,0,blockID);
    singleBlockR.updateSomeChunks();
    singleBlockR.draw();
    
    // restore stuff (except for framebuffer which we're about to read)
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    restoreView();
    
    var imageData = context2d.createImageData(rttFramebuffer.width, rttFramebuffer.height);
    var arrayC = imageData.data;
    var arrayGL = new Uint8Array(rttFramebuffer.width * rttFramebuffer.height * 4);
    gl.readPixels(0, 0, rttFramebuffer.width, rttFramebuffer.height, gl.RGBA, gl.UNSIGNED_BYTE, arrayGL);
    { // copy into canvas data and flip y
      var h = rttFramebuffer.height;
      var w = rttFramebuffer.width * 4; // width in bytes
      for (var y = h; y--; y >= 0) {
        var nyl = (h - y) * w;
        var pyl = y * w;
        for (var i = w - 1; i >= 0; i--)
          arrayC[nyl + i] = arrayGL[pyl + i];
      }
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    return imageData;
  }
  
  // TODO: This is a workaround for some glitch that happens only on Chrome (17.0.938.0), which causes the first block rendered to not appear.
  blockToImageData(1, document.createElement("canvas").getContext("2d"));

  return {
    blockToImageData: blockToImageData,
    deleteResources: function () {
      rttFramebuffer = null;
      gl.deleteRenderbuffer(renderbuffer1);
      gl.deleteRenderbuffer(renderbuffer2);
      gl.deleteFramebuffer(rttFramebuffer);
      singleBlockR.deleteResources();
    }
  }
}