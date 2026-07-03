import { store } from '../state/store.js';
import { api } from '../api/client.js';

export class TagSidebar {
    constructor(container) {
        this.container = container;
        this.expandedNodes = new Set(['Person', 'Movie', 'Style']); // Default expanded
        this.expandedSections = new Set(['actions', 'view', 'sort', 'taxonomy']); // Accordions
        this.isResizing = false;
        window.addEventListener('mousemove', (e) => {
            if (!this.isResizing) return;
            let newWidth = e.clientX;
            if (newWidth < 180) newWidth = 180;
            if (newWidth > 700) newWidth = 700;
            document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
        });
        window.addEventListener('mouseup', () => {
            if (this.isResizing) {
                this.isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                const r = this.container.querySelector('#sidebar-resizer');
                if (r) r.style.background = 'transparent';
            }
        });
        this.render();
        store.subscribe((state, changed) => {
            if (changed && Object.keys(changed).every(k => ['workflows', 'jobs', 'page', 'isLoading', 'activeModalItem'].includes(k))) {
                return;
            }
            this.render();
        });
    }

    buildTree(tags) {
        const root = {};
        const tagMap = new Map(tags.map(t => [t.full_tag, t]));
        for (const tag of tags) {
            const segs = tag.full_tag.split('.');
            let curr = root;
            let path = '';
            for (let i = 0; i < segs.length; i++) {
                const seg = segs[i];
                path = path ? `${path}.${seg}` : seg;
                if (!curr[seg]) {
                    const match = tagMap.get(path);
                    curr[seg] = {
                        label: seg,
                        full_tag: path,
                        count: match ? (match.count || 0) : 0,
                        id: match ? match.id : null,
                        children: {}
                    };
                }
                if (i === segs.length - 1) {
                    curr[seg].count = tag.count || 0;
                    curr[seg].id = tag.id;
                }
                curr = curr[seg].children;
            }
        }
        return root;
    }

    renderTree(nodeMap, level = 0) {
        const keys = Object.keys(nodeMap).sort();
        if (keys.length === 0) return '';

        let html = `<ul style="list-style: none; padding-left: ${level > 0 ? 14 : 0}px; margin: 2px 0;">`;
        const activeFilter = store.get('activeFilter');

        for (const key of keys) {
            const node = nodeMap[key];
            const hasChildren = Object.keys(node.children).length > 0;
            const isExpanded = this.expandedNodes.has(node.full_tag);
            const isActive = activeFilter === node.full_tag;
            const parts = node.full_tag.split('.');
            const isComposite = parts.length > 1;
            const tooltip = isComposite
                ? `Composite Tag: ${node.full_tag}&#10;• Hierarchy: ${parts.join(' ➔ ')} (${parts.length} levels)&#10;• Media Items: ${node.count}`
                : `Tag: ${node.full_tag}&#10;• Media Items: ${node.count}`;

            html += `
              <li style="margin: 2px 0;">
                <div class="tag-tree-item ${isActive ? 'active' : ''}"
                     data-tag="${node.full_tag}" title="${tooltip}"
                     style="display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-radius: var(--radius-sm); cursor: pointer; background: ${isActive ? 'rgba(0, 240, 255, 0.15)' : 'transparent'}; border: 1px solid ${isActive ? 'var(--accent-cyan)' : 'transparent'}; transition: all 0.15s ease; min-height: 36px;">
                  <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; flex: 1; margin-right: 8px;">
                    ${hasChildren ? `
                      <span class="toggle-btn" data-toggle="${node.full_tag}" style="cursor: pointer; display: inline-block; width: 16px; text-align: center; color: var(--text-muted); font-size: 0.75rem;">
                        ${isExpanded ? '▼' : '▶'}
                      </span>
                    ` : '<span style="width: 16px;"></span>'}
                    <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem;" title="${tooltip}">
                      ${node.label}
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="badge" style="background: ${isActive ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.08)'}; color: ${isActive ? '#000' : 'var(--text-secondary)'}; font-size: 0.75rem;">
                      ${node.count}
                    </span>
                    ${node.id ? `
                      <button class="btn-tag-rename" data-id="${node.id}" data-tag="${node.full_tag}" title="Rename Tag"
                              style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 4px; font-size: 0.75rem; border-radius: 4px;">✎</button>
                      <button class="btn-tag-delete" data-id="${node.id}" data-tag="${node.full_tag}" title="Delete Tag"
                              style="background: transparent; border: none; color: var(--accent-pink); cursor: pointer; padding: 2px 4px; font-size: 0.75rem; border-radius: 4px;">✕</button>
                    ` : ''}
                  </div>
                </div>
                ${hasChildren && isExpanded ? this.renderTree(node.children, level + 1) : ''}
              </li>
            `;
        }
        html += '</ul>';
        return html;
    }

    render() {
        const scrollEl = this.container.querySelector('#sidebar-taxonomy-scroll');
        const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
        const tags = store.get('tags') || [];
        const tree = this.buildTree(tags);
        const activeFilter = store.get('activeFilter');
        const isAllActive = !activeFilter || activeFilter === 'All';
        const viewMode = store.get('viewMode') || 'grid';
        const mediaType = store.get('mediaType') || 'all';
        const multiMode = store.get('multiFilterMode') || 'AND';

        // Sort Options
        const sortOptions = [
            { id: 'asciibetical', label: 'Asciibetical' },
            { id: 'random', label: 'Random' },
            { id: 'creation_date', label: 'Creation Date' },
            { id: 'modification_date', label: 'Mod Date' },
            { id: 'file_size', label: 'File Size' },
            { id: 'pixel_count', label: 'Pixel Count' },
            { id: 'duration', label: 'Duration' },
            { id: 'tag_count', label: 'Tag Count' }
        ];
        const currentSortBy = store.get('sortBy') || 'creation_date';
        const currentSortDir = store.get('sortDir') || 'desc';
        const sortButtonsHtml = sortOptions.map(opt => {
            const isSel = currentSortBy === opt.id;
            const arrow = isSel && opt.id !== 'random' ? (currentSortDir === 'asc' ? ' ▲' : ' ▼') : '';
            return `
              <button class="btn sort-radio-btn" data-sort="${opt.id}" style="height: 32px; font-size: 0.75rem; justify-content: flex-start; padding: 0 8px; background: ${isSel ? 'rgba(0, 240, 255, 0.15)' : 'transparent'}; border: 1px solid ${isSel ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: ${isSel ? '#fff' : 'var(--text-secondary)'}; font-weight: ${isSel ? '700' : '500'}; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid ${isSel ? 'var(--accent-cyan)' : 'var(--text-muted)'}; background: ${isSel ? 'var(--accent-cyan)' : 'transparent'}; margin-right: 6px; flex-shrink: 0;"></span>
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${opt.label}${arrow}</span>
              </button>
            `;
        }).join('');

        this.container.innerHTML = `
          <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden;">

            <!-- Section 1: Actions & Generation -->
            <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
              <div class="accordion-header" data-section="actions" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                <span>🎮 Actions & Gen</span>
                <span>${this.expandedSections.has('actions') ? '▼' : '▶'}</span>
              </div>
              ${this.expandedSections.has('actions') ? `
                <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 8px;">
                  <div style="display: flex; gap: 8px;">
                    <button class="btn btn-primary" id="btn-gen-t2i" style="flex: 1; height: 36px; font-size: 0.85rem;" title="Text-to-Image Generation">🎨 T2I</button>
                    <button class="btn btn-primary" id="btn-gen-t2v" style="flex: 1; height: 36px; font-size: 0.85rem; background: var(--accent-purple); border-color: rgba(157, 0, 255, 0.4);" title="Text-to-Video Generation">🎬 T2V</button>
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <button class="btn" id="btn-import" title="Import Media" style="flex: 1; height: 36px; font-size: 0.8rem;">📥 Import</button>
                    <button class="btn" id="btn-reingest-displayed" title="Re-Ingest Displayed Media" style="flex: 1; height: 36px; font-size: 0.8rem;">🔄 Re-Ingest</button>
                  </div>
                  <button class="btn" id="btn-copy-selected-bash" title="Copy media paths escaped for Bash (copies selected items, or all displayed if none selected)"
                          style="width: 100%; height: 36px; font-size: 0.8rem; border-color: rgba(0, 255, 102, 0.4); color: #00ff66; background: rgba(0, 255, 102, 0.05); display: flex; align-items: center; justify-content: center; gap: 6px;">
                    📋 Copy Paths (Bash) ${store.get('selectedIds').size > 0 ? `<span class="badge" style="background: #00ff66; color: #000;">${store.get('selectedIds').size}</span>` : ''}
                  </button>
                  <button class="btn" id="btn-open-tag-cloud" style="width: 100%; height: 36px; font-size: 0.85rem; border-color: rgba(0, 240, 255, 0.3); color: var(--accent-cyan); background: rgba(0, 240, 255, 0.05);" title="View Tag Cloud for displayed media">
                    ☁ Tag Cloud Modal
                  </button>
                </div>
              ` : ''}
            </div>

            <!-- Section 2: View & Display -->
            <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
              <div class="accordion-header" data-section="view" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                <span>🖥 View & Display</span>
                <span>${this.expandedSections.has('view') ? '▼' : '▶'}</span>
              </div>
              ${this.expandedSections.has('view') ? `
                <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">Layout:</span>
                    <div style="display: flex; background: rgba(0,0,0,0.4); border-radius: var(--radius-full); padding: 2px; border: 1px solid var(--border-color);">
                      <button class="btn btn-icon view-btn ${viewMode === 'grid' ? 'active' : ''}" data-view="grid" title="Compact Grid ▦" style="width: 30px; height: 30px; border: none; background: ${viewMode === 'grid' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff;">▦</button>
                      <button class="btn btn-icon view-btn ${viewMode === 'montage' ? 'active' : ''}" data-view="montage" title="Montage / Masonry ▧" style="width: 30px; height: 30px; border: none; background: ${viewMode === 'montage' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff;">▧</button>
                      <button class="btn btn-icon view-btn ${viewMode === 'viewport' ? 'active' : ''}" data-view="viewport" title="Full Viewport Feed ▣" style="width: 30px; height: 30px; border: none; background: ${viewMode === 'viewport' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff;">▣</button>
                    </div>
                  </div>

                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">Type:</span>
                    <div style="display: flex; background: rgba(0,0,0,0.4); border-radius: var(--radius-full); padding: 2px; border: 1px solid var(--border-color);">
                      <button class="btn btn-icon type-btn ${mediaType === 'all' ? 'active' : ''}" data-type="all" title="All Media" style="width: 30px; height: 30px; border: none; background: ${mediaType === 'all' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff; font-size: 0.8rem;">🌟</button>
                      <button class="btn btn-icon type-btn ${mediaType === 'image' ? 'active' : ''}" data-type="image" title="Images Only" style="width: 30px; height: 30px; border: none; background: ${mediaType === 'image' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff; font-size: 0.8rem;">📷</button>
                      <button class="btn btn-icon type-btn ${mediaType === 'video' ? 'active' : ''}" data-type="video" title="Videos Only" style="width: 30px; height: 30px; border: none; background: ${mediaType === 'video' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff; font-size: 0.8rem;">🎬</button>
                      <button class="btn btn-icon type-btn ${mediaType === 'audio' ? 'active' : ''}" data-type="audio" title="Audio Only" style="width: 30px; height: 30px; border: none; background: ${mediaType === 'audio' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff; font-size: 0.8rem;">🎵</button>
                    </div>
                  </div>

                  <div style="display: flex; gap: 6px;">
                    <button class="btn btn-icon" id="btn-hud-toggle" title="Toggle Overlay HUD" style="flex: 1; height: 32px; font-size: 0.75rem; background: ${store.get('hudVisible', true) !== false ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${store.get('hudVisible', true) !== false ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff;">
                      👁 HUD: ${store.get('hudVisible', true) !== false ? 'On' : 'Off'}
                    </button>
                    <button class="btn btn-icon" id="btn-anim-thumbs-toggle" title="Toggle Animated Thumbs" style="flex: 1; height: 32px; font-size: 0.75rem; background: ${store.get('animThumbs', true) !== false ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${store.get('animThumbs', true) !== false ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff;">
                      🎬 Anim: ${store.get('animThumbs', true) !== false ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 2px;">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">Multi-tag logic:</span>
                    <button class="btn" id="btn-multi-mode" title="Toggle Multi-filter Logic" style="height: 28px; font-size: 0.7rem; font-weight: 700; padding: 0 10px; border-color: rgba(0, 240, 255, 0.3);">
                      ${multiMode}
                    </button>
                  </div>
                </div>
              ` : ''}
            </div>

            <!-- Section 3: Sort & Order -->
            <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
              <div class="accordion-header" data-section="sort" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                <span>📶 Sort & Order</span>
                <span>${this.expandedSections.has('sort') ? '▼' : '▶'}</span>
              </div>
              ${this.expandedSections.has('sort') ? `
                <div style="padding: 0 16px 14px 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                  ${sortButtonsHtml}
                </div>
              ` : ''}
            </div>

            <!-- Section 4: Tag Taxonomy -->
            <div class="sidebar-section" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
              <div class="accordion-header" data-section="taxonomy" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase; border-bottom: ${this.expandedSections.has('taxonomy') ? '1px solid var(--border-color)' : 'none'}; flex-shrink: 0;">
                <span style="display: flex; align-items: center; gap: 8px;">
                  <span>🗂 Tag Taxonomy</span>
                  <button class="btn btn-icon" id="btn-new-tag" title="Create Tag" style="width: 24px; height: 24px; font-size: 0.9rem;">+</button>
                </span>
                <span>${this.expandedSections.has('taxonomy') ? '▼' : '▶'}</span>
              </div>
              ${this.expandedSections.has('taxonomy') ? `
                <div id="sidebar-taxonomy-scroll" style="padding: 12px; flex: 1; overflow-y: auto;">
                  <div class="tag-tree-item ${isAllActive ? 'active' : ''}" data-tag=""
                       style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; background: ${isAllActive ? 'rgba(0, 240, 255, 0.15)' : 'transparent'}; border: 1px solid ${isAllActive ? 'var(--accent-cyan)' : 'transparent'}; margin-bottom: 8px; font-weight: 600; min-height: 38px;">
                    <span>🌟 All Media</span>
                    <span class="badge" style="background: ${isAllActive ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.08)'}; color: ${isAllActive ? '#000' : 'var(--text-secondary)'};">
                      ${store.get('totalItems')}
                    </span>
                  </div>
                  ${this.renderTree(tree)}
                </div>
              ` : ''}
            </div>

            <!-- Sidebar Horizontal Resizer Handle -->
            <div id="sidebar-resizer" title="Drag horizontally to resize sidebar"
                 style="position: absolute; top: 0; right: -4px; width: 8px; height: 100%; cursor: col-resize; z-index: 100; background: transparent; transition: background 0.2s ease;"></div>
          </div>
        `;

        this.attachEvents();
        const newScrollEl = this.container.querySelector('#sidebar-taxonomy-scroll');
        if (newScrollEl) newScrollEl.scrollTop = scrollTop;
    }

    attachEvents() {
        // Accordion headers
        this.container.querySelectorAll('.accordion-header').forEach(hdr => {
            hdr.addEventListener('click', (e) => {
                if (e.target.closest('#btn-new-tag')) return;
                const sec = hdr.getAttribute('data-section');
                if (this.expandedSections.has(sec)) {
                    this.expandedSections.delete(sec);
                } else {
                    this.expandedSections.add(sec);
                }
                this.render();
            });
        });

        // Sort Radio Buttons
        this.container.querySelectorAll('.sort-radio-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const sortId = btn.getAttribute('data-sort');
                const currentSortBy = store.get('sortBy') || 'creation_date';
                const currentSortDir = store.get('sortDir') || 'desc';
                if (sortId === currentSortBy && sortId !== 'random') {
                    const nextDir = currentSortDir === 'asc' ? 'desc' : 'asc';
                    store.set({ sortDir: nextDir });
                } else {
                    const defaultDir = sortId === 'asciibetical' ? 'asc' : 'desc';
                    store.set({ sortBy: sortId, sortDir: defaultDir });
                }
                await store.loadBrowse(true);
            });
        });

        // Open Tag Cloud Modal
        const cloudBtn = this.container.querySelector('#btn-open-tag-cloud');
        if (cloudBtn) {
            cloudBtn.addEventListener('click', () => {
                store.set({ isTagCloudOpen: true });
            });
        }

        // Tag Tree Items
        this.container.querySelectorAll('.tag-tree-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.toggle-btn') || e.target.closest('.btn-tag-rename') || e.target.closest('.btn-tag-delete')) return;
                const tag = el.getAttribute('data-tag');
                store.setFilter(tag);
            });
        });

        this.container.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.getAttribute('data-toggle');
                if (this.expandedNodes.has(tag)) {
                    this.expandedNodes.delete(tag);
                } else {
                    this.expandedNodes.add(tag);
                }
                this.render();
            });
        });

        this.container.querySelectorAll('.btn-tag-rename').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const oldTag = btn.getAttribute('data-tag');
                const tagId = btn.getAttribute('data-id');
                const newTag = prompt(`Rename tag "${oldTag}" (affects all items and sub-tags):`, oldTag);
                if (newTag && newTag.trim() && newTag.trim() !== oldTag) {
                    try {
                        await api.renameTag(tagId, newTag.trim());
                        await store.loadTags();
                        const activeFilter = store.get('activeFilter');
                        if (activeFilter === oldTag) {
                            store.setFilter(newTag.trim());
                        } else if (activeFilter && activeFilter.startsWith(oldTag + '.')) {
                            const suffix = activeFilter.slice(oldTag.length);
                            store.setFilter(newTag.trim() + suffix);
                        }
                    } catch (err) {
                        alert(`Failed to rename tag: ${err.message}`);
                    }
                }
            });
        });

        this.container.querySelectorAll('.btn-tag-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const tagStr = btn.getAttribute('data-tag');
                const tagId = btn.getAttribute('data-id');
                if (confirm(`Are you sure you want to delete the tag "${tagStr}"?\n\nAny media tagged with "${tagStr}" will be reassigned to its parent category.`)) {
                    try {
                        await api.deleteTag(tagId, true);
                        await store.loadTags();
                        const activeFilter = store.get('activeFilter');
                        if (activeFilter === tagStr || (activeFilter && activeFilter.startsWith(tagStr + '.'))) {
                            const parts = tagStr.split('.');
                            parts.pop();
                            store.setFilter(parts.join('') || 'All');
                        }
                    } catch (err) {
                        alert(`Failed to delete tag: ${err.message}`);
                    }
                }
            });
        });

        const newBtn = this.container.querySelector('#btn-new-tag');
        if (newBtn) {
            newBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const name = prompt('Enter new tag (e.g. Person.Jake or Movie.Clip):');
                if (name && name.trim()) {
                    try {
                        await api.createTag(name.trim());
                        await store.loadTags();
                    } catch (err) {
                        alert(`Failed to create tag: ${err.message}`);
                    }
                }
            });
        }

        // Moved Controls from FilterBar
        const importBtn = this.container.querySelector('#btn-import');
        if (importBtn) {
            importBtn.addEventListener('click', async () => {
                const path = prompt('Enter absolute directory or file path to import (e.g. /home/coding/git/toxik/samples):');
                if (path && path.trim()) {
                    const tagPrompt = prompt('Optional tag to assign to imported media (leave blank for none, e.g. Import.Vacation):', '');
                    const tagsToApply = tagPrompt && tagPrompt.trim() ? [tagPrompt.trim()] : [];
                    try {
                        importBtn.textContent = '⏳ Importing...';
                        importBtn.disabled = true;
                        const res = await api.importMedia([path.trim()], tagsToApply);
                        alert(`Successfully imported ${res.length} media items!${tagsToApply.length ? ` Tagged as "${tagsToApply[0]}".` : ''}`);
                        await store.loadBrowse(true);
                        await store.loadTags();
                    } catch (err) {
                        alert(`Import failed: ${err.message}`);
                    } finally {
                        importBtn.textContent = '📥 Import';
                        importBtn.disabled = false;
                    }
                }
            });
        }

        const reingestBtn = this.container.querySelector('#btn-reingest-displayed');
        if (reingestBtn) {
            reingestBtn.addEventListener('click', async () => {
                const results = store.get('results') || [];
                const displayedIds = results
                    .filter(r => r.type === 'item' && r.media && r.media.id)
                    .map(r => r.media.id);
                if (!displayedIds.length) {
                    alert('No media currently displayed to re-ingest.');
                    return;
                }
                const confirmMsg = `Re-ingest ${displayedIds.length} currently displayed media item(s)?\nThis will regenerate thumbnails and re-run auto-tagging based on path and workflow names.`;
                if (!confirm(confirmMsg)) return;

                try {
                    reingestBtn.textContent = '⏳ Re-ingesting...';
                    reingestBtn.disabled = true;
                    const res = await api.reingestBatch(displayedIds);
                    await store.loadBrowse(true);
                    await store.loadTags();
                } catch (err) {
                    alert(`Re-ingest failed: ${err.message}`);
                } finally {
                    reingestBtn.textContent = '🔄 Re-Ingest';
                    reingestBtn.disabled = false;
                }
            });
        }

        const t2iBtn = this.container.querySelector('#btn-gen-t2i');
        if (t2iBtn) {
            t2iBtn.addEventListener('click', () => {
                const willOpen = !store.get('isGenerationOpen');
                const sticky = store.get('stickyTab') || 'form';
                store.set({ isGenerationOpen: willOpen, generationTab: sticky, entryMode: 'T2I' });
            });
        }

        const t2vBtn = this.container.querySelector('#btn-gen-t2v');
        if (t2vBtn) {
            t2vBtn.addEventListener('click', () => {
                const willOpen = !store.get('isGenerationOpen');
                const sticky = store.get('stickyTab') || 'form';
                store.set({ isGenerationOpen: willOpen, generationTab: sticky, entryMode: 'T2V' });
            });
        }

        this.container.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.getAttribute('data-type');
                store.setMediaType(type);
            });
        });

        this.container.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-view');
                store.setViewMode(view);
            });
        });

        const hudBtn = this.container.querySelector('#btn-hud-toggle');
        if (hudBtn) {
            hudBtn.addEventListener('click', () => {
                const current = store.get('hudVisible', true) !== false;
                const nextVal = !current;
                store.set({ hudVisible: nextVal });
                if (nextVal) {
                    document.body.classList.remove('hud-off');
                } else {
                    document.body.classList.add('hud-off');
                }
            });
        }

        const animBtn = this.container.querySelector('#btn-anim-thumbs-toggle');
        if (animBtn) {
            animBtn.addEventListener('click', () => {
                const current = store.get('animThumbs', true) !== false;
                store.set({ animThumbs: !current });
            });
        }

        const multiBtn = this.container.querySelector('#btn-multi-mode');
        if (multiBtn) {
            multiBtn.addEventListener('click', () => {
                const next = store.get('multiFilterMode') === 'AND' ? 'OR' : 'AND';
                store.set({ multiFilterMode: next });
            });
        }

        const resizer = this.container.querySelector('#sidebar-resizer');
        if (resizer) {
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.isResizing = true;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                resizer.style.background = 'var(--accent-cyan)';
            });
            resizer.addEventListener('mouseenter', () => {
                if (!this.isResizing) resizer.style.background = 'rgba(0, 240, 255, 0.3)';
            });
            resizer.addEventListener('mouseleave', () => {
                if (!this.isResizing) resizer.style.background = 'transparent';
            });
        }

        const copyBashBtn = this.container.querySelector('#btn-copy-selected-bash');
        if (copyBashBtn) {
            copyBashBtn.addEventListener('click', async () => {
                const selectedIds = store.get('selectedIds');
                const results = store.get('results') || [];
                const displayedMap = new Map(results.filter(r => r.media).map(r => [r.media.id, r.media]));
                const ids = selectedIds.size > 0 ? Array.from(selectedIds) : Array.from(displayedMap.keys());
                const paths = [];
                for (const mid of ids) {
                    let item = displayedMap.get(mid);
                    if (!item) {
                        try { item = await api.getMedia(mid); } catch (e) { continue; }
                    }
                    if (item && item.filepath) {
                        paths.push("'" + item.filepath.replace(/'/g, "'\\''") + "'");
                    }
                }
                if (paths.length === 0) {
                    alert('No media items to copy!');
                    return;
                }
                const bashStr = paths.join(' ');
                try {
                    await navigator.clipboard.writeText(bashStr);
                    const orig = copyBashBtn.innerHTML;
                    copyBashBtn.innerHTML = `✅ Copied ${paths.length} path(s)!`;
                    setTimeout(() => copyBashBtn.innerHTML = orig, 1500);
                } catch (err) {
                    const ta = document.createElement('textarea');
                    ta.value = bashStr;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    const orig = copyBashBtn.innerHTML;
                    copyBashBtn.innerHTML = `✅ Copied ${paths.length} path(s)!`;
                    setTimeout(() => copyBashBtn.innerHTML = orig, 1500);
                }
            });
        }
    }
}

