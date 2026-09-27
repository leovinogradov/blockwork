import test from "node:test";
import assert from "node:assert/strict";
import { createBoxFromFace, formatInches, generateSource, getFaceFrame, parseInches, validateBoxes, type BoxSpec, type FaceName } from "../src/model";

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
