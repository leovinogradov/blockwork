import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelSpec } from '../src/model';
import type { CompiledSketch } from '../src/compiler';
import { generateSource, reparentBox, resolveModel } from '../src/model';
import { generateSketchSource } from '../src/sketch';
import { reparentPosition, worldPosition } from '../src/groups';

type CompilerResult = Partial<ModelSpec & CompiledSketch> & { error?: string };
let receive: (event: { data: { source: string; kind: 'model' | 'sketch' } }) => void;
let result: CompilerResult;
(globalThis as any).self = {
  addEventListener: (_: string, listener: typeof receive) => { receive = listener; },
  postMessage: (response: CompilerResult) => { result = response; },
};
await import('../src/compiler.worker');
function compile(source: string, kind: 'model' | 'sketch' = 'model'): CompilerResult {
  receive({ data: { source, kind } });
  return result;
}
const part = (id: string, extra = '') => `box({id:'${id}', name:'${id}', size:[2,3,4], position:[1,2,3], color:'#86a9a3'${extra}})`;
const group = (id: string, extra = '') => `{id:'${id}', name:'${id}', position:[10,20,30]${extra}}`;
const canonical = (model: CompilerResult) => ({ ...model, groups: model.groups?.slice().sort((a, b) => a.id.localeCompare(b.id)), boxes: model.boxes?.slice().sort((a, b) => a.id.localeCompare(b.id)), rectangles: model.rectangles?.slice().sort((a, b) => a.id.localeCompare(b.id)) });

test('nested groups compile local geometry and membership and round-trip as nested source', () => {
  const nested = compile(`group(${group('root')}, [${part('a')}, group(${group('inner')}, [${part('b')}])]); ${part('outside')};`);
  assert.equal(nested.error, undefined);
  assert.deepEqual(nested.boxes!.map((b) => b.groupId), ['root', 'inner', undefined]);
  assert.equal(nested.groups!.find((g) => g.id === 'inner')!.parentId, 'root');
  assert.equal(nested.boxes!.length, 3);
  assert.deepEqual(worldPosition(nested.boxes![1].position, nested.groups!, 'inner'), [21, 42, 63]);
  assert.equal(nested.boxes![2].groupId, undefined);
  const source = generateSource(nested.boxes!, nested.variables!, nested.groups!);
  assert.doesNotMatch(source, /groupId|parentId/);
  assert.deepEqual(canonical(compile(source)), canonical(nested));
});

test('explicit ownership fields are rejected by every helper, even when matching nesting', () => {
  assert.match(compile(`group(${group('root')}, [${part('a', ", groupId:'root'")}]);`).error!, /groupId is no longer supported.*group\(properties/);
  assert.match(compile(`group(${group('root')}, [group(${group('inner', ", parentId:'root'")})]);`).error!, /parentId is no longer supported/);
  for (const source of ["rectangle({size:[1,2], groupId:'root'})", "line({start:[0,0],end:[1,1],groupId:'root'})"]) {
    assert.match(compile(source, 'sketch').error!, /groupId is no longer supported/);
  }
  assert.match(compile(part('a', ', groupId:undefined')).error!, /groupId is no longer supported/);
});

test('unnamed and empty groups work, including grouping an existing helper result only once', () => {
  const compiled = compile(`const item = ${part('a')}; group({position:[4,5,6]}, [item]); group({name:'Empty'}, []);`);
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.boxes!.length, 1);
  assert.equal(compiled.boxes![0].groupId, 'group-1');
  assert.deepEqual(compiled.groups!.map((g) => g.position), [[4, 5, 6], [0, 0, 0]]);
});

test('nested sketch groups include rectangles and signed lines and round-trip as nested source', () => {
  const compiled = compile(`
    group({id:'drawing', name:'Drawing', position:[8,9,0]}, [
      rectangle({id:'outline', name:'Outline', size:[12,8], position:[0,0]}),
      group({id:'detail', name:'Detail', position:[2,3,0]}, [
        line({id:'diagonal', name:'Diagonal', start:[5,6], end:[1,9]})
      ]),
      rectangle({id:'flat', size:[2,3]})
    ]);
  `, 'sketch');
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.rectangles!.length, 3);
  assert.deepEqual(compiled.rectangles!.map((r) => r.groupId), ['drawing', 'detail', 'drawing']);
  assert.deepEqual(compiled.rectangles![1].size, [-4, 3]);
  assert.deepEqual(worldPosition(compiled.rectangles![1].position, compiled.groups!, 'detail'), [15, 18, 0]);
  const source = generateSketchSource(compiled.rectangles!, compiled.groups!);
  assert.doesNotMatch(source, /groupId|parentId/);
  assert.deepEqual(canonical(compile(source, 'sketch')), canonical(compiled));
});

test('face references and variables resolve after nested membership has been assigned', () => {
  const compiled = compile(`
    variable({name:'width', value:20});
    group({id:'cabinet', name:'SideCabinet', position:[12,0,0]}, [
      box({id:'panel', size:[inch('var(width)'), 4, 1]}),
      box({id:'top', size:[20,4,1], relative:{boxId:'panel', face:'top', offset:0}})
    ]);
  `);
  assert.equal(compiled.error, undefined);
  assert.deepEqual(compiled.boxes!.map((b) => b.groupId), ['cabinet', 'cabinet']);
  assert.deepEqual(compiled.boxes![1].position, [0, 0, 1]);
  assert.deepEqual(worldPosition(compiled.boxes![1].position, compiled.groups!, 'cabinet'), [12, 0, 1]);
  assert.equal(compiled.boxes![0].expressions!['size.0'], 'var(width)');
});

test('sharing one item or subgroup between groups is rejected', () => {
  assert.match(compile(`const item = ${part('a')}; group(${group('root')}, [item]); group(${group('other')}, [item]);`).error!, /cannot belong to two groups/);
  assert.match(compile(`const inner = group(${group('inner')}); group(${group('root')}, [inner]); group(${group('other')}, [inner]);`).error!, /cannot belong to two groups/);
});

test('malformed nested lists and non-helper items produce actionable errors', () => {
  for (const items of ['null', '{}', "'oops'", '42']) assert.match(compile(`group(${group('root')}, ${items});`).error!, /expects an array/);
  for (const item of ['null', '{}', 'false', 'undefined', "variable({name:'v', value:1})", `{...${part('a')}}`]) assert.match(compile(`group(${group('root')}, [${item}]);`).error!, /results returned/);
  assert.match(compile(`const a = ${part('a')}; group(${group('root')}, [a,a]);`).error!, /twice/);
  assert.match(compile(`group(${group('root')}, Array(2));`).error!, /results returned/);
});

test('group IDs and sketch planes are validated with nested syntax', () => {
  assert.match(compile(`group(${group('root')}, [group(${group('root')})]);`).error!, /unique/);
  assert.match(compile(`group({name:'Invalid plane', position:[0,0,1]}, [rectangle({size:[1,1]})]);`, 'sketch').error!, /plane/);
});

test('inspector-style reparenting preserves world positions through source regeneration', () => {
  for (const kind of ['model', 'sketch'] as const) {
    const compiled = compile(kind === 'model'
      ? `${part('a')}; group({id:'destination',position:[10,20,30]}, []);`
      : `rectangle({id:'a',size:[2,3],position:[1,2]}); line({id:'l',start:[4,5],end:[1,9]}); group({id:'destination',position:[10,20,0]}, []);`, kind);
    const items = kind === 'model' ? compiled.boxes! : compiled.rectangles!;
    const before = items.map((item) => worldPosition(item.position, compiled.groups!, item.groupId));
    const moved = items.map((item) => ({ ...item, groupId: 'destination', position: reparentPosition(item.position, compiled.groups!, item.groupId, 'destination').slice(0, item.position.length) }));
    const source = kind === 'model' ? generateSource(moved as ModelSpec['boxes'], [], compiled.groups!) : generateSketchSource(moved as CompiledSketch['rectangles'], compiled.groups!);
    const restored = compile(source, kind);
    assert.equal(restored.error, undefined);
    const after = kind === 'model' ? restored.boxes! : restored.rectangles!;
    assert.deepEqual(after.map((item) => worldPosition(item.position, restored.groups!, item.groupId)), before);
    const detached = after.map((item) => ({ ...item, position: reparentPosition(item.position, restored.groups!, item.groupId).slice(0, item.position.length), groupId: undefined }));
    const detachedSource = kind === 'model' ? generateSource(detached as ModelSpec['boxes'], [], restored.groups!) : generateSketchSource(detached as CompiledSketch['rectangles'], restored.groups!);
    const ungrouped = compile(detachedSource, kind);
    assert.equal(ungrouped.error, undefined);
    const finalItems = kind === 'model' ? ungrouped.boxes! : ungrouped.rectangles!;
    assert.ok(finalItems.every((item) => !item.groupId));
    assert.deepEqual(finalItems.map((item) => worldPosition(item.position, ungrouped.groups!)), before);
  }
});

test('source generation follows tree sibling order', () => {
  const compiled = compile(`group(${group('root')}, [${part('a')}, ${part('b')}]); ${part('outside')};`);
  const source = generateSource(compiled.boxes!, [], compiled.groups!, ['outside', 'root', 'b', 'a']);
  assert.deepEqual(compile(source).boxes!.map((b) => b.id), ['outside', 'b', 'a']);
});

test('cross-group face relations survive reparenting, generated source, and recompilation', () => {
  const compiled = compile(`
    variable({name:'gap', value:0.5});
    group({id:'source',position:[10,20,30]}, [
      box({id:'panel',size:[8,4,1]}),
      box({id:'top',size:[8,4,1],relative:{boxId:'panel',face:'top',offset:inch('var(gap)'),u:{side:'left',offset:0},v:{side:'bottom',offset:0}}}),
      box({id:'cap',size:[1,4,1],relative:{boxId:'top',face:'right',offset:0,u:{side:'left',offset:0},v:{side:'bottom',offset:0}}})
    ]);
    group({id:'destination',position:[-5,8,40]}, []);
  `);
  assert.equal(compiled.error, undefined);
  const moved = resolveModel(compiled.boxes!.map((b) => b.id === 'top' ? reparentBox(b, compiled.groups!, 'destination') : b), compiled.variables, compiled.groups);
  const regenerated = compile(generateSource(moved.boxes, moved.variables, moved.groups!));
  assert.equal(regenerated.error, undefined);
  assert.deepEqual(canonical(regenerated), canonical(moved));
  for (const original of compiled.boxes!) {
    const restored = regenerated.boxes!.find((b) => b.id === original.id)!;
    assert.deepEqual(restored.relative, original.relative);
    assert.deepEqual(worldPosition(restored.position, regenerated.groups!, restored.groupId), worldPosition(original.position, compiled.groups!, original.groupId));
  }
});
