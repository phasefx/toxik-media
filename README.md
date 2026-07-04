# Toxik 🧪

> A self-hosted, local-first media gallery and generative AI frontend featuring hierarchical compound tagging, infinite scroll, and ComfyUI workflow integration.

Vibe-coded. Media support includes video, images, audio, text, Markdown, PDF, source code, and e-books.

---

## Highlights & Features

- **Hierarchical Compound Tagging**: Organize media with dot-delimited tags (e.g., `Person.Jake`, `Movie.Clip.Short`). Use a tree view or a tag cloud for navigation.
- **Aggregated Drill-Down Navigation**: Filtering on `Person` groups all `Jake` items into a single representative aggregate card. Click to drill down into `Person.Jake`.
- **Wildcard Queries**: Supports prefix matching by default as well as advanced glob filtering (`*.Clip`, `**.Clip`).
- **Infinite-Scroll View Modes**:
  - **▦ Compact Grid**: Fixed-width square cells with center cropping and hover scale animations.
  - **▧ Montage / Masonry**: JS-based column packing maintaining native aspect ratios without overlapping.
  - **▣ Full Viewport Feed**: Single-item vertical scroll.
  - **▣ Simple List**: Single-item vertical scroll.
- **Media Type Toggles**: Instantly switch between broad media types across all view modes and aggregate group counts.
- **AI Generative Hub**: Integration with ComfyUI workflows (Text-to-Image, Image-to-Video, Video-to-Video, etc.) with dynamic input parameter forms and real-time WebSocket progress tracking.
- **Batch Tagging & Range Selection**: Multi-select items via checkboxes or click cards while holding **Shift** for fast range selection to batch add, remove, or clear tags.
- **Smart & Automatic Import Tagging**: During directory or file ingestion, items are automatically tagged with their full directory path as a hierarchical compound tag (e.g., `home.coding.git.toxik.samples.beach`), along with any optional custom tag specified at prompt time.
- **SHA-256 Deduplication**: Automatically detects duplicate imports across different directories or filenames.
- **Cross-Browser & VR Headset Compatibility**: Progressive enhancement designed to run smoothly on desktop Firefox, Meta Quest Browser, and Vanadium (GrapheneOS) with responsive 44px tap targets and unified Pointer Events.

---

## Getting Started

### 1. Prerequisites
- Python 3.10+
- Node.js 18+ and npm
- FFmpeg (for video thumbnail generation and metadata extraction)

### 2. Setup Backend & Frontend

```bash
# Clone and enter directory
cd toxik

# Setup Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Install Frontend dependencies
cd frontend
npm install
cd ..
```

### 3. Running Locally

Open two terminal windows:

**Terminal 1 — Backend API (FastAPI on port 8000)**:
```bash
source .venv/bin/activate
python -m backend.main
```

**Terminal 2 — Frontend UI (Vite dev server on port 5173)**:
```bash
cd frontend
npm run dev
```

Or if you like tmux, run:
```bash
./toxik_inside_tmux.sh
```

Open your browser to [http://localhost:5173](http://localhost:5173).

If port 5173 is taken by something else, try 5174, 5175, etc.

### 4. CLI Media Ingestion (Optional)
For importing large local folders directly from terminal with rich progress bars, real-time deduplication logs, and automatic directory path tagging:
```bash
# Scan and import a directory with custom compound tags (-t) and verbose logging (-v)
./import_cli.py /path/to/media/folder -t Vacation -t Year.2026 -v

# Perform a dry run without modifying the database
./import_cli.py /path/to/media/folder --dry-run
```

### 5. Running Multiple Instances & Configuring Collections

You can run multiple instances of Toxik simultaneously with different media collections, listen addresses, and ports.

#### Using `toxik_inside_tmux.sh` (Recommended)
Launch separate tmux sessions with distinct ports and data directories:
```bash
# Instance 1: Default Collection (Port 8000 / UI 5173 / Session toxik)
./toxik_inside_tmux.sh

# Instance 2: Movies Collection (Port 8001 / UI 5174 / Session toxik-movies)
./toxik_inside_tmux.sh -s toxik-movies -d ./data-movies -p 8001 --frontend-port 5174
```

#### Manual Terminal Startup or Environment Variables
You can pass CLI flags directly or set `TOXIK_*` environment variables:
```bash
# Backend API (Instance 2)
python -m backend.main --data-dir ./data-movies --port 8001 --host 0.0.0.0

# Frontend UI (Instance 2 automatically proxies to Backend on 8001)
TOXIK_PORT=8001 TOXIK_FRONTEND_PORT=5174 npm run dev --prefix frontend

# Ingesting Media into Instance 2 Collection
./import_cli.py /path/to/movies -d ./data-movies -t Movie
```

#### Alternative
Or you could use one instance to switch between multiple catalogs/databases within the GUI.

```bash
# Ingesting Media into a Specific Catalog
./import_cli.py /path/to/movies -c movies.db
```

---


## Tagging Architecture & Examples

1. **Prefix Match (Default)**:
   - Filtering on `Person` matches `Person`, `Person.Jake`, and `Person.Jake.Childhood`.
   - Items are automatically grouped by the *next segment* into clickable Aggregate Cards.
2. **Wildcard Match**:
   - `*.Clip` matches any tag where `Clip` has exactly one parent segment (e.g., `Movie.Clip`, `Genre.Clip`).
   - `**.Clip` matches `Clip` at any depth in the hierarchy.
3. **Multi-Filter Logic**:
   - Set multiple tags as inclusionary and exclusionary filters.

---

## Privacy Caveat

One installed, we don't pull remote fonts, scripts, 3rd party metadata, etc. However, ComfyUI, itself, is able to reach out to 3rd party hosts depending on your workflows and customizations. And if you're using Windows, Firefox, or Chrome, there is likely telemetry there you should be aware of. And at some point I will want to add a mechanism for pulling cover art for music and ebooks.

## TODO: Canvas Mode 2.0
Toxik 1.0 includes architectural foundations for persistent spatial boards (Canvas Mode 2.0):
- Reserved `canvas.*` tag namespace.
- Transform-based positioning pipeline.
- Z-index layering preparation.

## TODO: In-browser emulation for retro-gaming.

## TODO: Interactive fiction / text adventure game support.

## TODO: Transcoding.

## TODO: VR support including psuedo-stereograms for 2d media.
