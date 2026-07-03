import './styles/index.css';
import './styles/grid.css';
import './styles/montage.css';
import './styles/viewport.css';
import './styles/list.css';

import { store } from './state/store.js';
import { TagSidebar } from './components/tag-sidebar.js';
import { FilterBar } from './components/filter-bar.js';
import { renderMediaCard, attachMediaCardEvents, updateMediaCardSelections } from './components/media-card.js';
import { renderAggregateCard, attachAggregateCardEvents, updateAggregateCardSelections } from './components/aggregate-card.js';
import { DetailModal } from './components/detail-modal.js';
import { BatchTagBar } from './components/batch-tag-bar.js';
import { GenerationPanel } from './components/generation-panel.js';
import { PlaylistBar } from './components/playlist-bar.js';
import { TagCloudModal } from './components/tag-cloud-modal.js';
import { wsClient } from './api/websocket.js';

class App {
    constructor() {
        this.init();
    }

    async init() {
        // Setup base layout HTML
        document.querySelector('#app').innerHTML = `
          <!-- Sidebar -->
          <aside id="sidebar"></aside>

          <!-- Main Content Area -->
          <main id="main-area">
            <header id="header"></header>
            <div id="gallery-container">
              <div id="gallery-grid"></div>
              <div id="scroll-sentinel" style="height: 40px; display: flex; align-items: center; justify-content: center; margin-top: 20px;"></div>
            </div>
          </main>

          <!-- Modals & Panels -->
          <div id="detail-modal" style="display: none;"></div>
          <div id="batch-bar" style="display: none;"></div>
          <div id="generation-panel" style="display: none;"></div>
          <div id="tag-cloud-modal" style="display: none;"></div>
          <div id="playlist-bar"></div>
        `;

        // Initialize components
        this.sidebar = new TagSidebar(document.querySelector('#sidebar'));
        this.filterBar = new FilterBar(document.querySelector('#header'));
        this.detailModal = new DetailModal(document.querySelector('#detail-modal'));
        this.batchBar = new BatchTagBar(document.querySelector('#batch-bar'));
        this.generationPanel = new GenerationPanel(document.querySelector('#generation-panel'));
        this.tagCloudModal = new TagCloudModal(document.querySelector('#tag-cloud-modal'));
        this.playlistBar = new PlaylistBar(document.querySelector('#playlist-bar'));

        // Setup gallery rendering on state change
        this.galleryGrid = document.querySelector('#gallery-grid');
        this.sentinel = document.querySelector('#scroll-sentinel');

        store.subscribe((state, changed) => {
            if (changed && (changed.results || changed.viewMode || changed.isLoading !== undefined)) {
                this.renderGallery(state);
            } else if (changed && changed.selectedIds) {
                const selected = state.selectedIds || new Set();
                updateMediaCardSelections(this.galleryGrid, selected);
                updateAggregateCardSelections(this.galleryGrid, selected);
            }
            if (changed && changed.activeModalItem !== undefined) {
                if (state.viewMode === 'viewport' && state.activeModalItem) {
                    this.galleryGrid.querySelectorAll('video, audio').forEach(m => m.pause());
                } else if (state.viewMode === 'viewport' && !state.activeModalItem) {
                    if (this.viewportObserver) {
                        this.galleryGrid.querySelectorAll('.viewport-item').forEach(el => {
                            const rect = el.getBoundingClientRect();
                            if (rect.top >= -100 && rect.top <= window.innerHeight / 2) {
                                const m = el.querySelector('video, audio');
                                if (m && !store.get('playlist')?.isPlaying) m.play().catch(() => {});
                            }
                        });
                    }
                }
            }
        });

        // Setup IntersectionObserver for Infinite Scroll
        this.setupInfiniteScroll();
        this.setupGlobalNavigation();

        // Connect WebSocket for real-time updates
        wsClient.connect();
        wsClient.subscribe((msg) => {
            if (msg.type === 'job_progress') {
                store.loadJobs();
            } else if (msg.type === 'job_completed') {
                store.loadWorkflowsAndJobs();
            }
            if (msg.type === 'media_imported' || msg.type === 'ingest_complete') {
                store.loadBrowse(true);
                store.loadTags();
            }
        });

        // Initial Data Load
        await Promise.all([
            store.loadTags(),
            store.loadBrowse(true),
            store.loadWorkflowsAndJobs(),
            store.loadCatalogs()
        ]);
    }

    renderGallery(state) {
        const results = state.results || [];
        const viewMode = state.viewMode || 'grid';

        if (state.isLoading && results.length === 0) {
            this.galleryGrid.innerHTML = `
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 50vh; gap: 16px;">
                <div style="width: 40px; height: 40px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--accent-cyan); animation: spin 1s linear infinite;"></div>
                <span style="color: var(--text-secondary); font-size: 0.9rem;">Loading media library...</span>
              </div>
              <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
            `;
            return;
        }

        if (results.length === 0) {
            this.galleryGrid.innerHTML = `
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 50vh; gap: 12px; text-align: center;">
                <div style="font-size: 3.5rem;">📭</div>
                <h3 style="font-size: 1.2rem; color: #fff;">No media items found</h3>
                <p style="color: var(--text-secondary); max-width: 400px; font-size: 0.9rem;">
                  Try selecting a different tag filter, using a wildcard like <code style="color: var(--accent-cyan);">*.Clip</code>, or click <strong>📥 Import</strong> above to add files.
                </p>
              </div>
            `;
            return;
        }

        // Render based on View Mode
        if (viewMode === 'grid' || viewMode === 'list') {
            this.galleryGrid.className = `view-${viewMode}`;
            this.galleryGrid.innerHTML = results.map(r => {
                if (r.type === 'aggregate') return renderAggregateCard(r, viewMode);
                return renderMediaCard(r.media, viewMode);
            }).join('');
        } else if (viewMode === 'montage') {
            this.galleryGrid.className = 'view-montage';
            // JS Column Packing (per locked decision #1 / §6.1 browser compatibility)
            // Determine responsive number of columns based on viewport width
            const containerWidth = this.galleryGrid.clientWidth || window.innerWidth - 300;
            const numCols = Math.max(2, Math.floor(containerWidth / 280));
            const cols = Array.from({ length: numCols }, () => []);
            const colHeights = Array.from({ length: numCols }, () => 0);

            for (const r of results) {
                // Find shortest column
                let minColIdx = 0;
                let minHeight = colHeights[0];
                for (let i = 1; i < numCols; i++) {
                    if (colHeights[i] < minHeight) {
                        minHeight = colHeights[i];
                        minColIdx = i;
                    }
                }

                cols[minColIdx].push(r);
                // Estimate height contribution based on aspect ratio
                let aspect = 1.0;
                if (r.type === 'item' && r.media.width && r.media.height) {
                    aspect = r.media.height / r.media.width;
                }
                colHeights[minColIdx] += (280 * aspect) + 16;
            }

            this.galleryGrid.innerHTML = cols.map(colItems => `
              <div class="montage-col">
                ${colItems.map(r => {
                    if (r.type === 'aggregate') return renderAggregateCard(r, 'montage');
                    return renderMediaCard(r.media, 'montage');
                }).join('')}
              </div>
            `).join('');
        } else if (viewMode === 'viewport') {
            this.galleryGrid.className = 'view-viewport';
            this.galleryGrid.innerHTML = results.map(r => {
                if (r.type === 'aggregate') return renderAggregateCard(r, 'grid');
                const item = r.media;
                const isVideo = item.media_type === 'video';
                const isAudio = item.media_type === 'audio';
                const mediaUrl = `/api/media/${item.id}/file`;
                const tagPills = (item.tags || []).map(t => `<span class="tag-pill" data-filter="${t}">${t}</span>`).join('');

                return `
                  <div class="viewport-item" data-id="${item.id}">
                    ${isVideo ? `
                      <video class="viewport-media" src="${mediaUrl}" controls ${store.get('playlist')?.isPlaying ? '' : 'loop'} preload="metadata"></video>
                    ` : isAudio ? `
                      <div class="viewport-media" style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: radial-gradient(circle, #1f1c2c 0%, #928dab 100%); padding: 32px; width: 100%; height: 100%;">
                        <div style="font-size: 6rem; margin-bottom: 20px; animation: pulseGlow 2s infinite;">🎵</div>
                        <h3 style="color: #fff; font-size: 1.5rem; margin-bottom: 24px; text-align: center;">${item.filename}</h3>
                        <audio src="${mediaUrl}" controls ${store.get('playlist')?.isPlaying ? '' : 'loop'} preload="metadata" style="width: 80%; max-width: 500px;"></audio>
                      </div>
                    ` : `
                      <img class="viewport-media" src="${mediaUrl}" alt="${item.filename}" />
                    `}
                    <div class="viewport-overlay">
                      <div class="viewport-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <span class="badge" style="background: rgba(0,0,0,0.7); font-size: 0.8rem;">${item.media_type.toUpperCase()}</span>
                        <button class="btn-viewport-detail" data-id="${item.id}" title="Open Detail View"
                                style="background: rgba(0, 240, 255, 0.25); border: 1px solid var(--accent-cyan); color: #fff; border-radius: 6px; padding: 6px 14px; font-size: 0.85rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; backdrop-filter: blur(4px); transition: all 0.2s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">
                          🔍 Detail View
                        </button>
                      </div>
                      <div class="viewport-footer">
                        <h4 style="font-size: 1.1rem; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">${item.filename}</h4>
                        <div class="viewport-tags">${tagPills}</div>
                      </div>
                    </div>
                  </div>
                `;
            }).join('');
        }

        // Attach event listeners to cards
        attachMediaCardEvents(this.galleryGrid);
        attachAggregateCardEvents(this.galleryGrid);

        this.galleryGrid.querySelectorAll('.btn-viewport-detail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                const results = store.get('results') || [];
                const res = results.find(r => r.type === 'item' && r.media && r.media.id === id);
                if (res && res.media) {
                    store.set({ activeModalItem: res.media });
                } else {
                    const items = store.get('mediaItems') || [];
                    const item = items.find(i => i.id === id);
                    if (item) store.set({ activeModalItem: item });
                }
            });
        });

        // Manage Viewport Video Autoplay Observer
        if (this.viewportObserver) {
            this.viewportObserver.disconnect();
        }
        if (viewMode === 'viewport') {
            this.setupViewportVideoObserver();
        }

        // Update Sentinel status
        if (state.isLoading) {
            this.sentinel.innerHTML = '<span style="color: var(--text-secondary); font-size: 0.8rem;">Loading more...</span>';
        } else if (!state.hasMore && results.length > 0) {
            this.sentinel.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">• End of library •</span>';
        } else {
            this.sentinel.innerHTML = '';
        }
    }

    setupViewportVideoObserver() {
        this.viewportObserver = new IntersectionObserver((entries) => {
            const pl = store.get('playlist') || {};
            entries.forEach(entry => {
                const video = entry.target.querySelector('video');
                const audio = entry.target.querySelector('audio');
                const media = video || audio;
                if (!media || pl.isPlaying) return;
                if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && !store.get('activeModalItem')) {
                    media.play().catch(() => {});
                } else {
                    media.pause();
                }
            });
        }, { threshold: [0.5] });

        this.galleryGrid.querySelectorAll('.viewport-item').forEach(el => {
            this.viewportObserver.observe(el);
        });
    }

    setupGlobalNavigation() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (store.get('isTagCloudOpen')) {
                    e.preventDefault();
                    store.set({ isTagCloudOpen: false });
                    return;
                }
                if (store.get('isGenerationOpen')) {
                    e.preventDefault();
                    store.set({ isGenerationOpen: false });
                    return;
                }
                if (store.get('activeModalItem')) {
                    e.preventDefault();
                    store.set({ activeModalItem: null });
                    return;
                }
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                if (store.get('isGenerationOpen') && store.get('generationTab') === 'form') {
                    const submitBtn = document.querySelector('#btn-submit-job');
                    if (submitBtn && !submitBtn.disabled) {
                        e.preventDefault();
                        submitBtn.click();
                        return;
                    }
                }
            }

            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) {
                return;
            }

            const activeModalItem = store.get('activeModalItem');
            const viewMode = store.get('viewMode');

            // 1. If Modal is open: step adjacent media in modal
            if (activeModalItem) {
                if (['ArrowRight', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    this.detailModal.stepAdjacentMedia(1);
                } else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) {
                    e.preventDefault();
                    this.detailModal.stepAdjacentMedia(-1);
                }
                return;
            }

            // 2. If Viewport Feed is active: step viewport items
            if (viewMode === 'viewport') {
                if (['ArrowRight', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    this.stepViewportFeed(1);
                } else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) {
                    e.preventDefault();
                    this.stepViewportFeed(-1);
                }
            }
        });
    }

    stepViewportFeed(direction) {
        const items = Array.from(this.galleryGrid.querySelectorAll('.viewport-item'));
        if (items.length === 0) return;

        const containerRect = this.galleryGrid.getBoundingClientRect();
        const containerCenter = containerRect.top + containerRect.height / 2;

        let closestIdx = 0;
        let minDistance = Infinity;

        items.forEach((item, index) => {
            const rect = item.getBoundingClientRect();
            const center = rect.top + rect.height / 2;
            const dist = Math.abs(center - containerCenter);
            if (dist < minDistance) {
                minDistance = dist;
                closestIdx = index;
            }
        });

        const targetIdx = Math.min(Math.max(closestIdx + direction, 0), items.length - 1);
        if (targetIdx !== closestIdx) {
            items[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (targetIdx === items.length - 1 && direction > 0 && !store.get('isLoading') && store.get('hasMore')) {
            store.loadMore();
        }
    }

    setupInfiniteScroll() {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                store.loadMore();
            }
        }, { rootMargin: '200px' });

        if (this.sentinel) {
            observer.observe(this.sentinel);
        }
    }
}

new App();
