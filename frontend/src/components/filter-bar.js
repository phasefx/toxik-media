import { store } from '../state/store.js';
import { api } from '../api/client.js';

export class FilterBar {
    constructor(container) {
        this.container = container;
        this.render();
        store.subscribe((state, changed) => {
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

        this.container.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 24px; background: var(--bg-card); border-bottom: 1px solid var(--border-color); flex-wrap: wrap;">
            <!-- Left: Breadcrumb & Filter Info -->
            <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 280px;">
              <button class="btn btn-icon" id="btn-toggle-sidebar" title="Toggle Sidebar (Collapse / Expand)" style="width: 36px; height: 36px; font-size: 1.1rem; flex-shrink: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: #fff;">
                ${store.get('isSidebarCollapsed') ? '▶' : '◀'}
              </button>
              <span style="color: var(--text-secondary); font-size: 0.85rem; font-weight: 600;">🏷 Filter:</span>
              ${breadcrumbHtml}
            </div>

            <!-- Right: Wildcard Search Input -->
            <div style="display: flex; align-items: center; gap: 8px; width: 340px; min-width: 220px;">
              <input type="text" class="input" id="filter-input" placeholder="Filter tags (e.g. *.Clip or Person)..." value="${activeFilter}"
                     style="height: 38px; font-size: 0.85rem; width: 100%;" />
              <button class="btn" id="btn-search-apply" title="Apply Filter" style="height: 38px; padding: 0 14px;">🔍</button>
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
    }
}


