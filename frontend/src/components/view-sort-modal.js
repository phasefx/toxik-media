import { store } from '../state/store.js';

export class ViewSortModal {
    constructor(container) {
        this.container = container;
        this.activeTab = 'view'; // 'view' | 'sort'
        this.render();
        store.subscribe((state, changed) => {
            if (changed && Object.keys(changed).every(k => ['workflows', 'jobs', 'page', 'isLoading', 'activeModalItem'].includes(k))) {
                return;
            }
            if (changed && changed.isViewSortOpen !== undefined) {
                this.render();
            } else if (store.get('isViewSortOpen')) {
                this.render();
            }
        });
    }

    render() {
        const isOpen = store.get('isViewSortOpen');
        if (!isOpen) {
            this.container.style.display = 'none';
            this.container.innerHTML = '';
            return;
        }

        // Setup modal container styling
        this.container.style.display = 'flex';
        this.container.style.position = 'fixed';
        this.container.style.top = '0';
        this.container.style.left = '0';
        this.container.style.width = '100vw';
        this.container.style.height = '100vh';
        this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
        this.container.style.backdropFilter = 'blur(6px)';
        this.container.style.zIndex = '9999';
        this.container.style.alignItems = 'center';
        this.container.style.justifyContent = 'center';

        const viewMode = store.get('viewMode') || 'grid';
        const mediaType = store.get('mediaType') || 'all';

        // Sort Options HTML Setup
        const sortOptions = [
            { id: 'asciibetical', label: 'Asciibetical' },
            { id: 'file_extension', label: 'File Extension' },
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
            const sub = (isSel && sortChain.length > 1) ? `<sub style="font-size:0.65rem; color: #00ff66; margin-left: 2px;">${idx + 1}</sub>` : '';
            return `
              <button class="btn sort-radio-btn" data-sort="${opt.id}" title="Click: Set primary sort | Ctrl+Click: Add sub-sort / toggle dir | Shift+Click: Remove sort"
                      style="height: 48px; font-size: 0.85rem; justify-content: flex-start; padding: 0 16px; background: ${isSel ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isSel ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: ${isSel ? '#fff' : 'var(--text-secondary)'}; font-weight: ${isSel ? '700' : '500'}; text-align: left; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s;">
                <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2px solid ${isSel ? 'var(--accent-cyan)' : 'var(--text-muted)'}; background: ${isSel ? 'var(--accent-cyan)' : 'transparent'}; flex-shrink: 0;"></span>
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${opt.label}${sub}${arrow}</span>
              </button>
            `;
        }).join('');

        let tabContent = '';
        if (this.activeTab === 'view') {
            const excludedTypes = new Set((mediaType || '').split(',').map(t => t.trim()).filter(t => t.startsWith('-')).map(t => t.substring(1)));
            const isAll = mediaType === 'all' || (!mediaType || mediaType === '');

            tabContent = `
              <div style="padding: 24px; display: flex; flex-direction: column; gap: 24px;">
                <!-- Layout settings -->
                <div>
                  <h4 style="margin: 0 0 12px 0; font-size: 1rem; color: #fff; font-weight: 700;">Layout Options</h4>
                  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn view-btn ${viewMode === 'grid' ? 'active' : ''}" data-view="grid" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${viewMode === 'grid' ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${viewMode === 'grid' ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff; border-radius: 8px; font-size: 0.9rem;">
                      ▦ Compact Grid
                    </button>
                    <button class="btn view-btn ${viewMode === 'list' ? 'active' : ''}" data-view="list" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${viewMode === 'list' ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${viewMode === 'list' ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff; border-radius: 8px; font-size: 0.9rem;">
                      ☰ Simple List
                    </button>
                    <button class="btn view-btn ${viewMode === 'montage' ? 'active' : ''}" data-view="montage" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${viewMode === 'montage' ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${viewMode === 'montage' ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff; border-radius: 8px; font-size: 0.9rem;">
                      ▧ Montage / Masonry
                    </button>
                    <button class="btn view-btn ${viewMode === 'viewport' ? 'active' : ''}" data-view="viewport" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${viewMode === 'viewport' ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${viewMode === 'viewport' ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff; border-radius: 8px; font-size: 0.9rem;">
                      ▣ Full Viewport Feed
                    </button>
                  </div>
                </div>

                <!-- Media Filter settings -->
                <div>
                  <h4 style="margin: 0 0 12px 0; font-size: 1rem; color: #fff; font-weight: 700;">Filter by Media Type <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-left: 4px;">(Ctrl+Click to exclude type)</span></h4>
                  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn type-btn ${isAll ? 'active' : ''}" data-type="all" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${isAll ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${isAll ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff; border-radius: 8px; font-size: 0.9rem;">
                      🌟 All Media
                    </button>
                    <button class="btn type-btn ${mediaType === 'image' ? 'active' : ''}" data-type="image" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${mediaType === 'image' ? 'var(--accent-gradient)' : (excludedTypes.has('image') ? '#ff4444' : 'rgba(255,255,255,0.04)')}; border: 1px solid ${mediaType === 'image' ? 'var(--accent-cyan)' : (excludedTypes.has('image') ? '#ff4444' : 'var(--border-color)')}; color: #fff; border-radius: 8px; font-size: 0.9rem; ${excludedTypes.has('image') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">
                      📷 Images
                    </button>
                    <button class="btn type-btn ${mediaType === 'video' ? 'active' : ''}" data-type="video" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${mediaType === 'video' ? 'var(--accent-gradient)' : (excludedTypes.has('video') ? '#ff4444' : 'rgba(255,255,255,0.04)')}; border: 1px solid ${mediaType === 'video' ? 'var(--accent-cyan)' : (excludedTypes.has('video') ? '#ff4444' : 'var(--border-color)')}; color: #fff; border-radius: 8px; font-size: 0.9rem; ${excludedTypes.has('video') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">
                      🎬 Videos
                    </button>
                    <button class="btn type-btn ${mediaType === 'audio' ? 'active' : ''}" data-type="audio" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${mediaType === 'audio' ? 'var(--accent-gradient)' : (excludedTypes.has('audio') ? '#ff4444' : 'rgba(255,255,255,0.04)')}; border: 1px solid ${mediaType === 'audio' ? 'var(--accent-cyan)' : (excludedTypes.has('audio') ? '#ff4444' : 'var(--border-color)')}; color: #fff; border-radius: 8px; font-size: 0.9rem; ${excludedTypes.has('audio') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">
                      🎵 Audio
                    </button>
                    <button class="btn type-btn ${mediaType === 'doc' ? 'active' : ''}" data-type="doc" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${mediaType === 'doc' ? 'var(--accent-gradient)' : (excludedTypes.has('doc') ? '#ff4444' : 'rgba(255,255,255,0.04)')}; border: 1px solid ${mediaType === 'doc' ? 'var(--accent-cyan)' : (excludedTypes.has('doc') ? '#ff4444' : 'var(--border-color)')}; color: #fff; border-radius: 8px; font-size: 0.9rem; ${excludedTypes.has('doc') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">
                      📄 Documents
                    </button>
                    <button class="btn type-btn ${mediaType === 'fiction' ? 'active' : ''}" data-type="fiction" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${mediaType === 'fiction' ? 'var(--accent-gradient)' : (excludedTypes.has('fiction') ? '#ff4444' : 'rgba(255,255,255,0.04)')}; border: 1px solid ${mediaType === 'fiction' ? 'var(--accent-cyan)' : (excludedTypes.has('fiction') ? '#ff4444' : 'var(--border-color)')}; color: #fff; border-radius: 8px; font-size: 0.9rem; ${excludedTypes.has('fiction') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">
                      📖 Interactive Fiction
                    </button>
                    <button class="btn type-btn ${mediaType === 'game' ? 'active' : ''}" data-type="game" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; cursor: pointer; background: ${mediaType === 'game' ? 'var(--accent-gradient)' : (excludedTypes.has('game') ? '#ff4444' : 'rgba(255,255,255,0.04)')}; border: 1px solid ${mediaType === 'game' ? 'var(--accent-cyan)' : (excludedTypes.has('game') ? '#ff4444' : 'var(--border-color)')}; color: #fff; border-radius: 8px; font-size: 0.9rem; ${excludedTypes.has('game') ? 'text-decoration: line-through; opacity: 0.9;' : ''}">
                      🎮 Games
                    </button>
                  </div>
                </div>

                <!-- Interface toggles -->
                <div>
                  <h4 style="margin: 0 0 12px 0; font-size: 1rem; color: #fff; font-weight: 700;">Interface Options</h4>
                  <div style="display: flex; gap: 12px;">
                    <button class="btn" id="btn-hud-toggle" style="flex: 1; height: 44px; font-size: 0.9rem; font-weight: 600; background: ${store.get('hudVisible', true) !== false ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${store.get('hudVisible', true) !== false ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff; border-radius: 8px; cursor: pointer;">
                      👁 HUD: ${store.get('hudVisible', true) !== false ? 'On' : 'Off'}
                    </button>
                    <button class="btn" id="btn-anim-thumbs-toggle" style="flex: 1; height: 44px; font-size: 0.9rem; font-weight: 600; background: ${store.get('animThumbs', true) !== false ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${store.get('animThumbs', true) !== false ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: #fff; border-radius: 8px; cursor: pointer;">
                      🎬 Animated Thumbnails: ${store.get('animThumbs', true) !== false ? 'On' : 'Off'}
                    </button>
                  </div>
                </div>
              </div>
            `;
        } else {
            tabContent = `
              <div style="padding: 24px; display: flex; flex-direction: column; gap: 16px;">
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; line-height: 1.4;">
                  💡 <strong>Usage Tips:</strong><br>
                  • <strong>Click:</strong> Set primary sort (resets other sorts)<br>
                  • <strong>Ctrl+Click:</strong> Add/toggle sub-sort (multi-column sorting)<br>
                  • <strong>Shift+Click:</strong> Remove sort column from chain
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                  ${sortButtonsHtml}
                </div>
              </div>
            `;
        }

        this.container.innerHTML = `
          <div class="modal-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); width: 680px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,0.8); overflow: hidden;">

            <div style="padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
              <h3 style="margin: 0; font-size: 1.2rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                🖥️ View & Display Settings
              </h3>
              <button class="btn btn-icon" id="btn-close-view-sort" title="Close (Escape)" style="width: 32px; height: 32px; font-size: 1.1rem; border: none; background: transparent; color: var(--text-secondary); cursor: pointer;">✕</button>
            </div>

            <!-- Tabs -->
            <div style="display: flex; border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.15); flex-shrink: 0;">
              <button class="tab-btn ${this.activeTab === 'view' ? 'active' : ''}" data-tab="view" style="flex: 1; padding: 12px 16px; border: none; background: ${this.activeTab === 'view' ? 'rgba(0, 240, 255, 0.12)' : 'transparent'}; color: ${this.activeTab === 'view' ? '#fff' : 'var(--text-secondary)'}; font-weight: ${this.activeTab === 'view' ? '700' : '500'}; font-size: 0.9rem; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'view' ? 'var(--accent-cyan)' : 'transparent'}; transition: all 0.15s ease;">
                🖥️ View & Display
              </button>
              <button class="tab-btn ${this.activeTab === 'sort' ? 'active' : ''}" data-tab="sort" style="flex: 1; padding: 12px 16px; border: none; background: ${this.activeTab === 'sort' ? 'rgba(0, 240, 255, 0.12)' : 'transparent'}; color: ${this.activeTab === 'sort' ? '#fff' : 'var(--text-secondary)'}; font-weight: ${this.activeTab === 'sort' ? '700' : '500'}; font-size: 0.9rem; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'sort' ? 'var(--accent-cyan)' : 'transparent'}; transition: all 0.15s ease;">
                📶 Sort & Order
              </button>
            </div>

            <!-- Tab Content -->
            <div style="flex: 1; overflow-y: auto;">
              ${tabContent}
            </div>

            <!-- Footer -->
            <div style="padding: 12px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; background: rgba(0,0,0,0.2); flex-shrink: 0;">
              <button class="btn" id="btn-view-sort-done" style="height: 36px; padding: 0 20px; font-weight: 600;">Done</button>
            </div>
          </div>
        `;

        this.attachEvents();
    }

    attachEvents() {
        const close = () => store.set({ isViewSortOpen: false });

        const closeBtn = this.container.querySelector('#btn-close-view-sort');
        const doneBtn = this.container.querySelector('#btn-view-sort-done');
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (doneBtn) doneBtn.addEventListener('click', close);

        this.container.addEventListener('click', (e) => {
            if (e.target === this.container) {
                close();
            }
        });

        // Tab Switcher
        this.container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.activeTab = btn.getAttribute('data-tab');
                this.render();
            });
        });

        // Layout switching
        this.container.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-view');
                store.setViewMode(view);
            });
        });

        // Media type filters
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

        // HUD toggle
        const hudBtn = this.container.querySelector('#btn-hud-toggle');
        if (hudBtn) {
            hudBtn.addEventListener('click', () => {
                const current = store.get('hudVisible', true) !== false;
                const nextVal = !current;
                try { localStorage.setItem('toxik_hud_visible', nextVal ? 'true' : 'false'); } catch (e) {}
                store.set({ hudVisible: nextVal });
                if (nextVal) {
                    document.body.classList.remove('hud-off');
                } else {
                    document.body.classList.add('hud-off');
                }
            });
        }

        // Anim toggle
        const animBtn = this.container.querySelector('#btn-anim-thumbs-toggle');
        if (animBtn) {
            animBtn.addEventListener('click', () => {
                const current = store.get('animThumbs', true) !== false;
                store.set({ animThumbs: !current });
            });
        }

        // Sort option buttons
        this.container.querySelectorAll('.sort-radio-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const sortId = btn.getAttribute('data-sort');
                const defaultDir = (sortId === 'asciibetical' || sortId === 'tag_abetical' || sortId === 'file_extension') ? 'asc' : 'desc';
                let chain = store.get('sortChain') || [{ id: store.get('sortBy') || 'creation_date', dir: store.get('sortDir') || 'desc' }];
                const idx = chain.findIndex(s => s.id === sortId);

                if (e.shiftKey) {
                    if (idx !== -1 && chain.length > 1) {
                        chain.splice(idx, 1);
                        store.setSortChain(chain);
                        await store.loadBrowse(true);
                    }
                    return;
                }

                if (e.ctrlKey || e.metaKey) {
                    if (idx !== -1) {
                        if (sortId !== 'random') {
                            chain[idx].dir = chain[idx].dir === 'asc' ? 'desc' : 'asc';
                        }
                    } else {
                        chain.push({ id: sortId, dir: defaultDir });
                    }
                } else {
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
    }
}
