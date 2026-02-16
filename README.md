# Neural Circuit Simulator

A real-time, interactive neural network simulator built with [p5.js](https://p5js.org/). Drag-and-drop neurons, wire them together with synapses, and watch electrical signals propagate through your circuit in real time.

![Built with p5.js](https://img.shields.io/badge/Built_with-p5.js-ED225D?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript-F7DF1E?style=flat-square)

---

## Getting Started

```bash
# Clone or download the project, then serve it locally:
python3 -m http.server 8042

# Open in your browser:
# http://localhost:8042
```

No build step or dependencies required — just HTML, CSS, and JavaScript.

---

## Core Concepts

### Neuron (Leaky Integrate-and-Fire)

The fundamental unit of the simulator. Each neuron accumulates incoming current, and when its voltage reaches the **threshold**, it fires a spike and resets.

| Parameter | Range | Description |
|---|---|---|
| **Threshold** | 0.1 – 2.0 | Voltage required to fire a spike |
| **Time Constant (τ)** | 5 – 100 ms | How quickly voltage decays toward rest |
| **Bias Current** | -0.5 – 2.0 | Constant input current injection |
| **Refractory Period** | 0 – 30 ms | Dead time after spike where neuron cannot fire |

- **Visual feedback**: Inner fill shows current voltage level; white flash on spike
- **Firing rate**: Displayed as a smoothed average above each neuron
- **Voltage history**: 100-frame rolling buffer, viewable in the sidebar oscilloscope

### Synapse

Connections between neurons with a biophysical conductance-based model.

| Parameter | Range | Description |
|---|---|---|
| **Weight** | -1.0 – 1.0 | Positive = excitatory (green), negative = inhibitory (red) |
| **Reuptake Rate** | 0.01 – 0.5 | Rate of neurotransmitter clearance from the synapse |
| **Receptor Sensitivity** | 0.1 – 5.0 | Magnitude of post-synaptic response |

- **Conductance-based current**: `I = g × (E_rev - V)` where `E_rev` depends on excitatory/inhibitory type
- **Particle animation**: Colored particles travel along the synapse wire when a spike is transmitted
- **Curved wires**: Duplicate synapses between neuron pairs automatically curve to avoid overlap
- **Direction arrows**: Mid-wire triangle shows signal flow direction

### Signal Generator

Continuous waveform generator that injects current into connected neurons.

| Parameter | Description |
|---|---|
| **Type** | `Constant`, `Sine`, `Square`, `Pulse` |
| **Amplitude** | Output strength (0 – 5) |
| **Frequency** | Oscillation rate in Hz |
| **Offset** | DC offset added to the waveform |
| **Phase** | Phase shift of the waveform |

- Synapses from generators default to **weight 1.0**
- Synapse properties panel shows only the weight slider (no neurotransmitter controls)

### Manual Button

A clickable one-shot pulse generator. **Double-click** it to fire, or use the **⚡ Fire** button in the properties panel.

| Parameter | Range | Description |
|---|---|---|
| **Voltage** | 0.1 – 5.0 | Strength of the pulse sent on press |
| **Pulse Duration** | 1 – 60 frames | How many frames the pulse remains active |

- Visual press animation with cyan glow effect
- Synapses from buttons default to **weight 1.0**

### Output Display

Monitors incoming signal and triggers floating text events when activation threshold is crossed.

| Parameter | Description |
|---|---|
| **Label** | Custom name for the output |
| **Activation Threshold** | Signal level required to trigger |

### Note

Annotation labels that can be placed anywhere on the canvas. Click in **Note mode** to create a new note; click the note icon to expand/collapse; click the text box to edit.

- Can be linked to specific neurons during creation
- Dashed lines connect the note to its linked neurons

---

## Advanced Features

### Neural Plasticity

Synapses support two learning rules that dynamically adjust connection weights based on neural activity:

#### STDP (Spike-Timing-Dependent Plasticity)
- **Pre-before-post** → weight increases (LTP, green spark)
- **Post-before-pre** → weight decreases (LTD, red spark)
- Configurable time constants (`τ+`, `τ-`) and learning rates (`A+`, `A-`)
- Trace-based implementation for biological realism

#### BCM (Bienenstock-Cooper-Munro)
- Sliding threshold based on post-synaptic firing rate history
- Above threshold → potentiation; below → depression
- Homeostatic mechanism prevents runaway excitation

### Logic Gate Neurons

Pre-configured neuron groups that function as digital logic gates:

| Gate | Inputs | Behavior |
|---|---|---|
| **AND** | 2 → 1 | Output fires only when **both** inputs fire (threshold 1.8) |
| **OR** | 2 → 1 | Output fires when **either** input fires (threshold 0.8) |
| **NOT** | 1 → 1 | Output fires continuously; input **inhibits** it |

- Placed via the **Logic Gates ▾** dropdown in the toolbar
- Each gate includes auto-generated labels

### Oscilloscope Probe

Standalone draggable voltage trace display that attaches to any neuron.

- 120-frame rolling history with green trace on dark background
- Threshold indicator line (red dashed)
- Thin dashed connecting line to the target neuron
- Multiple probes can be attached to different neurons simultaneously

---

## Canvas & Interaction

### Navigation

| Action | Effect |
|---|---|
| **Click + drag** empty space | Pan the canvas |
| **Mouse wheel** | Zoom in/out (0.25× – 3.0×), centered on cursor |

### Selection & Editing

| Action | Effect |
|---|---|
| **Click** | Select a neuron, synapse, generator, button, output, or note |
| **Shift + click** | Toggle element in/out of multi-selection |
| **Shift + drag** on empty space | Rubber-band selection rectangle |
| **Click** selected group member | Start group drag |
| **Double-click** a button | Fire the button |

### Multi-Select & Clipboard

| Shortcut | Effect |
|---|---|
| **Ctrl/⌘ + C** | Copy selected elements |
| **Ctrl/⌘ + V** | Paste with offset |
| **Delete / Backspace** | Delete all selected elements |

### Creating Connections

1. Switch to **Add Synapse** mode
2. Click and drag from a source (Neuron, Generator, or Button)
3. Release on a target (Neuron or Output)
4. Duplicate connections are automatically prevented

---

## Toolbar Reference

| Button | Mode | Description |
|---|---|---|
| **Move** | `move` | Select, drag, and edit elements |
| **Add Neuron** | `neuron` | Click canvas to place a new neuron |
| **Add Synapse** | `synapse` | Drag from source to target to create a connection |
| **Add Generator** | `stimulator` | Click canvas to place a waveform generator |
| **Add Button** | `button` | Click canvas to place a manual pulse button |
| **Add Output** | `output` | Click canvas to place an output monitor |
| **Add Probe** | `probe` | Click a neuron to attach an oscilloscope probe |
| **Logic Gates ▾** | `gate` | Dropdown: AND, OR, NOT gate placement |
| **Add Note** | `note` | Click canvas to create an annotation |
| **Pause / Play** | — | Toggle simulation |
| **Reset** | — | Clear all elements |

---

## Save & Load

- **Save**: Downloads the circuit as a `.json` file containing all neurons, synapses, generators, buttons, outputs, probes, and their parameters
- **Load**: Upload a previously saved `.json` file to restore a circuit

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Rendering** | [p5.js](https://p5js.org/) (canvas-based, 60fps) |
| **UI** | Vanilla HTML + CSS with glassmorphism design |
| **Logic** | Vanilla JavaScript (single `app.js`) |
| **Styling** | CSS custom properties, backdrop-filter blur |

---

## Project Structure

```
Neural_Circuit_Simulator/
├── index.html    # HTML structure, toolbar, sidebar panels
├── app.js        # All simulation logic, classes, and interaction handlers
├── style.css     # Dark theme styling with glassmorphism effects
└── README.md     # This file
```

---

## License

This project is provided as-is for educational and research purposes.
