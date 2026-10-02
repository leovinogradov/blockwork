# Blockwork

Blockwork is a small, code-first workshop for 3D models and 2D sketches. It runs locally in your browser and stores open files on this device.

## Run it

```sh
pnpm install
pnpm dev
```

Open the local Vite URL. The editable workbench model is in [examples/workbench.js](examples/workbench.js); choose **Open .js**, select that file, and choose **3D model** to load it in the editor and model view. To make a production build, run `pnpm build`.

## Make a 2D sketch

Choose **＋** to create a file or **Open .js** to load one, then select **2D sketch**. A sketch lies on the X/Y plane of a model and uses the same inch grid. Select **Rectangle** (or press **R**, or use the tree's **＋**), click the first corner, then click the opposite corner. A live outline and width/height readout follow the pointer; you can enter exact dimensions and press Enter instead of choosing the second corner. Dragging from one corner to the other also works. The tool remains active for another rectangle; press Escape or choose **Select** to finish. Rectangles are outlines by default. The tree and inspector let you duplicate, rename, position, resize, color, hide, and delete rectangles. The sketch view stays top-down and orthographic; drag in Select mode to pan and scroll to zoom.

Sketch source uses `rectangle(spec)` with two-value `size` and `position` arrays. Run it with **Run** or Ctrl/Cmd+Enter. A sketch tab keeps its source, rectangles, undo history, and view state independently while open; local recovery preserves its source and last good geometry across reloads.

```js
rectangle({
  id: 'outline',
  name: 'Panel outline',
  size: [inch('12'), inch('8')],
  position: [inch('0'), inch('0')],
  color: '#d9a76e'
});
```

## Make a model

The source editor accepts JavaScript using `inch(value)` to parse an inch value or arithmetic expression and `box(spec)` to add one rectangular part. Add reusable numeric dimensions with `variable({ name, value })`; use `var(name)` anywhere an inch-valued numeric field is accepted. Dimensions snap to the nearest 1/64 inch after evaluation. The axes are X for width, Y for depth, and Z for height; `position` is the part's minimum corner. Inspector dimension fields accept `+`, `-`, `*`, `/`, and parentheses too.

```js
variable({ name: 'boardWidth', value: inch('20 - 3/4') });

box({
  id: 'top',
  name: 'Work surface',
  size: [inch('48'), inch('24'), inch('3/4')],
  position: [inch('0'), inch('0'), inch('34')],
  color: '#b8875a'
});
```

Any numeric box field can use a variable expression, including sizes, absolute position, and relative placement offsets. For example, write `size: [ 'var(boardWidth)', inch('24'), inch('3/4') ]`. The inspector keeps variable expressions visible while showing the resolved inch value in the field tooltip. Typing an unknown `var(name)` prompts you to create the variable and enter its initial value in one edit. Variable edits update all dependent geometry together; cyclic or invalid values are rejected without changing the model. GUI edits retain these expressions and serialize the variable declarations into the source.

Boxes can also be placed relative to a face. For example, this places a 3/4-inch-thick panel on the top of `top`, aligned to its left and bottom edges:

```js
box({
  id: 'upright',
  name: 'Upright panel',
  size: [inch('48'), inch('24'), inch('3/4')],
  position: [inch('0'), inch('0'), inch('34 3/4')], // resolved from the relation below
  color: '#8798b5',
  relative: {
    boxId: 'top',
    face: 'top',
    offset: inch('0'),
    u: { side: 'left', offset: inch('0') },
    v: { side: 'bottom', offset: inch('0') }
  }
});
```

`boxId` names the reference box; `face` can be `front`, `back`, `left`, `right`, `top`, or `bottom`. The absolute minimum-corner position is shown in the inspector as a read-only value while linked. Positive side offsets move inward from the selected side when viewed from outside the face. Right-click a box face and choose **Duplicate** to copy it, or **New box from face** to create a touching box; then edit its face and offsets in the inspector. Deleting a reference box detaches its direct dependents at their current absolute positions.

Use `color: 'transparent'` for the preset translucent face color, or use an alpha color such as `#d9a76e80` or `rgba(217, 167, 110, 0.5)` for custom opacity. The inspector's custom color picker includes an alpha control.

Change the source and choose **Run** (or press Ctrl/Cmd+Enter) to compile it. The previous model stays visible when the source has an error. The compiler runs in a disposable Web Worker with a short timeout. This keeps an accidental infinite loop from freezing the interface; it is not a security sandbox for untrusted JavaScript. Only open source you trust.

GUI edits rewrite the editor as literal `box(...)` calls. A notice in the inspector explains this, and Undo can return to earlier source. While the editor contains an unrun draft, GUI edits pause so they do not discard that work. Use **＋** in the top header (or Ctrl/Cmd+N) to create a new file tab and choose its type. Use **Open .js** to select one or more files, then choose whether to open them as 3D models or 2D sketches; each opens in its own tab. You can also open more files later without replacing existing tabs. Select a tab and choose **Run** to compile its source. Each tab keeps its own geometry, draft, undo history, selection, and view settings while open. All open files, their drafts, and their last successfully compiled geometry are saved locally and restored on reload; undo history starts fresh after reload. **Download .js** downloads the active tab. Close a file with its tab's **×** button; **Save and close** downloads its current source as a `.js` file before removing the tab and its local recovery copy.

## View controls

Drag with the middle mouse button to orbit. Hold Shift while dragging with the middle button, or use the right mouse button, to pan. Scroll the wheel to zoom. The viewport also shows these controls while you work. The toolbar provides isometric, front, right, and top views, perspective or orthographic projection, grid toggle, and fit-to-model. Keyboard shortcuts: **1** front, **3** right, **7** top, **F** fit, and **Delete** remove the selected box. Undo and redo use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z when focus is outside text fields.

3D models contain boxes and 2D sketches contain rectangles. Blockwork does not currently copy sketches into models, create boolean operations, or export CAD formats.
