function focusPlanner(attempt = 0) {
    const closer = document.getElementById('planner-close');
    const target = closer.getClientRects().length
        ? closer
        : document.querySelector('#scenario-bar [aria-selected="true"]');
    target?.focus();
    // The drawer may still be finishing its visibility transition.
    if (target && document.activeElement !== target && attempt < 30) {
        requestAnimationFrame(() => focusPlanner(attempt + 1));
    }
}

function setSaveStatus(message, status = 'saved') {
    const element = document.getElementById('save-status');
    element.textContent = message;
    element.dataset.state = status;
    element.title = message;
    element.setAttribute('aria-label', message);
}

function showPlanDialog({ title, message = '', initialValue, confirmLabel = 'Save', danger = false }) {
    const returnFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'plan-dialog';
    dialog.setAttribute('aria-labelledby', 'plan-dialog-title');
    dialog.setAttribute('aria-describedby', 'plan-dialog-message');
    dialog.innerHTML = `
        <form method="dialog">
            <p class="eyebrow">YOUR PLAN</p>
            <h2 id="plan-dialog-title"></h2>
            <p id="plan-dialog-message"></p>
            <label for="plan-dialog-input">Scenario name</label>
            <input id="plan-dialog-input" type="text" maxlength="120" autocomplete="off">
            <div class="plan-dialog-actions">
                <button type="button" value="cancel" class="header-export">Cancel</button>
                <button type="submit" value="confirm" class="primary-button"></button>
            </div>
        </form>`;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('#plan-dialog-message').textContent = message;
    const input = dialog.querySelector('input');
    const hasInput = initialValue !== undefined;
    input.hidden = !hasInput;
    dialog.querySelector('label').hidden = !hasInput;
    input.value = initialValue ?? '';
    const confirmButton = dialog.querySelector('[value="confirm"]');
    confirmButton.textContent = confirmLabel;
    confirmButton.classList.toggle('destructive', danger);
    dialog.querySelector('[value="cancel"]').addEventListener('click', () => dialog.close('cancel'));
    document.body.appendChild(dialog);
    return new Promise(resolve => {
        dialog.addEventListener('close', () => {
            const result = dialog.returnValue === 'confirm' ? (hasInput ? input.value : '') : null;
            dialog.remove();
            if (returnFocus?.isConnected) returnFocus.focus();
            else focusPlanner();
            resolve(result);
        }, { once: true });
        dialog.addEventListener('click', event => {
            if (event.target !== dialog) return;
            const rect = dialog.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right ||
                event.clientY < rect.top || event.clientY > rect.bottom) dialog.close('cancel');
        });
        dialog.showModal();
        if (hasInput) {
            input.focus();
            input.select();
        } else dialog.querySelector('[value="cancel"]').focus();
    });
}

function syncWorkspaceUI() {
    const active = getActiveScenarioRecord();
    document.getElementById('active-scenario-label').textContent = active?.name || 'Default';
    const collections = { accounts: 'accounts', loans: 'loans', transactions: 'transactions', units: 'units', fees: 'fees' };
    for (const [section, collection] of Object.entries(collections)) {
        const summary = document.querySelector(`#${section}-section > summary`);
        let count = summary.querySelector('.section-count');
        if (!count) {
            count = document.createElement('span');
            count.className = 'section-count';
            summary.appendChild(count);
        }
        count.textContent = state[collection].length;
    }
}

function syncRangePresets() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const button of document.querySelectorAll('[data-range-months]')) {
        const end = new Date(today);
        end.setMonth(end.getMonth() + Number(button.dataset.rangeMonths));
        const selected = Math.abs(currentViewStart - today) < 86400000 &&
            Math.abs(currentViewEnd - end) < 86400000;
        button.setAttribute('aria-pressed', String(selected));
    }
}

function setForecastRange(months) {
    const allowedMonths = [12, 36, 60, 120];
    if (!allowedMonths.includes(months)) {
        showToast('Choose a supported forecast range.', 'error');
        return;
    }
    if (!chartInstance) {
        showToast('The chart is not ready. Reload the page and try again.', 'error');
        return;
    }
    const now = new Date();
    currentViewStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    currentViewEnd = new Date(currentViewStart);
    currentViewEnd.setMonth(currentViewEnd.getMonth() + months);
    if (currentViewEnd > FULL_END_DATE) currentViewEnd = new Date(FULL_END_DATE);
    if (!state.yAxisFrozen) {
        clearAxisRange(chartInstance, 'y');
        clearAxisRange(chartInstance, 'y1');
    }
    updateChartView();
}

function trapFocus(event, root) {
    if (event.key !== 'Tab') return;
    const elements = [...root.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')]
        .filter(element => !element.disabled && element.getClientRects().length > 0);
    const first = elements[0];
    const last = elements.at(-1);
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
    }
}

function initializeWorkspace() {
    const sidebar = document.getElementById('sidebar');
    const opener = document.getElementById('planner-toggle');
    const closer = document.getElementById('planner-close');
    const handle = document.getElementById('drag-handle');
    const handleButton = document.getElementById('toggle-sidebar-btn');
    const backdrop = document.getElementById('planner-backdrop');
    const main = document.querySelector('main');
    const header = document.querySelector('.app-header');
    const compact = matchMedia('(max-width: 1100px)');
    let open = !compact.matches;
    let desktopWidth = '';
    let returnFocus = opener;
    let resizeStart = null;

    function setOpen(value, focus = true) {
        open = value;
        const modal = compact.matches && open;
        if (value && !compact.matches) sidebar.style.flexBasis = desktopWidth;
        sidebar.classList.toggle('sidebar-hidden', !open);
        sidebar.inert = !open;
        opener.setAttribute('aria-expanded', String(open));
        handleButton.setAttribute('aria-expanded', String(open));
        handleButton.textContent = open ? '\u25c0' : '\u25b6';
        backdrop.hidden = !modal;
        main.inert = modal;
        header.inert = modal;
        if (modal) {
            sidebar.setAttribute('role', 'dialog');
            sidebar.setAttribute('aria-modal', 'true');
        } else {
            sidebar.removeAttribute('role');
            sidebar.removeAttribute('aria-modal');
        }
        if (focus) {
            if (open) focusPlanner();
            else (returnFocus?.isConnected ? returnFocus : opener).focus();
        }
        requestAnimationFrame(() => chartInstance?.resize());
    }

    opener.addEventListener('click', () => {
        returnFocus = opener;
        setOpen(!open);
    });
    handleButton.addEventListener('click', () => {
        returnFocus = handleButton;
        setOpen(!open);
    });
    closer.addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    compact.addEventListener('change', () => {
        const wasInside = sidebar.contains(document.activeElement);
        returnFocus = opener;
        setOpen(!compact.matches, wasInside);
    });
    document.addEventListener('keydown', event => {
        if (document.getElementById('sell-modal') || document.querySelector('dialog[open]')) return;
        if (compact.matches && open) {
            if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
            } else trapFocus(event, sidebar);
        }
    });
    document.querySelectorAll('.planner-nav a').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            const section = document.querySelector(link.hash);
            section.open = true;
            section.querySelector('summary').focus();
            section.scrollIntoView({ block: 'start' });
        });
    });
    document.querySelectorAll('[data-range-months]').forEach(button => {
        button.addEventListener('click', () => setForecastRange(Number(button.dataset.rangeMonths)));
    });
    document.getElementById('scenario-bar').addEventListener('keydown', event => {
        if (!event.target.matches('[role="tab"]')) return;
        const tabs = [...document.querySelectorAll('#scenario-bar [role="tab"]')];
        const index = tabs.indexOf(event.target);
        let target;
        if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
        if (event.key === 'ArrowLeft') target = tabs[(index - 1 + tabs.length) % tabs.length];
        if (event.key === 'Home') target = tabs[0];
        if (event.key === 'End') target = tabs.at(-1);
        if (target) {
            event.preventDefault();
            target.click();
            document.querySelector('#scenario-bar [aria-selected="true"]')?.focus();
        }
    });

    handle.addEventListener('pointerdown', event => {
        if (event.target.closest('button') || compact.matches || !open) return;
        event.preventDefault();
        resizeStart = { x: event.clientX, width: sidebar.getBoundingClientRect().width };
        sidebar.classList.add('is-resizing');
        handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
        if (!resizeStart) return;
        const width = Math.max(350, Math.min(resizeStart.width + event.clientX - resizeStart.x, innerWidth - 540));
        desktopWidth = `${width}px`;
        sidebar.style.flexBasis = desktopWidth;
    });
    const finishResize = () => {
        resizeStart = null;
        sidebar.classList.remove('is-resizing');
        chartInstance?.resize();
    };
    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
    handle.addEventListener('lostpointercapture', finishResize);
    window.addEventListener('pagehide', () => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
            saveToLocalStorage();
        }
    });
    setOpen(open, false);
    syncWorkspaceUI();
    syncRangePresets();
}
