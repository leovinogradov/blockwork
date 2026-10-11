import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { parseFaceColor } from './face-color';
import { fileName } from './file-names';
import { effectiveHiddenIds } from './group-actions';
import { cylinderAxes, resolveModel, type ModelSpec } from './model';

export type GlbExportOptions = {
  name?: string;
  /** Hidden groups also exclude their descendants. Omit to export all solids. */
  hiddenIds?: Iterable<string>;
  cylinderSegments?: number;
};

export type GlbExportResult = {
  buffer: ArrayBuffer;
  filename: string;
  solidCount: number;
  warnings: string[];
};

const METERS_PER_INCH = 0.0254;

/**
 * Export applied model data, independent of the editor, viewport, and file UI.
 * Does not execute source. Callers decide how to save the returned binary.
 * Sketches and measurements are reported as exclusions, not exported as helpers.
 */
export async function exportModelGlb(input: ModelSpec, options: GlbExportOptions = {}): Promise<GlbExportResult> {
  const segments = options.cylinderSegments ?? 96;
  if (!Number.isInteger(segments) || segments < 3 || segments > 1024) {
    throw new Error('Cylinder segments must be an integer between 3 and 1024.');
  }
  const name = fileName(options.name ?? 'Model');
  // Capture and validate before serialization yields; never mutate caller state.
  const snapshot = structuredClone(input);
  const model = resolveModel(snapshot.boxes, snapshot.variables, snapshot.groups, snapshot.sketches, snapshot.measurements);
  const groups = model.groups ?? [];
  const hidden = effectiveHiddenIds(groups, model.boxes, options.hiddenIds ?? []);
  const solids = model.boxes.filter((solid) => !hidden.has(solid.id));
  if (!solids.length) throw new Error('No visible boxes or cylinders to export.');

  const warnings: string[] = [];
  if (model.sketches?.length) warnings.push('Sketches are not included.');
  if (model.measurements?.length) warnings.push('Measurements are not included.');

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = name;
  // Blockwork: Z up. glTF: Y up. Blender's importer converts back to Z up.
  root.rotation.x = -Math.PI / 2;
  root.userData.blockwork = { version: 1, units: 'inches', variables: model.variables };
  scene.add(root);

  const geometryResources: THREE.BufferGeometry[] = [];
  const materialResources: THREE.Material[] = [];
  try {
    const groupNodes = new Map<string, THREE.Group>();
    for (const group of groups) {
      if (hidden.has(group.id)) continue;
      const node = new THREE.Group();
      node.name = group.name;
      node.position.fromArray(group.position).multiplyScalar(METERS_PER_INCH);
      node.userData.blockwork = { ...group, kind: 'group', units: 'inches' };
      groupNodes.set(group.id, node);
    }
    // Two passes allow children to precede parents in the model array.
    for (const group of groups) {
      const node = groupNodes.get(group.id);
      if (node) (group.parentId ? groupNodes.get(group.parentId)! : root).add(node);
    }

    for (const solid of solids) {
      const [width, depth, height] = solid.size.map((value) => value * METERS_PER_INCH);
      let geometry: THREE.BufferGeometry;
      if (solid.kind === 'cylinder') {
        const { lengthAxis, radialAxes } = cylinderAxes(solid);
        const radius = solid.size[radialAxes[0]] * METERS_PER_INCH / 2;
        geometry = new THREE.CylinderGeometry(radius, radius, solid.size[lengthAxis] * METERS_PER_INCH, segments);
        if (lengthAxis === 0) geometry.rotateZ(-Math.PI / 2);
        if (lengthAxis === 2) geometry.rotateX(Math.PI / 2);
      } else {
        geometry = new THREE.BoxGeometry(width, depth, height);
      }
      geometryResources.push(geometry);
      const faceColor = parseFaceColor(solid.color);
      const material = new THREE.MeshStandardMaterial({
        color: faceColor.color,
        metalness: 0.03,
        roughness: 0.74,
        transparent: faceColor.opacity < 1,
        opacity: faceColor.opacity,
        depthWrite: faceColor.opacity === 1,
      });
      materialResources.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = solid.name;
      mesh.position.fromArray(solid.position).multiplyScalar(METERS_PER_INCH);
      mesh.position.add(new THREE.Vector3(width / 2, depth / 2, height / 2));
      mesh.userData.blockwork = { ...solid, kind: solid.kind ?? 'box', units: 'inches' };
      (solid.groupId ? groupNodes.get(solid.groupId)! : root).add(mesh);
    }
    scene.updateMatrixWorld(true);
    const buffer = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
    if (!(buffer instanceof ArrayBuffer)) throw new Error('Could not generate a binary GLB file.');
    return { buffer, filename: /\.glb$/i.test(name) ? name : `${name}.glb`, solidCount: solids.length, warnings };
  } finally {
    for (const geometry of geometryResources) geometry.dispose();
    for (const material of materialResources) material.dispose();
  }
}
