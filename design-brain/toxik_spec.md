# Toxik — Product Specification

> A local-first media gallery and generative AI frontend with hierarchical compound tagging, infinite-scroll views, and ComfyUI workflow integration.

---

## 1. Core Concept

Toxik is a **web-based media browser and AI generation hub** for locally-stored images and videos. It combines the addictive scroll UX of TikTok/Grok Imagine with a powerful **dot-delimited hierarchical tagging system** that doubles as both an organizational taxonomy and a drill-down navigation mechanism.

### What makes it distinct

| Feature | TikTok / Grok Imagine | Toxik |
|---|---|---|
| Media source | Cloud / platform | Local filesystem + local AI |
| Organization | Algorithmic feed | User-defined hierarchical tags |
| Generation | Black-box API | Transparent ComfyUI workflows |
| Filtering | Hashtags (flat) | Compound tags with aggregation drill-down |
| Views | Single feed | 3 switchable infinite-scroll layouts |

---

## 2. Hierarchical Compound Tagging

This is the centerpiece of the system and deserves careful treatment.

### 2.1 Tag Anatomy

A **tag** is a dot-delimited string of one or more **segments**:

```
Person.Jake
Movie.Clip
Style.Cinematic.Noir
```

- Each segment is a case-insensitive identifier: `[a-zA-Z0-9_-]+`
- Max depth: unlimited (recommend ≤ 5 for UX sanity)
- A media item can have **multiple** tags
- Tags are **not mutually exclusive** — `Movie.Clip` and `Movie` can coexist on the same item

### 2.2 Matching Semantics

Filtering uses **prefix matching by default** with optional **wildcard patterns** for advanced queries.

#### Default: Prefix Matching

A filter `F` matches a tag `T` if `F`'s segments are a prefix of `T`'s segments:

| Filter | Matches | Doesn't match |
|---|---|---|
| `Movie` | `Movie`, `Movie.Clip`, `Movie.Clip.Short` | `Clip`, `Genre.Movie` |
| `Person` | `Person`, `Person.Jake`, `Person.Jake.Childhood` | `Jake` |
| `Movie.Clip` | `Movie.Clip`, `Movie.Clip.Short` | `Movie`, `Clip` |
| `Person.Jake` | `Person.Jake`, `Person.Jake.Childhood` | `Person`, `Person.Sue` |

> [!IMPORTANT]
> **Prefix matching is strict and segment-aligned.** `Mov` does NOT match `Movie`. The filter must match one or more complete segments from the left.

#### Wildcards: `*` Glob

For queries that need to match tags at arbitrary positions, use `*` as a segment-level wildcard:

| Filter | Matches | Rule |
|---|---|---|
| `*.Clip` | `Movie.Clip`, `Genre.Clip`, `Movie.Clip.Short` | Any parent, `Clip` as non-first segment |
| `*.Jake` | `Person.Jake`, `Person.Jake.Childhood` | Any parent |
| `Person.*` | `Person.Jake`, `Person.Sue` | Same as prefix `Person` (but explicit) |
| `*.Clip.*` | `Movie.Clip.Short`, `Genre.Clip.Extended` | `Clip` sandwiched anywhere |
| `*` | Everything | Universal match |

> [!NOTE]
> `*` matches **exactly one** segment. To match zero-or-more segments, use `**`:
> - `**.Clip` matches `Clip` (zero parents) AND `Movie.Clip` (one parent) AND `A.B.Clip` (two parents)
> - `*.Clip` matches only tags where `Clip` has exactly one parent segment
>
> This follows gitignore/glob conventions that users already know.

#### Combining Wildcards with Aggregation

Wildcard filters aggregate on the **matched position's next segment**, just like prefix filters:

```
Filter: "**.Clip"
Tags: Movie.Clip, Genre.Clip, Movie.Clip.Short, Genre.Clip.Extended

→ If aggregation applies, groups by next segment after "Clip":
  - Items with no segment after Clip: shown individually
  - Aggregate "Short" (from Movie.Clip.Short)
  - Aggregate "Extended" (from Genre.Clip.Extended)
```

### 2.3 Aggregation & Drill-Down

When a filter matches items across **multiple child groups**, the UI aggregates them:

```
Filter: "Person"
┌─────────────────────────────────────────────┐
│  [Person.Jake]    [Person.Sue]    [Person.…] │
│   ┌─────────┐     ┌─────────┐               │
│   │ Jake    │     │ Sue     │               │
│   │ thumb   │     │ thumb   │    ...        │
│   │ (12)    │     │ (8)     │               │
│   └─────────┘     └─────────┘               │
└─────────────────────────────────────────────┘
         ↓ click "Person.Jake"
┌─────────────────────────────────────────────┐
│  Filter: "Person.Jake"                      │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ...        │
│  │ 1 │ │ 2 │ │ 3 │ │ 4 │ │ 5 │            │
│  └───┘ └───┘ └───┘ └───┘ └───┘             │
└─────────────────────────────────────────────┘
```

**Aggregation rules:**

1. When filtering on segment `S`, find all matching tags
2. Group results by the **next segment** after the matched portion
3. Display each group as a **single aggregate card** showing:
   - A representative thumbnail (most recent, or user-pinned)
   - The group label (the next segment value)
   - A count badge
4. If a group contains **only one item**, show it directly (no aggregate card)
5. Clicking an aggregate card applies a **deeper filter** — drilling down one level
6. Items matching **exactly** (no deeper segments) appear as individual items alongside aggregate cards

**Example with mixed depths:**

```
Tags in system:
  Item A: Person.Jake
  Item B: Person.Jake
  Item C: Person.Jake.Childhood
  Item D: Person.Sue
  Item E: Person

Filter: "Person"
→ Shows:
  - Item E directly (exact match, no deeper segment)
  - Aggregate card "Jake" (3 items: A, B, C)
  - Aggregate card "Sue" (1 item: D) — or show D directly since count=1

Filter: "Person.Jake"
→ Shows:
  - Item A directly
  - Item B directly
  - Aggregate card "Childhood" (1 item: C) — or show C directly
```

> [!TIP]
> The "show directly if count=1" behavior should be a user preference. Some users may prefer consistent aggregate cards regardless of count for visual uniformity.

### 2.4 Tag Composition vs. Separate Tags

The user can choose either approach depending on intent:

| Approach | Tags on item | Use case |
|---|---|---|
| Compound | `Movie.Clip` | Treat "Movie Clip" as a **unit** — the item is specifically a movie clip |
| Separate | `Movie`, `Clip` | The item is independently a movie AND independently a clip |
| Both | `Movie.Clip`, `Comedy` | Compound for the primary classification, flat for orthogonal traits |

The system should support all three patterns simultaneously.

---

## 3. View Modes

Three infinite-scroll layouts, switchable via a toggle in the toolbar:

### 3.1 Compact Grid

```
┌────┬────┬────┬────┬────┬────┐
│    │    │    │    │    │    │
│    │    │    │    │    │    │
├────┼────┼────┼────┼────┼────┤
│    │    │    │    │    │    │
│    │    │    │    │    │    │
├────┼────┼────┼────┼────┼────┤
│    │    │    │    │    │    │
│    │    │    │    │    │    │
└────┴────┴────┴────┴────┴────┘
         ↓ infinite scroll
```

- Fixed-width columns (responsive count: 3–8+ depending on viewport)
- Square or uniform aspect-ratio cells
- Thumbnails **center-cropped** to fill the cell
- Hover: subtle scale-up + tag pill overlay
- Good for: rapid scanning of large libraries

### 3.2 Montage / Masonry Block Grid

```
┌──────────┬─────┬─────────┐
│          │     │         │
│  (16:9)  │(9:16│  (1:1)  │
│          │  )  │         │
│          │     ├─────────┤
├────┬─────┤     │         │
│    │     │     │  (4:3)  │
│(1:1│(3:4)│     │         │
│  ) │     ├─────┴─────────┤
│    │     │               │
├────┤     │    (21:9)     │
│    │     │               │
└────┴─────┴───────────────┘
         ↓ infinite scroll
```

- **Non-overlapping** tiles that maintain native aspect ratios
- Algorithm: CSS masonry-style layout with column-packing (similar to Pinterest / Unsplash)
- Tiles have **relative sizing** — wider/taller content gets proportionally larger cells
- No cropping — the full frame is always visible
- Good for: appreciating composition, mixed-format libraries

### 3.3 Full Viewport (Single Item)

```
┌─────────────────────────────────┐
│                                 │
│                                 │
│         ┌───────────────┐       │
│         │               │       │
│         │   Full-size   │       │
│         │    media      │       │
│         │               │       │
│         └───────────────┘       │
│                                 │
│  [tags]  [info]  [actions]      │
│                                 │
└─────────────────────────────────┘
         ↓ scroll / swipe
┌─────────────────────────────────┐
│         Next item...            │
```

- One item fills the viewport (like TikTok's feed)
- Vertical scroll or swipe to advance
- For **video**: autoplay with controls overlay
- For **images**: full-resolution display with zoom capability
- Tag bar + metadata + action buttons pinned at bottom
- Good for: focused viewing, presentation mode

---

## 4. ComfyUI Integration

### 4.1 Architecture

```
┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│   Toxik UI  │──────→│  Toxik API   │──────→│  ComfyUI    │
│  (Browser)  │  WS   │  (Backend)   │  HTTP  │  (Local)    │
│             │←──────│              │←──────│             │
└─────────────┘       └──────┬───────┘       └─────────────┘
                             │
                      ┌──────┴───────┐
                      │   SQLite /   │
                      │   Media DB   │
                      └──────────────┘
```

### 4.2 Workflow Types

| Workflow | Input | Output | UI Surface |
|---|---|---|---|
| **T2I** (Text-to-Image) | Text prompt | Image(s) | Generation panel |
| **I2V** (Image-to-Video) | Image + params | Video | Context menu on image items |
| **T2V** (Text-to-Video) | Text prompt | Video | Generation panel |
| **Extensions** | Existing media + params | Modified media | Context menu on items |

### 4.3 Workflow Dispatch Model

Toxik doesn't need to know ComfyUI internals — it just needs a **workflow registry**:

```json
{
  "workflows": [
    {
      "id": "t2i-flux",
      "name": "FLUX Text-to-Image",
      "type": "T2I",
      "file": "workflows/t2i_flux.json",
      "inputs": [
        { "name": "prompt", "type": "text", "required": true },
        { "name": "negative_prompt", "type": "text", "required": false },
        { "name": "width", "type": "number", "default": 1024 },
        { "name": "height", "type": "number", "default": 1024 },
        { "name": "steps", "type": "number", "default": 20 },
        { "name": "seed", "type": "number", "default": -1 }
      ],
      "outputs": ["image"],
      "tags_auto": ["AI.Generated", "T2I.Flux"]
    }
  ]
}
```

- **User provides the workflow JSON files** — Toxik just reads the registry and renders a dynamic form
- Outputs are automatically ingested into the media library with auto-tags
- Job queue with progress tracking via ComfyUI's WebSocket API

### 4.4 Generation UI

```
┌──────────────────────────────────────────┐
│  🎨 Generate                       [T2I]│
│  ┌──────────────────────────────────────┐│
│  │ Workflow: [FLUX Text-to-Image   ▾]  ││
│  ├──────────────────────────────────────┤│
│  │ Prompt:                             ││
│  │ ┌──────────────────────────────────┐ ││
│  │ │ A cyberpunk cityscape at dawn   │ ││
│  │ └──────────────────────────────────┘ ││
│  │ Width: [1024]  Height: [1024]       ││
│  │ Steps: [20]    Seed: [-1]           ││
│  │ Tags: [AI.Generated] [+]           ││
│  ├──────────────────────────────────────┤│
│  │ [Generate]  [Queue 3x]             ││
│  └──────────────────────────────────────┘│
│                                          │
│  Queue:                                  │
│  ✅ Job #14 — 2 min ago                  │
│  ⏳ Job #15 — rendering (step 12/20)     │
│  🕐 Job #16 — queued                     │
└──────────────────────────────────────────┘
```

---

## 5. Data Model

### 5.1 Database Schema (SQLite)

```sql
-- Core media items
CREATE TABLE media (
    id          TEXT PRIMARY KEY,        -- UUID
    filename    TEXT NOT NULL,
    filepath    TEXT NOT NULL UNIQUE,    -- absolute path on disk
    media_type  TEXT NOT NULL,           -- 'image' | 'video'
    mime_type   TEXT,
    width       INTEGER,
    height      INTEGER,
    duration_ms INTEGER,                -- NULL for images
    file_size   INTEGER,
    thumb_path  TEXT,                    -- path to generated thumbnail
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata    TEXT                     -- JSON blob for EXIF, generation params, etc.
);

-- Tags (normalized)
CREATE TABLE tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    full_tag    TEXT NOT NULL UNIQUE,    -- e.g. "Person.Jake"
    depth       INTEGER NOT NULL,       -- number of segments (1 for "Movie", 2 for "Movie.Clip")
    parent_tag  TEXT,                    -- "Person" for "Person.Jake", NULL for top-level
    FOREIGN KEY (parent_tag) REFERENCES tags(full_tag) ON DELETE SET NULL
);

-- Segments index for fast segment-level matching
CREATE TABLE tag_segments (
    tag_id      INTEGER NOT NULL,
    segment     TEXT NOT NULL,          -- individual segment value
    position    INTEGER NOT NULL,       -- 0-indexed position in the dot path
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX idx_tag_segments_segment ON tag_segments(segment);

-- Many-to-many: media ↔ tags
CREATE TABLE media_tags (
    media_id    TEXT NOT NULL,
    tag_id      INTEGER NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (media_id, tag_id),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- ComfyUI generation jobs
CREATE TABLE generation_jobs (
    id          TEXT PRIMARY KEY,        -- UUID
    workflow_id TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',  -- queued | running | completed | failed
    inputs      TEXT NOT NULL,           -- JSON
    comfyui_id  TEXT,                    -- ComfyUI prompt_id
    progress    REAL DEFAULT 0,         -- 0.0 to 1.0
    output_ids  TEXT,                    -- JSON array of media IDs
    error       TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

-- User preferences / app state
CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);
```

### 5.2 Tag Queries

**Prefix match** (filtering on `Person`):
```sql
SELECT DISTINCT m.* FROM media m
JOIN media_tags mt ON m.id = mt.media_id
JOIN tags t ON mt.tag_id = t.id
WHERE t.full_tag = 'Person'
   OR t.full_tag LIKE 'Person.%';
```

**Wildcard match** (filtering on `**.Clip` — Clip at any depth):
```sql
-- The backend translates **.Clip → segment search
-- For **: match 'Clip' at any position
SELECT DISTINCT m.* FROM media m
JOIN media_tags mt ON m.id = mt.media_id
JOIN tags t ON mt.tag_id = t.id
JOIN tag_segments ts ON t.id = ts.tag_id
WHERE ts.segment = 'Clip';

-- For *.Clip (exactly one parent): add position constraint
-- WHERE ts.segment = 'Clip' AND ts.position = 1;
```

**Aggregation query** (group by next segment after `Person`):
```sql
SELECT
    ts_next.segment AS group_label,
    COUNT(DISTINCT m.id) AS item_count,
    (SELECT m2.thumb_path FROM media m2
     JOIN media_tags mt2 ON m2.id = mt2.media_id
     JOIN tags t2 ON mt2.tag_id = t2.id
     WHERE (t2.full_tag LIKE 'Person.' || ts_next.segment || '%')
     ORDER BY m2.created_at DESC LIMIT 1
    ) AS representative_thumb
FROM media m
JOIN media_tags mt ON m.id = mt.media_id
JOIN tags t ON mt.tag_id = t.id
JOIN tag_segments ts_match ON t.id = ts_match.tag_id AND ts_match.segment = 'Person' AND ts_match.position = 0
JOIN tag_segments ts_next ON t.id = ts_next.tag_id AND ts_next.position = ts_match.position + 1
GROUP BY ts_next.segment
ORDER BY item_count DESC;
```

---

## 6. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | Vite + vanilla JS (or lightweight framework) | Fast, modern, no heavy framework overhead |
| **Styling** | Vanilla CSS with custom properties | Full control over the three layout modes |
| **Backend** | Python (FastAPI) | Native ComfyUI interop (Python ecosystem), async WebSocket support |
| **Database** | SQLite via aiosqlite | Zero-config, local-first, surprisingly fast for this scale |
| **Thumbnails** | FFmpeg (video) + Pillow (image) | Industry standard, already likely installed for ComfyUI |
| **Media serving** | Static file serving + range requests | Required for video scrubbing / streaming |
| **Real-time** | WebSockets | Job progress, live gallery updates |

### 6.1 Browser Compatibility Targets

| Priority | Browser | Engine | Notes |
|---|---|---|---|
| **P0** | Desktop Firefox | Gecko | Primary development target |
| **P1** | Meta Quest Browser | Chromium/Blink | VR headset — touch input, limited viewport, performance-sensitive |
| **P1** | Vanadium (GrapheneOS) | Chromium/Blink | Hardened mobile browser — no exotic APIs, strict CSP |

**Compatibility strategy: progressive enhancement with graceful degradation.**

| Feature | Firefox | Quest Browser | Vanadium | Fallback |
|---|---|---|---|---|
| CSS `masonry` | ❌ (behind flag) | ❌ | ❌ | JS-based column packing (Phase 1 default) |
| `IntersectionObserver` | ✅ | ✅ | ✅ | — |
| CSS `backdrop-filter` | ✅ | ✅ | ✅ | Solid background fallback |
| WebSocket | ✅ | ✅ | ✅ | — |
| `ResizeObserver` | ✅ | ✅ | ✅ | — |
| Touch events | N/A | ✅ (primary) | ✅ (primary) | Pointer Events API for unified input |
| `:hover` effects | ✅ | ⚠️ (no hover) | ⚠️ (no hover) | Long-press or tap-to-reveal for hover-dependent UI |
| `<video>` autoplay | ✅ | ⚠️ (muted only) | ⚠️ (muted only) | Muted autoplay, tap to unmute |
| WebGL / GPU effects | ✅ | ⚠️ (limited) | ✅ | CSS-only animations as fallback |

**Key design rules for compatibility:**

1. **No CSS masonry** — use JS-based column packing from the start (avoids the Firefox flag issue entirely)
2. **Pointer Events API** over separate mouse/touch handlers — works across all three targets
3. **No hover-dependent functionality** — hover enhances but never gates. Use tap/long-press alternatives.
4. **Responsive touch targets** — minimum 44×44px tap areas per WCAG, critical for Quest and Vanadium
5. **Lazy loading with `IntersectionObserver`** — universally supported, critical for Quest's limited RAM
6. **Avoid `backdrop-filter` stacking** — single layer is fine, but nested blurs crush Quest performance
7. **Test with `prefers-reduced-motion`** — respect system setting, especially on mobile
8. **No service workers or exotic APIs** — Vanadium may block or restrict these under strict CSP

---

## 7. API Design

### 7.1 REST Endpoints

```
Media
  GET    /api/media                    — paginated list (supports filter, sort, view params)
  GET    /api/media/:id                — single item with full metadata
  POST   /api/media/import             — import from filesystem path(s)
  DELETE /api/media/:id                — remove from library (optional: delete file)

Tags
  GET    /api/tags                     — all tags (tree structure)
  GET    /api/tags/search?q=           — autocomplete / search
  POST   /api/tags                     — create tag
  DELETE /api/tags/:id                 — delete tag (and all associations)
  GET    /api/tags/aggregate?filter=   — aggregated groups for a filter term

Media ↔ Tags
  POST   /api/media/:id/tags           — add tag(s) to item
  DELETE /api/media/:id/tags/:tagId    — remove tag from item
  POST   /api/media/batch/tags         — batch tag: add/remove tags for multiple items

Filtering & Browsing
  GET    /api/browse?filter=Person&view=grid&page=1&limit=50
         → Returns mix of aggregate cards + individual items
  GET    /api/browse?filter=Person.Jake&view=montage&page=1&limit=50
         → Returns individual items only (fully drilled down)

Generation
  GET    /api/workflows                — list registered workflows
  POST   /api/generate                 — submit generation job
  GET    /api/jobs                     — list jobs (with status)
  GET    /api/jobs/:id                 — job detail + progress
  DELETE /api/jobs/:id                 — cancel job

WebSocket
  WS     /ws/events                    — real-time: job progress, new media, etc.
```

### 7.2 Browse Response Shape

```json
{
  "filter": "Person",
  "total_items": 47,
  "page": 1,
  "results": [
    {
      "type": "aggregate",
      "label": "Jake",
      "full_filter": "Person.Jake",
      "count": 12,
      "representative": {
        "id": "abc-123",
        "thumb_url": "/thumbs/abc-123.webp",
        "media_type": "image"
      }
    },
    {
      "type": "aggregate",
      "label": "Sue",
      "full_filter": "Person.Sue",
      "count": 8,
      "representative": { "..." : "..." }
    },
    {
      "type": "item",
      "media": {
        "id": "def-456",
        "thumb_url": "/thumbs/def-456.webp",
        "media_type": "video",
        "tags": ["Person"],
        "width": 1920,
        "height": 1080
      }
    }
  ]
}
```

---

## 8. UI Architecture

### 8.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  Toxik                    [🔍 search/filter]  [⚙ ≡ 🎨] │
│  ┌──────┐ ┌───────────────────────────────────────────┐ │
│  │      │ │                                           │ │
│  │ Tag  │ │                                           │ │
│  │ Tree │ │          Main Content Area                │ │
│  │      │ │     (Grid / Montage / Viewport)           │ │
│  │ ──── │ │                                           │ │
│  │      │ │          ↕ infinite scroll                │ │
│  │Filter│ │                                           │ │
│  │Panel │ │                                           │ │
│  │      │ │                                           │ │
│  │      │ ├───────────────────────────────────────────┤ │
│  │      │ │  [breadcrumb: All > Person > Jake]        │ │
│  └──────┘ └───────────────────────────────────────────┘ │
│  [+ Generate]                        [View: ▦ ▧ ▣]     │
└─────────────────────────────────────────────────────────┘
```

### 8.2 Key UI Components

| Component | Description |
|---|---|
| **Tag Sidebar** | Collapsible tree view of all tags. Click to filter. Shows counts. Supports multi-select for compound filters. |
| **Filter Bar** | Top bar with active filter pills, search input, sort controls. |
| **Breadcrumb** | Shows drill-down path: `All > Person > Jake`. Each segment is clickable to zoom back out. |
| **View Switcher** | Toggle between compact grid ▦, montage ▧, and viewport ▣ modes. |
| **Media Card** | Thumbnail + overlay (tags, duration badge for video, type icon). |
| **Aggregate Card** | Special card with group label, count badge, and representative thumbnail. Visually distinct (stacked card effect or border treatment). |
| **Detail Modal / Panel** | Full media view with metadata, tag editor, generation info, action buttons (I2V, extend, etc.). |
| **Generation Panel** | Slide-out panel for AI generation. Workflow selector, dynamic input form, job queue. |
| **Batch Tag Bar** | Appears when multi-selecting items. Quick tag/untag operations. |
| **Lightbox** | Full-screen media viewer with prev/next navigation, zoom for images, playback controls for video. |

### 8.3 Interaction Patterns

- **Single click** on media card → open detail modal
- **Double click** on media card → open in lightbox / full viewport
- **Right click** on media card → context menu (tag, generate from, delete, open file, copy)
- **Shift+click** / **drag select** → multi-select for batch operations
- **Click** on aggregate card → drill down (apply deeper filter)
- **Ctrl+click** on tag in sidebar → add to multi-filter (AND logic)
- **Scroll** → infinite load (virtualized for performance)

---

## 9. Batch Tagging

### 9.1 Selection Modes

- **Click-to-toggle**: Ctrl/Cmd+click individual items
- **Range select**: Shift+click to select range
- **Lasso/rectangle select**: Click+drag in grid/montage views
- **Select all visible**: Toolbar button
- **Select by current filter**: "Select all N items matching this filter"

### 9.2 Batch Tag Bar

```
┌─────────────────────────────────────────────────────────┐
│  ✓ 14 items selected                                    │
│  [+ Add Tag: _________ ]  [− Remove Tag: _________ ]   │
│  [Replace Tag: ___ → ___ ]  [Clear All Tags]           │
│  [Cancel Selection]                          [Apply ▶]  │
└─────────────────────────────────────────────────────────┘
```

- Tag input with **autocomplete** from existing tags
- Supports creating new tags inline
- Preview of affected items before applying
- Undo support (last batch operation)

---

## 10. File System Integration

### 10.1 Media Ingestion

Two modes:

1. **Watch directories**: Configure one or more directories to monitor. New files are automatically imported.
2. **Manual import**: Point to a file or directory to import on demand.

On import:
- Generate thumbnail (FFmpeg for video → first frame or middle frame; Pillow for image → resize)
- Extract metadata (EXIF, resolution, duration, codec)
- Apply any auto-tags from import rules (e.g., "everything from `/renders/flux/` gets tagged `AI.Generated.Flux`")

### 10.2 Thumbnail Pipeline

```
Original file
  │
  ├─→ thumb_sm.webp   (200px wide, for compact grid)
  ├─→ thumb_md.webp   (400px wide, for montage)
  └─→ thumb_lg.webp   (800px wide, for viewport preview)
```

- WebP format for size efficiency
- Video thumbnails: configurable frame extraction (first, middle, or custom timestamp)
- Animated thumbnail option for videos (short webp/gif loop)

---

## 11. Proposed Directory Structure

```
toxik/
├── frontend/                    # Vite project
│   ├── index.html
│   ├── src/
│   │   ├── main.js
│   │   ├── styles/
│   │   │   ├── index.css        # Design system + custom properties
│   │   │   ├── grid.css         # Compact grid layout
│   │   │   ├── montage.css      # Masonry montage layout
│   │   │   └── viewport.css     # Full viewport layout
│   │   ├── components/
│   │   │   ├── media-card.js
│   │   │   ├── aggregate-card.js
│   │   │   ├── tag-sidebar.js
│   │   │   ├── filter-bar.js
│   │   │   ├── breadcrumb.js
│   │   │   ├── generation-panel.js
│   │   │   ├── batch-tag-bar.js
│   │   │   ├── lightbox.js
│   │   │   └── infinite-scroll.js
│   │   ├── state/
│   │   │   ├── store.js         # Central state management
│   │   │   ├── filter.js        # Filter/drill-down state
│   │   │   └── selection.js     # Multi-select state
│   │   └── api/
│   │       ├── client.js        # REST API client
│   │       └── websocket.js     # WebSocket connection
│   └── vite.config.js
│
├── backend/
│   ├── main.py                  # FastAPI app entry
│   ├── routers/
│   │   ├── media.py
│   │   ├── tags.py
│   │   ├── browse.py
│   │   ├── generate.py
│   │   └── websocket.py
│   ├── services/
│   │   ├── media_service.py     # Media CRUD + import logic
│   │   ├── tag_service.py       # Tag CRUD + matching/aggregation
│   │   ├── thumbnail_service.py # Thumbnail generation
│   │   ├── comfyui_client.py    # ComfyUI API integration
│   │   └── watcher_service.py   # Filesystem watcher
│   ├── models/
│   │   ├── database.py          # SQLite setup + migrations
│   │   ├── media.py             # Pydantic models
│   │   ├── tags.py
│   │   └── jobs.py
│   ├── config.py                # App configuration
│   └── requirements.txt
│
├── workflows/                   # User-managed ComfyUI workflow JSONs
│   ├── t2i_flux.json
│   ├── i2v_example.json
│   └── registry.json            # Workflow registry
│
├── data/                        # Runtime data (gitignored)
│   ├── toxik.db                 # SQLite database
│   └── thumbs/                  # Generated thumbnails
│
└── README.md
```

---

## 12. Design Decisions (Locked)

Decisions made — these are now part of the spec:

| # | Decision | Resolution |
|---|---|---|
| 1 | **Frontend framework** | Vanilla JS with Vite. Keep it lean; framework can be introduced later if state complexity demands it. |
| 2 | **Tag matching** | **Prefix matching by default**, wildcard patterns (`*`, `**`) for advanced queries. See §2.2. |
| 3 | **Multi-filter logic** | AND by default with OR toggle in the filter bar. |
| 4 | **Aggregate card threshold** | Configurable. Default: aggregate if group count > 1, show directly if count = 1. |
| 5 | **Video autoplay in grid/montage** | Animated preview thumbnail (short loop) + full autoplay on hover (desktop) / tap (touch). |
| 6 | **Dark mode** | Dark-first with light mode toggle. |
| 7 | **Auth** | None for local. Optional basic auth for LAN access (Phase 4). |
| 8 | **Max concurrent ComfyUI jobs** | Configurable, default 1. |
| 9 | **Import deduplication** | File content hash (SHA-256). |
| 10 | **Tag deletion behavior** | Remove tag + optionally reassign children to parent. |

---

## 13. Implementation Phases

### Phase 1 — Foundation (MVP)
- [ ] Backend: FastAPI scaffolding, SQLite schema, media import
- [ ] Backend: Thumbnail generation pipeline
- [ ] Backend: Tag CRUD with prefix matching + wildcard support
- [ ] Frontend: Compact grid view with infinite scroll
- [ ] Frontend: Tag sidebar with filter/drill-down
- [ ] Frontend: Basic media detail modal
- [ ] Cross-browser validation: Firefox, Quest Browser, Vanadium

### Phase 2 — Views & Tagging
- [ ] Frontend: Montage view (JS column-packing, not CSS masonry)
- [ ] Frontend: Full viewport view
- [ ] Frontend: Batch selection + batch tag bar
- [ ] Frontend: Aggregate cards with drill-down animation
- [ ] Backend: Browse endpoint with aggregation
- [ ] Touch input: long-press menus, swipe navigation, 44px tap targets

### Phase 3 — Generation
- [ ] Backend: Workflow registry + dynamic form generation
- [ ] Backend: ComfyUI client (submit, poll, ingest results)
- [ ] Frontend: Generation panel UI
- [ ] Frontend: Job queue with real-time progress (WebSocket)
- [ ] Auto-tagging of generated media

### Phase 4 — Polish
- [ ] Filesystem watcher for auto-import
- [ ] Animated video thumbnails
- [ ] Context menu integration (right-click / long-press → generate from)
- [ ] Keyboard shortcuts
- [ ] Search (full-text across tags + metadata)
- [ ] Settings/preferences panel
- [ ] Import/export tags (backup)
- [ ] Optional basic auth for LAN access

---

## 14. Future: Canvas Mode (2.0)

> [!NOTE]
> Scoped for a future release. Documented here to inform architectural decisions in 1.0 (e.g., don't paint yourself into a corner with the data model).

### 14.1 Concept

A **canvas** is a free-form, zoomable 2D surface where media items have **persistent, user-defined positions and sizes**. Think of it as a moodboard / pinboard that remembers where you put things.

```
┌─── Canvas: "Project Noir Lookbook" ────────────────────────┐
│                                                             │
│     ┌──────────┐                                            │
│     │          │          ┌──────┐                          │
│     │  Hero    │          │ Ref  │                          │
│     │  shot    │          │ img  │                          │
│     │  (large) │          └──────┘                          │
│     └──────────┘                    ┌───────────────┐       │
│                                     │  Clip B       │       │
│  ┌────┐  ┌────┐                     │  (16:9, med)  │       │
│  │ A  │  │ B  │                     └───────────────┘       │
│  │    │  │    │                                             │
│  └────┘  └────┘                                             │
│                                                             │
│  ← pan / scroll →          [zoom: ─────●──── ]             │
└─────────────────────────────────────────────────────────────┘
```

### 14.2 Canvas as Tag

Canvases integrate with the tagging system via a reserved `canvas.*` tag namespace:

- Creating a canvas named "Noir Lookbook" creates the tag `canvas.NoirLookbook`
- Adding an item to the canvas applies this tag
- Filtering on `canvas` shows all canvases as aggregate cards
- Filtering on `canvas.NoirLookbook` opens the canvas view

### 14.3 Data Model Extension

```sql
-- Canvas definitions
CREATE TABLE canvases (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    tag_id      INTEGER NOT NULL,       -- FK to the canvas.* tag
    viewport_x  REAL DEFAULT 0,         -- saved pan position
    viewport_y  REAL DEFAULT 0,
    viewport_zoom REAL DEFAULT 1.0,
    bg_color    TEXT DEFAULT '#0a0a0a',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);

-- Item placement within a canvas
CREATE TABLE canvas_items (
    canvas_id   TEXT NOT NULL,
    media_id    TEXT NOT NULL,
    x           REAL NOT NULL,          -- position on canvas
    y           REAL NOT NULL,
    width       REAL NOT NULL,          -- display size (not pixel size)
    height      REAL NOT NULL,
    z_index     INTEGER DEFAULT 0,      -- layering order
    rotation    REAL DEFAULT 0,         -- degrees
    locked      BOOLEAN DEFAULT FALSE,  -- prevent accidental moves
    PRIMARY KEY (canvas_id, media_id),
    FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);
```

### 14.4 Canvas Interactions

| Action | Desktop | Quest / Vanadium |
|---|---|---|
| Pan | Middle-click drag / Space+drag | Two-finger drag |
| Zoom | Scroll wheel / Ctrl+scroll | Pinch |
| Move item | Drag | Long-press + drag |
| Resize item | Drag corner handle | Long-press corner + drag |
| Add item | Drag from sidebar / paste | Share intent / paste |
| Select multiple | Shift+click / lasso | Long-press + tap additional |

### 14.5 1.0 Architectural Prep

To avoid rework when canvas mode ships:

- **Keep the tag namespace `canvas.*` reserved** — don't let users create arbitrary `canvas.*` tags
- **Design the media card component** to accept arbitrary `x, y, width, height` props even if 1.0 doesn't use them
- **Include z-index in the rendering pipeline** even if all items are z=0 in 1.0
- **Use `transform: translate()` for positioning** in all views — this makes the jump to canvas-style placement trivial

---

## 15. Known Issues & Browser Sandbox Limitations

### 15.1 Native Video Fullscreen Transitions (`video.requestFullscreen`)
When playing through a playlist of videos, browsers enforce strict security sandboxes around the Fullscreen API (`requestFullscreen` and `-webkit-full-screen`). Specifically:
- While our own **Browser Fullscreen** controls (`🖥️ Fullscreen`) put the container (`#detail-modal` or `#app`) into fullscreen—allowing seamless track transitions without dropping out of fullscreen—engaging the native fullscreen icon inside the browser's HTML5 `<video controls>` bar puts the individual `<video>` DOM element into fullscreen.
- When that `<video>` finishes playing (`onended` event) and the playlist advances to the next item, attempting to transfer fullscreen to the incoming `<video>` element programmatically via `requestFullscreen()` can be blocked or dropped by browsers (Chrome, Safari, Quest browser) because `onended` is an asynchronous media event rather than a direct transient user gesture (e.g., a physical click or tap).
- **Resolution / Fallback**: We have documented this limitation. Users desiring uninterrupted fullscreen playlist playback across videos should utilize our **🖥️ Fullscreen** container controls (or use the external VLC playlist export). Furthermore, to prevent UI conflicts, playlist playback is automatically paused (`isPlaying: false`) whenever the user manually navigates tags or changes view modes.

### 15.2 External VLC Playlist Download (.m3u8)
To bypass browser sandbox limitations and provide native desktop media player capabilities, Toxik supports direct playlist export via the `/api/browse/playlist` endpoint.
- Clicking **⬇️ Playlist / VLC** generates an Apple HLS / VLC-compatible `.m3u8` playlist file containing all media items matching the active filter and media type.
- The exported playlist embeds the absolute local filesystem paths (`item.filepath`) and exact track durations (`#EXTINF:dur,filename`), enabling immediate zero-config playback in desktop VLC when running on the local host or NAS mount.

