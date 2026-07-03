import { store } from '../state/store.js';
import { api } from '../api/client.js';

export class FilterBar {
    constructor(container) {
        this.container = container;
        this.render();
        store.subscribe((state, changed) => {
            if (changed && changed.selectedIds) {
                this.updateDisabledStates();
            }
            if (changed && Object.keys(changed).every(k => ['workflows', 'jobs', 'page', 'isLoading', 'activeModalItem', 'selectedIds'].includes(k))) {
                return;
            }
            this.render();
        });
    }

    render() {
        const breadcrumb = store.getBreadcrumb();
        const activeFilter = store.get('activeFilter') || '';
        const viewMode = store.get('viewMode');
        const multiMode = store.get('multiFilterMode');
        const mediaType = store.get('mediaType') || 'all';

        let breadcrumbHtml = '<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">';
        let currentPath = '';

        for (let i = 0; i < breadcrumb.length; i++) {
            const seg = breadcrumb[i];
            if (seg === 'All') {
                currentPath = '';
            } else {
                currentPath = currentPath ? `${currentPath}.${seg}` : seg;
            }
            const isLast = i === breadcrumb.length - 1;

            breadcrumbHtml += `
              <span class="breadcrumb-item ${isLast ? 'active' : ''}" data-path="${currentPath}"
                    style="cursor: ${isLast ? 'default' : 'pointer'}; color: ${isLast ? '#fff' : 'var(--text-secondary)'}; font-weight: ${isLast ? '700' : '500'}; font-size: 0.9rem; transition: color 0.15s ease;">
                ${seg}
              </span>
            `;
            if (!isLast) {
                breadcrumbHtml += '<span style="color: var(--text-muted); font-size: 0.8rem;">/</span>';
            }
        }
        breadcrumbHtml += '</div>';

        const catalogs = store.get('catalogs') || [];
        const activeCatalog = store.get('activeCatalog') || 'toxik.db';
        const catalogsOptions = catalogs.map(c => `
          <option value="${c.name}" ${c.name === activeCatalog ? 'selected' : ''} style="background: var(--bg-card); color: #fff;">${c.name}</option>
        `).join('');

        this.container.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 24px; background: var(--bg-card); border-bottom: 1px solid var(--border-color); flex-wrap: wrap;">
            <!-- Left: Breadcrumb & Filter Info -->
            <div style="display: flex; align-items: center; gap: 12px; min-width: 200px;">
              <button class="btn btn-icon" id="btn-toggle-sidebar" title="Toggle Sidebar (Collapse / Expand)" style="width: 36px; height: 36px; font-size: 1.1rem; flex-shrink: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: #fff;">
                ${store.get('isSidebarCollapsed') ? '▶' : '◀'}
              </button>
              <span style="color: var(--text-secondary); font-size: 0.85rem; font-weight: 600;">🏷 Filter:</span>
              ${breadcrumbHtml}
            </div>

            <!-- Middle: Wildcard Search Input & Catalog Switcher -->
            <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 6px; width: 220px; min-width: 160px;">
                <input type="text" class="input" id="filter-input" placeholder="Filter tags..." value="${activeFilter}"
                       style="height: 36px; font-size: 0.85rem; width: 100%;" />
                <button class="btn" id="btn-search-apply" title="Apply Filter" style="height: 36px; padding: 0 14px;">🔍</button>
              </div>

              <!-- Catalog Switcher -->
              <div style="display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); border-radius: 6px; padding: 0 8px; height: 36px;" title="Switch Database Catalog or Create New">
                <span style="font-size: 0.85rem; color: var(--accent-cyan);">📚 Catalog:</span>
                <select id="select-catalog" style="background: transparent; border: none; color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer; outline: none;">
                  ${catalogsOptions || `<option value="${activeCatalog}">${activeCatalog}</option>`}
                </select>
                <button class="btn btn-icon" id="btn-add-catalog" title="Create / Switch to New Catalog" style="width: 26px; height: 26px; font-size: 1rem; padding: 0; background: rgba(0, 240, 255, 0.15); border: 1px solid rgba(0, 240, 255, 0.4); color: var(--accent-cyan); display: flex; align-items: center; justify-content: center; line-height: 1;">+</button>
                <button class="btn btn-icon" id="btn-del-catalog" title="Delete an inactive catalog by typing its exact name" style="width: 26px; height: 26px; font-size: 0.85rem; padding: 0; background: rgba(255, 0, 0, 0.15); border: 1px solid rgba(255, 0, 0, 0.4); color: #ff6b6b; display: flex; align-items: center; justify-content: center; line-height: 1;">🗑️</button>
              </div>
            </div>

            <!-- Right: Gen Buttons (Right Justified) -->
            <div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
              <button class="btn btn-primary" id="btn-top-t2i" style="height: 36px; font-size: 0.8rem; font-weight: 700; padding: 0 10px;" title="Text-to-Image Generation">🎨 T2I</button>
              <button class="btn btn-primary" id="btn-top-t2v" style="height: 36px; font-size: 0.8rem; font-weight: 700; padding: 0 10px; background: var(--accent-purple); border-color: rgba(157, 0, 255, 0.4);" title="Text-to-Video Generation">🎬 T2V</button>
              <button class="btn btn-primary" id="btn-top-i2i" style="height: 36px; font-size: 0.8rem; font-weight: 700; padding: 0 10px;" title="Image-to-Image Generation (Requires Selection)">🖼️ I2I</button>
              <button class="btn btn-primary" id="btn-top-i2v" style="height: 36px; font-size: 0.8rem; font-weight: 700; padding: 0 10px; background: var(--accent-purple); border-color: rgba(157, 0, 255, 0.4);" title="Image-to-Video Generation (Requires Selection)">🎥 I2V</button>
              <button class="btn btn-primary" id="btn-top-v2v" style="height: 36px; font-size: 0.8rem; font-weight: 700; padding: 0 10px; background: var(--accent-purple); border-color: rgba(157, 0, 255, 0.4);" title="Video-to-Video Generation (Requires Selection)">🎞️ V2V</button>
            </div>
          </div>
        `;

        this.attachEvents();
    }

    attachEvents() {
        const toggleBtn = this.container.querySelector('#btn-toggle-sidebar');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const current = store.get('isSidebarCollapsed') || false;
                store.set({ isSidebarCollapsed: !current });
                const sidebarEl = document.querySelector('#sidebar');
                if (sidebarEl) {
                    if (!current) {
                        sidebarEl.classList.add('collapsed');
                    } else {
                        sidebarEl.classList.remove('collapsed');
                    }
                }
            });
        }

        this.container.querySelectorAll('.breadcrumb-item').forEach(el => {
            el.addEventListener('click', () => {
                if (el.classList.contains('active')) return;
                const path = el.getAttribute('data-path');
                store.setFilter(path);
            });
        });

        const input = this.container.querySelector('#filter-input');
        const applyBtn = this.container.querySelector('#btn-search-apply');
        if (input && applyBtn) {
            const apply = () => {
                const val = input.value.trim();
                store.setFilter(val);
            };
            applyBtn.addEventListener('click', apply);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') apply();
            });
        }

        [['btn-top-t2i', 'T2I'], ['btn-top-t2v', 'T2V'], ['btn-top-i2i', 'I2I'], ['btn-top-i2v', 'I2V'], ['btn-top-v2v', 'V2V']].forEach(([id, mode]) => {
            const btn = this.container.querySelector(`#${id}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    const willOpen = !(store.get('isGenerationOpen') && store.get('entryMode') === mode);
                    const sticky = store.get('stickyTab') || 'form';
                    store.set({ isGenerationOpen: willOpen, generationTab: sticky, entryMode: mode });
                });
            }
        });

        const selCat = this.container.querySelector('#select-catalog');
        if (selCat) {
            selCat.addEventListener('change', async (e) => {
                const targetName = e.target.value;
                if (targetName && targetName !== store.get('activeCatalog')) {
                    await store.switchCatalog(targetName);
                }
            });
        }

        const addCat = this.container.querySelector('#btn-add-catalog');
        if (addCat) {
            addCat.addEventListener('click', async () => {
                const newName = prompt('Enter new catalog database filename (e.g. project_a.db):');
                if (newName && newName.trim()) {
                    await store.switchCatalog(newName.trim());
                }
            });
        }

        const delCat = this.container.querySelector('#btn-del-catalog');
        if (delCat) {
            delCat.addEventListener('click', async () => {
                const activeCat = store.get('activeCatalog');
                const inputName = prompt(`To delete an inactive catalog, type the exact database filename to delete (e.g. old_project.db):\n(Active catalog "${activeCat}" cannot be deleted)`);
                if (!inputName) return;
                const targetName = inputName.trim();
                if (!targetName) return;

                if (targetName === activeCat) {
                    alert(`Cannot delete the currently active catalog "${targetName}". Switch to another catalog first.`);
                    return;
                }

                const catalogs = store.get('catalogs') || [];
                if (!catalogs.some(c => c.name === targetName)) {
                    alert(`Catalog "${targetName}" not found in available catalogs list.`);
                    return;
                }

                if (confirm(`Are you absolutely sure you want to permanently delete catalog "${targetName}"? This cannot be undone.`)) {
                    try {
                        await api.deleteCatalog(targetName);
                        await store.loadCatalogs();
                    } catch (err) {
                        alert(`Failed to delete catalog: ${err.message || err}`);
                    }
                }
            });
        }

        this.updateDisabledStates();
    }

    updateDisabledStates() {
        const hasSelection = (store.get('selectedIds') || new Set()).size > 0;
        ['btn-top-i2i', 'btn-top-i2v', 'btn-top-v2v'].forEach(id => {
            const btn = this.container.querySelector(`#${id}`);
            if (btn) {
                btn.disabled = !hasSelection;
                btn.style.opacity = hasSelection ? '1' : '0.4';
                btn.style.cursor = hasSelection ? 'pointer' : 'not-allowed';
            }
        });
    }
}


