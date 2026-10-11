import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { exportModelGlb } from '../src/glb-export';
import { resolveModel, cylinderSize } from '../src/model';

// Three.js's browser exporter needs FileReader; Blob itself is native in Node.
class BlobReader {
  result: ArrayBuffer | null = null;
  onloadend?: () => void;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); });
  }
}
Object.defineProperty(globalThis, 'FileReader', { value: BlobReader, configurable: true });

const part = (id: string, overrides = {}) => ({ id, name: id, size: [12, 6, 3], position: [1, 2, 4], color: '#d9a76e', ...overrides });
const inches = 0.0254;
const close = (actual: number[], expected: number[]) => {
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6, `${actual} != ${expected}`));
};
function glbJson(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), buffer.byteLength);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, 'JSON chunk');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))));
}
async function importLikeBlender(buffer: ArrayBuffer) {
  const { scene } = await new GLTFLoader().parseAsync(buffer, '');
  scene.rotation.x = Math.PI / 2; // Blender's glTF Y-up to Z-up conversion.
  scene.updateMatrixWorld(true);
  return scene;
}

test('binary GLB round-trips nested names, physical bounds, materials, and metadata without changing input', async () => {
  const model = resolveModel([part('Panel', { groupId: 'child', size: [24, 6, 3], expressions: { 'size.0': 'var(width)' }, color: '#d9a76e80' })],
    [{ name: 'width', value: 24 }], [
      { id: 'child', name: 'Inner assembly', position: [2, 3, 4], parentId: 'parent' },
      { id: 'parent', name: 'Workbench', position: [10, 20, 30] },
    ]);
  const before = structuredClone(model);
  const result = await exportModelGlb(model, { name: 'Furniture.js' });
  assert.equal(result.filename, 'Furniture.glb');
  assert.equal(result.solidCount, 1);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(model, before);
  const json = glbJson(result.buffer);
  assert.equal(json.meshes.length, 1);
  assert.equal(json.materials[0].alphaMode, 'BLEND');
  assert.ok(Math.abs(json.materials[0].pbrMetallicRoughness.baseColorFactor[3] - 128 / 255) < 1e-7);
  assert.ok(json.meshes[0].primitives.every((primitive: { mode?: number }) => (primitive.mode ?? 4) === 4));
  assert.equal(json.nodes.find((node: { name: string }) => node.name === 'Panel').extras.blockwork.expressions['size.0'], 'var(width)');
  const scene = await importLikeBlender(result.buffer);
  const mesh = scene.getObjectByName('Panel') as THREE.Mesh;
  assert.equal(mesh.parent?.name, 'Inner_assembly');
  assert.equal(mesh.parent?.parent?.name, 'Workbench');
  const bounds = new THREE.Box3().setFromObject(mesh);
  close(bounds.min.toArray(), [13, 25, 38].map((value) => value * inches));
  close(bounds.max.toArray(), [37, 31, 41].map((value) => value * inches));
  assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHexString(), 'd9a76e');
  assert.equal(scene.getObjectByName('Furniture')?.userData.blockwork.variables[0].value, 24);
});

test('cylinders on every axis retain exact length, diameter, and minimum-corner placement', async () => {
  const model = resolveModel(['x', 'y', 'z'].map((axis) => part(axis, {
    kind: 'cylinder', axis, size: cylinderSize(2, 10, axis as 'x' | 'y' | 'z'), position: [3, 5, 7],
  })));
  const result = await exportModelGlb(model, { cylinderSegments: 32 });
  const scene = await importLikeBlender(result.buffer);
  for (const solid of model.boxes) {
    const bounds = new THREE.Box3().setFromObject(scene.getObjectByName(solid.id)!);
    close(bounds.min.toArray(), solid.position.map((value) => value * inches));
    close(bounds.getSize(new THREE.Vector3()).toArray(), solid.size.map((value) => value * inches));
  }
});

test('hidden groups exclude descendants, while exporting all solids is available to other callers', async () => {
  const model = resolveModel([part('visible'), part('direct-hidden'), part('nested-hidden', { groupId: 'child' })], [], [
    { id: 'parent', name: 'Hidden assembly', position: [1, 2, 3] },
    { id: 'child', name: 'Hidden child', position: [0, 0, 0], parentId: 'parent' },
  ]);
  const result = await exportModelGlb(model, { hiddenIds: ['parent', 'direct-hidden'] });
  assert.equal(result.solidCount, 1);
  assert.deepEqual(glbJson(result.buffer).nodes.filter((node: { mesh?: number }) => node.mesh !== undefined).map((node: { name: string }) => node.name), ['visible']);
  assert.equal(glbJson(result.buffer).nodes.some((node: { name: string }) => node.name === 'Hidden assembly'), false);
  assert.equal((await exportModelGlb(model)).solidCount, 3);
  await assert.rejects(exportModelGlb(model, { hiddenIds: ['parent', 'direct-hidden', 'visible'] }), /No visible boxes or cylinders/);
});

test('resolved relative placement and transparency survive export; annotations are explicitly excluded', async () => {
  const model = resolveModel([part('base'), part('linked', {
    color: 'transparent', relative: { boxId: 'base', face: 'top', offset: 1 },
  })], [], [], [{ id: 'drawing', name: 'Drawing', axis: 'z', size: [12, 6], position: [0, 0, 0], color: '#ffffff', shapes: [] }], [{
    id: 'dimension', start: { objectId: 'base', coordinates: [0, 0, 0] }, end: { objectId: 'base', coordinates: [1, 0, 0] },
  }]);
  const result = await exportModelGlb(model);
  assert.deepEqual(result.warnings, ['Sketches are not included.', 'Measurements are not included.']);
  const json = glbJson(result.buffer);
  assert.equal(json.meshes.length, 2);
  assert.equal(json.materials[1].alphaMode, 'BLEND');
  assert.equal(json.materials[1].pbrMetallicRoughness.baseColorFactor[3], 0.2);
  const scene = await importLikeBlender(result.buffer);
  const linked = model.boxes.find((solid) => solid.id === 'linked')!;
  close(new THREE.Box3().setFromObject(scene.getObjectByName('linked')!).min.toArray(), linked.position.map((value) => value * inches));
  assert.equal(scene.getObjectByName('linked')?.userData.blockwork.relative.boxId, 'base');
});

test('empty models and invalid export options fail clearly before writing a file', async () => {
  await assert.rejects(exportModelGlb({ boxes: [], variables: [] }), /No visible boxes or cylinders/);
  const model = resolveModel([part('box')]);
  for (const cylinderSegments of [2, 3.5, 1025, NaN]) {
    await assert.rejects(exportModelGlb(model, { cylinderSegments }), /Cylinder segments/);
  }
  await assert.rejects(exportModelGlb(model, { name: '../bad' }), /without folders/);
  assert.equal((await exportModelGlb(model, { name: 'Already.glb' })).filename, 'Already.glb');
});

test('serialization failures dispose export resources and leave the applied model intact', async (context) => {
  const model = resolveModel([part('box')]);
  const before = structuredClone(model);
  let geometries = 0, materials = 0;
  context.mock.method(THREE.BufferGeometry.prototype, 'dispose', () => { geometries++; });
  context.mock.method(THREE.Material.prototype, 'dispose', () => { materials++; });
  context.mock.method(GLTFExporter.prototype, 'parseAsync', async () => { throw new Error('Serialization failed'); });
  await assert.rejects(exportModelGlb(model), /Serialization failed/);
  assert.equal(geometries, 1);
  assert.equal(materials, 1);
  assert.deepEqual(model, before);
});
