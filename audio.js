var CubesAudio = (function () {
  var audioSupported = typeof webkitAudioContext !== 'undefined';
  var context;
  
  if (audioSupported) {
    context = new webkitAudioContext(); /* feature test point */
  }
  
  // --- Utilities ---

  var bsSampleRate = 22050;
  var bsTime = 0.25;
  var bsSamples = Math.round(bsTime * bsSampleRate);
  
  // argument is time in wavelengths
  function square(t) {
    return Math.floor(t % 1 * 2);
  }
  
  // --- Object ---
  
  return Object.freeze({
    setListener: !audioSupported ? function () {return null;} : function (pos, fwd, vel) {
      context.listener.gain = 0.3;
      context.listener.setPosition(pos[0],pos[1],pos[2]);
      context.listener.setOrientation(fwd[0],fwd[1],fwd[2], 0,1,0); // assumed 'up' vector
      context.listener.setVelocity(vel[0],vel[1],vel[2]);
    },
    
    synthBlock: !audioSupported ? function () {} : function (blockWorld) {
      console.log("synthBlock");
      // Find spans of material in the block
      var spans = [];
      for (var dim = 0; dim < 3; dim++) {
        var ud = mod(dim+1,3);
        var vd = mod(dim+2,3);
        for (var u = 0; u < World.TILE_SIZE; u++)
        for (var v = 0; v < World.TILE_SIZE; v++) {
          var vec = [u,v,w];
          var count = 0;
          var cur = null;
          for (var w = 0; w < World.TILE_SIZE; w++) {
            vec[2] = w;
            var value = blockWorld.g(vec[dim],vec[ud],vec[vd]);

            if (cur !== value) {
              if (count > 0) {
                var span = [count];
                blockWorld.blockSet.get(value).writeColor(1, span, 1);
                // span is now [count, r, g, b, a]
                spans.push(span);
              }
              
              count = 0;
              cur = value;
            } else {
              count++
            }
          }
        }
      }
      
      var b = context.createBuffer(1, bsSamples, 44100);
      var a = b.getChannelData(0);
      
      var basePitch = 80;
        
      var compAmp = 3 / spans.length;
      for (var p = 0; p < spans.length; p++) {
        var span = spans[p];
        var length = span[0];
        var luminance = (0.2126*span[1]+0.7152*span[2]+0.0722*span[3]);
        var pitch = basePitch / (length/16) * luminance * (1+Math.random()*0.1);
        var pitchInSampleUnits = pitch / bsSampleRate;
        for (var i = 0; i < bsSamples; i++) {
          a[i] += compAmp*square(i * pitchInSampleUnits);
        }
      }
      var decay = -5/bsSamples;
      for (var i = 0; i < bsSamples; i++) {
        a[i] *= Math.exp(i*decay);
      }
      
      if (!isFinite(a[0])) {
        if (typeof console !== "undefined")
          console.error("Synthesis produced bad data: ", a[0]);
      }
      
      return b;
    },
    
    play: !audioSupported ? function () {} : function (pos, blockType) {
      var buffer = blockType.getSound();
      
      if (buffer === null) return;
      
      var panner = context.createPanner();
      panner.setPosition(pos[0],pos[1],pos[2]);

      var source = context.createBufferSource();
      source.buffer = buffer;
      //source.playbackRate.value = 0.9 + Math.random() * 0.2;
      
      source.connect(panner);
      panner.connect(context.destination);

      source.noteOn(0);
    }
  });
})();