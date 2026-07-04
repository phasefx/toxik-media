import { store } from '../state/store.js';
import { api } from '../api/client.js';

export function renderMediaCard(item, viewMode = 'grid') {
    const isSelected = store.get('selectedIds').has(item.id);
    const isVideo = item.media_type === 'video';
    const isAudio = item.media_type === 'audio';

    let durationStr = '';
    if ((isVideo || isAudio) && item.duration_ms) {
        const totalSec = Math.floor(item.duration_ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = (totalSec % 60).toString().padStart(2, '0');
        durationStr = `${min}:${sec}`;
    }

    if (viewMode === 'list') {
        let sizeStr = '';
        if (item.file_size) {
            const bytes = item.file_size;
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            sizeStr = parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }
        const typeIcon = isVideo ? '🎬' : isAudio ? '🎵' : '📷';
        const tagPillsList = (item.tags || []).slice(0, 4).map(t => `
          <span class="tag-pill" data-filter="${t}" style="font-size: 0.7rem; padding: 2px 8px; background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 4px; color: #fff;">
            ${t}
          </span>
        `).join('');

        return `
          <div class="list-row media-card card ${isSelected ? 'selected' : ''}" data-id="${item.id}"
               style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.06); cursor: pointer; transition: background 0.15s ease;">
            <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1;">
              <div class="select-checkbox" data-id="${item.id}"
                   style="width: 20px; height: 20px; border-radius: 4px; background: ${isSelected ? 'var(--accent-cyan)' : 'rgba(0,0,0,0.4)'}; border: 1px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;">
                ${isSelected ? '<span style="color: #000; font-weight: 800; font-size: 0.75rem;">✓</span>' : ''}
              </div>
              <span style="font-size: 1.2rem; flex-shrink: 0;">${typeIcon}</span>
              <span style="font-size: 0.95rem; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 350px;" title="${item.filename}">${item.filename}</span>
              <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; overflow: hidden; max-height: 24px;">${tagPillsList}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 20px; flex-shrink: 0; margin-left: 16px; color: var(--text-secondary); font-size: 0.85rem;">
              <span>${item.width && item.height ? `${item.width} × ${item.height}` : durationStr}</span>
              <span style="width: 70px; text-align: right;">${sizeStr}</span>
              <button class="btn btn-secondary btn-icon" title="Copy Filepath"
                      onclick="event.stopPropagation(); navigator.clipboard.writeText('${item.filepath}').then(() => alert('Copied filepath to clipboard!'));"
                      style="padding: 4px 8px; font-size: 0.8rem;">📋</button>
            </div>
          </div>
        `;
    }

    const animThumbs = store.get('animThumbs', true) !== false;
    const cardClass = viewMode === 'montage' ? 'montage-card media-card' : 'card media-card';
    const imgClass = viewMode === 'montage' ? 'montage-img' : 'card-img';
    const thumbUrl = item.thumb_url || `/thumbs/${item.id}.webp`;

    let fnHash = 0;
    const fn = item.filename || '';
    for (let i = 0; i < fn.length; i++) {
        fnHash = ((fnHash << 5) - fnHash) + fn.charCodeAt(i);
        fnHash |= 0;
    }
    const hue = Math.abs(fnHash) % 360;
    const borderColor = `hsl(${hue}, 85%, 60%)`;
    const borderGlow = `hsla(${hue}, 85%, 60%, 0.3)`;

    // Relative sizing booster for montage if aspect ratio is wide/tall or file is prominent
    let sizeBoost = '';
    if (viewMode === 'montage' && ((item.width && item.width > 1500) || isVideo || isAudio)) {
        sizeBoost = 'size-lg';
    }

    const tagPills = (item.tags || []).slice(0, 3).map(t => `
      <span class="tag-pill" data-filter="${t}" style="font-size: 0.65rem; padding: 2px 8px;">
        ${t.split('.').pop()}
      </span>
    `).join('');

    return `
      <div class="${cardClass} ${isSelected ? 'selected' : ''} ${sizeBoost}"
           data-id="${item.id}"
           style="position: relative;">

        <!-- Media Preview -->
        ${isVideo ? `
          <div class="video-preview-container ${imgClass}" style="position: relative; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center;">
            <img class="thumb-preview" src="${thumbUrl.replace('.webp', '_static.webp')}" ${animThumbs ? `data-anim-src="${thumbUrl}"` : ''} alt="${item.filename}" loading="lazy"
                 onerror="if(this.src.includes('_static.webp')){this.src='${thumbUrl}';}else{this.onerror=null; this.src='/thumbs/${item.id}.webp';}"
                 style="width: 100%; height: 100%; object-fit: cover; display: block;" />
            <video class="video-preview" src="/api/media/${item.id}/file" muted loop playsinline preload="none"
                   style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; pointer-events: none; transition: opacity 0.25s ease; background: #000;"></video>
          </div>
        ` : isAudio ? `
          <div class="audio-preview-container ${imgClass}" style="position: relative; overflow: hidden; background: linear-gradient(135deg, #111 0%, #1a1a2e 100%); display: flex; align-items: center; justify-content: center; min-height: 180px; border: 3px solid ${borderColor}; box-shadow: inset 0 0 25px ${borderGlow}; box-sizing: border-box;">
            ${item.thumb_url ? `<img class="thumb-preview" src="${item.thumb_url}" alt="${item.filename}" loading="lazy" onerror="this.style.display='none';" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: brightness(0.6);" />` : ''}
            <div style="position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px; color: #fff; text-align: center; text-shadow: 0 2px 8px rgba(0,0,0,0.8); width: 100%;">
              <div style="font-size: 2.8rem; margin-bottom: 6px; animation: pulseGlow 2s infinite; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.8));">🎵</div>
              <div style="font-size: 0.85rem; font-weight: 600; word-break: break-all; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(0,0,0,0.5); padding: 2px 8px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.15);">${item.filename}</div>
            </div>
            <audio src="/api/media/${item.id}/file" preload="none" style="display: none;"></audio>
          </div>
        ` : `
          <div class="thumb-preview-wrapper ${imgClass}" style="position: relative; overflow: hidden; background: #141720; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 160px;">
            <img class="${imgClass}" src="${thumbUrl}" alt="${item.filename}" loading="lazy"
                 style="width: 100%; height: 100%; object-fit: cover; display: block;"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div class="no-preview-overlay" style="display: none; position: absolute; inset: 0; z-index: 2; flex-direction: column; align-items: center; justify-content: center; padding: 12px; color: #fff; text-align: center; background: linear-gradient(135deg, #141720 0%, #1f2333 100%); width: 100%; height: 100%; border: 4px solid ${borderColor}; box-shadow: inset 0 0 25px ${borderGlow}; box-sizing: border-box;">
              <div style="font-size: 2.8rem; margin-bottom: 8px; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.8));">${item.media_type === 'doc' ? '📄' : item.media_type === 'video' ? '🎬' : '🖼️'}</div>
              <div style="font-size: 0.75rem; font-weight: 600; color: #8e95b5; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">No Preview</div>
              <div style="font-size: 0.85rem; font-weight: 700; color: #fff; word-break: break-all; max-width: 90%; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); line-height: 1.3;">${item.filename}</div>
            </div>
          </div>
        `}

        <!-- Selection Checkbox / Indicator -->
        <div class="select-checkbox" data-select="${item.id}"
             style="position: absolute; top: 10px; left: 10px; width: 24px; height: 24px; border-radius: 6px; background: ${isSelected ? 'var(--accent-cyan)' : 'rgba(0,0,0,0.6)'}; border: 1px solid rgba(255,255,255,0.4); display: flex; align-items: center; justify-content: center; z-index: 4; cursor: pointer; transition: all 0.15s ease;">
          ${isSelected ? '<span style="color: #000; font-weight: 800; font-size: 0.85rem;">✓</span>' : ''}
        </div>

        <!-- Hover Copy Path Icon -->
        <button class="btn-copy-path hover-only-icon" data-path="${item.filepath}" title="Copy full path: ${item.filepath}"
                style="position: absolute; top: 10px; left: 40px; width: 24px; height: 24px; border-radius: 6px; background: rgba(0,0,0,0.75); border: 1px solid rgba(255,255,255,0.4); color: #fff; z-index: 4; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; transition: all 0.15s ease;">
          📋
        </button>

        <!-- Duration Badge for Video/Audio -->
        ${isVideo || isAudio ? `
          <div style="position: absolute; top: 10px; right: 10px; z-index: 3;">
            <span class="badge" style="background: ${isVideo ? 'rgba(255, 0, 127, 0.85)' : 'rgba(0, 240, 255, 0.85); color: #000;'}; font-size: 0.75rem;">
              ${isVideo ? '🎬' : '🎵'} ${durationStr || (isVideo ? 'Video' : 'Audio')}
            </span>
          </div>
        ` : ''}

        <!-- Card Overlay -->
        <div class="card-overlay">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 6px;">
            <span style="font-size: 0.8rem; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: ${isVideo ? '50%' : '75%'};">
              ${item.filename}
            </span>
            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
              <button class="btn-copy-path" data-path="${item.filepath}" title="Copy full path: ${item.filepath}"
                      style="background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.4); color: #fff; border-radius: 4px; padding: 1px 5px; font-size: 0.7rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;">
                📋
              </button>
              ${isVideo ? `
                <button class="btn-extract-frame" data-id="${item.id}" data-mode="first" title="Extract First Frame (F)" style="background: rgba(0, 229, 255, 0.25); border: 1px solid var(--accent-cyan); color: #fff; border-radius: 4px; padding: 1px 5px; font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: all 0.15s ease;">F</button>
                <button class="btn-extract-frame" data-id="${item.id}" data-mode="random" title="Extract Random Frame (R)" style="background: rgba(157, 0, 255, 0.25); border: 1px solid var(--accent-purple); color: #fff; border-radius: 4px; padding: 1px 5px; font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: all 0.15s ease;">R</button>
                <button class="btn-extract-frame" data-id="${item.id}" data-mode="last" title="Extract Last Frame (L)" style="background: rgba(255, 145, 0, 0.25); border: 1px solid #ff9100; color: #fff; border-radius: 4px; padding: 1px 5px; font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: all 0.15s ease;">L</button>
              ` : ''}
              <button class="btn-rebuild-thumb" data-id="${item.id}" title="Rebuild Thumbnail"
                      style="background: rgba(0, 240, 255, 0.2); border: 1px solid var(--accent-cyan); color: #fff; border-radius: 4px; padding: 2px 6px; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;">
                🔄
              </button>
            </div>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${tagPills}
            ${(item.tags || []).length > 3 ? `<span class="badge" style="font-size: 0.65rem;">+${item.tags.length - 3}</span>` : ''}
          </div>
        </div>
      </div>
    `;
}

export function attachMediaCardEvents(container) {
    container.querySelectorAll('.select-checkbox').forEach(box => {
        box.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = box.getAttribute('data-select');
            store.toggleSelect(id, e.shiftKey);
        });
    });

    container.querySelectorAll('.tag-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const filter = pill.getAttribute('data-filter');
            store.setFilter(filter);
        });
    });

    container.querySelectorAll('.btn-copy-path').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const path = btn.getAttribute('data-path');
            if (path) {
                try {
                    await navigator.clipboard.writeText(path);
                    const orig = btn.innerHTML;
                    btn.innerHTML = '✅';
                    btn.style.borderColor = '#00ff66';
                    setTimeout(() => {
                        btn.innerHTML = orig;
                        btn.style.borderColor = 'rgba(255, 255, 255, 0.4)';
                    }, 1500);
                } catch (err) {
                    const ta = document.createElement('textarea');
                    ta.value = path;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    const orig = btn.innerHTML;
                    btn.innerHTML = '✅';
                    setTimeout(() => btn.innerHTML = orig, 1500);
                }
            }
        });
    });

    container.querySelectorAll('.btn-rebuild-thumb').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            const originalText = btn.innerHTML;
            try {
                btn.innerHTML = '⏳';
                btn.disabled = true;
                const res = await api.rebuildThumbnail(id);
                btn.innerHTML = '✅';
                const card = btn.closest('.card, .montage-card');
                if (card && res.thumb_url) {
                    const img = card.querySelector('img');
                    if (img) img.src = res.thumb_url;
                    const vid = card.querySelector('video');
                    if (vid) vid.poster = res.thumb_url;
                }
                await store.loadBrowse(true);
                await store.loadTags();
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }, 1500);
            } catch (err) {
                console.error('[Toxik Thumb] Rebuild failed:', err);
                btn.innerHTML = '❌';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }, 1500);
            }
        });
    });

    container.querySelectorAll('.btn-extract-frame').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            const mode = btn.getAttribute('data-mode');
            const originalText = btn.innerHTML;
            try {
                btn.innerHTML = '⏳';
                btn.disabled = true;
                await api.extractVideoFrame(id, mode);
                btn.innerHTML = '✅';
                await store.loadBrowse(true);
                await store.loadTags();
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }, 1500);
            } catch (err) {
                console.error('[Toxik Frame Extraction] Failed:', err);
                btn.innerHTML = '❌';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }, 1500);
            }
        });
    });

    container.querySelectorAll('.video-preview-container').forEach(wrap => {
        const vid = wrap.querySelector('video');
        if (!vid) return;

        wrap.addEventListener('mouseenter', () => {
            wrap.dataset.hovered = 'true';
            vid.preload = 'metadata';
            const playPromise = vid.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    if (wrap.dataset.hovered === 'true') {
                        vid.style.opacity = '1';
                    } else {
                        vid.pause();
                        vid.currentTime = 0;
                        vid.style.opacity = '0';
                    }
                }).catch(() => {});
            }
        });

        wrap.addEventListener('mouseleave', () => {
            wrap.dataset.hovered = 'false';
            vid.pause();
            vid.currentTime = 0;
            vid.style.opacity = '0';
        });
    });

    container.querySelectorAll('.card, .montage-card').forEach(card => {
        if (card.classList.contains('card-aggregate')) return;
        card.addEventListener('click', async (e) => {
            if (e.target.closest('.select-checkbox') || e.target.closest('.tag-pill') || e.target.closest('.btn-rebuild-thumb') || e.target.closest('.btn-copy-path') || e.target.closest('.btn-extract-frame')) return;
            const id = card.getAttribute('data-id');
            if (e.shiftKey || e.metaKey || e.ctrlKey || store.get('isMultiSelect')) {
                store.toggleSelect(id, e.shiftKey);
                return;
            }
            try {
                const item = await api.getMedia(id);
                if (item) {
                    store.set({ activeModalItem: item });
                }
            } catch (err) {
                console.error('Failed to open media detail:', err);
            }
        });
    });
}

export function updateMediaCardSelections(container, selectedIds = new Set()) {
    container.querySelectorAll('.card, .montage-card, .media-card').forEach(card => {
        if (card.classList.contains('card-aggregate')) return;
        const id = card.getAttribute('data-id');
        if (!id) return;
        const isSelected = selectedIds.has(id);
        const cb = card.querySelector('.select-checkbox');

        if (isSelected) {
            card.classList.add('selected');
            if (cb) {
                cb.style.background = 'var(--accent-cyan)';
                cb.innerHTML = '<span style="color: #000; font-weight: 800; font-size: 0.85rem;">✓</span>';
            }
        } else {
            card.classList.remove('selected');
            if (cb) {
                cb.style.background = 'rgba(0,0,0,0.6)';
                cb.innerHTML = '';
            }
        }
    });
}
