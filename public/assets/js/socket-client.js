// ===== SOCKET.IO CLIENT =====

/**
 * Check if an error is a Monaco Editor 'Canceled' error
 * @param {Error} error - The error to check
 * @returns {boolean} True if it's a Monaco canceled error
 */
function isMonacoCanceledError(error) {
    return error && (
        error.message === 'Canceled' ||
        error.message === 'Canceled: Canceled' ||
        (error.message && error.message.includes('Canceled')) ||
        error.name === 'Canceled' ||
        (error.stack && error.stack.includes('monaco-editor'))
    );
}

class SocketClient extends EventEmitter {
    constructor() {
        super();
        this.socket = null;
        this.connectionStatus = 'disconnected';
        this.currentProject = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        
        // Project connection state tracking
        this.projectStates = new Map(); // projectId -> {status, readyCallbacks, lastActivity}
        
        // Browser notifications
        this.notificationPermission = 'default';
        this.checkNotificationPermission();
        
        this.setupSocket();
    }
    
    setupSocket() {
        // Initialize Socket.IO connection
        this.socket = io({
            transports: ['websocket', 'polling'], // Prefer websocket over polling
            timeout: 20000,
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay,
            reconnectionDelayMax: 5000,
            maxHttpBufferSize: 1e6, // 1MB
            pingTimeout: 60000,
            pingInterval: 25000,
            upgrade: true, // Allow transport upgrades
            rememberUpgrade: true, // Remember successful upgrades
            forceNew: false
        });
        
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        // Connection events
        this.socket.on('connect', () => {
            this.connectionStatus = 'connected';
            this.reconnectAttempts = 0;
            this.updateConnectionStatus();
            this.emit('connected');
            
        });
        
        this.socket.on('disconnect', (reason) => {
            this.connectionStatus = 'disconnected';
            this.updateConnectionStatus();
            this.emit('disconnected', reason);
            
            // Immediately show disconnection UI to prevent user from clicking around
            console.log('🔴 Socket disconnected immediately, showing disconnection UI to prevent user interactions');
            if (window.terminalManager && typeof window.terminalManager.showDisconnectionMessage === 'function') {
                window.terminalManager.showDisconnectionMessage();
            }
            
            // Mark that we're showing disconnection UI for backup recovery mechanism
            if (window.app) {
                window.app.isShowingDisconnectionUI = true;
            }
            
            if (reason === 'io server disconnect') {
                // Server initiated disconnect, try to reconnect
                this.socket.connect();
            }
        });
        
        this.socket.on('connect_error', (error) => {
            this.connectionStatus = 'error';
            this.reconnectAttempts++;
            this.updateConnectionStatus();
            this.emit('connection_error', error);
            
            // Immediately show disconnection UI on first connection error to prevent user interactions
            if (this.reconnectAttempts === 1) {
                console.log('🔴 Socket connection error, showing disconnection UI to prevent user interactions');
                if (window.terminalManager && typeof window.terminalManager.showDisconnectionMessage === 'function') {
                    window.terminalManager.showDisconnectionMessage();
                }
                
                // Mark that we're showing disconnection UI for backup recovery mechanism
                if (window.app) {
                    window.app.isShowingDisconnectionUI = true;
                }
            }
            
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.error('Failed to connect to server. Please check your connection.');
            }
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            this.connectionStatus = 'connected';
            this.reconnectAttempts = 0;
            this.updateConnectionStatus();
            this.emit('reconnected', attemptNumber);
            
            // Socket reconnected - but don't trigger page refresh here
            // Let HTTP /api/system/status handle the recovery detection and page refresh
            console.log('🟢 Socket reconnected successfully, waiting for HTTP to confirm recovery');
            
            // Rejoin current project if any with delay to ensure server is ready
            if (this.currentProject) {
                setTimeout(() => {
                    this.joinProject(this.currentProject);
                }, 1000);
            }
        });
        
        this.socket.on('reconnect_attempt', (attemptNumber) => {
            this.connectionStatus = 'reconnecting';
            this.updateConnectionStatus();
        });
        
        this.socket.on('reconnect_error', (error) => {
        });
        
        this.socket.on('reconnect_failed', () => {
            this.connectionStatus = 'failed';
            this.updateConnectionStatus();
        });
        
        // Server events
        this.socket.on('connected', (data) => {
            this.emit('server_connected', data);
            
            // Rejoin current project if we have one
            if (this.currentProject) {
                setTimeout(() => {
                    this.joinProject(this.currentProject);
                }, 1000);
            }
        });
        
        this.socket.on('error', (error) => {
            // Handle specific errors without logging
            if (error.message === 'Not connected to project' && this.currentProject) {
                setTimeout(() => {
                    this.joinProject(this.currentProject);
                }, 1000);
            } else if (error.message === 'Failed to resize terminal' && 
                      (error.details === 'Terminal session not found' || 
                       error.details === 'Terminal not active' ||
                       (error.details && error.details.includes('Terminal not active')))) {
                // Terminal session not ready yet, ignore this error
                // This can happen when switching terminals or reconnecting
            } else if (error.message && error.message.includes('Socket is not connected')) {
                // Socket connection error, already handled by connection status
            } else {
                // Log other errors
                console.error('❌ Server error:', error);
                if (notifications.isNotificationEnabled()) {
                    console.error(error.message || 'Server error occurred');
                }
            }
            
            this.emit('server_error', error);
        });
        
        
        this.socket.on('claude-notification', (notification) => {
            this.handleClaudeNotification(notification);
            this.emit('claude_notification', notification);
        });
        
        // Project events
        this.socket.on('project-status', (data) => {
            this.emit('project_status', data);
        });
        
        // Project connection events
        this.socket.on('project-ready', (data) => {
            const { projectId } = data;
            this.markProjectReady(projectId);
            this.emit('project_ready', data);
        });
        
        this.socket.on('project-disconnected', (data) => {
            const { projectId } = data;
            this.markProjectDisconnected(projectId);
            this.emit('project_disconnected', data);
        });
        
        
        // Claude Code events
        this.socket.on('claude-response', (data) => {
            this.emit('claude_response', data);
        });
        
        // Terminal session events
        this.socket.on('terminal:session-created', (data) => {
            this.emit('terminal:session-created', data);
        });
        
        this.socket.on('terminal:session-deleted', (data) => {
            this.emit('terminal:session-deleted', data);
        });
        
        this.socket.on('terminal:session-switched', (data) => {
            this.emit('terminal:session-switched', data);
        });
        
        // Terminal scroll events
        this.socket.on('terminal-scroll-result', (data) => {
            this.emit('terminal:scroll-result', data);
        });
        
        // System events
        this.socket.on('system-status', (data) => {
            this.emit('system_status', data);
        });
    }
    
    updateConnectionStatus() {
        const statusElement = DOM.get('connection-status');
        if (!statusElement) return;
        
        const indicator = statusElement.querySelector('.indicator');
        const text = statusElement.querySelector('.text');
        
        if (indicator && text) {
            // Remove all status classes
            indicator.className = 'indicator';
            
            switch (this.connectionStatus) {
                case 'connected':
                    indicator.classList.add('online');
                    text.textContent = 'Connected';
                    break;
                case 'connecting':
                case 'reconnecting':
                    indicator.classList.add('offline');
                    text.textContent = 'Connecting...';
                    break;
                case 'disconnected':
                    indicator.classList.add('offline');
                    text.textContent = 'Disconnected';
                    break;
                case 'error':
                case 'failed':
                    indicator.classList.add('offline');
                    text.textContent = 'Connection Failed';
                    break;
                default:
                    indicator.classList.add('offline');
                    text.textContent = 'Unknown';
            }
        }
    }
    
    
    handleClaudeNotification(notification) {
        const { sessionId, projectName, message, title, timestamp } = notification;
        
        // Only process if in-app notifications are enabled
        if (!notifications.isNotificationEnabled()) {
            return;
        }
        
        // Attempt to show browser notification first
        const browserResult = this.showBrowserNotification(title, message, projectName);
        
        if (browserResult.success) {
            // Browser notification succeeded, show brief in-app notification
            notifications.warning(message, { 
                title: title, 
                duration: 5000 // Auto-dismiss after 5 seconds
            });
        } else {
            // Browser notification failed, handle based on error type
            switch (browserResult.error) {
                case 'PERMISSION_REQUIRED':
                    // Try to request permission and retry
                    this.handlePermissionRequiredForClaude(title, message, projectName);
                    break;
                    
                case 'PERMISSION_DENIED':
                    // Show persistent warning about missed notifications
                    notifications.warning(
                        `${message}\n\nBrowser notifications are blocked. You may miss important Claude Code notifications. Please enable them in browser settings.`, 
                        { 
                            title: title,
                            duration: 0 // Persistent until manually closed
                        }
                    );
                    break;
                    
                case 'UNSUPPORTED':
                case 'CREATE_FAILED':
                default:
                    // Show persistent error with technical details
                    notifications.error(
                        `${message}\n\nBrowser notification failed: ${browserResult.message}. You may miss Claude Code notifications if this issue is not resolved.`, 
                        { 
                            title: title,
                            duration: 0 // Persistent until manually closed
                        }
                    );
                    break;
            }
        }
    }
    
    handlePermissionRequiredForClaude(title, message, projectName) {
        // Request notification permission specifically for Claude notifications
        if ('Notification' in window) {
            Notification.requestPermission().then(permission => {
                this.notificationPermission = permission;
                
                if (permission === 'granted') {
                    // Permission granted, retry browser notification
                    const retryResult = this.showBrowserNotification(title, message, projectName);
                    
                    if (retryResult.success) {
                        // Success after permission grant, show brief in-app notification
                        notifications.success(
                            `${message}\n\nBrowser notifications are now enabled for Claude Code.`, 
                            { 
                                title: title,
                                duration: 5000
                            }
                        );
                    } else {
                        // Still failed even with permission, show persistent error
                        notifications.error(
                            `${message}\n\nBrowser notification still failed: ${retryResult.message}. Please check your browser settings.`, 
                            { 
                                title: title,
                                duration: 0
                            }
                        );
                    }
                } else {
                    // Permission denied or dismissed, show persistent warning
                    notifications.warning(
                        `${message}\n\nBrowser notification permission was denied. You will miss important Claude Code notifications unless you enable them manually in browser settings.`, 
                        { 
                            title: title,
                            duration: 0 // Persistent until manually closed
                        }
                    );
                }
            }).catch(error => {
                // Permission request failed
                notifications.error(
                    `${message}\n\nFailed to request browser notification permission: ${error.message}. You may miss Claude Code notifications.`, 
                    { 
                        title: title,
                        duration: 0
                    }
                );
            });
        } else {
            // Notification API not supported
            notifications.error(
                `${message}\n\nBrowser notifications are not supported. You may miss important Claude Code notifications.`, 
                { 
                    title: title,
                    duration: 0
                }
            );
        }
    }
    
    checkNotificationPermission() {
        if ('Notification' in window) {
            this.notificationPermission = Notification.permission;
        }
    }
    
    
    requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                // Show a notification request dialog
                if (notifications.isNotificationEnabled()) {
                    notifications.info('Please allow browser notifications to receive important Claude Code messages', {
                        title: 'Notification Permission Request',
                        duration: 0
                    });
                }
                
                Notification.requestPermission().then(permission => {
                    this.notificationPermission = permission;
                    
                    if (permission === 'granted') {
                        // Show in-app message about browser notification success (if in-app notifications enabled)
                        if (notifications.isNotificationEnabled()) {
                            notifications.success('Browser notifications enabled! You can now receive notifications even when away from the page', {
                                title: 'Notification Permission Granted',
                                duration: 3000
                            });
                        }
                        
                        // Test browser notification (independent of in-app notification settings)
                        this.showBrowserNotification('Vibe Code Distiller', 'Browser notifications enabled!', 'System');
                    } else if (permission === 'denied') {
                        // Show in-app message about browser notification denial (if in-app notifications enabled)
                        if (notifications.isNotificationEnabled()) {
                            notifications.warning('Browser notifications denied. You can manually enable notifications in browser settings', {
                                title: 'Notification Permission Denied',
                                duration: 5000
                            });
                        }
                    }
                });
            } else {
                this.notificationPermission = Notification.permission;
            }
        }
    }
    
    showBrowserNotification(title, message, projectName) {
        // Browser notifications are independent of in-app notification settings
        // Return object with success status and error details
        
        try {
            // Check if Notification API is supported
            if (!('Notification' in window)) {
                return {
                    success: false,
                    error: 'UNSUPPORTED',
                    message: 'Browser notifications are not supported in this browser'
                };
            }
            
            // Check permission status
            if (this.notificationPermission === 'denied') {
                return {
                    success: false,
                    error: 'PERMISSION_DENIED',
                    message: 'Browser notifications are blocked. Please enable them in browser settings'
                };
            }
            
            if (this.notificationPermission !== 'granted') {
                return {
                    success: false,
                    error: 'PERMISSION_REQUIRED',
                    message: 'Browser notification permission is required'
                };
            }
            
            // Attempt to create notification
            const notificationTitle = title;
            const notificationOptions = {
                body: message,
                icon: '/favicon.ico',
                badge: '/favicon.ico',
                tag: 'claude-notification',
                requireInteraction: true,
                timestamp: Date.now()
            };
            
            const notification = new Notification(notificationTitle, notificationOptions);
            
            // Handle notification events
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            
            notification.onerror = (error) => {
                console.error('Browser notification error:', error);
            };
            
            // Auto-close after 10 seconds
            setTimeout(() => {
                notification.close();
            }, 10000);
            
            return {
                success: true,
                notification: notification
            };
            
        } catch (error) {
            console.error('Failed to create browser notification:', error);
            return {
                success: false,
                error: 'CREATE_FAILED',
                message: `Failed to create browser notification: ${error.message}`
            };
        }
    }
    
    // Connection methods
    connect() {
        if (this.socket.disconnected) {
            this.socket.connect();
        }
    }
    
    disconnect() {
        if (this.socket.connected) {
            this.socket.disconnect();
        }
    }
    
    isConnected() {
        return this.socket && this.socket.connected;
    }
    
    getConnectionStatus() {
        return this.connectionStatus;
    }
    
    // Project methods
    joinProject(projectId) {
        if (!this.isConnected()) {
            console.warn('Cannot join project: not connected to server');
            return false;
        }
        
        this.currentProject = projectId;
        this.socket.emit('join-project', { projectId });
        return true;
    }
    
    leaveProject(projectId = null) {
        if (!this.isConnected()) {
            console.warn('Cannot leave project: not connected to server');
            return false;
        }
        
        const targetProjectId = projectId || this.currentProject;
        if (targetProjectId) {
            this.socket.emit('leave-project', { projectId: targetProjectId });
            
            if (targetProjectId === this.currentProject) {
                this.currentProject = null;
            }
        }
        return true;
    }
    
    getCurrentProject() {
        return this.currentProject;
    }
    
    
    // Claude Code methods
    sendClaudeCommand(projectId, command, context = {}) {
        if (!this.isConnected()) {
            console.warn('Cannot send Claude command: not connected to server');
            return false;
        }
        
        this.socket.emit('claude-command', { projectId, command, context });
        return true;
    }
    
    // Project action methods
    sendProjectAction(projectId, action, payload = {}) {
        if (!this.isConnected()) {
            console.warn('Cannot send project action: not connected to server');
            return false;
        }
        
        this.socket.emit('project-action', { projectId, action, payload });
        return true;
    }
    
    startClaude(projectId, options = {}) {
        return this.sendProjectAction(projectId, 'start_claude', options);
    }
    
    stopClaude(projectId, force = false) {
        return this.sendProjectAction(projectId, 'stop_claude', { force });
    }
    
    createTerminalSession(projectName, projectPath, options = {}) {
        if (!this.isConnected()) {
            console.warn('Cannot create terminal session: not connected to server');
            return false;
        }
        
        const sessionData = {
            projectName,
            projectPath,
            cols: options.cols || 80,
            rows: options.rows || 24,
            sessionName: options.sessionName || null
        };
        
        this.socket.emit('terminal:create-project-session', sessionData);
        return true;
    }
    
    deleteTerminalSession(sessionName) {
        if (!this.isConnected()) {
            console.warn('Cannot delete terminal session: not connected to server');
            return false;
        }
        
        this.socket.emit('terminal:delete-session', { sessionName });
        return true;
    }
    
    switchTerminalSession(sessionName, currentSessionName = null) {
        if (!this.isConnected()) {
            console.warn('Cannot switch terminal session: not connected to server');
            return false;
        }
        
        this.socket.emit('terminal:switch-session', { 
            sessionName, 
            currentSessionName 
        });
        return true;
    }
    
    async getTerminalSessions() {
        try {
            const response = await fetch('/api/sessions');
            const data = await response.json();
            
            if (data.success) {
                return data.sessions;
            } else {
                console.error('Failed to get terminal sessions:', data.error);
                return [];
            }
        } catch (error) {
            console.error('Error fetching terminal sessions:', error);
            return [];
        }
    }
    
    // Utility methods
    getSocket() {
        return this.socket;
    }
    
    // Event handler shortcuts
    
    onClaudeResponse(callback) {
        return this.on('claude_response', callback);
    }
    
    onProjectStatus(callback) {
        return this.on('project_status', callback);
    }
    
    onSystemStatus(callback) {
        return this.on('system_status', callback);
    }
    
    onNotification(callback) {
        return this.on('notification', callback);
    }
    
    onConnected(callback) {
        return this.on('connected', callback);
    }
    
    onDisconnected(callback) {
        return this.on('disconnected', callback);
    }
    
    onReconnected(callback) {
        return this.on('reconnected', callback);
    }
    
    onConnectionError(callback) {
        return this.on('connection_error', callback);
    }
    
    onTerminalSessionCreated(callback) {
        return this.on('terminal:session-created', callback);
    }
    
    onTerminalSessionDeleted(callback) {
        return this.on('terminal:session-deleted', callback);
    }
    
    onTerminalSessionSwitched(callback) {
        return this.on('terminal:session-switched', callback);
    }
    
    
    
    getDebugInfo() {
        return {
            connected: this.isConnected(),
            status: this.connectionStatus,
            currentProject: this.currentProject,
            reconnectAttempts: this.reconnectAttempts,
            socketId: this.socket?.id,
            transport: this.socket?.io?.engine?.transport?.name
        };
    }
    
    // Project connection state management
    isProjectReady(projectId) {
        const state = this.projectStates.get(projectId);
        return state && state.status === 'ready';
    }
    
    ensureProjectConnection(projectId, callback, timeout = 5000) {
        const state = this.projectStates.get(projectId) || { 
            status: 'disconnected', 
            readyCallbacks: [], 
            lastActivity: Date.now() 
        };
        
        this.projectStates.set(projectId, state);
        
        if (state.status === 'ready') {
            callback();
            return;
        }
        
        // Add callback to queue
        if (callback) {
            state.readyCallbacks.push({
                callback,
                timestamp: Date.now(),
                timeout: setTimeout(() => {
                    console.error(`Project connection timeout for ${projectId}`);
                    this.emit('error', new Error(`Project connection timeout: ${projectId}`));
                }, timeout)
            });
        }
        
        // If already connecting, just wait
        if (state.status === 'connecting') {
            return;
        }
        
        // Start connection process
        state.status = 'connecting';
        
        this.joinProject(projectId);
        
        // Set a backup timeout to mark as ready if no confirmation received
        setTimeout(() => {
            if (state.status === 'connecting') {
                this.markProjectReady(projectId);
            }
        }, 2000);
    }
    
    markProjectReady(projectId) {
        const state = this.projectStates.get(projectId);
        if (!state) return;
        
        state.status = 'ready';
        state.lastActivity = Date.now();
        // Execute queued callbacks
        while (state.readyCallbacks.length > 0) {
            const { callback, timeout } = state.readyCallbacks.shift();
            clearTimeout(timeout);
            try {
                callback();
            } catch (error) {
                console.error('Error executing ready callback:', error);
            }
        }
        
    }
    
    markProjectDisconnected(projectId) {
        const state = this.projectStates.get(projectId);
        if (state) {
            state.status = 'disconnected';
            // Clear any pending callbacks
            while (state.readyCallbacks.length > 0) {
                const { timeout } = state.readyCallbacks.shift();
                clearTimeout(timeout);
            }
        }
    }
}

// Error handling for WebSocket events
class SocketErrorHandler {
    constructor(socketClient) {
        this.client = socketClient;
        this.setupErrorHandling();
    }
    
    setupErrorHandling() {
        // Handle specific error types
        this.client.on('server_error', (error) => {
            this.handleServerError(error);
        });
        
        this.client.on('connection_error', (error) => {
            this.handleConnectionError(error);
        });
        
        // Global error handler (temporarily re-enabled for debugging)
        window.addEventListener('unhandledrejection', (event) => {
            if (event.reason && event.reason.message) {
                console.error('Unhandled promise rejection:', event.reason);
                this.handleGenericError(event.reason);
            }
        });
    }
    
    handleServerError(error) {
        if (!notifications.isNotificationEnabled()) {
            return;
        }
        
        const { code, message, details } = error;
        
        switch (code) {
            case 'UNAUTHORIZED':
                console.error('Authentication required. Please login again.');
                // Redirect to login or show auth modal
                break;
            case 'PROJECT_NOT_FOUND':
                console.error('Project not found. It may have been deleted.');
                break;
            case 'CLAUDE_SESSION_FAILED':
                console.error('Failed to start Claude session. Please try again.');
                break;
            case 'TERMINAL_CREATE_FAILED':
                console.error('Failed to create terminal session.');
                break;
            case 'SYSTEM_OVERLOAD':
                console.warn('System is overloaded. Please wait and try again.');
                break;
            default:
                console.error(message || 'An error occurred on the server.');
        }
    }
    
    handleConnectionError(error) {
        console.error('Connection error:', error);
        
        if (!notifications.isNotificationEnabled()) {
            return;
        }
        
        if (error.message.includes('ECONNREFUSED')) {
            console.error('Cannot connect to server. Please check if the server is running.');
        } else if (error.message.includes('timeout')) {
            console.warn('Connection timeout. Please check your internet connection.');
        } else {
            console.error('Connection error occurred. Trying to reconnect...');
        }
    }
    
    handleGenericError(error) {
        console.error('Generic error:', error);
        // Only show notification for critical errors
        if ((error.message.includes('socket') || error.message.includes('connection')) && notifications.isNotificationEnabled()) {
            console.error('A connection error occurred.');
        }
    }
}

// Heartbeat monitor to ensure connection health
class ConnectionMonitor {
    constructor(socketClient) {
        this.client = socketClient;
        this.heartbeatInterval = null;
        this.lastPong = Date.now();
        this.pingTimeout = 120000; // 120 seconds
        
        this.setupMonitoring();
    }
    
    setupMonitoring() {
        this.client.on('connected', () => {
            this.startHeartbeat();
        });
        
        this.client.on('disconnected', () => {
            this.stopHeartbeat();
        });
        
        // Listen for pong responses
        this.client.getSocket().on('pong', () => {
            this.lastPong = Date.now();
        });
    }
    
    startHeartbeat() {
        this.stopHeartbeat(); // Clear any existing interval
        
        this.heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastPong = now - this.lastPong;
            
            if (timeSinceLastPong > this.pingTimeout) {
                // Connection heartbeat timeout detected, but preserving connection for terminal persistence
                // Reset lastPong to prevent repeated warnings
                this.lastPong = now;
            }
            
            // Always send ping regardless of timeout status
            this.client.getSocket().emit('ping');
        }, 60000); // Check every 60 seconds
    }
    
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}

// Initialize socket client
const socketClient = new SocketClient();
const socketErrorHandler = new SocketErrorHandler(socketClient);
const connectionMonitor = new ConnectionMonitor(socketClient);

// Make socket client globally available
window.socket = socketClient;

// Export for other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SocketClient, SocketErrorHandler, ConnectionMonitor };
}