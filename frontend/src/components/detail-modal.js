import { store } from '../state/store.js';
import { api } from '../api/client.js';
import { marked } from 'marked';
import ePub from 'epubjs';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/atom-one-dark.css';

export class DetailModal {
    constructor(container) {
        this.container = container;
        this.modalTimer = null;
        this.currentRenderedId = null;
        this.currentEpubRendition = null;
        this.currentEpubBook = null;
        try {
            const saved = localStorage.getItem('toxik_modal_expanded_sections_default');
            this.expandedSections = saved ? new Set(JSON.parse(saved)) : new Set(['view', 'playlist', 'tags', 'info', 'actions']);
        } catch (e) {
            this.expandedSections = new Set(['view', 'playlist', 'tags', 'info', 'actions']);
        }

        store.subscribe((state, changed) => {
            if (changed && changed.activeModalItem !== undefined) {
                this.render(state.activeModalItem);
            } else if (changed && changed.playlist && state.activeModalItem) {
                this.updatePlaylistUI();
            } else if (!changed) {
                this.render(state.activeModalItem);
            }
        });
        this.attachGlobalEvents();
    }

    attachGlobalEvents() {
        let lastWheelTime = 0;
        this.container.addEventListener('wheel', (e) => {
            const activeItem = store.get('activeModalItem');
            if (!activeItem || activeItem.media_type === 'doc') return;
            if (e.target.closest('.modal-sidebar') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
                return;
            }
            e.preventDefault();
            const now = Date.now();
            if (now - lastWheelTime < 250) return;

            if (e.deltaY > 10 || e.deltaX > 10) {
                lastWheelTime = now;
                this.stepAdjacentMedia(1);
            } else if (e.deltaY < -10 || e.deltaX < -10) {
                lastWheelTime = now;
                this.stepAdjacentMedia(-1);
            }
        }, { passive: false });
    }

    stepAdjacentMedia(direction) {
        if (this.modalTimer) {
            clearTimeout(this.modalTimer);
            this.modalTimer = null;
        }
        const pl = store.get('playlist') || {};
        const results = store.get('results') || [];
        const items = results.filter(r => r.type === 'item' && r.media).map(r => r.media);
        if (items.length <= 1) return;

        const currentId = store.get('activeModalItem')?.id;
        const idx = items.findIndex(item => item.id === currentId);
        if (idx === -1) return;

        let nextIdx;
        if (pl.loopMode === 'one' && direction > 0 && pl.isPlaying) {
            nextIdx = idx;
            const media = this.container.querySelector('video, audio');
            if (media) {
                media.currentTime = 0;
                media.play().catch(() => {});
                return;
            }
        } else if (pl.isShuffle && pl.isPlaying) {
            nextIdx = Math.floor(Math.random() * items.length);
        } else {
            nextIdx = idx + direction;
            if (nextIdx >= items.length) {
                if (pl.loopMode === 'set' || !pl.loopMode) {
                    nextIdx = 0;
                } else if (pl.isPlaying) {
                    store.set({ playlist: { ...pl, isPlaying: false } });
                    return;
                } else {
                    nextIdx = 0;
                }
            } else if (nextIdx < 0) {
                nextIdx = items.length - 1;
            }
        }

        const activeFS = document.fullscreenElement;
        const currentVideo = this.container.querySelector('video');
        this.wasVideoFS = !!(
            (activeFS && activeFS.tagName && activeFS.tagName.toLowerCase() === 'video') ||
            (currentVideo && (currentVideo === activeFS || currentVideo === document.webkitFullscreenElement || currentVideo.webkitDisplayingFullscreen || (currentVideo.matches && currentVideo.matches(':fullscreen'))))
        );
        const wasBrowserFS = !!(activeFS && !this.wasVideoFS && (activeFS === this.container || this.container.contains(activeFS)));
        this.wasBrowserFS = wasBrowserFS;

        store.set({ activeModalItem: items[nextIdx] });
        if (pl.isPlaying) {
            store.set({ playlist: { ...pl, currentIndex: nextIdx, activeId: items[nextIdx].id } });
        }
    }

    updatePlaylistUI() {
        const pl = store.get('playlist') || {};
        const playBtn = this.container.querySelector('#btn-modal-play-pl');
        const shuffleBtn = this.container.querySelector('#btn-modal-shuffle-pl');
        const loopBtn = this.container.querySelector('#btn-modal-loop-pl');

        if (playBtn) {
            playBtn.innerHTML = pl.isPlaying ? '⏸ Pause' : '▶ Play';
            playBtn.style.background = pl.isPlaying ? 'var(--accent-cyan)' : 'var(--accent-gradient)';
            playBtn.style.color = pl.isPlaying ? '#000' : '#fff';
        }
        if (shuffleBtn) {
            shuffleBtn.innerHTML = `🔀 ${pl.isShuffle ? 'Shuffle: On' : 'Shuffle'}`;
            shuffleBtn.style.color = pl.isShuffle ? '#fff' : 'var(--text-secondary)';
            shuffleBtn.style.background = pl.isShuffle ? 'rgba(0, 240, 255, 0.2)' : 'transparent';
        }
        if (loopBtn) {
            let loopLabel = '🔁 Loop: Set';
            if (pl.loopMode === 'one') loopLabel = '🔂 Loop: One';
            if (pl.loopMode === 'none') loopLabel = '➡ Loop: Off';
            loopBtn.innerHTML = loopLabel;
        }

        this.syncPlaybackState();
    }

    syncPlaybackState() {
        if (this.modalTimer) {
            clearTimeout(this.modalTimer);
            this.modalTimer = null;
        }
        const pl = store.get('playlist') || {};
        const video = this.container.querySelector('video');
        const audio = this.container.querySelector('audio');

        if (video) {
            video.loop = !pl.isPlaying;
            if (pl.isPlaying) video.removeAttribute('loop');
            else video.setAttribute('loop', '');
            video.onended = pl.isPlaying ? () => this.stepAdjacentMedia(1) : null;
            if (pl.isPlaying && video.paused) video.play().catch(() => {});
            else if (!pl.isPlaying && !video.paused) video.pause();
        } else if (audio) {
            audio.loop = !pl.isPlaying;
            if (pl.isPlaying) audio.removeAttribute('loop');
            else audio.setAttribute('loop', '');
            audio.onended = pl.isPlaying ? () => this.stepAdjacentMedia(1) : null;
            if (pl.isPlaying && audio.paused) audio.play().catch(() => {});
            else if (!pl.isPlaying && !audio.paused) audio.pause();
        } else if (pl.isPlaying) {
            this.modalTimer = setTimeout(() => {
                if (store.get('playlist')?.isPlaying && store.get('activeModalItem')) {
                    this.stepAdjacentMedia(1);
                }
            }, 4000);
        }
    }

    formatBytes(bytes) {
        if (!bytes) return 'N/A';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    render(item) {
        if (this.currentEpubRendition) {
            try { this.currentEpubRendition.destroy(); } catch (e) {}
            this.currentEpubRendition = null;
        }
        if (this.currentEpubBook) {
            try { this.currentEpubBook.destroy(); } catch (e) {}
            this.currentEpubBook = null;
        }

        if (!item) {
            this.container.innerHTML = '';
            this.container.style.display = 'none';
            return;
        }

        const mediaType = item.media_type || 'default';
        try {
            const saved = localStorage.getItem('toxik_modal_expanded_sections_' + mediaType);
            if (saved) {
                this.expandedSections = new Set(JSON.parse(saved));
            } else if (mediaType === 'doc') {
                this.expandedSections = new Set(['view', 'tags', 'info', 'actions']);
            } else {
                this.expandedSections = new Set(['view', 'playlist', 'tags', 'info', 'actions']);
            }
        } catch (e) {
            this.expandedSections = new Set(['view', 'playlist', 'tags', 'info', 'actions']);
        }

        this.container.style.display = 'flex';
        const isVideo = item.media_type === 'video';
        const mediaUrl = `/api/media/${item.id}/file`;

        const results = store.get('results') || [];
        const items = results.filter(r => r.type === 'item' && r.media).map(r => r.media);
        const currentIndex = items.findIndex(i => i.id === item.id);
        const totalCount = items.length;

        const tagPillsHtml = (item.tags || []).map(t => {
            const parts = t.split('.');
            const clickableParts = parts.map((part, idx) => {
                const subTag = parts.slice(0, idx + 1).join('.');
                return `<span class="clickable-tag-part" data-filter="${subTag}" title="Filter by ${subTag}">${part}</span>`;
            }).join('<span style="opacity: 0.4; margin: 0 1px;">.</span>');

            return `
              <span class="tag-pill" data-filter="${t}" style="font-size: 0.8rem; padding: 4px 10px; background: rgba(0, 240, 255, 0.15); border-color: var(--accent-cyan); display: inline-flex; align-items: center; gap: 6px;">
                <span style="display: inline-flex; align-items: center;">${clickableParts}</span>
                <button class="btn-remove-tag" data-tag="${t}" title="Remove tag" style="background: none; border: none; color: #fff; font-weight: 800; cursor: pointer; font-size: 0.9rem; margin-left: 2px;">×</button>
              </span>
            `;
        }).join('');

        const isDoc = item.media_type === 'doc';
        const isGame = item.media_type === 'game';
        const isFiction = item.media_type === 'fiction';
        const isPlayable = !isDoc && !isGame && !isFiction;
        const isImageOrVideo = item.media_type === 'image' || item.media_type === 'video';
        const stretchFit = store.get('mediaStretchFit') ? 'cover' : 'contain';

        this.container.innerHTML = `
          <div class="modal-backdrop" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(10px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 32px; animation: fadeIn 0.2s ease;">

            <div class="modal-content glass" style="width: 100%; max-width: 1280px; height: 90vh; border-radius: var(--radius-lg); display: flex; overflow: hidden; box-shadow: 0 0 50px rgba(0,0,0,0.9); border: 1px solid rgba(255,255,255,0.15);">

              <!-- Left / Main: Media Viewer -->
              <div class="modal-media-container" style="flex: 1; background: #000; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; min-width: 0;">

                ${isDoc ? `
                  <div id="doc-viewer-container" style="width: 100%; height: 100%; background: #0f111a; color: #e0e0e0; overflow: hidden; box-sizing: border-box; text-align: left; display: flex; flex-direction: column; position: relative;">
                    <div style="display:flex; justify-content:center; align-items:center; height:100%; color: var(--text-muted);">
                      <span>⌛ Loading document content (${item.filename})...</span>
                    </div>
                  </div>
                ` : isVideo ? `
                  <video src="${mediaUrl}" controls autoplay ${store.get('playlist')?.isPlaying ? '' : 'loop'} style="max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: ${stretchFit};"></video>
                ` : item.media_type === 'audio' ? `
                  <div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: radial-gradient(circle, #1a1a2e 0%, #000 100%); padding: 32px; position: relative; overflow: hidden;">
                    ${item.thumb_url ? `<img src="${item.thumb_url}" onerror="this.style.display='none';" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.25; filter: blur(20px);" />` : ''}
                    <div style="position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%;">
                      ${item.thumb_url ? `<img src="${item.thumb_url}" onerror="this.style.display='none';" style="width: 280px; height: 280px; object-fit: cover; border-radius: var(--radius-md); box-shadow: 0 10px 40px rgba(0,0,0,0.8); margin-bottom: 24px; border: 1px solid rgba(255,255,255,0.2);" />` : `<div style="font-size: 6rem; margin-bottom: 24px; animation: pulseGlow 2s infinite;">🎵</div>`}
                      <h2 style="color: #fff; font-size: 1.4rem; margin-bottom: 24px; word-break: break-all; text-align: center; text-shadow: 0 2px 10px rgba(0,0,0,0.9);">${item.filename}</h2>
                      <audio src="${mediaUrl}" controls autoplay ${store.get('playlist')?.isPlaying ? '' : 'loop'} style="width: 80%; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); border-radius: 30px;"></audio>
                    </div>
                  </div>
                ` : `
                  <img src="${mediaUrl}" alt="${item.filename}" style="max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: ${stretchFit};" />
                `}
              </div>

              <!-- Right: Metadata & Tag Editor (Accordion) -->
              <div class="modal-sidebar" style="width: 380px; background: var(--bg-card); border-left: 1px solid var(--border-color); display: flex; flex-direction: column; height: 100%; overflow-y: auto;">

                <!-- Header -->
                <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-shrink: 0;">
                  <div style="flex: 1; min-width: 0;">
                    <h3 style="font-size: 1.1rem; font-weight: 700; color: #fff; word-break: break-all; margin-bottom: 6px;">${item.filename}</h3>
                    <span style="font-size: 0.8rem; color: var(--text-secondary);">${item.media_type.toUpperCase()} • ${this.formatBytes(item.file_size)}</span>
                  </div>
                  ${totalCount > 1 ? `
                    <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 20px; padding: 2px 6px;">
                      <button id="btn-modal-prev" title="Previous Media (Left/Up Arrow or Mouse Wheel Up)" class="btn" style="width: 28px; height: 28px; padding: 0; border-radius: 50%; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); color: #fff; font-size: 1.1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;">‹</button>
                      <span style="font-size: 0.75rem; font-weight: 700; color: #fff; padding: 0 4px; min-width: 42px; text-align: center;">${currentIndex + 1} / ${totalCount}</span>
                      <button id="btn-modal-next" title="Next Media (Right/Down Arrow or Mouse Wheel Down)" class="btn" style="width: 28px; height: 28px; padding: 0; border-radius: 50%; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); color: #fff; font-size: 1.1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;">›</button>
                    </div>
                  ` : ''}
                </div>

                <!-- Section 0: View Controls -->
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0; background: rgba(179, 136, 255, 0.03);">
                  <div class="accordion-header" data-section="view" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: #b388ff; text-transform: uppercase;">
                    <span>🖥️ View Controls</span>
                    <span>${this.expandedSections.has('view') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('view') ? `
                    <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 8px;">
                      <button id="btn-close-modal" class="btn" style="width: 100%; height: 36px; background: rgba(255, 82, 82, 0.15); border: 1px solid #ff5252; color: #fff; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 6px;">
                        ✕ Close Detail Modal
                      </button>
                      <div style="display: flex; gap: 8px;">
                        <button id="btn-toggle-fs-media" class="btn" title="Toggle Fullscreen" style="flex: 1; height: 36px; background: rgba(255,255,255,0.08); border: 1px solid var(--border-color); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 0.85rem; border-radius: 6px;">
                          🖥️ Fullscreen Mode
                        </button>
                        <button id="btn-toggle-stretch-media" class="btn" title="Toggle Stretch to Fit (${store.get('mediaStretchFit') ? 'Cover' : 'Contain'})" style="flex: 1; height: 36px; background: ${store.get('mediaStretchFit') ? 'var(--accent-gradient)' : 'rgba(255,255,255,0.08)'}; border: 1px solid var(--border-color); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 0.85rem; border-radius: 6px;">
                          ${store.get('mediaStretchFit') ? '↔️ Fit: Cover' : '🔲 Fit: Contain'}
                        </button>
                      </div>
                    </div>
                  ` : ''}
                </div>

                <!-- Section 1: Playlist Controls -->
                ${isPlayable ? `
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0; background: rgba(0, 240, 255, 0.03);">
                  <div class="accordion-header" data-section="playlist" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--accent-cyan); text-transform: uppercase;">
                    <span>🎵 Play Controls</span>
                    <span>${this.expandedSections.has('playlist') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('playlist') ? `
                    <div class="detail-play-controls" style="padding: 0 16px 14px 16px;">
                      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                        <span style="font-size: 0.75rem; color: var(--text-muted);">VLC & Fullscreen</span>
                        <div style="display: flex; gap: 6px;">
                          <button id="btn-modal-dl-pl" class="btn" title="Download VLC Playlist (.m3u8)" style="height: 26px; padding: 0 10px; font-size: 0.75rem; background: rgba(0,240,255,0.15); border: 1px solid var(--accent-cyan); color: #fff; cursor: pointer; font-weight: 600;">
                            ⬇️ VLC
                          </button>
                          <button id="btn-modal-fullscreen" class="btn" title="Toggle Fullscreen Mode" style="height: 26px; padding: 0 10px; font-size: 0.75rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; cursor: pointer;">
                            🖥️ FS
                          </button>
                        </div>
                      </div>

                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
                        <button id="btn-modal-prev-pl" class="btn btn-icon" title="Previous Item" style="flex: 1; height: 36px; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); color: #fff; cursor: pointer;">⏮ Prev</button>
                        <button id="btn-modal-play-pl" class="btn" title="Play / Pause" style="flex: 1.5; height: 36px; background: var(--accent-gradient); border: none; color: #fff; font-weight: 700; box-shadow: 0 0 15px rgba(0,240,255,0.3); cursor: pointer; display: flex; align-items: center; justify-content: center;">
                          ▶ Play
                        </button>
                        <button id="btn-modal-next-pl" class="btn btn-icon" title="Next Item" style="flex: 1; height: 36px; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); color: #fff; cursor: pointer;">Next ⏭</button>
                      </div>

                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <button id="btn-modal-shuffle-pl" class="btn" style="flex: 1; height: 30px; font-size: 0.75rem; background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); cursor: pointer;">
                          🔀 Shuffle
                        </button>
                        <button id="btn-modal-loop-pl" class="btn" style="flex: 1; height: 30px; font-size: 0.75rem; background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); cursor: pointer;">
                          🔁 Loop: Set
                        </button>
                      </div>
                    </div>
                  ` : ''}
                </div>
                ` : ''}

                <!-- Section 2: Tags Section -->
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
                  <div class="accordion-header" data-section="tags" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                    <span>🏷 Hierarchical Tags</span>
                    <span>${this.expandedSections.has('tags') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('tags') ? `
                    <div style="padding: 0 16px 14px 16px;">
                      <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px;">
                        ${tagPillsHtml || '<span style="font-size: 0.85rem; color: var(--text-muted);">No tags assigned yet.</span>'}
                      </div>
                      <div style="display: flex; gap: 8px;">
                        <input type="text" id="input-add-tag" class="input" placeholder="Add tag (e.g. Person.Jake)..." style="height: 38px; font-size: 0.85rem;" />
                        <button class="btn btn-primary" id="btn-add-tag-submit" style="height: 38px; padding: 0 16px;">+</button>
                      </div>
                    </div>
                  ` : ''}
                </div>

                <!-- Section 3: Metadata Details -->
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
                  <div class="accordion-header" data-section="info" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                    <span>ℹ️ Technical Specs</span>
                    <span>${this.expandedSections.has('info') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('info') ? `
                    <div style="padding: 0 16px 14px 16px; font-size: 0.85rem;">
                      <div style="display: grid; grid-template-columns: 100px 1fr; gap: 8px; color: var(--text-secondary);">
                        <span>Resolution:</span> <strong style="color: #fff;">${item.width || '?'} × ${item.height || '?'}</strong>
                        <span>Path:</span> <span style="font-size: 0.75rem; word-break: break-all; color: var(--text-muted);">${item.filepath}</span>
                        ${item.file_hash ? `<span>SHA-256:</span> <span style="font-size: 0.7rem; font-family: monospace; word-break: break-all; color: var(--text-muted);">${item.file_hash.substring(0, 16)}...</span>` : ''}
                      </div>
                    </div>
                  ` : ''}
                </div>

                ${isPlayable ? `
                <!-- Section 4: Actions -->
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
                  <div class="accordion-header" data-section="actions" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                    <span>🎮 Actions & Gen</span>
                    <span>${this.expandedSections.has('actions') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('actions') ? `
                    <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                        <button class="btn" id="btn-action-i2i" style="background: rgba(0, 229, 255, 0.2); border-color: var(--accent-cyan); color: #fff; font-weight: 600; font-size: 0.8rem; padding: 0 6px; height: 38px;" title="Image to Image">
                          🎨 I2I
                        </button>
                        <button class="btn" id="btn-action-i2v" style="background: rgba(157, 0, 255, 0.2); border-color: var(--accent-purple); color: #fff; font-weight: 600; font-size: 0.8rem; padding: 0 6px; height: 38px;" title="Image to Video">
                          🎬 I2V
                        </button>
                        <button class="btn" id="btn-action-v2v" style="background: rgba(255, 145, 0, 0.2); border-color: #ff9100; color: #fff; font-weight: 600; font-size: 0.8rem; padding: 0 6px; height: 38px;" title="Video to Video">
                          🎥 V2V
                        </button>
                      </div>
                      <div style="display: flex; gap: 8px;">
                        <a href="/api/media/${item.id}/file" download="${item.filename}" class="btn" style="flex: 1; background: rgba(0, 240, 255, 0.15); border: 1px solid rgba(0, 240, 255, 0.4); color: var(--accent-cyan); height: 38px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; border-radius: 6px; font-size: 0.85rem;">
                          ⬇️ Download
                        </a>
                        <a href="/api/media/${item.id}/file" target="_blank" rel="noopener noreferrer" class="btn" style="flex: 1; background: rgba(179, 136, 255, 0.15); border: 1px solid rgba(179, 136, 255, 0.4); color: #b388ff; height: 38px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; border-radius: 6px; font-size: 0.85rem;">
                          ↗️ Open in Tab
                        </a>
                      </div>
                      <button class="btn" id="btn-upload-comfyui" style="width: 100%; background: rgba(0, 255, 102, 0.15); border-color: rgba(0, 255, 102, 0.4); color: #00ff66; height: 38px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        ☁️ Upload to ComfyUI
                      </button>
                      <button class="btn" id="btn-delete-media" style="width: 100%; background: rgba(255, 0, 0, 0.15); border-color: rgba(255, 0, 0, 0.4); color: #ff6b6b; height: 38px;">
                        🗑 Delete Media Item
                      </button>
                    </div>
                  ` : ''}
                </div>
                ` : ''}

                <!-- Section 5: Transcode -->
                ${isPlayable ? `
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
                  <div class="accordion-header" data-section="transcode" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                    <span>🔄 Transcode</span>
                    <span>${this.expandedSections.has('transcode') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('transcode') ? `
                    <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                      <div id="transcode-formats-container" style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="font-size: 0.8rem; color: var(--text-secondary); padding: 8px 0;">Loading formats...</div>
                      </div>
                      <div style="display: flex; gap: 8px; align-items: center; padding: 4px 0;">
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer;">
                          <input type="radio" name="transcode-mode-${item.id}" value="download" checked style="accent-color: var(--accent-cyan);" />
                          ⬇️ Download
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer;">
                          <input type="radio" name="transcode-mode-${item.id}" value="import" style="accent-color: var(--accent-green);" />
                          📥 Import
                        </label>
                      </div>
                    </div>
                  ` : ''}
                </div>
                ` : ''}

                ${isGame ? `
                <!-- Section 6: Emulation -->
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
                  <div class="accordion-header" data-section="emu" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                    <span>🎮 Emulation</span>
                    <span>${this.expandedSections.has('emu') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('emu') ? `
                    <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                      <div id="emu-info" style="font-size: 0.8rem; color: var(--text-secondary); padding: 8px 0;">
                        ${this._isRom(item) ? `ROM detected (${this._romSystem(item)}). In-browser emulator coming soon.` : 'Not a ROM file.'}
                      </div>
                    </div>
                  ` : ''}
                </div>
                ` : ''}

                ${isFiction ? `
                <!-- Section 7: Interactive Fiction -->
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
                  <div class="accordion-header" data-section="if" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                    <span>📖 Interactive Fiction</span>
                    <span>${this.expandedSections.has('if') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('if') ? `
                    <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                      <div id="if-info" style="font-size: 0.8rem; color: var(--text-secondary); padding: 8px 0;">
                        ${this._isInteractiveFiction(item) ? `Story detected (${this._ifFormat(item)}). In-browser player coming soon.` : 'Not an interactive fiction file.'}
                      </div>
                    </div>
                  ` : ''}
                </div>
                ` : ''}

                ${isImageOrVideo ? `
                <div class="sidebar-section" style="border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
                  <div class="accordion-header" data-section="xr" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase;">
                    <span>🥽 VR / Stereogram</span>
                    <span>${this.expandedSections.has('xr') ? '▼' : '▶'}</span>
                  </div>
                  ${this.expandedSections.has('xr') ? `
                    <div style="padding: 0 16px 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                      <div style="font-size: 0.8rem; color: var(--text-secondary); padding: 8px 0;">
                        ${item.media_type === 'image' ? 'Generate an autostereogram from this image, or view in VR.' : 'VR viewing available for images and video.'}
                      </div>
                      ${item.media_type === 'image' ? `
                        <button class="btn" id="btn-stereogram" style="background: rgba(255, 0, 127, 0.15); border: 1px solid rgba(255, 0, 127, 0.4); color: var(--accent-magenta); height: 36px; font-weight: 600; font-size: 0.8rem;">
                          👁 Generate Stereogram
                        </button>
                      ` : ''}
                      <button class="btn" id="btn-vr-view" style="background: rgba(157, 0, 255, 0.15); border: 1px solid rgba(157, 0, 255, 0.4); color: var(--accent-purple); height: 36px; font-weight: 600; font-size: 0.8rem;">
                        🥽 View in VR (coming soon)
                      </button>
                    </div>
                  ` : ''}
                </div>
                ` : ''}

              </div>
            </div>
          </div>
        `;

        if (isDoc) {
            const docEl = this.container.querySelector('#doc-viewer-container');
            const ext = item.filename ? item.filename.slice(item.filename.lastIndexOf('.')).toLowerCase() : '';
            if (docEl) {
                if (ext === '.pdf') {
                    docEl.style.background = '#fff';
                    docEl.innerHTML = `<iframe src="${mediaUrl}#toolbar=1&view=FitH" style="width: 100%; height: 100%; border: none; flex: 1;"></iframe>`;
                } else if (ext === '.html' || ext === '.htm') {
                    docEl.style.background = '#fff';
                    docEl.innerHTML = `<iframe src="${mediaUrl}" sandbox="allow-scripts allow-same-origin" style="width: 100%; height: 100%; border: none; flex: 1;"></iframe>`;
                } else if (ext === '.epub') {
                    docEl.style.background = '#1a1c23';
                    docEl.innerHTML = `
                      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; background: #141720; border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0; z-index: 5; gap: 12px; flex-wrap: wrap;">
                        <span style="font-weight: 600; color: #fff; font-size: 0.95rem;">📖 ${item.filename}</span>
                        <div style="display: flex; gap: 8px; align-items: center;">
                          <select id="epub-toc" style="display: none; background: #1a1c23; color: #fff; border: 1px solid rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; max-width: 240px;"></select>
                          <button id="epub-prev" class="btn" style="padding: 6px 16px; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; cursor: pointer;">◀ Prev</button>
                          <button id="epub-next" class="btn" style="padding: 6px 16px; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; cursor: pointer;">Next ▶</button>
                        </div>
                      </div>
                      <div id="epub-render-area" style="flex: 1; width: 100%; height: 100%; background: #fff; overflow: hidden; position: relative;"></div>
                    `;
                    fetch(mediaUrl)
                      .then(res => res.arrayBuffer())
                      .then(buffer => {
                          const book = ePub(buffer);
                          this.currentEpubBook = book;
                          const rendition = book.renderTo("epub-render-area", {
                              width: "100%",
                              height: "100%",
                              spread: "auto",
                              flow: "paginated"
                          });
                          this.currentEpubRendition = rendition;
                          rendition.display();

                          const prevBtn = docEl.querySelector('#epub-prev');
                          const nextBtn = docEl.querySelector('#epub-next');
                          if (prevBtn) prevBtn.onclick = () => rendition.prev();
                          if (nextBtn) nextBtn.onclick = () => rendition.next();

                          book.loaded.navigation.then(nav => {
                              const tocEl = docEl.querySelector('#epub-toc');
                              if (tocEl && nav.toc && nav.toc.length > 0) {
                                  tocEl.innerHTML = `<option value="">📑 Jump to Chapter...</option>` +
                                      nav.toc.map(t => `<option value="${t.href}">${t.label ? t.label.trim() : t.href}</option>`).join('');
                                  tocEl.style.display = 'inline-block';
                                  tocEl.onchange = (e) => {
                                      if (e.target.value) rendition.display(e.target.value);
                                  };
                              }
                          }).catch(() => {});

                          rendition.on('keyup', (e) => {
                              if ((e.keyCode || e.which) === 37) rendition.prev();
                              if ((e.keyCode || e.which) === 39) rendition.next();
                          });
                      })
                      .catch(e => {
                          docEl.innerHTML = `<div style="color:#ff4444; padding: 40px;">Failed to render EPUB: ${e.message}</div>`;
                      });
                } else {
                    fetch(mediaUrl).then(res => res.text()).then(text => {
                        const docEl = this.container.querySelector('#doc-viewer-container');
                        if (!docEl) return;

                        docEl.style.overflowY = 'auto';
                        docEl.style.padding = '40px 60px';
                        docEl.style.background = '#0f111a';

                        const codeExts = [
                            '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
                            '.css', '.scss', '.less', '.json', '.yaml', '.yml',
                            '.xml', '.sh', '.bash', '.zsh', '.rs', '.go', '.c',
                            '.cpp', '.h', '.hpp', '.java', '.cs', '.sql', '.toml',
                            '.ini', '.php', '.rb', '.swift', '.kt', '.lua', '.cfg',
                            '.conf', '.env', '.log'
                        ];

                        if (ext === '.md' || ext === '.markdown') {
                            const renderedHtml = marked.parse(text, { breaks: true, gfm: true });
                            docEl.innerHTML = `
                              <div class="markdown-body" style="max-width: 900px; margin: 0 auto; width: 100%; color: #e0e0e0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.7; font-size: 1.05rem;">
                                <div style="border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 16px; margin-bottom: 24px; color: var(--accent-cyan); font-weight: 600; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">
                                  📄 Markdown Document • ${item.filename}
                                </div>
                                ${renderedHtml}
                              </div>
                            `;
                        } else if (codeExts.includes(ext) || ext === '.dockerfile' || ext === '.makefile' || !['.rst', '.txt'].includes(ext)) {
                            const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const langMap = {
                                '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
                                '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
                                '.css': 'css', '.scss': 'scss', '.less': 'less', '.json': 'json',
                                '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml', '.sh': 'bash',
                                '.bash': 'bash', '.zsh': 'bash', '.rs': 'rust', '.go': 'go',
                                '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.java': 'java',
                                '.cs': 'csharp', '.sql': 'sql', '.toml': 'ini', '.ini': 'ini',
                                '.php': 'php', '.rb': 'ruby', '.swift': 'swift', '.kt': 'kotlin',
                                '.lua': 'lua', '.cfg': 'ini', '.conf': 'ini', '.env': 'bash'
                            };
                            const langName = langMap[ext] || ext.slice(1) || 'code';
                            const langClass = langMap[ext] ? `language-${langMap[ext]}` : '';
                            const linesCount = text.split('\n').length;
                            docEl.innerHTML = `
                              <div style="max-width: 1100px; margin: 0 auto; width: 100%; color: #e0e0e0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; font-size: 0.95rem;">
                                <div style="border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 16px; margin-bottom: 24px; color: var(--accent-cyan); font-weight: 600; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; display: flex; justify-content: space-between; align-items: center;">
                                  <span>💻 Source Code (${langName}) • ${item.filename}</span>
                                  <span style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace;">${linesCount} lines</span>
                                </div>
                                <pre style="background: #141720; padding: 20px; border-radius: 8px; border: 1px solid var(--border-color); overflow-x: auto; margin: 0;"><code class="${langClass}" style="font-family: 'Courier New', Courier, monospace; font-size: 0.9rem; line-height: 1.5;">${escaped}</code></pre>
                              </div>
                            `;
                        } else if (ext === '.rst') {
                            const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            docEl.innerHTML = `
                              <div style="max-width: 900px; margin: 0 auto; width: 100%; color: #e0e0e0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.7; font-size: 1.05rem;">
                                <div style="border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 16px; margin-bottom: 24px; color: var(--accent-cyan); font-weight: 600; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">
                                  📄 reStructuredText • ${item.filename}
                                </div>
                                <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${escaped}</pre>
                              </div>
                            `;
                        } else {
                            const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            docEl.innerHTML = `
                              <div style="max-width: 900px; margin: 0 auto; width: 100%; color: #e0e0e0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.7; font-size: 1rem;">
                                <div style="border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 16px; margin-bottom: 24px; color: var(--accent-cyan); font-weight: 600; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">
                                  📄 Text Document • ${item.filename}
                                </div>
                                <pre style="white-space: pre-wrap; font-family: 'Courier New', Courier, monospace; margin: 0; line-height: 1.5; font-size: 0.95rem;">${escaped}</pre>
                              </div>
                            `;
                        }

                        docEl.querySelectorAll('pre code').forEach((block) => {
                            try { hljs.highlightElement(block); } catch (e) {}
                        });
                    }).catch(err => {
                        const docEl = this.container.querySelector('#doc-viewer-container');
                        if (docEl) docEl.innerHTML = `<div style="color:#ff4444; padding: 40px;">Failed to load document: ${err.message}</div>`;
                    });
                }
            }
        }

        this.updatePlaylistUI();
        this.attachEvents(item);

        if (this.wasVideoFS) {
            const newVideo = this.container.querySelector('video');
            if (newVideo) {
                if (newVideo.requestFullscreen) {
                    newVideo.requestFullscreen().catch(() => {
                        if (document.fullscreenElement && document.fullscreenElement.tagName?.toLowerCase() === 'video') {
                            document.exitFullscreen().catch(() => {});
                        }
                    });
                } else if (newVideo.webkitEnterFullscreen) {
                    newVideo.webkitEnterFullscreen();
                }
            } else if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
            this.wasVideoFS = false;
        } else if (this.wasBrowserFS && !document.fullscreenElement) {
            this.container.requestFullscreen().catch(() => {});
            this.wasBrowserFS = false;
        }
    }

    attachEvents(item) {
        const closeBtn = this.container.querySelector('#btn-close-modal');
        const backdrop = this.container.querySelector('.modal-backdrop');

        const close = () => store.set({ activeModalItem: null });
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (backdrop) backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) close();
        });

        const prevBtn = this.container.querySelector('#btn-modal-prev');
        const nextBtn = this.container.querySelector('#btn-modal-next');
        if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); this.stepAdjacentMedia(-1); });
        if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.stepAdjacentMedia(1); });

        const prevPl = this.container.querySelector('#btn-modal-prev-pl');
        const playPl = this.container.querySelector('#btn-modal-play-pl');
        const nextPl = this.container.querySelector('#btn-modal-next-pl');
        const shufPl = this.container.querySelector('#btn-modal-shuffle-pl');
        const loopPl = this.container.querySelector('#btn-modal-loop-pl');
        const fsPl = this.container.querySelector('#btn-modal-fullscreen');

        if (prevPl) prevPl.addEventListener('click', () => this.stepAdjacentMedia(-1));
        if (nextPl) nextPl.addEventListener('click', () => this.stepAdjacentMedia(1));
        if (playPl) {
            playPl.addEventListener('click', () => {
                const pl = store.get('playlist') || {};
                store.set({ playlist: { ...pl, isPlaying: !pl.isPlaying } });
            });
        }
        if (shufPl) {
            shufPl.addEventListener('click', () => {
                const pl = store.get('playlist') || {};
                store.set({ playlist: { ...pl, isShuffle: !pl.isShuffle } });
            });
        }
        if (loopPl) {
            loopPl.addEventListener('click', () => {
                const pl = store.get('playlist') || {};
                const modes = ['set', 'one', 'none'];
                const nextMode = modes[(modes.indexOf(pl.loopMode || 'set') + 1) % modes.length];
                store.set({ playlist: { ...pl, loopMode: nextMode } });
            });
        }
        const dlPl = this.container.querySelector('#btn-modal-dl-pl');
        if (dlPl) {
            dlPl.addEventListener('click', () => {
                const filter = store.getEffectiveFilter();
                const mediaType = store.get('mediaType') || '';
                let url = `/api/browse/playlist?`;
                if (filter && filter !== 'All') url += `filter=${encodeURIComponent(filter)}&`;
                if (mediaType && mediaType !== 'all') url += `media_type=${encodeURIComponent(mediaType)}&`;
                const a = document.createElement('a');
                a.href = url;
                a.download = `toxik_${filter || 'all'}.m3u8`.replace(/[^a-zA-Z0-9_-]/g, '_');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
        }
        const toggleFs = () => {
            if (!document.fullscreenElement) {
                this.container.requestFullscreen().catch(err => console.error(err));
            } else {
                document.exitFullscreen().catch(err => console.error(err));
            }
        };

        const fsMediaBtn = this.container.querySelector('#btn-toggle-fs-media');
        if (fsMediaBtn) fsMediaBtn.addEventListener('click', toggleFs);
        if (fsPl) fsPl.addEventListener('click', toggleFs);

        const addInput = this.container.querySelector('#input-add-tag');
        const addSubmit = this.container.querySelector('#btn-add-tag-submit');

        const addTag = async () => {
            const val = addInput.value.trim();
            if (!val) return;
            try {
                await api.batchTag([item.id], { addTags: [val] });
                const updated = await api.getMedia(item.id);
                store.set({ activeModalItem: updated });
                await store.loadTags();
                await store.loadBrowse(true);
            } catch (err) {
                alert(`Failed to add tag: ${err.message}`);
            }
        };

        if (addSubmit && addInput) {
            addSubmit.addEventListener('click', addTag);
            addInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') addTag();
            });
        }

        this.container.querySelectorAll('.btn-remove-tag').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const tag = btn.getAttribute('data-tag');
                try {
                    await api.batchTag([item.id], { removeTags: [tag] });
                    const updated = await api.getMedia(item.id);
                    store.set({ activeModalItem: updated });
                    await store.loadTags();
                    await store.loadBrowse(true);
                } catch (err) {
                    alert(`Failed to remove tag: ${err.message}`);
                }
            });
        });

        this.container.querySelectorAll('.clickable-tag-part').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filterTag = el.getAttribute('data-filter');
                if (filterTag) {
                    store.set({ activeModalItem: null });
                    await store.setFilter(filterTag);
                }
            });
        });

        this.container.querySelectorAll('.tag-pill').forEach(pill => {
            pill.addEventListener('click', async (e) => {
                if (e.target.closest('.btn-remove-tag') || e.target.closest('.clickable-tag-part')) return;
                e.stopPropagation();
                const filterTag = pill.getAttribute('data-filter');
                if (filterTag) {
                    store.set({ activeModalItem: null });
                    await store.setFilter(filterTag);
                }
            });
        });

        const delBtn = this.container.querySelector('#btn-delete-media');
        if (delBtn) {
            delBtn.addEventListener('click', async () => {
                if (confirm(`Delete "${item.filename}" from library?`)) {
                    try {
                        await api.deleteMedia(item.id, false);
                        store.set({ activeModalItem: null });
                        await store.loadBrowse(true);
                        await store.loadTags();
                    } catch (err) {
                        alert(`Delete failed: ${err.message}`);
                    }
                }
            });
        }

        this.container.querySelectorAll('.accordion-header').forEach(hdr => {
            hdr.addEventListener('click', () => {
                const sec = hdr.getAttribute('data-section');
                if (this.expandedSections.has(sec)) {
                    this.expandedSections.delete(sec);
                } else {
                    this.expandedSections.add(sec);
                }
                const mediaType = store.get('activeModalItem')?.media_type || 'default';
                try {
                    localStorage.setItem('toxik_modal_expanded_sections_' + mediaType, JSON.stringify(Array.from(this.expandedSections)));
                } catch (err) {}
                this.render(item);
            });
        });

        const stretchBtn = this.container.querySelector('#btn-toggle-stretch-media');
        if (stretchBtn) {
            stretchBtn.addEventListener('click', () => {
                store.setMediaStretchFit(!store.get('mediaStretchFit'));
                this.render(item);
            });
        }

        const uploadComfyBtn = this.container.querySelector('#btn-upload-comfyui');
        if (uploadComfyBtn) {
            uploadComfyBtn.addEventListener('click', async () => {
                try {
                    uploadComfyBtn.innerHTML = '⏳ Uploading...';
                    uploadComfyBtn.disabled = true;
                    const res = await api.uploadToComfyUI(item.id);
                    alert(`Uploaded "${res.filename || item.filename}" to ComfyUI input directory successfully!`);
                    uploadComfyBtn.innerHTML = '☁️ Upload to ComfyUI';
                    uploadComfyBtn.disabled = false;
                } catch (err) {
                    alert(`Upload failed: ${err.message}`);
                    uploadComfyBtn.innerHTML = '☁️ Upload to ComfyUI';
                    uploadComfyBtn.disabled = false;
                }
            });
        }

        const i2iBtn = this.container.querySelector('#btn-action-i2i');
        if (i2iBtn) {
            i2iBtn.addEventListener('click', () => {
                store.set({ isGenerationOpen: true, generationTab: 'form', entryMode: 'I2I' });
            });
        }

        const i2vBtn = this.container.querySelector('#btn-action-i2v');
        if (i2vBtn) {
            i2vBtn.addEventListener('click', () => {
                store.set({ isGenerationOpen: true, generationTab: 'form', entryMode: 'I2V' });
            });
        }

        const v2vBtn = this.container.querySelector('#btn-action-v2v');
        if (v2vBtn) {
            v2vBtn.addEventListener('click', () => {
                store.set({ isGenerationOpen: true, generationTab: 'form', entryMode: 'V2V' });
            });
        }

        if (this.expandedSections.has('transcode')) {
            this._loadTranscodeFormats(item);
        }

        const stereoBtn = this.container.querySelector('#btn-stereogram');
        if (stereoBtn) {
            stereoBtn.addEventListener('click', () => {
                alert('Stereogram generation via ComfyUI coming soon.');
            });
        }

        const vrBtn = this.container.querySelector('#btn-vr-view');
        if (vrBtn) {
            vrBtn.addEventListener('click', () => {
                alert('VR viewer coming soon — Canvas Mode spatial boards first!');
            });
        }
    }

    async _loadTranscodeFormats(item) {
        const container = this.container.querySelector('#transcode-formats-container');
        if (!container) return;
        const mediaId = item.id;
        try {
            const res = await fetch(`/api/media/${mediaId}/transcode/formats`);
            const data = await res.json();
            if (!data.formats || data.formats.length === 0) {
                container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); padding: 8px 0;">No conversion formats available.</div>';
                return;
            }
            const groups = {};
            for (const f of data.formats) {
                const mime = f.mime || '';
                let group = 'other';
                if (mime.startsWith('image/')) group = 'image';
                else if (mime.startsWith('video/')) group = 'video';
                else if (mime.startsWith('audio/')) group = 'audio';
                if (!groups[group]) groups[group] = [];
                groups[group].push(f);
            }
            const groupLabels = { image: 'Image', video: 'Video', audio: 'Audio' };
            let html = '';
            for (const [g, fmts] of Object.entries(groups)) {
                const label = groupLabels[g] || g;
                const accentColors = { image: '--accent-cyan', video: '--accent-purple', audio: '--accent-magenta' };
                const color = `var(${accentColors[g] || '--accent-cyan'})`;
                html += `<div style="font-size: 0.75rem; font-weight: 700; color: ${color}; margin: 4px 0 2px 0; text-transform: uppercase;">${label}</div>`;
                html += `<div style="display: flex; flex-wrap: wrap; gap: 6px;">`;
                for (const f of fmts) {
                    html += `<button class="btn btn-transcode" data-format="${f.format}" data-ext="${f.target_ext}" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 0.8rem; padding: 4px 10px; height: 32px; border-radius: 6px; cursor: pointer;">.${f.format}</button>`;
                }
                html += `</div>`;
            }
            container.innerHTML = html;

            container.querySelectorAll('.btn-transcode').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const format = btn.getAttribute('data-format');
                    const ext = btn.getAttribute('data-ext');
                    const modeRadio = this.container.querySelector(`input[name="transcode-mode-${item.id}"]:checked`);
                    const mode = modeRadio ? modeRadio.value : 'download';
                    btn.disabled = true;
                    btn.textContent = '⏳...';
                    try {
                        if (mode === 'import') {
                            const res = await fetch(`/api/media/${mediaId}/transcode?target_format=${format}&mode=import`, { method: 'POST' });
                            if (!res.ok) {
                                const errData = await res.json().catch(() => ({}));
                                throw new Error(errData.detail || `Transcode failed (${res.status})`);
                            }
                            const imported = await res.json();
                            alert(`Imported as "${imported.filename}"`);
                            store.set({ activeModalItem: null });
                            await store.loadBrowse(true);
                        } else {
                            const a = document.createElement('a');
                            a.href = `/api/media/${item.id}/transcode?target_format=${format}&mode=download`;
                            a.download = `${item.filename || 'output'}${ext}`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                        }
                    } catch (err) {
                        alert(`Transcode error: ${err.message}`);
                    } finally {
                        btn.disabled = false;
                        btn.textContent = `.${format}`;
                    }
                });
            });
        } catch (err) {
            container.innerHTML = `<div style="font-size: 0.8rem; color: #ff6b6b; padding: 8px 0;">Failed to load formats: ${err.message}</div>`;
        }
    }

    _isRom(item) {
        if (!item || !item.filename) return false;
        const romExts = new Set(['.nes','.fds','.smc','.sfc','.gb','.gbc','.gba','.nds','.n64','.z64','.gen','.md','.smd','.pce','.sms','.gg','.ws','.wsc','.a26','.a78','.lnx','.j64','.ngp','.neo','.col','.int','.vb','.psx','.iso','.cue','.chd']);
        const ext = item.filename.slice(item.filename.lastIndexOf('.')).toLowerCase();
        return romExts.has(ext);
    }

    _romSystem(item) {
        if (!item || !item.filename) return '';
        const ext = item.filename.slice(item.filename.lastIndexOf('.')).toLowerCase();
        const map = { '.nes':'NES','.fds':'FDS','.smc':'SNES','.sfc':'SNES','.gb':'Game Boy','.gbc':'Game Boy Color','.gba':'Game Boy Advance','.gen':'Genesis','.md':'Mega Drive','.n64':'Nintendo 64','.psx':'PlayStation','.nds':'Nintendo DS','.sms':'Master System','.gg':'Game Gear' };
        return map[ext] || 'Unknown';
    }

    _isInteractiveFiction(item) {
        if (!item || !item.filename) return false;
        const low = item.filename.toLowerCase();
        if (low.endsWith('.ink.json')) return true;
        const ifExts = new Set(['.z1','.z2','.z3','.z4','.z5','.z6','.z7','.z8','.zblorb','.blorb','.gblorb','.ulx','.gam','.t3','.ink']);
        const ext = low.slice(low.lastIndexOf('.'));
        return ifExts.has(ext);
    }

    _ifFormat(item) {
        if (!item || !item.filename) return '';
        const low = item.filename.toLowerCase();
        if (low.endsWith('.ink.json')) return 'Ink';
        const ext = low.slice(low.lastIndexOf('.'));
        const map = { '.z3':'Z-machine','.z5':'Z-machine','.z8':'Z-machine','.zblorb':'Z-machine','.gblorb':'Glulx','.ulx':'Glulx','.gam':'TADS','.t3':'TADS 3','.ink':'Ink' };
        return map[ext] || 'Unknown';
    }
}
