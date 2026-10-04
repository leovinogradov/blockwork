# Blockwork

Blockwork is a small, code-first workshop for 3D models and 2D sketches. It runs locally in your browser and stores open files on this device.

## Run it

```sh
pnpm install
pnpm dev
```

Open the local Vite URL. The editable workbench model is in [examples/workbench.js](examples/workbench.js); choose **Open .js**, select that file, and choose **3D model** to load it in the editor and model view. To make a production build, run `pnpm build`.

## Make a 2D sketch

Choose **＋** to create a file or **Open .js** to load one, then select **2D sketch**. A sketch lies on the X/Y plane of a model and uses the same inch grid. Select **Rectangle** (or press **R**, or use the tree's **＋**), click the first corner, then click the opposite corner. A live outline and width/height readout follow the pointer; after the first corner, press Tab to edit width, then Tab again to edit height, and Enter to draw. Both corners snap to visible rectangle corners and edges when the pointer is close; a **CORNER** or **EDGE** marker shows the snap target. Dragging from one corner to the other also works. The tool remains active for another rectangle; press Escape or choose **Select** to finish. Rectangles are outlines by default. The tree and inspector let you duplicate, rename, position, resize, color, hide, and delete rectangles. The sketch view stays top-down and orthographic; middle or right drag to pan and scroll to zoom.

In **Select** mode, click a shape to select it. **Shift/Ctrl/Cmd-click** adds or removes shapes, and dragging a selection box selects intersecting shapes. Hold a selection modifier while dragging to add to the current selection. The inspector lists every selected component and offers a shared stroke color; **Mixed colors** means the selected shapes have different colors. Choosing a palette or custom color updates all selected shapes in one undoable edit. Duplicate and Delete apply to the entire selection. Click empty space or press Escape to clear it.

Sketch source uses `rectangle(spec)` with two-value `size` and `position` arrays. Run it with **Run** or Ctrl/Cmd+Enter. A sketch tab keeps its source, rectangles, undo history, and view state independently while open; local recovery preserves its source and last good geometry across reloads.

To draw a line, choose **Line** or press **L**, click its start point, then click its end point. A live segment follows the pointer; dragging between the two points also works. Both points snap to visible rectangle edges/corners and line endpoints/segments. After the start point, Tab moves through **Length**, **Angle**, **ΔX**, and **ΔY**, in that order. Editing either pair updates the other pair and the live preview. Length is in inches; angle is in degrees from the horizontal through the start point: 0° to 180° clockwise and 0° to −180° counterclockwise (0° right, +90° down, −90° up). The dashed reference and arc show that angle. Enter draws the line; its endpoints retain the 1/64 inch grid. Use Escape to return to Select. Lines can be selected, renamed, recolored, hidden, duplicated, deleted, and undone like rectangles. Their inspector edits Length, Angle, ΔX, and ΔY; changing length or angle keeps the start point fixed. Expand **Coordinates** to edit start and end points.

Line source uses `line({ start: [0, 0], end: [12, 8], color: "#d9a76e" })`. Lines and rectangles share a sketch's source, undo history, and local recovery.

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

## Groups

Choose **Create group** (▱) in the object tree to collect the selected box or sketch shapes; with no selection, it creates an empty group. Use the group's **Members** checkboxes or an object's **Group** selector to add and remove members. Membership changes preserve each object's world position. A selected group can contain another group: **Create group** adds a nested group, and **Parent group** changes its parent without moving it.

The tree's disclosure arrow collapses a group and its children without hiding geometry. Select a group and edit its X/Y/Z position (X/Y in sketches) to move all members and nested groups together. Member coordinates are local to their group. **Ungroup · keep items**, or Delete with a group selected, removes the container while preserving the items and their positions. Group edits participate in undo/redo; groups and collapsed entries survive local recovery.

Source declares groups with `group(spec)` and connects objects using `groupId`. A group's `position` has three inch values, with Z = 0 in a 2D sketch. Use `parentId` to nest groups. IDs must be unique across groups and objects.

```js
group({ id: 'panel', name: 'Panel assembly', position: [12, 0, 0] });
box({ id: 'board', name: 'Board', groupId: 'panel', size: [8, 4, 1], position: [0, 0, 0], color: '#d9a76e' });
```

This board's world position is `[12, 0, 0]`. Changing the group position moves the board while its local position remains `[0, 0, 0]`. Lines and rectangles use the same `groupId` in sketch files. Face-linked boxes must share a group; moving a linked box into a different group detaches links that cross the group boundary at their current positions.

The shared group module provides plane frames, box-face frames, and a local-point mapping for future sketch containers on planes or box faces. Sketch mounting in a 3D model is not yet exposed in the UI.

## View controls

Drag with the middle mouse button to orbit. Hold Shift while dragging with the middle button, or use the right mouse button, to pan. Scroll the wheel to zoom. The viewport also shows these controls while you work. The toolbar provides isometric, front, right, and top views, perspective or orthographic projection, grid toggle, and fit-to-model. Keyboard shortcuts: **1** front, **3** right, **7** top, **F** fit, and **Delete** remove the selected box. Undo and redo use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z when focus is outside text fields.

3D models contain boxes and 2D sketches contain rectangles and lines. Blockwork does not currently copy sketches into models, create boolean operations, or export CAD formats.
