import { store } from '../state/store.js';
import { api } from '../api/client.js';

export class TagSidebar {
    constructor(container) {
        this.container = container;
        try {
            const savedNodes = localStorage.getItem('toxik_expanded_nodes');
            this.expandedNodes = savedNodes ? new Set(JSON.parse(savedNodes)) : new Set(['Person', 'Movie', 'Style']);
        } catch (e) {
            this.expandedNodes = new Set(['Person', 'Movie', 'Style']);
        }
        try {
            const savedSections = localStorage.getItem('toxik_expanded_sections');
            this.expandedSections = savedSections ? new Set(JSON.parse(savedSections)) : new Set(['actions', 'view', 'sort', 'taxonomy']);
        } catch (e) {
            this.expandedSections = new Set(['actions', 'view', 'sort', 'taxonomy']);
        }
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
        const activeFilter = (store.get('activeFilter') || '').trim();
        const tokens = activeFilter ? activeFilter.split(/\s+/) : [];
        const incTags = new Set();
        const excTags = new Set();
        for (const tok of tokens) {
            if (tok.startsWith('-')) excTags.add(tok.substring(1));
            else if (tok.startsWith('+')) incTags.add(tok.substring(1));
            else incTags.add(tok);
        }
        const orphanMode = store.get('orphanMode') || 'exclude';

        for (const key of keys) {
            const node = nodeMap[key];
            const hasChildren = Object.keys(node.children).length > 0;
            const isExpanded = this.expandedNodes.has(node.full_tag);
            const isOrphan = node.full_tag === 'orphan';

            let isIncluded = false;
            let isExcluded = false;
            if (isOrphan) {
                isIncluded = incTags.has('orphan') || (!excTags.has('orphan') && orphanMode === 'include');
                isExcluded = excTags.has('orphan') || (!incTags.has('orphan') && orphanMode === 'exclude');
            } else {
                isIncluded = incTags.has(node.full_tag);
                isExcluded = excTags.has(node.full_tag);
            }

            const parts = node.full_tag.split('.');
            const isComposite = parts.length > 1;
            const tooltip = isComposite
                ? `Composite Tag: ${node.full_tag}&#10;• Hierarchy: ${parts.join(' ➔ ')} (${parts.length} levels)&#10;• Media Items: ${node.count}`
                : `Tag: ${node.full_tag}&#10;• Media Items: ${node.count}`;

            let rowBg = 'transparent';
            let rowBorder = 'transparent';
            if (isIncluded) {
                rowBg = 'rgba(0, 255, 136, 0.15)';
                rowBorder = '#00ff88';
            } else if (isExcluded) {
                rowBg = 'rgba(255, 68, 68, 0.15)';
                rowBorder = '#ff4444';
            }

            html += `
              <li style="margin: 2px 0;">
                <div class="tag-tree-item"
                     data-tag="${node.full_tag}" title="${tooltip}"
                     style="display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-radius: var(--radius-sm); cursor: pointer; background: ${rowBg}; border: 1px solid ${rowBorder}; transition: all 0.15s ease; min-height: 36px;">
                  <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; flex: 1; margin-right: 8px;">
                    ${hasChildren ? `
                      <span class="toggle-btn" data-toggle="${node.full_tag}" style="cursor: pointer; display: inline-block; width: 16px; text-align: center; color: var(--text-muted); font-size: 0.75rem;">
                        ${isExpanded ? '▼' : '▶'}
                      </span>
                    ` : '<span style="width: 16px;"></span>'}
                    <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; ${isExcluded ? 'text-decoration: line-through; opacity: 0.8;' : ''}" title="${tooltip}">
                      ${node.label}
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <button class="btn-tag-inc" data-tag="${node.full_tag}" title="Include (+)"
                            style="background: ${isIncluded ? '#00ff88' : 'rgba(255,255,255,0.08)'}; color: ${isIncluded ? '#000' : '#aaa'}; border: none; font-weight: 800; font-size: 0.75rem; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;">+</button>
                    <button class="btn-tag-exc" data-tag="${node.full_tag}" title="Exclude (-)"
                            style="background: ${isExcluded ? '#ff4444' : 'rgba(255,255,255,0.08)'}; color: ${isExcluded ? '#fff' : '#aaa'}; border: none; font-weight: 800; font-size: 0.75rem; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;">−</button>
                    <span class="badge" style="background: ${isIncluded ? '#00ff88' : (isExcluded ? '#ff4444' : 'rgba(255,255,255,0.08)')}; color: ${isIncluded || isExcluded ? '#000' : 'var(--text-secondary)'}; font-size: 0.75rem; margin-left: 2px;">
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
        const scrollEl = this.container.querySelector('#sidebar-main-scroll');
        const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
        const tags = store.get('tags') || [];
        const tree = this.buildTree(tags);
        const activeFilter = store.get('activeFilter');
        const isAllActive = !activeFilter || activeFilter === 'All';
        const viewMode = store.get('viewMode') || 'grid';
        const mediaType = store.get('mediaType') || 'all';

        // Sort Options
        const sortOptions = [
            { id: 'asciibetical', label: 'Asciibetical' },
            { id: 'tag_abetical', label: 'Tag-abetical' },
            { id: 'random', label: 'Random' },
            { id: 'creation_date', label: 'Creation Date' },
            { id: 'modification_date', label: 'Mod Date' },
            { id: 'file_size', label: 'File Size' },
            { id: 'pixel_count', label: 'Pixel Count' },
            { id: 'duration', label: 'Duration' },
            { id: 'tag_count', label: 'Tag Count' }
        ];
        const sortChain = store.get('sortChain') || [{ id: store.get('sortBy') || 'creation_date', dir: store.get('sortDir') || 'desc' }];
        const sortButtonsHtml = sortOptions.map(opt => {
            const idx = sortChain.findIndex(s => s.id === opt.id);
            const isSel = idx !== -1;
            const arrow = isSel && opt.id !== 'random' ? (sortChain[idx].dir === 'asc' ? ' ▲' : ' ▼') : '';
            const sub = (isSel && sortChain.length > 1) ? `<sub style="font-size:0.6rem; color: #00ff66; margin-left: 2px;">${idx + 1}</sub>` : '';
            return `
              <button class="btn sort-radio-btn" data-sort="${opt.id}" title="Click: Set primary sort | Ctrl+Click: Add sub-sort / toggle dir | Shift+Click: Remove sort" style="height: 32px; font-size: 0.75rem; justify-content: flex-start; padding: 0 8px; background: ${isSel ? 'rgba(0, 240, 255, 0.15)' : 'transparent'}; border: 1px solid ${isSel ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: ${isSel ? '#fff' : 'var(--text-secondary)'}; font-weight: ${isSel ? '700' : '500'}; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid ${isSel ? 'var(--accent-cyan)' : 'var(--text-muted)'}; background: ${isSel ? 'var(--accent-cyan)' : 'transparent'}; margin-right: 6px; flex-shrink: 0;"></span>
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${opt.label}${sub}${arrow}</span>
              </button>
            `;
        }).join('');

        this.container.innerHTML = `
          <div style="display: flex; flex-direction: column; height: 100%; overflow: hidden; position: relative;">
            <div id="sidebar-main-scroll" style="display: flex; flex-direction: column; flex: 1; overflow-y: auto; overflow-x: hidden; padding-bottom: 24px;">

              <!-- Section 1: Actions & Generation -->
              <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
                <div class="accordion-header" data-section="actions" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                  <span>🎮 Actions & Gen</span>
                  <span>${this.expandedSections.has('actions') ? '▼' : '▶'}</span>
                </div>
                ${this.expandedSections.has('actions') ? `
                  <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 8px;">
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
                        <button class="btn btn-icon view-btn ${viewMode === 'list' ? 'active' : ''}" data-view="list" title="Simple List ☰" style="width: 30px; height: 30px; border: none; background: ${viewMode === 'list' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff;">☰</button>
                        <button class="btn btn-icon view-btn ${viewMode === 'montage' ? 'active' : ''}" data-view="montage" title="Montage / Masonry ▧" style="width: 30px; height: 30px; border: none; background: ${viewMode === 'montage' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff;">▧</button>
                        <button class="btn btn-icon view-btn ${viewMode === 'viewport' ? 'active' : ''}" data-view="viewport" title="Full Viewport Feed ▣" style="width: 30px; height: 30px; border: none; background: ${viewMode === 'viewport' ? 'var(--accent-gradient)' : 'transparent'}; color: #fff;">▣</button>
                      </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="font-size: 0.75rem; color: var(--text-muted);">Type:</span>
                      ${(() => {
                          const excludedTypes = new Set((mediaType || '').split(',').map(t => t.trim()).filter(t => t.startsWith('-')).map(t => t.substring(1)));
                          const isAll = mediaType === 'all' || (!mediaType || mediaType === '');
                          return `
                          <div style="display: flex; background: rgba(0,0,0,0.4); border-radius: var(--radius-full); padding: 2px; border: 1px solid var(--border-color);">
                            <button class="btn btn-icon type-btn ${isAll ? 'active' : ''}" data-type="all" title="All Media" style="width: 30px; height: 30px; border: none; background: ${isAll ? 'var(--accent-gradient)' : 'transparent'}; color: #fff; font-size: 0.8rem;">🌟</button>
                            <button class="btn btn-icon type-btn ${mediaType === 'image' ? 'active' : ''}" data-type="image" title="Images Only (Ctrl+Click to exclude)" style="width: 30px; height: 30px; border: none; background: ${mediaType === 'image' ? 'var(--accent-gradient)' : (excludedTypes.has('image') ? '#ff4444' : 'transparent')}; color: #fff; font-size: 0.8rem; ${excludedTypes.has('image') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">📷</button>
                            <button class="btn btn-icon type-btn ${mediaType === 'video' ? 'active' : ''}" data-type="video" title="Videos Only (Ctrl+Click to exclude)" style="width: 30px; height: 30px; border: none; background: ${mediaType === 'video' ? 'var(--accent-gradient)' : (excludedTypes.has('video') ? '#ff4444' : 'transparent')}; color: #fff; font-size: 0.8rem; ${excludedTypes.has('video') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">🎬</button>
                            <button class="btn btn-icon type-btn ${mediaType === 'audio' ? 'active' : ''}" data-type="audio" title="Audio Only (Ctrl+Click to exclude)" style="width: 30px; height: 30px; border: none; background: ${mediaType === 'audio' ? 'var(--accent-gradient)' : (excludedTypes.has('audio') ? '#ff4444' : 'transparent')}; color: #fff; font-size: 0.8rem; ${excludedTypes.has('audio') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">🎵</button>
                            <button class="btn btn-icon type-btn ${mediaType === 'doc' ? 'active' : ''}" data-type="doc" title="Docs & Ebooks Only (Ctrl+Click to exclude)" style="width: 30px; height: 30px; border: none; background: ${mediaType === 'doc' ? 'var(--accent-gradient)' : (excludedTypes.has('doc') ? '#ff4444' : 'transparent')}; color: #fff; font-size: 0.8rem; ${excludedTypes.has('doc') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">📄</button>
                          </div>
                          `;
                      })()}
                    </div>

                    <div style="display: flex; gap: 6px;">
                      <button class="btn btn-icon" id="btn-hud-toggle" title="Toggle Overlay HUD" style="flex: 1; height: 32px; font-size: 0.75rem; background: ${store.get('hudVisible', true) !== false ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${store.get('hudVisible', true) !== false ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff;">
                        👁 HUD: ${store.get('hudVisible', true) !== false ? 'On' : 'Off'}
                      </button>
                      <button class="btn btn-icon" id="btn-anim-thumbs-toggle" title="Toggle Animated Thumbs" style="flex: 1; height: 32px; font-size: 0.75rem; background: ${store.get('animThumbs', true) !== false ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${store.get('animThumbs', true) !== false ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff;">
                        🎬 Anim: ${store.get('animThumbs', true) !== false ? 'On' : 'Off'}
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
              <div class="sidebar-section" style="flex-shrink: 0; display: flex; flex-direction: column;">
                <div class="accordion-header" data-section="taxonomy" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase; border-bottom: ${this.expandedSections.has('taxonomy') ? '1px solid var(--border-color)' : 'none'};">
                  <span style="display: flex; align-items: center; gap: 8px;">
                    <span>🗂 Tag Taxonomy</span>
                    <button class="btn btn-icon" id="btn-new-tag" title="Create Tag" style="width: 24px; height: 24px; font-size: 0.9rem;">+</button>
                  </span>
                  <span>${this.expandedSections.has('taxonomy') ? '▼' : '▶'}</span>
                </div>
                ${this.expandedSections.has('taxonomy') ? `
                  <div style="padding: 12px;">
                    <div class="tag-tree-item ${isAllActive ? 'active' : ''}" data-tag=""
                         style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; background: ${isAllActive ? 'rgba(0, 240, 255, 0.15)' : 'transparent'}; border: 1px solid ${isAllActive ? 'var(--accent-cyan)' : 'transparent'}; margin-bottom: 8px; font-weight: 600; min-height: 38px;">
                      <span>🌟 All Media</span>
                      <span class="badge" style="background: ${isAllActive ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.08)'}; color: ${isAllActive ? '#000' : 'var(--text-secondary)'};">
                        ${store.get('totalLibraryItems') || store.get('totalItems')}
                      </span>
                    </div>
                    ${this.renderTree(tree)}
                  </div>
                ` : ''}
              </div>

            </div>

            <!-- Sidebar Horizontal Resizer Handle -->
            <div id="sidebar-resizer" title="Drag horizontally to resize sidebar"
                 style="position: absolute; top: 0; right: -4px; width: 8px; height: 100%; cursor: col-resize; z-index: 100; background: transparent; transition: background 0.2s ease;"></div>
          </div>
        `;

        this.attachEvents();
        const newScrollEl = this.container.querySelector('#sidebar-main-scroll');
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
                try {
                    localStorage.setItem('toxik_expanded_sections', JSON.stringify(Array.from(this.expandedSections)));
                } catch (err) {}
                this.render();
            });
        });

        // Sort Radio Buttons
        this.container.querySelectorAll('.sort-radio-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const sortId = btn.getAttribute('data-sort');
                const defaultDir = (sortId === 'asciibetical' || sortId === 'tag_abetical') ? 'asc' : 'desc';
                let chain = store.get('sortChain') || [{ id: store.get('sortBy') || 'creation_date', dir: store.get('sortDir') || 'desc' }];
                const idx = chain.findIndex(s => s.id === sortId);

                if (e.shiftKey) {
                    // Shift+click removes a sort
                    if (idx !== -1 && chain.length > 1) {
                        chain.splice(idx, 1);
                        store.setSortChain(chain);
                        await store.loadBrowse(true);
                    }
                    return;
                }

                if (e.ctrlKey || e.metaKey) {
                    // Control+click adds a sub-sort or toggles direction if already in chain
                    if (idx !== -1) {
                        if (sortId !== 'random') {
                            chain[idx].dir = chain[idx].dir === 'asc' ? 'desc' : 'asc';
                        }
                    } else {
                        chain.push({ id: sortId, dir: defaultDir });
                    }
                } else {
                    // Simple click sets primary sort and/or toggles direction if it was already sole primary
                    if (chain.length === 1 && chain[0].id === sortId && sortId !== 'random') {
                        chain[0].dir = chain[0].dir === 'asc' ? 'desc' : 'asc';
                    } else {
                        chain = [{ id: sortId, dir: defaultDir }];
                    }
                }

                store.setSortChain(chain);
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
                if (e.target.closest('.toggle-btn') || e.target.closest('.btn-tag-rename') || e.target.closest('.btn-tag-delete') || e.target.closest('.btn-tag-inc') || e.target.closest('.btn-tag-exc')) return;
                const tag = el.getAttribute('data-tag');
                if (tag === 'orphan') {
                    const currentMode = store.get('orphanMode') || 'exclude';
                    const nextMode = currentMode === 'include' ? 'neutral' : 'include';
                    store.set({ orphanMode: nextMode });
                    try { localStorage.setItem('toxik_orphan_mode', nextMode); } catch (err) {}
                    store.loadBrowse(true);
                    this.render();
                    return;
                }
                store.setFilter(tag);
            });
        });

        this.container.querySelectorAll('.btn-tag-inc').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.getAttribute('data-tag');
                if (tag === 'orphan') {
                    const currentMode = store.get('orphanMode') || 'exclude';
                    const nextMode = currentMode === 'include' ? 'neutral' : 'include';
                    store.set({ orphanMode: nextMode });
                    try { localStorage.setItem('toxik_orphan_mode', nextMode); } catch (err) {}
                    store.loadBrowse(true);
                    this.render();
                    return;
                }
                const activeFilter = (store.get('activeFilter') || '').trim();
                let tokens = activeFilter ? activeFilter.split(/\s+/) : [];
                const wasInc = tokens.some(t => t === tag || t === '+' + tag);
                tokens = tokens.filter(t => t !== tag && t !== '+' + tag && t !== '-' + tag);
                if (!wasInc) {
                    tokens.push('+' + tag);
                }
                store.setFilter(tokens.join(' '));
            });
        });

        this.container.querySelectorAll('.btn-tag-exc').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.getAttribute('data-tag');
                if (tag === 'orphan') {
                    const currentMode = store.get('orphanMode') || 'exclude';
                    const nextMode = currentMode === 'exclude' ? 'neutral' : 'exclude';
                    store.set({ orphanMode: nextMode });
                    try { localStorage.setItem('toxik_orphan_mode', nextMode); } catch (err) {}
                    store.loadBrowse(true);
                    this.render();
                    return;
                }
                const activeFilter = (store.get('activeFilter') || '').trim();
                let tokens = activeFilter ? activeFilter.split(/\s+/) : [];
                const wasExc = tokens.some(t => t === '-' + tag);
                tokens = tokens.filter(t => t !== tag && t !== '+' + tag && t !== '-' + tag);
                if (!wasExc) {
                    tokens.push('-' + tag);
                }
                store.setFilter(tokens.join(' '));
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
                try {
                    localStorage.setItem('toxik_expanded_nodes', JSON.stringify(Array.from(this.expandedNodes)));
                } catch (err) {}
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

        this.container.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = btn.getAttribute('data-type');
                if ((e.ctrlKey || e.metaKey) && type !== 'all') {
                    const current = store.get('mediaType') || 'all';
                    const excluded = new Set(
                        current.split(',').map(t => t.trim()).filter(t => t.startsWith('-')).map(t => t.substring(1))
                    );
                    if (excluded.has(type)) {
                        excluded.delete(type);
                    } else {
                        excluded.add(type);
                    }
                    const newType = excluded.size > 0 ? Array.from(excluded).map(t => '-' + t).join(',') : 'all';
                    store.setMediaType(newType);
                } else {
                    store.setMediaType(type);
                }
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

