import { store } from '../state/store.js';
import { api } from '../api/client.js';

export class GenerationPanel {
    constructor(container) {
        this.container = container;
        this.selectedWorkflowId = null;
        this.onSubmitAction = 'close'; // 'stay' | 'queue' | 'close'

        // Cache to prevent polling/progress flicker
        this.lastOpen = false;
        this.lastWorkflowId = null;
        this.lastTab = null;
        this.lastActiveModalId = null;
        this.lastSelectedSize = 0;
        this.lastJobsJson = null;
        this.stickyWorkflows = {};
        this.lastEntryMode = null;

        store.subscribe((state, changed) => {
            if (!state.isGenerationOpen) {
                this.render(false, state.workflows, state.jobs);
                return;
            }
            if (this.lastOpen && changed && changed.jobs && !changed.workflows && !changed.isGenerationOpen && !changed.generationTab && !changed.entryMode) {
                if (state.generationTab === 'form') {
                    const qBadge = this.container.querySelector('#tab-queue .badge');
                    if (qBadge) {
                        const count = state.jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
                        qBadge.textContent = count;
                    }
                    return;
                } else if (state.generationTab === 'queue') {
                    this.updateQueueList(state.jobs);
                    return;
                }
            }
            this.render(state.isGenerationOpen, state.workflows, state.jobs);
        });
    }

    render(isOpen, workflows, jobs) {
        if (!isOpen) {
            this.container.innerHTML = '';
            this.container.style.display = 'none';
            this.lastOpen = false;
            this.lastJobsJson = null;
            return;
        }

        const utilityWorkflows = workflows.filter(w => w.is_utility || w.type === 'utility');
        const genWorkflows = workflows.filter(w => !w.is_utility && w.type !== 'utility');
        const displayWorkflows = genWorkflows.length > 0 ? genWorkflows : workflows;

        const entryMode = store.get('entryMode') || 'ALL';
        if (this.lastEntryMode !== entryMode) {
            this.lastEntryMode = entryMode;
            const stickyForMode = this.stickyWorkflows[entryMode];
            if (stickyForMode && displayWorkflows.some(w => w.id === stickyForMode)) {
                this.selectedWorkflowId = stickyForMode;
            } else if (entryMode !== 'ALL' && entryMode !== 'BATCH') {
                const matchingType = displayWorkflows.find(w => w.type === entryMode || (entryMode === 'I2V' && (w.type === 'I2V' || w.type === 'I2I')) || (entryMode === 'T2V' && w.type === 'T2V') || (entryMode === 'T2I' && w.type === 'T2I') || (entryMode === 'I2I' && w.type === 'I2I') || (entryMode === 'V2V' && w.type === 'V2V'));
                if (matchingType) {
                    this.selectedWorkflowId = matchingType.id;
                }
            }
            this.lastWorkflowId = null; // force form re-render on mode change
        }

        if (!this.selectedWorkflowId && displayWorkflows.length > 0) {
            this.selectedWorkflowId = displayWorkflows[0].id;
        }

        const currentWorkflow = workflows.find(w => w.id === this.selectedWorkflowId) || displayWorkflows[0];
        const currentTab = store.get('generationTab') || 'form';
        const activeModalItem = store.get('activeModalItem');
        const selectedIds = store.get('selectedIds') || new Set();

        const needsFullRender = !this.lastOpen ||
            this.lastWorkflowId !== (currentWorkflow ? currentWorkflow.id : null) ||
            this.lastActiveModalId !== (activeModalItem ? activeModalItem.id : null) ||
            this.lastSelectedSize !== selectedIds.size;

        if (!needsFullRender) {
            // Already open and viewing the same workflow/item! Update tabs & queue cleanly without destroying form DOM!
            if (this.lastTab !== currentTab) {
                this.lastTab = currentTab;
                const formPane = this.container.querySelector('#pane-form');
                const queuePane = this.container.querySelector('#pane-queue');
                const tabFormBtn = this.container.querySelector('#tab-form');
                const tabQueueBtn = this.container.querySelector('#tab-queue');
                if (formPane) formPane.style.display = currentTab === 'form' ? 'flex' : 'none';
                if (queuePane) queuePane.style.display = currentTab === 'queue' ? 'flex' : 'none';
                if (tabFormBtn) {
                    tabFormBtn.style.borderBottomColor = currentTab === 'form' ? 'var(--accent-cyan)' : 'transparent';
                    tabFormBtn.style.color = currentTab === 'form' ? '#fff' : 'var(--text-secondary)';
                }
                if (tabQueueBtn) {
                    tabQueueBtn.style.borderBottomColor = currentTab === 'queue' ? 'var(--accent-cyan)' : 'transparent';
                    tabQueueBtn.style.color = currentTab === 'queue' ? '#fff' : 'var(--text-secondary)';
                }
            }

            const jobsJson = JSON.stringify(jobs);
            if (this.lastJobsJson !== jobsJson) {
                this.lastJobsJson = jobsJson;
                this.updateQueueList(jobs);
            }
            return;
        }

        this.lastOpen = true;
        this.lastWorkflowId = currentWorkflow ? currentWorkflow.id : null;
        this.lastActiveModalId = activeModalItem ? activeModalItem.id : null;
        this.lastSelectedSize = selectedIds.size;
        this.lastTab = currentTab;
        this.lastJobsJson = JSON.stringify(jobs);

        this.container.style.display = 'block';

        const workflowOptions = displayWorkflows.map(w => `
          <option value="${w.id}" ${w.id === this.selectedWorkflowId ? 'selected' : ''}>
            ${w.name} (${w.type})
          </option>
        `).join('');

        const utilityButtonsHtml = utilityWorkflows.length > 0 ? utilityWorkflows.map(u => `
          <button class="btn btn-utility-action" data-id="${u.id}" title="Instant run: ${u.name || u.id}" style="height: 32px; padding: 0 12px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; flex-shrink: 0; background: rgba(255, 82, 82, 0.15); color: #ff6b6b; border: 1px solid rgba(255, 82, 82, 0.3); border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s ease;">
            ⚡ ${u.name || u.id}
          </button>
        `).join('') : `<div style="font-size: 0.75rem; color: var(--text-muted); padding: 4px 0;">No utility workflows found.</div>`;

        const isBatchSelection = !activeModalItem && selectedIds.size > 0;

        let defaultPrimaryVal = '';
        let defaultAudioVal = '';

        if (activeModalItem) {
            if (currentWorkflow && currentWorkflow.expects === 'video,audio') {
                if (activeModalItem.media_type === 'audio') {
                    defaultAudioVal = activeModalItem.filepath || '';
                } else {
                    defaultPrimaryVal = activeModalItem.filepath || '';
                }
            } else if (activeModalItem.filepath) {
                defaultPrimaryVal = activeModalItem.filepath;
            }
        } else if (isBatchSelection) {
            defaultPrimaryVal = `[Batch: ${selectedIds.size} selected items]`;
        }

        let inputsHtml = '';
        if (currentWorkflow) {
            // 1. Primary media inputs based on 'expects'
            if (currentWorkflow.expects === 'video,audio') {
                inputsHtml += `
                  <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; grid-column: 1 / -1;">
                    <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">
                      Input Video (Path or filename) <span style="color: var(--accent-magenta);">*</span>
                    </label>
                    <input type="text" id="input-primary_input" class="input" value="${defaultPrimaryVal}" placeholder="e.g. /path/to/video.mp4" style="height: 40px; font-size: 0.9rem;" />
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; grid-column: 1 / -1;">
                    <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">
                      Input Audio (Path or filename) <span style="color: var(--accent-magenta);">*</span>
                    </label>
                    <input type="text" id="input-audio_input" class="input" value="${defaultAudioVal}" placeholder="e.g. /path/to/audio.wav" style="height: 40px; font-size: 0.9rem;" />
                  </div>
                `;
            } else if (currentWorkflow.expects && currentWorkflow.expects !== 'none' && currentWorkflow.expects !== 'utility') {
                const labelName = currentWorkflow.expects.toUpperCase();
                inputsHtml += `
                  <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; grid-column: 1 / -1;">
                    <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">
                      Input ${labelName} (Path or filename) <span style="color: var(--accent-magenta);">*</span>
                    </label>
                    <input type="text" id="input-primary_input" class="input" value="${defaultPrimaryVal}" placeholder="e.g. /path/to/source_file" style="height: 40px; font-size: 0.9rem;" />
                  </div>
                `;
            }

            // 2. Dynamic Form Fields (from discover_form_fields)
            if (currentWorkflow.form_fields && currentWorkflow.form_fields.length > 0) {
                currentWorkflow.form_fields.forEach((ff, idx) => {
                    let fieldHtml = '';
                    const isLong = ff.type === 'textarea' || (ff.label && ff.label.toLowerCase().includes('prompt'));
                    const gridCol = isLong ? 'grid-column: 1 / -1;' : '';

                    if (ff.type === 'textarea') {
                        fieldHtml = `<textarea id="ff-${idx}" class="input" style="height: 85px; padding: 12px; resize: vertical; font-size: 0.9rem;" placeholder="${ff.default || ''}">${ff.default || ''}</textarea>`;
                    } else if (ff.type === 'number') {
                        fieldHtml = `<input type="number" id="ff-${idx}" class="input" value="${ff.default || 0}" style="height: 40px; font-size: 0.9rem;" />`;
                    } else if (ff.type === 'combo' || ff.type === 'combo_number') {
                        const opts = (ff.options || []).map(opt => `
                          <option value="${opt}" ${String(opt) === String(ff.default) ? 'selected' : ''}>${opt}</option>
                        `).join('');
                        fieldHtml = `<select id="ff-${idx}" class="input" style="height: 40px; cursor: pointer; font-size: 0.9rem;">${opts}</select>`;
                    } else if (ff.type === 'checkbox') {
                        fieldHtml = `<input type="checkbox" id="ff-${idx}" ${ff.default === 'TRUE' || ff.default === true ? 'checked' : ''} style="cursor: pointer; width: 18px; height: 18px;" />`;
                    } else if (ff.type === 'spacer') {
                        return;
                    } else {
                        fieldHtml = `<input type="text" id="ff-${idx}" class="input" value="${ff.default || ''}" style="height: 40px; font-size: 0.9rem;" />`;
                    }
                    inputsHtml += `
                      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; ${gridCol}">
                        <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">
                          ${ff.label}
                        </label>
                        ${fieldHtml}
                      </div>
                    `;
                });
            } else if (currentWorkflow.inputs && currentWorkflow.inputs.length > 0) {
                // Legacy inputs fallback
                currentWorkflow.inputs.forEach(inp => {
                    let fieldHtml = '';
                    if (inp.type === 'text') {
                        fieldHtml = `<textarea id="input-${inp.name}" class="input" style="height: 85px; padding: 12px; resize: vertical; font-size: 0.9rem;" placeholder="${inp.default || ''}">${inp.default || ''}</textarea>`;
                    } else if (inp.type === 'number') {
                        fieldHtml = `<input type="number" id="input-${inp.name}" class="input" value="${inp.default || 0}" style="height: 40px; font-size: 0.9rem;" />`;
                    } else {
                        fieldHtml = `<input type="text" id="input-${inp.name}" class="input" value="${inp.default || ''}" style="height: 40px; font-size: 0.9rem;" />`;
                    }
                    inputsHtml += `
                      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; grid-column: 1 / -1;">
                        <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);">
                          ${inp.name} ${inp.required ? '<span style="color: var(--accent-magenta);">*</span>' : ''}
                        </label>
                        ${fieldHtml}
                      </div>
                    `;
                });
            } else if (currentWorkflow.is_utility) {
                inputsHtml = `<div style="color: var(--text-muted); font-size: 0.9rem; padding: 20px 0; grid-column: 1 / -1;">Utility workflow — no parameter inputs required. Click submit to execute.</div>`;
            }
        } else {
            inputsHtml = '<div style="color: var(--text-muted); grid-column: 1 / -1;">No workflows registered.</div>';
        }

        let autoTags = currentWorkflow ? [...currentWorkflow.tags_auto] : [];
        if (activeModalItem && activeModalItem.tags) {
            for (const t of activeModalItem.tags) {
                if (!autoTags.includes(t)) autoTags.push(t);
            }
        }
        const defaultTagsStr = autoTags.join(', ');

        this.container.innerHTML = `
          <!-- Center Screen Modal Backdrop -->
          <div id="gen-modal-backdrop" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(6px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 30px; animation: fadeIn 0.15s ease;">

            <!-- Center Modal Window (980px wide horizontal real estate) -->
            <div class="glass" style="width: 100%; max-width: 980px; height: 82vh; max-height: 760px; display: flex; flex-direction: column; border: 1px solid var(--border-color); border-radius: var(--radius-lg); box-shadow: 0 25px 80px rgba(0,0,0,0.85); background: var(--bg-card); overflow: hidden; position: relative;">

              <!-- Header & Tabs -->
              <div style="height: 62px; min-height: 62px; padding: 0 24px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; background: var(--bg-glass-heavy);">
                <div style="display: flex; align-items: center; gap: 28px;">
                  <h3 style="font-size: 1.15rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 10px; margin: 0;">
                    🎨 AI Generative Hub
                  </h3>
                  <div style="display: flex; gap: 16px;">
                    <button class="tab-btn ${currentTab === 'form' ? 'active' : ''}" id="tab-form" style="padding: 18px 4px; background: none; border: none; border-bottom: 2px solid ${currentTab === 'form' ? 'var(--accent-cyan)' : 'transparent'}; color: ${currentTab === 'form' ? '#fff' : 'var(--text-secondary)'}; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: all 0.2s ease;">
                      📝 Form
                    </button>
                    <button class="tab-btn ${currentTab === 'queue' ? 'active' : ''}" id="tab-queue" style="padding: 18px 4px; background: none; border: none; border-bottom: 2px solid ${currentTab === 'queue' ? 'var(--accent-cyan)' : 'transparent'}; color: ${currentTab === 'queue' ? '#fff' : 'var(--text-secondary)'}; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; gap: 6px;">
                      📋 Queue <span id="queue-count-badge" style="background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 10px; font-size: 0.75rem;">${jobs.length}</span>
                    </button>
                  </div>
                </div>
                <button id="btn-close-gen" class="btn btn-icon" style="width: 36px; height: 36px; font-size: 1.1rem;">✕</button>
              </div>

              <!-- Form Tab Pane (Two-Column Horizontal Layout) -->
              <div id="pane-form" style="display: ${currentTab === 'form' ? 'flex' : 'none'}; flex: 1; overflow: hidden; height: calc(100% - 62px);">

                <!-- Left Column: Workflow selection & Actions (360px wide) -->
                <div style="width: 360px; min-width: 360px; border-right: 1px solid var(--border-color); padding: 24px; display: flex; flex-direction: column; justify-content: space-between; overflow-y: auto; background: rgba(0,0,0,0.25);">
                  <div>
                    <div style="margin-bottom: 20px;">
                      <label style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); display: block; margin-bottom: 8px;">
                        ComfyUI Workflow
                      </label>
                      <select id="select-workflow" class="input" style="height: 42px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">
                        ${workflowOptions}
                      </select>
                    </div>

                    <!-- Instant Utility Workflows Bar -->
                    <div style="margin-bottom: 24px;">
                      <label style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); display: block; margin-bottom: 8px;">
                        ⚡ Instant Utility Actions
                      </label>
                      <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; max-width: 100%;">
                        ${utilityButtonsHtml}
                      </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                      <label style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); display: block; margin-bottom: 8px;">
                        Auto Tags (comma separated)
                      </label>
                      <input type="text" id="input-gen-tags" class="input" value="${defaultTagsStr}" placeholder="e.g. AI.Generated, V2V" style="height: 40px; font-size: 0.9rem;" />
                    </div>
                  </div>

                  <!-- Bottom Actions -->
                  <div style="border-top: 1px solid var(--border-color); padding-top: 20px; margin-top: 20px;">
                    <div style="margin-bottom: 16px;">
                      <label style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); display: block; margin-bottom: 8px;">
                        On Submit:
                      </label>
                      <div style="display: flex; gap: 16px; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #fff; cursor: pointer;">
                          <input type="radio" name="on_submit_action" value="stay" ${this.onSubmitAction === 'stay' ? 'checked' : ''} style="cursor: pointer;" /> Stay
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #fff; cursor: pointer;">
                          <input type="radio" name="on_submit_action" value="queue" ${this.onSubmitAction === 'queue' ? 'checked' : ''} style="cursor: pointer;" /> Queue
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #fff; cursor: pointer;">
                          <input type="radio" name="on_submit_action" value="close" ${this.onSubmitAction === 'close' ? 'checked' : ''} style="cursor: pointer;" /> Close
                        </label>
                      </div>
                    </div>
                    <button class="btn btn-primary" id="btn-submit-job" style="width: 100%; height: 48px; font-size: 0.95rem; font-weight: 700; box-shadow: 0 4px 20px rgba(0, 229, 255, 0.3);">
                      ▶ Submit Generation Job
                    </button>
                  </div>
                </div>

                <!-- Right Column: Parameters (Spacious Horizontal Layout) -->
                <div style="flex: 1; padding: 28px 36px; overflow-y: auto;">
                  <h4 style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 10px;">
                    ⚙️ Workflow Parameters
                  </h4>
                  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0 20px;">
                    ${inputsHtml}
                  </div>
                </div>

              </div>

              <!-- Queue Tab Pane (Full Width Horizontal Cards) -->
              <div id="pane-queue" style="display: ${currentTab === 'queue' ? 'flex' : 'none'}; flex-direction: column; flex: 1; overflow: hidden; padding: 24px 32px; height: calc(100% - 62px); background: rgba(0,0,0,0.2);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-shrink: 0;">
                  <h4 style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin: 0;">
                    📋 Queue History & Active Jobs
                  </h4>
                  <div style="display: flex; gap: 8px;">
                    <button class="btn" id="btn-clear-jobs" title="Clear Completed, Error, and Canceled jobs" style="height: 30px; padding: 0 12px; font-size: 0.8rem; color: #ff6b6b; border-color: rgba(255, 107, 107, 0.3);">🧹 Clear Finished</button>
                    <button class="btn" id="btn-refresh-jobs" style="height: 30px; padding: 0 12px; font-size: 0.8rem;">↻ Refresh</button>
                  </div>
                </div>
                <div id="queue-list-container" style="flex: 1; overflow-y: auto; padding-right: 4px;">
                  <!-- Dynamically filled by updateQueueList -->
                </div>
              </div>

            </div>
          </div>
        `;

        this.updateQueueList(jobs);
        this.attachEvents(currentWorkflow);
    }

    updateQueueList(jobs) {
        const badgeEl = this.container.querySelector('#queue-count-badge');
        if (badgeEl) badgeEl.textContent = jobs.length;

        const listEl = this.container.querySelector('#queue-list-container');
        if (!listEl) return;

        const scrollTop = listEl.scrollTop;

        const jobsHtml = jobs.length > 0 ? jobs.map(j => `
          <div class="job-item" data-id="${j.id}" style="padding: 14px 18px; background: rgba(0,0,0,0.35); border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 12px; position: relative; transition: all 0.2s ease;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-weight: 700; font-size: 0.85rem; color: #fff;">Job #${j.id.substring(0, 8)}</span>
                <span style="font-size: 0.75rem; color: var(--text-secondary); background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 12px;">${j.workflow_id}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 12px;">
                <span class="badge" style="background: ${j.status === 'completed' ? '#00c853' : j.status === 'running' ? 'var(--accent-cyan)' : j.status === 'error' ? '#ff5252' : j.status === 'canceled' || j.status === 'cancelled' ? '#9e9e9e' : '#ff9100'}; color: #000; font-weight: 700;">
                  ${j.status.toUpperCase()}
                </span>
                ${(j.status === 'queued' || j.status === 'running') ? `
                  <button class="btn-cancel-job" data-id="${j.id}" title="Cancel job" style="height: 24px; padding: 0 8px; font-size: 0.75rem; background: rgba(255, 82, 82, 0.2); border: 1px solid #ff5252; color: #ff5252; border-radius: 4px; cursor: pointer; font-weight: 600;">🛑 Cancel</button>
                ` : `
                  <button class="btn-delete-job" data-id="${j.id}" title="Remove job from history" style="height: 24px; padding: 0 8px; font-size: 0.75rem; background: rgba(255, 255, 255, 0.1); border: 1px solid var(--border-color); color: #ccc; border-radius: 4px; cursor: pointer;">✕</button>
                `}
              </div>
            </div>
            ${j.status === 'running' ? `
              <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; margin-top: 8px;">
                <div style="width: ${Math.round(j.progress * 100)}%; height: 100%; background: var(--accent-gradient); transition: width 0.3s ease;"></div>
              </div>
            ` : ''}
            ${j.error ? `<div class="selectable-error" style="color: #ff5252; font-size: 0.8rem; margin-top: 8px; word-break: break-all; background: rgba(255,82,82,0.1); padding: 8px 12px; border-radius: 4px; border-left: 3px solid #ff5252; user-select: text !important; -webkit-user-select: text !important; cursor: text;" title="Click and drag to highlight/copy error">${j.error}</div>` : ''}
          </div>
        `).join('') : '<div style="font-size: 0.9rem; color: var(--text-muted); text-align: center; padding: 40px;">Queue is empty.</div>';

        listEl.innerHTML = jobsHtml;
        listEl.scrollTop = scrollTop;
        this.attachQueueButtons();
    }

    attachQueueButtons() {
        this.container.querySelectorAll('.btn-cancel-job').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const jid = btn.getAttribute('data-id');
                try {
                    btn.textContent = '⏳';
                    await api.cancelJob(jid);
                    await store.loadWorkflowsAndJobs();
                } catch (err) {
                    alert(`Cancel failed: ${err.message}`);
                }
            });
        });

        this.container.querySelectorAll('.btn-delete-job').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const jid = btn.getAttribute('data-id');
                try {
                    await api.deleteJob(jid);
                    await store.loadWorkflowsAndJobs();
                } catch (err) {
                    alert(`Delete failed: ${err.message}`);
                }
            });
        });
    }

    attachEvents(workflow) {
        const backdrop = this.container.querySelector('#gen-modal-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) {
                    store.set({ isGenerationOpen: false });
                }
            });
        }

        const closeBtn = this.container.querySelector('#btn-close-gen');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                store.set({ isGenerationOpen: false });
            });
        }

        const tabForm = this.container.querySelector('#tab-form');
        if (tabForm) {
            tabForm.addEventListener('click', () => store.set({ generationTab: 'form' }));
        }
        const tabQueue = this.container.querySelector('#tab-queue');
        if (tabQueue) {
            tabQueue.addEventListener('click', () => store.set({ generationTab: 'queue' }));
        }

        const clearBtn = this.container.querySelector('#btn-clear-jobs');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                try {
                    await api.clearJobs();
                    await store.loadWorkflowsAndJobs();
                } catch (err) {
                    alert(`Clear failed: ${err.message}`);
                }
            });
        }

        this.container.querySelectorAll('input[name="on_submit_action"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.onSubmitAction = e.target.value;
                }
            });
        });

        this.container.querySelectorAll('.btn-utility-action').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                try {
                    btn.disabled = true;
                    const origText = btn.innerHTML;
                    btn.innerHTML = `⏳ Running...`;
                    await api.submitJob(wid, {}, []);
                    await store.loadWorkflowsAndJobs();
                    alert(`Utility workflow "${wid}" submitted!`);
                    btn.innerHTML = origText;
                } catch (err) {
                    alert(`Failed to run utility workflow "${wid}": ${err.message}`);
                } finally {
                    btn.disabled = false;
                }
            });
        });

        const sel = this.container.querySelector('#select-workflow');
        if (sel) {
            sel.addEventListener('change', (e) => {
                this.selectedWorkflowId = e.target.value;
                const mode = store.get('entryMode') || 'ALL';
                this.stickyWorkflows[mode] = this.selectedWorkflowId;
                this.lastWorkflowId = null; // Force re-render of form fields
                this.render(true, store.get('workflows'), store.get('jobs'));
            });
        }

        const refreshBtn = this.container.querySelector('#btn-refresh-jobs');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                store.loadWorkflowsAndJobs();
            });
        }

        const submitBtn = this.container.querySelector('#btn-submit-job');
        if (submitBtn && workflow) {
            submitBtn.addEventListener('click', async () => {
                const inputs = {};

                // 1. Collect media inputs if present
                const primEl = this.container.querySelector('#input-primary_input');
                if (primEl && primEl.value.trim()) {
                    inputs['primary_input'] = primEl.value.trim();
                }
                const audioEl = this.container.querySelector('#input-audio_input');
                if (audioEl && audioEl.value.trim()) {
                    inputs['audio_input'] = audioEl.value.trim();
                }

                // 2. Collect dynamic form fields
                if (workflow.form_fields && workflow.form_fields.length > 0) {
                    workflow.form_fields.forEach((ff, idx) => {
                        if (ff.type === 'spacer') return;
                        const el = this.container.querySelector(`#ff-${idx}`);
                        if (el) {
                            let val = ff.type === 'checkbox' ? (el.checked ? 'TRUE' : 'FALSE') : el.value;
                            if (ff.type === 'number' || ff.type === 'combo_number') {
                                val = Number(val);
                            }
                            inputs[ff.field_name] = val;
                            inputs[ff.label] = val;
                        }
                    });
                } else if (workflow.inputs && workflow.inputs.length > 0) {
                    // Legacy inputs fallback
                    workflow.inputs.forEach(inp => {
                        const el = this.container.querySelector(`#input-${inp.name}`);
                        if (el) {
                            let val = el.value;
                            if (inp.type === 'number') val = Number(val);
                            inputs[inp.name] = val;
                        }
                    });
                }

                const tagsInput = this.container.querySelector('#input-gen-tags');
                const tags = tagsInput ? tagsInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];

                const isBatchSubmit = !store.get('activeModalItem') && store.get('selectedIds').size > 0 && String(primEl ? primEl.value : '').startsWith('[Batch:');

                try {
                    submitBtn.disabled = true;
                    if (isBatchSubmit) {
                        const ids = Array.from(store.get('selectedIds'));
                        const displayedMap = new Map((store.get('results') || []).filter(r => r.media).map(r => [r.media.id, r.media]));
                        let submittedCount = 0;
                        for (const mid of ids) {
                            let item = displayedMap.get(mid);
                            if (!item) {
                                try { item = await api.getMedia(mid); } catch (e) { continue; }
                            }
                            if (!item || !item.filepath) continue;

                            const itemInputs = { ...inputs };
                            if (workflow.expects === 'video,audio') {
                                if (item.media_type === 'audio') {
                                    itemInputs['audio_input'] = item.filepath;
                                } else {
                                    itemInputs['primary_input'] = item.filepath;
                                }
                            } else {
                                itemInputs['primary_input'] = item.filepath;
                            }

                            const itemTags = [...tags];
                            if (item.tags) {
                                for (const t of item.tags) {
                                    if (!itemTags.includes(t)) itemTags.push(t);
                                }
                            }

                            try {
                                submitBtn.textContent = `⏳ Submitting (${submittedCount + 1}/${ids.length})...`;
                                await api.submitJob(workflow.id, itemInputs, itemTags);
                                submittedCount++;
                            } catch (err) {
                                console.error(`Failed to submit job for ${item.filename}:`, err);
                            }
                        }
                        store.clearSelection();
                        if (this.onSubmitAction === 'close') {
                            store.set({ isGenerationOpen: false });
                        } else if (this.onSubmitAction === 'queue') {
                            store.set({ generationTab: 'queue' });
                            await store.loadWorkflowsAndJobs();
                        } else if (this.onSubmitAction === 'stay') {
                            await store.loadWorkflowsAndJobs();
                        }
                    } else {
                        submitBtn.textContent = '⏳ Submitting...';
                        await api.submitJob(workflow.id, inputs, tags);
                        if (this.onSubmitAction === 'close') {
                            store.set({ isGenerationOpen: false });
                        } else if (this.onSubmitAction === 'queue') {
                            store.set({ generationTab: 'queue' });
                            await store.loadWorkflowsAndJobs();
                        } else if (this.onSubmitAction === 'stay') {
                            await store.loadWorkflowsAndJobs();
                        }
                    }
                } catch (e) {
                    alert(`Job submission failed: ${e.message}`);
                } finally {
                    submitBtn.textContent = '▶ Submit Generation Job';
                    submitBtn.disabled = false;
                }
            });
        }
    }
}
