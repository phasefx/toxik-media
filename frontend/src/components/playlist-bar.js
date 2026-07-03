import { store } from '../state/store.js';

export class PlaylistBar {
    constructor(container) {
        this.container = container;
        this.timer = null;
        this.currentMediaElement = null;
        this.init();
    }

    init() {
        store.set({
            playlist: {
                isPlaying: false,
                isShuffle: false,
                loopMode: 'set', // 'set' | 'one' | 'none'
                currentIndex: 0,
                activeId: null
            }
        });

        store.subscribe((state, changed) => {
            if (changed) {
                if (!state.playlist?.isPlaying) {
                    this.stopPlayback();
                }
                if (changed.activeFilter !== undefined || changed.viewMode !== undefined) {
                    this.stopPlayback();
                    const pl = store.get('playlist') || {};
                    if (pl.isPlaying) {
                        store.set({ playlist: { ...pl, isPlaying: false, currentIndex: 0, activeId: null } });
                    }
                }
                if (changed.playlist || changed.results || changed.viewMode || changed.activeFilter !== undefined || changed.selectedIds || changed.isMultiSelect !== undefined) {
                    this.render();
                }
            } else {
                this.render();
            }
        });

        this.render();
    }

    getVisibleItems() {
        const ids = [];
        const grid = document.querySelector('#gallery-grid');
        if (!grid) return [];

        grid.querySelectorAll('[data-id], [data-group]').forEach(el => {
            const id = el.getAttribute('data-id') || el.getAttribute('data-group');
            if (id && !ids.includes(id)) {
                ids.push(id);
            }
        });
        return ids;
    }

    togglePlay() {
        const pl = store.get('playlist') || {};
        const items = this.getVisibleItems();
        if (items.length === 0) return;

        if (pl.isPlaying) {
            this.stopPlayback();
            store.set({ playlist: { ...pl, isPlaying: false } });
        } else {
            document.querySelectorAll('video, audio').forEach(m => {
                m.loop = false;
                m.removeAttribute('loop');
            });
            let nextIndex = pl.currentIndex || 0;
            if (nextIndex >= items.length || nextIndex < 0) nextIndex = 0;
            store.set({ playlist: { ...pl, isPlaying: true, currentIndex: nextIndex, activeId: items[nextIndex] } });
            this.startPlayback(items[nextIndex]);
        }
    }

    stopPlayback() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.currentMediaElement) {
            this.currentMediaElement.loop = true;
            this.currentMediaElement.pause();
            this.currentMediaElement.onended = null;
            this.currentMediaElement = null;
        }
        document.querySelectorAll('.playing-highlight').forEach(el => el.classList.remove('playing-highlight'));
    }

    step(direction = 1) {
        const activeFS = document.fullscreenElement;
        const oldVideo = this.currentMediaElement;
        const wasVideoFS = !!(
            (activeFS && activeFS.tagName && activeFS.tagName.toLowerCase() === 'video') ||
            (oldVideo && oldVideo.tagName && oldVideo.tagName.toLowerCase() === 'video' && (activeFS === oldVideo || oldVideo === document.webkitFullscreenElement || oldVideo.webkitDisplayingFullscreen || (oldVideo.matches && oldVideo.matches(':fullscreen'))))
        );
        this.wasVideoFS = wasVideoFS;
        this.stopPlayback();

        const pl = store.get('playlist') || {};
        const items = this.getVisibleItems();
        if (items.length === 0) return;

        let nextIdx;
        if (pl.loopMode === 'one' && direction > 0) {
            nextIdx = pl.currentIndex;
        } else if (pl.isShuffle) {
            nextIdx = Math.floor(Math.random() * items.length);
        } else {
            nextIdx = (pl.currentIndex || 0) + direction;
            if (nextIdx >= items.length) {
                if (pl.loopMode === 'set') {
                    nextIdx = 0;
                } else {
                    store.set({ playlist: { ...pl, isPlaying: false } });
                    return;
                }
            } else if (nextIdx < 0) {
                nextIdx = items.length - 1;
            }
        }

        store.set({
            playlist: {
                ...pl,
                currentIndex: nextIdx,
                activeId: items[nextIdx],
                isPlaying: true
            }
        });
        this.startPlayback(items[nextIdx]);
    }

    startPlayback(id) {
        this.stopPlayback();
        if (!id) return;

        const el = document.querySelector(`[data-id="${id}"]`) || document.querySelector(`[data-group="${id}"]`);
        if (!el) return;

        // Highlight and auto-scroll
        el.classList.add('playing-highlight');
        const isViewport = store.get('viewMode') === 'viewport';
        el.scrollIntoView({ behavior: isViewport ? 'instant' : 'smooth', block: isViewport ? 'start' : 'center' });

        // Check if there is audio or video inside this element
        const video = el.querySelector('video');
        const audio = el.querySelector('audio');

        if (video) {
            this.currentMediaElement = video;
            video.loop = false;
            video.removeAttribute('loop');
            video.currentTime = 0;
            video.muted = false;
            video.play().catch(() => {});
            if (this.wasVideoFS) {
                if (video.requestFullscreen) {
                    video.requestFullscreen().catch(() => {
                        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                    });
                } else if (video.webkitEnterFullscreen) {
                    video.webkitEnterFullscreen();
                }
                this.wasVideoFS = false;
            }
            video.onended = () => {
                this.step(1);
            };
        } else if (audio) {
            this.currentMediaElement = audio;
            audio.loop = false;
            audio.removeAttribute('loop');
            audio.currentTime = 0;
            audio.play().catch(() => {});
            if (this.wasVideoFS && document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
                this.wasVideoFS = false;
            }
            audio.onended = () => {
                this.step(1);
            };
        } else {
            if (this.wasVideoFS && document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
                this.wasVideoFS = false;
            }
            // Image or group card without media: play as slideshow for 4 seconds
            this.timer = setTimeout(() => {
                this.step(1);
            }, 4000);
        }
    }

    toggleShuffle() {
        const pl = store.get('playlist') || {};
        store.set({ playlist: { ...pl, isShuffle: !pl.isShuffle } });
    }

    toggleLoopMode() {
        const pl = store.get('playlist') || {};
        const modes = ['set', 'one', 'none'];
        const nextMode = modes[(modes.indexOf(pl.loopMode) + 1) % modes.length];
        store.set({ playlist: { ...pl, loopMode: nextMode } });
    }

    downloadPlaylist() {
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
    }

    render() {
        const isMultiSelect = store.get('isMultiSelect');
        const selectedIds = store.get('selectedIds') || new Set();
        if (isMultiSelect && selectedIds.size > 0) {
            this.container.style.display = 'none';
            return;
        } else {
            this.container.style.display = '';
        }

        const pl = store.get('playlist') || {};
        const items = this.getVisibleItems();
        const total = items.length;
        const currentNum = total > 0 ? (pl.currentIndex || 0) + 1 : 0;

        let loopLabel = '🔁 Loop Set';
        if (pl.loopMode === 'one') loopLabel = '🔂 Loop One';
        if (pl.loopMode === 'none') loopLabel = '➡ No Loop';

        this.container.innerHTML = `
          <div class="glass" style="position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 90; display: flex; align-items: center; gap: 12px; padding: 10px 20px; border-radius: var(--radius-full); border: 1px solid rgba(0, 240, 255, 0.4); box-shadow: 0 10px 30px rgba(0,0,0,0.8); background: rgba(15, 18, 25, 0.9); backdrop-filter: blur(15px); transition: all 0.3s ease;">

            <button id="pl-prev" class="btn btn-icon" title="Previous Item" style="width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border-color); background: transparent; color: #fff; font-size: 1rem; cursor: pointer;">⏮</button>

            <button id="pl-play" class="btn btn-icon" title="${pl.isPlaying ? 'Pause' : 'Play View Playlist'}" style="width: 44px; height: 44px; border-radius: 50%; border: none; background: var(--accent-gradient); color: #fff; font-size: 1.2rem; cursor: pointer; box-shadow: 0 0 15px rgba(0, 240, 255, 0.4); display: flex; align-items: center; justify-content: center;">
              ${pl.isPlaying ? '⏸' : '▶'}
            </button>

            <button id="pl-next" class="btn btn-icon" title="Next Item" style="width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border-color); background: transparent; color: #fff; font-size: 1rem; cursor: pointer;">⏭</button>

            <div style="height: 24px; width: 1px; background: var(--border-color); margin: 0 4px;"></div>

            <button id="pl-shuffle" class="btn" title="Toggle Shuffle Mode" style="height: 34px; padding: 0 12px; border-radius: 16px; background: ${pl.isShuffle ? 'rgba(0, 240, 255, 0.2)' : 'transparent'}; border: 1px solid ${pl.isShuffle ? 'var(--accent-cyan)' : 'var(--border-color)'}; color: ${pl.isShuffle ? '#fff' : 'var(--text-secondary)'}; font-size: 0.8rem; cursor: pointer;">
              🔀 ${pl.isShuffle ? 'Shuffle: On' : 'Shuffle'}
            </button>

            <button id="pl-loop" class="btn" title="Change Loop Mode" style="height: 34px; padding: 0 12px; border-radius: 16px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); color: var(--text-primary); font-size: 0.8rem; cursor: pointer;">
              ${loopLabel}
            </button>

            <button id="pl-fullscreen" class="btn" title="Toggle Fullscreen Mode" style="height: 34px; padding: 0 12px; border-radius: 16px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); color: var(--text-primary); font-size: 0.8rem; cursor: pointer;">
              🖥️ Fullscreen
            </button>

            <button id="pl-download" class="btn" title="Download VLC Playlist (.m3u8)" style="height: 34px; padding: 0 12px; border-radius: 16px; background: rgba(0, 240, 255, 0.15); border: 1px solid var(--accent-cyan); color: #fff; font-size: 0.8rem; cursor: pointer; font-weight: 600;">
              ⬇️ Playlist
            </button>

            <div style="height: 24px; width: 1px; background: var(--border-color); margin: 0 4px;"></div>

            <div style="display: flex; flex-direction: column; justify-content: center; font-size: 0.75rem; color: var(--text-secondary); min-width: 120px; max-width: 200px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
              <span style="color: #fff; font-weight: 600; overflow: hidden; text-overflow: ellipsis;">
                ${pl.isPlaying ? `▶ Playing (${currentNum}/${total})` : `Ready (${total} items)`}
              </span>
              <span style="font-size: 0.7rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis;">
                ${pl.activeId ? `Item: ${pl.activeId}` : 'Click Play to start'}
              </span>
            </div>

          </div>
        `;

        this.attachEvents();
    }

    attachEvents() {
        const prev = this.container.querySelector('#pl-prev');
        const play = this.container.querySelector('#pl-play');
        const next = this.container.querySelector('#pl-next');
        const shuffle = this.container.querySelector('#pl-shuffle');
        const loop = this.container.querySelector('#pl-loop');
        const fs = this.container.querySelector('#pl-fullscreen');
        const dl = this.container.querySelector('#pl-download');

        if (prev) prev.addEventListener('click', () => this.step(-1));
        if (play) play.addEventListener('click', () => this.togglePlay());
        if (next) next.addEventListener('click', () => this.step(1));
        if (shuffle) shuffle.addEventListener('click', () => this.toggleShuffle());
        if (loop) loop.addEventListener('click', () => this.toggleLoopMode());
        if (dl) dl.addEventListener('click', () => this.downloadPlaylist());
        if (fs) {
            fs.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(err => console.error(err));
                } else {
                    document.exitFullscreen().catch(err => console.error(err));
                }
            });
        }
    }
}
