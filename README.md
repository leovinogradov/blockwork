# Blockwork

Blockwork is a browser app for planning furniture, workbenches, and other projects built from simple shapes. Build a 3D model, draw a 2D sketch, and check dimensions in inches. You can edit objects visually or describe them in JavaScript.

**[Try Blockwork](https://leovinogradov.github.io/blockwork/)** · [User guide](docs/user-guide.md) · [Example workbench](examples/workbench.js)

Your files are saved in your browser on your device. You can export them to keep a copy or share a design.

## What you can make

- Build models from boxes and cylinders, with colors, transparency, and placement relative to another object's face.
- Draw rectangles, lines, and circles in 2D, then place sketches in a 3D model.
- Use fractional inch dimensions and shared variables to adjust a design.
- Organize components into groups or combine them into a Part representing one manufactured piece.
- Add measurements that follow the geometry as you edit it.
- Export editable JavaScript, a GLB model for Blender, or a CSV cutlist.

Blockwork is an early project focused on simple geometry. It currently uses inches and does not perform boolean unions or cuts or export CAD formats such as STEP.

## Try your first model

1. Open [Blockwork](https://leovinogradov.github.io/blockwork/) and choose **＋ → New 3D model**.
2. Add a box with **＋** in the model tools, then select it and change its dimensions in the inspector.
3. Use middle-mouse drag to rotate, right-mouse drag to pan, and the scroll wheel to zoom. Press **F** to fit the model in view.
4. Choose **Measurement** or press **M**, click two points, then click a third time to place the dimension label.
5. Choose **Export → Blockwork .js** to download your editable design.

For a fuller example, download [workbench.js](examples/workbench.js), choose **Import .js**, and select **3D model**. You can inspect each component and change its dimensions.

## Model with JavaScript

Each file has a source editor alongside the model. For example, this creates a tabletop 48 inches wide, 24 inches deep, and 3/4 inch thick:

```js
box({
  id: 'top',
  name: 'Tabletop',
  size: [inch('48'), inch('24'), inch('3/4')],
  position: [inch('0'), inch('0'), inch('34')],
  color: '#b8875a'
});
```

The axes are X for width, Y for depth, and Z for height. `position` sets the box's minimum corner. Dimensions snap to the nearest 1/64 inch, and `inch()` accepts fractions and arithmetic such as `inch('24 - 3/4')`.

Choose **Run** or press **Ctrl/Cmd+Enter** to apply source changes. If the code has an error, the previous model stays visible. Run a pending draft before making visual edits. Imported files execute JavaScript, so only open source you trust.

See the [user guide](docs/user-guide.md) for cylinders, variables, groups, Parts, sketches, and measurements.

## Save and share your work

**Files** opens your browser library, where you can organize designs into folders and reopen closed tabs. Changes save automatically; closing a tab keeps its file in the library.

Browser storage belongs to the browser and site where you created the files. A local development copy and the published app have separate libraries. Use **Back up library** in Files to keep a complete backup, or export individual `.js` files. Clearing site data removes the browser copies.

| Export | Use it for |
| --- | --- |
| **Blockwork .js** | Reopen and edit a design in Blockwork, including any pending source draft. |
| **.glb** | Import visible 3D solids into Blender or another tool that reads glTF. Sketches and measurement annotations are excluded. |
| **CSV cutlist** | Get dimensions for boxes and connected Parts, with a configurable maximum thickness. Hidden components are included. |

GLB and cutlist exports use the last applied model. Run source changes first if you want them included.

## Run locally

Use Node.js 24 and pnpm 11, matching the deployment workflow.

```sh
git clone https://github.com/leovinogradov/blockwork.git
cd blockwork
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed in the terminal. To build and preview the production app:

```sh
pnpm build
pnpm exec vite preview
```

## Work on the project

Blockwork uses TypeScript, Vite, and Three.js. The app stores files in IndexedDB and runs model source in a disposable Web Worker.

Run `pnpm test` for the automated tests and `pnpm build` to check types and build the app. The HTML pages in [tests](tests) provide additional browser checks while the development server is running.

Useful starting points:

- [src/main.ts](src/main.ts): app interface and editor interactions.
- [src/model.ts](src/model.ts): geometry, dimensions, and model source generation.
- [src/compiler.worker.ts](src/compiler.worker.ts): model source execution.
- [src/library-storage.ts](src/library-storage.ts): file storage interface.
- [User guide](docs/user-guide.md): detailed controls, source examples, and export behavior.

Found a problem or have an idea? [Open an issue](https://github.com/leovinogradov/blockwork/issues) with what you tried, what happened, and your browser. A small example `.js` file helps when reporting a modeling problem.

## Publish your own copy

The [GitHub Pages workflow](.github/workflows/deploy.yml) installs dependencies, builds the app, and publishes `dist` when changes are pushed to `main`.

In your repository's **Settings → Pages**, select **GitHub Actions** as the source. The workflow uses `--base=/blockwork/`; change that path if your repository has a different name. For a custom domain, use `--base=/`. See the [Vite deployment guide](https://vite.dev/guide/static-deploy#github-pages) for details.

## License

[MIT](LICENSE), copyright 2026 Leo Vinogradov.
