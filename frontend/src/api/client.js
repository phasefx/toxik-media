const BASE_URL = '';

async function def_fetch(endpoint, options = {}) {
    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(err.detail || 'API Request failed');
        }
        return await response.json();
    } catch (error) {
        console.error(`API Error on ${endpoint}:`, error);
        throw error;
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
        return def_fetch('/api/generate', {
            method: 'POST',
            body: JSON.stringify({ workflow_id, inputs, tags })
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
    }
};
