# Blockwork

Blockwork is a small, code-first workshop for 3D models and 2D sketches. It runs locally in your browser and stores open files on this device.

## Run it

```sh
pnpm install
pnpm dev
```

Open the local Vite URL. The editable workbench model is in [examples/workbench.js](examples/workbench.js); choose **Import .js**, select that file, and choose **3D model** to load it in the editor and model view. To make a production build, run `pnpm build`.

## Publish to GitHub Pages

The [deployment workflow](.github/workflows/deploy.yml) builds the app with the `/blockwork/` asset path and publishes `dist` on pushes to `main`.

1. Open [repository Pages settings](https://github.com/leovinogradov/blockwork/settings/pages). Under **Build and deployment → Source**, choose **GitHub Actions**.
2. Commit and push the project changes to `main`.
3. Open [Actions](https://github.com/leovinogradov/blockwork/actions) and wait for **Deploy to GitHub Pages** to finish. Then visit [Blockwork](https://leovinogradov.github.io/blockwork/).

Future pushes to `main` update the site automatically. For a local production preview, run `pnpm build --base=/blockwork/`, then `pnpm exec vite preview --base=/blockwork/` and open `http://localhost:4173/blockwork/`. If the repository name or domain changes, update the build's `--base` value following the [Vite deployment guide](https://vite.dev/guide/static-deploy#github-pages).

## License

[MIT](LICENSE), copyright 2026 Leo Vinogradov.

## Make a 2D sketch

Choose **＋** to create a file or **Import .js** to load one, then select **2D sketch**. A sketch lies on the X/Y plane of a model and uses the same inch grid. Select **Rectangle** (or press **R**, or use the tree's **＋**), click the first corner, then click the opposite corner. A live outline and width/height readout follow the pointer; after the first corner, press Tab to edit width, then Tab again to edit height, and Enter to draw. Both corners snap to visible rectangle corners and edges when the pointer is close; a **CORNER** or **EDGE** marker shows the snap target. Dragging from one corner to the other also works. The tool remains active for another rectangle; press Escape or choose **Select** to finish. Rectangles are outlines by default. The tree and inspector let you duplicate, rename, position, resize, color, hide, and delete rectangles. The sketch view stays top-down and orthographic; middle or right drag to pan and scroll to zoom.

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

Select **Circle** (or press **C**), click its center, then move the cursor to preview the circle and its **radius** in inches. The preview and radius readout follow cursor movement both between clicks and while dragging. Click again to draw, or press Tab to enter an exact radius and Enter to draw. The circle tool remains active for another circle; Escape returns to Select. The inspector edits radius and center coordinates. Changing radius keeps the center fixed. Circle centers and circumference participate in drawing and measurement snapping. Source uses `circle({ id: "hole", radius: inch("1"), position: [0, 0], color: "#ffffff" })`; `position` is the minimum of the circle's bounding square, so this example has center `[1, 1]`. Circles can also be included in mounted sketches.

## Make a model

The source editor accepts JavaScript using `inch(value)` to parse an inch value or arithmetic expression and `box(spec)` to add one rectangular part. Add reusable numeric dimensions with `variable({ name, value })`; use `var(name)` anywhere an inch-valued numeric field is accepted. Dimensions snap to the nearest 1/64 inch after evaluation. The axes are X for width, Y for depth, and Z for height; `position` is the part's minimum corner. Inspector dimension fields accept `+`, `-`, `*`, `/`, and parentheses too.

```js
variable({ name: 'boardWidth', value: inch('20 - 3/4'), description: 'Finished width of the tabletop' });

box({
  id: 'top',
  name: 'Work surface',
  size: [inch('48'), inch('24'), inch('3/4')],
  position: [inch('0'), inch('0'), inch('34')],
  color: '#b8875a'
});
```

Any numeric box field can use a variable expression, including sizes, absolute position, and relative placement offsets. For example, write `size: [ 'var(boardWidth)', inch('24'), inch('3/4') ]`. The inspector keeps variable expressions visible while showing the resolved inch value in the field tooltip. Typing an unknown `var(name)` prompts you to create the variable and enter its initial value in one edit. Variable edits update all dependent geometry together; cyclic or invalid values are rejected without changing the model. GUI edits retain these expressions and serialize the variable declarations into the source.

Variables accept an optional string `description`. Add it in the variable creation dialog or edit it in the inspector; clearing the field removes it. Descriptions are retained in saved documents and generated JavaScript.

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

`boxId` names the reference box; `face` can be `front`, `back`, `left`, `right`, `top`, or `bottom`. The absolute minimum-corner position is shown in the inspector as a read-only value while linked. The inspector names edges by their world direction on the selected face (for example, Bottom Z- offers Left X-/Right X+ and Front Y-/Back Y+). Positive edge offsets move inward from the named edge. Right-click a box face and choose **Duplicate** to copy it, or **New box from face** / **New cylinder from face** to create a touching component; then edit its face and offsets in the inspector. New cylinders default to extending outward perpendicular to the selected face. Deleting a reference box detaches its direct dependents at their current absolute positions.

Use `color: 'transparent'` for the preset translucent face color, or use an alpha color such as `#d9a76e80` or `rgba(217, 167, 110, 0.5)` for custom opacity. The inspector's custom color picker includes an alpha control.

Change the source and choose **Run** (or press Ctrl/Cmd+Enter) to compile it. The previous model stays visible when the source has an error. The compiler runs in a disposable Web Worker with a short timeout. This keeps an accidental infinite loop from freezing the interface; it is not a security sandbox for untrusted JavaScript. Only open source you trust.

GUI edits rewrite the editor as literal `box(...)` calls. A notice in the inspector explains this, and Undo can return to earlier source. While the editor contains an unrun draft, GUI edits pause so they do not discard that work. After editing a tab, choose **Run** (or Ctrl/Cmd+Enter) to apply its source changes.

Use **＋** in the top header (or Ctrl/Cmd+N) to create a file and choose its type. **Files** opens the browser library: reopen files, create folders, rename, move, or delete entries. Folder arrows expand and collapse their indented contents, like groups in the object tree. Select a folder to create or import items inside it; choose **All files** for the library root. Drag files or folders between rows to reorder, onto a folder to move into it, or onto a breadcrumb to move up. Dropping into a collapsed folder expands it. The arrangement and collapsed folders survive reloads and library backups. Names do not need an extension. Rename an open file by double-clicking its tab, clicking its name above the source editor, or pressing F2 outside a text field. Names are unique within each folder, ignoring case. Renaming and moving preserve file IDs and sketch links. A folder must be empty before it can be deleted.

**Import .js** selects one or more files from your computer, then asks whether each is a 3D model or 2D sketch. Imports create browser copies; there is no ongoing connection to the disk files. A file with the same name, type, and current source in the destination folder reopens the existing browser file. Different contents or types offer **Keep both**, **Replace browser file**, or **Cancel**, with **Compare source** to inspect both texts. Keep both creates a separate file with an imported suffix; replacement retains the existing file ID.

The library uses IndexedDB, with separate file, folder, and workspace records. Changes autosave after a 350 ms pause; only changed file records are rewritten. Drafts, last successfully compiled geometry, names, view settings, and model/sketch links survive reloads. Undo history starts fresh after reload. Close a tab with **×** to keep its file and draft in the library; closing the last tab leaves an empty workspace. Right-click **×** for an optional **Export and close** flow. Existing localStorage recovery is migrated on first use, retaining its original snapshot as a fallback copy.

**Export → Blockwork .js** (or Ctrl/Cmd+S) exports the active file’s current source, including unrun drafts, as `name.js`. Supported browsers show a native save dialog; other browsers download the file. Exporting leaves the browser filename unchanged and does not retain a disk file handle. **Back up library** in Files downloads a JSON backup containing all files, including closed files, drafts, folders, geometry, and open-tab state. **Restore backup** validates a backup and asks before replacing the browser library. Browser storage is specific to the site’s origin; export or back up work before clearing site data.

The file manager depends on the `LibraryStorage` interface in [src/library-storage.ts](src/library-storage.ts). `FileLibrary` manages serialization, migration, changed records, and ordered saves; `IndexedDBStorage` provides the current backend. Another adapter can implement asynchronous `read` and atomic `write` operations without changing the editor or Files UI. Per-record revision counters prevent stale writes from other windows; they do not retain version history. Storage failures keep work in memory and show **Not saved**, so it can still be exported or backed up. Browser UI checks are available at [tests/file-library-ui.html](tests/file-library-ui.html) while the development server is running; that page uses a private test database.

Choose **Add cylinder** in the 3D tools, enter its **radius** and **length**, then add it. Choose **Length axis** (X, Y, or Z) to set the direction of its length; Z is the default. The inspector can change this axis while retaining the radius, length, expressions, and attached measurements. Cylinders share the existing inspector, grouping, duplication, undo, and save controls. Source uses `cylinder({ id: "post", radius: inch("2"), length: inch("12"), axis: "z", position: [0, 0, 0] })`. Its position is the minimum of its bounding box. Both circular end centers are measurement snap points, along with the rims. End centers can snap through their own cylinder, but another visible solid in front of the point blocks that snap. Among nearby 3D references, the point closest to the camera takes priority.

## Groups

Choose **Create group** (▱) in the object tree to collect the selected box or sketch shapes; with no selection, it creates an empty group. Use the group's **Members** checkboxes or an object's **Group** selector to add and remove members. Membership changes preserve each object's world position. A selected group can contain another group: **Create group** adds a nested group, and **Parent group** changes its parent without moving it.

The tree's disclosure arrow collapses a group and its children without hiding geometry. Select a group and edit its X/Y/Z position (X/Y in sketches) to move all members and nested groups together. Member coordinates are local to their group. **Ungroup · keep items**, or Delete with a group selected, removes the container while preserving the items and their positions. Group edits participate in undo/redo; groups and collapsed entries survive local recovery.

Use the eye button on a group row to hide or show its entire branch, including nested groups and measurements. Showing a group restores each member's own visibility setting; while a parent is hidden, its descendants' eye buttons are disabled. Select a group and choose **Duplicate selected** (⧉) in the inspector to copy its complete branch beside the original, offset by 1 inch in X and Y. Copies retain member names, tree order, visibility, and internal box and measurement references; references outside the branch stay linked to the original objects. Both actions support undo/redo and local recovery in 3D models and 2D sketches.

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

The board's world position is `[12, 0, 0]`. Changing the group position moves its whole branch; positions remain local to the immediate group. Sketch files support the same form with `rectangle(...)`, `circle(...)` and `line(...)`. Use `group(properties, [])` for an empty group. Items must be values returned by geometry or group helpers; listing one item twice or assigning it to two groups is rejected. The compiler rejects `groupId` and `parentId` properties in source; nesting is the only membership syntax. Inspector selectors, member checkboxes, and tree moves write this same nested format while preserving world positions. Relative box placements can reference boxes in any group. Changing membership, creating groups, and ungrouping preserve those relations and their offset expressions. Relations resolve in world coordinates and keep following reference boxes after regrouping. If a member references a box outside its group, its anchored axes continue to follow that reference when the group moves; unconstrained axes move with the group.

## Add a sketch to a model

Choose **Add sketch** (□) in the model tools to add a finite 2D frame. The inspector sets its width, height, XYZ position, frame color, and normal axis. **X** places width/height along Y/Z, **Y** along X/Z, and **Z** along X/Y. Sketches have no thickness. Their rectangles and lines use coordinates local to that frame; resizing the frame does not scale or clip the shapes.

Use **Reference sketch** to link an open 2D tab's last applied rectangles and lines to the frame. Run any pending draft in that tab before creating the reference. Linking flattens its groups, moves the geometry's minimum corner to the frame origin, and fits the frame to its initial bounds. Later drawing, property changes, group movement, successful source runs, and undo/redo in that tab automatically update every linked model sketch. The initial reference origin stays fixed, so moving shapes moves them inside the model frame. The model's plane, placement, and frame size stay independent of the drawing.

**Edit contents in 2D** reopens the linked browser file, preserving its draft, selection, and undo history. If no linked file exists, it creates one from the model's current contents. Links survive local workspace recovery. Models also embed their last applied shapes in `sketch(properties, items)`, so saved `.js` files work independently and closing the editor retains the geometry. Choose **No linked tab** to detach a reference. If the model has an unrun source draft, automatic updates change its last applied geometry while preserving the draft text.

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

Items must be results of `rectangle(...)`, `circle(...)` or `line(...)`; each shape belongs to one sketch. Shape IDs are local to their sketch. A sketch can be an item inside `group(properties, items)` alongside boxes and other groups. Its position is then local to that group. Tree selection, visibility, duplication, deletion, grouping, undo/redo, saving, and local recovery all work for model sketches.

## Measurements

Choose **Measure** in either a sketch or model, or press **M**. Click the start corner or edge point, click the end point, then move the mouse to preview the label's offset and click a third time to place it. The third click can be anywhere in the viewport, on either side of the measured points. The dimension has extension lines and an inch label whose physical offset and line height stay fixed while zooming or orbiting. Press **Escape** to cancel an unfinished dimension and finish using the tool. Measurements appear as regular selectable objects in the component tree. Select one to rename it, edit its label offset and line height, assign its group, hide it, duplicate it, or delete it.

Press **Shift** while using Measure to toggle **Axis distance** on or off. The current state appears beside the measure instructions. With axis distance on, measurements use only the largest absolute world-axis difference (X, Y, or Z), with ties choosing X, then Y, then Z. The solid dimension line follows that axis through the first endpoint; dashed connectors join both actual geometry points to the dimension line. For example, points (0, 1) and (2, 0) measure 2 along X, with the unoffset solid line from (0, 1) to (2, 1). Label offset moves this line perpendicular to the axis, just like a normal measurement, and the third click places it. Alignment follows the world-origin axes regardless of the camera or label facing axis. The endpoints remain attached to the actual picked corners or edges. Each Shift press toggles the mode and updates the preview without moving the mouse; releasing or holding the key does not change it. The mode stays selected for subsequent measurements and when re-entering Measure. Shift does not toggle the mode while typing in a field. The axis chosen at the second click is saved; later geometry edits update the distance along that same axis.

Endpoints reference the geometry by ID and a fraction along its edge, so moving or resizing a box, rectangle, line, mounted sketch, or group updates the dimension. Ordinary distances use the actual 2D or 3D separation; Shift measurements use the saved axis difference, rounded for display to 1/64 inch. Measurements survive undo/redo, local recovery, and saving/opening source files. Hiding a referenced object hides its dimensions; deleting geometry removes its attached dimensions in the same undoable change.

In 3D, the dimension line follows the actual measured line, including its slope. Choose **Label facing axis** (X, Y, or Z) in the Measure tool or measurement inspector; Z favors facing up. The tool defaults to **Auto**, which chooses the axis most aligned with the viewing direction at the first endpoint: Z from above/below, X from left/right, or Y from front/back. That concrete axis is saved and stays fixed as the camera moves. The label normal is perpendicular to the measured line and aligns with the selected positive axis as closely as possible. If the line is parallel or nearly parallel to that axis, the normal uses the least-aligned world axis, with ties resolved X, then Y, then Z. Reversing endpoints or moving the camera does not change the offset side. A label viewed exactly edge-on hides until the view changes. In 2D sketches, labels follow their measured lines and face Z.

Labels use an SVG overlay so text stays sharp as the view changes. When through mode is off, a saved label hides as a whole if its center is behind opaque geometry; partial label occlusion is approximate. Dimension lines retain WebGL depth testing. In-progress measurements always show through objects.

Measurements can belong to groups for organization. Their group never applies a transform directly: moving a group affects a measurement only when it moves referenced geometry. Regrouping or ungrouping a measurement preserves its endpoints and offset. Grouped source uses `group(properties, [measurement(...)])`, just like other objects.

Source uses `measurement({ id, name, start, end, offset, lineHeight, axis, distanceAxis })`, with optional `name`, `offset`, `lineHeight`, `axis`, and `distanceAxis`. `distanceAxis` saves the measured world axis (`x`, `y`, or `z`); omit it for the full point-to-point distance. It is independent of the label facing `axis`. Each endpoint has `objectId` and `coordinates`: three fractions for a box or cylinder, two for a rectangle, circle or sketch frame, or one for a line. Corner coordinates are 0 or 1; an edge has at most one fractional coordinate. Circle center coordinates are `[0.5, 0.5]`; cylinder end centers have 0 or 1 on the length axis and 0.5 on both radial axes (for Z, `[0.5, 0.5, 0]` and `[0.5, 0.5, 1]`). Rim coordinates lie on a circle of radius 0.5 around `[0.5, 0.5]` in the radial plane, with the length coordinate fixed to 0 or 1. For a shape inside a mounted sketch, also include `shapeId`. The third click saves the signed `offset` in inches perpendicular to the measured line within the label surface. The default offset is 2 inches. When `lineHeight` is omitted, its default in inches is `ceil(sqrt(distance) / 4.5)`, clamped from 1 to 3; the distance is recomputed as referenced geometry moves. An explicit positive `lineHeight` stays fixed. Both inspector fields accept decimal or fractional inches, like geometry fields. The renderer derives their projected size; it never stores screen-pixel dimensions. Older local workspaces with pixel offsets recover using the default inch offset on the same side of the dimension. Facing axes are `x`, `y`, or `z`; omitted axes use Z.

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

Measurement labels are clipped to the camera view, including in THROUGH mode. Labels crossing the camera's depth clipping planes or becoming nearly edge-on hide briefly and return when the view permits. See [Measurement label clipping](docs/measurement-label-clipping.md) for the perspective distortion fix and regression checks.

| Input | 3D model | 2D sketch (Select tool) |
| --- | --- | --- |
| Left-click | Select one item; click empty space to clear selection | Same |
| Left-click and drag | Select items overlapping the dragged area | Same |
| Shift + left-drag | Add the dragged area to the current selection | Same |
| Shift + left-click | Add or remove an item | Same |
| Middle-click and drag / two-finger touchpad drag configured as middle click | Rotate (orbit) | Pan |
| Right-click and drag | Pan | Pan |
| Shift + middle-drag | Pan | Pan |
| Scroll wheel | Zoom toward the cursor | Same |
| Escape | Clear selection | Clear selection or return to the Select tool |

For two-finger touchpad rotation in 3D, configure the gesture to send the middle mouse button. A two-finger secondary click that sends the right mouse button pans. A stationary right-click on a 3D box face opens its actions menu.

Area selection works in either drag direction and excludes hidden items. In 3D it selects boxes, cylinders and mounted sketches; in 2D it selects rectangles, circles and lines. Selected components are highlighted in the viewport and tree. The shared selection inspector shows mixed or common colors and applies a palette or custom color to every selected component. You can also group, duplicate, or delete the selection together. Source drafts disable these edits until you run the code.

The viewport displays the current controls while you work. The toolbar provides isometric, front, right, and top views, perspective or orthographic projection, grid toggle, and fit-to-model. Keyboard shortcuts: **1** front, **3** right, **7** top, **F** fit, and **Delete** remove the selected components. Undo and redo use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z when focus is outside text fields.

3D models contain boxes, cylinders and mounted sketches; 2D sketch files contain rectangles, circles and lines. Blockwork does not currently create boolean operations or export CAD formats.

## Export to Blender

Choose **Export → .glb** in a 3D model, then import the downloaded file in Blender with **File → Import → glTF 2.0 (.glb/.gltf)**. **Export → Blockwork .js** saves the editable source, including an unrun draft; Ctrl/Cmd+S also exports the source. GLB export uses the last successfully applied model; an unrun source draft is excluded and reported in the export status. Hidden parts and descendants of hidden groups are excluded. Boxes and cylinders retain their names, nested group hierarchy, colors, opacity, and physical dimensions. Inches are converted to meters and Z-up coordinates to glTF's Y-up coordinates.

Sketches and measurement annotations are excluded and reported when present. Dimensions, expressions, placement relationships, and variables are stored as `blockwork` custom metadata in their original inch units; they do not become live Blender constraints. Cylinders use 96 radial segments by default.

The export implementation is encapsulated in `src/glb-export.ts`: `exportModelGlb(model, { name, hiddenIds, cylinderSegments })` accepts model data and returns an `ArrayBuffer`, filename, solid count, and exclusion warnings. It builds and disposes a separate Three.js scene without accessing the viewport, editor, or browser download controls. The UI loads this module only when exporting.

## CSV cutlist

Choose **Export → CSV cutlist** in a 3D model. The modal starts with a maximum thickness of **3 inches** and updates its ignored-component list as you change the limit. Thickness is the smallest box dimension; boxes exactly at the limit are included. Inch fractions such as `3 1/2` are accepted. Each ignored box shows its full group path and thickness; cylinders and mounted sketches are listed with their exclusion reasons. Export is disabled for invalid limits or when no boxes qualify.

The CSV contains **Item No.**, **Component**, **Quantity**, **Length (in)**, **Width (in)**, and **Thickness (in)**. Each box gets its own row with quantity 1 and a component name such as `Cabinet > Interior > Shelf`. Rows follow the component tree order, expanding nested groups at their position in the tree; moving a component or group changes its export position without rerunning the source. The ignored-component list follows the same order. Length is the largest dimension, width the middle dimension, and thickness the smallest; dimensions are numeric decimal inches. Hidden boxes and boxes in collapsed groups are included. The cutlist uses applied geometry, excludes unrun source drafts and measurement annotations, and downloads as `name-cutlist.csv` without changing the model or source. Browser checks are available at [tests/cutlist-export-ui.html](tests/cutlist-export-ui.html).

## Parts

Select solid subcomponents and choose **Combine into a Part** in the selection inspector. Give the manufactured piece a name. To convert an existing group, select it and choose **Make a Part**; move any nested groups or Parts out first. Parts can be inside ordinary groups, and contain boxes, cylinders, and construction sketches or measurements directly. Ordinary objects' membership selectors list only groups; add subcomponents to Parts through the tree or the Part inspector.

A Part appears like a normal object in the tree, with its color and a small **PART** subtitle beneath the name. Disconnected Parts show their body count in the subtitle. A small triangle beside the **PART** subtitle expands or collapses its subcomponents. Subcomponents have neutral icons and no individual visibility toggles. The inspector displays subcomponent names as `Part Name > subcomponent name`; tree rows and viewport labels keep the short subcomponent name; their stored names remain local, so renaming the Part updates inspector paths. Solid subcomponent names are optional: clear the name to display only the Part name. Dissolving or removing an unnamed subcomponent gives the separate piece its former Part name. Select a Part to see its overall dimensions and subcomponents, move its origin, or add a box subcomponent. Adding boxes or cylinders with the Part selected puts them inside it. Membership selectors and tree dragging preserve world positions. Color and visibility belong to the Part. Its color controls update every solid subcomponent, and source stores color only on `part(...)`. The Part eye toggle hides or shows its whole body. Parts support duplication, undo/redo, and local recovery. **Dissolve Part · keep subcomponents** removes the Part while retaining its geometry.

When inspecting a subcomponent, a card at the bottom shows its owning Part instead of a group/Part selector. Click the Part name to inspect it, use **Remove** to detach the component while preserving its world position and material, or choose **Part Material** to change the whole Part while keeping the subcomponent selected. Removal and material changes support undo/redo.

A Part represents one connected body. Overlapping solids or solids sharing positive face area connect; edge or point contact does not. Disconnected geometry remains editable with a body warning. Empty or disconnected Parts appear in the cutlist's ignored list, without exporting their subcomponents separately. Connected Parts export one row at their tree position, named by the full group path; stock length, width and thickness come from the overall axis-aligned bounds. The thickness limit applies to the whole Part. Sketches and measurements add no material. The preview and GLB retain editable primitive meshes; Parts do not yet perform mesh boolean unions or cuts.

```js
part({ id: 'mc1', name: 'MC1', color: '#d9a76e', position: [0, 0, 0] }, [
  box({ id: 'panel', name: 'Panel', size: [0.75, 20, 83.25], position: [0, 0, 0] }),
  box({ id: 'top', name: 'Top', size: [0.75, 8, 11.5], position: [0, 0, 83.25] })
]);
```

This describes a notched piece whose cutlist stock dimensions are 94.75 × 20 × 0.75 inches. Browser checks are available at [tests/parts-ui.html](tests/parts-ui.html).
