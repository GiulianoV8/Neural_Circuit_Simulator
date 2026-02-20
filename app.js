// === GLOBAL VARIABLES ===
let neurons = [];
let stimulators = [];
let outputs = []; // Array of OutputDisplay objects
let probes = []; // Array of OscilloscopeProbe objects
let notes = []; // Array of Note objects
let synapses = [];
let mode = 'move'; // 'move', 'neuron', 'synapse', 'stimulator', 'button', 'output', 'probe', 'note', 'gate'
let isPlaying = true;
let selectedElement = null; // Neuron, Synapse, Stimulator, ManualButton
let buttons = []; // Array of ManualButton objects
let tempConnectionStart = null; // For drag-creating synapses
let noteSelection = []; // Temporary array for selecting neurons for a new note

// Multi-select
let multiSelection = []; // Array of selected elements (neurons, stimulators, outputs)
let selectionBox = null; // { startX, startY, endX, endY } for rubber-band
let clipboard = null; // Serialized circuit fragment for copy/paste
let isMultiDragging = false;
let multiDragStart = null;

let simTime = 0;
let simSpeed = 1;

// Viewport
let viewOffset = { x: 0, y: 0 };
let zoomLevel = 1.0;
let isPanning = false;
let lastMouse = { x: 0, y: 0 };

// Helper: convert screen coordinates to world coordinates (accounts for pan + zoom)
function screenToWorld(sx, sy) {
    return {
        x: (sx - viewOffset.x) / zoomLevel,
        y: (sy - viewOffset.y) / zoomLevel
    };
}

// Colors
const C_BG = [15, 23, 42];
const C_GRID = [30, 41, 59];
const C_NEURON_BASE = [30, 41, 59];
const C_NEURON_STROKE = [148, 163, 184];
const C_SPIKE = [255, 255, 255];
const C_EXC = [34, 197, 94]; // Green
const C_INH = [239, 68, 68]; // Red
const C_ACCENT = [56, 189, 248];

// === P5.JS SETUP & DRAW ===

function setup() {
    let canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');
    frameRate(60);

    // Initial Demo
    loadPreset('oscillator');
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

function draw() {
    background(C_BG);
    background(C_BG);

    push();
    translate(viewOffset.x, viewOffset.y);
    scale(zoomLevel);

    drawGrid();

    // Physics Update (Multiple steps for stability if speed > 1)
    if (isPlaying) {
        for (let k = 0; k < simSpeed; k++) {
            updateSimulation();
        }
    }

    // Draw Synapses
    for (let s of synapses) {
        s.display();
    }

    // Draw Drag Line for new connection
    if (mode === 'synapse' && tempConnectionStart) {
        stroke(255, 255, 255, 100);
        strokeWeight(2);
        // Mouse coordinates need adjustment? No, waiting for pop() or adjusting here.
        // Actually, we are inside push/pop, so we can use logical coordinates?
        // Wait, line() draws in transformed space. mouseX/Y are screen space.
        // We need transformed mouse coordinates.
        let mx = (mouseX - viewOffset.x) / zoomLevel;
        let my = (mouseY - viewOffset.y) / zoomLevel;
        line(tempConnectionStart.x, tempConnectionStart.y, mx, my);
    }

    // Draw Neurons
    for (let n of neurons) {
        n.display();
    }

    // Draw Stimulators
    for (let s of stimulators) {
        s.display();
    }

    // Draw Buttons
    for (let b of buttons) {
        b.display();
    }

    // Draw Outputs
    for (let o of outputs) {
        o.display();
    }

    // Draw Notes
    for (let n of notes) {
        n.display();
    }

    // Draw Probes
    for (let p of probes) {
        p.display();
    }

    // Draw Temp Note Selection
    if (mode === 'note' && noteSelection.length > 0) {
        noFill();
        stroke(255, 204, 0); // Gold
        strokeWeight(2);
        for (let n of noteSelection) {
            circle(n.x, n.y, n.r * 2 + 15);
        }
    }

    // Draw Multi-Selection highlights
    if (multiSelection.length > 0) {
        noFill();
        stroke(56, 189, 248, 180);
        strokeWeight(2);
        drawingContext.setLineDash([6, 4]);
        for (let el of multiSelection) {
            if (el instanceof Neuron) {
                circle(el.x, el.y, el.r * 2 + 12);
            } else if (el instanceof Stimulator || el instanceof OutputDisplay || el instanceof ManualButton) {
                rect(el.x - el.w / 2 - 6, el.y - el.h / 2 - 6, el.w + 12, el.h + 12, 8);
            } else if (el instanceof OscilloscopeProbe) {
                rect(el.x - el.w / 2 - 6, el.y - el.h / 2 - 6, el.w + 12, el.h + 12, 8);
            } else if (el instanceof Note) {
                circle(el.x, el.y, el.w * 2 + 12);
            }
        }
        drawingContext.setLineDash([]);
    }

    // Draw rubber-band selection box
    if (selectionBox) {
        noFill();
        stroke(56, 189, 248, 100);
        strokeWeight(1);
        drawingContext.setLineDash([4, 3]);
        let bx = Math.min(selectionBox.startX, selectionBox.endX);
        let by = Math.min(selectionBox.startY, selectionBox.endY);
        let bw = Math.abs(selectionBox.endX - selectionBox.startX);
        let bh = Math.abs(selectionBox.endY - selectionBox.startY);
        fill(56, 189, 248, 15);
        rect(bx, by, bw, bh);
        drawingContext.setLineDash([]);
    }


    pop();

    // Update UI Oscilloscope if neuron selected
    updateOscilloscope();
}

function drawGrid() {
    stroke(C_GRID);
    strokeWeight(1);
    let gridSize = 40;

    // Grid needs to cover visible area relative to offset and zoom
    let startX = -viewOffset.x / zoomLevel;
    let startY = -viewOffset.y / zoomLevel;
    let endX = startX + width / zoomLevel;
    let endY = startY + height / zoomLevel;

    // Snap to grid
    let gStartX = Math.floor(startX / gridSize) * gridSize;
    let gStartY = Math.floor(startY / gridSize) * gridSize;
    let gEndX = Math.ceil(endX / gridSize) * gridSize;
    let gEndY = Math.ceil(endY / gridSize) * gridSize;

    for (let x = gStartX; x <= gEndX; x += gridSize) line(x, startY, x, endY);
    for (let y = gStartY; y <= gEndY; y += gridSize) line(startX, y, endX, y);
}

function updateSimulation() {
    simTime += 1;

    // 1. Reset input currents
    for (let n of neurons) {
        n.currentInput = 0;
    }
    for (let o of outputs) {
        o.currentInput = 0;
    }

    // Update Stimulators
    for (let s of stimulators) {
        s.update();
    }

    // Update Buttons
    for (let b of buttons) {
        b.update();
    }

    // 2. Propagate Synapses (instant for simplicity in this visualizer, or delayed)
    // Here we verify spikes from PREVIOUS frame to add current to inputs
    // 2. Update Synapses (Conductance decay & Particles)
    for (let s of synapses) {
        if (s.from.didSpike) {
            s.transmit();
        }
        s.update();
    }

    // 3. Update Neurons
    for (let n of neurons) {
        n.update();
    }

    // 4. Update Outputs
    for (let o of outputs) {
        o.update();
    }

    // 5. Update Probes
    for (let p of probes) {
        p.update();
    }
}

// === CLASSES ===

class Particle {
    constructor(x, y, target, color) {
        this.x = x;
        this.y = y;
        this.target = target;
        this.color = color;
        this.speed = 0.05 + Math.random() * 0.02; // Progress per frame (0-1)
        this.progress = 0;
        this.toRemove = false;
    }

    update(startX, startY, endX, endY, cp) {
        this.progress += this.speed;
        if (this.progress >= 1) {
            this.progress = 1;
            this.toRemove = true;
        }

        if (cp) {
            // Quadratic Bezier: (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
            let t = this.progress;
            let invT = 1 - t;
            this.x = (invT * invT) * startX + 2 * invT * t * cp.x + (t * t) * endX;
            this.y = (invT * invT) * startY + 2 * invT * t * cp.y + (t * t) * endY;
        } else {
            // Linear Lerp
            this.x = startX + (endX - startX) * this.progress;
            this.y = startY + (endY - startY) * this.progress;
        }
    }

    display() {
        fill(this.color);
        noStroke();
        circle(this.x, this.y, 6);
    }
}

class Stimulator {
    constructor(x, y) {
        this.id = Date.now() + Math.random();
        this.x = x;
        this.y = y;
        this.w = 50;
        this.h = 50;

        // Parameters
        this.type = 'sine'; // constant, sine, pulse, square
        this.amplitude = 1.0;
        this.frequency = 0.05; // Hz approx (cycles per frame? No, needs scaling)
        this.offset = 0.0;
        this.phase = 0.0;

        // Visual State
        this.currentOutput = 0;
        this.isDragging = false;
    }

    update() {
        // time scale: 60 frames = 1 second
        // t = simTime / 60
        let t = simTime;
        let timeSec = t / 60;

        if (this.type === 'constant') {
            this.currentOutput = this.offset + this.amplitude;
        } else if (this.type === 'sine') {
            this.currentOutput = this.offset + this.amplitude * Math.sin(timeSec * this.frequency * TWO_PI + this.phase);
        } else if (this.type === 'square') {
            let val = Math.sin(timeSec * this.frequency * TWO_PI + this.phase);
            this.currentOutput = this.offset + (val >= 0 ? this.amplitude : -this.amplitude);
        } else if (this.type === 'pulse') {
            // Pulse: High for small fraction of period
            let phaseVal = (timeSec * this.frequency + this.phase / TWO_PI) % 1.0;
            if (phaseVal < 0.1) {
                this.currentOutput = this.offset + this.amplitude;
            } else {
                this.currentOutput = this.offset;
            }
        }
    }

    display() {
        // Selection Highlight
        if (selectedElement === this) {
            noFill();
            stroke(C_ACCENT);
            strokeWeight(3);
            rect(this.x - this.w / 2 - 5, this.y - this.h / 2 - 5, this.w + 10, this.h + 10, 5);
        }

        // Draw Box
        fill(30, 41, 59);
        stroke(148, 163, 184);
        strokeWeight(2);
        rect(this.x - this.w / 2, this.y - this.h / 2, this.w, this.h, 5);

        // Draw Icon / Output Visualization
        noStroke();

        // Intensity color based on output
        // Assume range -2 to 2 typically
        let intimacy = map(this.currentOutput, -2, 2, 0, 1);
        let c = lerpColor(color(...C_INH), color(...C_EXC), intimacy);

        // Visual feedback
        fill(c);
        circle(this.x, this.y, 20);

        // Label
        fill(255);
        textSize(10);
        textAlign(CENTER, CENTER);
        noStroke();
        text(this.type.toUpperCase().substring(0, 3), this.x, this.y - 18);

        // Value
        text(this.currentOutput.toFixed(2), this.x, this.y + 18);
    }

    isMouseOver(mx, my) {
        return mx > this.x - this.w / 2 && mx < this.x + this.w / 2 &&
            my > this.y - this.h / 2 && my < this.y + this.h / 2;
    }
}

// === MANUAL BUTTON ===
class ManualButton {
    constructor(x, y) {
        this.id = Date.now() + Math.random();
        this.x = x;
        this.y = y;
        this.w = 44;
        this.h = 44;
        this.voltage = 1.5; // Voltage to send on press
        this.currentOutput = 0;
        this.pressTimer = 0; // Frames remaining in pulse
        this.pulseDuration = 10; // How many frames the pulse lasts
        this.isDragging = false;
    }

    press() {
        this.pressTimer = this.pulseDuration;
    }

    update() {
        if (this.pressTimer > 0) {
            this.currentOutput = this.voltage;
            this.pressTimer--;
        } else {
            this.currentOutput = 0;
        }
    }

    display() {
        let isPressed = this.pressTimer > 0;

        // Selection Highlight
        if (selectedElement === this) {
            noFill();
            stroke(C_ACCENT);
            strokeWeight(3);
            rect(this.x - this.w / 2 - 5, this.y - this.h / 2 - 5, this.w + 10, this.h + 10, 10);
        }

        // Glow when pressed
        if (isPressed) {
            noStroke();
            fill(56, 189, 248, 40);
            circle(this.x, this.y, this.w + 20);
        }

        // Button body
        fill(isPressed ? color(56, 189, 248) : color(30, 41, 59));
        stroke(isPressed ? color(125, 211, 252) : color(148, 163, 184));
        strokeWeight(2);
        rect(this.x - this.w / 2, this.y - this.h / 2, this.w, this.h, 10);

        // Inner circle (button face)
        fill(isPressed ? color(14, 165, 233) : color(51, 65, 85));
        noStroke();
        circle(this.x, this.y, 22);

        // Arrow/bolt icon
        fill(isPressed ? color(255) : color(148, 163, 184));
        textSize(14);
        textAlign(CENTER, CENTER);
        text('⚡', this.x, this.y);

        // Label
        fill(148, 163, 184);
        textSize(8);
        text('BTN', this.x, this.y + this.h / 2 + 10);

        // Voltage label
        if (isPressed) {
            fill(56, 189, 248);
            textSize(9);
            text(this.voltage.toFixed(1) + 'V', this.x, this.y - this.h / 2 - 18);
        }
    }

    isMouseOver(mx, my) {
        return mx > this.x - this.w / 2 && mx < this.x + this.w / 2 &&
            my > this.y - this.h / 2 && my < this.y + this.h / 2;
    }
}


class OutputDisplay {
    constructor(x, y) {
        this.id = Date.now() + Math.random();
        this.x = x;
        this.y = y;
        this.w = 60;
        this.h = 50;

        // Parameters
        this.label = 'Output';
        this.activationThreshold = 0.5;

        // State
        this.currentInput = 0;
        this.isActive = false;
        this.wasActive = false; // Track rising edge
        this.activeGlow = 0; // For smooth glow animation
        this.isDragging = false;

        // Floating text effect
        this.floatingTexts = []; // { yOffset, opacity, text }
        this.maxFloatingTexts = 5;
    }

    update() {
        this.wasActive = this.isActive;
        this.isActive = this.currentInput >= this.activationThreshold;

        // Spawn floating text on rising edge (transition to active)
        if (this.isActive && !this.wasActive) {
            this.spawnFloatingText();
        }

        // Update floating texts
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            let ft = this.floatingTexts[i];
            ft.yOffset -= 0.8; // Float upward
            ft.opacity -= 2.5; // Fade out (~100 frames to fully fade)
            if (ft.opacity <= 0) {
                this.floatingTexts.splice(i, 1);
            }
        }

        // Smooth glow
        let target = this.isActive ? 1.0 : 0.0;
        this.activeGlow += (target - this.activeGlow) * 0.2;
    }

    spawnFloatingText() {
        // If at max, instantly remove the oldest (top-most)
        while (this.floatingTexts.length >= this.maxFloatingTexts) {
            this.floatingTexts.shift(); // Remove oldest
        }

        // Push existing texts up to make room
        for (let ft of this.floatingTexts) {
            ft.yOffset -= 14; // Push up by line height
            // Accelerate fade on older texts when pushed
            ft.opacity = Math.min(ft.opacity, 180);
        }

        // Spawn new text at the top edge of the component
        this.floatingTexts.push({
            yOffset: 0,
            opacity: 255,
            text: this.label
        });
    }

    display() {
        // Selection Highlight
        if (selectedElement === this) {
            noFill();
            stroke(C_ACCENT);
            strokeWeight(3);
            rect(this.x - this.w / 2 - 5, this.y - this.h / 2 - 5, this.w + 10, this.h + 10, 8);
        }

        // Active glow effect
        if (this.activeGlow > 0.05) {
            noStroke();
            let g = this.activeGlow;
            fill(56, 189, 248, g * 60);
            rect(this.x - this.w / 2 - 8, this.y - this.h / 2 - 8, this.w + 16, this.h + 16, 12);
            fill(56, 189, 248, g * 30);
            rect(this.x - this.w / 2 - 14, this.y - this.h / 2 - 14, this.w + 28, this.h + 28, 16);
        }

        // Draw Box — rounded rect with distinct style
        let bgR = lerp(30, 20, this.activeGlow);
        let bgG = lerp(41, 60, this.activeGlow);
        let bgB = lerp(59, 90, this.activeGlow);
        fill(bgR, bgG, bgB);
        stroke(this.isActive ? color(56, 189, 248) : color(148, 163, 184));
        strokeWeight(2);
        rect(this.x - this.w / 2, this.y - this.h / 2, this.w, this.h, 8);

        // Output icon (small monitor/screen shape)
        noFill();
        stroke(this.isActive ? color(56, 189, 248) : color(100, 116, 139));
        strokeWeight(1.5);
        let iconY = this.y - 10;
        rect(this.x - 10, iconY - 6, 20, 12, 2);
        line(this.x - 5, iconY + 6, this.x + 5, iconY + 6);
        line(this.x, iconY + 6, this.x, iconY + 9);
        line(this.x - 6, iconY + 9, this.x + 6, iconY + 9);

        // Label text
        noStroke();
        fill(this.isActive ? 255 : 180);
        textSize(9);
        textAlign(CENTER, CENTER);
        // Truncate label if too long for display
        let displayLabel = this.label.length > 10 ? this.label.substring(0, 9) + '…' : this.label;
        text(displayLabel, this.x, this.y + 14);

        // Input value indicator
        fill(this.isActive ? color(56, 189, 248) : color(100, 116, 139));
        textSize(8);
        text(this.currentInput.toFixed(2), this.x, this.y + 23);

        // Draw floating texts above the component
        textSize(11);
        textAlign(CENTER, CENTER);
        for (let ft of this.floatingTexts) {
            let baseY = this.y - this.h / 2 - 10; // Start above the component
            let drawY = baseY + ft.yOffset;
            let a = Math.max(0, ft.opacity);
            fill(56, 189, 248, a);
            noStroke();
            text(ft.text, this.x, drawY);
        }
    }

    isMouseOver(mx, my) {
        return mx > this.x - this.w / 2 && mx < this.x + this.w / 2 &&
            my > this.y - this.h / 2 && my < this.y + this.h / 2;
    }
}

class Note {
    constructor(x, y, text, targets = []) {
        this.id = Date.now() + Math.random();
        this.x = x;
        this.y = y;
        this.text = text;
        // Store target IDs (accepts both objects with .id and raw IDs)
        this.targetIds = targets.map(t => (typeof t === 'object' && t !== null) ? t.id : t);
        this.minimized = true;
        this.w = 12; // Icon radius
        this.isDragging = false;
    }

    // Resolve targetIds to actual element objects
    getResolvedTargets() {
        let allElements = [...neurons, ...stimulators, ...buttons, ...outputs, ...probes];
        return this.targetIds
            .map(id => allElements.find(el => el.id === id))
            .filter(el => el !== undefined);
    }

    display() {
        // Draw lines to targets
        stroke(255, 255, 255, 50);
        strokeWeight(1);
        drawingContext.setLineDash([5, 5]); // Dashed
        for (let t of this.getResolvedTargets()) {
            line(this.x, this.y, t.x, t.y);
        }
        drawingContext.setLineDash([]); // Reset

        // Selection Highlight
        if (selectedElement === this) {
            noFill();
            stroke(C_ACCENT);
            strokeWeight(3);
            circle(this.x, this.y, this.w * 2 + 5);
        }

        // Icon (Paper)
        fill(255);
        stroke(203, 213, 225); // Slate-300
        strokeWeight(1);
        rect(this.x - 10, this.y - 13, 20, 26, 2);

        // Lines
        stroke(148, 163, 184); // Slate-400
        strokeWeight(2);
        line(this.x - 4, this.y - 4, this.x + 4, this.y - 4);
        line(this.x - 4, this.y + 1, this.x + 4, this.y + 1);
        line(this.x - 4, this.y + 6, this.x + 1, this.y + 6);

        // Expanded Text Box
        if (!this.minimized) {
            let boxW = 200;
            let padding = 10;
            let textW = boxW - padding * 2;

            // Measure text height dynamically
            textSize(12);
            textAlign(LEFT, TOP);
            // Use a hidden draw to measure: p5 text() with width wraps, but
            // we need the bounding box. We can approximate with textLeading and line count.
            let leading = textLeading();
            let words = this.text.split('');
            let testLines = 1;
            let lineW = 0;
            for (let ch of words) {
                if (ch === '\n') { testLines++; lineW = 0; continue; }
                lineW += textWidth(ch);
                if (lineW > textW) { testLines++; lineW = textWidth(ch); }
            }
            let textH = testLines * leading;
            let boxH = textH + padding * 2;

            let boxX = this.x - boxW / 2;
            let boxY = this.y - boxH - 15;

            fill(30, 41, 59, 230); // Panel BG
            stroke(148, 163, 184);
            strokeWeight(1);
            rect(boxX, boxY, boxW, boxH, 8);

            fill(255);
            noStroke();
            textSize(12);
            textAlign(LEFT, TOP);
            text(this.text, boxX + padding, boxY + padding, textW);
        }
    }

    isMouseOver(mx, my) {
        return dist(mx, my, this.x, this.y) < this.w;
    }

    isMouseOverBox(mx, my) {
        if (this.minimized) return false;
        let boxW = 200;
        let padding = 10;
        let textW = boxW - padding * 2;

        // Same height calculation as display()
        textSize(12);
        textAlign(LEFT, TOP);
        let leading = textLeading();
        let chars = this.text.split('');
        let testLines = 1;
        let lineW = 0;
        for (let ch of chars) {
            if (ch === '\n') { testLines++; lineW = 0; continue; }
            lineW += textWidth(ch);
            if (lineW > textW) { testLines++; lineW = textWidth(ch); }
        }
        let textH = testLines * leading;
        let boxH = textH + padding * 2;

        let boxX = this.x - boxW / 2;
        let boxY = this.y - boxH - 15;
        return mx > boxX && mx < boxX + boxW &&
            my > boxY && my < boxY + boxH;
    }

    toggle() {
        this.minimized = !this.minimized;
    }
}

// === OSCILLOSCOPE PROBE ===
class OscilloscopeProbe {
    constructor(x, y, target) {
        this.id = Date.now() + Math.random();
        this.x = x;
        this.y = y;
        this.target = target; // Neuron reference
        this.w = 140;
        this.h = 65;
        this.history = new Array(120).fill(0);
        this.isDragging = false;
    }

    update() {
        if (this.target) {
            let val = this.target.voltage;
            this.history.push(val);
            if (this.history.length > 120) this.history.shift();
        }
    }

    display() {
        let px = this.x;
        let py = this.y;

        // Draw connecting line to target
        if (this.target) {
            stroke(56, 189, 248, 60);
            strokeWeight(1);
            drawingContext.setLineDash([3, 3]);
            line(px, py - this.h / 2, this.target.x, this.target.y);
            drawingContext.setLineDash([]);
        }

        // Panel background
        fill(15, 23, 42, 220);
        stroke(selectedElement === this ? [56, 189, 248] : [51, 65, 85]);
        strokeWeight(selectedElement === this ? 2 : 1);
        rectMode(CENTER);
        rect(px, py, this.w, this.h, 6);
        rectMode(CORNER);

        // Label
        fill(148, 163, 184);
        noStroke();
        textSize(9);
        textAlign(LEFT, TOP);
        let labelX = px - this.w / 2 + 6;
        let labelY = py - this.h / 2 + 4;
        text('PROBE', labelX, labelY);

        // Draw voltage trace
        let traceX = px - this.w / 2 + 6;
        let traceY = py - this.h / 2 + 16;
        let traceW = this.w - 12;
        let traceH = this.h - 22;

        // Trace background
        fill(8, 15, 30);
        noStroke();
        rect(traceX, traceY, traceW, traceH, 2);

        // Grid lines
        stroke(30, 41, 59);
        strokeWeight(0.5);
        for (let i = 0; i < 5; i++) {
            let gy = traceY + (traceH / 4) * i;
            line(traceX, gy, traceX + traceW, gy);
        }

        // Voltage line
        stroke(34, 197, 94);
        strokeWeight(1.5);
        noFill();
        beginShape();

        const V_MIN = -1.0;
        const V_MAX = 1.0;
        const V_RANGE = V_MAX - V_MIN;
        for (let i = 0; i < this.history.length; i++) {
            let x = traceX + (i / (this.history.length - 1)) * traceW;
            let v = constrain(this.history[i], V_MIN, V_MAX);
            let y = traceY + traceH - ((v - V_MIN) / V_RANGE) * traceH;
            vertex(x, y);
        }
        endShape();

        // Threshold line
        if (this.target) {
            let vth = constrain(this.target.thresh, V_MIN, V_MAX);
            let threshY = traceY + traceH - ((vth - V_MIN) / V_RANGE) * traceH;
            stroke(239, 68, 68, 100);
            strokeWeight(0.5);
            drawingContext.setLineDash([3, 2]);
            line(traceX, threshY, traceX + traceW, threshY);
            drawingContext.setLineDash([]);
        }
    }

    isMouseOver(mx, my) {
        return mx > this.x - this.w / 2 && mx < this.x + this.w / 2 &&
            my > this.y - this.h / 2 && my < this.y + this.h / 2;
    }
}


class Neuron {
    constructor(x, y) {
        this.id = Date.now() + Math.random();
        this.x = x;
        this.y = y;
        this.r = 25; // radius

        // Physics Params
        this.voltage = 0; // Voltage
        this.tau = 20; // Decay constant (ms)
        this.thresh = -.55;
        this.bias = -0.7;
        this.refractoryPeriod = 1; // ms (frames) — biologically ~1ms
        this.refractoryTimer = 0;

        // State
        this.didSpike = false;
        this.spikeTimer = 0; // Visual flash timer

        // Input buffer
        this.currentInput = 0;

        // For Graph
        this.history = new Array(100).fill(0);

        this.isDragging = false;

        // Plasticity State (BCM)
        this.avgFiringRate = 0; // Long-term average
        this.theta = 0; // Sliding threshold (avg^2)
    }

    update() {
        // LIF Math: dV = (I - V) / tau * dt
        // Assuming dt = 1 for per-frame update normalization

        // Refractory period: block input and clamp voltage
        if (this.refractoryTimer > 0) {
            this.refractoryTimer--;
            this.voltage = this.bias - .10;
            this.didSpike = false;
        } else {
            let I = this.bias + this.currentInput;

            // Euler integration
            let dV = (I - this.voltage) / this.tau;
            this.voltage += dV;

            // Spike Logic
            if (this.voltage >= this.thresh) {
                this.voltage = .40; // Reset
                this.didSpike = true;
                this.spikeTimer = 10; // Frames to show flash
                this.refractoryTimer = this.refractoryPeriod;
            } else {
                this.didSpike = false;
            }
        }

        // BCM: Update Average Firing Rate
        let instRate = this.didSpike ? 1.0 : 0.0;
        let bcmTau = 1000; // Very slow integration (approx 16s at 60fps)
        this.avgFiringRate += (instRate - this.avgFiringRate) / bcmTau;
        this.theta = this.avgFiringRate * this.avgFiringRate;
        // prevent theta from stalling at 0
        if (this.theta < 0.000001) this.theta = 0.000001;

        // Visual Decay
        if (this.spikeTimer > 0) this.spikeTimer--;

        // Record history
        this.history.push(this.voltage + (this.didSpike ? 1.0 : 0)); // Add visual spike height
        if (this.history.length > 100) this.history.shift();
    }

    display() {
        // Selection Highlight
        if (selectedElement === this) {
            noFill();
            stroke(C_ACCENT);
            strokeWeight(3);
            circle(this.x, this.y, this.r * 2 + 10);
        }

        // Body
        if (this.spikeTimer > 0) {
            // Flash
            fill(C_SPIKE);
            stroke(C_SPIKE);
        } else {
            // Resting Color (interpolate based on voltage)
            let vNorm = constrain((2 + this.voltage) / (2 + this.thresh), 0, 1); // Adding 2 ensures proper calc even if both are negative
            let c = color(30 + vNorm * 30, 41 + vNorm * 50, 59 + vNorm * 100);
            fill(c);
            stroke(C_NEURON_STROKE);
        }

        strokeWeight(2);
        circle(this.x, this.y, this.r * 2);

        strokeWeight(2);
        circle(this.x, this.y, this.r * 2);

        // Inner Circle (Membrane Potential)
        // Filling outwards
        let vRatio = constrain((2 + this.voltage) / (2 + this.thresh), 0, 1); // Adding 2 ensures proper calc even if both are negative
        if (vRatio > 0.01) {
            noStroke();
            fill(C_ACCENT);
            // Size from 0 to full radius (minus stroke padding)
            let fillR = (this.r * 2 - 4) * Math.sqrt(vRatio); // sqrt for area-relation feel, or linear for radius
            // Linear radius for clearer indication
            fillR = (this.r * 2 - 6) * vRatio;
            circle(this.x, this.y, fillR);
        }
    }

    isMouseOver(mx, my) {
        return dist(mx, my, this.x, this.y) < this.r;
    }
}

class Synapse {
    constructor(from, to) {
        this.from = from;
        this.to = to;
        this.weight = (from instanceof Stimulator || from instanceof ManualButton) ? 1.0 : 0.5;

        // Neurotransmitter Model
        this.g = 0; // Conductance
        this.gMax = 1.0;
        this.decay = 0.1; // Conductance decay per frame (Reuptake Rate)
        this.sensitivity = 1.0; // Receptor Sensitivity
        this.particles = [];

        // Plasticity State
        this.plasticityMode = 'off'; // 'off', 'stdp', 'bcm'
        this.baseLearningRate = 1.0; // Scaler

        // STDP specific
        this.preTrace = 0;
        this.postTrace = 0;
        this.tau_plus = 20;
        this.tau_minus = 20;
        this.A_plus = 0.01;
        this.A_minus = -0.012;

        // Visualization of Learning
        this.learningFlashColor = null; // color for spark
        this.learningFlashTimer = 0;
    }
    getReversalPotential() {
        // Excitatory -> 1.0 (pushes high), Inhibitory -> -1.0 (clamps low)
        return this.weight > 0 ? 1.0 : -1.0;
    }

    getControlPoint() {
        // Check if there is a reverse connection via ID
        let reverseConnected = synapses.find(s => s.from.id === this.to.id && s.to.id === this.from.id);

        if (!reverseConnected) return null;

        let dx = this.to.x - this.from.x;
        let dy = this.to.y - this.from.y;
        let midX = (this.from.x + this.to.x) / 2;
        let midY = (this.from.y + this.to.y) / 2;

        let len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return null;

        // Offset vector (perpendicular)
        // (x, y) -> (-y, x) gives 90 deg rotation (Standard 2D normal)
        let ox = -dy / len;
        let oy = dx / len;

        let offset = 80;
        let cp = { x: midX + ox * offset, y: midY + oy * offset };

        return cp;
    }

    transmit() {
        // Spawn Particles
        let count = 5;
        let c = this.weight > 0 ? color(...C_EXC) : color(...C_INH); // Neon Green or Red

        // Make them brighter for particles
        c = lerpColor(c, color(255), 0.5);

        for (let i = 0; i < count; i++) {
            this.particles.push(new Particle(this.from.x, this.from.y, this.to, c));
            // Stagger them slightly
            this.particles[this.particles.length - 1].progress = -Math.random() * 0.2; // Delay start
        }
    }

    update() {
        if (this.from instanceof Stimulator || this.from instanceof ManualButton) {
            // Direct Current Injection
            // Synapse acts as a scaler with weight.
            // Basic Input = Output * Weight
            let inputI = this.weight * this.from.currentOutput;
            console.log(inputI)
            this.to.currentInput += inputI;
            return;
        }

        // 1. Move Particles
        let cp = this.getControlPoint();
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            if (p.progress < 0) {
                p.progress += p.speed; // Just waiting
                continue;
            }

            p.update(this.from.x, this.from.y, this.to.x, this.to.y, cp);

            if (p.toRemove) {
                // Increase conductance.
                // Sensitivity scaling with weight magnitude
                this.g += Math.abs(this.weight) * 0.5 * this.sensitivity;
                this.particles.splice(i, 1);
            }
        }

        // 2. Conductance Decay
        this.g *= (1 - this.decay);

        // 3. Apply Current to Target
        if (this.to instanceof OutputDisplay) {
            // OutputDisplay: simple direct injection
            this.to.currentInput += this.g * this.weight;
        } else {
            // Neuron: Conductance Based I = g * (E_rev - V)
            let E_rev = this.getReversalPotential();
            let V = this.to.voltage;
            let I_syn = this.g * (E_rev - V);
            this.to.currentInput += I_syn;
        }

        // 4. Update Plasticity
        if (this.plasticityMode !== 'off') {
            this.updatePlasticity();
        }

        if (this.learningFlashTimer > 0) this.learningFlashTimer--;
    }

    updatePlasticity() {
        let weightChange = 0;

        // 1. Trace Decay
        this.preTrace *= Math.exp(-1 / this.tau_plus);
        this.postTrace *= Math.exp(-1 / this.tau_minus);

        // 2. Update Traces & Apply STDP
        if (this.plasticityMode === 'stdp') {
            // Presynaptic Spike
            // Note: In biological STDP, it's the arrival at synapse.
            // Use the neuron's spike time (axonal delay is 0).

            if (this.from.didSpike) {
                this.preTrace += 1.0;
                // Pre after Post -> LTD
                weightChange += this.baseLearningRate * this.A_minus * this.postTrace;
            }

            if (this.to.didSpike) {
                this.postTrace += 1.0;
                // Post after Pre -> LTP
                weightChange += this.baseLearningRate * this.A_plus * this.preTrace;
            }

        } else if (this.plasticityMode === 'bcm') {
            // BCM Rule
            // dW = learningRate * pre * post * (post - theta)
            // 'preTrace' and 'postTrace' are good proxies for immediate activity traces.
            // BCM often uses a fast trace for activity and slow trace for threshold.

            // Use traces as "instantaneous" activity rate approximation
            if (this.from.didSpike) this.preTrace += 1.0;
            if (this.to.didSpike) this.postTrace += 1.0;

            // Continuous BCM: dW/dt = \eta * y * x * (y - \theta_M)
            // x = pre trace, y = post trace

            let y = this.postTrace;
            let x = this.preTrace;
            let theta = this.to.theta;

            // Scale down because this runs every frame
            let dt = 1.0;
            let dW = this.baseLearningRate * 0.001 * x * y * (y - theta);

            // Only apply if activity is significant to save cycles/noise
            if (x > 0.01 && y > 0.01) {
                weightChange += dW;
            }
        }

        // Apply Change
        if (weightChange !== 0) {
            let oldSign = Math.sign(this.weight) || 1; // Record original sign
            this.weight += weightChange;

            // Prevent sign flipping
            if (oldSign > 0) {
                this.weight = Math.max(0, Math.min(1, this.weight));
            } else {
                this.weight = Math.max(-1, Math.min(0, this.weight));
            }

            // Visualization
            if (Math.abs(weightChange) > 0.0001) { // Threshold for spark
                this.learningFlashTimer = 10;
                // Green for LTP (positive), Red for LTD (negative)
                this.learningFlashColor = weightChange > 0 ? [0, 255, 0] : [255, 0, 0];
            }
        }
    }

    display() {
        // Calculate curve control point first
        let cp = this.getControlPoint();

        // Highlight
        if (selectedElement === this) {
            stroke(C_ACCENT);
            strokeWeight(6);
            noFill();
            if (cp) {
                beginShape();
                vertex(this.from.x, this.from.y);
                quadraticVertex(cp.x, cp.y, this.to.x, this.to.y);
                endShape();
            } else {
                line(this.from.x, this.from.y, this.to.x, this.to.y);
            }
        }


        let absW = Math.abs(this.weight);

        // Base Color: Interpolate from dim to bright based on weight magnitude
        let baseC;
        if (this.weight > 0) {
            // Excitatory: Dim Green -> Bright Green
            baseC = lerpColor(color(20, 100, 50), color(...C_EXC), 0.3 + 0.7 * absW);
        } else {
            // Inhibitory: Dim Red -> Bright Red
            baseC = lerpColor(color(100, 20, 20), color(...C_INH), 0.3 + 0.7 * absW);
        }

        // Spike Flash Logic (Reduced now that we have particles)
        // Keep a subtle flash on wire
        let spikeT = this.from.spikeTimer || 0; // Stimulators don't have spikeTimer
        let spikeFactor = constrain(spikeT / 10, 0, 1);
        let finalC = lerpColor(baseC, color(255), spikeFactor * 0.3);

        stroke(finalC);

        let w = absW * 5 + 1;
        strokeWeight(w);

        if (cp) {
            noFill();
            beginShape();
            vertex(this.from.x, this.from.y);
            quadraticVertex(cp.x, cp.y, this.to.x, this.to.y);
            endShape();

            // Direction Arrow
            // Tangent of Quadratic Bezier at t=0.5
            // T(t) = 2(1-t)(P1-P0) + 2t(P2-P1)
            // T(0.5) = (P1-P0) + (P2-P1) = P2 - P0
            // The arrow should point parallel to the line between neurons.

            // Position at t=0.5
            // B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2
            let t = 0.5;
            let mx = 0.25 * this.from.x + 0.5 * cp.x + 0.25 * this.to.x;
            let my = 0.25 * this.from.y + 0.5 * cp.y + 0.25 * this.to.y;

            push();
            translate(mx, my);
            // Calculate angle: P2 - P0 (Vector from start to end)
            rotate(atan2(this.to.y - this.from.y, this.to.x - this.from.x));
            fill(finalC);
            stroke(255);
            strokeWeight(2);
            triangle(0, -8, 0, 8, 16, 0);
            pop();

        } else {
            line(this.from.x, this.from.y, this.to.x, this.to.y);

            // Direction Arrow
            push();
            translate((this.from.x + this.to.x) / 2, (this.from.y + this.to.y) / 2);
            rotate(atan2(this.to.y - this.from.y, this.to.x - this.from.x));
            fill(finalC); // Use calculated color
            stroke(255);
            strokeWeight(2);
            triangle(0, -8, 0, 8, 16, 0);
            pop();
        }

        // Learning Flash (Sparks) — drawn AFTER the line so it renders on top
        if (this.learningFlashTimer > 0) {
            let alpha = (this.learningFlashTimer / 10) * 200;
            stroke(this.learningFlashColor[0], this.learningFlashColor[1], this.learningFlashColor[2], alpha);
            strokeWeight(this.learningFlashTimer); // Thicker line
            noFill();
            if (cp) {
                beginShape();
                vertex(this.from.x, this.from.y);
                quadraticVertex(cp.x, cp.y, this.to.x, this.to.y);
                endShape();
            } else {
                line(this.from.x, this.from.y, this.to.x, this.to.y);
            }
        }

        // DRAW PARTICLES
        for (let p of this.particles) {
            if (p.progress > 0) p.display();
        }

        // Draw Receptor Glow at Target
        if (this.g > 0.1) {
            noStroke();
            fill(this.weight > 0 ? C_EXC : C_INH);
            // Visual feedback of conductance at target
            circle(this.to.x, this.to.y, 5 + this.g * 10);
        }
    }

    isMouseOver(mx, my) {
        let cp = this.getControlPoint();
        if (cp) {
            // Sample Bezier for hit test
            let steps = 15;
            for (let i = 0; i <= steps; i++) {
                let t = i / steps;
                let invT = 1 - t;
                let x = (invT * invT) * this.from.x + 2 * invT * t * cp.x + (t * t) * this.to.x;
                let y = (invT * invT) * this.from.y + 2 * invT * t * cp.y + (t * t) * this.to.y;
                if (dist(mx, my, x, y) < 12) return true;
            }
            return false;
        }

        // Distance to line segment math
        let d = distToSegment(
            { x: mx, y: my },
            { x: this.from.x, y: this.from.y },
            { x: this.to.x, y: this.to.y }
        );
        return d < 10;
    }
}

// === INTERACTION HANDLERS ===

function mousePressed(e) {
    // Ignore clicks on UI elements (only process clicks on the canvas)
    if (e && e.target.tagName !== 'CANVAS') return;
    // Check if clicking on UI
    let ui = document.getElementById('ui-layer');
    let sidebar = document.getElementById('properties-panel');
    let toolbar = document.querySelector('.toolbar');

    let w = screenToWorld(mouseX, mouseY);
    let mx = w.x;
    let my = w.y;

    // 1. Check if clicking an existing neuron
    let clickedNeuron = null;
    for (let n of neurons) {
        if (n.isMouseOver(mx, my)) {
            clickedNeuron = n;
            break;
        }
    }

    // 2. Check if clicking a Stimulator
    let clickedStimulator = null;
    if (!clickedNeuron) {
        for (let s of stimulators) {
            if (s.isMouseOver(mx, my)) {
                clickedStimulator = s;
                break;
            }
        }
    }

    // 2a. Check if clicking a Button
    let clickedButton = null;
    if (!clickedNeuron && !clickedStimulator) {
        for (let b of buttons) {
            if (b.isMouseOver(mx, my)) {
                clickedButton = b;
                break;
            }
        }
    }

    // 2b. Check if clicking an Output
    let clickedOutput = null;
    if (!clickedNeuron && !clickedStimulator && !clickedButton) {
        for (let o of outputs) {
            if (o.isMouseOver(mx, my)) {
                clickedOutput = o;
                break;
            }
        }
    }

    // 2c. Check if clicking a Probe
    let clickedProbe = null;
    if (!clickedNeuron && !clickedStimulator && !clickedButton && !clickedOutput) {
        for (let p of probes) {
            if (p.isMouseOver(mx, my)) {
                clickedProbe = p;
                break;
            }
        }
    }

    // Check Note
    let clickedNote = null;
    let clickedNoteBox = null;

    // Check Note Box first (highest priority if visible)
    for (let n of notes) {
        if (n.isMouseOverBox(mx, my)) {
            clickedNoteBox = n;
            break;
        }
    }

    if (!clickedNoteBox && !clickedNeuron && !clickedStimulator && !clickedButton && !clickedOutput && !clickedProbe) {
        for (let n of notes) {
            if (n.isMouseOver(mx, my)) {
                clickedNote = n;
                break;
            }
        }
    }

    // 3. Check if clicking a synapse (if no neuron/stimulator/output/note clicked)
    let clickedSynapse = null;
    if (!clickedNeuron && !clickedStimulator && !clickedButton && !clickedOutput && !clickedProbe && !clickedNote && !clickedNoteBox) {
        for (let s of synapses) {
            if (s.isMouseOver(mx, my)) {
                clickedSynapse = s;
                break;
            }
        }
    }

    // Logic based on Mode
    if (mode === 'neuron') {
        if (!clickedNeuron && !clickedSynapse && !clickedStimulator && !clickedButton && !clickedOutput && !clickedProbe && !clickedNoteBox) {
            let n = new Neuron(mx, my);
            neurons.push(n);
            selectElement(n);
        }
    } else if (mode === 'stimulator') {
        if (!clickedNeuron && !clickedSynapse && !clickedStimulator && !clickedButton && !clickedOutput && !clickedProbe && !clickedNoteBox) {
            let s = new Stimulator(mx, my);
            stimulators.push(s);
            selectElement(s);
            setMode('move');
        }
    } else if (mode === 'output') {
        if (!clickedNeuron && !clickedSynapse && !clickedStimulator && !clickedButton && !clickedOutput && !clickedProbe && !clickedNoteBox) {
            let o = new OutputDisplay(mx, my);
            outputs.push(o);
            selectElement(o);
            setMode('move');
        }
    } else if (mode === 'note') {
        if (clickedNeuron) {
            // Toggle selection
            let idx = noteSelection.indexOf(clickedNeuron);
            if (idx === -1) noteSelection.push(clickedNeuron);
            else noteSelection.splice(idx, 1);
        } else if (!clickedNote && !clickedStimulator && !clickedOutput && !clickedSynapse && !clickedNoteBox) {
            // Clicked empty space -> Create Note
            // Directly create note without prompt
            let n = new Note(mx, my, "New Note", [...noteSelection]); // Copy selection
            n.minimized = false;
            notes.push(n);
            setMode('move');
            noteSelection = [];
            editNote(n);
        }
    } else if (mode === 'probe') {
        // Click a neuron to attach a probe
        if (clickedNeuron) {
            let p = new OscilloscopeProbe(clickedNeuron.x, clickedNeuron.y + 100, clickedNeuron);
            probes.push(p);
            selectElement(p);
            setMode('move');
        }
    } else if (mode === 'button') {
        if (!clickedNeuron && !clickedSynapse && !clickedStimulator && !clickedButton && !clickedOutput && !clickedProbe && !clickedNoteBox) {
            let b = new ManualButton(mx, my);
            buttons.push(b);
            selectElement(b);
            b.isDragging = true;
            setMode('move');
        }
    } else if (mode === 'gate') {
        // Click empty space to place a logic gate
        if (!clickedNeuron && !clickedStimulator && !clickedButton && !clickedOutput && !clickedProbe && !clickedNoteBox) {
            spawnLogicGate(gateType, mx, my);
            setMode('move');
        }
    } else if (mode === 'move') {
        let clickedAny = clickedNeuron || clickedStimulator || clickedButton || clickedOutput || clickedProbe || clickedNote;

        // Shift+click: toggle multi-selection
        if (keyIsDown(SHIFT) && clickedAny) {
            let el = clickedNeuron || clickedStimulator || clickedButton || clickedOutput || clickedProbe || clickedNote;
            let idx = multiSelection.indexOf(el);
            if (idx === -1) {
                multiSelection.push(el);
            } else {
                multiSelection.splice(idx, 1);
            }
            selectElement(el);
            return;
        }

        // Shift+drag on empty space: start rubber-band
        if (keyIsDown(SHIFT) && !clickedAny && !clickedNote && !clickedSynapse && !clickedNoteBox) {
            selectionBox = { startX: mx, startY: my, endX: mx, endY: my };
            return;
        }

        if (clickedNoteBox) {
            editNote(clickedNoteBox);
            return;
        } else if (clickedAny) {
            let el = clickedNeuron || clickedStimulator || clickedButton || clickedOutput || clickedProbe || clickedNote;
            // If clicking an element that's in multiSelection, start group drag
            if (multiSelection.includes(el)) {
                isMultiDragging = true;
                multiDragStart = { x: mx, y: my };
                selectElement(el);
            } else {
                // Clear multi-selection, select single element
                multiSelection = [];
                selectElement(el);
                if (el.isDragging !== undefined) el.isDragging = true;
                // Toggle note expand/collapse on single click
                if (el instanceof Note) el.toggle();
            }
        } else if (clickedSynapse) {
            multiSelection = [];
            selectElement(clickedSynapse);
        } else {
            // Start Panning
            isPanning = true;
            lastMouse = { x: mouseX, y: mouseY };
            multiSelection = [];
            selectElement(null); // Deselect
        }
    } else if (mode === 'synapse') {
        if (clickedNeuron) {
            tempConnectionStart = clickedNeuron;
        } else if (clickedStimulator) {
            tempConnectionStart = clickedStimulator;
        } else if (clickedButton) {
            tempConnectionStart = clickedButton;
        }
    } else {
        // Default to allow panning in other modes too if nothing clicked?
        if (!clickedNeuron && !clickedSynapse && !clickedStimulator && !clickedButton && !clickedOutput && !clickedProbe) {
            isPanning = true;
            lastMouse = { x: mouseX, y: mouseY };
        }
    }
}

function mouseDragged(e) {
    if (e && e.target.tagName !== 'CANVAS') return;

    let w = screenToWorld(mouseX, mouseY);
    let mx = w.x;
    let my = w.y;

    if (isPanning) {
        let dx = mouseX - lastMouse.x;
        let dy = mouseY - lastMouse.y;
        viewOffset.x += dx;
        viewOffset.y += dy;
        lastMouse = { x: mouseX, y: mouseY };
        return;
    }

    if (selectionBox) {
        // Update rubber-band
        selectionBox.endX = mx;
        selectionBox.endY = my;
    } else if (isMultiDragging && multiSelection.length > 0) {
        // Group drag
        let ddx = mx - multiDragStart.x;
        let ddy = my - multiDragStart.y;
        for (let el of multiSelection) {
            el.x += ddx;
            el.y += ddy;
        }
        multiDragStart = { x: mx, y: my };
    } else if (mode === 'move' && selectedElement && selectedElement.isDragging) {
        selectedElement.x = mx;
        selectedElement.y = my;
    }
}

function mouseReleased() {
    isPanning = false;

    // End group drag
    isMultiDragging = false;
    multiDragStart = null;

    // Finalize rubber-band selection
    if (selectionBox) {
        let bx1 = Math.min(selectionBox.startX, selectionBox.endX);
        let by1 = Math.min(selectionBox.startY, selectionBox.endY);
        let bx2 = Math.max(selectionBox.startX, selectionBox.endX);
        let by2 = Math.max(selectionBox.startY, selectionBox.endY);
        for (let n of neurons) {
            if (n.x >= bx1 && n.x <= bx2 && n.y >= by1 && n.y <= by2) {
                if (!multiSelection.includes(n)) multiSelection.push(n);
            }
        }
        for (let s of stimulators) {
            if (s.x >= bx1 && s.x <= bx2 && s.y >= by1 && s.y <= by2) {
                if (!multiSelection.includes(s)) multiSelection.push(s);
            }
        }
        for (let o of outputs) {
            if (o.x >= bx1 && o.x <= bx2 && o.y >= by1 && o.y <= by2) {
                if (!multiSelection.includes(o)) multiSelection.push(o);
            }
        }
        for (let p of probes) {
            if (p.x >= bx1 && p.x <= bx2 && p.y >= by1 && p.y <= by2) {
                if (!multiSelection.includes(p)) multiSelection.push(p);
            }
        }
        for (let n of notes) {
            if (n.x >= bx1 && n.x <= bx2 && n.y >= by1 && n.y <= by2) {
                if (!multiSelection.includes(n)) multiSelection.push(n);
            }
        }
        for (let b of buttons) {
            if (b.x >= bx1 && b.x <= bx2 && b.y >= by1 && b.y <= by2) {
                if (!multiSelection.includes(b)) multiSelection.push(b);
            }
        }
        selectionBox = null;
    }

    if (mode === 'move' && selectedElement && selectedElement.isDragging !== undefined) {
        selectedElement.isDragging = false;
    }

    if (mode === 'synapse' && tempConnectionStart) {
        // Find drop target
        let w = screenToWorld(mouseX, mouseY);
        let mx = w.x;
        let my = w.y;

        let target = null;
        for (let n of neurons) {
            if (n.isMouseOver(mx, my) && n !== tempConnectionStart) {
                target = n;
                break;
            }
        }
        // Also check outputs as synapse targets
        if (!target) {
            for (let o of outputs) {
                if (o.isMouseOver(mx, my) && o !== tempConnectionStart) {
                    target = o;
                    break;
                }
            }
        }

        if (target) {
            // Check if exists
            let exists = synapses.find(s => s.from === tempConnectionStart && s.to === target);
            if (!exists) {
                let s = new Synapse(tempConnectionStart, target);
                synapses.push(s);
                selectElement(s);
            }
        }
        tempConnectionStart = null;
    }
}

function mouseWheel(e) {
    // Zoom toward cursor
    let zoomFactor = e.delta > 0 ? 0.9 : 1.1; // scroll down = zoom out, scroll up = zoom in
    let newZoom = constrain(zoomLevel * zoomFactor, 0.25, 3.0);

    // Adjust offset so that world point under cursor stays fixed
    // Before zoom: worldX = (mouseX - viewOffset.x) / zoomLevel
    // After zoom:  worldX = (mouseX - newOffset.x) / newZoom
    // Set equal: newOffset.x = mouseX - worldX * newZoom
    let worldX = (mouseX - viewOffset.x) / zoomLevel;
    let worldY = (mouseY - viewOffset.y) / zoomLevel;

    zoomLevel = newZoom;
    viewOffset.x = mouseX - worldX * zoomLevel;
    viewOffset.y = mouseY - worldY * zoomLevel;

    return false; // Prevent page scroll
}

function doubleClicked(e) {
    if (e && e.target.tagName !== 'CANVAS') return;
    let w = screenToWorld(mouseX, mouseY);
    let mx = w.x;
    let my = w.y;

    // Double-click on a ManualButton to fire it
    for (let b of buttons) {
        if (b.isMouseOver(mx, my)) {
            b.press();
            return;
        }
    }
}

// === LOGIC GATES ===
let gateType = 'and'; // 'and', 'or', 'not'

window.setGateType = function (type) {
    gateType = type;
    setMode('gate');
}

function spawnLogicGate(type, x, y) {
    let created = { neurons: [], synapses: [], notes: [] };

    if (type === 'and') {
        // AND Gate: 2 inputs → 1 output, threshold 1.8 so both must fire
        let inA = new Neuron(x - 80, y - 40);
        let inB = new Neuron(x - 80, y + 40);
        let out = new Neuron(x + 40, y);
        out.thresh = 1.8;
        out.refractoryPeriod = 1;

        neurons.push(inA, inB, out);

        let sA = new Synapse(inA, out);
        sA.weight = 1.0;
        let sB = new Synapse(inB, out);
        sB.weight = 1.0;
        synapses.push(sA, sB);

        // Label note
        let note = new Note(x - 20, y - 70, 'AND Gate', [inA, inB, out]);
        note.minimized = true;
        notes.push(note);

        created = { neurons: [inA, inB, out], synapses: [sA, sB], notes: [note] };

    } else if (type === 'or') {
        // OR Gate: 2 inputs → 1 output, threshold 0.8 so either fires it
        let inA = new Neuron(x - 80, y - 40);
        let inB = new Neuron(x - 80, y + 40);
        let out = new Neuron(x + 40, y);
        out.thresh = 0.8;
        out.refractoryPeriod = 1;

        neurons.push(inA, inB, out);

        let sA = new Synapse(inA, out);
        sA.weight = 1.0;
        let sB = new Synapse(inB, out);
        sB.weight = 1.0;
        synapses.push(sA, sB);

        let note = new Note(x - 20, y - 70, 'OR Gate', [inA, inB, out]);
        note.minimized = true;
        notes.push(note);

        created = { neurons: [inA, inB, out], synapses: [sA, sB], notes: [note] };

    } else if (type === 'not') {
        // NOT Gate: 1 input → 1 output (output auto-fires, input inhibits)
        let inp = new Neuron(x - 60, y);
        let out = new Neuron(x + 60, y);
        out.bias = 1.5;  // Auto-firing
        out.refractoryPeriod = 3;

        neurons.push(inp, out);

        let s = new Synapse(inp, out);
        s.weight = -1.0;  // Strong inhibition
        synapses.push(s);

        let note = new Note(x, y - 50, 'NOT Gate', [inp, out]);
        note.minimized = true;
        notes.push(note);

        created = { neurons: [inp, out], synapses: [s], notes: [note] };
    }

    // Select the group
    multiSelection = created.neurons;
    if (created.neurons.length > 0) selectElement(created.neurons[created.neurons.length - 1]);

    return created;
}

// === UI LOGIC ===

function setMode(m) {
    if (m === 'note' && mode === 'note' && noteSelection.length > 0) {
        finalizeNote();
        m = 'move';
    }
    mode = m;
    document.querySelectorAll('.toolbar .btn').forEach(b => b.classList.remove('active'));
    document.getElementById('mode-' + m).classList.add('active');
}

let activeNote = null;

function finalizeNote() {
    // Calculate centroid
    let cx = 0, cy = 0;
    if (noteSelection.length > 0) {
        for (let n of noteSelection) { cx += n.x; cy += n.y; }
        cx /= noteSelection.length;
        cy /= noteSelection.length;
    } else {
        // Fallback to center of screen (relative to viewOffset)
        // Canvas center is width/2, height/2
        // World coordinates = (Screen - Offset)
        cx = width / 2 - viewOffset.x;
        cy = height / 2 - viewOffset.y;
    }

    let n = new Note(cx, cy, "New Note", [...noteSelection]);
    n.minimized = false; // Start expanded
    notes.push(n);
    noteSelection = [];

    // Start Editing
    editNote(n);
}

function editNote(note) {
    activeNote = note;
    let editor = document.getElementById('note-editor');

    // Position editor over note box
    // Note box is at x - 75, y - 115 (w=150, h=100)
    let boxW = 150;
    let boxH = 100;
    // We need screen coordinates
    // viewOffset is translation. Canvas coordinate (cx, cy) -> Screen (cx + viewOffset.x, cy + viewOffset.y)
    let sx = note.x + viewOffset.x - boxW / 2;
    let sy = note.y + viewOffset.y - boxH - 15;

    editor.style.display = 'block';
    editor.style.left = sx + 'px';
    editor.style.top = sy + 'px';
    editor.value = note.text;

    // Use timeout to ensure it happens after current event loop (prevent immediate blur?)
    setTimeout(() => {
        editor.focus();
    }, 50); // Increased timeout slightly
}

function stopEditingNote(e) {
    if (!activeNote) return;
    let editor = document.getElementById('note-editor');
    activeNote.text = editor.value;
    editor.style.display = 'none';
    activeNote = null;
}

// Setup Editor Events
window.addEventListener('load', () => {
    let editor = document.getElementById('note-editor');
    if (editor) {
        editor.addEventListener('input', () => {
            if (activeNote) activeNote.text = editor.value;
        });
        editor.addEventListener('blur', stopEditingNote);
        editor.addEventListener('keydown', (e) => {
            e.stopPropagation(); // Prevent app shortcuts
        });
        editor.addEventListener('mousedown', (e) => e.stopPropagation()); // Prevent canvas click
    }
});


function keyPressed() {
    if (keyCode === ENTER && mode === 'note' && noteSelection.length > 0) {
        finalizeNote();
        setMode('move');
    }
    if (key === 'Delete' || key === 'Backspace') {
        let tag = document.activeElement.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
            deleteSelected();
        }
    }

    // Copy: Ctrl+C / Cmd+C
    let isMeta = keyIsDown(CONTROL) || (navigator.platform.includes('Mac') && keyIsDown(91));
    if (isMeta && key === 'c') {
        copySelection();
    }
    // Paste: Ctrl+V / Cmd+V
    if (isMeta && key === 'v') {
        pasteSelection();
    }
}

function copySelection() {
    let elements = multiSelection.length > 0 ? multiSelection : (selectedElement ? [selectedElement] : []);
    // Filter to only copyable types
    elements = elements.filter(e => e instanceof Neuron || e instanceof Stimulator || e instanceof OutputDisplay);
    if (elements.length === 0) return;

    // Find all synapses between selected elements
    let selectedSet = new Set(elements.map(e => e.id));
    let internalSynapses = synapses.filter(s => selectedSet.has(s.from.id) && selectedSet.has(s.to.id));

    // Compute centroid for relative positioning
    let cx = 0, cy = 0;
    for (let e of elements) { cx += e.x; cy += e.y; }
    cx /= elements.length; cy /= elements.length;

    clipboard = {
        elements: elements.map(e => {
            let base = { id: e.id, x: e.x - cx, y: e.y - cy };
            if (e instanceof Neuron) {
                base.type = 'neuron';
                base.tau = e.tau; base.thresh = e.thresh; base.bias = e.bias;
                base.refractoryPeriod = e.refractoryPeriod;
            } else if (e instanceof Stimulator) {
                base.type = 'stimulator';
                base.stimType = e.type; base.amplitude = e.amplitude;
                base.frequency = e.frequency; base.offset = e.offset; base.phase = e.phase;
            } else if (e instanceof OutputDisplay) {
                base.type = 'output';
                base.label = e.label; base.activationThreshold = e.activationThreshold;
            }
            return base;
        }),
        synapses: internalSynapses.map(s => ({
            fromId: s.from.id, toId: s.to.id, weight: s.weight,
            decay: s.decay, sensitivity: s.sensitivity,
            plasticityMode: s.plasticityMode, baseLearningRate: s.baseLearningRate
        }))
    };
}

function pasteSelection() {
    if (!clipboard) return;

    // Get paste location: center of viewport
    let center = screenToWorld(width / 2, height / 2);

    let idMap = {};
    let newElements = [];

    for (let ed of clipboard.elements) {
        let nx = center.x + ed.x + 40;
        let ny = center.y + ed.y + 40;
        let newEl;
        if (ed.type === 'neuron') {
            newEl = new Neuron(nx, ny);
            newEl.tau = ed.tau; newEl.thresh = ed.thresh; newEl.bias = ed.bias;
            newEl.refractoryPeriod = ed.refractoryPeriod || 1;
            neurons.push(newEl);
        } else if (ed.type === 'stimulator') {
            newEl = new Stimulator(nx, ny);
            newEl.type = ed.stimType; newEl.amplitude = ed.amplitude;
            newEl.frequency = ed.frequency; newEl.offset = ed.offset;
            newEl.phase = ed.phase || 0;
            stimulators.push(newEl);
        } else if (ed.type === 'output') {
            newEl = new OutputDisplay(nx, ny);
            newEl.label = ed.label; newEl.activationThreshold = ed.activationThreshold;
            outputs.push(newEl);
        }
        idMap[ed.id] = newEl;
        newElements.push(newEl);
    }

    for (let sd of clipboard.synapses) {
        let from = idMap[sd.fromId];
        let to = idMap[sd.toId];
        if (from && to) {
            let s = new Synapse(from, to);
            s.weight = sd.weight; s.decay = sd.decay;
            s.sensitivity = sd.sensitivity;
            s.plasticityMode = sd.plasticityMode;
            s.baseLearningRate = sd.baseLearningRate;
            synapses.push(s);
        }
    }

    // Select the new elements
    multiSelection = newElements;
    if (newElements.length === 1) selectElement(newElements[0]);
}

function togglePlay() {
    isPlaying = !isPlaying;
    document.getElementById('btn-play').innerText = isPlaying ? "Pause" : "Play";
}

function resetSim() {
    neurons = [];
    stimulators = [];
    buttons = [];
    outputs = [];
    probes = [];
    notes = [];
    synapses = [];
    multiSelection = [];
    selectElement(null);
}

function clearAll() {
    if (confirm("Clear entire circuit?")) {
        resetSim();
    }
}

function selectElement(el) {
    selectedElement = el;

    const pNone = document.getElementById('no-selection');
    const pNeuron = document.getElementById('neuron-controls');
    const pSynapse = document.getElementById('synapse-controls');
    const pStimulator = document.getElementById('stimulator-controls');
    const pOutput = document.getElementById('output-controls');
    const pProbe = document.getElementById('probe-controls');
    const pButton = document.getElementById('button-controls');

    pNone.style.display = 'none';
    pNeuron.style.display = 'none';
    pSynapse.style.display = 'none';
    if (pStimulator) pStimulator.style.display = 'none';
    if (pOutput) pOutput.style.display = 'none';
    if (pProbe) pProbe.style.display = 'none';
    if (pButton) pButton.style.display = 'none';

    if (!el) {
        pNone.style.display = 'block';
        return;
    }

    if (el instanceof Neuron) {
        pNeuron.style.display = 'block';
        // Populate values
        document.getElementById('inp-thresh').value = el.thresh;
        document.getElementById('val-thresh').innerText = el.thresh.toFixed(1);
        document.getElementById('inp-tau').value = el.tau;
        document.getElementById('val-tau').innerText = el.tau;
        document.getElementById('inp-bias').value = el.bias;
        document.getElementById('val-bias').innerText = el.bias.toFixed(2);
        document.getElementById('inp-refractory').value = el.refractoryPeriod;
        document.getElementById('val-refractory').innerText = el.refractoryPeriod;
    } else if (el instanceof Stimulator) {
        if (pStimulator) pStimulator.style.display = 'block';
        document.getElementById('inp-stim-type').value = el.type;
        document.getElementById('inp-stim-amp').value = el.amplitude;
        document.getElementById('val-stim-amp').innerText = el.amplitude.toFixed(2);
        document.getElementById('inp-stim-freq').value = el.frequency;
    } else if (el instanceof ManualButton) {
        if (pButton) pButton.style.display = 'block';
        document.getElementById('inp-btn-voltage').value = el.voltage;
        document.getElementById('val-btn-voltage').innerText = el.voltage.toFixed(2);
        document.getElementById('inp-btn-duration').value = el.pulseDuration;
        document.getElementById('val-btn-duration').innerText = el.pulseDuration;
    } else if (el instanceof Synapse) {
        pSynapse.style.display = 'block';
        document.getElementById('inp-weight').value = el.weight;
        document.getElementById('val-weight').innerText = el.weight.toFixed(1);

        // Hide neurotransmitter/plasticity controls for generator or output synapses
        let ntControls = document.getElementById('synapse-neurotransmitter-controls');
        if (el.from instanceof Stimulator || el.from instanceof ManualButton || el.to instanceof OutputDisplay) {
            ntControls.style.display = 'none';
        } else {
            ntControls.style.display = 'block';

            // Receptor Params
            document.getElementById('inp-decay').value = el.decay;
            document.getElementById('val-decay').innerText = el.decay.toFixed(2);

            document.getElementById('inp-sensitivity').value = el.sensitivity;
            document.getElementById('val-sensitivity').innerText = el.sensitivity.toFixed(1);

            // Plasticity Ui
            let pMode = el.plasticityMode || 'off';
            let pLr = el.baseLearningRate !== undefined ? el.baseLearningRate : 1.0;

            document.getElementById('inp-plasticity-mode').value = pMode;
            document.getElementById('plasticity-params').style.display = pMode === 'off' ? 'none' : 'block';
            document.getElementById('inp-lr').value = pLr;
            document.getElementById('val-lr').innerText = pLr.toFixed(1);
        }
    } else if (el instanceof OutputDisplay) {
        if (pOutput) pOutput.style.display = 'block';
        document.getElementById('inp-out-label').value = el.label;
        document.getElementById('inp-out-thresh').value = el.activationThreshold;
        document.getElementById('val-out-thresh').innerText = el.activationThreshold.toFixed(2);
    } else if (el instanceof OscilloscopeProbe) {
        if (pProbe) pProbe.style.display = 'block';
    }
}

// Expose these globally for HTML access
window.updateNeuronParam = function (param, val) {
    if (selectedElement instanceof Neuron) {
        selectedElement[param] = parseFloat(val);
        let displayId = param === 'refractoryPeriod' ? 'val-refractory' : 'val-' + param;
        let formatted = param === 'tau' || param === 'refractoryPeriod' ? selectedElement[param].toFixed(0) : selectedElement[param].toFixed(2);
        document.getElementById(displayId).innerText = formatted;
    }
}

window.updateSynapseParam = function (param, val) {
    if (selectedElement instanceof Synapse) {
        if (param === 'plasticityMode') {
            selectedElement.plasticityMode = val;
            document.getElementById('plasticity-params').style.display = val === 'off' ? 'none' : 'block';
        } else {
            selectedElement[param] = parseFloat(val);
            // Special formatting
            let decimals = 1;
            if (param === 'decay') decimals = 2;
            let valEl = document.getElementById('val-' + (param === 'baseLearningRate' ? 'lr' : param));
            if (valEl) valEl.innerText = selectedElement[param].toFixed(decimals);
        }
    }
}

window.updateStimulatorParam = function (param, val) {
    if (selectedElement instanceof Stimulator) {
        if (param === 'type') {
            selectedElement.type = val;
        } else {
            selectedElement[param] = parseFloat(val);
            // Map param names to their shortened HTML element ID suffixes
            const paramIdMap = { amplitude: 'amp', frequency: 'freq', offset: 'offset', phase: 'phase' };
            let idSuffix = paramIdMap[param] || param;
            let el = document.getElementById('val-stim-' + idSuffix);
            if (el) el.innerText = selectedElement[param].toFixed(2);
        }
    }
}

window.updateOutputParam = function (param, val) {
    if (selectedElement instanceof OutputDisplay) {
        if (param === 'label') {
            selectedElement.label = val;
        } else {
            selectedElement[param] = parseFloat(val);
            let el = document.getElementById('val-out-' + (param === 'activationThreshold' ? 'thresh' : param));
            if (el) el.innerText = selectedElement[param].toFixed(2);
        }
    }
}

window.updateButtonParam = function (param, val) {
    if (selectedElement instanceof ManualButton) {
        if (param === 'pulseDuration') {
            selectedElement.pulseDuration = parseInt(val);
            document.getElementById('val-btn-duration').innerText = val;
        } else {
            selectedElement[param] = parseFloat(val);
            let el = document.getElementById('val-btn-' + param);
            if (el) el.innerText = selectedElement[param].toFixed(2);
        }
    }
}

window.deleteSelected = function () {
    // Multi-delete
    let toDelete = multiSelection.length > 0 ? [...multiSelection] : (selectedElement ? [selectedElement] : []);
    for (let el of toDelete) {
        if (el instanceof Neuron) {
            synapses = synapses.filter(s => s.from !== el && s.to !== el);
            neurons = neurons.filter(n => n !== el);
            for (let note of notes) {
                note.targetIds = note.targetIds.filter(id => id !== el.id);
            }
        } else if (el instanceof Stimulator) {
            synapses = synapses.filter(s => s.from !== el);
            stimulators = stimulators.filter(s => s !== el);
        } else if (el instanceof ManualButton) {
            synapses = synapses.filter(s => s.from !== el);
            buttons = buttons.filter(b => b !== el);
        } else if (el instanceof OutputDisplay) {
            synapses = synapses.filter(s => s.to !== el);
            outputs = outputs.filter(o => o !== el);
        } else if (el instanceof Synapse) {
            synapses = synapses.filter(s => s !== el);
        } else if (el instanceof Note) {
            notes = notes.filter(n => n !== el);
        } else if (el instanceof OscilloscopeProbe) {
            probes = probes.filter(p => p !== el);
        }
    }
    multiSelection = [];
    selectElement(null);
}

window.updateOscilloscope = function () {
    let container = document.getElementById('oscilloscope');
    container.innerHTML = '';

    if (selectedElement instanceof Neuron) {
        let h = 100;
        let w = container.clientWidth;
        let data = selectedElement.history || [];

        // Choose display range
        const V_MIN = -2.0;
        const V_MAX = 2.0;
        const V_RANGE = V_MAX - V_MIN || 1;

        let pathPoints = data.map((v, i) => {
            let x = (i / Math.max(data.length - 1, 1)) * w;

            // Clamp to range and map V_MIN -> bottom, V_MAX -> top
            let vv = Math.max(V_MIN, Math.min(v, V_MAX));
            let y = h - ((vv - V_MIN) / V_RANGE) * h;

            return `${x},${y}`;
        }).join(' ');

        let ns = "http://www.w3.org/2000/svg";
        let svg = document.createElementNS(ns, "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");

        let polyline = document.createElementNS(ns, "polyline");
        polyline.setAttribute("points", pathPoints);
        polyline.setAttribute("class", "graph-line");

        svg.appendChild(polyline);
        container.appendChild(svg);
    }
}

// === SAVE / LOAD ===

window.saveCircuit = function () {
    let data = {
        neurons: neurons.map(n => ({
            id: n.id, x: n.x, y: n.y, tau: n.tau, thresh: n.thresh, bias: n.bias, refractoryPeriod: n.refractoryPeriod
        })),
        stimulators: stimulators.map(s => ({
            id: s.id, x: s.x, y: s.y, type: s.type, amplitude: s.amplitude, frequency: s.frequency, offset: s.offset, phase: s.phase
        })),
        outputs: outputs.map(o => ({
            id: o.id, x: o.x, y: o.y, label: o.label, activationThreshold: o.activationThreshold
        })),
        synapses: synapses.map(s => ({
            fromId: s.from.id, toId: s.to.id, weight: s.weight,
            decay: s.decay, sensitivity: s.sensitivity,
            plasticityMode: s.plasticityMode, baseLearningRate: s.baseLearningRate
        })),
        probes: probes.map(p => ({
            id: p.id, x: p.x, y: p.y, targetId: p.target ? p.target.id : null
        })),
        buttons: buttons.map(b => ({
            id: b.id, x: b.x, y: b.y, voltage: b.voltage, pulseDuration: b.pulseDuration
        })),
        notes: notes.map(n => ({
            id: n.id, x: n.x, y: n.y, text: n.text, minimized: n.minimized, targetIds: n.targetIds
        }))
    };
    let blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = 'circuit.json';
    a.click();
}

window.loadCircuit = function (input) {
    let file = input.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = function (e) {
        try {
            let data = JSON.parse(e.target.result);
            resetSim();

            // Recreate Neurons
            let idMap = {};
            for (let nd of data.neurons) {
                let n = new Neuron(nd.x, nd.y);
                n.id = nd.id;
                n.tau = nd.tau;
                n.thresh = nd.thresh;
                n.bias = nd.bias;
                n.refractoryPeriod = nd.refractoryPeriod !== undefined ? nd.refractoryPeriod : 1;
                neurons.push(n);
                idMap[n.id] = n;
            }

            if (data.stimulators) {
                for (let sd of data.stimulators) {
                    let s = new Stimulator(sd.x, sd.y);
                    s.id = sd.id;
                    s.type = sd.type;
                    s.amplitude = sd.amplitude;
                    s.frequency = sd.frequency;
                    s.offset = sd.offset;
                    s.phase = sd.phase || 0;
                    stimulators.push(s);
                    idMap[s.id] = s;
                }
            }

            if (data.outputs) {
                for (let od of data.outputs) {
                    let o = new OutputDisplay(od.x, od.y);
                    o.id = od.id;
                    o.label = od.label || 'Output';
                    o.activationThreshold = od.activationThreshold !== undefined ? od.activationThreshold : 0.5;
                    outputs.push(o);
                    idMap[o.id] = o;
                }
            }

            // Recreate Buttons
            if (data.buttons) {
                for (let bd of data.buttons) {
                    let b = new ManualButton(bd.x, bd.y);
                    b.id = bd.id;
                    b.voltage = bd.voltage !== undefined ? bd.voltage : 1.5;
                    b.pulseDuration = bd.pulseDuration !== undefined ? bd.pulseDuration : 10;
                    buttons.push(b);
                    idMap[b.id] = b;
                }
            }

            // Recreate Synapses
            for (let sd of data.synapses) {
                let fromN = idMap[sd.fromId];
                let toN = idMap[sd.toId];
                if (fromN && toN) {
                    let s = new Synapse(fromN, toN);
                    s.weight = sd.weight;
                    if (sd.decay !== undefined) s.decay = sd.decay;
                    if (sd.sensitivity !== undefined) s.sensitivity = sd.sensitivity;
                    if (sd.plasticityMode !== undefined) s.plasticityMode = sd.plasticityMode;
                    if (sd.baseLearningRate !== undefined) s.baseLearningRate = sd.baseLearningRate;
                    synapses.push(s);
                }
            }

            // Recreate Probes
            if (data.probes) {
                for (let pd of data.probes) {
                    let target = idMap[pd.targetId];
                    if (target) {
                        let p = new OscilloscopeProbe(pd.x, pd.y, target);
                        p.id = pd.id;
                        probes.push(p);
                    }
                }
            }

            // Recreate Notes
            if (data.notes) {
                for (let nd of data.notes) {
                    let n = new Note(nd.x, nd.y, nd.text || 'Note', []);
                    n.id = nd.id;
                    n.minimized = nd.minimized !== undefined ? nd.minimized : true;
                    n.targetIds = nd.targetIds || [];
                    notes.push(n);
                }
            }
        } catch (err) {
            alert("Error loading circuit: " + err);
        }
    };
    reader.readAsText(file);
}

// === PRESETS ===
window.loadPreset = function (type) {
    resetSim();
    let cx = windowWidth / 2;
    let cy = windowHeight / 2;

    if (type === 'chain') {
        let n1 = new Neuron(cx - 150, cy); n1.bias = -0.7; // pacemaker
        let n2 = new Neuron(cx, cy);
        let n3 = new Neuron(cx + 150, cy);
        neurons.push(n1, n2, n3);
        synapses.push(new Synapse(n1, n2), new Synapse(n2, n3));
    } else if (type === 'oscillator') {
        let n1 = new Neuron(cx - 60, cy); n1.bias = -0.7;
        let n2 = new Neuron(cx + 60, cy); n2.bias = -0.7;
        neurons.push(n1, n2);
        let s1 = new Synapse(n1, n2); s1.weight = 0.8;
        let s2 = new Synapse(n2, n1); s2.weight = 0.8;
        // Kickstart
        n1.voltage = 0.9;
        synapses.push(s1, s2);
    } else if (type === 'balanced') {
        // Random network
        for (let i = 0; i < 8; i++) {
            let n = new Neuron(cx + random(-200, 200), cy + random(-200, 200));
            n.bias = 0.9 + random(0.2); // some active
            neurons.push(n);
        }
        for (let i = 0; i < 15; i++) {
            let a = random(neurons);
            let b = random(neurons);
            if (a !== b) {
                let s = new Synapse(a, b);
                s.weight = random() > 0.5 ? 0.8 : -0.8;
                synapses.push(s);
            }
        }
    }
}

// Math Helper
function sqr(x) { return x * x }
function dist2(v, w) { return sqr(v.x - w.x) + sqr(v.y - w.y) }
function distToSegmentSquared(p, v, w) {
    var l2 = dist2(v, w);
    if (l2 == 0) return dist2(p, v);
    var t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist2(p, {
        x: v.x + t * (w.x - v.x),
        y: v.y + t * (w.y - v.y)
    });
}
function distToSegment(p, v, w) { return Math.sqrt(distToSegmentSquared(p, v, w)); }
