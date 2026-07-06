import { store } from '../state/store.js';
import { api } from '../api/client.js';

export class ActionsGenModal {
    constructor(container) {
        this.container = container;
        this.render();
        store.subscribe((state, changed) => {
            if (changed && (changed.isActionsGenOpen !== undefined || changed.selectedIds)) {
                this.render();
            }
        });
    }

    render() {
        const isOpen = store.get('isActionsGenOpen');
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

        const selectedCount = store.get('selectedIds')?.size || 0;

        this.container.innerHTML = `
          <div class="modal-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); width: 680px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,0.8); overflow: hidden;">

            <!-- Header -->
            <div style="padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02);">
              <h3 style="margin: 0; font-size: 1.2rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                🎮 Actions & Operations
              </h3>
              <button class="btn btn-icon" id="btn-close-actions-gen" title="Close (Escape)" style="width: 32px; height: 32px; font-size: 1.1rem; border: none; background: transparent; color: var(--text-secondary); cursor: pointer;">✕</button>
            </div>

            <!-- Content Area -->
            <div style="padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; background: rgba(0,0,0,0.1);">

              <!-- Grid of Actions -->
              <div style="display: grid; grid-template-columns: 1fr; gap: 16px;">

                <!-- Action 1: Import Media -->
                <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 16px; border-radius: 8px; display: flex; flex-direction: column; gap: 12px;">
                  <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
                    <div style="flex: 1;">
                      <h4 style="margin: 0 0 4px 0; color: #fff; font-size: 0.95rem; font-weight: 700;">📥 Import Media</h4>
                      <p style="margin: 0; color: var(--text-secondary); font-size: 0.8rem; line-height: 1.4;">Upload files from your computer or import from a server-side path.</p>
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn" id="btn-import-files" style="min-width: 120px; height: 36px; font-size: 0.85rem; font-weight: 600;">📄 Import Files</button>
                    <button class="btn" id="btn-import-folder" style="min-width: 120px; height: 36px; font-size: 0.85rem; font-weight: 600; border-color: rgba(255, 204, 0, 0.4); color: #ffcc00; background: rgba(255, 204, 0, 0.05);">📁 Import Folder</button>
                    <button class="btn" id="btn-import-server" style="min-width: 120px; height: 36px; font-size: 0.85rem; font-weight: 600; border-color: rgba(0, 200, 255, 0.4); color: #00c8ff; background: rgba(0, 200, 255, 0.05);">🖥️ Server Path</button>
                  </div>
                  <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer;">
                      <input type="checkbox" id="chk-recurse" checked style="accent-color: var(--accent-cyan);" />
                      Recurse subdirectories
                    </label>
                    <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 180px;">
                      <span style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap;">Tags:</span>
                      <input type="text" id="inp-import-tags" placeholder="Optional.Tag.Here" style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 4px; padding: 4px 8px; color: #fff; font-size: 0.8rem;" />
                    </div>
                    <span id="import-status" style="font-size: 0.8rem; color: var(--accent-green); min-height: 1.2em;"></span>
                  </div>
                  <input type="file" id="file-picker" multiple accept="*/*" style="display:none" />
                  <input type="file" id="folder-picker" webkitdirectory style="display:none" />
                </div>

                <!-- Action 2: Re-Ingest -->
                <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 16px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
                  <div style="flex: 1;">
                    <h4 style="margin: 0 0 4px 0; color: #fff; font-size: 0.95rem; font-weight: 700;">🔄 Re-Ingest Displayed</h4>
                    <p style="margin: 0; color: var(--text-secondary); font-size: 0.8rem; line-height: 1.4;">Regenerate static/animated thumbnails and re-run path-based auto-tagging workflows for displayed items.</p>
                  </div>
                  <button class="btn" id="btn-reingest-displayed" style="min-width: 140px; height: 38px; font-size: 0.85rem; font-weight: 600;">Re-Ingest</button>
                </div>

                <!-- Action 3: Fetch All -->
                <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 16px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
                  <div style="flex: 1;">
                    <h4 style="margin: 0 0 4px 0; color: #fff; font-size: 0.95rem; font-weight: 700;">⚡ Fetch All Matching</h4>
                    <p style="margin: 0; color: var(--text-secondary); font-size: 0.8rem; line-height: 1.4;">Instruct the backend server to pull all items matching the active filter into local cache.</p>
                  </div>
                  <button class="btn" id="btn-fetch-all" style="min-width: 140px; height: 38px; font-size: 0.85rem; font-weight: 600; border-color: rgba(255, 204, 0, 0.4); color: #ffcc00; background: rgba(255, 204, 0, 0.05);">⚡ Fetch All</button>
                </div>

                <!-- Action 4: Copy Paths -->
                <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 16px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
                  <div style="flex: 1;">
                    <h4 style="margin: 0 0 4px 0; color: #fff; font-size: 0.95rem; font-weight: 700;">📋 Copy Paths (Bash)</h4>
                    <p style="margin: 0; color: var(--text-secondary); font-size: 0.8rem; line-height: 1.4;">Copies selected media paths formatted as a space-separated string, or all displayed items if none selected.</p>
                  </div>
                  <button class="btn" id="btn-copy-selected-bash" style="min-width: 140px; height: 38px; font-size: 0.85rem; font-weight: 600; border-color: rgba(0, 255, 102, 0.4); color: #00ff66; background: rgba(0, 255, 102, 0.05); display: flex; align-items: center; justify-content: center; gap: 6px;">
                    📋 Copy Paths ${selectedCount > 0 ? `<span class="badge" style="background: #00ff66; color: #000; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">${selectedCount}</span>` : ''}
                  </button>
                </div>

              </div>

            </div>

            <!-- Footer -->
            <div style="padding: 12px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; background: rgba(0,0,0,0.2); flex-shrink: 0;">
              <button class="btn" id="btn-actions-gen-done" style="height: 36px; padding: 0 20px; font-weight: 600;">Close</button>
            </div>
          </div>
        `;

        this.attachEvents();
    }

    attachEvents() {
        const close = () => store.set({ isActionsGenOpen: false });

        const closeBtn = this.container.querySelector('#btn-close-actions-gen');
        const doneBtn = this.container.querySelector('#btn-actions-gen-done');
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (doneBtn) doneBtn.addEventListener('click', close);

        this.container.addEventListener('click', (e) => {
            if (e.target === this.container) {
                close();
            }
        });

        // ── Import Media Handlers ──
        const filePicker = this.container.querySelector('#file-picker');
        const folderPicker = this.container.querySelector('#folder-picker');
        const statusEl = this.container.querySelector('#import-status');
        const tagsInput = this.container.querySelector('#inp-import-tags');
        const recurseChk = this.container.querySelector('#chk-recurse');

        function getImportTags() {
            const val = tagsInput ? tagsInput.value.trim() : '';
            return val ? val.split(',').map(t => t.trim()).filter(Boolean) : [];
        }

        function showStatus(msg, isError = false) {
            if (statusEl) {
                statusEl.textContent = msg;
                statusEl.style.color = isError ? '#ff4444' : 'var(--accent-green)';
                setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, 8000);
            }
        }

        async function doUpload(files, label) {
            const tags = getImportTags();
            try {
                if (typeof window !== 'undefined' && window.setAppExpectedRequests) window.setAppExpectedRequests(1);
                const res = await api.uploadMedia(files, tags);
                showStatus(`✅ Imported ${res.length} file(s)${tags.length ? ` as "${tags.join(', ')}"` : ''}`);
                await store.loadBrowse(true);
                await store.loadTags();
            } catch (err) {
                showStatus(`❌ Import failed: ${err.message}`, true);
            } finally {
                if (typeof window !== 'undefined' && window.setAppExpectedRequests) window.setAppExpectedRequests(0);
            }
        }

        // Import Files
        const importFilesBtn = this.container.querySelector('#btn-import-files');
        if (importFilesBtn && filePicker) {
            importFilesBtn.addEventListener('click', () => {
                filePicker.value = '';
                filePicker.click();
            });
            filePicker.addEventListener('change', async () => {
                const files = filePicker.files;
                if (files && files.length > 0) {
                    showStatus(`⏳ Uploading ${files.length} file(s)...`);
                    await doUpload(Array.from(files), 'Import Files');
                }
            });
        }

        // Import Folder
        const importFolderBtn = this.container.querySelector('#btn-import-folder');
        if (importFolderBtn && folderPicker) {
            importFolderBtn.addEventListener('click', () => {
                folderPicker.value = '';
                folderPicker.click();
            });
            folderPicker.addEventListener('change', async () => {
                const files = folderPicker.files;
                if (files && files.length > 0) {
                    const recurse = recurseChk ? recurseChk.checked : true;
                    let selected = Array.from(files);
                    if (!recurse) {
                        selected = selected.filter(f => {
                            const rel = f.webkitRelativePath || '';
                            return !rel.includes('/');
                        });
                    }
                    if (selected.length === 0) {
                        showStatus('No files found at the root level.', true);
                        return;
                    }
                    showStatus(`⏳ Uploading ${selected.length} file(s) from folder...`);
                    await doUpload(selected, 'Import Folder');
                }
            });
        }

        // Server Path (existing prompt-based import)
        const serverBtn = this.container.querySelector('#btn-import-server');
        if (serverBtn) {
            serverBtn.addEventListener('click', async () => {
                const path = prompt('Enter absolute directory or file path to import (e.g. /home/coding/git/toxik/samples):');
                if (path && path.trim()) {
                    const tags = getImportTags();
                    try {
                        serverBtn.textContent = '⏳ Importing...';
                        serverBtn.disabled = true;
                        if (typeof window !== 'undefined' && window.setAppExpectedRequests) window.setAppExpectedRequests(1);
                        const res = await api.importMedia([path.trim()], tags);
                        showStatus(`✅ Imported ${res.length} file(s)${tags.length ? ` as "${tags.join(', ')}"` : ''}`);
                        await store.loadBrowse(true);
                        await store.loadTags();
                    } catch (err) {
                        showStatus(`❌ Import failed: ${err.message}`, true);
                    } finally {
                        serverBtn.textContent = '🖥️ Server Path';
                        serverBtn.disabled = false;
                        if (typeof window !== 'undefined' && window.setAppExpectedRequests) window.setAppExpectedRequests(0);
                    }
                }
            });
        }

        // ── Re-Ingest Handler ──
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
                    if (typeof window !== 'undefined' && window.setAppExpectedRequests) window.setAppExpectedRequests(displayedIds.length);
                    const res = await api.reingestBatch(displayedIds);
                    await store.loadBrowse(true);
                    await store.loadTags();
                } catch (err) {
                    alert(`Re-ingest failed: ${err.message}`);
                } finally {
                    reingestBtn.textContent = 'Re-Ingest';
                    reingestBtn.disabled = false;
                    if (typeof window !== 'undefined' && window.setAppExpectedRequests) window.setAppExpectedRequests(0);
                }
            });
        }

        // ── Fetch All Handler ──
        const fetchAllBtn = this.container.querySelector('#btn-fetch-all');
        if (fetchAllBtn) {
            fetchAllBtn.addEventListener('click', async () => {
                try {
                    fetchAllBtn.textContent = '⏳ Fetching...';
                    fetchAllBtn.disabled = true;
                    await store.fetchAll();
                } finally {
                    fetchAllBtn.textContent = '⚡ Fetch All';
                    fetchAllBtn.disabled = false;
                }
            });
        }

        // ── Copy Selected Bash Handler ──
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
    }
}
