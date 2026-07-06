# Toxik 🧪

> A self-hosted, local-first media gallery and generative AI frontend featuring hierarchical compound tagging, infinite scroll, ComfyUI workflow integration, in-browser interactive fiction playback, and retro-gaming emulation.

Vibe-coded. Media support includes video, images, audio, text, Markdown, PDF, source code, e-books, interactive fiction (Z-machine, Glulx, TADS, Ink), and video game ROMs (NES, SNES, Game Boy, Genesis, PlayStation, and more).

---

## Highlights & Features

- **Interactive Fiction Player**: Play Z-machine, Glulx, Blorb, TADS, and Ink stories directly in the browser via Parchment or embedded InkJS — no interpreter needed.
- **Retro Game Emulation**: Launch NES, SNES, Game Boy, Genesis, PlayStation, and dozens more ROM formats in-browser via EmulatorJS. Configurable `TOXIK_EMULATORJS_URL` (default `http://localhost:8081`).
- **Hierarchical Compound Tagging**: Organize media with dot-delimited tags (e.g., `Person.Jake`, `Movie.Clip.Short`). Use a tree view or a tag cloud for navigation.
- **Aggregated Drill-Down Navigation**: Filtering on `Person` groups all `Jake` items into a single representative aggregate card. Click to drill down into `Person.Jake`.
- **Wildcard Queries**: Supports prefix matching by default as well as advanced glob filtering (`*.Clip`, `**.Clip`).
- **Infinite-Scroll View Modes**:
  - **▦ Compact Grid**: Fixed-width square cells with center cropping and hover scale animations.
  - **▧ Montage / Masonry**: JS-based column packing maintaining native aspect ratios without overlapping.
  - **▣ Full Viewport Feed**: Single-item vertical scroll.
  - **☰ Simple List**: Compact list view.
- **Media Type Filters**: Instantly switch between image, video, audio, document, interactive fiction, and game ROM views.
- **AI Generative Hub**: Integration with ComfyUI workflows (Text-to-Image, Image-to-Video, Video-to-Video, etc.) with dynamic input parameter forms and real-time WebSocket progress tracking.
- **Batch Tagging & Range Selection**: Multi-select items via checkboxes or click cards while holding **Shift** for fast range selection to batch add, remove, or clear tags.
- **Transcoding**: Convert between image, video, and audio formats directly from the detail modal.
- **Smart & Automatic Import Tagging**: During directory or file ingestion, items are automatically tagged with their full directory path as a hierarchical compound tag (e.g., `home.coding.git.toxik.samples.beach`), along with any optional custom tag specified at prompt time.
- **SHA-256 Deduplication**: Automatically detects duplicate imports across different directories or filenames.
- **Cross-Browser & VR Headset Compatibility**: Progressive enhancement designed to run smoothly on desktop Firefox, Meta Quest Browser, and Vanadium (GrapheneOS) with responsive 44px tap targets and unified Pointer Events.
- **Multiple Catalogs**: Switch between independent databases/collections within the GUI without restarting.

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

### 6. Optional: Interactive Fiction Player (Parchment)

For Z-machine, Glulx, and TADS stories, Toxik embeds [Parchment](https://github.com/curiousdannii/parchment) in an iframe, but you need to install a local instance.

```bash
TOXIK_PARCHMENT_URL=http://192.168.1.78:8080 python -m backend.main
```

Ink stories (`.ink.json`) are played directly in the browser via the embedded [inkjs](https://github.com/inkle/inkjs) runtime.

### 7. Optional: Retro Game Emulation (EmulatorJS)

For video game ROMs, Toxik serves a play page that loads [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) core from a self-hosted instance. You need to install this as well.

```bash
TOXIK_EMULATORJS_URL=http://192.168.1.78:8081 python -m backend.main
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

## Supported Formats

| Category | Extensions | Player |
|----------|-----------|--------|
| Image | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tiff` | Native browser |
| Video | `.mp4`, `.mov`, `.webm`, `.mkv`, `.avi` | Native browser |
| Audio | `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.aac`, `.opus` | Native browser |
| Document | `.md`, `.txt`, `.epub`, `.pdf`, `.html`, `.htm`, `.rst`, source code, log files | Highlight.js / epubjs / iframe |
| Interactive Fiction | `.z1`–`.z8`, `.zblorb`, `.blorb`, `.gblorb`, `.blb`, `.ulx`, `.gam`, `.t3`, `.ink`, `.ink.json` | Parchment (Z-machine/Glulx/TADS) or InkJS (Ink) |
| Game ROM | `.nes`, `.fds`, `.smc`, `.sfc`, `.gb`, `.gbc`, `.gba`, `.nds`, `.3ds`, `.n64`, `.z64`, `.v64`, `.gen`, `.md`, `.smd`, `.pce`, `.sms`, `.gg`, `.ws`, `.wsc`, `.a26`, `.a78`, `.lnx`, `.j64`, `.ngp`, `.neo`, `.col`, `.int`, `.vb`, `.psx`, `.ps1`, `.iso`, `.cue`, `.bin`, `.chd` | EmulatorJS |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TOXIK_HOST` | `0.0.0.0` | Backend bind address |
| `TOXIK_PORT` | `8000` | Backend port |
| `TOXIK_DATA_DIR` | `./data` | Media storage directory |
| `TOXIK_DB_PATH` | `<data_dir>/toxik.db` | SQLite database path |
| `TOXIK_PUBLIC_URL` | `http://localhost:8000` | Public-facing backend URL (used for player URLs) |
| `TOXIK_PARCHMENT_URL` | `http://localhost:8080` | Parchment IF player URL |
| `TOXIK_EMULATORJS_URL` | `http://localhost:8081` | EmulatorJS server URL |
| `TOXIK_COMFYUI_HOST` | `localhost` | ComfyUI hostname |
| `TOXIK_COMFYUI_PORT` | `8188` | ComfyUI port |

---

## Privacy Caveat

Once installed, Toxik doesn't pull remote fonts, scripts, or 3rd party metadata. However, ComfyUI itself may reach out to 3rd party hosts depending on your workflows and customizations. Parchment and EmulatorJS run from your own self-hosted instances, but the latter may reach out to the CDN for Retroarch cores and I think a version check. If you're using Windows, Firefox, or Chrome, there is likely telemetry there you should be aware of.

---

## TODO: Canvas Mode for persistent spatial boards where you place the media.

## TODO: VR environment and psuedo-stereograms for 2d media.

