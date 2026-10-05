import * as THREE from 'three';
import { withDepthBias } from './depth-bias';
import { formatInches } from './model';
import { measurementAnnotationLayout, type Measurement } from './measurements';
import type { Vector3 } from './groups';

/** Depth-tested dimension lines with browser-rendered SVG text. */
export function createMeasurementAnnotation(overlay: SVGSVGElement, preview = false) {
  const group = new THREE.Group();
  const lineProperties = { color: '#8dd9d0', transparent: true, depthWrite: false, opacity: preview ? .75 : 1 };
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), withDepthBias(preview
    ? new THREE.LineDashedMaterial(lineProperties)
    : new THREE.LineBasicMaterial(lineProperties), 2));
  lines.renderOrder = 10;
  group.add(lines);
  const namespace = 'http://www.w3.org/2000/svg';
  const label = document.createElementNS(namespace, 'g');
  label.setAttribute('class', `measurement-label${preview ? ' preview' : ''}`);
  label.setAttribute('opacity', preview ? '.75' : '1');
  const background = document.createElementNS(namespace, 'rect');
  background.setAttribute('fill', '#152a32');
  background.setAttribute('stroke-width', '1');
  background.setAttribute('vector-effect', 'non-scaling-stroke');
  const text = document.createElementNS(namespace, 'text');
  text.setAttribute('fill', '#c8f4ed');
  text.setAttribute('font-family', 'ui-monospace, monospace');
  text.setAttribute('font-weight', '600');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  label.append(background, text); overlay.append(label);
  let signature = '', transform = '';
  let frame: ReturnType<typeof measurementAnnotationLayout> | null = null;
  let labelWidth = 1, labelHeight = 1, labelVisible = false;
  let matrix = [1, 0, 0, 1, 0, 0];
  const labelPosition = new THREE.Vector3();
  const setLabelVisible = (visible: boolean) => {
    if (label.getAttribute('display') !== (visible ? null : 'none')) {
      if (visible) label.removeAttribute('display'); else label.setAttribute('display', 'none');
    }
    labelVisible = visible;
  };
  const hide = () => { group.visible = false; setLabelVisible(false); };
  hide();
  const update = (start: Vector3, end: Vector3, distance: number, measurement: Measurement, sketchMode: boolean, selected: boolean, through: boolean, camera: THREE.Camera, size: [number, number], isOccluded: (point: Vector3) => boolean = () => false) => {
    lines.material.depthTest = !(preview || through);
    const nextSignature = JSON.stringify([start, end, distance, measurement.offset, measurement.lineHeight, measurement.plane, sketchMode, selected]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      frame = measurementAnnotationLayout(start, end, measurement, sketchMode);
      const overhang = frame.lineHeight * .2;
      const extension = (point: Vector3, dimension: Vector3) => {
        const delta = new THREE.Vector3(...dimension).sub(new THREE.Vector3(...point));
        if (delta.lengthSq() < 1e-12) delta.set(...frame!.perpendicular).multiplyScalar(Math.sign(frame!.offset) || 1);
        return new THREE.Vector3(...dimension).addScaledVector(delta.normalize(), overhang);
      };
      const tick = (point: Vector3, sign: number) => new THREE.Vector3(...point).addScaledVector(new THREE.Vector3(...frame!.perpendicular), overhang * sign);
      lines.geometry.dispose();
      lines.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...start), extension(start, frame.dimensionStart),
        new THREE.Vector3(...end), extension(end, frame.dimensionEnd),
        new THREE.Vector3(...frame.dimensionStart), new THREE.Vector3(...frame.dimensionEnd),
        tick(frame.dimensionStart, -1), tick(frame.dimensionStart, 1),
        tick(frame.dimensionEnd, -1), tick(frame.dimensionEnd, 1),
      ]);
      if (lines.material instanceof THREE.LineDashedMaterial) {
        lines.material.dashSize = frame.lineHeight * .2; lines.material.gapSize = frame.lineHeight * .15;
        lines.computeLineDistances();
      }
      lines.material.color.set(selected ? '#e7ad60' : '#8dd9d0');
      const content = `${formatInches(distance)} in`, fontSize = frame.lineHeight / 1.2, padding = frame.lineHeight * .2;
      labelWidth = content.length * fontSize * .6 + padding * 2;
      labelHeight = frame.lineHeight + padding;
      text.textContent = content; text.setAttribute('font-size', String(fontSize));
      background.setAttribute('x', String(-labelWidth / 2)); background.setAttribute('y', String(-labelHeight / 2));
      background.setAttribute('width', String(labelWidth)); background.setAttribute('height', String(labelHeight));
      background.setAttribute('rx', String(padding)); background.setAttribute('stroke', selected ? '#e7ad60' : '#497e80');
      label.setAttribute('aria-label', `Distance ${content}`);
      labelPosition.set(...frame.labelPosition);
    }
    const layout = frame!;
    group.visible = Math.abs(camera.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3(...layout.normal))) >= 1e-5;
    if (!group.visible || size[0] <= 0 || size[1] <= 0) { setLabelVisible(false); return; }
    const clip = new THREE.Vector4(...layout.labelPosition, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    if (clip.w <= 0 || Math.abs(clip.z / clip.w) > 1) { setLabelVisible(false); return; }
    const center = labelPosition.clone().project(camera);
    const u = new THREE.Vector3(...(sketchMode ? [1, 0, 0] as const : layout.direction));
    const v = new THREE.Vector3(...(sketchMode ? [0, 1, 0] as const : layout.perpendicular));
    const step = .001;
    const px = labelPosition.clone().addScaledVector(u, step).project(camera).sub(center);
    const py = labelPosition.clone().addScaledVector(v, step).project(camera).sub(center);
    let ux = px.x * size[0] / (2 * step), uy = -px.y * size[1] / (2 * step);
    let vx = py.x * size[0] / (2 * step), vy = -py.y * size[1] / (2 * step);
    if (ux < 0 || Math.abs(ux) < 1e-6 && uy > 0) { ux = -ux; uy = -uy; }
    if (ux * vy - uy * vx < 0) { vx = -vx; vy = -vy; }
    // SVG's downward Y axis is included in the projected basis, keeping text readable.
    matrix = [ux, uy, vx, vy, (center.x + 1) * size[0] / 2, (1 - center.y) * size[1] / 2];
    const visible = Math.abs(ux * vy - uy * vx) >= 1e-6 && (preview || through || !isOccluded(layout.labelPosition));
    setLabelVisible(visible);
    if (visible) {
      const nextTransform = `matrix(${matrix.join(' ')})`;
      if (nextTransform !== transform) { label.setAttribute('transform', nextTransform); transform = nextTransform; }
    }
  };
  const containsPoint = (x: number, y: number) => {
    if (!labelVisible) return false;
    const [a, b, c, d, e, f] = matrix, determinant = a * d - b * c;
    const localX = (d * (x - e) - c * (y - f)) / determinant;
    const localY = (a * (y - f) - b * (x - e)) / determinant;
    return Math.abs(localX) <= labelWidth / 2 && Math.abs(localY) <= labelHeight / 2;
  };
  return { group, label, labelPosition, containsPoint, hide, update, dispose: () => {
    group.removeFromParent(); label.remove(); lines.geometry.dispose(); lines.material.dispose();
  } };
}
