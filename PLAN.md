# Blockwork implementation plan

- [x] Define canonical box dimensions in inches, snapped to 1/64 inch.
- [x] Provide a parameterized workbench example, standalone editable `.js` file, and worker-based JavaScript compiler.
- [x] Build a Three.js viewport with orbit, pan, zoom, standard views, projection, grid, selection, and visible navigation help.
- [x] Add component tree, box inspector, code editor, file open/download, and local recovery.
- [x] Preserve the last good model on compile failure; protect pending source drafts and undo history across recovery.
- [x] Verify TypeScript/Vite production build, model/compiler tests, and browser interaction flows.
- [x] Create boxes from viewport faces and edit persistent face-relative placements in the inspector.
- [x] Add reusable numeric variables for dimensions, positions, and relative offsets, including expression-aware editing, source round-tripping, undo, and local recovery.
