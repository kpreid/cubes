// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

var CubesAudio = (function () {
  var lAudioContext = typeof AudioContext !== "undefined" ? AudioContext
                    : typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null;
  var supported = !!lAudioContext;
  
  function CubesAudio(config) {
    var context;
    if (supported) {
      context = new lAudioContext(); /* feature test point */
    }
  
    // TODO: leaks garbage block types and uses serial numbers. Use WeakMap instead once Chrome supports it
    var blockSoundTable = [];
  
    // --- Utilities ---
  
    var bsSampleRate = 22050;
  
    // argument is time in wavelengths
    function square(t) {
      return Math.floor(t % 1 * 2);
    }
  
    function synthBlock(blockWorld) {
      //console.log("synthBlock");
      // Find volumes of material in the block
      var types = blockWorld.blockSet.getAll();

      var counts = [];
      for (var i = 0; i < BlockSet.ID_LIMIT; i++) counts.push(0);
    
      var raw = blockWorld.raw;
      for (var i = raw.length - 1; i >= 0; i--) {
        counts[raw[i]]++;
      }
    
      //console.log("synthBlock spans done");

      function subSynth(duration, variation, echo, noise) {
        var bsSamples = Math.round(duration * bsSampleRate);
      
        var b = context.createBuffer(1, bsSamples, bsSampleRate);
        var a = b.getChannelData(0);
    
        var basePitch = 40;
      
        var totalAmp = 0;
        var color = [];
        for (var value = BlockSet.ID_EMPTY + 1; value < BlockSet.ID_LIMIT; value++) {
          var count = counts[value];
          if (count == 0) continue;
      
          types[value].writeColor(1, color, 0);
          //var luminance = Math.floor((0.2126*color[0]+0.7152*color[1]+0.0722*color[2])*16)/16;

          for (var c = 0; c < 3; c++) {
            var luminance = color[c];
            var pitch = basePitch * Math.exp(3*luminance) * (1 - variation/2+Math.random()*variation);
            var pitchInSampleUnits = pitch / bsSampleRate;

            for (var i = 0; i < bsSamples; i++) {
              //a[i] += spanCount*square(i * pitchInSampleUnits);
              a[i] += count*Math.floor((i*pitchInSampleUnits) % 1 * 2);
            }
            totalAmp += count;
          }
        }

        var normalize = totalAmp > 0 ? 1/totalAmp : 0;
        for (var i = 0; i < bsSamples; i++) {
          a[i] *= normalize;
        }

        if (noise) {
          for (var i = 0; i < bsSamples; i++) {
            var interp = i/bsSamples;
            a[i] = a[i]*(1-interp) + Math.random()*interp*0.2;
          }
        }
    
        var decay = -5/bsSamples;
        for (var i = 0; i < bsSamples; i++) {
          a[i] *= Math.exp(i*decay);
        }

        if (echo > 0) {
          var lookback = Math.floor(.04 * bsSampleRate);
          for (var i = 0; i < bsSamples; i++) {
            a[i] += i >= lookback ? a[i-lookback]*echo : 0;
          }
        }
      
        if (!isFinite(a[0])) {
          if (typeof console !== "undefined")
            console.error("Synthesis produced bad data: ", a[0]);
        }
      
        return b;
      }
    
      var r = {
        create: subSynth(0.5, 0.1, 0, false),
        destroy: subSynth(1, 0.22, 0.2, true)
      };
      return r;
    }
  
    function getSynthData(blockType) {
      var synthData = blockSoundTable[blockType._serial /* TODO kludge */];
      if (!synthData) {
        synthData = blockSoundTable[blockType._serial] = synthBlock(blockType.world);
        blockType.listen({
          appearanceChanged: function () {
            blockSoundTable[blockType._serial] = synthBlock(blockType.world);
            return true;
          }
        });
      }
      return synthData;
    }
  
    // --- Object ---
  
    return Object.freeze({
      supported: supported,
    
      setListener: !supported ? function () {return null;} : function (pos, fwd, vel) {
        context.listener.gain = 0.3;
        context.listener.setPosition(pos[0],pos[1],pos[2]);
        context.listener.setOrientation(fwd[0],fwd[1],fwd[2], 0,1,0); // assumed 'up' vector
        context.listener.setVelocity(vel[0],vel[1],vel[2]);
      },
    
      play: !supported ? function () {} : function (pos, blockType, kind) {
        if (!config.sound.get()) return;
        if (!blockType.world) return;
      
        var buffer = getSynthData(blockType)[kind];
      
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
  }
  CubesAudio.supported = supported;

  return CubesAudio;
}());
