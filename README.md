“Cubes” Game Engine
===================

This project, working title “Cubes”, is a WebGL-based game engine (or game; I'm not sure yet) for worlds made of cubical blocks. It is trying hard to not be a Minecraft clone.

The unique feature of this engine is that each ordinary block is itself made out of blocks; each block can be “entered” and edited at 16× scale, and changes will immediately be seen in the outer world.

Requirements and startup
------------------------

No compilation or server is required; simply open `cubes.html` in a WebGL-supporting browser.

I have found the best performance to be with Google Chrome. Firefox is acceptable. Safari 5.0.1 is known not to work, apparently due to missing WebGL features (I have not investigated in detail).

Controls
--------

Standard WASD keys, or arrow keys, to move horizontally. E moves up and C moves down; though these have little effect currently as the vertical position is fixed to follow the terrain.

Blocks are selected using the mouse. The left button adds or removes blocks at the location of the white rectangle cursor; the right button brings up a menu for choosing blocks (the empty square at the top left is the removal tool).

The R key enters the world of the selected block; the F key exits.

License
-------

Except as otherwise noted in individual files, all source code and other materials are Copyright © 2011 Kevin Reid, and licensed under the MIT License as follows:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
> 
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
> 
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Summary of exceptions (not guaranteed to be up-to-date):

* The file `webgl-debug.js` is from a third party and is licensed under “a BSD-style license”.
* The file `glMatrix.js` is from a third party and is licensed under what [the OSI calls](http://www.opensource.org/licenses/Zlib) the zlib/libpng license.
* Code in several files is derived from [the Learning WebGL Lessons](http://learningwebgl.com/blog/?page_id=1217).