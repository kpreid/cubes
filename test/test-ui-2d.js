// Copyright 2012 Kevin Reid under the terms of the MIT License as detailed
// in the accompanying file README.md or <http://opensource.org/licenses/MIT>.

describe("ObjectUI", function() {
  "use strict";
  
  var ui;
  beforeEach(function () {
    sessionStorage.clear();
    var pool = new cubes.storage.PersistencePool(sessionStorage, "");
    ui = new cubes.ObjectUI(pool);
  });
  
  // Originally written as a test demonstrating a crash on bind; should be turned into something more meaningful
  it("should provide chips for ephemeral worlds", function () {
    var chip = new ui.ObjectChip();
    chip.bindByObject(new cubes.World([1, 2, 3], new cubes.Blockset([])));
    
    expect(chip.element.textContent).toContain("a 1×2×3 World");
  });
  
  // TODO more tests
});
