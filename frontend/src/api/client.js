const BASE_URL = '';

if (typeof window !== 'undefined') {
    window.__activeRequestCount = 0;
    window.__appExpectedCount = 0;

    window.addAppExpectedRequests = function(count = 1) {
        window.__appExpectedCount = Math.max(0, (window.__appExpectedCount || 0) + count);
        if (window.__updateOnlineBadge) window.__updateOnlineBadge();
    };
    window.removeAppExpectedRequests = function(count = 1) {
        window.__appExpectedCount = Math.max(0, (window.__appExpectedCount || 0) - count);
        if (window.__updateOnlineBadge) window.__updateOnlineBadge();
    };
    window.setAppExpectedRequests = function(count = 0) {
        window.__appExpectedCount = Math.max(0, count);
        if (window.__updateOnlineBadge) window.__updateOnlineBadge();
    };

    window.__updateOnlineBadge = function() {
        const indicator = document.getElementById('conn-status-indicator');
        if (!indicator) return;
        const firstSpan = indicator.querySelector('span:first-child');
        if (!firstSpan) return;
        if (indicator.textContent.includes('OFFLINE') && !indicator.style.color.includes('00ff88')) return;

        const appCount = window.__appExpectedCount || 0;
        const netCount = window.__activeRequestCount || 0;

        while (indicator.childNodes.length > 1) {
            indicator.removeChild(indicator.lastChild);
        }

        if (appCount > 0 || netCount > 0) {
            const container = document.createElement('div');
            container.style.cssText = "display: flex; align-items: center; gap: 4px; margin-left: 2px;";
            container.innerHTML = `
              <span style="color: #ffcc00; background: rgba(255, 204, 0, 0.15); border: 1px solid rgba(255, 204, 0, 0.4); padding: 0 5px; border-radius: 4px; font-weight: 800; font-family: monospace; font-size: 0.7rem;" title="Application Expected Operations / Batch Tasks">APP: ${appCount}</span>
              <span style="color: #00f0ff; background: rgba(0, 240, 255, 0.15); border: 1px solid rgba(0, 240, 255, 0.4); padding: 0 5px; border-radius: 4px; font-weight: 800; font-family: monospace; font-size: 0.7rem;" title="Active In-Flight HTTP Network Requests">NET: ${netCount}</span>
            `;
            indicator.appendChild(container);
            indicator.title = `Backend Server: Online (APP Expected: ${appCount}, NET Active: ${netCount})`;
        } else {
            const span = document.createElement('span');
            span.textContent = 'ONLINE';
            span.style.marginLeft = '2px';
            indicator.appendChild(span);
            indicator.title = 'Backend Server: Online & Responsive';
        }
    };

    if (!window.__toxikFetchWrapped) {
        window.__toxikFetchWrapped = true;
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
            window.__activeRequestCount = (window.__activeRequestCount || 0) + 1;
            window.__updateOnlineBadge();
            try {
                return await origFetch.apply(this, args);
            } finally {
                window.__activeRequestCount = Math.max(0, (window.__activeRequestCount || 1) - 1);
                window.__updateOnlineBadge();
            }
        };
    }
}

async function def_fetch(endpoint, options = {}) {
    if (typeof window !== 'undefined' && window.addAppExpectedRequests) window.addAppExpectedRequests(1);
    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        if (!response.ok) {
            if (response.status === 502 || response.status === 503 || response.status === 504) {
                if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('toxik-api-error', { detail: { status: response.status } }));
            }
            const err = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(err.detail || 'API Request failed');
        }
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('toxik-api-success'));
        return await response.json();
    } catch (error) {
        if (typeof window !== 'undefined' && (error.name === 'TypeError' || error.message?.toLowerCase().includes('fetch') || error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('failed'))) {
            window.dispatchEvent(new CustomEvent('toxik-api-error', { detail: { error } }));
        }
        console.error(`API Error on ${endpoint}:`, error);
        throw error;
    } finally {
        if (typeof window !== 'undefined' && window.removeAppExpectedRequests) window.removeAppExpectedRequests(1);
    }
}

export const api = {
    async browse({ filter = '', view = 'grid', page = 1, limit = 50, threshold = 1, mediaType = 'all', sortBy = 'creation_date', sortDir = 'desc' } = {}) {
        const params = new URLSearchParams({
            view,
            page: page.toString(),
            limit: limit.toString(),
            threshold: threshold.toString(),
            sort_by: sortBy,
            sort_dir: sortDir
        });
        if (filter && filter !== 'All') {
            params.append('filter', filter);
        }
        if (mediaType && mediaType !== 'all') {
            params.append('media_type', mediaType);
        }
        return def_fetch(`/api/browse?${params.toString()}`);
    },

    async getTags() {
        return def_fetch('/api/tags');
    },

    async createTag(full_tag) {
        return def_fetch('/api/tags', {
            method: 'POST',
            body: JSON.stringify({ full_tag })
        });
    },

    async renameTag(tagId, new_full_tag) {
        return def_fetch(`/api/tags/${tagId}`, {
            method: 'PUT',
            body: JSON.stringify({ new_full_tag })
        });
    },

    async deleteTag(tagId, reassignParent = true) {
        return def_fetch(`/api/tags/${tagId}?reassign_parent=${reassignParent}`, {
            method: 'DELETE'
        });
    },

    async importMedia(paths, tags = []) {
        return def_fetch('/api/media/import', {
            method: 'POST',
            body: JSON.stringify({ paths, tags })
        });
    },

    async getMedia(mediaId) {
        return def_fetch(`/api/media/${mediaId}`);
    },

    async rebuildThumbnail(mediaId) {
        console.log(`[Toxik API] Requesting thumbnail rebuild for media ID: ${mediaId}`);
        return def_fetch(`/thumbs/rebuild/${mediaId}`, { method: 'POST' });
    },

    async reingestBatch(mediaIds) {
        console.log(`[Toxik API] Requesting re-ingest for ${mediaIds.length} media IDs`);
        return def_fetch('/thumbs/reingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_ids: mediaIds })
        });
    },

    async extractVideoFrame(mediaId, mode) {
        console.log(`[Toxik API] Requesting frame extraction (${mode}) for media ID: ${mediaId}`);
        return def_fetch(`/api/media/${mediaId}/extract_frame?mode=${mode}`, { method: 'POST' });
    },

    async uploadToComfyUI(mediaId) {
        return def_fetch(`/api/media/${mediaId}/upload_comfyui`, { method: 'POST' });
    },

    async deleteMedia(mediaId, deleteFile = false) {
        return def_fetch(`/api/media/${mediaId}?delete_file=${deleteFile}`, {
            method: 'DELETE'
        });
    },

    async batchTag(mediaIds, { addTags = [], removeTags = [], replaceTags = null, clearAll = false } = {}) {
        return def_fetch('/api/media/batch/tags', {
            method: 'POST',
            body: JSON.stringify({
                media_ids: mediaIds,
                add_tags: addTags,
                remove_tags: removeTags,
                replace_tags: replaceTags,
                clear_all: clearAll
            })
        });
    },

    async getWorkflows() {
        return def_fetch('/api/workflows');
    },

    async submitJob(workflow_id, inputs, tags = []) {
        const enrichedInputs = {
            ...inputs,
            _upload_mode: localStorage.getItem('toxik_cfg_upload_mode') || 'no_upload',
            _path_mode: localStorage.getItem('toxik_cfg_path_mode') || 'full_path',
            _path_prefix: localStorage.getItem('toxik_cfg_path_prefix') || '',
            _output_prefix_path_mode: localStorage.getItem('toxik_cfg_output_prefix_path_mode') || 'full',
            _output_prefix_filename_mode: localStorage.getItem('toxik_cfg_output_prefix_filename_mode') || 'workflow_name',
            _output_prefix_filename_custom: localStorage.getItem('toxik_cfg_output_prefix_filename_custom') || '',
            _output_prefix_custom_prefix: localStorage.getItem('toxik_cfg_output_prefix_custom_prefix') || '',
            _output_prefix_custom_suffix: localStorage.getItem('toxik_cfg_output_prefix_custom_suffix') || ''
        };
        return def_fetch('/api/generate', {
            method: 'POST',
            body: JSON.stringify({ workflow_id, inputs: enrichedInputs, tags })
        });
    },

    async getJobs() {
        return def_fetch('/api/jobs');
    },

    async cancelJob(jobId) {
        return def_fetch(`/api/jobs/${jobId}/cancel`, {
            method: 'POST'
        });
    },

    async deleteJob(jobId) {
        return def_fetch(`/api/jobs/${jobId}`, {
            method: 'DELETE'
        });
    },

    async clearJobs() {
        return def_fetch('/api/jobs/clear', {
            method: 'DELETE'
        });
    },

    async unloadModels() {
        return def_fetch('/api/generate/unload', {
            method: 'POST'
        });
    },

    async getCatalogs() {
        return def_fetch('/api/catalogs');
    },

    async switchCatalog(name) {
        return def_fetch('/api/catalogs/switch', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
    },

    async deleteCatalog(name) {
        return def_fetch(`/api/catalogs/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
    },

    async getHealth() {
        return def_fetch('/api/health');
    }
};
