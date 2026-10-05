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

GUI edits rewrite the editor as literal `box(...)` calls. A notice in the inspector explains this, and Undo can return to earlier source. While the editor contains an unrun draft, GUI edits pause so they do not discard that work. Use **＋** in the top header (or Ctrl/Cmd+N) to create a new file tab and choose its type. Use **Open .js** to select one or more files, then choose whether to open them as 3D models or 2D sketches; each opens in its own tab. You can also open more files later without replacing existing tabs. Select a tab and choose **Run** to compile its source. Each tab keeps its own geometry, draft, undo history, selection, and view settings while open. All open files, their drafts, and their last successfully compiled geometry are saved locally and restored on reload; undo history starts fresh after reload. **Save .js** (or Ctrl/Cmd+S) saves the active tab's current source, including any unrun draft. Supported browsers show a native save dialog and return the chosen filename, which updates the tab and source heading and is retained after reload. Other browsers download immediately with the existing filename as a suggestion; the tab name stays unchanged because ordinary downloads do not report the final saved filename. There is no additional in-app filename dialog. Canceling or failing a save keeps the previous name. Close a file with its tab's **×** button; **Save and close** uses the same save flow before removing the tab and its local recovery copy.

## Groups

Choose **Create group** (▱) in the object tree to collect the selected box or sketch shapes; with no selection, it creates an empty group. Use the group's **Members** checkboxes or an object's **Group** selector to add and remove members. Membership changes preserve each object's world position. A selected group can contain another group: **Create group** adds a nested group, and **Parent group** changes its parent without moving it.

The tree's disclosure arrow collapses a group and its children without hiding geometry. Select a group and edit its X/Y/Z position (X/Y in sketches) to move all members and nested groups together. Member coordinates are local to their group. **Ungroup · keep items**, or Delete with a group selected, removes the container while preserving the items and their positions. Group edits participate in undo/redo; groups and collapsed entries survive local recovery.

Drag a component row to rearrange the tree. A line marks insertion before or after a row; dropping onto the middle of a group adds the component to it, including empty or collapsed groups. Groups move with their whole branch, and cannot be dropped into their descendants. The **Move to top level** target appears during dragging and removes group membership. These moves preserve world positions, support undo/redo, and save the tree order locally for each file. Dragging pauses while the source has an unrun draft. Browser dragging, hitboxes, and auto-scrolling use Atlassian Pragmatic Drag and Drop; group transforms and undo remain in the app's model code.

Source defines membership by nesting helper calls in `group(properties, items)`. A group's `position` has three inch values, with Z = 0 in a 2D sketch. IDs must be unique across groups and objects.

```js
group({ id: 'panel', name: 'Panel assembly', position: [12, 0, 0] }, [
  box({ id: 'board', name: 'Board', size: [8, 4, 1], position: [0, 0, 0], color: '#d9a76e' }),
  group({ id: 'detail', name: 'Detail', position: [0, 4, 0] }, [
    box({ id: 'trim', name: 'Trim', size: [8, 1, 1], position: [0, 0, 0], color: '#86a9a3' })
  ])
]);
```

The board's world position is `[12, 0, 0]`. Changing the group position moves its whole branch; positions remain local to the immediate group. Sketch files support the same form with `rectangle(...)` and `line(...)`. Use `group(properties, [])` for an empty group. Items must be values returned by geometry or group helpers; listing one item twice or assigning it to two groups is rejected. The compiler rejects `groupId` and `parentId` properties in source; nesting is the only membership syntax. Inspector selectors, member checkboxes, and tree moves write this same nested format while preserving world positions. Relative box placements can reference boxes in any group. Changing membership, creating groups, and ungrouping preserve those relations and their offset expressions. Relations resolve in world coordinates and keep following reference boxes after regrouping. If a member references a box outside its group, its anchored axes continue to follow that reference when the group moves; unconstrained axes move with the group.

## Add a sketch to a model

Choose **Add sketch** (□) in the model tools to add a finite 2D frame. The inspector sets its width, height, XYZ position, frame color, and normal axis. **X** places width/height along Y/Z, **Y** along X/Z, and **Z** along X/Y. Sketches have no thickness. Their rectangles and lines use coordinates local to that frame; resizing the frame does not scale or clip the shapes.

Use **Reference sketch** to link an open 2D tab's last applied rectangles and lines to the frame. Run any pending draft in that tab before creating the reference. Linking flattens its groups, moves the geometry's minimum corner to the frame origin, and fits the frame to its initial bounds. Later drawing, property changes, group movement, successful source runs, and undo/redo in that tab automatically update every linked model sketch. The initial reference origin stays fixed, so moving shapes moves them inside the model frame. The model's plane, placement, and frame size stay independent of the drawing.

**Edit contents in 2D** opens the linked tab if it is already open, preserving its draft, selection, and undo history. Otherwise it creates a linked sketch tab from the model's current contents. Links survive local workspace recovery. Models also embed their last applied shapes in `sketch(properties, items)`, so saved `.js` files work independently and closing the editor retains the geometry. Choose **No linked tab** to detach a reference. If the model has an unrun source draft, automatic updates change its last applied geometry while preserving the draft text.

Model source saves sketches with the same container syntax as groups:

```js
sketch({
  id: 'panel-drawing', name: 'Panel drawing',
  axis: 'y', size: [12, 8], position: [0, -1, 4], color: '#86a9a3'
}, [
  rectangle({ id: 'outline', size: [12, 8], position: [0, 0] }),
  line({ id: 'diagonal', start: [1, 1], end: [11, 7] })
]);
```

Items must be results of `rectangle(...)` or `line(...)`; each shape belongs to one sketch. Shape IDs are local to their sketch. A sketch can be an item inside `group(properties, items)` alongside boxes and other groups. Its position is then local to that group. Tree selection, visibility, duplication, deletion, grouping, undo/redo, saving, and local recovery all work for model sketches.

## Measurements

Choose **Measure** in either a sketch or model, or press **M**. Click the start corner or edge point, click the end point, then move the mouse to preview the label's offset and click a third time to place it. The third click can be anywhere in the viewport, on either side of the measured points. The dimension has extension lines and an inch label whose physical offset and line height stay fixed while zooming or orbiting. Press **Escape** to cancel an unfinished dimension and finish using the tool. Measurements appear as regular selectable objects in the component tree. Select one to rename it, edit its label offset and line height, assign its group, hide it, duplicate it, or delete it.

Endpoints reference the geometry by ID and a fraction along its edge, so moving or resizing a box, rectangle, line, mounted sketch, or group updates the dimension. Distances use the actual 2D or 3D separation, rounded for display to 1/64 inch. Measurements survive undo/redo, local recovery, and saving/opening source files. Hiding a referenced object hides its dimensions; deleting geometry removes its attached dimensions in the same undoable change.

In 3D, the dimension line follows the actual measured line, including its slope. Choose **Label facing axis** (X, Y, or Z) in the Measure tool or measurement inspector; Z favors facing up. The tool defaults to **Auto**, which chooses the axis most aligned with the viewing direction at the first endpoint: Z from above/below, X from left/right, or Y from front/back. That concrete axis is saved and stays fixed as the camera moves. The label normal is perpendicular to the measured line and aligns with the selected positive axis as closely as possible. If the line is parallel or nearly parallel to that axis, the normal uses the least-aligned world axis, with ties resolved X, then Y, then Z. Reversing endpoints or moving the camera does not change the offset side. A label viewed exactly edge-on hides until the view changes. In 2D sketches, labels follow their measured lines and face Z.

Labels use an SVG overlay so text stays sharp as the view changes. When through mode is off, a saved label hides as a whole if its center is behind opaque geometry; partial label occlusion is approximate. Dimension lines retain WebGL depth testing. In-progress measurements always show through objects.

Measurements can belong to groups for organization. Their group never applies a transform directly: moving a group affects a measurement only when it moves referenced geometry. Regrouping or ungrouping a measurement preserves its endpoints and offset. Grouped source uses `group(properties, [measurement(...)])`, just like other objects.

Source uses `measurement({ id, name, start, end, offset, lineHeight, axis })`, with optional `name`, `offset`, `lineHeight`, and `axis`. Each endpoint has `objectId` and `coordinates`: three fractions for a box, two for a rectangle or sketch frame, or one for a line. Corner coordinates are 0 or 1; an edge has at most one fractional coordinate. For a shape inside a mounted sketch, also include `shapeId`. The third click saves the signed `offset` in inches perpendicular to the measured line within the label surface. The default offset is 2 inches. When `lineHeight` is omitted, its default in inches is `ceil(sqrt(distance) / 4.5)`, clamped from 1 to 3; the distance is recomputed as referenced geometry moves. An explicit positive `lineHeight` stays fixed. Both inspector fields accept decimal or fractional inches, like geometry fields. The renderer derives their projected size; it never stores screen-pixel dimensions. Older local workspaces with pixel offsets recover using the default inch offset on the same side of the dimension. Facing axes are `x`, `y`, or `z`; omitted axes use Z.

```js
// Measure a box's width at its front top edge.
measurement({
  id: 'width',
  axis: 'y',
  offset: inch('6'),
  lineHeight: inch('4'),
  start: { objectId: 'board', coordinates: [0, 0, 1] },
  end: { objectId: 'board', coordinates: [1, 0, 1] }
});
```

## View controls

Drag with the middle mouse button to orbit. Hold Shift while dragging with the middle button, or use the right mouse button, to pan. Scroll the wheel to zoom. The viewport also shows these controls while you work. The toolbar provides isometric, front, right, and top views, perspective or orthographic projection, grid toggle, and fit-to-model. Keyboard shortcuts: **1** front, **3** right, **7** top, **F** fit, and **Delete** remove the selected box. Undo and redo use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z when focus is outside text fields.

3D models contain boxes and mounted sketches; 2D sketch files contain rectangles and lines. Blockwork does not currently create boolean operations or export CAD formats.
