// toast.js - Toast Notification System

// Toast container
let toastContainer = null;

/**
 * Initialize toast container
 */
function initToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.setAttribute('role', 'region');
        toastContainer.setAttribute('aria-live', 'polite');
        toastContainer.setAttribute('aria-label', 'Notifications');
        document.body.appendChild(toastContainer);
    }
}

/**
 * Show toast notification
 * @param {String} message - Toast message
 * @param {String} type - Toast type: 'success', 'error', 'info', 'warning'
 * @param {Number} duration - Duration in milliseconds (0 = no auto-dismiss)
 */
function showToast(message, type = 'info', duration = 5000) {
    initToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    
    // Icon based on type
    const icons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-message">${escapeHtml(message)}</div>
        <button class="toast-close" aria-label="Close notification" onclick="this.parentElement.remove()">×</button>
    `;
    
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Auto-dismiss if duration is set
    if (duration > 0) {
        setTimeout(() => {
            dismissToast(toast);
        }, duration);
    }
    
    return toast;
}

/**
 * Dismiss a toast
 * @param {HTMLElement} toast - Toast element
 */
function dismissToast(toast) {
    if (toast && toast.parentElement) {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }
}

/**
 * Show success toast
 */
function showSuccessToast(message, duration = 5000) {
    return showToast(message, 'success', duration);
}

/**
 * Show error toast
 */
function showErrorToast(message, duration = 7000) {
    return showToast(message, 'error', duration);
}

/**
 * Show info toast
 */
function showInfoToast(message, duration = 5000) {
    return showToast(message, 'info', duration);
}

/**
 * Show warning toast
 */
function showWarningToast(message, duration = 6000) {
    return showToast(message, 'warning', duration);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (window.UtilsModule && window.UtilsModule.escapeHtml) {
        return window.UtilsModule.escapeHtml(text);
    }
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Initialize on load
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initToastContainer);
    } else {
        initToastContainer();
    }
    
    window.ToastModule = {
        showToast,
        dismissToast,
        showSuccessToast,
        showErrorToast,
        showInfoToast,
        showWarningToast
    };
    
    // Global convenience functions
    window.showToast = showToast;
    window.showSuccessToast = showSuccessToast;
    window.showErrorToast = showErrorToast;
    window.showInfoToast = showInfoToast;
    window.showWarningToast = showWarningToast;
}

