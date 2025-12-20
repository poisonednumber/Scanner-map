// gestures.js - Swipe Gesture Handling for Mobile

/**
 * Setup swipe gesture detection
 * @param {HTMLElement} element - Element to detect gestures on
 * @param {Object} callbacks - Callback functions { onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, onLongPress }
 */
function setupSwipeGestures(element, callbacks) {
    if (!element) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let longPressTimer = null;
    const SWIPE_THRESHOLD = 50; // Minimum distance for swipe
    const SWIPE_VELOCITY = 0.3; // Minimum velocity
    const LONG_PRESS_DURATION = 500; // ms

    element.addEventListener('touchstart', function(e) {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        startTime = Date.now();

        // Long press detection
        if (callbacks.onLongPress) {
            longPressTimer = setTimeout(() => {
                if (callbacks.onLongPress) {
                    callbacks.onLongPress(e);
                }
            }, LONG_PRESS_DURATION);
        }
    }, { passive: true });

    element.addEventListener('touchmove', function(e) {
        // Cancel long press if user moves
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: true });

    element.addEventListener('touchend', function(e) {
        // Cancel long press
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        if (!e.changedTouches || e.changedTouches.length === 0) return;

        const touch = e.changedTouches[0];
        const endX = touch.clientX;
        const endY = touch.clientY;
        const endTime = Date.now();

        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const deltaTime = endTime - startTime;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const velocity = distance / deltaTime;

        // Check if swipe meets threshold
        if (distance > SWIPE_THRESHOLD && velocity > SWIPE_VELOCITY) {
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);

            if (absX > absY) {
                // Horizontal swipe
                if (deltaX > 0 && callbacks.onSwipeRight) {
                    callbacks.onSwipeRight(e);
                } else if (deltaX < 0 && callbacks.onSwipeLeft) {
                    callbacks.onSwipeLeft(e);
                }
            } else {
                // Vertical swipe
                if (deltaY > 0 && callbacks.onSwipeDown) {
                    callbacks.onSwipeDown(e);
                } else if (deltaY < 0 && callbacks.onSwipeUp) {
                    callbacks.onSwipeUp(e);
                }
            }
        }
    }, { passive: true });
}

/**
 * Setup swipe gestures for modal (swipe down to close)
 * @param {String} modalId - Modal element ID
 */
function setupModalSwipeGestures(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    setupSwipeGestures(modal, {
        onSwipeDown: (e) => {
            // Only close if swiping from top area
            if (e.target === modal || e.target.closest('.modal-content')) {
                if (window.ModalsModule && window.ModalsModule.closeModal) {
                    window.ModalsModule.closeModal(modalId);
                }
            }
        }
    });
}

/**
 * Setup swipe gestures for tab navigation
 * @param {HTMLElement} container - Container element
 */
function setupTabSwipeNavigation(container, onSwipeLeft, onSwipeRight) {
    if (!container) return;

    setupSwipeGestures(container, {
        onSwipeLeft: onSwipeLeft,
        onSwipeRight: onSwipeRight
    });
}

// Export functions
if (typeof window !== 'undefined') {
    window.GesturesModule = {
        setupSwipeGestures,
        setupModalSwipeGestures,
        setupTabSwipeNavigation
    };
}

