// ui.js - UI Update and Rendering Module

/**
 * Update timestamp display in popups
 */
function updatePopupTimestamps() {
    const popups = document.querySelectorAll('.popup-timestamp');
    popups.forEach(popup => {
        const timestamp = popup.getAttribute('data-timestamp');
        if (timestamp) {
            // formatTimestamp would come from utils module
            if (window.UtilsModule && window.UtilsModule.formatTimestamp) {
                popup.innerHTML = `<small>${window.UtilsModule.formatTimestamp(timestamp)}</small>`;
            }
        }
    });
}

/**
 * Update category counts in sidebar
 * @param {Object} counts - Category counts object
 */
function updateCategoryCounts(counts) {
    if (!counts) return;
    
    Object.keys(counts).forEach(category => {
        const countElement = document.getElementById(`category-count-${category}`);
        if (countElement) {
            countElement.textContent = counts[category] || 0;
        }
    });
}

/**
 * Update sidebar visibility
 * @param {Boolean} visible - Whether sidebar should be visible
 */
function updateSidebarVisibility(visible) {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    
    if (sidebar) {
        if (visible) {
            sidebar.classList.remove('sidebar-hidden');
            if (toggleBtn) {
                toggleBtn.textContent = '✕ Hide Categories';
                toggleBtn.setAttribute('aria-expanded', 'true');
            }
        } else {
            sidebar.classList.add('sidebar-hidden');
            if (toggleBtn) {
                toggleBtn.textContent = '☰ Show Categories';
                toggleBtn.setAttribute('aria-expanded', 'false');
            }
        }
    }
}

/**
 * Show loading state for an element
 * @param {String} elementId - Element ID
 * @param {String} message - Loading message
 * @param {Boolean} useSpinner - Whether to use spinner (default: false, uses text)
 */
function showLoading(elementId, message = 'Loading...', useSpinner = false) {
    const element = document.getElementById(elementId);
    if (element) {
        if (useSpinner) {
            element.innerHTML = `<div class="loading-spinner-container"><div class="spinner"></div></div>`;
        } else {
            element.innerHTML = `<div class="loading-placeholder">${message}</div>`;
        }
    }
}

/**
 * Show skeleton loader for a list
 * @param {String} elementId - Element ID
 * @param {Number} count - Number of skeleton items
 */
function showSkeletonLoader(elementId, count = 5) {
    const element = document.getElementById(elementId);
    if (element) {
        let html = '<div class="call-list-skeleton">';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="call-item-skeleton">
                    <div class="skeleton skeleton-avatar"></div>
                    <div class="skeleton-content">
                        <div class="skeleton skeleton-title"></div>
                        <div class="skeleton skeleton-text"></div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        element.innerHTML = html;
    }
}

/**
 * Hide loading state and show content
 * @param {String} elementId - Element ID
 * @param {String} content - Content to display
 */
function hideLoading(elementId, content = '') {
    const element = document.getElementById(elementId);
    if (element && content) {
        element.innerHTML = content;
    }
}

/**
 * Update element text content
 * @param {String} elementId - Element ID
 * @param {String} text - Text content
 */
function updateElementText(elementId, text) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
    }
}

/**
 * Update element HTML content
 * @param {String} elementId - Element ID
 * @param {String} html - HTML content
 */
function updateElementHTML(elementId, html) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = html;
    }
}

/**
 * Toggle element visibility
 * @param {String} elementId - Element ID
 * @param {Boolean} visible - Whether to show or hide
 */
function setElementVisibility(elementId, visible) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = visible ? 'block' : 'none';
    }
}

/**
 * Add CSS class to element
 * @param {String} elementId - Element ID
 * @param {String} className - CSS class name
 */
function addElementClass(elementId, className) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.add(className);
    }
}

/**
 * Remove CSS class from element
 * @param {String} elementId - Element ID
 * @param {String} className - CSS class name
 */
function removeElementClass(elementId, className) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.remove(className);
    }
}

// Export functions
if (typeof window !== 'undefined') {
    window.UIModule = {
        updatePopupTimestamps,
        updateCategoryCounts,
        updateSidebarVisibility,
        showLoading,
        hideLoading,
        showSkeletonLoader,
        updateElementText,
        updateElementHTML,
        setElementVisibility,
        addElementClass,
        removeElementClass
    };
}

