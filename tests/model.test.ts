import test from "node:test";
import assert from "node:assert/strict";
import { createBoxFromFace, formatInches, generateSource, getFaceFrame, MissingVariableError, parseInches, removeVariable, resolveModel, resolveVariables, validateBoxes, type BoxSpec, type FaceName } from "../src/model";

test("parses decimal, fractional, mixed, signed, and suffixed inches onto the 1/64 grid", () => {
  assert.equal(parseInches("1 1/2"), 1.5);
  assert.equal(parseInches("3/64"), 3 / 64);
  assert.equal(parseInches("-1 1/2"), -1.5);
  assert.equal(parseInches("2.1 in"), 2 + 6 / 64);
  assert.equal(parseInches('1 1/4"'), 1.25);
  assert.equal(parseInches("1/2″"), 0.5);
  assert.equal(parseInches("5/4"), 1.25);
  assert.equal(parseInches(-0.1), -6 / 64);
});

test("evaluates dimension arithmetic with normal precedence and snaps only the result", () => {
  assert.equal(parseInches("(20-0.75)"), 19.25);
  assert.equal(parseInches("2 + 3 * 4"), 14);
  assert.equal(parseInches("(2 + 3) * 4"), 20);
  assert.equal(parseInches("-1 1/2 + 2"), 0.5);
  assert.equal(parseInches("1/3 * 3"), 1);
  assert.equal(parseInches("20/2.5"), 8);
  assert.equal(parseInches("8/4/2"), 1);
  assert.equal(parseInches("1 / 3"), 21 / 64);
  for (const value of ["1+", "(1+2", "1/0", "2**3", "--1", "1+(2 3/2)"]) {
    assert.throws(() => parseInches(value));
  }
});

test("rejects malformed or non-finite dimensions", () => {
  for (const value of ["", "1/0", "2 3/2", "1 1/2x", "--1", "Infinity", Number.NaN, Infinity, 1e100]) {
    assert.throws(() => parseInches(value as string | number));
  }
});

test("formats simplified inch fractions", () => {
  assert.equal(formatInches(1.5), "1 1/2");
  assert.equal(formatInches(3 / 64), "3/64");
  assert.equal(formatInches(-1.5), "-1 1/2");
  assert.equal(formatInches(1.25), "1 1/4");
});

test("validates and snaps boxes, rejecting bad dimensions and repeated IDs", () => {
  const source = [{ id: "a", name: "A", size: [1.001, 2, 3], position: [0, 0, -0.01], color: "#fff" }];
  const boxes = validateBoxes(source);
  assert.equal(boxes[0].size[0], 1);
  assert.equal(boxes[0].position[2], -1 / 64);
  assert.throws(() => validateBoxes([source[0], source[0]]));
  assert.throws(() => validateBoxes([{ ...source[0], size: [0, 1, 1] }]));
  assert.throws(() => validateBoxes(Array.from({ length: 2001 }, (_, index) => ({ ...source[0], id: String(index) }))));
});

test("generates editable source with quoted fractional inch helpers", () => {
  const box: BoxSpec = { id: "box-1", name: "Top", size: [48, 24, 0.75], position: [0, 0, 34], color: "#b8875a" };
  const generated = generateSource([box]);
  assert.match(generated, /box\(\{ id: "box-1"/);
  assert.match(generated, /inch\("3\/4"\)/);
  assert.match(generated, /position: \[inch\("0"\)/);
  const rebuilt: unknown[] = [];
  const boxCall = (spec: unknown) => rebuilt.push(spec);
  new Function("box", "inch", generated)(boxCall, parseInches);
  assert.deepEqual(validateBoxes(rebuilt), [box]);
});

test("face frames point outward and use the specified outside-looking u/v directions", () => {
  const expected: Record<FaceName, [number, number, number, number, number, number]> = {
    front: [1, -1, 0, 1, 2, 1], back: [1, 1, 0, -1, 2, 1],
    right: [0, 1, 1, 1, 2, 1], left: [0, -1, 1, -1, 2, 1],
    top: [2, 1, 0, 1, 1, 1], bottom: [2, -1, 0, 1, 1, -1],
  };
  for (const face of Object.keys(expected) as FaceName[]) {
    const frame = getFaceFrame(face);
    assert.deepEqual([frame.normalAxis, frame.normalSign, frame.uAxis, frame.uSign, frame.vAxis, frame.vSign], expected[face]);
  }
});

test("relative placement contacts all six outward faces and respects signed edge anchors", () => {
  const parent: BoxSpec = { id: "p", name: "Parent", size: [10, 8, 6], position: [2, 3, 4], color: "red" };
  const cases: Array<{ face: FaceName; axis: number; coordinate: number }> = [
    { face: "front", axis: 1, coordinate: 2.25 }, { face: "back", axis: 1, coordinate: 11 },
    { face: "right", axis: 0, coordinate: 12 }, { face: "left", axis: 0, coordinate: 1.25 },
    { face: "top", axis: 2, coordinate: 10 }, { face: "bottom", axis: 2, coordinate: 3.25 },
  ];
  for (const { face, axis, coordinate } of cases) {
    const child = createBoxFromFace(parent, face, `child-${face}`);
    assert.equal(child.position[axis], coordinate, `${face} child starts at the outside plane`);
    assert.equal(child.relative?.face, face);
  }

  const make = (u: "left" | "right", v: "bottom" | "top") => validateBoxes([
    parent,
    { id: "c", name: "Child", size: [2, 3, 1], position: [99, 99, 99], color: "blue", relative: { boxId: "p", face: "front", offset: 1, u: { side: u, offset: 1 / 2 }, v: { side: v, offset: 1 / 4 } } },
  ])[1];
  // Front-face u points +X and v points +Z, so right/top anchors subtract child size.
  assert.deepEqual(make("left", "bottom").position, [2.5, -1, 4.25]);
  assert.deepEqual(make("right", "top").position, [9.5, -1, 8.75]);

  const reversed = (face: FaceName, size: [number, number, number], u?: { side: "left" | "right"; offset: number }, v?: { side: "bottom" | "top"; offset: number }) => validateBoxes([
    parent,
    { id: `reverse-${face}`, name: "Reverse", size, position: [0, 0, 0], color: "blue", relative: { boxId: "p", face, offset: 1 / 4, ...(u ? { u } : {}), ...(v ? { v } : {}) } },
  ])[1];
  const back = reversed("back", [2, 3, 1], { side: "left", offset: 1 / 2 });
  assert.equal(back.position[0], 9.5); // Back-face left is physical +X.
  assert.equal(back.position[1], 11.25);
  const left = reversed("left", [2, 3, 1], { side: "left", offset: 1 / 2 });
  assert.equal(left.position[1], 7.5); // Left-face left is physical +Y.
  assert.equal(left.position[0], -1 / 4);
  const bottom = reversed("bottom", [2, 3, 1], undefined, { side: "bottom", offset: 1 / 4 });
  assert.equal(bottom.position[1], 7.75); // Bottom-face bottom is physical +Y.
  assert.equal(bottom.position[2], 11 / 4);
});

test("unset tangential anchors preserve position; one anchor leaves the other untouched", () => {
  const parent: BoxSpec = { id: "p", name: "P", size: [10, 8, 6], position: [2, 3, 4], color: "red" };
  const child = { id: "c", name: "C", size: [2, 3, 1] as [number, number, number], position: [40, 41, 42] as [number, number, number], color: "blue" };
  const floating = validateBoxes([parent, { ...child, relative: { boxId: "p", face: "front", offset: 0 } }])[1];
  assert.deepEqual(floating.position, [40, 0, 42]);
  const anchored = validateBoxes([parent, { ...child, relative: { boxId: "p", face: "front", offset: 0, u: { side: "left", offset: 2 } } }])[1];
  assert.deepEqual(anchored.position, [4, 0, 42]);
});

test("re-resolving a moved or resized parent updates a relative placement chain", () => {
  const initial = validateBoxes([
    { id: "root", name: "Root", size: [10, 10, 10], position: [0, 0, 0], color: "red" },
    { id: "middle", name: "Middle", size: [2, 2, 2], position: [0, 0, 0], color: "blue", relative: { boxId: "root", face: "right", offset: 1 } },
    { id: "leaf", name: "Leaf", size: [1, 1, 1], position: [0, 0, 0], color: "green", relative: { boxId: "middle", face: "top", offset: 1 / 2, u: { side: "right", offset: 0 } } },
  ]);
  assert.deepEqual(initial.map((box) => box.position), [[0, 0, 0], [11, 0, 0], [12, 0, 2.5]]);
  const moved = validateBoxes([
    { ...initial[0], size: [12, 10, 10], position: [3, 4, 5] },
    initial[1], initial[2],
  ]);
  assert.deepEqual(moved.map((box) => box.position), [[3, 4, 5], [16, 0, 0], [17, 0, 2.5]]);
});

test("rejects missing references and relative cycles", () => {
  const box = { id: "a", name: "A", size: [1, 1, 1], position: [0, 0, 0], color: "red" };
  assert.throws(() => validateBoxes([{ ...box, relative: { boxId: "missing", face: "top", offset: 0 } }]), /unknown box/);
  assert.throws(() => validateBoxes([
    { ...box, relative: { boxId: "b", face: "top", offset: 0 } },
    { ...box, id: "b", relative: { boxId: "a", face: "top", offset: 0 } },
  ]), /cycle/);
});

test("generated source preserves relative metadata and fractional inch offsets", () => {
  const boxes = validateBoxes([
    { id: "base", name: "Base", size: [8, 4, 2], position: [0, 0, 0], color: "red" },
    { id: "shelf", name: "Shelf", size: [4, 2, 1 / 2], position: [0, 0, 0], color: "blue", relative: { boxId: "base", face: "top", offset: 3 / 4, u: { side: "right", offset: 1 / 2 }, v: { side: "top", offset: 1 / 4 } } },
  ]);
  const source = generateSource(boxes);
  assert.match(source, /face: "top", offset: inch\("3\/4"\)/);
  assert.match(source, /side: "right", offset: inch\("1\/2"\)/);
  const rebuilt: unknown[] = [];
  new Function("box", "inch", source)((spec: unknown) => rebuilt.push(spec), parseInches);
  assert.deepEqual(validateBoxes(rebuilt), boxes);
});

test("variables resolve forward references and expressions stay live across dimensions and relative offsets", () => {
  const model = resolveModel([
    { id: "base", name: "Base", size: ["var(width)", "var(depth)", 1], position: ["var(origin)", 0, 0], color: "red" },
    { id: "child", name: "Child", size: [1, 1, 1], position: [0, 0, 0], color: "blue", relative: { boxId: "base", face: "top", offset: "var(gap)", u: { side: "left", offset: "var(u)" }, v: { side: "bottom", offset: "var(v)" } } },
  ], [
    { name: "depth", value: 4 }, { name: "width", value: 1, expression: "var(depth) * 2" },
    { name: "origin", value: 2 }, { name: "gap", value: 1 / 2 }, { name: "u", value: 1 }, { name: "v", value: 2 },
  ]);
  assert.deepEqual(model.boxes[0].size, [8, 4, 1]);
  assert.deepEqual(model.boxes[1].position, [3, 2, 1.5]);
  assert.equal(model.boxes[0].expressions?.["size.0"], "var(width)");
  assert.equal(model.boxes[1].expressions?.["relative.v.offset"], "var(v)");
  assert.equal(parseInches("var(width) + 1", Object.fromEntries(model.variables.map((v) => [v.name, v.value]))), 9);
});

test("variable validation catches unknown names, cycles, duplicates, and invalid identifiers", () => {
  assert.throws(() => parseInches("var(nope)"), (error: unknown) => error instanceof MissingVariableError && error.variableName === "nope");
  assert.throws(() => resolveVariables([{ name: "a", value: "var(b)" }]), MissingVariableError);
  assert.throws(() => resolveVariables([{ name: "a", value: "var(b)" }, { name: "b", value: "var(a)" }]), /cycle/);
  assert.throws(() => resolveVariables([{ name: "a", value: 1 }, { name: "a", value: 2 }]), /Duplicate/);
  assert.throws(() => resolveVariables([{ name: "not-valid", value: 1 }]), /identifier/);
  assert.throws(() => validateBoxes([{ id: "a", name: "A", size: [1, 1, 1], position: [0, 0, 0], color: "red", relative: { boxId: "a", face: "top", offset: 0 }, expressions: { "relative.u.offset": "var(x)" } }]), /requires a relative u edge/);
});

test("generated variable source round-trips quoted variable references", () => {
  const model = resolveModel([{ id: "a", name: "A", size: ["var(width) + 1", 2, 3], position: [0, 0, 0], color: "red" }], [{ name: "width", value: 6 }]);
  const source = generateSource(model.boxes, model.variables);
  assert.match(source, /variable\(\{ name: "width"/);
  assert.match(source, /"var\(width\) \+ 1"/);
  const rebuiltBoxes: unknown[] = [], rebuiltVariables: unknown[] = [];
  new Function("box", "variable", "inch", source)((spec: unknown) => rebuiltBoxes.push(spec), (spec: unknown) => rebuiltVariables.push(spec), parseInches);
  assert.deepEqual(resolveModel(rebuiltBoxes, rebuiltVariables), model);
});

test("optional variable descriptions survive resolution, source round-trips, and dependency edits", () => {
  const description = 'Panel "width" <b>in inches</b>\nAllow \\ trim stock.';
  const model = resolveModel([], [
    { name: "width", value: 6, description },
    { name: "doubleWidth", value: "var(width) * 2", description: "Derived width" },
    { name: "plain", value: 1 },
    { name: "empty", value: 2, description: "" },
  ]);
  assert.equal(model.variables[0].description, description);
  assert.equal(model.variables[1].value, 12);
  assert.equal(Object.hasOwn(model.variables[2], "description"), false);
  assert.equal(model.variables[3].description, "");
  const rebuilt: unknown[] = [];
  new Function("variable", "inch", generateSource([], model.variables))((spec: unknown) => rebuilt.push(spec), parseInches);
  assert.deepEqual(resolveVariables(rebuilt), model.variables);
  const updated = resolveVariables(model.variables.map((item) => item.name === "width" ? { ...item, value: 10 } : item));
  assert.equal(updated[1].value, 20);
  assert.equal(updated[1].description, "Derived width");
  const removed = removeVariable([], updated, "width");
  assert.equal(removed.variables[0].value, 20);
  assert.equal(removed.variables[0].description, "Derived width");
  const cleared = resolveVariables(updated.map((item) => ({ ...item, description: undefined })));
  assert.ok(cleared.every((item) => !Object.hasOwn(item, "description")));
  assert.doesNotMatch(generateSource([], cleared), /description:/);
});

test("variable descriptions reject non-string values", () => {
  for (const description of [null, 1, true, {}, []]) {
    assert.throws(() => resolveVariables([{ name: "width", value: 6, description }]), /Variable width description must be a string/);
  }
});

test("removing a variable replaces every exact reference while preserving geometry and remaining links", () => {
  const original = resolveModel([
    { id: "base", name: "Base", size: [0, 0, 0], position: [0, 0, 0], color: "red", expressions: {
      "size.0": "var(width) + var(panel)", "size.1": "var(panel) * var(panel)", "size.2": "var(width)",
      "position.0": "var(panel) * 2", "position.1": "var(panel) + var(width)", "position.2": "var(panels)",
    } },
    { id: "child", name: "Child", size: [1, 1, 1], position: [0, 0, 0], color: "blue", relative: { boxId: "base", face: "top", offset: 0, u: { side: "left", offset: 0 }, v: { side: "bottom", offset: 0 } }, expressions: {
      "relative.offset": "var(panel)", "relative.u.offset": "var(panel) + 1", "relative.v.offset": "var(panel) * -1",
    } },
  ], [
    { name: "width", value: 10 }, { name: "panel", value: -2 },
    { name: "panels", value: 0, expression: "var(panel) * 2" },
    { name: "other", value: 0, expression: "var(panel) + var(panels)" },
  ]);
  const removed = removeVariable(original.boxes, original.variables, "panel");
  assert.throws(() => removeVariable(original.boxes, original.variables, "missing"), MissingVariableError);
  assert.equal(removed.variables.some((variable) => variable.name === "panel"), false);
  assert.match(removed.variables.find((variable) => variable.name === "other")!.expression!, /\(-2\) \+ var\(panels\)/);
  assert.equal(removed.variables.find((variable) => variable.name === "panels")!.expression, "(-2) * 2");
  for (const box of removed.boxes) for (const expression of Object.values(box.expressions ?? {})) {
    assert.equal(expression.includes("var(panel)"), false);
  }
  assert.deepEqual(removed.boxes.map(({ size, position, relative }) => ({ size, position, relative })), original.boxes.map(({ size, position, relative }) => ({ size, position, relative })));
  const resized = resolveModel(removed.boxes, removed.variables.map((variable) => variable.name === "width" ? { ...variable, value: 20, expression: undefined } : variable));
  assert.equal(resized.boxes[0].size[0], 18);
  assert.equal(resized.boxes[0].size[2], 20);
  assert.equal(resized.boxes[0].expressions?.["position.2"], "var(panels)");
});
