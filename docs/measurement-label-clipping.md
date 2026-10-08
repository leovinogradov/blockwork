# Measurement labels flashing across the perspective view

Measurement labels now check their full bounds before updating the SVG overlay. A label disappears while it crosses the camera's near or far clipping plane, lies completely outside the view, or becomes nearly edge-on. Partly offscreen labels remain visible. Dimension lines keep their existing WebGL clipping, and labels return automatically when the camera moves back to a valid view. These checks apply to saved measurements and previews, including THROUGH mode.

The reported symptom was a label briefly stretching across much of the viewport while orbiting in a zoomed-in perspective view, even when the label should have been offscreen. The previous renderer checked only the label center's depth. It estimated an affine SVG transform from two small world-space projection probes and extrapolated that transform across the label. Near the camera, perspective division can produce a huge transform whose SVG bounds overlap the viewport even though the actual 3D label is outside it. A numerical regression reproduces this mechanism; the user's exact camera position and visual artifact were not captured.

[measurement-label-projection.ts](../src/measurement-label-projection.ts) checks all four label corners in homogeneous clip coordinates before perspective division, then clips the projected quad against the viewport. It keeps projection probes within those checked bounds and rejects nonfinite or nearly singular transforms. The relative determinant threshold is `1e-4`; the existing absolute minimum remains `1e-6`. Labels crossing a depth clipping plane are hidden as a whole because the affine SVG overlay cannot represent a clipped perspective surface.

## Verification

Validation on October 7, 2026 passed all 139 automated tests, all 215 browser GPU and interaction checks, and the production build.

- Run `pnpm test` for projection regressions: offscreen expansion, clipping planes, partial visibility, corner angles, and perspective/orthographic zooms.
- Run `pnpm build` for TypeScript and production compilation.
- Run `pnpm dev` and open `/tests/measurement-annotation.html` for browser checks of SVG visibility, picking, restoration, previews, and THROUGH mode.
- In a model, enable PERSPECTIVE and THROUGH, zoom in, and orbit with labels near or outside the viewport corners. Fully offscreen labels should stay hidden; partly visible labels should remain readable, and clipped labels should return as the camera moves away.
