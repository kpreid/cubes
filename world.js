function World() {
  var wx = 16;
  var wy = 16;
  var wz = 16;
  var blocks = new Uint8Array(wx*wy*wz);
  
  for (var x = 0; x < 16; x++)
  for (var y = 0; y < 16; y++)
  for (var z = 0; z < 16; z++) {
    blocks[x*wy*wz + y*wz + z] = mod(x*y*z, 256);
  }
  
  blocks.wx = wx;
  blocks.wy = wy;
  blocks.wz = wz;
  
  return blocks;
}