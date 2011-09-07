function World() {
  var wx = 64;
  var wy = 16;
  var wz = 64;
  var blocks = new Uint8Array(wx*wy*wz);
  
  for (var x = 0; x < wx; x++)
  for (var y = 0; y < wy; y++)
  for (var z = 0; z < wz; z++) {
    blocks[x*wy*wz + y*wz + z] = (wy-y)*70 - ((x-wx/2)*(x-wx/2) + (z-wz/2)*(z-wz/2)) > 0 ? 255 : 0;
  }
  
  blocks.wx = wx;
  blocks.wy = wy;
  blocks.wz = wz;
  
  return blocks;
}