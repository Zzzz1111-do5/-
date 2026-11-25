# BMPT "Terminator" game asset — project conventions (READ FIRST)

## 1. Goal

Build, entirely by script (Blender 4.2 LTS Python), a **game-ready 3D model of the Russian BMPT
"Terminator" (Object 199 "Ramka")** tank-support combat vehicle that matches the real vehicle as
closely as the references allow, with a full set of animations, exported as GLB (+ FBX).

**Target configuration:** the Russian Army service vehicle (first shown at the 9 May 2018 Moscow
Victory Day parade, in service in the 2020s; T-90A-based chassis; twin 30 mm 2A42 autocannon,
4 x 9M120 Ataka missiles, coaxial PKTM, two AG-17D grenade launchers in the bow fenders).
NOT the BMPT-72 "Terminator-2" and NOT the early-2000s prototypes. Exact configuration details
come from `docs/research/SUMMARY.md` once it exists; that file overrides anything stated here.

**Quality bar:** someone who knows the vehicle should find every major assembly in the right
place with the right proportions. Dimensions come from references, not guesses. Where something
is uncertain, say so in your report and in a code comment; never silently invent.

## 2. Toolchain

- Blender is used as the Python module **`bpy` 4.2.23 LTS** inside the repo venv. There is **no
  `blender` executable**. Run things from the repo root with the wrapper:
  `./blpy path/to/script.py args...` or `./blpy -m package.module args...`
  (wrapper = venv Python 3.11 with `PYTHONPATH` = repo root, so `import tankkit`, `import bmpt` work).
  Scripts get their arguments from `sys.argv` (argparse) like any Python program.
- Render engine: **CYCLES on CPU only**. Never set the engine to EEVEE or Workbench — there is no
  GPU/EGL in this container and the process dies.
- The machine has 4 CPU cores and ~15 GB RAM **shared by several agents**. Keep preview renders
  small (<= 1600 px wide, <= 24 samples, denoising on). Never run two Blender processes at once
  yourself. Use timeouts on long commands. Never leave background processes behind.
- Also available: system `python3` (3.13: Pillow, numpy); `.venv/bin/python` (3.11: bpy, numpy,
  Pillow, OpenCV, scipy); Node 22 with Playwright + Chromium (`require('playwright')` works from
  any directory, `chromium.launch()` with no options); ImageMagick `convert`; `ffmpeg`.
- Extra Python packages: only into the venv (`.venv/bin/python -m pip install X`, then add the
  name to `requirements.txt`). Node packages: only inside a project subfolder (`npm install` there).
  No system-wide installs, no downloading stand-alone executables.
- Blender 4.2 is not Blender 2.8/3.x: several APIs changed (for example `mesh.use_auto_smooth`
  is gone). **Verify every API call by running it** — do not trust memory.

## 3. Units and coordinate system (vehicle frame = Blender world frame)

- Metres. 1 Blender unit = 1 m. Object scale is 1 on everything that is delivered.
- Up = **+Z**. Vehicle **forward = −Y**. Vehicle **left = +X**, right = −X.
  (Blender's glTF exporter then produces glTF +Y up, +Z forward.)
- Origin: on the ground plane (**Z = 0 is the ground**, i.e. the underside of the track's lower
  run on hard ground), on the vehicle centreline (**X = 0**), at the longitudinal midpoint between
  the first and the last road-wheel axle (**Y = 0**).
- Neutral pose: turret straight ahead, guns and launchers at 0 deg elevation, all hatches closed,
  suspension at static ride height, sights looking straight ahead.
- "Left side view" = camera on +X looking toward −X: the nose points to image-left, image-right
  is +Y (rear), image-up is +Z.

## 4. Repository layout and ownership

```
/home/user/-            repo root (git). Agents do NOT commit, push or switch branches.
  blpy                  runner (see 2)
  docs/CONVENTIONS.md   this file (orchestrator-owned)
  docs/research/        research notes (text only, committed)
  docs/TOOLKIT.md       how to use tankkit
  refs/                 downloaded reference images / PDFs. GIT-IGNORED: third-party material,
                        never commit it and never copy it into a committed directory.
  tankkit/              reusable, vehicle-agnostic library (runs inside bpy)
  bmpt/                 the vehicle: spec.py (dimensions), rig.py (node table),
                        parts/*.py (geometry modules), build.py, anim.py, texsets.py
  tools/                command-line tools (render, overlay, stats, bake, export, GLB inspection)
  tests/                self-tests
  out/                  ALL generated intermediate files (.blend, preview renders, temp).
                        GIT-IGNORED. Your temp files go in out/tmp/<your-label>/
  export/               final deliverables (GLB / FBX / textures) — written only by the export stage
  renders/              final beauty renders — written only by the final stage
```

Each agent edits **only the files named as its own in its brief**. If you need a change in a
file you do not own, describe it in your final report instead of editing (unless your brief
explicitly allows it).

## 5. Authoring model

### 5.1 Stages

`parts -> rig -> bake -> anim -> export`

1. **parts** — every `bmpt/parts/<module>.py` exposes `build(ctx)`. It creates mesh objects
   **in vehicle coordinates in the neutral pose** and registers each one with
   `ctx.add(obj, node=..., module=..., mat=...)`.
2. **rig ("collapse")** — for every rig node, the registered objects are merged into ONE mesh
   object named exactly like the node, with its origin at the node pivot and parented according
   to the node table. After this stage the scene contains only node objects (mesh, or empty when
   a node has no geometry). Repeated parts (wheels, track links) keep sharing mesh data.
3. **bake** — UV unwrap per texture set, bake the procedural materials to PBR textures, replace
   the materials with one baked material per texture set.
4. **anim** — animation clips are keyed on node objects; one glTF animation per clip name.
5. **export** — GLB (+ FBX), LODs, collision meshes.

### 5.2 Rig nodes

`bmpt/rig.py` defines `RIG: list[tankkit.rig.Node]`:

```python
@dataclass
class Node:
    name: str                                   # lower_snake_case, unique; becomes the glTF node name
    parent: str | None                          # parent node name (None only for "root")
    pivot: tuple[float, float, float]           # node origin in vehicle coords, neutral pose (m)
    kind: str = "fixed"                         # "fixed" | "rot" | "slide"
    axis: str | None = None                     # "X" | "Y" | "Z": local axis of the motion
    limits: tuple[float, float] | None = None   # degrees for "rot", metres for "slide"
    euler: tuple[float, float, float] = (0.0, 0.0, 0.0)  # pivot orientation vs vehicle axes (rad, XYZ)
    note: str = ""
```

Node local axes equal the vehicle axes in the neutral pose (unless `euler` is given), so e.g.
turret yaw = rotation about node Z, gun elevation = rotation about node X, wheel spin = rotation
about node X, recoil = translation along node Y.
Every mesh object belongs to exactly one node: the rigid body it moves with.

### 5.3 Object tags (custom properties) — the contract between stages and tools

- `obj["node"]`   — rig node name. Set by `ctx.add` in the parts stage.
- `obj["module"]` — authoring module name (parts stage only).
- After the rig stage each node object has `obj["is_node"] = 1` and `obj.name == node.name`.

### 5.4 Naming

lower_snake_case ASCII. Side suffix `_L` / `_R` (vehicle left / right). Index suffix 1-based
counted from the front: `wheel_L1 ... wheel_L6`. Track links: `track_L_000 ...`.

### 5.5 Materials

Assign materials **by name** from the fixed library `tankkit.materials.get(name)`:
`paint`, `paint_dark`, `steel`, `steel_dark`, `track`, `rubber`, `glass`, `lamp`, `canvas`,
`wood`, `brass`, `exhaust`, `plastic`, `tube`.
Do not create ad-hoc materials; if a new one is really needed, say so in your report.

## 6. Geometry standards

- Real geometry at real size. Model what a camera 3–5 m from the vehicle can see: every hatch,
  hinge, handle, periscope, bolt row, bracket, cable, lamp, grille, weld line. Features smaller
  than ~5 mm are skipped (they go to normal maps).
- Hard edges get a small real bevel (1–2 segments; 1.5–6 mm typical, larger on cast or rolled
  edges as the references show) so edges catch light; then smooth shading with sharp edges by
  angle. **No modifiers may remain on an object when `build(ctx)` returns** (apply them).
- Meshes are closed where the real part is solid, with consistent outward normals, no
  zero-area faces. Separate solids may simply intersect (kit-bash style); there is no need to
  boolean-fuse parts together.
- Repeated items (bolts, ERA blocks, track links, wheels, slat bars ...) share mesh data
  (`ctx.instance(...)`).
- Triangle budget, whole vehicle at LOD0: **<= 350k triangles** as rendered. Each brief gives a
  module budget; report your count.

## 7. Reference use

- `docs/research/SUMMARY.md` is the entry point to the references. Once `bmpt/spec.py` exists it
  is the single source of truth for dimensions: parts read primary dimensions from the spec;
  purely local detail dimensions may live in the part module with a comment naming the
  reference image they were taken from.
- Always look at the reference photos for the area you are building (Read tool on files under
  `refs/`; downscale huge images to ~1600–2000 px into `out/tmp/<your-label>/` first).
- Verify by rendering and LOOKING at your render next to the reference. Iterate until it
  matches. "The code runs" is not the finish line.

## 8. Reporting

Your final answer is a concise factual report: what you built, which files, how to run it, what
you verified (with numbers), and known gaps. Do not overstate: if something is approximate,
unverified or missing, say exactly that.
