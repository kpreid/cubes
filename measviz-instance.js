// Copyright 2011-2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

(function () {
  "use strict";
  
  var TopGroup = measviz.TopGroup;
  var ViewGroup = measviz.ViewGroup;
  var TaskGroup = measviz.TaskGroup;
  var Counter = measviz.Counter;
  
  var measuring = cubes.measuring = {};
  measuring.all = new TopGroup("Performance", [
    measuring.second = new ViewGroup("Per second", [
      measuring.simCount = new Counter("Steps"),
      measuring.frameCount = new Counter("Frames"),
      measuring.chunkCount = new Counter("Chunk calcs"),
      measuring.lightUpdateCount = new Counter("Light updates")
    ]),
    measuring.sim = new TaskGroup("Simulation", [
      measuring.collisionTests = new Counter("Collision tests"),
      measuring.blockEvals = new Counter("Block evals")
    ]),
    measuring.chunk = new TaskGroup("Chunk calc", []),
    measuring.frame = new TaskGroup("Frame", [
      measuring.bundles = new Counter("Bundles"),
      measuring.vertices = new Counter("Vertices")
    ]),
    measuring.queues = new ViewGroup("Queue sizes", [
      measuring.chunkQueueSize = new Counter("Chunks"),
      measuring.lightingQueueSize = new Counter("Lights"),
      measuring.persistenceQueueSize = new Counter("Dirty objs")
    ])
  ]);
  
  // Object.freeze(measuring);
}());