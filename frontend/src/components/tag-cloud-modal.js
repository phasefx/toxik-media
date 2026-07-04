import { store } from '../state/store.js';
import { api } from '../api/client.js';

export class TagCloudModal {
    constructor(container) {
        this.container = container;
        this.activeTab = 'cloud';
        try {
            const saved = localStorage.getItem('toxik_tag_modal_expanded_nodes');
            this.expandedNodes = saved ? new Set(JSON.parse(saved)) : new Set();
        } catch (e) {
            this.expandedNodes = new Set();
        }
        this.render();
        store.subscribe((state, changed) => {
            if (changed && Object.keys(changed).every(k => ['workflows', 'jobs', 'page', 'isLoading', 'activeModalItem', 'selectedIds'].includes(k))) {
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
        const isOpen = store.get('isTagCloudOpen');
        if (!isOpen) {
            this.container.style.display = 'none';
            this.container.innerHTML = '';
            return;
        }

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

        // ── Tag Cloud content ──
        const tagCounts = new Map();
        const results = store.get('results') || [];
        results.forEach(r => {
            if (r.type === 'item' && r.media) {
                const m = r.media;
                if (m.tags) {
                    m.tags.forEach(t => {
                        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
                    });
                }
                if (m.media_type) {
                    const typeTag = `type:${m.media_type}`;
                    tagCounts.set(typeTag, (tagCounts.get(typeTag) || 0) + 1);
                }
                if (m.filename && m.filename.includes('.')) {
                    const extTag = `ext:${m.filename.split('.').pop().toLowerCase()}`;
                    tagCounts.set(extTag, (tagCounts.get(extTag) || 0) + 1);
                }
            }
        });

        if (tagCounts.size === 0) {
            const allTags = store.get('tags') || [];
            allTags.forEach(t => {
                if (t.full_tag) tagCounts.set(t.full_tag, t.count || 1);
            });
        }

        const entries = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);
        let minCount = Infinity;
        let maxCount = -Infinity;
        entries.forEach(([_, count]) => {
            if (count < minCount) minCount = count;
            if (count > maxCount) maxCount = count;
        });
        if (minCount === Infinity) minCount = 1;
        if (maxCount === -Infinity) maxCount = 1;

        const colors = [
            '#00f0ff', '#ff007f', '#9d00ff', '#00ff66', '#ffaa00', '#ff00ff', '#3399ff', '#ff5533'
        ];

        const activeFilter = (store.get('activeFilter') || '').trim();
        const tokens = activeFilter ? activeFilter.split(/\s+/) : [];
        const incTags = new Set();
        const excTags = new Set();
        for (const tok of tokens) {
            if (tok.startsWith('-')) excTags.add(tok.substring(1));
            else if (tok.startsWith('+')) incTags.add(tok.substring(1));
            else incTags.add(tok);
        }

        let cloudHtml = '';
        if (entries.length === 0) {
            cloudHtml = '<div style="color: var(--text-muted); padding: 32px; text-align: center;">No tags found on displayed media.</div>';
        } else {
            cloudHtml = '<div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-content: flex-start; align-items: center; padding: 24px; overflow-y: auto;">';
            entries.forEach(([tagStr, count], idx) => {
                const ratio = maxCount === minCount ? 0.5 : (count - minCount) / (maxCount - minCount);
                const fontSize = (0.85 + ratio * 1.3).toFixed(2);
                const color = colors[idx % colors.length];
                const bg = color + '1a';

                const isIncluded = incTags.has(tagStr);
                const isExcluded = excTags.has(tagStr);

                let displayText = tagStr;
                let controlsHtml = '';
                if (tagStr.startsWith('type:')) {
                    const mType = tagStr.substring(5);
                    const icon = mType === 'video' ? '🎬' : mType === 'audio' ? '🎵' : mType === 'doc' ? '📄' : '🖼️';
                    displayText = `${icon} ${mType}`;
                } else if (tagStr.startsWith('ext:')) {
                    const ext = tagStr.substring(4);
                    displayText = `📦 .${ext}`;
                } else {
                    const segments = tagStr.split('.');
                    let revealedCount = Math.min(2, segments.length);
                    try {
                        const saved = localStorage.getItem('toxik_tag_cloud_seg_' + tagStr);
                        if (saved !== null) {
                            revealedCount = Math.min(segments.length, Math.max(1, parseInt(saved, 10) || revealedCount));
                        }
                    } catch (e) {}
                    displayText = segments.slice(-revealedCount).join('.');
                    if (segments.length > 1) {
                        controlsHtml = `
                          <span class="cloud-tag-controls" style="display: inline-flex; gap: 2px; align-items: center; margin-right: 2px;">
                            <button class="btn-cloud-seg-expand" data-tag="${tagStr}" data-seg="${revealedCount}" title="Reveal more segments to the left" style="width: 18px; height: 18px; padding: 0; border: 1px solid ${color + '66'}; background: rgba(0,0,0,0.4); color: ${color}; border-radius: 50%; font-size: 0.65rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; line-height: 1;">‹</button>
                            <button class="btn-cloud-seg-shrink" data-tag="${tagStr}" data-seg="${revealedCount}" title="Reveal fewer segments" style="width: 18px; height: 18px; padding: 0; border: 1px solid ${color + '66'}; background: rgba(0,0,0,0.4); color: ${color}; border-radius: 50%; font-size: 0.65rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; line-height: 1;">›</button>
                          </span>
                        `;
                    }
                }

                const filterBtnsHtml = `
                  <span class="cloud-tag-filter-btns" style="display: inline-flex; gap: 3px; align-items: center; margin: 0 2px;">
                    <button class="btn-cloud-inc" data-tag="${tagStr}" title="Include (+)"
                            style="background: ${isIncluded ? '#00ff88' : 'rgba(255,255,255,0.12)'}; color: ${isIncluded ? '#000' : '#aaa'}; border: none; font-weight: 800; font-size: 0.7rem; width: 20px; height: 20px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s ease; line-height: 1;">+</button>
                    <button class="btn-cloud-exc" data-tag="${tagStr}" title="Exclude (-)"
                            style="background: ${isExcluded ? '#ff4444' : 'rgba(255,255,255,0.12)'}; color: ${isExcluded ? '#fff' : '#aaa'}; border: none; font-weight: 800; font-size: 0.7rem; width: 20px; height: 20px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s ease; line-height: 1;">−</button>
                  </span>
                `;

                const borderStyle = isIncluded ? '#00ff88' : (isExcluded ? '#ff4444' : color + '4d');
                const boxShadow = isIncluded ? '0 0 10px rgba(0,255,136,0.5)' : (isExcluded ? '0 0 10px rgba(255,68,68,0.5)' : 'none');

                cloudHtml += `
                  <span class="cloud-tag-item" data-tag="${tagStr}"
                        style="font-size: ${fontSize}rem; color: ${color}; background: ${bg}; border: 1px solid ${borderStyle}; box-shadow: ${boxShadow}; padding: 4px 12px; border-radius: var(--radius-full); cursor: pointer; transition: all 0.2s ease; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; line-height: 1.3;"
                        title="Filter by ${tagStr} (${count} item${count !== 1 ? 's' : ''})">
                    ${controlsHtml}
                    ${filterBtnsHtml}
                    <span>${displayText}</span>
                    <span style="font-size: 0.7rem; opacity: 0.8; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 10px;">${count}</span>
                  </span>
                `;
            });
            cloudHtml += '</div>';
        }

        // ── Tag Tree content ──
        const tags = store.get('tags') || [];
        const tree = this.buildTree(tags);
        const isAllActive = !store.get('activeFilter');
        const treeHtml = `
          <div style="padding: 12px; overflow-y: auto;">
            <div class="tag-tree-item ${isAllActive ? 'active' : ''}" data-tag=""
                 style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; background: ${isAllActive ? 'rgba(0, 240, 255, 0.15)' : 'transparent'}; border: 1px solid ${isAllActive ? 'var(--accent-cyan)' : 'transparent'}; margin-bottom: 8px; font-weight: 600; min-height: 38px;">
              <span>🌟 All Media</span>
              <span class="badge" style="background: ${isAllActive ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.08)'}; color: ${isAllActive ? '#000' : 'var(--text-secondary)'};">
                ${store.get('totalLibraryItems') || store.get('totalItems')}
              </span>
            </div>
            ${this.renderTree(tree)}
          </div>
        `;

        // ── Tab content ──
        const tabContent = this.activeTab === 'cloud' ? cloudHtml : treeHtml;
        const paneStyle = this.activeTab === 'cloud'
            ? 'overflow-y: auto; display: flex; flex-direction: column;'
            : 'overflow-y: auto;';

        this.container.innerHTML = `
          <div class="modal-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); width: 850px; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,0.8); overflow: hidden;">
            <div style="padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
              <h3 style="margin: 0; font-size: 1.2rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                ☁ Tags
              </h3>
              <button class="btn btn-icon" id="btn-close-cloud" title="Close (Escape)" style="width: 32px; height: 32px; font-size: 1.1rem; border: none; background: transparent; color: var(--text-secondary);">✕</button>
            </div>

            <div style="display: flex; border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.15); flex-shrink: 0;">
              <button class="tab-btn ${this.activeTab === 'cloud' ? 'active' : ''}" data-tab="cloud" style="flex: 1; padding: 10px 16px; border: none; background: ${this.activeTab === 'cloud' ? 'rgba(0, 240, 255, 0.12)' : 'transparent'}; color: ${this.activeTab === 'cloud' ? '#fff' : 'var(--text-secondary)'}; font-weight: ${this.activeTab === 'cloud' ? '700' : '500'}; font-size: 0.85rem; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'cloud' ? 'var(--accent-cyan)' : 'transparent'}; transition: all 0.15s ease;">
                ☁ Tag Cloud
              </button>
              <button class="tab-btn ${this.activeTab === 'tree' ? 'active' : ''}" data-tab="tree" style="flex: 1; padding: 10px 16px; border: none; background: ${this.activeTab === 'tree' ? 'rgba(0, 240, 255, 0.12)' : 'transparent'}; color: ${this.activeTab === 'tree' ? '#fff' : 'var(--text-secondary)'}; font-weight: ${this.activeTab === 'tree' ? '700' : '500'}; font-size: 0.85rem; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'tree' ? 'var(--accent-cyan)' : 'transparent'}; transition: all 0.15s ease;">
                🗂 Tag Tree
              </button>
            </div>

            <div style="flex: 1; ${paneStyle}">
              ${tabContent}
            </div>

            <div style="padding: 12px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); flex-shrink: 0;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <button class="btn" id="btn-modal-new-tag" title="Create Tag" style="height: 30px; padding: 0 12px; font-size: 0.8rem; font-weight: 600; background: rgba(0, 240, 255, 0.12); border: 1px solid rgba(0, 240, 255, 0.3); color: var(--accent-cyan);">＋ New Tag</button>
                <span style="font-size: 0.8rem; color: var(--text-muted);">💡 Click <strong>+</strong> / <strong>−</strong> to combine filters (keeps modal open). Click a tag pill for full replacement.</span>
              </div>
              <button class="btn" id="btn-cloud-done" style="height: 34px; padding: 0 16px;">Close</button>
            </div>
          </div>
        `;

        this.attachEvents();
    }

    attachEvents() {
        const close = () => store.set({ isTagCloudOpen: false });

        const closeBtn = this.container.querySelector('#btn-close-cloud');
        const doneBtn = this.container.querySelector('#btn-cloud-done');
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (doneBtn) doneBtn.addEventListener('click', close);

        this.container.addEventListener('click', (e) => {
            if (e.target === this.container) {
                close();
            }
        });

        // Tab switching
        this.container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.activeTab = btn.getAttribute('data-tab');
                this.render();
            });
        });

        // Cloud segment controls
        this.container.querySelectorAll('.btn-cloud-seg-expand').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.getAttribute('data-tag');
                const current = parseInt(btn.getAttribute('data-seg'), 10) || 2;
                const max = tag.split('.').length;
                const next = Math.min(max, current + 1);
                try { localStorage.setItem('toxik_tag_cloud_seg_' + tag, next); } catch(err) {}
                this.render();
            });
        });

        this.container.querySelectorAll('.btn-cloud-seg-shrink').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.getAttribute('data-tag');
                const current = parseInt(btn.getAttribute('data-seg'), 10) || 2;
                const next = Math.max(1, current - 1);
                try { localStorage.setItem('toxik_tag_cloud_seg_' + tag, next); } catch(err) {}
                this.render();
            });
        });

        this.container.querySelectorAll('.btn-cloud-inc').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.getAttribute('data-tag');
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

        this.container.querySelectorAll('.btn-cloud-exc').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.getAttribute('data-tag');
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

        this.container.querySelectorAll('.cloud-tag-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.btn-cloud-seg-expand') || e.target.closest('.btn-cloud-seg-shrink') || e.target.closest('.btn-cloud-inc') || e.target.closest('.btn-cloud-exc')) return;
                const tag = el.getAttribute('data-tag');
                store.setFilter(tag);
                close();
            });
        });

        // ── Tag Tree events ──

        // Tree toggle
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
                    localStorage.setItem('toxik_tag_modal_expanded_nodes', JSON.stringify(Array.from(this.expandedNodes)));
                } catch (err) {}
                this.render();
            });
        });

        // Tree item click → set filter
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

        // Tree + btn
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

        // Tree - btn
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

        // Tree rename
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

        // Tree delete
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

        // Tree new tag
        const newBtn = this.container.querySelector('#btn-modal-new-tag');
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
    }
}
