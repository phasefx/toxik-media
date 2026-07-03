import { api } from '../api/client.js';

class Store extends EventTarget {
    constructor() {
        super();
        this.state = {
            viewMode: 'grid', // 'grid' | 'montage' | 'viewport'
            activeFilter: '', // empty means All
            tags: [],
            results: [],
            page: 1,
            limit: 50,
            totalItems: 0,
            totalLibraryItems: 0,
            hasMore: false,
            isLoading: false,
            selectedIds: new Set(),
            isMultiSelect: false,
            activeModalItem: null,
            isGenerationOpen: false,
            generationTab: 'form', // 'form' | 'queue'
            stickyTab: 'form',
            entryMode: 'ALL',
            workflows: [],
            jobs: [],
            threshold: 1, // Aggregate card threshold
            multiFilterMode: 'AND',
            mediaType: 'all', // 'all' | 'image' | 'video'
            lastSelectedId: null,
            theme: 'dark',
            sortBy: 'creation_date',
            sortDir: 'desc',
            isTagCloudOpen: false,
            isSidebarCollapsed: false,
            catalogs: [],
            activeCatalog: '',
            isConnected: true,
            orphanMode: (typeof localStorage !== 'undefined' && localStorage.getItem('toxik_orphan_mode')) || 'exclude'
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('toxik-api-success', () => this.setConnectionStatus(true));
            window.addEventListener('toxik-api-error', () => this.setConnectionStatus(false));
            window.addEventListener('offline', () => this.setConnectionStatus(false));
            window.addEventListener('online', () => this.checkConnection());
            this.startHealthPoll();
        }
    }

    get(key) {
        return this.state[key];
    }

    set(partial) {
        Object.assign(this.state, partial);
        this.dispatchEvent(new CustomEvent('change', { detail: partial }));
    }

    subscribe(callback) {
        const handler = (e) => callback(this.state, e.detail);
        this.addEventListener('change', handler);
        return () => this.removeEventListener('change', handler);
    }

    getEffectiveFilter() {
        let f = (this.state.activeFilter || '').trim();
        if (f === 'All') f = '';
        if (!f.toLowerCase().includes('orphan')) {
            const mode = this.state.orphanMode || 'exclude';
            if (mode === 'exclude') f = (f + ' -orphan').trim();
            else if (mode === 'include') f = (f + ' +orphan').trim();
            else if (mode === 'neutral') f = (f + ' ~orphan').trim();
        }
        return f;
    }

    getBreadcrumb() {
        if (!this.state.activeFilter || this.state.activeFilter === 'All') {
            return ['All'];
        }
        if (this.state.activeFilter.includes('*')) {
            return ['All', this.state.activeFilter];
        }
        return ['All', ...this.state.activeFilter.split('.')];
    }

    async loadTags() {
        try {
            const tags = await api.getTags();
            this.set({ tags });
        } catch (e) {
            console.error('Failed to load tags:', e);
        }
    }

    async setFilter(filter) {
        if (filter === 'All') filter = '';
        this.set({ activeFilter: filter, page: 1, results: [], hasMore: false, selectedIds: new Set(), lastSelectedId: null });
        await this.loadBrowse(true);
    }

    async setMediaType(mediaType) {
        this.set({ mediaType, page: 1, results: [], hasMore: false, selectedIds: new Set(), lastSelectedId: null });
        await this.loadBrowse(true);
    }

    async setViewMode(viewMode) {
        this.set({ viewMode });
        // If switching view mode, trigger a re-render
    }

    async loadBrowse(reset = false) {
        if (this.state.isLoading) return;
        if (reset) {
            const pl = this.state.playlist;
            if (pl && pl.isPlaying) {
                this.set({ playlist: { ...pl, isPlaying: false } });
            }
        }
        this.set({ isLoading: true });

        try {
            const currentPage = reset ? 1 : this.state.page;
            const res = await api.browse({
                filter: this.getEffectiveFilter(),
                view: this.state.viewMode,
                page: currentPage,
                limit: this.state.limit,
                threshold: this.state.threshold,
                mediaType: this.state.mediaType,
                sortBy: this.state.sortBy || 'creation_date',
                sortDir: this.state.sortDir || 'desc'
            });

            const newResults = reset ? res.results : [...this.state.results, ...res.results];
            const sortedResults = this.sortResults(newResults);
            const hasMore = sortedResults.length < res.total_items;

            this.set({
                results: sortedResults,
                page: currentPage,
                totalItems: res.total_items,
                totalLibraryItems: res.total_library_items !== undefined ? res.total_library_items : this.state.totalLibraryItems,
                hasMore,
                isLoading: false
            });
        } catch (e) {
            console.error('Failed to load browse results:', e);
            this.set({ isLoading: false });
        }
    }

    async loadMore() {
        if (!this.state.hasMore || this.state.isLoading) return;
        this.set({ page: this.state.page + 1 });
        await this.loadBrowse(false);
    }

    sortResults(results) {
        if (!results || !results.length) return results;
        const sortBy = this.state.sortBy || 'creation_date';
        const sortDir = this.state.sortDir || 'desc';
        const aggs = results.filter(r => r.type === 'aggregate');
        const items = results.filter(r => r.type === 'item');

        if (sortBy === 'random') {
            items.sort(() => Math.random() - 0.5);
        } else {
            const mul = sortDir === 'asc' ? 1 : -1;
            items.sort((a, b) => {
                const ma = a.media || {};
                const mb = b.media || {};
                if (sortBy === 'asciibetical') return mul * (ma.filename || '').localeCompare(mb.filename || '');
                if (sortBy === 'creation_date') return mul * (ma.created_at || '').localeCompare(mb.created_at || '');
                if (sortBy === 'modification_date') return mul * (ma.modified_at || ma.created_at || '').localeCompare(mb.modified_at || mb.created_at || '');
                if (sortBy === 'file_size') return mul * ((ma.file_size || 0) - (mb.file_size || 0));
                if (sortBy === 'pixel_count') return mul * (((ma.width || 0) * (ma.height || 0)) - ((mb.width || 0) * (mb.height || 0)));
                if (sortBy === 'duration') return mul * ((ma.duration_ms || 0) - (mb.duration_ms || 0));
                if (sortBy === 'tag_count') return mul * (((ma.tags || []).length) - ((mb.tags || []).length));
                return 0;
            });
        }
        return [...aggs, ...items];
    }

    toggleSelect(mediaId, isShiftKey = false) {
        const selected = new Set(this.state.selectedIds);

        if (isShiftKey && this.state.lastSelectedId && this.state.lastSelectedId !== mediaId) {
            const ids = this.state.results
                .map(r => r.type === 'item' ? r.media.id : (r.representative ? r.representative.id : null))
                .filter(Boolean);
            const startIdx = ids.indexOf(this.state.lastSelectedId);
            const endIdx = ids.indexOf(mediaId);

            if (startIdx !== -1 && endIdx !== -1) {
                const minIdx = Math.min(startIdx, endIdx);
                const maxIdx = Math.max(startIdx, endIdx);
                for (let i = minIdx; i <= maxIdx; i++) {
                    selected.add(ids[i]);
                }
            } else {
                selected.add(mediaId);
            }
        } else {
            if (selected.has(mediaId)) {
                selected.delete(mediaId);
            } else {
                selected.add(mediaId);
            }
        }

        this.set({
            selectedIds: selected,
            isMultiSelect: selected.size > 0,
            lastSelectedId: selected.has(mediaId) ? mediaId : null
        });
    }

    toggleGroupSelect(ids = []) {
        if (!ids || ids.length === 0) return;
        const selected = new Set(this.state.selectedIds);
        const allSelected = ids.every(id => selected.has(id));

        if (allSelected) {
            ids.forEach(id => selected.delete(id));
        } else {
            ids.forEach(id => selected.add(id));
        }

        this.set({
            selectedIds: selected,
            isMultiSelect: selected.size > 0,
            lastSelectedId: ids[ids.length - 1] || null
        });
    }

    clearSelection() {
        this.set({ selectedIds: new Set(), isMultiSelect: false, lastSelectedId: null });
    }

    selectAll() {
        const ids = [];
        (this.state.results || []).forEach(r => {
            if (r.type === 'item' && r.media && r.media.id) {
                ids.push(r.media.id);
            } else if (r.type === 'aggregate' && r.item_ids) {
                ids.push(...r.item_ids);
            }
        });
        const selected = new Set(ids);
        this.set({
            selectedIds: selected,
            isMultiSelect: selected.size > 0,
            lastSelectedId: ids[ids.length - 1] || null
        });
    }

    async loadWorkflowsAndJobs() {
        try {
            const [workflows, jobs] = await Promise.all([
                api.getWorkflows(),
                api.getJobs()
            ]);
            this.set({ workflows, jobs });
        } catch (e) {
            console.error('Failed to load workflows/jobs:', e);
        }
    }

    async loadJobs() {
        try {
            const jobs = await api.getJobs();
            this.set({ jobs });
        } catch (e) {
            console.error('Failed to load jobs:', e);
        }
    }

    async loadCatalogs() {
        try {
            const catalogs = await api.getCatalogs();
            const active = catalogs.find(c => c.active);
            this.set({
                catalogs,
                activeCatalog: active ? active.name : (catalogs[0] ? catalogs[0].name : 'toxik.db')
            });
        } catch (e) {
            console.error('Failed to load catalogs:', e);
        }
    }

    async switchCatalog(name) {
        try {
            this.set({ isLoading: true });
            const res = await api.switchCatalog(name);
            this.set({
                activeCatalog: res.active_catalog,
                activeFilter: '',
                page: 1,
                results: [],
                selectedIds: new Set(),
                lastSelectedId: null
            });
            await Promise.all([
                this.loadTags(),
                this.loadBrowse(true),
                this.loadWorkflowsAndJobs(),
                this.loadCatalogs()
            ]);
            this.set({ isLoading: false });
        } catch (e) {
            console.error('Failed to switch catalog:', e);
            alert(`Failed to switch catalog: ${e.message || e}`);
            this.set({ isLoading: false });
        }
    }

    setConnectionStatus(status) {
        if (this.state.isConnected !== status) {
            this.set({ isConnected: status });
        }
    }

    async checkConnection() {
        try {
            await api.getHealth();
            this.setConnectionStatus(true);
            return true;
        } catch (e) {
            this.setConnectionStatus(false);
            return false;
        }
    }

    startHealthPoll() {
        if (this.healthInterval) clearInterval(this.healthInterval);
        this.checkConnection();
        this.healthInterval = setInterval(() => {
            this.checkConnection();
        }, 5000);
    }
}

export const store = new Store();
