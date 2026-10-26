# Interface Map Visualization

**Status:** Implemented  
**Last Updated:** 2025-12-07

## Overview

The Interface Map provides a visual representation of the application landscape and the integrations between systems. It supports two distinct views to serve different audiences:

1.  **Business View:** Focuses on logical connections between business applications. Middleware and technical routing details are hidden to provide a clean, high-level overview.
2.  **Technical View:** Displays the full routing path, including middleware, ETL tools, and multiple "legs" of an interface.

## Technology Stack

-   **Rendering:** SVG (Scalable Vector Graphics) for crisp, resolution-independent visuals.
-   **Layout Engine:** [D3.js](https://d3js.org/) (`d3-force`) for physics-based, organic graph layout.
-   **Interactivity:** D3 Drag behavior for node manipulation, React state for selection and filtering.

## Key Features

### 1. Layout & Physics
The map uses a force-directed graph simulation (`d3.forceSimulation`) with the following forces:
-   **Link Force:** Pulls connected nodes together.
-   **Charge Force:** Repels nodes from each other to prevent overlap (simulating electrostatic repulsion).
-   **Center Force:** Keeps the graph centered in the viewport.
-   **Collision Force:** Prevents nodes from physically overlapping, with dynamic radii based on node type (Applications vs. Middleware).

### 2. "Highway" Parallel Edge Layout
To handle multiple interfaces between the same two applications without visual clutter or overlap, the map uses a **Parallel Straight Lines** (“Highway”) layout strategy:

-   **Straight Lines:** All connections are rendered as straight lines, avoiding the visual complexity of Bezier curves.
-   **Canonical Pairing (A–B):**
    -   For each interface link we derive a *canonical* unordered pair of applications `(A, B)` based on the two application IDs.
    -   The pair is ordered by ID (`min(idA, idB) → max(idA, idB)`) and used purely to compute a stable center line and its perpendicular normal.
    -   All links between the same two apps, in either direction, share this canonical center line.
-   **Directional “Lanes”:**
    -   Within each `(A, B)` pair, links are split into two lanes:
        -   **Forward lane:** links whose actual direction is `A → B`.
        -   **Reverse lane:** links whose actual direction is `B → A`.
    -   A → B links are offset on one side of the center line.
    -   B → A links are offset on the opposite side (the offset sign is inverted).
    -   This creates a clear, two-sided “highway” where traffic flows in opposite directions on separated lanes.
-   **Stacking Within a Lane:**
    -   If there are multiple interfaces in the same direction (e.g. three links from A → B), they are stacked *within that lane*:
        -   Link 1 uses an offset of `0.5 × LINK_SPACING`.
        -   Link 2 uses `1.5 × LINK_SPACING`.
        -   Link 3 uses `2.5 × LINK_SPACING`, and so on.
    -   This ensures each interface remains a distinct, non-overlapping line with its own arrowhead.
-   **Ray-Box Intersection:** To ensure lines connect cleanly to the edge of the rectangular (or diamond) nodes regardless of their offset, a robust ray–box intersection algorithm calculates the exact connection point on the node boundary.

> **Maintenance Note:**  
> The highway behavior depends on:
> - Grouping links by *unordered* application pair (A–B) to find the shared center line.
> - Using a *canonical* normal vector derived from that pair for all links in both directions.
> - Applying lane offsets via a signed multiplier (`+1` for A → B, `-1` for B → A) and a half-step `(index + 0.5)` factor.  
> When changing the link geometry in `InterfaceMapGraph.tsx`, preserve this pattern to avoid regressing to overlapping bidirectional lines.

### 3. View Modes

#### Business View
-   **Nodes:** Displays only Business Applications.
-   **Filtering:** Middleware applications (`isMiddleware: true`) are strictly filtered out.
-   **Links:** Shows logical interfaces directly between source and target applications.
-   **Goal:** Show "Who talks to whom" from a business process perspective.

#### Technical View
-   **Nodes:** Displays Business Applications AND Middleware/ETL nodes.
-   **Links:** Shows the physical routing. An interface routed via middleware (App A → Middleware → App B) is visualized as two links: A → Middleware and Middleware → B.
-   **Goal:** Show the actual data flow and infrastructure dependencies.

### 4. Labels & Hit Areas

-   **Embedded, Rotated Labels:**
    -   Each interface label (Interface ID) is positioned directly *on* its lane, not offset away from the line.
    -   Labels are rotated to be parallel to the link segment and centered vertically on the stroke using `text-anchor="middle"` and `dominant-baseline="middle"`.
    -   Within each lane, labels are distributed along the line via a `0 < t < 1` fraction so they do not all pile up in the middle (e.g. 25%, 50%, 75% for three links).
-   **Halo Over the Line:**
    -   Labels use a light stroke (`paint-order: stroke`) to create a halo that visually masks the line under the text instead of cutting the line geometry.
    -   This keeps the topology intact while saving vertical space and making labels clearly associated with their link.
-   **Dual-Path Hit Zones:**
    -   Each link is rendered as:
        -   A thin visual path (`.links path.visual`) with the actual stroke and arrowhead.
        -   A wider invisible hit path (`.links path.hit`) used solely for pointer events.
    -   The hit path has a transparent stroke with a larger width (click band) and `pointer-events: stroke`, making links easy to click even when labels sit directly on the line.

### 5. Node Shapes & Middleware Scaling

-   **Application Nodes:**
    -   Rendered as rounded rectangles of fixed size (`NODE_WIDTH × NODE_HEIGHT`).
    -   Show application name and total interface count.
-   **Middleware Nodes:**
    -   Rendered as rotated squares (diamonds), visually distinct from applications.
    -   Size is dynamic: `mwSize = baseSize + k × totalInterfaces`, clamped to a maximum, so high-traffic middleware nodes appear larger and easier to target.
    -   The same `mwSize` is used consistently for:
        -   The rendered diamond.
        -   The collision radius in the force simulation.
        -   The ray–box intersection used to clip link endpoints to the node boundary.

### 6. Responsive Layout

-   **Adaptive Height:** The graph adapts to viewport size using `calc(100vh - 220px)` with a minimum height of 400px, maximizing visible area for large graphs.
-   **Width:** The graph fills 100% of the available horizontal space, accommodating the side panel when open.

### 7. Interactions & Controls

-   **Freeze / Unfreeze Layout:**
    -   A vertical control bar on the left of the map includes a Freeze toggle.
    -   When *unfrozen*:
        -   The force simulation runs normally, and small alpha bumps on drag allow the layout to relax.
    -   When *frozen*:
        -   The simulation is stopped; nodes no longer react to each other.
        -   Dragging a node updates only that node's position (and its attached links/labels); the rest of the graph remains fixed.
    -   This allows users to "lock in" a layout and then adjust specific items without disturbing the whole map.
-   **Zoom & Pan:**
    -   D3 zoom is attached to the root `<svg>`:
        -   Mouse wheel zooms in/out.
        -   Dragging the background pans the view.
    -   The left control bar includes explicit zoom-in and zoom-out buttons powered by the same D3 zoom behavior.
-   **Auto-Center on Selection:**
    -   An "auto-center" toggle controls whether the viewport recenters on the currently selected node or link.
    -   When enabled:
        -   For nodes, the graph uses simulation coordinates (`x`, `y`) from the node datum.
        -   For links, it uses precomputed label geometry (`labelX`, `labelY`) attached to the link datum.
        -   The D3 zoom behavior's `translateTo` helper is used to smoothly pan the view so the selected item moves to the viewport center, without changing the current zoom level.
    -   When disabled, selection only changes styling and the side panel; the "camera" stays where the user left it.
-   **Snap to Grid:**
    -   Grid icon button in left toolbar
    -   Aligns all nodes to a 50px grid for cleaner, more organized layouts
    -   Useful for creating documentation screenshots or presentations
-   **Export Controls:**
    -   **SVG Export**: "SVG" text button exports the current view as a vector graphic (`interface-map.svg`)
        -   Clean, scalable output suitable for embedding in documents or further editing
        -   Removes invisible hit areas but preserves all visual elements
    -   **PNG Export**: "PNG" text button exports the current view as a raster image (`interface-map.png`)
        -   Rendered at 2x resolution for clarity
        -   Note: Browser SVG-to-canvas conversion may produce minor rendering artifacts; use SVG export for production-quality output

### 8. Side Panel & Navigation

-   **Selection Details Panel:**
    -   Selecting an application node or interface link opens a details panel on the right of the map.
    -   For applications, the panel shows name, description, publisher, criticality, servers grouped by environment (items are `Server name`, environment conveyed by the group header), business owners, IT owners, and support contacts (click → Application workspace “Technical & Support” tab). Chips were removed to match the Connection Map styling.
    -   For interfaces, the panel summarizes criticality, route type, bindings count, middleware usage, environment-specific endpoints (source/target endpoints per leg), and linked infra connections for the current environment. Linked infra connections now show connection name/ID, source endpoint (server/cluster/entity), destination endpoint, protocol labels, and binding env/leg (chips removed).
-   **Edit & Cross-Map Navigation:**
    -   The panel exposes “Open application” and “Open interface” buttons that deep-link into the corresponding IT Landscape workspaces:
        -   Applications: `/it/applications/:id/overview`
        -   Interfaces: `/it/interfaces/:id/overview`
    -   For interfaces, each linked infra connection in the side panel provides:
        -   “Edit” → `/it/connections/:id/overview`
        -   “View in Connection Map” → `/it/connection-map?environment=<env>&lifecycles=<connection_lifecycle>&focusConnectionId=<connection_id>&rootIds=<serverIds>&depth=1` (preselects all servers participating in the linked connection and limits depth to 1)
    -   This makes the map both a visualization tool and a quick entry point into editing workflows and infra-level analysis.

## Implementation Details

-   **Component:** `src/pages/it/components/InterfaceMapGraph.tsx`
-   **Data Transformation & Cross-Map Integration:** `src/pages/it/InterfaceMapPage.tsx` handles the logic for:
    -   `buildBusinessGraph` (filtering middleware) and `buildTechnicalGraph` (expanding middleware legs).
    -   Fetching linked infra connections for a selected interface via `GET /interfaces/:id/connection-links?environment=...`.
    -   Driving “View in Connection Map” deep-links using the `focusConnectionId` URL parameter plus optional `rootIds`/`depth` to preselect nodes and limit depth.

## Export & Layout Tools

### Snap to Grid
- Button: Grid icon in left toolbar
- Function: `snapToGrid(gridSize = 50)` in `InterfaceMapGraph.tsx`
- Behavior: Rounds all node `x`, `y` coordinates to nearest grid point (default 50px); updates pinned positions (`fx`, `fy`) if set
- Use case: Clean up organic layouts, align nodes for documentation screenshots

### SVG Export
- Button: "SVG" text button in left toolbar
- Function: `exportSvg()` in `InterfaceMapGraph.tsx`
- Implementation:
  - Clones live SVG, sets explicit dimensions and viewBox
  - Removes invisible hit areas (`path.hit`)
  - Serializes to SVG string and downloads as `interface-map.svg`
- Output: Clean vector graphic, suitable for embedding in documents or further editing

### PNG Export
- Button: "PNG" text button in left toolbar
- Function: `exportPng()` in `InterfaceMapGraph.tsx`
- Implementation:
  - Clones SVG and applies cleanup (removes hit areas, drop-shadow filters, defs/markers, main `<g>` transform)
  - Adds explicit background rect (`#F8FAFC`)
  - Uses `OffscreenCanvas` (if available) or regular canvas
  - Renders SVG to canvas via Image element at 2x scale, exports as PNG
- Output: `interface-map.png` at 2x resolution for clarity
- Known limitation: Browser SVG-to-canvas rendering may produce minor artifacts (gray lines, anti-aliasing issues); use SVG export for production-quality output

## Future Evolution Guidelines

-   **Adding Node Types:** Update `MapGraphNode` type and the rendering logic in `InterfaceMapGraph.tsx`. Ensure the collision radius is updated if new shapes are introduced.
-   **Adjusting Layout:** Tweak the force parameters (strength, distance) in the `useEffect` hook in `InterfaceMapGraph.tsx`.
-   **Styling:** Colors and dimensions are defined as constants (`NODE_WIDTH`, `MW_SIZE`, colors). Use the MUI `theme` where possible for consistency.
-   **Performance:** The current SVG implementation handles hundreds of nodes well. For extremely large graphs (1000+ nodes), consider reverting to Canvas or WebGL, but note that this trades off the crispness of text and lines.

## Maintenance Notes

### Adding/Modifying Export Features
- Export logic is in `InterfaceMapGraph.tsx` within the `onRegisterGraphControls` callback
- Both SVG and PNG exports use the same cleanup pipeline:
  1. Clone the live SVG
  2. Remove elements that shouldn't be exported (`.hit` paths, etc.)
  3. Set explicit dimensions and viewBox
  4. For PNG: additional canvas rendering step
- When adding new SVG elements (filters, masks, patterns), test both export modes to ensure they render correctly
- PNG export removes filters and transforms to avoid canvas rendering issues; if new visual effects are added, consider their export behavior

### Graph Controls API
- Type: `GraphControlsApi` in `InterfaceMapGraph.tsx`
- Exposes: `zoomIn()`, `zoomOut()`, `snapToGrid()`, `exportSvg()`, `exportPng()`
- Registration: via `onRegisterGraphControls` prop, stored in parent page's `graphControlsRef`
- To add new controls: extend `GraphControlsApi` type, implement in graph component, add UI button in page component
- **Note:** Both Interface Map and Connection Map use the same `GraphControlsApi` pattern for consistency
