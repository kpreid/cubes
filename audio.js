var CubesAudio = (function () {
  var audioSupported = typeof webkitAudioContext !== 'undefined';
  var context;
  
  if (audioSupported) {
    context = new webkitAudioContext(); /* feature test point */
  }
  
  // --- Utilities ---

  var bsSampleRate = 22050;
  
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
      var spans = {};
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
                var color = [];
                blockWorld.blockSet.get(value).writeColor(1, color, 0);
                var luminance = Math.floor((0.2126*color[0]+0.7152*color[1]+0.0722*color[2])*16)/16;
                var key = [count,luminance];
                
                if (color[3] > 0) {
                  if (!spans[key])
                    spans[key] = [0,key];
                  spans[key][0]++;
                }
              }
              
              count = 1;
              cur = value;
            } else {
              count++;
            }
          }
        }
      }
      
      function subSynth(duration) {
        var bsSamples = Math.round(duration * bsSampleRate);
        
        var b = context.createBuffer(1, bsSamples, 44100);
        var a = b.getChannelData(0);
      
        var basePitch = 40;
        
        var spanskeys = Object.keys(spans);
        var totalAmp = 0;
        spanskeys.forEach(function (k) {
          var record = spans[k];
          var repetitions = record[0];
          var length = record[1][0]/World.TILE_SIZE;
          var lumval = record[1][1];
        
          var pitch = basePitch * (Math.exp(length+lumval)) * (1+Math.random()*0.1);
          var pitchInSampleUnits = pitch / bsSampleRate;

          for (var i = 0; i < bsSamples; i++) {
            a[i] += repetitions*square(i * pitchInSampleUnits);
          }
          totalAmp += repetitions;
        });
        var normalize = totalAmp > 0 ? 1/totalAmp : 0;
        var decay = -5/bsSamples;
        for (var i = 0; i < bsSamples; i++) {
          a[i] *= normalize * Math.exp(i*decay);
          a[i] += i >= 100 ? a[i-100]*0.2 : 0;
        }
      
        if (!isFinite(a[0])) {
          if (typeof console !== "undefined")
            console.error("Synthesis produced bad data: ", a[0]);
        }
        
        return b;
      }
      
      return {
        create: subSynth(1, 0),
        destroy: subSynth(0.25, 0)
      };
    },
    
    play: !audioSupported ? function () {} : function (pos, blockType, kind) {
      var buffer = blockType.getSound()[kind];
      
      if (!buffer) return;
      
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