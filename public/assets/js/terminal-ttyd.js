// 简化的终端管理器 - 使用ttyd iframe替代xterm.js
class TTYdTerminalManager {
    constructor() {
        this.sessions = new Map(); // 存储真实的tmux session信息
        this.activeSessionName = null;
        this.iframe = null;
        this.isInitialized = false;
        this.refreshInterval = null;
        this._isRestoring = false; // 标记是否正在恢复session
        this._isSwitchingSession = false; // 标记是否正在切换session
        this.isInCopyMode = false; // Track if currently in copy mode
        
        // Enhanced multi-level continuous scrolling system
        this.scrollInterval = null;
        this.scrollDirection = null;
        this.scrollStartTime = null;
        this.currentScrollLevel = 0;
        
        // Multi-level acceleration settings for smooth user experience
        this.scrollLevels = [
            { delay: 0,    interval: 80,  mode: 'line', description: 'Initial - Precise control' },    // 12.5 lines/sec
            { delay: 300,  interval: 60,  mode: 'line', description: 'Level 1 - Faster' },           // 16.7 lines/sec  
            { delay: 800,  interval: 40,  mode: 'line', description: 'Level 2 - Quick' },            // 25 lines/sec
            { delay: 1500, interval: 30,  mode: 'line', description: 'Level 3 - Rapid' },            // 33 lines/sec
            { delay: 2500, interval: 25,  mode: 'line', description: 'Level 4 - Very fast' },        // 40 lines/sec
            { delay: 4000, interval: 20,  mode: 'line', description: 'Level 5 - Ultra fast' }        // 50 lines/sec
        ];
        
        this.initialScrollDelay = 50; // Quick initial response
        
        // 绑定事件处理程序
        this.bindEvents();
        
        // Enhanced global focus management for mobile keyboard prevention
        this.setupGlobalFocusManagement();
        
        // Create hidden input for aggressive keyboard hiding
        this.createHiddenKeyboardKiller();
        
        // Setup global keyboard detection and management
        this.setupKeyboardDetection();
    }

    bindEvents() {
        // 新建终端按钮
        document.getElementById('new-terminal-btn')?.addEventListener('click', () => {
            this.createNewTerminal();
        });

        // 欢迎屏幕按钮
        document.getElementById('welcome-new-terminal')?.addEventListener('click', () => {
            this.createNewTerminal();
        });

        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            this.handleResize();
        });

        // Terminal scroll controls with continuous scrolling support
        this.bindScrollButton('scroll-up', 'up');
        this.bindScrollButton('scroll-down', 'down');

        // Mobile terminal controls
        this.bindMobileTerminalControls();

        // Copy mode exit button (unchanged)
        document.getElementById('copy-mode-exit-button')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.goToBottomAndExit();
        });

        document.getElementById('copy-mode-exit-button')?.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        document.getElementById('copy-mode-exit-button')?.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.goToBottomAndExit();
        });
    }

    init() {
        if (this.isInitialized) return;

        
        // 获取iframe元素
        this.iframe = document.getElementById('ttyd-terminal');
        
        if (!this.iframe) {
            console.error('❌ TTYd terminal iframe not found');
            return;
        }
        
        // 显示初始加载状态，避免用户看到base-session
        this.showTerminalLoading();

        // 动态设置TTYd服务器地址
        this.setupTTYdURL();

        // 监听iframe加载
        this.iframe.onload = () => {
            this.isInitialized = true;
            
            // 页面刷新时触发：添加延迟以确保TTYd客户端完全准备好
            setTimeout(() => {
                this.refreshSessionList();
            }, 2000); // 延迟2秒确保TTYd客户端完全建立连接
        };

        // 监听iframe错误
        this.iframe.onerror = (error) => {
            console.error('❌ TTYd terminal iframe error:', error);
            this.showError('Failed to load terminal');
        };

        // 监听session事件
        this.setupSessionEventListeners();

        // 监听项目管理器事件
        this.setupProjectEventListeners();
        
        // Start base-session monitoring to prevent exposure
        this.startBaseSessionMonitoring();

    }

    setupTTYdURL() {
        // 使用代理路由而不是直接访问7681端口
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port;
        const baseURL = `${protocol}//${hostname}${port ? ':' + port : ''}`;
        const ttydURL = `${baseURL}/terminal`;
        
        
        // 设置iframe的src
        this.iframe.src = ttydURL;
        
        // 初始化时隐藏Iframe，避免显示base-session
        this.iframe.style.display = 'none';
    }

    setupSessionEventListeners() {
        if (!window.socket) {
            console.warn('⚠️ Socket.IO not available, session events will not work');
            return;
        }

        // 监听session创建事件
        window.socket.onTerminalSessionCreated((data) => {
            console.log(`Terminal session created: ${data.sessionName}`);
            
            // 创建新的终端后触发：更新session列表并自动激活新创建的session
            this.refreshSessionList(data.sessionName);
        });

        // 监听session删除事件
        window.socket.onTerminalSessionDeleted((data) => {
            console.log(`Terminal session deleted: ${data.sessionName}`);
            
            // 删除某个终端时触发：智能选择下一个要激活的session
            this.handleSessionDeleted(data.sessionName);
        });

        // 监听session切换事件
        window.socket.onTerminalSessionSwitched((data) => {
            // 成功切换时不显示通知，只更新UI状态
            
            // 更新活跃session
            this.activeSessionName = data.sessionName;
            this.updateTabStyles();
            
            // session切换成功后显示iframe，隐藏loading状态，清除切换标记
            this._isSwitchingSession = false;
            this.hideWelcomeScreen();
            this.showIframe();
            
        });

        // 监听终端滚动结果事件
        window.socket.on('terminal:scroll-result', (data) => {
            this.handleScrollResult(data);
        });
    }

    setupProjectEventListeners() {
        // Wait for project manager to be available
        const waitForProjectManager = () => {
            if (window.projectManager) {
                // Listen for projects loaded event
                window.projectManager.on('projects_loaded', (projects) => {
                    
                    // If currently showing welcome screen but there are projects,
                    // switch to empty content
                    const welcomeScreen = document.getElementById('welcome-screen');
                    if (welcomeScreen && welcomeScreen.style.display === 'flex') {
                        if (this.sessions.size === 0 && this.hasProjects()) {
                            this.showTerminalEmptyState();
                        }
                    }
                });

                // Listen for project created event to handle auto-terminal creation
                window.projectManager.on('project_created', (project) => {
                });

            } else {
                // Retry after a short delay
                setTimeout(waitForProjectManager, 100);
            }
        };
        
        waitForProjectManager();
    }

    // Robust session state initialization without arbitrary delays
    async initializeSessionState() {
        console.log('🚀 Starting robust session initialization');
        
        try {
            // Show loading state immediately
            this.showTerminalLoading();
            
            // Wait for socket connection with timeout
            await this.waitForSocketConnection(10000); // 10 second timeout
            
            // Get current session list
            await this.refreshSessionList();
            
            // If we have sessions but no active session, try to activate one
            if (this.sessions.size > 0 && !this.activeSessionName) {
                const firstSession = Array.from(this.sessions.keys())[0];
                await this.switchToSessionRobust(firstSession);
            }
            
            // If still no active session, show welcome screen
            if (!this.activeSessionName && this.sessions.size === 0) {
                this.showWelcomeOrEmptyScreen();
            }
            
        } catch (error) {
            console.error('❌ Failed to initialize session state:', error);
            this.showError('Failed to initialize terminal');
        }
    }
    
    // Wait for socket connection with timeout
    async waitForSocketConnection(timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            if (window.socket && window.socket.isConnected()) {
                resolve();
                return;
            }
            
            const startTime = Date.now();
            
            const checkConnection = () => {
                if (window.socket && window.socket.isConnected()) {
                    resolve();
                } else if (Date.now() - startTime > timeoutMs) {
                    reject(new Error('Socket connection timeout'));
                } else {
                    setTimeout(checkConnection, 100);
                }
            };
            
            checkConnection();
        });
    }

    async refreshSessionList(sessionToActivate = null) {
        if (!window.socket) {
            console.warn('⚠️ Socket.IO not available, cannot refresh session list');
            return;
        }

        try {
            
            // 获取当前所有的claude-web session
            const sessions = await window.socket.getTerminalSessions();
            
            // 过滤掉base-session和非claude-web sessions
            const filteredSessions = sessions.filter(session => {
                return session.name.startsWith('claude-web-') && session.name !== 'base-session';
            });
            
            // 清空现有的session信息
            this.sessions.clear();
            
            // 更新session信息
            filteredSessions.forEach(session => {
                this.sessions.set(session.name, {
                    name: session.name,
                    projectId: session.projectId,
                    identifier: session.identifier,
                    created: session.created,
                    attached: session.attached
                });
            });
            
            
            // 重新构建标签页
            this.rebuildTabs();
            
            // 优先激活指定的session (新创建的session)
            if (sessionToActivate && this.sessions.has(sessionToActivate)) {
                await this.switchToSessionRobust(sessionToActivate);
            }
            // 如果没有活跃session但有sessions存在，激活第一个(但不在恢复模式下)
            else if (!this.activeSessionName && this.sessions.size > 0 && !this._isRestoring) {
                const firstSession = Array.from(this.sessions.keys())[0];
                await this.switchToSessionRobust(firstSession);
            }
            
            // 如果没有任何session，显示欢迎屏幕
            if (this.sessions.size === 0) {
                this.showWelcomeOrEmptyScreen();
                // 如果在恢复模式下没有session，也要清除恢复模式
                if (this._isRestoring) {
                    this._isRestoring = false;
                }
            } else {
                // 有sessions存在时，检查当前是否已经有活动session
                if (this.activeSessionName && this.sessions.has(this.activeSessionName) && !this._isSwitchingSession) {
                    // 如果当前有活动session且该session仍然存在，且不在切换过程中，显示iframe
                    this.hideWelcomeScreen();
                    this.showIframe();
                } else if (!this._isSwitchingSession) {
                    // 如果没有活动session或活动session不存在，且不在切换过程中，显示loading状态等待session切换
                    this.showTerminalLoading();
                } else {
                    // 如果正在切换session过程中，不改变当前显示状态
                }
            }
            
        } catch (error) {
            console.error('❌ Failed to refresh session list:', error);
            this._isSwitchingSession = false; // 刷新失败时清除标记
            this.showError('Failed to refresh session list');
        }
    }

    // 处理session删除事件，智能选择下一个要激活的session
    async handleSessionDeleted(deletedSessionName) {
        
        // 获取删除前的session列表顺序
        const sessionKeys = Array.from(this.sessions.keys());
        const deletedSessionIndex = sessionKeys.indexOf(deletedSessionName);
        
        // 从session列表中移除被删除的session
        this.sessions.delete(deletedSessionName);
        
        // 刷新session列表
        await this.refreshSessionList();
        
        // 如果没有其他session了，显示欢迎屏幕
        if (this.sessions.size === 0) {
            this.showWelcomeOrEmptyScreen();
            return;
        }
        
        // 智能选择下一个要激活的session
        let nextSessionToActivate = null;
        const currentSessionKeys = Array.from(this.sessions.keys());
        
        if (deletedSessionIndex >= 0 && sessionKeys.length > 1) {
            // 如果删除的不是最后一个session，选择左侧的第一个终端
            if (deletedSessionIndex > 0) {
                // 找到被删除session左侧的第一个还存在的session
                for (let i = deletedSessionIndex - 1; i >= 0; i--) {
                    const candidateSession = sessionKeys[i];
                    if (this.sessions.has(candidateSession)) {
                        nextSessionToActivate = candidateSession;
                        break;
                    }
                }
            }
            
            // 如果没有找到左侧的session，选择右侧的第一个
            if (!nextSessionToActivate && deletedSessionIndex < sessionKeys.length - 1) {
                for (let i = deletedSessionIndex + 1; i < sessionKeys.length; i++) {
                    const candidateSession = sessionKeys[i];
                    if (this.sessions.has(candidateSession)) {
                        nextSessionToActivate = candidateSession;
                        break;
                    }
                }
            }
        }
        
        // 如果还是没有找到，就选择第一个可用的session
        if (!nextSessionToActivate && currentSessionKeys.length > 0) {
            nextSessionToActivate = currentSessionKeys[0];
        }
        
        // 激活选中的session
        if (nextSessionToActivate) {
            setTimeout(() => {
                this.switchToSession(nextSessionToActivate);
            }, 500); // 短暂延迟确保UI更新完成
        }
    }

    rebuildTabs() {
        const tabsContainer = document.getElementById('terminal-tabs');
        if (!tabsContainer) return;
        
        // 清空现有标签页
        tabsContainer.innerHTML = '';
        
        // 为每个session创建标签页
        this.sessions.forEach((session, sessionName) => {
            this.createSessionTab(session);
        });
        
        // 更新标签页样式
        this.updateTabStyles();
    }

    createSessionTab(session) {
        const tabsContainer = document.getElementById('terminal-tabs');
        if (!tabsContainer) return;
        
        // 创建标签页元素
        const tab = document.createElement('div');
        tab.className = 'terminal-tab';
        tab.dataset.sessionName = session.name;
        
        // 简化session名称显示
        const displayName = this.getDisplayName(session.name);
        
        tab.innerHTML = `
            <span class="tab-title">${displayName}</span>
            <button class="close-btn" title="Close Terminal">×</button>
        `;

        // 添加点击事件 - 切换session
        tab.addEventListener('click', (e) => {
            if (!e.target.matches('.close-btn')) {
                // Set flag to prevent project auto-selection when user manually clicks tab
                this._skipProjectAutoSelect = true;
                this.switchToSession(session.name);
                this._skipProjectAutoSelect = false;
            }
        });

        // 添加关闭事件
        tab.querySelector('.close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.confirmCloseSession(session.name);
        });

        tabsContainer.appendChild(tab);
    }

    getDisplayName(sessionName) {
        // 将 claude-web-session-1234567890 简化为 session-1234567890
        if (sessionName.startsWith('claude-web-session-')) {
            return sessionName.replace('claude-web-', '');
        }
        // 将 claude-web-project-123 简化为 project-123
        if (sessionName.startsWith('claude-web-')) {
            return sessionName.replace('claude-web-', '');
        }
        return sessionName;
    }

    switchToSession(sessionName, retryCount = 0, skipSocketEvent = false) {
        if (!this.sessions.has(sessionName)) {
            console.error('❌ Session not found:', sessionName);
            return;
        }


        // Reset copy mode state and stop continuous scrolling when switching sessions
        this.isInCopyMode = false;
        this.hideCopyModeExitButton();
        this.stopContinuousScroll();

        // 获取当前活动的session名称
        const currentSessionName = this.activeSessionName;

        // 如果已经是当前活动session，只更新UI不发送Socket事件
        if (sessionName === currentSessionName && !retryCount) {
            this.updateTabStyles();
            this.hideWelcomeScreen();
            this.showIframe();
            return;
        }

        // 更新活动session
        this.activeSessionName = sessionName;

        // 更新标签页样式
        this.updateTabStyles();

        // Show scroll controls when terminal is active
        this.showScrollControls();

        // 隐藏欢迎屏幕，并在session切换前显示loading状态避免显示base-session
        this.hideWelcomeScreen();
        
        // 只有在确认session切换成功后才显示iframe
        // 这里先保持loading状态，等socket事件确认后再显示iframe
        if (sessionName === currentSessionName && !retryCount) {
            // 如果是相同session，立即显示iframe
            this.showIframe();
        } else {
            // 如果是切换到不同session，先显示loading状态并标记正在切换
            this._isSwitchingSession = true;
            this.showTerminalLoading();
        }

        // Auto-select corresponding project when switching to a terminal (terminal -> project linking)
        if (!this._skipProjectAutoSelect) {
            this.autoSelectProject(sessionName);
        }

        // 只有在非跳过Socket事件模式下才发送Socket.IO请求
        if (!skipSocketEvent && window.socket && window.socket.isConnected()) {
            window.socket.switchTerminalSession(sessionName, currentSessionName);
        } else if (!skipSocketEvent) {
            console.warn('⚠️ Socket.IO not connected, session switch may not work properly');
            
            // 如果Socket.IO未连接且重试次数少于3次，延迟重试
            if (retryCount < 3) {
                setTimeout(() => {
                    this.switchToSession(sessionName, retryCount + 1, skipSocketEvent);
                }, (retryCount + 1) * 1000);
            } else {
                console.error('❌ Max retry attempts reached for session switch');
                this._isSwitchingSession = false; // 切换失败时清除标记
                console.error('Failed to switch session after multiple attempts');
            }
        }
    }

    // Robust session switching with proper verification
    async switchToSessionRobust(sessionName) {
        if (!this.sessions.has(sessionName)) {
            console.error('❌ Session not found:', sessionName);
            return false;
        }

        console.log(`🔄 Starting robust switch to session: ${sessionName}`);

        // Reset copy mode state and stop continuous scrolling when switching sessions
        this.isInCopyMode = false;
        this.hideCopyModeExitButton();
        this.stopContinuousScroll();

        // 获取当前活动的session名称
        const currentSessionName = this.activeSessionName;

        // 如果已经是当前活动session，只更新UI
        if (sessionName === currentSessionName) {
            this.updateTabStyles();
            this.hideWelcomeScreen();
            this.showIframe();
            console.log(`✅ Already on session ${sessionName}`);
            return true;
        }

        // Mark as switching and show loading
        this._isSwitchingSession = true;
        this.hideWelcomeScreen();
        this.showTerminalLoading();

        try {
            // Auto-select corresponding project when switching to a terminal
            if (!this._skipProjectAutoSelect) {
                this.autoSelectProject(sessionName);
            }

            // Attempt to switch via WebSocket with verification
            if (window.socket && window.socket.isConnected()) {
                const success = await this.switchViaWebSocket(sessionName, currentSessionName);
                if (success) {
                    // Update UI state
                    this.activeSessionName = sessionName;
                    this.updateTabStyles();
                    this.showScrollControls();
                    this._isSwitchingSession = false;
                    this.showIframe();
                    console.log(`✅ Successfully switched to session: ${sessionName}`);
                    return true;
                }
            }

            throw new Error('WebSocket switch failed or not available');

        } catch (error) {
            console.error(`❌ Failed to switch to session ${sessionName}:`, error);
            this._isSwitchingSession = false;
            
            // Don't show base-session on failure - show error or keep loading
            this.showError(`Failed to switch to session ${sessionName}`);
            return false;
        }
    }

    // WebSocket-based session switching with timeout
    async switchViaWebSocket(sessionName, currentSessionName, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            let resolved = false;
            
            // Set up success handler
            const successHandler = (data) => {
                if (data.sessionName === sessionName && !resolved) {
                    resolved = true;
                    window.socket.off('terminal:session-switched', successHandler);
                    window.socket.off('error', errorHandler);
                    resolve(true);
                }
            };
            
            // Set up error handler
            const errorHandler = (error) => {
                if (!resolved) {
                    resolved = true;
                    window.socket.off('terminal:session-switched', successHandler);
                    window.socket.off('error', errorHandler);
                    reject(new Error(`Session switch error: ${error.message || error}`));
                }
            };
            
            // Set up timeout
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    window.socket.off('terminal:session-switched', successHandler);
                    window.socket.off('error', errorHandler);
                    reject(new Error('Session switch timeout'));
                }
            }, timeoutMs);
            
            // Listen for events
            window.socket.on('terminal:session-switched', successHandler);
            window.socket.on('error', errorHandler);
            
            // Send the switch request
            try {
                window.socket.switchTerminalSession(sessionName, currentSessionName);
            } catch (error) {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    window.socket.off('terminal:session-switched', successHandler);
                    window.socket.off('error', errorHandler);
                    reject(error);
                }
            }
        });
    }

    // Confirm before closing session to prevent accidental deletion
    confirmCloseSession(sessionName) {
        if (!this.sessions.has(sessionName)) {
            console.error('❌ Session not found:', sessionName);
            return;
        }

        const session = this.sessions.get(sessionName);
        const displayName = this.getDisplayName(sessionName);
        
        // Show confirmation dialog
        const confirmed = confirm(
            `Are you sure you want to close terminal "${displayName}"?\n\n` +
            `This will permanently delete the terminal session and cannot be undone.`
        );
        
        if (confirmed) {
            this.closeSession(sessionName);
        } else {
        }
    }

    closeSession(sessionName) {
        if (!this.sessions.has(sessionName)) {
            console.error('❌ Session not found:', sessionName);
            return;
        }


        // 通过Socket.IO请求删除session
        if (window.socket && window.socket.isConnected()) {
            window.socket.deleteTerminalSession(sessionName);
        } else {
            console.warn('⚠️ Socket.IO not connected, session deletion may not work properly');
        }
    }

    updateTabStyles() {
        const tabs = document.querySelectorAll('.terminal-tab');
        let activeTab = null;
        
        tabs.forEach(tab => {
            if (tab.dataset.sessionName === this.activeSessionName) {
                tab.classList.add('active');
                activeTab = tab;
            } else {
                tab.classList.remove('active');
            }
        });
        
        // Auto-scroll to active tab for better mobile UX
        if (activeTab) {
            this.scrollToActiveTab(activeTab);
        }
    }
    
    // Automatically scroll the tabs container to make the active tab visible
    scrollToActiveTab(activeTab) {
        const tabsContainer = document.getElementById('terminal-tabs');
        if (!tabsContainer || !activeTab) return;
        
        // Calculate scroll position to center the active tab
        const containerRect = tabsContainer.getBoundingClientRect();
        const tabRect = activeTab.getBoundingClientRect();
        
        // Calculate the position of the tab relative to the container
        const tabLeft = tabRect.left - containerRect.left + tabsContainer.scrollLeft;
        const tabWidth = tabRect.width;
        const containerWidth = containerRect.width;
        
        // Calculate scroll position to center the tab
        const targetScrollLeft = tabLeft - (containerWidth / 2) + (tabWidth / 2);
        
        // Smooth scroll to the calculated position
        tabsContainer.scrollTo({
            left: Math.max(0, targetScrollLeft),
            behavior: 'smooth'
        });
        
    }

    // 选择并激活指定的session tab (被project-manager.js调用)
    selectSessionTab(sessionName) {
        if (!sessionName) {
            console.warn('⚠️ selectSessionTab called with empty sessionName');
            return false;
        }

        if (!this.sessions.has(sessionName)) {
            console.warn('⚠️ selectSessionTab called with unknown sessionName:', sessionName);
            return false;
        }

        
        // Set flag to prevent project auto-selection when triggered by project
        this._skipProjectAutoSelect = true;
        // Skip socket event to prevent duplicate notifications from bidirectional linking
        this.switchToSession(sessionName, 0, true);
        this._skipProjectAutoSelect = false;
        
        return true;
    }

    async createNewTerminal(projectName = null) {

        // 检查Socket.IO连接状态
        if (!window.socket || !window.socket.isConnected()) {
            console.error('❌ Socket.IO not connected, cannot create terminal session');
            this._isSwitchingSession = false; // 连接失败时清除标记
            this.showError('Not connected to server. Please check your connection.');
            return false;
        }

        // 生成session名称，使用用户要求的格式
        const timestamp = Date.now();
        const sessionName = `claude-web-session-${timestamp}`;
        
        // 创建tmux session
        const projectPath = this.getCurrentProjectPath();
        const success = window.socket.createTerminalSession(
            null, // projectName is not needed when sessionName is provided
            projectPath,
            {
                sessionName: sessionName,
                cols: 80,
                rows: 24
            }
        );
        
        if (success) {
            console.log(`Creating terminal session: ${sessionName}`);
            
            // 隐藏欢迎屏幕，显示loading状态等待新session创建完成
            this.hideWelcomeScreen();
            this._isSwitchingSession = true; // 标记正在创建新session
            this.showTerminalLoading();
            
            return sessionName;
        } else {
            console.error('❌ Failed to send terminal session creation request');
            this._isSwitchingSession = false; // 创建失败时清除标记
            this.showError('Failed to create terminal session');
            return false;
        }
    }
    

    hideWelcomeScreen() {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'none';
        }
        
        // Also hide terminal empty state
        this.hideTerminalEmptyState();
        
        // Remove keyboard listeners when hiding welcome screen
        this.removeWelcomeKeyboardListeners();
    }

    showIframe() {
        // Hide terminal loading state before showing iframe
        this.hideTerminalLoading();
        
        if (this.iframe) {
            this.iframe.style.display = 'block';
        }
        
        // Always show scroll controls when iframe is visible
        this.showScrollControls();
    }

    // Check if there are any projects available
    hasProjects() {
        return window.projectManager && window.projectManager.hasProjects();
    }

    // Show terminal empty state when there are projects but no sessions
    showTerminalEmptyState() {
        
        // Hide welcome screen
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'none';
        }
        
        // Hide terminal loading state
        const terminalLoadingState = document.getElementById('terminal-loading-state');
        if (terminalLoadingState) {
            terminalLoadingState.style.display = 'none';
        }
        
        // Hide iframe
        if (this.iframe) {
            this.iframe.style.display = 'none';
        }
        
        // Show terminal empty state
        const terminalEmptyState = document.getElementById('terminal-empty-state');
        if (terminalEmptyState) {
            terminalEmptyState.style.display = 'flex';
        }
        
        this.activeSessionName = null;
        // Hide scroll controls when showing empty state
        this.hideScrollControls();
    }

    // Hide terminal empty state
    hideTerminalEmptyState() {
        const terminalEmptyState = document.getElementById('terminal-empty-state');
        if (terminalEmptyState) {
            terminalEmptyState.style.display = 'none';
        }
    }

    // Smart welcome/empty screen decision
    showWelcomeOrEmptyScreen() {
        if (this.hasProjects()) {
            // If there are projects, show terminal empty state (only in terminal area)
            this.showTerminalEmptyState();
        } else {
            // If no projects, show traditional welcome screen (full page)
            this.showWelcomeScreen();
        }
    }

    showWelcomeScreen() {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'flex';
            // 恢复默认的welcome内容
            this.resetWelcomeContent();
        }
        
        // Hide terminal empty state
        const terminalEmptyState = document.getElementById('terminal-empty-state');
        if (terminalEmptyState) {
            terminalEmptyState.style.display = 'none';
        }
        
        // Hide terminal loading state
        const terminalLoadingState = document.getElementById('terminal-loading-state');
        if (terminalLoadingState) {
            terminalLoadingState.style.display = 'none';
        }
        
        if (this.iframe) {
            this.iframe.style.display = 'none';
        }
        
        this.activeSessionName = null;

        // Hide scroll controls when showing welcome screen
        this.hideScrollControls();
        
        // Add keyboard shortcut support for welcome screen
        this.addWelcomeKeyboardListeners();
    }

    resetWelcomeContent() {
        const welcomeContent = document.querySelector('.welcome-content');
        if (welcomeContent) {
            welcomeContent.innerHTML = `
                <!-- Brand Section -->
                <div class="brand-section">
                    <div class="logo-container">
                        <img src="/assets/icons/android-chrome-512x512.png" 
                             alt="Vibe Code Distiller" 
                             class="brand-logo">
                    </div>
                    <h1 class="brand-title pixel-art-bw">VIBE CODE DISTILLER</h1>
                    <p class="brand-subtitle">Enhancing Your Claude Code Experience</p>
                </div>
                
                <!-- Primary Action -->
                <div class="action-section">
                    <button class="btn btn-primary pixel-button-bw" id="welcome-new-project">
                        Create Your First Project
                    </button>
                </div>
            `;
            
            // Re-bind event handlers after content reset
            this.bindWelcomeEvents();
        }
    }

    bindWelcomeEvents(retryCount = 0) {
        // Bind welcome project creation button
        const welcomeNewProjectBtn = document.getElementById('welcome-new-project');
        if (welcomeNewProjectBtn) {
            if (window.projectManager) {
                welcomeNewProjectBtn.addEventListener('click', () => {
                    window.projectManager.showCreateProjectModal();
                });
            } else if (retryCount < 10) {
                // Retry after a short delay in case projectManager is not yet initialized
                setTimeout(() => {
                    this.bindWelcomeEvents(retryCount + 1);
                }, 100);
            } else {
                console.error('❌ ProjectManager not available after 10 retries, cannot bind welcome events');
            }
        } else {
            console.warn('⚠️ Welcome new project button not found, cannot bind events');
        }
    }

    addWelcomeKeyboardListeners() {
        // Remove any existing listeners first
        this.removeWelcomeKeyboardListeners();
        
        // Add keyboard event listener for welcome screen
        this.welcomeKeyboardHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const createProjectBtn = document.getElementById('welcome-new-project');
                if (createProjectBtn) {
                    createProjectBtn.click();
                }
            }
        };
        
        document.addEventListener('keydown', this.welcomeKeyboardHandler);
    }

    removeWelcomeKeyboardListeners() {
        if (this.welcomeKeyboardHandler) {
            document.removeEventListener('keydown', this.welcomeKeyboardHandler);
            this.welcomeKeyboardHandler = null;
        }
    }

    showTerminalLoading() {
        
        // Hide welcome screen
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'none';
        }
        
        // Hide terminal empty state
        const terminalEmptyState = document.getElementById('terminal-empty-state');
        if (terminalEmptyState) {
            terminalEmptyState.style.display = 'none';
        }
        
        // Hide iframe
        if (this.iframe) {
            this.iframe.style.display = 'none';
        }
        
        // Show terminal loading state
        const terminalLoadingState = document.getElementById('terminal-loading-state');
        if (terminalLoadingState) {
            terminalLoadingState.style.display = 'flex';
        }

        // Hide scroll controls during loading
        this.hideScrollControls();
    }

    hideTerminalLoading() {
        
        // Hide terminal loading state
        const terminalLoadingState = document.getElementById('terminal-loading-state');
        if (terminalLoadingState) {
            terminalLoadingState.style.display = 'none';
        }
    }

    showDisconnectionMessage() {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'flex';
        }
        
        if (this.iframe) {
            this.iframe.style.display = 'none';
        }
        
        // Show disconnection message
        const welcomeContent = document.querySelector('.welcome-content');
        if (welcomeContent) {
            welcomeContent.innerHTML = `
                <h2>🔴 Connection Lost</h2>
                <p>Connection lost, reconnecting automatically...</p>
                <div class="loading-spinner" style="margin: 20px auto; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #dc3545; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
        }

        // Hide scroll controls during disconnection
        this.hideScrollControls();
    }

    showReconnectionMessage() {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'flex';
        }
        
        if (this.iframe) {
            this.iframe.style.display = 'none';
        }
        
        // Show reconnection success message
        const welcomeContent = document.querySelector('.welcome-content');
        if (welcomeContent) {
            welcomeContent.innerHTML = `
                <h2>🟢 Reconnected Successfully</h2>
                <p>Reconnected successfully, refreshing page...</p>
                <div class="loading-spinner" style="margin: 20px auto; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #28a745; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
        }

        // Hide scroll controls during reconnection
        this.hideScrollControls();
    }


    showRestartingStatus() {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = 'flex';
        }
        
        if (this.iframe) {
            this.iframe.style.display = 'none';
        }
        
        // 修改welcome screen内容显示重启状态
        const welcomeContent = document.querySelector('.welcome-content');
        if (welcomeContent) {
            welcomeContent.innerHTML = `
                <h2>🔄 TTYd Service Restarting</h2>
                <p>Please wait while the terminal service is restarting...</p>
                <div class="loading-spinner" style="margin: 20px auto; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
        }
    }

    handleResize() {
        // iframe会自动处理resize，无需特殊处理
    }
    
    reloadTerminal(silent = false) {
        
        if (this.iframe) {
            // Save the current active session before reload
            const currentActiveSession = this.activeSessionName;
            
            // 显示重启状态，避免用户看到base-session (除非是静默模式)
            if (!silent) {
                this.showRestartingStatus();
            } else {
                // 静默模式：只显示loading状态，不显示重启页面
                this.showTerminalLoading();
            }
            
            // 清空当前活动session名称，确保后续强制切换
            this.activeSessionName = null;
            // 设置恢复模式标志，避免自动切换到第一个session
            this._isRestoring = true;
            
            // Force reload the iframe src to pick up new TTYd settings
            const currentSrc = this.iframe.src;
            this.iframe.src = '';
            
            // Small delay to ensure the src is cleared, then reload and restore session
            setTimeout(() => {
                this.iframe.src = currentSrc;
                
                // Set up iframe load listener to restore session after reload
                const restoreSession = () => {
                    
                    // First refresh session list to ensure we have latest data
                    this.refreshSessionList().then(() => {
                        if (currentActiveSession && this.sessions.has(currentActiveSession)) {
                            // Wait a bit more for TTYd to be fully ready, then restore session
                            setTimeout(() => {
                                // 恢复session期间显示loading状态
                                this._isSwitchingSession = true;
                                this.showTerminalLoading();
                                this.switchToSession(currentActiveSession);
                                // 恢复完成后清除恢复模式标志
                                this._isRestoring = false;
                            }, 1500); // 1.5 second delay to ensure TTYd is stable
                        } else {
                            // If the saved session doesn't exist, just refresh the UI
                            if (this.sessions.size > 0) {
                                const firstSession = Array.from(this.sessions.keys())[0];
                                // 恢复fallback session期间显示loading状态
                                this._isSwitchingSession = true;
                                this.showTerminalLoading();
                                setTimeout(() => {
                                    this.switchToSession(firstSession);
                                    // 恢复完成后清除恢复模式标志
                                    this._isRestoring = false;
                                }, 1500);
                            } else {
                                // 没有session可恢复，显示欢迎屏幕
                                this.showWelcomeOrEmptyScreen();
                                this._isRestoring = false;
                            }
                        }
                    }).catch(error => {
                        console.error('❌ Failed to refresh session list after TTYd reload:', error);
                        // 即使失败也要清除恢复模式标志和切换标记
                        this._isRestoring = false;
                        this._isSwitchingSession = false;
                    });
                    
                    // Remove the listener after use
                    this.iframe.removeEventListener('load', restoreSession);
                };
                
                // Listen for iframe load completion
                this.iframe.addEventListener('load', restoreSession);
                
            }, 500);
        }
    }

    showNotification(message) {
    }

    showError(message) {
        console.error('❌ Error:', message);
    }

    // 获取当前项目路径
    getCurrentProjectPath() {
        // 尝试从全局变量或项目管理器获取当前项目路径
        if (window.projectManager && window.projectManager.getCurrentProject) {
            const project = window.projectManager.getCurrentProject();
            return project?.path || null;
        }
        
        // 如果没有项目管理器，返回null，服务器会使用默认路径
        return null;
    }
    

    // 获取活动session
    getActiveSession() {
        return this.sessions.get(this.activeSessionName);
    }

    // 获取所有sessions
    getAllSessions() {
        return Array.from(this.sessions.values());
    }

    /**
     * Auto-select corresponding project when terminal is switched (terminal -> project linking)
     */
    autoSelectProject(sessionName) {
        if (!sessionName || !window.projectManager) {
            return;
        }
        
        // Extract project name from session name
        const projectName = this.extractProjectNameFromSessionName(sessionName);
        if (!projectName) {
            return;
        }
        
        
        // Select the corresponding project
        window.projectManager.selectProjectByName(projectName);
    }
    
    /**
     * Extract project name from session name
     * Expected format: claude-web-{projectName}-{number}
     * Returns null for temporary sessions (claude-web-session-{timestamp})
     */
    extractProjectNameFromSessionName(sessionName) {
        if (!sessionName || typeof sessionName !== 'string') {
            return null;
        }
        
        // Skip temporary sessions (claude-web-session-{timestamp})
        if (sessionName.startsWith('claude-web-session-')) {
            return null;
        }
        
        // Parse project sessions: claude-web-{projectName}-{number}
        const match = sessionName.match(/^claude-web-(.+)-\d+$/);
        if (match) {
            return match[1];
        }
        
        return null;
    }

    // Continuous scrolling button binding with enhanced mobile keyboard prevention
    bindScrollButton(buttonId, direction) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        // Enhanced focus prevention for mobile keyboards
        const preventKeyboardPopup = (e) => {
            // Immediately prevent default and blur to avoid any focus
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // Force blur immediately and repeatedly to ensure no focus
            button.blur();
            
            // Additional blur with slight delay to catch any delayed focus
            setTimeout(() => {
                button.blur();
                // Force any potentially focused element to blur
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
            }, 1);
            
            return false;
        };

        // Mouse events
        button.addEventListener('mousedown', (e) => {
            preventKeyboardPopup(e);
            this.startContinuousScroll(direction);
        });

        button.addEventListener('mouseup', (e) => {
            preventKeyboardPopup(e);
            this.stopContinuousScroll();
        });

        button.addEventListener('mouseleave', (e) => {
            preventKeyboardPopup(e);
            this.stopContinuousScroll();
        });

        // Enhanced touch events for mobile devices with aggressive keyboard prevention
        button.addEventListener('touchstart', (e) => {
            preventKeyboardPopup(e);
            
            // Additional mobile-specific prevention
            if (e.target) {
                e.target.blur();
            }
            
            this.startContinuousScroll(direction);
        }, { passive: false });

        button.addEventListener('touchend', (e) => {
            preventKeyboardPopup(e);
            
            // Additional mobile-specific prevention
            if (e.target) {
                e.target.blur();
            }
            
            this.stopContinuousScroll();
        }, { passive: false });

        button.addEventListener('touchcancel', (e) => {
            preventKeyboardPopup(e);
            
            // Additional mobile-specific prevention
            if (e.target) {
                e.target.blur();
            }
            
            this.stopContinuousScroll();
        }, { passive: false });

        // Prevent any focus-related events that might trigger keyboard
        button.addEventListener('focus', (e) => {
            preventKeyboardPopup(e);
        });

        button.addEventListener('focusin', (e) => {
            preventKeyboardPopup(e);
        });

        // Prevent context menu on long press
        button.addEventListener('contextmenu', (e) => {
            preventKeyboardPopup(e);
        });

        // Prevent any click events that might cause focus
        button.addEventListener('click', (e) => {
            preventKeyboardPopup(e);
        });

        // Additional touch move prevention to avoid any accidental interactions
        button.addEventListener('touchmove', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
    }

    // Bind mobile terminal control buttons
    bindMobileTerminalControls() {
        const controlsContainer = document.getElementById('mobile-terminal-controls');
        if (!controlsContainer) {
            return;
        }

        // Initialize collapsed/expanded state from localStorage
        this.initMobileControlsState();

        // Add toggle button event listener
        const toggleBtn = document.getElementById('mobile-controls-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.toggleMobileControls();
            });

            // Add touchstart for mobile responsiveness
            toggleBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                // AGGRESSIVE KEYBOARD HIDING - Force hide keyboard immediately
                this.forceHideKeyboard();
                
                // Enhanced keyboard popup prevention
                if (e.target && typeof e.target.blur === 'function') {
                    e.target.blur();
                }
                
                this.toggleMobileControls();
            });
        }

        // Add click event listener to the container (event delegation)
        controlsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('mobile-key-btn')) {
                // Track interaction for keyboard detection system
                this.trackMobileControlInteraction();
                
                // AGGRESSIVE KEYBOARD HIDING - Force hide keyboard immediately
                this.forceHideKeyboard();
                
                // Prevent any focus or keyboard activation
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                // Enhanced keyboard popup prevention
                if (e.target && typeof e.target.blur === 'function') {
                    e.target.blur();
                }
                
                // Different handling for different button types
                if (e.target.classList.contains('page-up-btn')) {
                    // Single scroll up for click
                    this.scrollTerminalWithRetry('up', 'page');
                } else if (e.target.classList.contains('page-down-btn')) {
                    // Single scroll down for click
                    this.scrollTerminalWithRetry('down', 'page');
                } else {
                    // Use API for arrow keys, enter, escape
                    this.handleMobileKeyPress(e.target);
                }
            }
        });

        // Add touchstart/touchend events for better mobile responsiveness
        controlsContainer.addEventListener('touchstart', (e) => {
            if (e.target.classList.contains('mobile-key-btn')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                // Track interaction for keyboard detection system
                this.trackMobileControlInteraction();
                
                // AGGRESSIVE KEYBOARD HIDING - Force hide keyboard immediately
                this.forceHideKeyboard();
                
                // Enhanced keyboard popup prevention (backup)
                if (e.target && typeof e.target.blur === 'function') {
                    e.target.blur();
                    // Multiple blur attempts with slight delays
                    setTimeout(() => {
                        if (e.target && typeof e.target.blur === 'function') {
                            e.target.blur();
                        }
                    }, 1);
                    setTimeout(() => {
                        if (e.target && typeof e.target.blur === 'function') {
                            e.target.blur();
                        }
                    }, 10);
                }
                
                // Force focus away from any input elements (backup)
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
                if (document.body) {
                    document.body.focus();
                }
                
                // Visual feedback
                this.showMobileKeyPressEffect(e.target);
                
                // Different handling for different button types
                if (e.target.classList.contains('page-up-btn')) {
                    // Use WebSocket continuous scroll for page up
                    this.startContinuousScroll('up');
                } else if (e.target.classList.contains('page-down-btn')) {
                    // Use WebSocket continuous scroll for page down
                    this.startContinuousScroll('down');
                } else {
                    // Use API for arrow keys, enter, escape
                    this.handleMobileKeyPress(e.target);
                }
            }
        }, { passive: false });

        controlsContainer.addEventListener('touchend', (e) => {
            if (e.target.classList.contains('mobile-key-btn')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                // Track interaction for keyboard detection system
                this.trackMobileControlInteraction();
                
                // AGGRESSIVE KEYBOARD HIDING - Force hide keyboard immediately
                this.forceHideKeyboard();
                
                // Enhanced keyboard popup prevention on touchend (backup)
                if (e.target && typeof e.target.blur === 'function') {
                    e.target.blur();
                    setTimeout(() => {
                        if (e.target && typeof e.target.blur === 'function') {
                            e.target.blur();
                        }
                    }, 1);
                }
                
                // Force focus away from any input elements
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
                if (document.body) {
                    document.body.focus();
                }
                
                // Stop continuous scrolling for page buttons only
                if (e.target.classList.contains('page-up-btn') || 
                    e.target.classList.contains('page-down-btn')) {
                    this.stopContinuousScroll();
                }
            }
        }, { passive: false });

        controlsContainer.addEventListener('touchcancel', (e) => {
            if (e.target.classList.contains('mobile-key-btn')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                // Track interaction for keyboard detection system
                this.trackMobileControlInteraction();
                
                // AGGRESSIVE KEYBOARD HIDING - Force hide keyboard immediately
                this.forceHideKeyboard();
                
                // Enhanced keyboard popup prevention on touchcancel (backup)
                if (e.target && typeof e.target.blur === 'function') {
                    e.target.blur();
                    setTimeout(() => {
                        if (e.target && typeof e.target.blur === 'function') {
                            e.target.blur();
                        }
                    }, 1);
                }
                
                // Force focus away from any input elements
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
                if (document.body) {
                    document.body.focus();
                }
                
                // Stop continuous scrolling for page buttons only
                if (e.target.classList.contains('page-up-btn') || 
                    e.target.classList.contains('page-down-btn')) {
                    this.stopContinuousScroll();
                }
            }
        }, { passive: false });

        // Enhanced focus prevention for mobile keyboard popup
        const preventKeyboardEvents = ['focusin', 'focus', 'input', 'beforeinput', 'compositionstart', 'compositionupdate', 'compositionend'];
        
        preventKeyboardEvents.forEach(eventType => {
            controlsContainer.addEventListener(eventType, (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                if (e.target && typeof e.target.blur === 'function') {
                    e.target.blur();
                    // Force blur multiple times to ensure effectiveness
                    setTimeout(() => {
                        if (e.target && typeof e.target.blur === 'function') {
                            e.target.blur();
                        }
                    }, 1);
                }
                
                // Force focus to body or a safe element
                if (document.body) {
                    document.body.focus();
                }
                
                return false;
            }, true);
        });
    }

    // Handle mobile key press for arrow keys, enter, escape, and key combinations
    // Note: Page up/down buttons use WebSocket scrolling, not this method
    async handleMobileKeyPress(button) {
        const key = button.dataset.key;
        
        const activeSession = this.getActiveSession();
        
        if (!activeSession) {
            console.warn('⚠️ No active terminal session');
            console.warn('No active terminal session');
            return;
        }
        
        try {
            // Handle Ctrl+C with modifiers parameter
            let requestBody;
            if (key === 'Ctrl+C') {
                requestBody = {
                    sessionName: activeSession.name,
                    key: 'c',
                    modifiers: { ctrl: true }
                };
            } else {
                requestBody = {
                    sessionName: activeSession.name,
                    key: key
                };
            }
            
            const response = await fetch('/api/terminal/send-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ API error response:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
        } catch (error) {
            console.error('❌ Failed to send mobile key:', error);
            console.error(`Failed to send key: ${error.message}`);
        }
    }

    // Show visual feedback for button press
    showMobileKeyPressEffect(button) {
        button.classList.add('pressed');
        setTimeout(() => {
            button.classList.remove('pressed');
        }, 150);
    }


    // Global focus management to prevent mobile keyboard popup
    setupGlobalFocusManagement() {
        // Track if we're interacting with scroll buttons
        let isScrollButtonInteraction = false;
        
        // Mark scroll button interactions
        const scrollButtons = ['scroll-up', 'scroll-down'];
        scrollButtons.forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                // Mark all interactions with scroll buttons
                ['touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click'].forEach(eventType => {
                    button.addEventListener(eventType, () => {
                        isScrollButtonInteraction = true;
                        setTimeout(() => {
                            isScrollButtonInteraction = false;
                        }, 100);
                    });
                });
            }
        });
        
        // Global focus prevention for scroll buttons
        document.addEventListener('focusin', (e) => {
            const target = e.target;
            
            // If the focus target is a scroll button, immediately blur it
            if (target && (target.id === 'scroll-up' || target.id === 'scroll-down')) {
                e.preventDefault();
                e.stopPropagation();
                target.blur();
                
                // Force focus to body or a safe element
                if (document.body) {
                    document.body.focus();
                }
                
                return false;
            }
            
            // During scroll button interactions, prevent focus on any element
            if (isScrollButtonInteraction) {
                e.preventDefault();
                e.stopPropagation();
                if (target && typeof target.blur === 'function') {
                    target.blur();
                }
                
                // Force focus to body
                if (document.body) {
                    document.body.focus();
                }
                
                return false;
            }
        }, true);
        
        // Additional protection against focus events
        document.addEventListener('focus', (e) => {
            const target = e.target;
            
            // If the focus target is a scroll button, immediately blur it
            if (target && (target.id === 'scroll-up' || target.id === 'scroll-down')) {
                e.preventDefault();
                e.stopPropagation();
                target.blur();
                
                // Force focus to body
                if (document.body) {
                    document.body.focus();
                }
                
                return false;
            }
        }, true);
        
        // Prevent any keyboard popup during touch interactions with scroll buttons
        document.addEventListener('touchstart', (e) => {
            const target = e.target;
            
            // If touching a scroll button, ensure no element has focus
            if (target && (target.id === 'scroll-up' || target.id === 'scroll-down')) {
                // Blur any currently focused element
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
                
                // Force focus to body
                if (document.body) {
                    document.body.focus();
                }
                
                // Mark interaction
                isScrollButtonInteraction = true;
                setTimeout(() => {
                    isScrollButtonInteraction = false;
                }, 200);
            }
        }, { passive: false });
        
    }

    // Create hidden input element for aggressive keyboard hiding
    createHiddenKeyboardKiller() {
        // Create a hidden input that we can use to "steal" focus and hide keyboard
        this.hiddenKeyboardKiller = document.createElement('input');
        this.hiddenKeyboardKiller.type = 'text';
        this.hiddenKeyboardKiller.style.position = 'absolute';
        this.hiddenKeyboardKiller.style.left = '-9999px';
        this.hiddenKeyboardKiller.style.top = '-9999px';
        this.hiddenKeyboardKiller.style.width = '1px';
        this.hiddenKeyboardKiller.style.height = '1px';
        this.hiddenKeyboardKiller.style.opacity = '0';
        this.hiddenKeyboardKiller.style.pointerEvents = 'none';
        this.hiddenKeyboardKiller.style.zIndex = '-1000';
        this.hiddenKeyboardKiller.setAttribute('tabindex', '-1');
        this.hiddenKeyboardKiller.setAttribute('readonly', 'readonly');
        this.hiddenKeyboardKiller.setAttribute('aria-hidden', 'true');
        
        // Add to document body
        document.body.appendChild(this.hiddenKeyboardKiller);
    }

    // Aggressively force hide mobile keyboard
    forceHideKeyboard() {
        try {
            // Blur all currently focused elements
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }
            
            // Find and blur all input elements that might have focus
            const allInputs = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
            allInputs.forEach(input => {
                if (typeof input.blur === 'function') {
                    input.blur();
                }
            });
            
            // Use our hidden input to "steal" focus and immediately blur it
            if (this.hiddenKeyboardKiller) {
                setTimeout(() => {
                    try {
                        this.hiddenKeyboardKiller.focus();
                        setTimeout(() => {
                            try {
                                this.hiddenKeyboardKiller.blur();
                                if (document.body) {
                                    document.body.focus();
                                }
                            } catch (e) {
                                // Silent fail
                            }
                        }, 10);
                    } catch (e) {
                        // Silent fail
                    }
                }, 50);
            }
            
            // Multiple delayed blur attempts to ensure keyboard is hidden
            const blurAttempts = [100, 200, 300, 500];
            blurAttempts.forEach(delay => {
                setTimeout(() => {
                    if (document.activeElement && document.activeElement !== document.body) {
                        document.activeElement.blur();
                    }
                    if (document.body) {
                        document.body.focus();
                    }
                }, delay);
            });
            
        } catch (error) {
            // Silent fail
        }
    }

    // Setup global keyboard detection and management system
    setupKeyboardDetection() {
        // Track initial viewport height
        this.initialViewportHeight = window.innerHeight;
        this.isKeyboardOpen = false;
        
        // Listen for viewport changes to detect keyboard
        window.addEventListener('resize', () => {
            const currentHeight = window.innerHeight;
            const heightDifference = this.initialViewportHeight - currentHeight;
            
            // Consider keyboard open if viewport shrunk by more than 150px
            const keyboardOpen = heightDifference > 150;
            
            if (keyboardOpen !== this.isKeyboardOpen) {
                this.isKeyboardOpen = keyboardOpen;
                
                // Smart detection: Only hide keyboard if it's definitely not a legitimate terminal interaction
                if (keyboardOpen && this.shouldHideKeyboard()) {
                    setTimeout(() => {
                        this.forceHideKeyboard();
                    }, 100);
                }
            }
        });
        
        // Listen for Visual Viewport API if available (more reliable on modern mobile browsers)
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                const keyboardOpen = window.visualViewport.height < window.innerHeight * 0.75;
                
                if (keyboardOpen !== this.isKeyboardOpen) {
                    this.isKeyboardOpen = keyboardOpen;
                    
                    // Smart detection: Only hide keyboard if it's definitely not a legitimate terminal interaction
                    if (keyboardOpen && this.shouldHideKeyboard()) {
                        setTimeout(() => {
                            this.forceHideKeyboard();
                        }, 100);
                    }
                }
            });
        }
        
        // Additional focus monitoring for aggressive keyboard prevention
        document.addEventListener('focusin', (e) => {
            // Skip if this is terminal iframe focus (user wants to interact with terminal)
            if (e.target && (e.target.closest('#ttyd-terminal') || 
                            e.target.closest('iframe[title="Terminal"]'))) {
                return;
            }
            
            // Smart detection: Only hide keyboard if it's not a legitimate terminal interaction
            if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || 
                 e.target.contentEditable === 'true') && this.shouldHideKeyboard()) {
                
                setTimeout(() => {
                    this.forceHideKeyboard();
                }, 50);
            }
        }, true);
        
        // Track legitimate terminal interactions to prevent interference
        this.setupTerminalInteractionTracking();
    }

    // Setup terminal area interaction tracking to distinguish legitimate terminal clicks
    setupTerminalInteractionTracking() {
        // Track when user clicks in terminal area (they want keyboard to show)
        document.addEventListener('click', (e) => {
            // Check if click is within terminal iframe or terminal container
            if (e.target && (e.target.closest('#ttyd-terminal') || 
                            e.target.closest('#terminal-content') ||
                            e.target.closest('iframe[title="Terminal"]'))) {
                
                this.trackTerminalInteraction();
                
                // Clear mobile control interaction effect when user explicitly clicks terminal
                if (this.lastMobileControlInteraction) {
                    const timeSinceControl = Date.now() - this.lastMobileControlInteraction;
                    if (timeSinceControl > 100) { // Give a small buffer for rapid interactions
                        this.lastMobileControlInteraction = null;
                    }
                }
            }
        }, true);
        
        // Additional tracking for iframe load and focus events
        const terminalIframe = document.getElementById('ttyd-terminal');
        if (terminalIframe) {
            terminalIframe.addEventListener('load', () => {
                // Try to access iframe content (may be blocked by same-origin policy)
                try {
                    const iframeDoc = terminalIframe.contentDocument || terminalIframe.contentWindow?.document;
                    if (iframeDoc) {
                        iframeDoc.addEventListener('click', (e) => {
                            this.trackTerminalInteraction();
                            
                            // Clear mobile control interaction when user clicks inside terminal
                            if (this.lastMobileControlInteraction) {
                                this.lastMobileControlInteraction = null;
                            }
                        });
                    }
                } catch (e) {
                    // Cannot access iframe content due to same-origin policy
                }
            });
        }
    }

    // Smart detection logic to determine if keyboard should be hidden
    shouldHideKeyboard() {
        const now = Date.now();
        
        // If user recently clicked terminal area, don't hide keyboard (they want to interact)
        if (this.lastTerminalInteraction && (now - this.lastTerminalInteraction) < 1000) {
            return false;
        }
        
        // If user recently interacted with mobile controls, hide keyboard
        if (this.lastMobileControlInteraction && (now - this.lastMobileControlInteraction) < 300) {
            return true;
        }
        
        // If no recent interactions of either type, don't interfere
        return false;
    }

    // Track mobile control interactions for keyboard detection
    trackMobileControlInteraction() {
        this.lastMobileControlInteraction = Date.now();
    }

    // Track terminal area interactions
    trackTerminalInteraction() {
        this.lastTerminalInteraction = Date.now();
    }


    // Enhanced multi-level continuous scrolling with smooth acceleration
    startContinuousScroll(direction) {
        // Prevent multiple intervals and reset state
        this.stopContinuousScroll();
        
        this.scrollDirection = direction;
        this.scrollStartTime = Date.now();
        this.currentScrollLevel = 0;
        
        
        // Immediate first scroll for instant feedback
        this.scrollTerminalWithRetry(direction, this.scrollLevels[0].mode);
        
        // Start with first level after minimal delay for instant response  
        setTimeout(() => {
            if (this.scrollDirection === direction) {
                this.startScrollLevel(direction, 0);
                // Schedule all acceleration levels
                this.scheduleAccelerationLevels(direction);
            }
        }, this.initialScrollDelay);
    }
    
    // Start scrolling at specific level
    startScrollLevel(direction, level) {
        if (level >= this.scrollLevels.length || this.scrollDirection !== direction) {
            return;
        }
        
        // Clear existing interval
        if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
        }
        
        const scrollConfig = this.scrollLevels[level];
        this.currentScrollLevel = level;
        
        
        // Start scrolling at current level
        this.scrollInterval = setInterval(() => {
            if (this.scrollDirection === direction) {
                this.scrollTerminalWithRetry(direction, scrollConfig.mode);
            } else {
                this.stopContinuousScroll();
            }
        }, scrollConfig.interval);
    }
    
    // Schedule all acceleration levels
    scheduleAccelerationLevels(direction) {
        // Schedule each level upgrade
        for (let i = 1; i < this.scrollLevels.length; i++) {
            const level = this.scrollLevels[i];
            setTimeout(() => {
                if (this.scrollDirection === direction) {
                    this.startScrollLevel(direction, i);
                }
            }, level.delay);
        }
    }

    // Stop continuous scrolling and reset state
    stopContinuousScroll() {
        if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
            this.scrollInterval = null;
        }
        
        // Log final performance stats
        
        // Reset scroll state
        this.scrollDirection = null;
        this.scrollStartTime = null;
        this.currentScrollLevel = 0;
    }

    // Handle WebSocket scroll result
    handleScrollResult(data) {
        if (data.success) {
            
            // Mark as in copy mode for scroll actions
            if (data.direction || data.action === 'scroll') {
                this.isInCopyMode = true;
                this.showCopyModeExitButton();
            }
            
            // Handle go-to-bottom-and-exit action
            if (data.action === 'go-to-bottom-and-exit') {
                this.isInCopyMode = false;
                this.hideCopyModeExitButton();
                this.stopContinuousScroll();
            }
        } else {
            console.error('❌ Terminal scroll via WebSocket failed:', data);
            console.error(`Scroll failed: ${data.message || 'Unknown error'}`);
        }
    }

    // Simplified scroll method - same logic for both directions
    async scrollTerminalWithRetry(direction, mode = 'line') {
        try {
            await this.scrollTerminal(direction, mode);
        } catch (error) {
            console.warn(`❌ Scroll ${direction} failed:`, error);
        }
    }

    // Terminal scrolling functions with WebSocket optimization
    async scrollTerminal(direction, mode = 'line') {
        const activeSession = this.getActiveSession();
        
        if (!activeSession || !activeSession.name) {
            return;
        }
        
        // Try WebSocket first for better performance
        if (window.socket && window.socket.isConnected()) {
            try {
                
                // Emit WebSocket event
                window.socket.socket.emit('terminal-scroll', {
                    sessionName: activeSession.name,
                    direction: direction,
                    mode: mode
                });
                
                // WebSocket result will be handled by handleScrollResult method
                return;
                
            } catch (error) {
                console.warn('⚠️ WebSocket scroll failed, falling back to HTTP:', error);
            }
        } else {
            console.warn('⚠️ WebSocket not available, using HTTP fallback');
        }
        
        // HTTP fallback
        try {
            
            const response = await fetch('/api/terminal/scroll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionName: activeSession.name,
                    direction: direction,
                    mode: mode
                })
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to scroll');
            }
            
            // Mark as in copy mode and show exit button (for HTTP fallback)
            this.isInCopyMode = true;
            this.showCopyModeExitButton();
            
            
        } catch (error) {
            console.error('❌ Failed to scroll terminal via HTTP:', error);
            console.error(`Scroll failed: ${error.message}`);
        }
    }
    
    // Go to bottom and exit copy mode with WebSocket optimization  
    async goToBottomAndExit() {
        const activeSession = this.getActiveSession();
        
        if (!activeSession || !activeSession.name) {
            // Hide button even if no active session
            this.isInCopyMode = false;
            this.hideCopyModeExitButton();
            return;
        }
        
        // Always hide button and stop scrolling first, regardless of API result
        this.isInCopyMode = false;
        this.hideCopyModeExitButton();
        this.stopContinuousScroll();
        
        // Try WebSocket first for better performance
        if (window.socket && window.socket.isConnected()) {
            try {
                
                // Emit WebSocket event
                window.socket.socket.emit('terminal-go-to-bottom', {
                    sessionName: activeSession.name
                });
                
                // WebSocket result will be handled by handleScrollResult method
                return;
                
            } catch (error) {
                console.warn('⚠️ WebSocket go to bottom failed, falling back to HTTP:', error);
            }
        } else {
            console.warn('⚠️ WebSocket not available, using HTTP fallback');
        }
        
        // HTTP fallback
        try {
            
            const response = await fetch('/api/terminal/go-to-bottom-and-exit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionName: activeSession.name
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to go to bottom and exit');
            }
            
            
        } catch (error) {
            console.error('❌ Failed to go to bottom and exit copy mode via HTTP:', error);
            console.error(`Go to bottom failed: ${error.message}`);
            
            // Try to at least exit copy mode manually if API fails
            try {
                await fetch('/api/terminal/exit-copy-mode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionName: activeSession.name })
                });
            } catch (fallbackError) {
                console.error('Fallback exit copy mode also failed:', fallbackError);
            }
        }
    }
    

    // Show scroll controls when terminal is active
    showScrollControls() {
        const scrollControls = document.getElementById('terminal-scroll-controls');
        if (scrollControls) {
            scrollControls.style.display = 'flex';
        }
    }

    // Hide scroll controls when no terminal is active
    hideScrollControls() {
        const scrollControls = document.getElementById('terminal-scroll-controls');
        if (scrollControls) {
            scrollControls.style.display = 'none';
        }
        
        // Also hide copy mode exit button and stop continuous scrolling
        this.hideCopyModeExitButton();
        this.stopContinuousScroll();
        this.isInCopyMode = false;
    }

    // Show copy mode exit button
    showCopyModeExitButton() {
        const exitButton = document.getElementById('copy-mode-exit-button');
        if (exitButton) {
            exitButton.style.display = 'block';
        }
    }

    // Hide copy mode exit button
    hideCopyModeExitButton() {
        const exitButton = document.getElementById('copy-mode-exit-button');
        if (exitButton) {
            exitButton.style.display = 'none';
        }
    }

    // Background monitoring to prevent base-session exposure
    startBaseSessionMonitoring() {
        // Only start monitoring if not already running
        if (this.baseSessionMonitor) {
            return;
        }
        
        console.log('🔍 Starting base-session monitoring');
        
        this.baseSessionMonitor = setInterval(async () => {
            try {
                // Only check if we have user sessions and iframe is visible
                if (this.sessions.size === 0 || !this.isInitialized) {
                    return;
                }
                
                // Check if any TTYd client is on base-session
                if (window.socket && window.socket.isConnected()) {
                    const isOnBaseSession = await this.checkIfOnBaseSession();
                    
                    if (isOnBaseSession) {
                        console.warn('🚨 Detected base-session exposure, switching away immediately');
                        
                        // If we have an active session, switch to it
                        if (this.activeSessionName && this.sessions.has(this.activeSessionName)) {
                            await this.switchToSessionRobust(this.activeSessionName);
                        }
                        // Otherwise switch to first available session
                        else if (this.sessions.size > 0) {
                            const firstSession = Array.from(this.sessions.keys())[0];
                            await this.switchToSessionRobust(firstSession);
                        }
                    }
                }
            } catch (error) {
                console.debug('Base-session monitoring error:', error);
            }
        }, 1000); // Check every second
    }
    
    // Stop base-session monitoring
    stopBaseSessionMonitoring() {
        if (this.baseSessionMonitor) {
            clearInterval(this.baseSessionMonitor);
            this.baseSessionMonitor = null;
            console.log('🔍 Stopped base-session monitoring');
        }
    }
    
    // Check if any client is currently on base-session
    async checkIfOnBaseSession() {
        try {
            // Use the backend utility to check session status
            const response = await fetch('/api/terminal/check-base-session', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                const result = await response.json();
                return result.isOnBaseSession || false;
            }
        } catch (error) {
            console.debug('Failed to check base-session status:', error);
        }
        
        return false;
    }

    // 清理资源
    destroy() {
        
        // 清理定时器
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        
        // 清理base-session监控
        this.stopBaseSessionMonitoring();
        
        // 清理连续滚动定时器
        this.stopContinuousScroll();
        
        // 清理DOM
        const tabsContainer = document.getElementById('terminal-tabs');
        if (tabsContainer) {
            tabsContainer.innerHTML = '';
        }
        
        // 清理隐藏的键盘killer元素
        if (this.hiddenKeyboardKiller && this.hiddenKeyboardKiller.parentNode) {
            this.hiddenKeyboardKiller.parentNode.removeChild(this.hiddenKeyboardKiller);
            this.hiddenKeyboardKiller = null;
        }

        // 清理数据
        this.sessions.clear();
        this.activeSessionName = null;
        this.isInitialized = false;
        this._isRestoring = false;
        this._isSwitchingSession = false;
        this.isInCopyMode = false;
        this.scrollInterval = null;
        this.scrollDirection = null;
        this.lastMobileControlInteraction = null;
        this.lastTerminalInteraction = null;
        this.isKeyboardOpen = false;
        this.initialViewportHeight = null;
    }

    // Initialize mobile controls collapsed/expanded state
    initMobileControlsState() {
        const controlsContainer = document.getElementById('mobile-terminal-controls');
        if (!controlsContainer) return;

        // Get saved state from localStorage (default to expanded)
        const savedState = localStorage.getItem('mobileControlsState');
        const isExpanded = savedState === null ? true : savedState === 'expanded';
        
        if (isExpanded) {
            controlsContainer.classList.remove('collapsed');
            controlsContainer.classList.add('expanded');
            this.updateToggleIcon(true);
        } else {
            controlsContainer.classList.remove('expanded');
            controlsContainer.classList.add('collapsed');
            this.updateToggleIcon(false);
        }
    }

    // Toggle mobile controls collapsed/expanded state
    toggleMobileControls() {
        const controlsContainer = document.getElementById('mobile-terminal-controls');
        if (!controlsContainer) return;

        const isCurrentlyExpanded = controlsContainer.classList.contains('expanded');
        
        if (isCurrentlyExpanded) {
            // Collapse
            controlsContainer.classList.remove('expanded');
            controlsContainer.classList.add('collapsed');
            localStorage.setItem('mobileControlsState', 'collapsed');
            this.updateToggleIcon(false);
        } else {
            // Expand
            controlsContainer.classList.remove('collapsed');
            controlsContainer.classList.add('expanded');
            localStorage.setItem('mobileControlsState', 'expanded');
            this.updateToggleIcon(true);
        }
    }

    // Update toggle icon based on state
    updateToggleIcon(isExpanded) {
        const toggleIcon = document.querySelector('.mobile-controls-toggle-icon');
        if (toggleIcon) {
            // Correct logic: collapsed shows left arrow (expand action), expanded shows right arrow (collapse action)
            toggleIcon.textContent = isExpanded ? '»' : '«';
        }
    }
}

// 创建全局实例
window.terminalManager = new TTYdTerminalManager();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.terminalManager.init();
});

// 导出以供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TTYdTerminalManager;
}