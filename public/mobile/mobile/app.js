// WebSocket connection
let ws = null;
let reconnectTimeout = null;
let isConnected = false;

// State
let planMode = false;
let thinkingMode = false;
let isProcessing = false;
let currentFiles = [];
let filePickerCallback = null;
let selectedFileIndex = -1;
let allSlashCommands = [];
let filteredSlashCommands = [];
let selectedCommandIndex = -1;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    setupEventListeners();
    loadTheme();
    adjustInputHeight();
    setupScrollDetection();
});

// Add scroll detection for header elevation
function setupScrollDetection() {
    const header = document.getElementById('appHeader');
    const messages = document.getElementById('messages');
    
    if (messages && header) {
        messages.addEventListener('scroll', () => {
            if (messages.scrollTop > 10) {
                header.classList.add('elevated');
            } else {
                header.classList.remove('elevated');
            }
        });
    }
}

// Copy message function
function copyMessage(btn) {
    const messageContent = btn.closest('.message').querySelector('.message-content');
    const text = messageContent.textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

// WebSocket Connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        isConnected = true;
        updateConnectionStatus(true);
        clearReconnectTimeout();
        
        // Load settings
        ws.send(JSON.stringify({ type: 'getSettings' }));
        
        // Check for resumed session
        const messages = document.getElementById('messages');
        if (messages.children.length === 1) { // Only welcome message
            ws.send(JSON.stringify({ type: 'getConversationList' }));
        }
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        isConnected = false;
        updateConnectionStatus(false);
        scheduleReconnect();
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showToast('Connection error', 'error');
    };
}

function scheduleReconnect() {
    clearReconnectTimeout();
    reconnectTimeout = setTimeout(() => {
        console.log('Attempting to reconnect...');
        connectWebSocket();
    }, 3000);
}

function clearReconnectTimeout() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

function updateConnectionStatus(connected) {
    const indicator = document.getElementById('statusIndicator');
    if (connected) {
        indicator.classList.remove('offline');
    } else {
        indicator.classList.add('offline');
    }
}

// Message Handling
function handleMessage(message) {
    switch (message.type) {
        case 'connected':
            console.log('Connected to server');
            break;
            
        case 'sessionResumed':
            handleSessionResumed(message.data);
            break;
            
        case 'projectSwitched':
            console.log('Project switched:', message.data);
            showToast(`Switched to: ${message.data.projectName}`, 'info');
            // Clear messages and reload interface
            document.querySelector('.messages-inner').innerHTML = `
                <div class="welcome-message">
                    <h2>Welcome to ${message.data.projectName}</h2>
                    <p>Start a conversation or load a previous session</p>
                </div>
            `;
            break;
            
        case 'userInput':
            addMessage(message.data, 'user');
            break;
            
        case 'output':
            addMessage(message.data, 'assistant');
            break;
            
        case 'thinking':
            addMessage(message.data, 'thinking');
            break;
            
        case 'error':
            addMessage(message.data, 'error');
            break;
            
        case 'system':
            addMessage(message.data, 'system');
            break;
            
        case 'toolUse':
            addToolMessage(message.data);
            break;
            
        case 'toolResult':
            addToolResultMessage(message.data);
            break;
            
        case 'sessionInfo':
            updateSessionInfo(message.data);
            break;
            
        case 'updateTokens':
        case 'updateTotals':
            updateStats(message.data);
            break;
            
        case 'setProcessing':
            setProcessing(message.data.isProcessing);
            break;
            
        case 'sessionCleared':
            clearMessages();
            showToast('New session started');
            break;
            
        case 'conversationList':
            showConversationList(message.data);
            break;
            
        case 'workspaceFiles':
            updateFilesList(message.data);
            break;
            
        case 'settings':
            updateSettings(message.data);
            break;
            
        case 'permissionRequest':
            showPermissionDialog(message.data);
            break;
            
        case 'permissions':
            updatePermissionsList(message.data);
            break;
            
        default:
            console.log('Unknown message type:', message.type);
    }
}

// UI Functions
function addMessage(content, type = 'assistant') {
    const messages = document.getElementById('messages');
    let messagesInner = messages.querySelector('.messages-inner');
    
    // Create messages-inner if it doesn't exist
    if (!messagesInner) {
        messagesInner = document.createElement('div');
        messagesInner.className = 'messages-inner';
        messages.appendChild(messagesInner);
    }
    
    // Remove welcome message if exists
    const welcome = messagesInner.querySelector('.welcome-message');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.innerHTML = parseMarkdown(content);
    messageDiv.appendChild(messageContent);
    
    // Add hover actions for user/assistant messages
    if (type === 'user' || type === 'assistant') {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        actions.innerHTML = `
            <button class="message-action-btn" onclick="copyMessage(this)" aria-label="Copy">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
            </button>
        `;
        messageDiv.appendChild(actions);
    }
    
    messagesInner.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;
}

function addToolMessage(data) {
    const messages = document.getElementById('messages');
    let messagesInner = messages.querySelector('.messages-inner');
    
    if (!messagesInner) {
        messagesInner = document.createElement('div');
        messagesInner.className = 'messages-inner';
        messages.appendChild(messagesInner);
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message tool-use';
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    // Create tool header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'tool-header';
    headerDiv.innerHTML = `
        <svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="tool-name">${data.toolInfo}</span>
    `;
    messageContent.appendChild(headerDiv);
    
    // Show tool input
    if (data.toolInput || data.rawInput) {
        const inputDiv = document.createElement('div');
        inputDiv.className = 'tool-input';
        
        if (data.toolInput && data.toolName === 'TodoWrite') {
            // Special formatting for TodoWrite - already formatted
            inputDiv.innerHTML = `<pre>${data.toolInput}</pre>`;
        } else if (data.rawInput) {
            // Show raw input for other tools
            const inputStr = JSON.stringify(data.rawInput, null, 2);
            if (inputStr.length > 500) {
                // Truncate long inputs
                inputDiv.innerHTML = `<pre>${inputStr.substring(0, 500)}...</pre>`;
            } else {
                inputDiv.innerHTML = `<pre>${inputStr}</pre>`;
            }
        }
        
        messageContent.appendChild(inputDiv);
    }
    
    messageDiv.appendChild(messageContent);
    messagesInner.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;
}

function addToolResultMessage(data) {
    const messages = document.getElementById('messages');
    let messagesInner = messages.querySelector('.messages-inner');
    
    if (!messagesInner) {
        messagesInner = document.createElement('div');
        messagesInner.className = 'messages-inner';
        messages.appendChild(messagesInner);
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message tool-result ${data.isError ? 'error' : ''}`;
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    const content = data.content.substring(0, 500) + (data.content.length > 500 ? '...' : '');
    messageContent.textContent = content;
    
    messageDiv.appendChild(messageContent);
    messagesInner.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;
}

function clearMessages() {
    const messages = document.getElementById('messages');
    messages.innerHTML = `
        <div class="messages-inner">
            <div class="welcome-message">
                <h2>Welcome to Claude Chat</h2>
                <p>Start a conversation or load a previous session</p>
            </div>
        </div>
    `;
}

function setProcessing(processing) {
    isProcessing = processing;
    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    const input = document.getElementById('messageInput');
    
    if (processing) {
        sendBtn.style.display = 'none';
        stopBtn.style.display = 'flex';
        input.disabled = true;
    } else {
        sendBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        input.disabled = false;
        input.focus();
    }
}

// Send Message
function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || !isConnected || isProcessing) return;
    
    // Check for slash commands
    if (text.startsWith('/')) {
        const parts = text.split(' ');
        const command = parts[0];
        const args = parts.slice(1).join(' ');
        
        if (executeSlashCommand(command, args)) {
            input.value = '';
            adjustInputHeight();
            return;
        }
    }
    
    ws.send(JSON.stringify({
        type: 'sendMessage',
        text: text,
        planMode: planMode,
        thinkingMode: thinkingMode
    }));
    
    input.value = '';
    adjustInputHeight();
}

// Stop Request
function stopRequest() {
    if (!isConnected || !isProcessing) return;
    
    ws.send(JSON.stringify({
        type: 'stopRequest'
    }));
    
    showToast('Stopping request...', 'info');
}

// Session Management
function newSession() {
    if (!isConnected) return;
    
    if (confirm('Start a new session? Current conversation will be saved.')) {
        ws.send(JSON.stringify({ type: 'newSession' }));
        closeSidebar();
    }
}

function handleSessionResumed(data) {
    updateStats(data);
    showToast('Session resumed');
}

function updateSessionInfo(data) {
    // Update session display if needed
}

function updateStats(data) {
    // Token and cost display removed from UI - just log for debugging
    if (data.totalTokensInput !== undefined || data.totalTokensOutput !== undefined) {
        console.log('Token usage:', {
            input: data.totalTokensInput,
            output: data.totalTokensOutput,
            total: (data.totalTokensInput || 0) + (data.totalTokensOutput || 0)
        });
    }
    
    if (data.totalCost !== undefined) {
        console.log('Total cost:', `$${data.totalCost.toFixed(4)}`);
    }
    
    // Show detailed token breakdown if available
    if (data.currentInputTokens || data.currentOutputTokens) {
        const currentTotal = (data.currentInputTokens || 0) + (data.currentOutputTokens || 0);
        if (currentTotal > 0) {
            let tokenMessage = `Tokens: ${currentTotal.toLocaleString()}`;
            
            // Add cache info if available
            if (data.cacheCreationTokens || data.cacheReadTokens) {
                const cacheInfo = [];
                if (data.cacheCreationTokens) {
                    cacheInfo.push(`${data.cacheCreationTokens.toLocaleString()} cache created`);
                }
                if (data.cacheReadTokens) {
                    cacheInfo.push(`${data.cacheReadTokens.toLocaleString()} cache read`);
                }
                tokenMessage += ` • ${cacheInfo.join(' • ')}`;
            }
            
            addMessage(tokenMessage, 'system');
        }
    }
}

// Sidebar Functions
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('open');
}

// History
function showHistory() {
    closeSidebar();
    
    if (!isConnected) {
        showToast('Not connected', 'error');
        return;
    }
    
    ws.send(JSON.stringify({ type: 'getConversationList' }));
    openModal('historyModal');
}

function showConversationList(conversations) {
    const historyList = document.getElementById('historyList');
    
    console.log('Received conversations:', conversations);
    
    if (!conversations || conversations.length === 0) {
        historyList.innerHTML = '<p>No conversation history</p>';
        return;
    }
    
    historyList.innerHTML = conversations.map(conv => {
        const date = new Date(conv.endTime || conv.startTime);
        const timeStr = date.toLocaleString();
        
        console.log('Rendering conversation:', conv);
        
        return `
            <div class="history-item" onclick="loadConversation('${conv.sessionId}')">
                <div class="history-title">${conv.title || 'Untitled Conversation'}</div>
                <div class="history-meta">
                    <span>${timeStr}</span>
                    <span>${conv.messageCount} messages</span>
                </div>
            </div>
        `;
    }).join('');
}

function loadConversation(sessionId) {
    if (!isConnected) return;
    
    ws.send(JSON.stringify({
        type: 'loadConversation',
        sessionId: sessionId
    }));
    
    closeModal('historyModal');
}

// File list update
function updateFilesList(files) {
    currentFiles = files;
    renderFileList(files);
}

function selectFile(index) {
    const file = currentFiles[index];
    const input = document.getElementById('messageInput');
    
    input.value += ` @${file.path} `;
    closeModal('filesModal');
    input.focus();
}

// Removed attachFile function - feature removed

// Settings
function showSettings() {
    closeSidebar();
    openModal('settingsModal');
}

function updateSettings(settings) {
    if (settings.selectedModel) {
        document.getElementById('modelSelect').value = settings.selectedModel;
    }
}

function changeModel(model) {
    if (!isConnected) return;
    
    ws.send(JSON.stringify({
        type: 'selectModel',
        model: model
    }));
    
    showToast('Model changed');
}

function changeTheme(theme) {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
}

function loadTheme() {
    const theme = localStorage.getItem('theme') || 'auto';
    document.getElementById('themeSelect').value = theme;
    applyTheme(theme);
}

function applyTheme(theme) {
    const root = document.documentElement;
    
    // Let CSS handle theme switching based on prefers-color-scheme
    // The new CSS already has proper dark mode support
    localStorage.setItem('theme', theme);
    
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
        root.setAttribute('data-theme', 'light');
    } else {
        root.removeAttribute('data-theme');
    }
}

// Quick Actions
function togglePlanMode() {
    planMode = !planMode;
    const button = document.getElementById('planModeBtn');
    
    if (planMode) {
        button.classList.add('active');
    } else {
        button.classList.remove('active');
    }
}

function toggleThinkingMode() {
    thinkingMode = !thinkingMode;
    const button = document.getElementById('thinkingModeBtn');
    
    if (thinkingMode) {
        button.classList.add('active');
    } else {
        button.classList.remove('active');
    }
}

// Removed voice input function - feature removed

// Modal Functions
function openModal(modalId) {
    document.getElementById(modalId).classList.add('open');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('open');
}

// Toast Notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Utilities
function parseMarkdown(text) {
    // Simple markdown parsing
    return text
        .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

function adjustInputHeight() {
    const input = document.getElementById('messageInput');
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    
    // Update input area height CSS variable
    const inputArea = document.querySelector('.input-area');
    document.documentElement.style.setProperty('--input-area-height', inputArea.offsetHeight + 'px');
}

// Event Listeners
function setupEventListeners() {
    const input = document.getElementById('messageInput');
    
    input.addEventListener('input', adjustInputHeight);
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
        // Trigger file picker on @ key
        if (e.key === '@') {
            setTimeout(() => {
                const cursorPos = input.selectionStart;
                const textBefore = input.value.substring(0, cursorPos);
                // Check if @ is at word boundary
                if (textBefore.length === 1 || /\s$/.test(textBefore.slice(-2, -1))) {
                    showFilePicker();
                }
            }, 0);
        }
        // Trigger slash commands on / key
        if (e.key === '/') {
            setTimeout(() => {
                const cursorPos = input.selectionStart;
                const textBefore = input.value.substring(0, cursorPos);
                // Check if / is at start or after whitespace
                if (textBefore.length === 1 || /\s$/.test(textBefore.slice(-2, -1))) {
                    showSlashCommands();
                }
            }, 0);
        }
    });
    
    // Add keyboard navigation for file picker
    const fileSearch = document.getElementById('fileSearch');
    fileSearch.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedFileIndex = Math.min(selectedFileIndex + 1, currentFiles.length - 1);
            renderFileList(currentFiles);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedFileIndex = Math.max(selectedFileIndex - 1, -1);
            renderFileList(currentFiles);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedFileIndex >= 0) {
                selectFileAtIndex(selectedFileIndex);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal('filesModal');
        }
    });
    
    // Add keyboard navigation for slash commands
    const slashSearch = document.getElementById('slashSearch');
    slashSearch.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedCommandIndex = Math.min(selectedCommandIndex + 1, filteredSlashCommands.length - 1);
            renderSlashCommands();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedCommandIndex = Math.max(selectedCommandIndex - 1, -1);
            renderSlashCommands();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedCommandIndex >= 0) {
                selectSlashCommand(filteredSlashCommands[selectedCommandIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal('slashCommandsModal');
        }
    });
    
    // Handle clicks outside modals
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('open');
            }
        });
    });
    
    // Handle swipe gestures
    let touchStartX = 0;
    let touchEndX = 0;
    
    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    });
    
    document.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });
    
    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchEndX - touchStartX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0 && touchStartX < 50) {
                // Swipe right from left edge
                toggleSidebar();
            } else if (diff < 0) {
                // Swipe left
                closeSidebar();
            }
        }
    }
    
    // Handle theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const theme = localStorage.getItem('theme') || 'auto';
        if (theme === 'auto') {
            applyTheme('auto');
        }
    });
}

// Permission Dialog Functions
function showPermissionDialog(data) {
    const messages = document.getElementById('messages');
    let messagesInner = messages.querySelector('.messages-inner');
    
    if (!messagesInner) {
        messagesInner = document.createElement('div');
        messagesInner.className = 'messages-inner';
        messages.appendChild(messagesInner);
    }
    
    const permissionDiv = document.createElement('div');
    permissionDiv.className = 'permission-request';
    permissionDiv.id = `permission-${data.id}`;
    
    permissionDiv.innerHTML = `
        <div class="permission-header">
            <svg class="permission-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="24" height="24">
                <path d="M12 2L2 7v5c0 5.6 3.9 10.8 9 12 5.1-1.2 9-6.4 9-12V7l-10-5z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 11v4M12 8v.01" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="permission-title">Permission Request</span>
        </div>
        <div class="permission-details">
            <div class="permission-tool">Tool: ${data.tool}</div>
            <div class="permission-command">${data.command || 'Execute tool'}</div>
        </div>
        <div class="permission-actions">
            <button class="permission-btn deny" onclick="respondToPermission('${data.id}', false)">
                Deny
            </button>
            <button class="permission-btn allow" onclick="respondToPermission('${data.id}', true, false)">
                Allow Once
            </button>
            <button class="permission-btn always-allow" onclick="respondToPermission('${data.id}', true, true)">
                Always Allow
            </button>
        </div>
    `;
    
    messagesInner.appendChild(permissionDiv);
    messages.scrollTop = messages.scrollHeight;
}

function respondToPermission(id, approved, alwaysAllow) {
    // Send response
    ws.send(JSON.stringify({
        type: 'permissionResponse',
        id: id,
        approved: approved,
        alwaysAllow: alwaysAllow
    }));
    
    // Update UI
    const permissionDiv = document.getElementById(`permission-${id}`);
    if (permissionDiv) {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'permission-result';
        resultDiv.textContent = approved ? 'Allowed' : 'Denied';
        permissionDiv.appendChild(resultDiv);
        
        // Disable buttons
        permissionDiv.querySelectorAll('button').forEach(btn => btn.disabled = true);
    }
}

function updatePermissionsList(permissions) {
    // This will be used in settings modal later
    console.log('Current permissions:', permissions);
}

// File Picker Functions
function showFilePicker() {
    // Request workspace files from backend
    ws.send(JSON.stringify({
        type: 'getWorkspaceFiles',
        searchTerm: ''
    }));
    
    // Show modal
    const modal = document.getElementById('filesModal');
    modal.classList.add('open');
    
    // Focus search input
    const searchInput = document.getElementById('fileSearch');
    searchInput.value = '';
    searchInput.focus();
    
    // Set callback for file selection
    filePickerCallback = (file) => {
        insertFileReference(file);
        closeModal('filesModal');
    };
    
    selectedFileIndex = -1;
}

function insertFileReference(file) {
    const input = document.getElementById('messageInput');
    const cursorPos = input.selectionStart;
    const textBefore = input.value.substring(0, cursorPos);
    const textAfter = input.value.substring(cursorPos);
    
    // Check if we're replacing an @ symbol
    let insertText = file.path;
    if (textBefore.endsWith('@')) {
        // Don't add another @
        insertText = file.path + ' ';
    } else {
        insertText = '@' + file.path + ' ';
    }
    
    input.value = textBefore + insertText + textAfter;
    
    // Set cursor position after the inserted path
    const newCursorPos = textBefore.length + insertText.length;
    input.setSelectionRange(newCursorPos, newCursorPos);
    
    input.focus();
    adjustInputHeight();
}

function searchFiles(searchTerm) {
    // Request filtered files from backend
    ws.send(JSON.stringify({
        type: 'getWorkspaceFiles',
        searchTerm: searchTerm
    }));
    selectedFileIndex = -1;
}

function selectFileAtIndex(index) {
    if (index >= 0 && index < currentFiles.length && filePickerCallback) {
        filePickerCallback(currentFiles[index]);
    }
}

function renderFileList(files) {
    const filesList = document.getElementById('filesList');
    filesList.innerHTML = '';
    
    currentFiles = files;
    
    if (files.length === 0) {
        filesList.innerHTML = '<div class="no-files">No files found</div>';
        return;
    }
    
    files.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        if (index === selectedFileIndex) {
            fileItem.classList.add('selected');
        }
        
        fileItem.innerHTML = `
            <span class="file-icon">${getFileIcon(file.name)}</span>
            <div class="file-info">
                <div class="file-name">${file.path}</div>
            </div>
        `;
        
        fileItem.onclick = () => {
            selectedFileIndex = index;
            selectFileAtIndex(index);
        };
        
        filesList.appendChild(fileItem);
    });
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    // Return empty string - let CSS handle the icon
    return '';
}

// Slash Commands
const defaultSlashCommands = [
    // Development
    { command: '/plan', description: 'Create a plan before implementing', category: 'development' },
    { command: '/think', description: 'Enable thinking mode', category: 'development' },
    { command: '/review', description: 'Review code changes', category: 'development' },
    { command: '/test', description: 'Write or run tests', category: 'development' },
    { command: '/fix', description: 'Fix bugs or issues', category: 'development' },
    { command: '/refactor', description: 'Refactor code', category: 'development' },
    
    // Analysis
    { command: '/explain', description: 'Explain code or concepts', category: 'analysis' },
    { command: '/analyze', description: 'Analyze code or performance', category: 'analysis' },
    { command: '/search', description: 'Search codebase', category: 'analysis' },
    
    // Session
    { command: '/new', description: 'Start new session', category: 'session' },
    { command: '/clear', description: 'Clear conversation', category: 'session' },
    { command: '/model', description: 'Change model', category: 'session' },
    { command: '/status', description: 'Show session status', category: 'session' },
    { command: '/cost', description: 'Show cost breakdown', category: 'session' },
    { command: '/exit', description: 'Exit Claude', category: 'session' }
];

function showSlashCommands() {
    allSlashCommands = defaultSlashCommands;
    filteredSlashCommands = allSlashCommands;
    selectedCommandIndex = -1;
    
    renderSlashCommands();
    
    const modal = document.getElementById('slashCommandsModal');
    modal.classList.add('open');
    
    const searchInput = document.getElementById('slashSearch');
    searchInput.value = '';
    searchInput.focus();
}

function filterSlashCommands(searchTerm) {
    if (!searchTerm) {
        filteredSlashCommands = allSlashCommands;
    } else {
        const term = searchTerm.toLowerCase();
        filteredSlashCommands = allSlashCommands.filter(cmd => 
            cmd.command.includes(term) || cmd.description.toLowerCase().includes(term)
        );
    }
    selectedCommandIndex = -1;
    renderSlashCommands();
}

function renderSlashCommands() {
    const commandsList = document.getElementById('slashCommandsList');
    commandsList.innerHTML = '';
    
    if (filteredSlashCommands.length === 0) {
        commandsList.innerHTML = '<div class="no-commands">No commands found</div>';
        return;
    }
    
    // Group by category
    const categories = {
        'development': 'Development',
        'analysis': 'Analysis',
        'session': 'Session'
    };
    
    Object.entries(categories).forEach(([category, title]) => {
        const commands = filteredSlashCommands.filter(cmd => cmd.category === category);
        if (commands.length === 0) return;
        
        const section = document.createElement('div');
        section.className = 'slash-section';
        section.innerHTML = `<h3>${title}</h3>`;
        
        commands.forEach((cmd, index) => {
            const globalIndex = filteredSlashCommands.indexOf(cmd);
            const item = document.createElement('div');
            item.className = 'slash-item';
            if (globalIndex === selectedCommandIndex) {
                item.classList.add('selected');
            }
            
            item.innerHTML = `
                <div class="slash-info">
                    <div class="slash-command">${cmd.command}</div>
                    <div class="slash-description">${cmd.description}</div>
                </div>
            `;
            
            item.onclick = () => {
                selectSlashCommand(cmd);
            };
            
            section.appendChild(item);
        });
        
        commandsList.appendChild(section);
    });
}

function selectSlashCommand(cmd) {
    const input = document.getElementById('messageInput');
    
    // Check if we should replace existing slash command
    const currentValue = input.value;
    const slashMatch = currentValue.match(/^\/\w*\s*/);
    
    if (slashMatch) {
        // Replace existing slash command
        input.value = cmd.command + ' ' + currentValue.substring(slashMatch[0].length);
    } else {
        // Add slash command at start
        input.value = cmd.command + ' ' + currentValue;
    }
    
    // Set cursor after command
    const newPos = cmd.command.length + 1;
    input.setSelectionRange(newPos, newPos);
    
    closeModal('slashCommandsModal');
    input.focus();
    adjustInputHeight();
}

function executeSlashCommand(command, args) {
    // Handle local slash commands
    switch (command) {
        case '/new':
            newSession();
            return true;
        case '/clear':
            clearMessages();
            return true;
        case '/plan':
            planMode = true;
            togglePlanMode();
            return true;
        case '/think':
            thinkingMode = true;
            toggleThinkingMode();
            return true;
        default:
            // Send to backend
            return false;
    }
}

// Project management functions
let currentProject = null;

async function showProjects() {
    document.getElementById('projectsModal').classList.add('open');
    closeSidebar();
    await loadProjects();
}

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        const data = await response.json();
        
        const projectsList = document.getElementById('projectsList');
        projectsList.innerHTML = '';
        
        if (data.projects.length === 0) {
            projectsList.innerHTML = '<p class="empty-message">No projects found in ~/projects</p>';
            return;
        }
        
        data.projects.forEach(project => {
            const projectItem = document.createElement('div');
            projectItem.className = 'project-item' + (project.isCurrent ? ' current' : '');
            projectItem.innerHTML = `
                <div class="project-info">
                    <svg class="project-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="20" height="20">
                        <path d="M3 3h18v18H3zM3 9h18" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="project-name">${project.name}</span>
                    ${project.isCurrent ? '<span class="current-badge">Current</span>' : ''}
                </div>
            `;
            
            if (!project.isCurrent) {
                projectItem.onclick = () => switchProject(project.path);
            }
            
            projectsList.appendChild(projectItem);
        });
        
        currentProject = data.currentProject;
    } catch (error) {
        console.error('Error loading projects:', error);
        showToast('Failed to load projects', 'error');
    }
}

async function switchProject(projectPath) {
    try {
        const response = await fetch('/api/projects/switch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ projectPath })
        });
        
        if (!response.ok) {
            throw new Error('Failed to switch project');
        }
        
        const data = await response.json();
        showToast(`Switched to project: ${data.projectName}`, 'success');
        closeModal('projectsModal');
        
        // Reload the page to reset the chat interface
        setTimeout(() => {
            window.location.reload();
        }, 500);
    } catch (error) {
        console.error('Error switching project:', error);
        showToast('Failed to switch project', 'error');
    }
}

async function createNewProject() {
    const projectName = prompt('Enter new project name:');
    
    if (!projectName || projectName.trim() === '') {
        return;
    }
    
    try {
        const response = await fetch('/api/projects/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ projectName: projectName.trim() })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create project');
        }
        
        const data = await response.json();
        showToast(`Created project: ${data.projectName}`, 'success');
        
        // Switch to the new project
        await switchProject(data.projectPath);
    } catch (error) {
        console.error('Error creating project:', error);
        showToast(error.message || 'Failed to create project', 'error');
    }
}

