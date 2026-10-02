# Blockwork

Blockwork is a small, code-first 3D modeler for rectangular parts. It runs locally in your browser and stores the current model on this device.

## Run it

```sh
pnpm install
pnpm dev
```

Open the local Vite URL. The editable workbench model is in [examples/workbench.js](examples/workbench.js); choose **Open .js** and select that file to load it directly in the editor and model view. To make a production build, run `pnpm build`.

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

GUI edits rewrite the editor as literal `box(...)` calls. A notice in the inspector explains this, and Undo can return to earlier source. While the editor contains an unrun draft, GUI edits pause so they do not discard that work. Draft source and the last successfully compiled model are saved locally and restored on reload. Use **Open .js** and **Download .js** to move source files in and out.

## View controls

Drag with the middle mouse button to orbit. Hold Shift while dragging with the middle button, or use the right mouse button, to pan. Scroll the wheel to zoom. The viewport also shows these controls while you work. The toolbar provides isometric, front, right, and top views, perspective or orthographic projection, grid toggle, and fit-to-model. Keyboard shortcuts: **1** front, **3** right, **7** top, **F** fit, and **Delete** remove the selected box. Undo and redo use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z when focus is outside text fields.

Blockwork models boxes only. It does not currently create boolean operations or export CAD formats.
