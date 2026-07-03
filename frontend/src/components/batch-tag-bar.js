import { store } from '../state/store.js';
import { api } from '../api/client.js';

export class BatchTagBar {
    constructor(container) {
        this.container = container;
        store.subscribe((state) => {
            this.render(state.selectedIds, state.isMultiSelect);
        });
    }

    render(selectedIds, isMultiSelect) {
        if (!isMultiSelect || selectedIds.size === 0) {
            this.container.innerHTML = '';
            this.container.style.display = 'none';
            return;
        }

        this.container.style.display = 'flex';
        this.container.innerHTML = `
          <div class="glass" style="position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 50; padding: 14px 24px; border-radius: var(--radius-full); display: flex; align-items: center; gap: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); border: 1px solid rgba(0, 240, 255, 0.4); background: rgba(15, 20, 30, 0.95); animation: fadeIn 0.2s ease; flex-wrap: wrap; justify-content: center; max-width: 90vw;">

            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 24px; height: 24px; border-radius: 50%; background: var(--accent-cyan); color: #000; font-weight: 800; font-size: 0.75rem; display: flex; align-items: center; justify-content: center;">✓</span>
              <strong style="color: #fff; font-size: 0.9rem;">${selectedIds.size} selected</strong>
            </div>

            <div style="height: 24px; width: 1px; background: var(--border-color);"></div>

            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="text" id="batch-add-input" class="input" placeholder="Add tag..." style="height: 36px; width: 150px; font-size: 0.8rem;" />
              <button class="btn btn-primary" id="btn-batch-add" style="height: 36px; padding: 0 12px; font-size: 0.8rem;">+ Add</button>
            </div>

            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="text" id="batch-remove-input" class="input" placeholder="Remove tag..." style="height: 36px; width: 150px; font-size: 0.8rem;" />
              <button class="btn" id="btn-batch-remove" style="height: 36px; padding: 0 12px; font-size: 0.8rem; border-color: rgba(255, 0, 127, 0.4); color: #ff007f;">− Remove</button>
            </div>

            <button class="btn" id="btn-batch-copy-bash" title="Copy selected paths escaped for Bash" style="height: 36px; font-size: 0.8rem; border-color: rgba(0, 255, 102, 0.4); color: #00ff66; background: rgba(0, 255, 102, 0.05);">📋 Copy (Bash)</button>

            <button class="btn" id="btn-batch-generate" title="Generate AI workflow for selected items" style="height: 36px; font-size: 0.8rem; background: rgba(157, 0, 255, 0.2); border-color: var(--accent-purple); color: #fff; font-weight: 600;">🎬 Generate (${selectedIds.size})</button>

            <button class="btn" id="btn-batch-clear" title="Remove all tags from selected items" style="height: 36px; font-size: 0.8rem; color: #ff6b6b;">Clear Tags</button>

            <button class="btn" id="btn-batch-cancel" style="height: 36px; padding: 0 14px; font-size: 0.8rem;">✕ Cancel</button>
          </div>
        `;

        this.attachEvents(Array.from(selectedIds));
    }

    attachEvents(ids) {
        const addBtn = this.container.querySelector('#btn-batch-add');
        const addInput = this.container.querySelector('#batch-add-input');
        if (addBtn && addInput) {
            const add = async () => {
                const val = addInput.value.trim();
                if (!val) return;
                try {
                    addBtn.textContent = '⏳';
                    await api.batchTag(ids, { addTags: [val] });
                    addInput.value = '';
                    store.clearSelection();
                    await store.loadTags();
                    await store.loadBrowse(true);
                } catch (e) {
                    alert(`Batch add failed: ${e.message}`);
                } finally {
                    addBtn.textContent = '+ Add';
                }
            };
            addBtn.addEventListener('click', add);
        }

        const remBtn = this.container.querySelector('#btn-batch-remove');
        const remInput = this.container.querySelector('#batch-remove-input');
        if (remBtn && remInput) {
            remBtn.addEventListener('click', async () => {
                const val = remInput.value.trim();
                if (!val) return;
                try {
                    remBtn.textContent = '⏳';
                    await api.batchTag(ids, { removeTags: [val] });
                    store.clearSelection();
                    await store.loadTags();
                    await store.loadBrowse(true);
                } catch (e) {
                    alert(`Batch remove failed: ${e.message}`);
                }
            });
        }

        const clearBtn = this.container.querySelector('#btn-batch-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if (confirm(`Remove ALL tags from ${ids.length} selected items?`)) {
                    try {
                        clearBtn.textContent = '⏳';
                        await api.batchTag(ids, { clearAll: true });
                        store.clearSelection();
                        await store.loadTags();
                        await store.loadBrowse(true);
                    } catch (e) {
                        alert(`Clear failed: ${e.message}`);
                    }
                }
            });
        }

        const genBtn = this.container.querySelector('#btn-batch-generate');
        if (genBtn) {
            genBtn.addEventListener('click', () => {
                const sticky = store.get('stickyTab') || 'form';
                store.set({ isGenerationOpen: true, generationTab: sticky, entryMode: 'BATCH' });
            });
        }

        const copyBashBtn = this.container.querySelector('#btn-batch-copy-bash');
        if (copyBashBtn) {
            copyBashBtn.addEventListener('click', async () => {
                const results = store.get('results') || [];
                const displayedMap = new Map(results.filter(r => r.media).map(r => [r.media.id, r.media]));
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
                const bashStr = paths.join(' ');
                try {
                    await navigator.clipboard.writeText(bashStr);
                    const orig = copyBashBtn.innerHTML;
                    copyBashBtn.innerHTML = `✅ Copied ${paths.length}!`;
                    setTimeout(() => copyBashBtn.innerHTML = orig, 1500);
                } catch (err) {
                    const ta = document.createElement('textarea');
                    ta.value = bashStr;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    const orig = copyBashBtn.innerHTML;
                    copyBashBtn.innerHTML = `✅ Copied ${paths.length}!`;
                    setTimeout(() => copyBashBtn.innerHTML = orig, 1500);
                }
            });
        }

        const cancelBtn = this.container.querySelector('#btn-batch-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                store.clearSelection();
            });
        }
    }
}
