// modals.js - Modal Management Module

/**
 * Close a modal by ID
 * @param {String} modalId - Modal element ID
 */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        // Wait for animation to complete before hiding
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

/**
 * Open a modal by ID
 * @param {String} modalId - Modal element ID
 * @param {String} displayStyle - Display style (default: 'block')
 */
function openModal(modalId, displayStyle = 'block') {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = displayStyle;
        // Trigger reflow to ensure display change is applied
        modal.offsetHeight;
        // Add show class for animation
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    }
}

/**
 * Toggle modal visibility
 * @param {String} modalId - Modal element ID
 */
function toggleModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        if (modal.style.display === 'none' || !modal.style.display) {
            modal.style.display = 'block';
        } else {
            modal.style.display = 'none';
        }
    }
}

/**
 * Close Quick Start modal
 */
function closeQuickStartModal() {
    closeModal('quick-start-modal');
}

/**
 * Close Talkgroup modal (placeholder - actual implementation may have cleanup)
 */
function closeTalkgroupModal() {
    closeModal('talkgroup-modal');
    // Note: Actual cleanup logic for wavesurfers, etc. should be in app.js or called from there
}

/**
 * Close Live Feed modal
 */
function closeLiveFeedModal() {
    closeModal('live-feed-modal');
}

/**
 * Setup click-outside-to-close behavior for a modal
 * @param {String} modalId - Modal element ID
 */
function setupModalClickOutside(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeModal(modalId);
        }
    });
}

/**
 * Setup Escape key to close modal
 * @param {String} modalId - Modal element ID
 */
function setupModalEscapeKey(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    const handleEscape = function(e) {
        if (e.key === 'Escape' && modal.style.display !== 'none') {
            closeModal(modalId);
            document.removeEventListener('keydown', handleEscape);
        }
    };
    
    document.addEventListener('keydown', handleEscape);
}

// Export functions
if (typeof window !== 'undefined') {
    window.ModalsModule = {
        closeModal,
        openModal,
        toggleModal,
        closeQuickStartModal,
        closeTalkgroupModal,
        closeLiveFeedModal,
        setupModalClickOutside,
        setupModalEscapeKey
    };
    
    // Also make commonly used functions globally available for backward compatibility
    window.closeQuickStartModal = closeQuickStartModal;
    window.closeLiveFeedModal = closeLiveFeedModal;
}

