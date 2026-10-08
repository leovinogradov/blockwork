import * as THREE from 'three';
import { getFaceFrame, type FaceName } from './model';

/** A render-only mask on a box's existing surface; never changes its base color. */
export function createFaceHighlight(material: THREE.MeshStandardMaterial, color: THREE.ColorRepresentation) {
  const strength = { value: 0 };
  const normal = { value: new THREE.Vector3() };
  const highlightColor = { value: new THREE.Color(color) };
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();

  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.faceHighlightStrength = strength;
    shader.uniforms.faceHighlightNormal = normal;
    shader.uniforms.faceHighlightColor = highlightColor;
    // BoxGeometry has separate vertices with constant local normals per face.
    // Using those normals keeps the chosen face fixed as the camera rotates.
    shader.vertexShader = `varying vec3 vHighlightNormal;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      vHighlightNormal = objectNormal;
    `);
    shader.fragmentShader = `
      varying vec3 vHighlightNormal;
      uniform vec3 faceHighlightNormal;
      uniform vec3 faceHighlightColor;
      uniform float faceHighlightStrength;
      ${shader.fragmentShader}
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float highlightMask = step(0.99, dot(vHighlightNormal, faceHighlightNormal));
      outgoingLight = mix(outgoingLight, faceHighlightColor, highlightMask * faceHighlightStrength);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${cacheKey}|face-highlight-v1`;

  return {
    setFace(face: FaceName | null) {
      strength.value = face ? 0.28 : 0;
      normal.value.set(0, 0, 0);
      if (face) {
        const frame = getFaceFrame(face);
        normal.value.setComponent(frame.normalAxis, frame.normalSign);
      }
    },
  };
}
