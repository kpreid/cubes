// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("Source code", function () {
  var fetchResource = cubes.util.fetchResource;
  var mkelement = cubes.util.mkelement;
  
  var jshintOptions = {
    // the environment we run in
    es5: true,
    browser: true,
    devel: true,
    predef: {
      // provided by webgl-utils
      WebGLUtils: true,

      // provided by webgl-debug
      WebGLDebugUtils: true,
      
      // provided by game-shim
      GameShim: true,
      
      // provided by gl-matrix
      vec3: false,
      vec4: false,
      mat3: false,
      mat4: false,
      
      // provided by measviz
      measviz: false,
      
      // our own globals
      cubes: true,
    },
  
    // strictness
    strict: true,
    
    // laxity
    laxbreak: true, // accept break before "?" -- TODO consider reducing this
    sub: true // for Persister.types["..."]
  };
  
  function runscallback(name, timeout, callback) {
    var args = null;
    waitsFor(function () { return !!args; }, "callback " + name + " never called", timeout);
    runs(function () { callback.apply(undefined, args); });
    return function () {
      args = arguments;
    };
  }
  
  it("should pass JSHint", function () {
    this.addMatchers({
      toBeAbsent: function () {
        var actual = this.actual;
        this.message = function () {
          return actual + " files failed lint.";
        };
        return actual === 0;
      }
    });
    
    fetchResource("index.html", "text", runscallback("index.html", 1000, function (testIndexFile) {
      var testFiles = [];
      var re = /<script[^>]*?src="(..\/[^"\/]*.js)">/g;
      var match;
      while (match = re.exec(testIndexFile)) {
        testFiles.push(match[1]);
      }
      expect(testFiles.length).toBeGreaterThan(0);
      
      var failures = 0;
      
      testFiles.forEach(function (jsFilename) {
        fetchResource(jsFilename, "text", runscallback(jsFilename, 1000, function (jsSource) {
           var res = JSHINT(jsSource, jshintOptions);
           if (!res || JSHINT.data().unused) {
             failures++
             var container = mkelement("div", "jshint-report");
             container.innerHTML/*ew*/ = JSHINT.report(true);
             container.insertBefore(mkelement("h2", "", "JSHint on " + jsFilename), container.firstChild);
             document.body.appendChild(container);
           }
        }));
      });
      
      runs(function () {
        expect(failures).toBeAbsent();
      });
    }));
  });
});
