// Compact workbench with a simple cabinet base.
const topThickness = inch('3/4');
const panel = inch('3/4');
const width = inch('48');
const depth = inch('24');
const height = inch('34');
const topColor = '#b8875a';
const frameColor = '#687b86';

// Work surface
box({ id: 'top', name: 'Work surface', size: [width, depth, topThickness], position: [0, 0, height], color: topColor });

// Two side panels and a lower shelf
box({ id: 'left-side', name: 'Left side', size: [panel, depth, height], position: [0, 0, 0], color: frameColor });
box({ id: 'right-side', name: 'Right side', size: [panel, depth, height], position: [width - panel, 0, 0], color: frameColor });
box({ id: 'shelf', name: 'Lower shelf', size: [width - panel * 2, depth - panel, panel], position: [panel, 0, inch('5')], color: frameColor });

// Back stretcher and two front legs
box({ id: 'back-stretcher', name: 'Back stretcher', size: [width - panel * 2, panel, inch('4')], position: [panel, depth - panel, inch('5')], color: frameColor });
box({ id: 'left-leg', name: 'Left front leg', size: [panel, panel, inch('5')], position: [panel, 0, inch('29')], color: frameColor });
box({ id: 'right-leg', name: 'Right front leg', size: [panel, panel, inch('5')], position: [width - panel * 2, 0, inch('29')], color: frameColor });
