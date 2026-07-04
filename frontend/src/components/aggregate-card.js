import { store } from '../state/store.js';

const aggregateGroupIds = new Map();

export function renderAggregateCard(item, viewMode = 'grid') {
    aggregateGroupIds.set(item.full_filter, item.item_ids || []);

    const selectedIds = store.get('selectedIds');
    const groupIds = item.item_ids || [];
    const selectedCount = groupIds.filter(id => selectedIds.has(id)).length;
    const isAllSelected = groupIds.length > 0 && selectedCount === groupIds.length;
    const isPartiallySelected = selectedCount > 0 && selectedCount < groupIds.length;
    const isSelected = isAllSelected || isPartiallySelected;

    if (viewMode === 'list') {
        return `
          <div class="list-row media-card card-aggregate ${isSelected ? 'selected' : ''}" data-filter="${item.full_filter}"
               style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: background 0.15s ease;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="aggregate-select-checkbox" data-group-filter="${item.full_filter}"
                   style="width: 22px; height: 22px; border-radius: 4px; background: ${isAllSelected ? 'var(--accent-cyan)' : (isPartiallySelected ? 'rgba(0, 240, 255, 0.4)' : 'rgba(0,0,0,0.4)')}; border: 1px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; cursor: pointer;">
                ${isAllSelected ? '<span style="color: #000; font-weight: 800; font-size: 0.8rem;">✓</span>' : (isPartiallySelected ? '<span style="color: #fff; font-weight: 800; font-size: 0.7rem;">─</span>' : '')}
              </div>
              <span style="font-size: 1.3rem;">📁</span>
              <div>
                <span style="font-size: 0.75rem; color: var(--accent-cyan); font-weight: 700; text-transform: uppercase; margin-right: 8px;">Tag Group</span>
                <span style="font-size: 1.05rem; font-weight: 700; color: #fff;">${item.label}</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 16px;">
              <span class="badge" style="background: rgba(0, 240, 255, 0.15); color: var(--accent-cyan); border: 1px solid rgba(0, 240, 255, 0.3);">🗂 ${item.count} items</span>
              <span style="color: var(--text-secondary); font-weight: 800;">➔</span>
            </div>
          </div>
        `;
    }

    const cardClass = viewMode === 'montage' ? 'montage-card media-card card-aggregate' : 'card media-card card-aggregate';
    const imgClass = viewMode === 'montage' ? 'montage-img' : 'card-img';
    const rep = item.representative;
    const thumbUrl = rep ? (rep.thumb_url || `/thumbs/${rep.id}.webp`) : '';

    return `
      <div class="${cardClass} ${isSelected ? 'selected' : ''}" data-filter="${item.full_filter}" style="position: relative; cursor: pointer;">

        <!-- Representative Thumbnail -->
        ${thumbUrl ? `
          <img class="${imgClass}" src="${thumbUrl}" alt="${item.label}" loading="lazy" style="opacity: 0.65; filter: contrast(1.1) saturate(1.2);" />
        ` : `
          <div style="width: 100%; aspect-ratio: 1/1; background: linear-gradient(135deg, #1c1025, #080c14); display: flex; align-items: center; justify-content: center; font-size: 3rem;">
            📁
          </div>
        `}

        <!-- Group Selection Checkbox Top Left -->
        <div class="aggregate-select-checkbox" data-group-filter="${item.full_filter}"
             style="position: absolute; top: 10px; left: 10px; width: 26px; height: 26px; border-radius: 6px; background: ${isAllSelected ? 'var(--accent-cyan)' : (isPartiallySelected ? 'rgba(0, 240, 255, 0.4)' : 'rgba(0,0,0,0.6)')}; border: 1px solid rgba(255,255,255,0.4); display: flex; align-items: center; justify-content: center; z-index: 4; cursor: pointer; transition: all 0.15s ease;"
             title="Select all ${groupIds.length} items in group">
          ${isAllSelected ? '<span style="color: #000; font-weight: 800; font-size: 0.85rem;">✓</span>' : (isPartiallySelected ? '<span style="color: #fff; font-weight: 800; font-size: 0.75rem;">─</span>' : '')}
        </div>

        <!-- Stacked Card Effect Badge Top Right -->
        <div style="position: absolute; top: 12px; right: 12px; z-index: 3;">
            <span class="aggregate-count" style="padding: 4px 10px; font-size: 0.8rem; box-shadow: 0 2px 8px rgba(0,0,0,0.8);">
            🗂 ${item.count} items
          </span>
        </div>

        <!-- Overlay with Label and Drill-Down Arrow -->
        <div class="card-overlay" style="opacity: 1; justify-content: flex-end;">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent-cyan); font-weight: 700;">
                Tag Group
              </span>
              <span class="aggregate-label" style="font-size: 1.25rem; font-weight: 800; color: #fff;">
                ${item.label}
              </span>
            </div>
            <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--accent-gradient); display: flex; align-items: center; justify-content: center; font-weight: 800; color: #fff; box-shadow: 0 0 12px rgba(0, 240, 255, 0.4);">
              ➔
            </div>
          </div>
        </div>
      </div>
    `;
}

export function attachAggregateCardEvents(container) {
    container.querySelectorAll('.aggregate-select-checkbox').forEach(box => {
        box.addEventListener('click', (e) => {
            e.stopPropagation();
            const filter = box.getAttribute('data-group-filter');
            const groupIds = aggregateGroupIds.get(filter) || [];
            store.toggleGroupSelect(groupIds);
        });
    });

    container.querySelectorAll('.card-aggregate').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.aggregate-select-checkbox')) return;
            e.stopPropagation();
            const filter = card.getAttribute('data-filter');
            store.setFilter(filter);
        });
    });
}

export function updateAggregateCardSelections(container, selectedIds = new Set()) {
    container.querySelectorAll('.card-aggregate').forEach(card => {
        const filter = card.getAttribute('data-filter') || card.getAttribute('data-group-filter');
        if (!filter) return;
        const groupIds = aggregateGroupIds.get(filter) || [];
        const selectedCount = groupIds.filter(id => selectedIds.has(id)).length;
        const isAllSelected = groupIds.length > 0 && selectedCount === groupIds.length;
        const isPartiallySelected = selectedCount > 0 && selectedCount < groupIds.length;
        const isSelected = isAllSelected || isPartiallySelected;

        if (isSelected) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }

        const box = card.querySelector('.aggregate-select-checkbox');
        if (box) {
            box.style.background = isAllSelected ? 'var(--accent-cyan)' : (isPartiallySelected ? 'rgba(0, 240, 255, 0.4)' : 'rgba(0,0,0,0.6)');
            box.innerHTML = isAllSelected ? '<span style="color: #000; font-weight: 800; font-size: 0.85rem;">✓</span>' : (isPartiallySelected ? '<span style="color: #fff; font-weight: 800; font-size: 0.75rem;">─</span>' : '');
        }
    });
}
