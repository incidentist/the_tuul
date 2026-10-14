import { getCurrentWord, slashifiedPosition, slashifyAllOccurences } from "./lyrics";

test("getCurrentWord", () => {
  const text = `The quick brown
fox jumps over the lazy_dog.`;
  expect(getCurrentWord(text, 0)).toBe("The");
  expect(getCurrentWord(text, 2)).toBe("The");
  expect(getCurrentWord(text, 10)).toBe("brown");
  expect(getCurrentWord(text, 43)).toBe("dog.");
});

test("slashifyAllOccurences", () => {
  expect(slashifyAllOccurences("ggg", "ggg", "ggg")).toBe("ggg");
  expect(slashifyAllOccurences("ggg ggg", "ggg", "gg/g")).toBe("gg/g gg/g");
  expect(slashifyAllOccurences("ggg_ggg", "ggg", "gg/g")).toBe("gg/g_gg/g");
  expect(slashifyAllOccurences("ggg\nggg", "ggg", "gg/g")).toBe("gg/g\ngg/g");
  expect(slashifyAllOccurences("Ggg ggg", "ggg", "gg/g")).toBe("Gg/g gg/g");
  expect(slashifyAllOccurences("Ggg ggg", "ggg", "ggg/")).toBe("Ggg/ ggg/");
  expect(slashifyAllOccurences("Ggg ggg,\nggg ggg!", "ggg", "gg/g")).toBe("Gg/g gg/g,\ngg/g gg/g!");
  expect(slashifyAllOccurences("Ggg end\nbegin ggg", "Ggg", "G/gg")).toBe("G/gg end\nbegin g/gg");
  expect(slashifyAllOccurences("ggg\n/\n\nggg\n", "", "/")).toBe("ggg\n/\n\nggg\n");
  expect(slashifyAllOccurences("ggg ,/\n\n", ",", ",/")).toBe("ggg ,/\n\n");
  expect(slashifyAllOccurences("ggg/ ggg_ggg\nggg", "ggg", "ggg/")).toBe("ggg/ ggg_ggg\nggg/");
  expect(slashifyAllOccurences("ggg ggg/\nggg", "ggg", "ggg/")).toBe("ggg/ ggg/\nggg/");
  expect(slashifyAllOccurences("ggg_ggg", "ggg", "g/gg/")).toBe("g/gg_g/gg/");
  expect(slashifyAllOccurences("ggg|ggg", "ggg", "gg/g")).toBe("gg/g|gg/g");
  expect(slashifyAllOccurences("ggg|ggg", "ggg", "ggg/")).toBe("ggg|ggg/");
});

test("slashifiedPosition", () => {
  expect(slashifiedPosition("gold x gold/", "gold/ x gold/", 12)).toBe(13);
  expect(slashifiedPosition("go/ld x gold", "go/ld x go/ld", 3)).toBe(3);
  expect(slashifiedPosition("go/ld x/y\ngo/ld", "go/ld x/y\ngold", 7)).toBe(7);
  expect(slashifiedPosition("gold/ gold", "gold/ gold/", 10)).toBe(10);
  expect(slashifiedPosition("ab cd a/b", "a/b cd a/b", 8)).toBe(9);
});
