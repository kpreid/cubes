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
  
  it("should provide chips for null and undefined", function () {
    var chip = new ui.ObjectChip(ui.refObject(null));
    expect(chip.element.textContent.trim()).toBe("null");
    
    var chip = new ui.ObjectChip(ui.refObject(undefined));
    expect(chip.element.textContent.trim()).toBe("undefined");
  });
  
  // Originally written as a test demonstrating a crash on bind; should be turned into something more meaningful
  it("should provide chips for ephemeral worlds", function () {
    var chip = new ui.ObjectChip(ui.refObject(
      new cubes.World([1, 2, 3], new cubes.Blockset([]))));
    
    expect(chip.element.textContent).toContain("a 1×2×3 World");
  });
  
  // TODO more tests
});
