var CubesAudio = (function () {
  var audioSupported = typeof webkitAudioContext !== 'undefined';
  var context;
  
  if (audioSupported) {
    context = new webkitAudioContext(); /* feature test point */
  }
  
  // --- Utilities ---
  
  var TILE_SIZE = World.TILE_SIZE;

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
      //console.log("synthBlock");
      // Find spans of material in the block
      var types = blockWorld.blockSet.getAll();
      var spans = {};
      for (var dim = 0; dim < 3; dim++) {
        var ud = mod(dim+1,3);
        var vd = mod(dim+2,3);
        for (var u = 0; u < TILE_SIZE; u++)
        for (var v = 0; v < TILE_SIZE; v++) {
          var vec = [u,v,w];
          var count = 0;
          var cur = null;
          for (var w = 0; w < TILE_SIZE; w++) {
            vec[2] = w;
            var value = blockWorld.g(vec[dim],vec[ud],vec[vd]);

            if (cur !== value) {
              if (count > 0) {
                var color = [];
                types[value].writeColor(1, color, 0);
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
      
      //console.log("synthBlock spans done");

      function subSynth(duration, variation) {
        var bsSamples = Math.round(duration * bsSampleRate);
        
        var b = context.createBuffer(1, bsSamples, bsSampleRate);
        var a = b.getChannelData(0);
      
        var basePitch = 50;
        
        var spanskeys = Object.keys(spans);
        var totalAmp = 0;
        spanskeys.forEach(function (k) {
          var record = spans[k];
          var spanCount = record[0];
          var length = record[1][0]/TILE_SIZE;
          var lumval = record[1][1];
        
          var reps = 2;
          for (var r = 0; r < reps; r++) {
            var pitch = basePitch * (Math.exp(length/10+lumval)) * (1 - variation/2+Math.random()*variation);
            var pitchInSampleUnits = pitch / bsSampleRate;

            for (var i = 0; i < bsSamples; i++) {
              //a[i] += spanCount*square(i * pitchInSampleUnits);
              a[i] += spanCount*Math.floor((i*pitchInSampleUnits) % 1 * 2);
            }
          }
          totalAmp += spanCount * reps;
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
      
      var r = {
        create: subSynth(1, 0.1),
        destroy: subSynth(1, 0.5)
      };
      //console.log("synthBlock done");
      return r;
    },
    
    play: !audioSupported ? function () {} : function (pos, blockType, kind) {
      var buffer = blockType.sound[kind];
      
      if (!buffer) return;
      
      var panner = context.createPanner();
      panner.setPosition(pos[0],pos[1],pos[2]);

      var source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 0.98 + Math.random() * 0.04;
      
      source.connect(panner);
      panner.connect(context.destination);

      source.noteOn(0);
    }
  });
})();