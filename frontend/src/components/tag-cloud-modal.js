import { store } from '../state/store.js';

export class TagCloudModal {
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

        // Count tags in currently displayed media
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

        // Fallback to store tags if no direct media items displayed
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

        let cloudHtml = '';
        if (entries.length === 0) {
            cloudHtml = '<div style="color: var(--text-muted); padding: 32px; text-align: center;">No tags found on displayed media.</div>';
        } else {
            cloudHtml = '<div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-content: flex-start; align-items: center; padding: 24px; max-height: 65vh; overflow-y: auto;">';
            entries.forEach(([tagStr, count], idx) => {
                const ratio = maxCount === minCount ? 0.5 : (count - minCount) / (maxCount - minCount);
                const fontSize = (0.85 + ratio * 1.3).toFixed(2); // 0.85rem to 2.15rem
                const color = colors[idx % colors.length];
                const bg = color + '1a'; // 10% opacity

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

                cloudHtml += `
                  <span class="cloud-tag-item" data-tag="${tagStr}"
                        style="font-size: ${fontSize}rem; color: ${color}; background: ${bg}; border: 1px solid ${color + '4d'}; padding: 4px 12px; border-radius: var(--radius-full); cursor: pointer; transition: all 0.2s ease; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; line-height: 1.3;"
                        title="Filter by ${tagStr} (${count} item${count !== 1 ? 's' : ''})">
                    ${controlsHtml}
                    <span>${displayText}</span>
                    <span style="font-size: 0.7rem; opacity: 0.8; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 10px;">${count}</span>
                  </span>
                `;
            });
            cloudHtml += '</div>';
        }

        this.container.innerHTML = `
          <div class="modal-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); width: 850px; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,0.8); overflow: hidden;">
            <div style="padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
              <h3 style="margin: 0; font-size: 1.2rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                ☁ Tag Cloud <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 400;">(Displayed Media Tags)</span>
              </h3>
              <button class="btn btn-icon" id="btn-close-cloud" title="Close (Escape)" style="width: 32px; height: 32px; font-size: 1.1rem; border: none; background: transparent; color: var(--text-secondary);">✕</button>
            </div>

            <div style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
              ${cloudHtml}
            </div>

            <div style="padding: 12px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2);">
              <span style="font-size: 0.8rem; color: var(--text-muted);">💡 Click any tag pill to instantly filter the view. Use ‹ and › to reveal compound segments.</span>
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

        this.container.querySelectorAll('.cloud-tag-item').forEach(el => {
            el.addEventListener('click', () => {
                const tag = el.getAttribute('data-tag');
                store.setFilter(tag);
                close();
            });
        });
    }
}
