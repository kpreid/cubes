// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

(function () {
  var ID_EMPTY = cubes.Blockset.ID_EMPTY;
  var ID_LIMIT = cubes.Blockset.ID_LIMIT;
  
  var lAudioContext = typeof AudioContext !== "undefined" ? AudioContext
                    : typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null;
  var supported = !!lAudioContext;
  
  function Audio(config) {
    var context;
    if (supported) {
      context = new lAudioContext(); /* feature test point */
    }
  
    // TODO: leaks garbage block types and uses serial numbers. Use WeakMap instead once Chrome supports it
    var blockSoundTable = [];
  
    // --- Utilities ---
  
    var bsSampleRate = 22050;
    
    // Parameters to subSynth defining each sound.
    var synthParameters = {
      create: [0.5, 0.1, 0, false, 1],
      destroy: [1, 0.22, 0.2, true, 1],
      footstep: [0.18, 0.1, 0, true, 1],
      become: [0.05, 0.1, 0, false, 0.2]
    };
  
    // argument is time in wavelengths
    function square(t) {
      return Math.floor(t % 1 * 2);
    }
    
    function SynthData(type) {
      var blockWorld = type.world;
      
      // cache
      var types, counts, buffers;
      
      function readBlock() {
        // Find volumes of material in the block
        counts = [];
        for (var i = 0; i < ID_LIMIT; i++) counts.push(0);
        var raw = blockWorld.raw;
        for (var i = raw.length - 1; i >= 0; i--) {
          counts[raw[i]]++;
        }
        
        types = blockWorld.blockset.getAll();
        buffers = {};
      }
      
      function subSynth(duration, variation, echo, noise, gain) {
        var bsSamples = Math.round(duration * bsSampleRate);
      
        var b = context.createBuffer(1, bsSamples, bsSampleRate);
        var a = b.getChannelData(0);
    
        var basePitch = 40;
      
        var totalAmp = 0;
        var color = [];
        for (var value = ID_EMPTY + 1; value < ID_LIMIT; value++) {
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

        var normalize = totalAmp > 0 ? gain/totalAmp : 0;
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
      
      this.get = function (name) { // NOT safe for arbitrary input
        if (buffers.hasOwnProperty(name)) {
          return buffers[name];
        } else {
          return buffers[name] = subSynth.apply(undefined, synthParameters[name]);
        }
      };
      
      // --- Initialization ---
      
      readBlock();
      type.listen({
        interest: function () { return true; },
        appearanceChanged: readBlock
      });
    }
    
    function getSynthData(blockType) {
      var synthData = blockSoundTable[blockType._serial /* TODO kludge */];
      if (!synthData) {
        synthData = blockSoundTable[blockType._serial] = new SynthData(blockType);
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
    
      play: !supported ? function () {} : function (pos, blockType, kind, gain) {
        if (!config.sound.get()) return;
        if (!blockType.world) return;
      
        var buffer = getSynthData(blockType).get(kind);
      
        if (!buffer) return;
      
        var panner = context.createPanner();
        panner.setPosition(pos[0],pos[1],pos[2]);

        var source = context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = 0.98 + Math.random() * 0.04;
        
        var gainN = context.createGainNode();
        gainN.gain.value = gain;
      
        source.connect(gainN);
        gainN.connect(panner);
        panner.connect(context.destination);

        source.noteOn(0);
      }
    });
  }
  Audio.supported = supported;

  cubes.Audio = Object.freeze(Audio);
}());
