// errors.js - Error Handling and User-Friendly Messages

/**
 * Get user-friendly error message with actionable steps
 * @param {Error|String} error - Error object or message
 * @param {String} context - Context where error occurred
 * @returns {Object} - Object with message and steps
 */
function getErrorMessage(error, context = 'general') {
    const errorMessage = typeof error === 'string' ? error : (error.message || 'An unknown error occurred');
    const errorCode = error.code || error.status || null;
    
    // Map common error patterns to user-friendly messages
    const errorMappings = {
        network: {
            pattern: /network|fetch|connection|failed to fetch/i,
            message: 'Unable to connect to the server',
            steps: [
                'Check your internet connection',
                'Verify the server is running',
                'Try refreshing the page'
            ]
        },
        timeout: {
            pattern: /timeout|timed out/i,
            message: 'The request took too long',
            steps: [
                'Check your internet connection',
                'Try again in a few moments',
                'If the problem persists, the server may be busy'
            ]
        },
        notFound: {
            pattern: /404|not found/i,
            message: 'The requested resource was not found',
            steps: [
                'The item may have been removed',
                'Try refreshing the page',
                'Navigate back and try again'
            ]
        },
        unauthorized: {
            pattern: /401|unauthorized|forbidden|403/i,
            message: 'You don\'t have permission to perform this action',
            steps: [
                'You may need to log in',
                'Check if you have the required permissions',
                'Contact an administrator if you believe this is an error'
            ]
        },
        server: {
            pattern: /500|502|503|504|server error/i,
            message: 'The server encountered an error',
            steps: [
                'Try again in a few moments',
                'The server may be temporarily unavailable',
                'Contact support if the problem persists'
            ]
        },
        validation: {
            pattern: /validation|invalid|required|missing/i,
            message: 'Invalid input provided',
            steps: [
                'Check that all required fields are filled',
                'Verify the data format is correct',
                'Try again with valid input'
            ]
        }
    };
    
    // Find matching error pattern
    for (const [key, mapping] of Object.entries(errorMappings)) {
        if (mapping.pattern.test(errorMessage) || (errorCode && mapping.pattern.test(errorCode.toString()))) {
            return {
                message: mapping.message,
                steps: mapping.steps,
                originalError: errorMessage,
                type: key
            };
        }
    }
    
    // Default error response
    return {
        message: 'Something went wrong',
        steps: [
            'Try refreshing the page',
            'Check your internet connection',
            'If the problem persists, contact support'
        ],
        originalError: errorMessage,
        type: 'unknown'
    };
}

/**
 * Display error message with actionable steps
 * @param {Error|String} error - Error object or message
 * @param {String} context - Context where error occurred
 * @param {HTMLElement} container - Optional container element (default: shows notification)
 */
function showError(error, context = 'general', container = null) {
    const errorInfo = getErrorMessage(error, context);
    
    const errorHtml = `
        <div class="error-message" role="alert">
            <div class="error-message-header">
                <strong>${errorInfo.message}</strong>
                ${errorInfo.originalError && errorInfo.originalError !== errorInfo.message 
                    ? `<button class="error-details-toggle" aria-label="Show error details">Details</button>` 
                    : ''}
            </div>
            ${errorInfo.originalError && errorInfo.originalError !== errorInfo.message
                ? `<div class="error-details" style="display: none;">
                    <small>${escapeHtml(errorInfo.originalError)}</small>
                </div>`
                : ''}
            <div class="error-steps">
                <strong>Try these steps:</strong>
                <ul>
                    ${errorInfo.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
                </ul>
            </div>
        </div>
    `;
    
    if (container) {
        container.innerHTML = errorHtml;
        // Add click handler for details toggle
        const toggleBtn = container.querySelector('.error-details-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function() {
                const details = container.querySelector('.error-details');
                if (details) {
                    const isHidden = details.style.display === 'none';
                    details.style.display = isHidden ? 'block' : 'none';
                    this.textContent = isHidden ? 'Hide Details' : 'Details';
                }
            });
        }
    } else {
        // Use notification system
        if (window.showNotification) {
            window.showNotification(errorInfo.message + ': ' + errorInfo.steps[0], 'error');
        } else {
            alert(errorInfo.message + '\n\n' + errorInfo.steps.join('\n'));
        }
    }
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
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Export functions
if (typeof window !== 'undefined') {
    window.ErrorsModule = {
        getErrorMessage,
        showError
    };
}

