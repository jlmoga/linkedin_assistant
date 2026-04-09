/**
 * UI Utilities and visual helpers
 */

import * as dom from './dom.js';
import { autoExpandResum } from './cv-manager.js';

export function updateAiStatus(message, showProgress = true) {
  if (dom.headerStatusDot && dom.headerStatusText) {
    dom.headerStatusDot.className = 'badge-dot blue';
    dom.headerStatusText.textContent = message;
  }
  if (showProgress && dom.progressStatus) {
    dom.progressStatus.textContent = message;
  }
  console.log(`[AI Status] ${message}`);
}

export function activateTab(tabId) {
  dom.tabButtons.forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  dom.tabPanels.forEach(panel => {
    panel.hidden = panel.id !== `panel-${tabId}`;
  });
  
  localStorage.setItem('activeTab', tabId);

  // Especial: Redimensionar resum professional si entrem a la pestanya de CV
  if (tabId === 'el-meu-cv') {
    setTimeout(autoExpandResum, 100);
  }
}

export function restoreActiveTab() {
  const savedTab = localStorage.getItem('activeTab');
  if (savedTab) {
    activateTab(savedTab);
  }
}

export function renderTags(list, tags, storageKey) {
  if (!list) return;
  list.innerHTML = '';
  (tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${tag} <span class="tag-remove" data-tag="${tag}">×</span>`;
    list.appendChild(chip);
  });
}

export function updateProgress(percent, status) {
  if (dom.progressFiller) dom.progressFiller.style.width = percent + '%';
  if (dom.progressPercent) dom.progressPercent.textContent = percent + '%';
  if (dom.progressStatus) dom.progressStatus.textContent = status;
}

export function updateVentallProgress(percent, status) {
  if (dom.ventallProgressFiller) dom.ventallProgressFiller.style.width = percent + '%';
  if (dom.ventallPercentage) dom.ventallPercentage.textContent = percent + '%';
  if (dom.ventallStatusText) dom.ventallStatusText.textContent = status;
  updateAiStatus(status);
}

export function resetProgress() {
  if (dom.progressContainer) dom.progressContainer.hidden = false;
  if (dom.progressFiller) dom.progressFiller.style.width = '0%';
  if (dom.progressPercent) dom.progressPercent.textContent = '0%';
}

export function updateHeaderStatus(type, text, tooltipText = "") {
  if (dom.headerStatusDot) {
    dom.headerStatusDot.className = `badge-dot ${type}`;
  }
  if (dom.headerStatusText) {
    dom.headerStatusText.textContent = text;
    if (tooltipText) dom.headerStatusText.title = tooltipText;
  }
}

export function showSaveSuccess() {
  if (dom.saveStatusMsg) {
    dom.saveStatusMsg.hidden = false;
    setTimeout(() => {
      dom.saveStatusMsg.hidden = true;
    }, 3000);
  }
}
