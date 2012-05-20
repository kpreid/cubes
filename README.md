“Cubes” Game Engine
===================

This project, working title “Cubes”, is a WebGL-based game engine for worlds made of cubical blocks. In order to escape the easy trap of being a Minecraft clone, it is instead programmable, so that the game being played may be redefined interactively.

The unique feature of this engine is that each ordinary block is itself made out of blocks; each block can be “entered” and edited at an enlarged scale, and changes will immediately be seen in the outer world. Additionally, the behavior of blocks can be defined by constructing circuits within them, out of special blocks.

Requirements and startup
------------------------

No compilation is required; simply serve this directory from a web server (required so that files can be accessed from scripts) and open [`cubes.html`](cubes.html) in a WebGL-supporting browser. Worlds you create are saved in your browser using `localStorage`.

I have found the best performance to be with Google Chrome; Firefox is acceptable. Safari 5.1 is incompatible due to lack of correct implementation of ECMAScript 5 accessors.

For information on playing the game, click the “Help” button in-game; to modify the controls or graphics quality click ªOptions”.

License
-------

Except as otherwise noted in individual files, all source code and other materials are Copyright © 2011-2012 Kevin Reid, and licensed as follows (the “MIT License”):

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
> 
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
> 
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Summary of exceptions (not guaranteed to be up-to-date; please review individual files or containing directories for accurate information):

* The contents of the `deps/` subdirectory are third-party code.
  * `gl-matrix/` is licensed under what [the OSI calls](http://www.opensource.org/licenses/Zlib) the zlib/libpng license.
  * `jasmine/` is licensed under the MIT license.
  * `webgl-debug.js` is licensed under “a BSD-style license” (context has been lost for what license that is).
  * `webgl-utils.js` is licensed under the BSD 3-clause license.
* Code in several files is derived from [the Learning WebGL Lessons](http://learningwebgl.com/blog/?page_id=1217).
