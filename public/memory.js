// memory.js - Memory Management Utilities

// Track intervals and timeouts for cleanup
const trackedIntervals = new Set();
const trackedTimeouts = new Set();

/**
 * Create a tracked interval that can be cleaned up
 * @param {Function} callback - Callback function
 * @param {Number} delay - Delay in milliseconds
 * @returns {Number} - Interval ID
 */
function createTrackedInterval(callback, delay) {
    const id = setInterval(callback, delay);
    trackedIntervals.add(id);
    return id;
}

/**
 * Clear a tracked interval
 * @param {Number} id - Interval ID
 */
function clearTrackedInterval(id) {
    if (trackedIntervals.has(id)) {
        clearInterval(id);
        trackedIntervals.delete(id);
    }
}

/**
 * Create a tracked timeout that can be cleaned up
 * @param {Function} callback - Callback function
 * @param {Number} delay - Delay in milliseconds
 * @returns {Number} - Timeout ID
 */
function createTrackedTimeout(callback, delay) {
    const id = setTimeout(callback, delay);
    trackedTimeouts.add(id);
    return id;
}

/**
 * Clear a tracked timeout
 * @param {Number} id - Timeout ID
 */
function clearTrackedTimeout(id) {
    if (trackedTimeouts.has(id)) {
        clearTimeout(id);
        trackedTimeouts.delete(id);
    }
}

/**
 * Clean up all tracked intervals and timeouts
 */
function cleanupAllTimers() {
    trackedIntervals.forEach(id => clearInterval(id));
    trackedTimeouts.forEach(id => clearTimeout(id));
    trackedIntervals.clear();
    trackedTimeouts.clear();
}

/**
 * Clean up event listeners from an element
 * @param {HTMLElement} element - Element to clean up
 * @param {String} eventType - Event type (optional, if not provided cleans all)
 */
function cleanupEventListeners(element, eventType = null) {
    if (!element) return;
    
    // Clone element to remove all listeners (harsh but effective)
    const newElement = element.cloneNode(true);
    if (element.parentNode) {
        element.parentNode.replaceChild(newElement, element);
    }
}

/**
 * Remove event listener safely
 * @param {HTMLElement} element - Element
 * @param {String} eventType - Event type
 * @param {Function} handler - Event handler
 */
function removeEventListenerSafe(element, eventType, handler) {
    if (element && handler) {
        element.removeEventListener(eventType, handler);
    }
}

// Export functions
if (typeof window !== 'undefined') {
    window.MemoryModule = {
        createTrackedInterval,
        clearTrackedInterval,
        createTrackedTimeout,
        clearTrackedTimeout,
        cleanupAllTimers,
        cleanupEventListeners,
        removeEventListenerSafe
    };
}

