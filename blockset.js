var BlockSet = (function () {
  function BlockSet() {
    'use strict';
  }

  BlockSet.colors = Object.freeze({
    textured: false,
    writeColor: function (blockID, scale, target, offset) {
      target[offset] = (blockID & 3) / 3 * scale;
      target[offset+1] = ((blockID >> 2) & 3) / 3 * scale;
      target[offset+2] = ((blockID >> 4) & 3) / 3 * scale;
      target[offset+3] = scale;
    }
  });

  BlockSet.textured = Object.freeze({
    textured: true,
    writeColor: BlockSet.colors.writeColor
  });

  return Object.freeze(BlockSet);
})();
