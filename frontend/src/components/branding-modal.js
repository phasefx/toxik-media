import { store } from '../state/store.js';
import { marked } from 'marked';
import readmeText from '../../../README.md?raw';
import licenseText from '../../../LICENSE?raw';

export class BrandingModal {
    constructor(container) {
        this.container = container;
        this.activeTab = 'readme'; // 'readme' | 'license'
        this.render();
        store.subscribe((state, changed) => {
            if (changed && changed.isBrandingOpen !== undefined) {
                this.render();
            }
        });
    }

    render() {
        const isOpen = store.get('isBrandingOpen');
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

        const bh = store.get('backendGitHash') || '—';
        const fh = store.get('frontendGitHash') || '—';

        const renderHashLink = (hash) => {
            if (!hash || hash === '—' || hash === 'unknown') {
                return `<code style="color: var(--text-muted); background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 4px; font-family: monospace;">${hash || '—'}</code>`;
            }
            return `<a href="https://github.com/phasefx/toxik-media/commit/${hash}" target="_blank" rel="noopener noreferrer"
                       style="color: var(--accent-cyan); background: rgba(0,240,255,0.08); padding: 2px 6px; border-radius: 4px; font-family: monospace; text-decoration: none; border: 1px solid rgba(0,240,255,0.2); transition: all 0.2s;"
                       onmouseover="this.style.background='rgba(0,240,255,0.15)'; this.style.borderColor='var(--accent-cyan)';"
                       onmouseout="this.style.background='rgba(0,240,255,0.08)'; this.style.borderColor='rgba(0,240,255,0.2)';"
                       title="View commit ${hash} on GitHub">
                      ${hash}
                    </a>`;
        };

        const hashesHtml = bh !== fh
            ? `Backend TIP: ${renderHashLink(bh)} &nbsp;·&nbsp; Frontend TIP: ${renderHashLink(fh)}`
            : `TIP: ${renderHashLink(bh || fh)}`;

        let tabContent = '';
        if (this.activeTab === 'readme') {
            try {
                tabContent = `<div class="markdown-body" style="padding: 24px; color: var(--text-primary); font-size: 0.95rem; line-height: 1.6;">
                    ${marked.parse(readmeText, { breaks: true, gfm: true })}
                </div>`;
            } catch (e) {
                tabContent = `<div style="padding: 24px; color: var(--text-muted);">Failed to parse README: ${e.message}</div>`;
            }
        } else {
            tabContent = `<div style="padding: 24px; height: 100%;">
                <pre style="font-family: monospace; white-space: pre-wrap; font-size: 0.85rem; color: var(--text-secondary); background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); padding: 16px; border-radius: 6px; height: 100%; overflow-y: auto; margin: 0;">${licenseText}</pre>
            </div>`;
        }

        this.container.innerHTML = `
          <div class="modal-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); width: 850px; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,0.8); overflow: hidden;">

            <!-- Header Section -->
            <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 8px; background: rgba(255,255,255,0.02); position: relative;">
              <button class="btn btn-icon" id="btn-close-branding" title="Close (Escape)" style="position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; font-size: 1.1rem; border: none; background: transparent; color: var(--text-secondary); cursor: pointer;">✕</button>

              <h3 style="margin: 0; font-size: 1.5rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                Toxik <span style="font-size: 1.3rem;">🧪</span>
              </h3>

              <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 4px;">
                <span>${hashesHtml}</span>
                <span style="color: rgba(255,255,255,0.15);">|</span>
                <a href="https://github.com/phasefx/toxik-media" target="_blank" rel="noopener noreferrer" style="color: var(--accent-cyan); text-decoration: none; display: flex; align-items: center; gap: 4px; font-weight: 600; transition: opacity 0.2s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">
                  📦 GitHub
                </a>
              </div>
            </div>

            <!-- Tab Switcher -->
            <div style="display: flex; border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.15); flex-shrink: 0;">
              <button class="tab-btn ${this.activeTab === 'readme' ? 'active' : ''}" data-tab="readme" style="flex: 1; padding: 12px 16px; border: none; background: ${this.activeTab === 'readme' ? 'rgba(0, 240, 255, 0.12)' : 'transparent'}; color: ${this.activeTab === 'readme' ? '#fff' : 'var(--text-secondary)'}; font-weight: ${this.activeTab === 'readme' ? '700' : '500'}; font-size: 0.9rem; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'readme' ? 'var(--accent-cyan)' : 'transparent'}; transition: all 0.15s ease;">
                📖 README.md
              </button>
              <button class="tab-btn ${this.activeTab === 'license' ? 'active' : ''}" data-tab="license" style="flex: 1; padding: 12px 16px; border: none; background: ${this.activeTab === 'license' ? 'rgba(0, 240, 255, 0.12)' : 'transparent'}; color: ${this.activeTab === 'license' ? '#fff' : 'var(--text-secondary)'}; font-weight: ${this.activeTab === 'license' ? '700' : '500'}; font-size: 0.9rem; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'license' ? 'var(--accent-cyan)' : 'transparent'}; transition: all 0.15s ease;">
                📄 LICENSE
              </button>
            </div>

            <!-- Tab Content Pane -->
            <div style="flex: 1; overflow-y: auto; background: rgba(0,0,0,0.1);">
              ${tabContent}
            </div>

            <!-- Footer -->
            <div style="padding: 12px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; background: rgba(0,0,0,0.2); flex-shrink: 0;">
              <button class="btn" id="btn-branding-done" style="height: 36px; padding: 0 20px; font-weight: 600;">Close</button>
            </div>
          </div>
        `;

        this.attachEvents();
    }

    attachEvents() {
        const close = () => store.set({ isBrandingOpen: false });

        const closeBtn = this.container.querySelector('#btn-close-branding');
        const doneBtn = this.container.querySelector('#btn-branding-done');
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (doneBtn) doneBtn.addEventListener('click', close);

        this.container.addEventListener('click', (e) => {
            if (e.target === this.container) {
                close();
            }
        });

        // Tab switching
        this.container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.activeTab = btn.getAttribute('data-tab');
                this.render();
            });
        });
    }
}
