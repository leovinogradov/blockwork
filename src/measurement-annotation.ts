import * as THREE from 'three';
import { withDepthBias } from './depth-bias';
import { formatInches } from './model';
import { measurementAnnotationLayout, type Measurement } from './measurements';

/** Geometry and a textured label share the same depth rules as mounted sketches. */
export function createMeasurementAnnotation(preview = false) {
  const group = new THREE.Group();
  const lineProperties = { color: '#8dd9d0', transparent: true, depthWrite: false, opacity: preview ? .75 : 1 };
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), withDepthBias(preview
    ? new THREE.LineDashedMaterial(lineProperties)
    : new THREE.LineBasicMaterial(lineProperties), 2));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  let texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), withDepthBias(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: preview ? .75 : 1,
  }), 2));
  // Draw after sketch fills, edges, and dimension strokes, even in through mode.
  lines.renderOrder = 10; label.renderOrder = 11;
  group.add(lines, label);
  let signature = '';
  let frame: ReturnType<typeof measurementAnnotationLayout> | null = null;
  let labelWidth = 1, labelHeight = 1;
  const update = (start: [number, number, number], end: [number, number, number], distance: number, measurement: Measurement, sketchMode: boolean, selected: boolean, through: boolean, camera: THREE.Camera) => {
    lines.material.depthTest = label.material.depthTest = !(preview || through);
    const nextSignature = JSON.stringify([start, end, distance, measurement.offset, measurement.lineHeight, measurement.plane, sketchMode, selected]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      frame = measurementAnnotationLayout(start, end, measurement, sketchMode);
      const overhang = frame.lineHeight * .2;
      const extension = (point: [number, number, number], dimension: [number, number, number]) => {
        const delta = new THREE.Vector3(...dimension).sub(new THREE.Vector3(...point));
        if (delta.lengthSq() < 1e-12) delta.set(...frame!.perpendicular).multiplyScalar(Math.sign(frame!.offset) || 1);
        return new THREE.Vector3(...dimension).addScaledVector(delta.normalize(), overhang);
      };
      const tick = (point: [number, number, number], sign: number) => new THREE.Vector3(...point).addScaledVector(new THREE.Vector3(...frame!.perpendicular), overhang * sign);
      const points = [
        new THREE.Vector3(...start), extension(start, frame.dimensionStart),
        new THREE.Vector3(...end), extension(end, frame.dimensionEnd),
        new THREE.Vector3(...frame.dimensionStart), new THREE.Vector3(...frame.dimensionEnd),
        tick(frame.dimensionStart, -1), tick(frame.dimensionStart, 1),
        tick(frame.dimensionEnd, -1), tick(frame.dimensionEnd, 1),
      ];
      lines.geometry.dispose();
      lines.geometry = new THREE.BufferGeometry().setFromPoints(points);
      if (lines.material instanceof THREE.LineDashedMaterial) {
        lines.material.dashSize = frame.lineHeight * .2; lines.material.gapSize = frame.lineHeight * .15;
        lines.computeLineDistances();
      }
      lines.material.color.set(selected ? '#e7ad60' : '#8dd9d0');
      const text = `${formatInches(distance)} in`, fontSize = frame.lineHeight / 1.2, padding = frame.lineHeight * .2;
      labelWidth = text.length * fontSize * .6 + padding * 2;
      labelHeight = frame.lineHeight + padding;
      // Fixed texel density keeps text crisp without making canvas size depend on zoom.
      const density = 192 / frame.lineHeight;
      const width = Math.ceil(labelWidth * density), height = Math.ceil(labelHeight * density);
      if (canvas.width !== width || canvas.height !== height) {
        // Uploaded textures have fixed storage dimensions. A changing preview
        // needs fresh storage, otherwise uploads leave stale or stretched text.
        texture.dispose();
        canvas.width = width; canvas.height = height;
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        label.material.map = texture;
      } else {
        context.resetTransform(); context.clearRect(0, 0, width, height);
      }
      context.setTransform(density, 0, 0, density, canvas.width / 2, canvas.height / 2);
      context.fillStyle = '#152a32'; context.strokeStyle = selected ? '#e7ad60' : '#497e80';
      context.lineWidth = frame.lineHeight / 64;
      context.beginPath();
      context.roundRect(-labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight, padding);
      context.fill(); context.stroke();
      context.fillStyle = '#c8f4ed'; context.font = `600 ${fontSize}px ui-monospace, monospace`;
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 0, 0);
      texture.needsUpdate = true;
      label.position.set(...frame.labelPosition); label.scale.set(labelWidth, labelHeight, 1);
      label.userData.measurementId = measurement.id;
    }
    const layout = frame!;
    group.visible = Math.abs(camera.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3(...layout.normal))) >= 1e-5;
    if (!group.visible) return;
    const u = new THREE.Vector3(...(sketchMode ? [1, 0, 0] as const : layout.direction));
    const v = new THREE.Vector3(...(sketchMode ? [0, 1, 0] as const : layout.perpendicular));
    const center = label.position.clone().project(camera);
    const px = label.position.clone().addScaledVector(u, .001).project(camera).sub(center);
    const py = label.position.clone().addScaledVector(v, .001).project(camera).sub(center);
    const flipU = px.x < 0 || Math.abs(px.x) < 1e-6 && px.y < 0;
    if (flipU) u.negate();
    if ((px.x * py.y - px.y * py.x) * (flipU ? -1 : 1) < 0) v.negate();
    label.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, u.clone().cross(v)));
    group.updateMatrixWorld(true);
  };
  return { group, label, update, dispose: () => {
    group.removeFromParent(); lines.geometry.dispose(); lines.material.dispose();
    label.geometry.dispose(); label.material.dispose(); texture.dispose();
  } };
}
