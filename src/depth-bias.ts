import * as THREE from 'three';

// One priority step is 1/2048 inch in camera space. The full axis-to-sketch
// range is 3/2048 inch, well below the model's 1/64-inch minimum spacing.
export const DEPTH_BIAS_STEP = 1 / 2048;

/** Positive priorities favor coincident geometry without changing its XY projection. */
export function withDepthBias<T extends THREE.Material>(material: T, priority: number): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.viewDepthBias = { value: priority * DEPTH_BIAS_STEP };
    shader.vertexShader = `uniform float viewDepthBias;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      // Project a small camera-space Z adjustment, then copy only its depth.
      // Preserve clip-space XY and W so geometry and screen positions stay put.
      float biasedZ = gl_Position.z + projectionMatrix[2][2] * viewDepthBias;
      float biasedW = gl_Position.w + projectionMatrix[2][3] * viewDepthBias;
      if (gl_Position.w > 0.0 && biasedW > 0.0) {
        gl_Position.z = biasedZ / biasedW * gl_Position.w;
      }
    `);
  };
  // All priorities share the shader program; the bias is a per-material uniform.
  material.customProgramCacheKey = () => 'view-depth-bias-v1';
  return material;
}
