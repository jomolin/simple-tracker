// ======================
// SIMPLE STUDENT TRACKER — CONTENT SCRIPT
// ======================
// Shows the selected student's name on screen. No buttons — name only.
// Auto-fades after a configurable delay.

let fadeTimer = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'showStudent') {
        showStudentOverlay(request.name, request.fadeMs || 5000);
        sendResponse({ success: true });
    } else if (request.action === 'hideOverlay') {
        hideOverlay();
        sendResponse({ success: true });
    } else if (request.action === 'showFilterChange') {
        showFilterNotification(request.filter);
        sendResponse({ success: true });
    }
    return true;
});

// ======================
// STUDENT OVERLAY
// ======================

function showStudentOverlay(name, fadeMs) {
    // Don't render in tiny iframes
    if (window.innerWidth < 300 || window.innerHeight < 300) return;

    hideOverlay();
    ensureStylesInjected();

    const overlay = document.createElement('div');
    overlay.id = 'simple-tracker-overlay';
    overlay.className = 'simple-tracker-overlay';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'simple-tracker-name';
    nameDiv.textContent = name;

    overlay.appendChild(nameDiv);
    document.body.appendChild(overlay);

    // Auto-fade after delay
    fadeTimer = setTimeout(() => {
        hideOverlay();
    }, fadeMs);
}

function hideOverlay() {
    if (fadeTimer) {
        clearTimeout(fadeTimer);
        fadeTimer = null;
    }
    const existing = document.getElementById('simple-tracker-overlay');
    if (existing) {
        existing.classList.add('simple-tracker-overlay-hiding');
        setTimeout(() => existing.remove(), 300);
    }
}

function ensureStylesInjected() {
    if (document.getElementById('simple-tracker-styles')) return;

    const style = document.createElement('style');
    style.id = 'simple-tracker-styles';
    style.textContent = `
    .simple-tracker-overlay {
        position: fixed;
        bottom: 30px;
        right: 30px;
        background: rgba(0, 0, 0, 0.92);
        color: white;
        padding: 24px 36px;
        border-radius: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 2147483647;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
        min-width: 280px;
        animation: simpleTrackerSlideIn 0.3s ease-out;
    }
    .simple-tracker-overlay-hiding {
        animation: simpleTrackerSlideOut 0.3s ease-out forwards;
    }
    .simple-tracker-name {
        font-size: 32px;
        font-weight: 700;
        text-align: center;
        letter-spacing: 0.5px;
    }
    .simple-tracker-filter-notification {
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 14px 28px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 2147483647;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
        font-size: 16px;
        font-weight: 600;
        animation: simpleTrackerFadeInOut 2s ease-in-out forwards;
    }
    @keyframes simpleTrackerSlideIn {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }
    @keyframes simpleTrackerSlideOut {
        from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(20px); opacity: 0; }
    }
    @keyframes simpleTrackerFadeInOut {
        0%   { opacity: 0; transform: translateX(-50%) translateY(-12px); }
        15%  { opacity: 1; transform: translateX(-50%) translateY(0); }
        85%  { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-12px); }
    }
    `;
    document.head.appendChild(style);
}

// ======================
// FILTER NOTIFICATION
// ======================

function showFilterNotification(filterText) {
    ensureStylesInjected();

    const existing = document.getElementById('simple-tracker-filter-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.id = 'simple-tracker-filter-notification';
    notif.className = 'simple-tracker-filter-notification';
    notif.textContent = `🎯 ${filterText}`;

    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2000);
}
