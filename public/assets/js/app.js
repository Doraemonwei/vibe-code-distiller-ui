// ===== MAIN APPLICATION =====

class ClaudeCodeWebManager extends EventEmitter {
    constructor() {
        super();
        this.isInitialized = false;
        this.systemStats = {};
        this.isHealthCheckOk = true; // Track health check status
        
        this.init();
    }
    
    async init() {
        try {
            // Show loading screen
            this.showLoadingScreen();
            
            // Initialize components
            await this.initializeComponents();
            
            // Setup global event handlers
            this.setupGlobalEventHandlers();
            
            // Setup keyboard shortcuts
            this.setupKeyboardShortcuts();
            
            // Initialize shortcuts panel if available
            this.initializeShortcutsPanel();
            
            // Wait for projects to load before deciding what to show
            await this.waitForProjectsAndShowApp();
            
            // Initialize system monitoring
            this.initializeSystemMonitoring();
            
            // Setup notification status click handler
            this.setupNotificationStatusHandler();
            
            // Initialize theme system
            this.initializeTheme();
            
            // Setup project event listeners
            this.setupProjectEventListeners();
            
            this.isInitialized = true;
            this.emit('app_initialized');
            
            // Ensure document title is set correctly
            document.title = 'vibe-code-distiller';
            
            console.log('🚀 vibe-code-distiller initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            this.showErrorScreen(error);
        }
    }
    
    showLoadingScreen() {
        const loadingScreen = DOM.get('loading-screen');
        const app = DOM.get('app');
        
        if (loadingScreen) DOM.show(loadingScreen);
        if (app) DOM.hide(app);
    }
    
    hideLoadingScreen(showMainApp = true) {
        const loadingScreen = DOM.get('loading-screen');
        const app = DOM.get('app');
        
        if (loadingScreen) {
            setTimeout(() => {
                DOM.hide(loadingScreen);
                if (showMainApp && app) {
                    DOM.show(app);
                }
            }, 100); // Reduced delay for smoother welcome screen transition
        }
    }
    
    async waitForProjectsAndShowApp() {
        try {
            // Wait for project manager to be available
            await this.waitForProjectManager();
            
            // Wait for projects to load
            await this.waitForProjectsLoaded();
            
            // Check if we have projects
            const hasProjects = window.projectManager && window.projectManager.hasProjects();
            
            if (hasProjects) {
                // Show main app interface normally
                console.log('📂 Projects found, showing main application interface');
                this.hideLoadingScreen(true);
            } else {
                // No projects - coordinate showing main app and welcome screen simultaneously
                console.log('📭 No projects found, coordinating main app + welcome screen display');
                
                // First prepare welcome screen to be ready
                this.prepareWelcomeScreen();
                
                // Then show main app with welcome screen already visible
                this.hideLoadingScreen(true);
                
                // Validate UI state after a short delay
                setTimeout(() => {
                    this.validateUIState();
                }, 1000);
            }
            
        } catch (error) {
            console.error('Failed to load projects, showing main app as fallback:', error);
            // Fallback to showing main app
            this.hideLoadingScreen(true);
        }
    }
    
    waitForProjectManager() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Project manager initialization timeout'));
            }, 10000);
            
            const checkProjectManager = () => {
                if (window.projectManager) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(checkProjectManager, 100);
                }
            };
            
            checkProjectManager();
        });
    }
    
    waitForProjectsLoaded() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Projects loading timeout'));
            }, 15000);
            
            // If projects are already loaded, resolve immediately
            if (window.projectManager && window.projectManager.getAllProjects) {
                const projects = window.projectManager.getAllProjects();
                if (projects && Array.isArray(projects)) {
                    clearTimeout(timeout);
                    resolve();
                    return;
                }
            }
            
            // Otherwise wait for projects_loaded event
            const handleProjectsLoaded = () => {
                clearTimeout(timeout);
                if (window.projectManager) {
                    window.projectManager.off('projects_loaded', handleProjectsLoaded);
                }
                resolve();
            };
            
            if (window.projectManager && typeof window.projectManager.on === 'function') {
                window.projectManager.on('projects_loaded', handleProjectsLoaded);
            } else {
                // Fallback: just wait a bit and assume projects are loaded
                setTimeout(() => {
                    clearTimeout(timeout);
                    resolve();
                }, 2000);
            }
        });
    }
    
    ensureWelcomeScreenDisplay() {
        // Wait for terminal manager to be available
        const waitForTerminalManager = () => {
            if (window.terminalManager && typeof window.terminalManager.showWelcomeOrEmptyScreen === 'function') {
                console.log('🎯 Terminal manager ready, showing welcome screen');
                window.terminalManager.showWelcomeOrEmptyScreen();
            } else {
                // Fallback: directly show welcome screen if terminal manager is not ready
                console.log('⚠️ Terminal manager not ready, using direct welcome screen fallback');
                this.directWelcomeScreenFallback();
            }
        };
        
        // Try immediately, then with retries
        waitForTerminalManager();
        
        // Backup retry after 1 second
        setTimeout(() => {
            if (window.terminalManager && typeof window.terminalManager.showWelcomeOrEmptyScreen === 'function') {
                // Double-check that welcome screen is actually visible
                const welcomeScreen = document.getElementById('welcome-screen');
                if (!welcomeScreen || welcomeScreen.style.display === 'none') {
                    console.log('🔄 Welcome screen not visible, retrying...');
                    window.terminalManager.showWelcomeOrEmptyScreen();
                }
            }
        }, 1000);
    }
    
    directWelcomeScreenFallback() {
        // Direct DOM manipulation as fallback
        const welcomeScreen = document.getElementById('welcome-screen');
        const terminalEmptyState = document.getElementById('terminal-empty-state');
        const terminalLoadingState = document.getElementById('terminal-loading-state');
        const ttydTerminal = document.getElementById('ttyd-terminal');
        
        if (welcomeScreen) {
            welcomeScreen.style.display = 'flex';
            console.log('✅ Welcome screen shown via direct fallback');
        }
        
        // Hide other terminal states
        if (terminalEmptyState) terminalEmptyState.style.display = 'none';
        if (terminalLoadingState) terminalLoadingState.style.display = 'none';
        if (ttydTerminal) ttydTerminal.style.display = 'none';
    }
    
    prepareWelcomeScreen() {
        console.log('🎯 Preparing welcome screen before showing main app');
        
        // Immediately set welcome screen to be visible
        const welcomeScreen = document.getElementById('welcome-screen');
        const terminalEmptyState = document.getElementById('terminal-empty-state');
        const terminalLoadingState = document.getElementById('terminal-loading-state');
        const ttydTerminal = document.getElementById('ttyd-terminal');
        
        if (welcomeScreen) {
            welcomeScreen.style.display = 'flex';
            console.log('✅ Welcome screen set to visible before main app shows');
        }
        
        // Hide other terminal states
        if (terminalEmptyState) terminalEmptyState.style.display = 'none';
        if (terminalLoadingState) terminalLoadingState.style.display = 'none';
        if (ttydTerminal) ttydTerminal.style.display = 'none';
        
        // Also try to ensure terminal manager is in correct state
        if (window.terminalManager && typeof window.terminalManager.showWelcomeOrEmptyScreen === 'function') {
            // Call this immediately since we've already set the DOM state
            window.terminalManager.showWelcomeOrEmptyScreen();
        }
    }
    
    setupProjectEventListeners() {
        // Wait for project manager to be available
        const waitForProjectManager = () => {
            if (window.projectManager && typeof window.projectManager.on === 'function') {
                // Listen for project creation to handle welcome screen -> main app transition
                window.projectManager.on('project_created', (project) => {
                    console.log('🎉 First project created, transitioning from welcome screen');
                    
                    // Hide welcome screen and show normal terminal state
                    setTimeout(() => {
                        if (window.terminalManager && typeof window.terminalManager.showWelcomeOrEmptyScreen === 'function') {
                            window.terminalManager.showWelcomeOrEmptyScreen();
                        }
                    }, 100);
                });
                
                console.log('✅ App-level project event listeners setup complete');
            } else {
                // Retry after a short delay
                setTimeout(waitForProjectManager, 100);
            }
        };
        
        waitForProjectManager();
    }
    
    // Validation method to check if the UI is in the correct state
    validateUIState() {
        const hasProjects = window.projectManager && window.projectManager.hasProjects();
        const welcomeScreen = document.getElementById('welcome-screen');
        const terminalEmptyState = document.getElementById('terminal-empty-state');
        const mainApp = document.getElementById('app');
        const loadingScreen = document.getElementById('loading-screen');
        
        console.log('🔍 UI State Validation:');
        console.log('  - Has projects:', hasProjects);
        console.log('  - Main app visible:', mainApp && mainApp.style.display !== 'none');
        console.log('  - Loading screen visible:', loadingScreen && loadingScreen.style.display !== 'none');
        console.log('  - Welcome screen visible:', welcomeScreen && welcomeScreen.style.display === 'flex');
        console.log('  - Terminal empty state visible:', terminalEmptyState && terminalEmptyState.style.display !== 'none');
        
        // Expected states:
        // - No projects: welcome screen should be visible, main app should be visible, loading should be hidden
        // - Has projects: main app should be visible, loading should be hidden, welcome screen should be hidden
        
        if (!hasProjects) {
            if (!welcomeScreen || welcomeScreen.style.display !== 'flex') {
                console.warn('⚠️ No projects but welcome screen not visible - triggering fallback');
                this.directWelcomeScreenFallback();
            }
        }
    }
    
    showErrorScreen(error) {
        const loadingScreen = DOM.get('loading-screen');
        if (loadingScreen) {
            loadingScreen.innerHTML = `
                <div class="loading-content">
                    <div class="error-icon">❌</div>
                    <h2>Failed to Initialize</h2>
                    <p>Vibe Code Distiller failed to start:</p>
                    <p class="error-message">${error.message}</p>
                    <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                </div>
            `;
        }
    }
    
    async initializeComponents() {
        // Ensure socket is available
        if (typeof socket === 'undefined') {
            throw new Error('Socket client not available');
        }
        
        // Wait for socket connection
        if (!socket.isConnected()) {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Socket connection timeout'));
                }, 10000);
                
                socket.onConnected(() => {
                    clearTimeout(timeout);
                    resolve();
                });
                
                socket.onConnectionError((error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        }
    }
    
    setupGlobalEventHandlers() {
        // Mobile menu toggle
        DOM.on('mobile-menu-toggle', 'click', () => {
            this.toggleMobileMenu();
        });
        
        // Mobile backdrop
        DOM.on('mobile-backdrop', 'click', () => {
            this.closeMobileMenu();
        });
        
        
        // Documentation button
        DOM.on('help-docs-btn', 'click', () => {
            this.showDocumentation();
        });
        
        // Settings button
        DOM.on('settings-btn', 'click', () => {
            this.showSettings();
        });
        
        
        
        
        
        // Modal close handlers
        DOM.queryAll('.modal-close').forEach(btn => {
            DOM.on(btn, 'click', () => {
                modals.close();
            });
        });
        
        // Settings tabs
        DOM.on(document, 'click', (e) => {
            if (e.target.classList.contains('settings-tab')) {
                this.switchSettingsTab(e.target.dataset.tab);
            }
        });
        
        // Window events
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
        
        window.addEventListener('resize', Utils.throttle(() => {
            this.handleWindowResize();
        }, 250));
        
        // System monitoring
        socket.onSystemStatus((data) => {
            this.updateSystemStatus(data);
        });
        
        // Theme synchronization
        socket.on('theme-changed', (data) => {
            if (data && data.theme) {
                console.log(`🔄 Theme change received from server: ${data.theme}`);
                this.applyTheme(data.theme);
                
                // Dispatch theme change event for other components
                document.dispatchEvent(new CustomEvent('themeChanged', {
                    detail: { theme: data.theme }
                }));
                
                // Update documentation highlight theme
                if (typeof this.ensureHighlightTheme === 'function') {
                    this.ensureHighlightTheme(data.theme);
                    console.log(`🎨 Documentation highlight theme synced to: ${data.theme}`);
                }
            }
        });
    }
    
    setupKeyboardShortcuts() {
        // Global shortcuts
        keyboard.register('ctrl+,', () => {
            this.showSettings();
        });
        
        
        keyboard.register('escape', () => {
            this.handleEscapeKey();
        });
        
        // Terminal shortcuts are handled by TerminalManager
        // Project shortcuts are handled by ProjectManager
    }
    
    initializeShortcutsPanel() {
        // The shortcuts panel initializes itself via DOMContentLoaded
        // but we can add any app-specific integration here
        if (window.shortcutsPanel) {
            console.log('✅ Shortcuts panel initialized');
        } else {
            // Wait for shortcuts panel to be ready
            setTimeout(() => {
                if (window.shortcutsPanel) {
                    console.log('✅ Shortcuts panel ready');
                }
            }, 100);
        }
    }
    
    // ===== THEME MANAGEMENT =====
    async initializeTheme() {
        try {
            // Check if theme was already applied during page load
            const body = document.body;
            const hasValidTheme = body.classList.contains('theme-light') || body.classList.contains('theme-dark');
            
            if (hasValidTheme) {
                const currentTheme = body.classList.contains('theme-light') ? 'light' : 'dark';
                console.log(`🎨 Theme already applied during page load: ${currentTheme}`);
                
                // Update theme selector to match current theme
                const themeSelector = DOM.get('theme-selector');
                if (themeSelector) {
                    themeSelector.value = currentTheme;
                }
                
                // Verify theme is consistent with server by fetching latest
                console.log('🎨 Verifying theme consistency with server...');
                const response = await HTTP.get('/api/theme');
                if (response.success && response.theme !== currentTheme) {
                    console.log(`🎨 Theme mismatch detected! Server: ${response.theme}, Local: ${currentTheme}`);
                    console.log(`🎨 Syncing local theme to server and restarting TTYd...`);
                    
                    try {
                        // Sync local theme to server
                        const themeResponse = await HTTP.post('/api/theme', { theme: currentTheme });
                        if (themeResponse.success) {
                            console.log(`🎨 Theme synced to server: ${currentTheme}`);
                        }
                        
                        // Update TTYd configuration with the local theme
                        const ttydResponse = await HTTP.post('/api/ttyd/config', { theme: currentTheme });
                        if (ttydResponse.success) {
                            console.log(`🎨 TTYd theme updated successfully`);
                            
                            // Ensure theme is saved to localStorage and UI is updated
                            this.applyTheme(currentTheme);
                            
                            // Reload terminal iframe instead of refreshing the page (silent mode for theme sync)
                            if (window.terminalManager && typeof window.terminalManager.reloadTerminal === 'function') {
                                console.log(`🎨 Reloading terminal to apply theme...`);
                                window.terminalManager.reloadTerminal(true); // silent = true
                            } else {
                                console.warn(`🎨 Terminal manager not available, skipping terminal reload`);
                            }
                        }
                    } catch (error) {
                        console.error(`🎨 Failed to sync theme:`, error);
                        // Fall back to server theme on error
                        this.applyTheme(response.theme);
                    }
                    
                    console.log(`🎨 Theme initialization complete: ${currentTheme}`);
                }
                return;
            }
            
            // If still in loading state, wait for theme to be applied or apply it
            if (body.classList.contains('theme-loading')) {
                console.log('🎨 Theme still loading, waiting for initial theme setup...');
                // Give the initial theme script a chance to complete
                setTimeout(() => this.initializeTheme(), 100);
                return;
            }
            
            console.log('🎨 No theme detected, fetching from API...');
            // Always get theme from API - this is the source of truth
            const response = await HTTP.get('/api/theme');
            
            if (response.success) {
                this.applyTheme(response.theme);
                console.log(`🎨 Theme initialized from API: ${response.theme}`);
            } else {
                throw new Error(response.error || 'Failed to load theme from server');
            }
        } catch (error) {
            console.warn('Failed to load theme from server:', error.message);
            // Emergency fallback only when API is completely unavailable
            const emergencyTheme = 'light';
            this.applyTheme(emergencyTheme);
            console.log(`🎨 Theme initialized with emergency fallback: ${emergencyTheme}`);
        }
    }
    
    applyTheme(theme) {
        const body = document.body;
        
        // Remove existing theme classes including loading state
        body.classList.remove('theme-light', 'theme-dark', 'theme-loading');
        
        // Apply new theme
        if (theme === 'light') {
            body.classList.add('theme-light');
        } else {
            body.classList.add('theme-dark');
        }
        
        // Save to localStorage for instant loading next time
        localStorage.setItem('app-theme', theme);
        
        // Update theme selector if it exists
        const themeSelector = DOM.get('theme-selector');
        if (themeSelector) {
            themeSelector.value = theme;
        }
        
        console.log(`🎨 Theme applied by app manager: ${theme}`);
    }
    
    async handleThemeChange(theme) {
        try {
            // Save theme to backend first
            const themeResponse = await HTTP.post('/api/theme', { theme });
            if (themeResponse.success) {
                console.log(`🎨 Theme saved to server: ${theme}`);
            } else {
                console.error(`Failed to save theme to server: ${themeResponse.error}`);
                // Continue with local changes even if server save fails
            }
        } catch (error) {
            console.error(`Error saving theme to server: ${error.message}`);
            // Continue with local changes even if server save fails
        }
        
        this.applyTheme(theme);
        console.log(`🎨 Theme changed to: ${theme}`);
        
        // Dispatch theme change event for other components
        document.dispatchEvent(new CustomEvent('themeChanged', {
            detail: { theme }
        }));
        
        // Update TTYd terminal theme and refresh page
        try {
            const response = await HTTP.post('/api/ttyd/config', { theme });
            if (response.success) {
                console.log('TTYd theme updated successfully, refreshing page...');
                // Directly refresh the page to load new theme and restarted ttyd
                setTimeout(() => {
                    window.location.reload();
                }, 500);
            } else {
                console.error(`Failed to update TTYd theme: ${response.error}`);
            }
        } catch (error) {
            console.error(`Error updating TTYd theme: ${error.message}`);
        }
        
        // Update documentation highlight theme
        if (typeof this.ensureHighlightTheme === 'function') {
            this.ensureHighlightTheme(theme);
            console.log(`🎨 Documentation highlight theme updated to: ${theme}`);
        }
    }
    
    
    initializeSystemMonitoring() {
        // Update system metrics periodically (fast detection for connection issues)
        setInterval(() => {
            this.updateSystemMetrics();
        }, 2000); // 2s interval for fast TTYd connection detection
        
        // Initial update
        this.updateSystemMetrics();
    }
    
    async updateSystemMetrics() {
        try {
            const response = await HTTP.get('/api/system/status');
            
            if (response.success) {
                // Health check succeeded
                if (!this.isHealthCheckOk) {
                    // Health check recovered - show reconnection message and refresh page
                    console.log('🟢 Health check recovered, showing reconnection message and refreshing page');
                    this.isHealthCheckOk = true;
                    
                    // Show reconnection message in terminal
                    if (window.terminalManager && typeof window.terminalManager.showReconnectionMessage === 'function') {
                        window.terminalManager.showReconnectionMessage();
                    }
                    
                    // Refresh the page after a brief delay to show the message
                    setTimeout(() => {
                        console.log('🔄 Refreshing page after health check recovery');
                        window.location.reload();
                    }, 2000);
                }
                
                this.systemStats = response.system;
                this.updateSystemUI();
            }
        } catch (error) {
            console.warn('Failed to get system status:', error);
            
            // Health check failed
            if (this.isHealthCheckOk) {
                // Health check just failed - show disconnection message in terminal
                console.log('🔴 Health check failed, showing disconnection message in terminal');
                this.isHealthCheckOk = false;
                
                // Show disconnection message in terminal
                if (window.terminalManager && typeof window.terminalManager.showDisconnectionMessage === 'function') {
                    window.terminalManager.showDisconnectionMessage();
                }
            }
        }
    }
    
    updateSystemUI() {
        // Update header system load
        const systemLoad = DOM.get('system-load');
        if (systemLoad && this.systemStats.cpu) {
            systemLoad.querySelector('.text').textContent = `CPU: ${this.systemStats.cpu.usage}%`;
        }
        
        // Update temperature display
        const systemTemp = DOM.get('system-temp');
        if (systemTemp && this.systemStats.temperature) {
            const temp = this.systemStats.temperature.cpu;
            systemTemp.querySelector('.text').textContent = `Temp: ${temp}°C`;
        }
        
        // Update memory display
        const systemMemory = DOM.get('system-memory');
        if (systemMemory && this.systemStats.memory) {
            const memUsage = this.systemStats.memory.usage;
            systemMemory.querySelector('.text').textContent = `RAM: ${memUsage}%`;
        }
    }
    
    updateSystemStatus(data) {
        // Update connection count and other real-time stats
        console.log('📊 System status update:', data);
    }
    
    async showDocumentation() {
        try {
            const docsModal = DOM.get('docs-modal');
            const docsContent = DOM.get('docs-content');
            
            if (!docsModal || !docsContent) {
                notifications.error('Documentation modal not found');
                return;
            }
            
            // Show loading state
            docsContent.innerHTML = `
                <div class="loading-placeholder">
                    <div class="loading-spinner"></div>
                    <span>Loading documentation...</span>
                </div>
            `;
            
            // Open modal first to show loading state
            modals.open('docs-modal');
            
            // Fetch documentation content
            const response = await HTTP.get('/api/documentation');
            
            if (response.success) {
                // Convert markdown to HTML (simple conversion for now)
                const htmlContent = this.markdownToHtml(response.content);
                
                docsContent.innerHTML = `
                    <div class="markdown-content">
                        ${htmlContent}
                    </div>
                `;
            } else {
                docsContent.innerHTML = `
                    <div class="error-message">
                        <h3>❌ Failed to Load Documentation</h3>
                        <p>${response.error || 'Unknown error occurred'}</p>
                    </div>
                `;
            }
            
        } catch (error) {
            console.error('Failed to load documentation:', error);
            const docsContent = DOM.get('docs-content');
            if (docsContent) {
                docsContent.innerHTML = `
                    <div class="error-message">
                        <h3>❌ Error Loading Documentation</h3>
                        <p>${error.message}</p>
                    </div>
                `;
            }
            notifications.error('Failed to load documentation: ' + error.message);
        }
    }

    // Professional markdown to HTML converter using marked.js + highlight.js
    markdownToHtml(markdown) {
        if (!markdown) return '';
        
        // Check if libraries are available
        if (typeof marked === 'undefined' || typeof hljs === 'undefined') {
            console.warn('Markdown libraries not loaded, falling back to basic rendering');
            return `<div class="error-message">
                <h3>❌ Markdown Libraries Missing</h3>
                <p>Documentation rendering libraries not available. Please refresh the page.</p>
            </div>`;
        }
        
        try {
            // Configure marked options for security and features
            marked.setOptions({
                // Enable GitHub Flavored Markdown
                gfm: true,
                // Break on single line breaks
                breaks: true,
                // Use header IDs for navigation
                headerIds: false,
                // Syntax highlighting function
                highlight: function(code, language) {
                    if (language && hljs.getLanguage(language)) {
                        try {
                            return hljs.highlight(code, { language: language }).value;
                        } catch (err) {
                            console.warn('Highlight.js error for language ' + language + ':', err);
                        }
                    }
                    // Auto-detect language if not specified or invalid
                    try {
                        return hljs.highlightAuto(code).value;
                    } catch (err) {
                        console.warn('Highlight.js auto-detection error:', err);
                        return code; // Return unhighlighted code as fallback
                    }
                },
                // Security: Sanitize HTML to prevent XSS
                sanitize: false, // We'll handle this manually for better control
                smartLists: true,
                smartypants: false // Disable smart quotes to avoid encoding issues
            });
            
            // Create custom renderer for image handling
            const renderer = new marked.Renderer();
            
            // Override image rendering to handle relative paths
            renderer.image = function(href, title, text) {
                // Convert relative paths to API endpoints
                if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('data:')) {
                    href = `/api/documentation/images/${href}`;
                }
                
                let out = '<img src="' + href + '" alt="' + text + '" class="markdown-image"';
                if (title) {
                    out += ' title="' + title + '"';
                }
                out += '>';
                return out;
            };
            
            // Override link rendering for security
            renderer.link = function(href, title, text) {
                // Security: Only allow safe protocols
                if (href && (href.startsWith('javascript:') || href.startsWith('vbscript:') || href.startsWith('data:'))) {
                    return text; // Return just the text for potentially dangerous links
                }
                
                let out = '<a href="' + href + '"';
                if (title) {
                    out += ' title="' + title + '"';
                }
                // Open external links in new tab
                if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                    out += ' target="_blank" rel="noopener noreferrer"';
                }
                out += '>' + text + '</a>';
                return out;
            };
            
            // Set the custom renderer
            marked.setOptions({ renderer: renderer });
            
            // Parse markdown to HTML
            let html = marked.parse(markdown);
            
            // Apply theme-based highlight.js CSS
            this.ensureHighlightTheme();
            
            return html;
            
        } catch (error) {
            console.error('Error rendering markdown:', error);
            return `<div class="error-message">
                <h3>❌ Markdown Rendering Error</h3>
                <p>Failed to render documentation: ${error.message}</p>
                <details>
                    <summary>Technical Details</summary>
                    <pre>${error.stack || 'No stack trace available'}</pre>
                </details>
            </div>`;
        }
    }
    
    // Ensure highlight.js theme CSS is loaded based on current app theme
    async ensureHighlightTheme(theme = null) {
        let currentTheme = theme;
        
        // If no theme provided, get it from backend API
        if (!currentTheme) {
            try {
                const response = await HTTP.get('/api/theme');
                if (response.success) {
                    currentTheme = response.theme;
                } else {
                    currentTheme = 'light'; // fallback
                }
            } catch (error) {
                console.warn('Failed to get theme for highlight.js:', error.message);
                currentTheme = 'light'; // fallback
            }
        }
        
        const existingTheme = document.querySelector('#docs-highlight-theme');
        
        // Remove existing theme if present
        if (existingTheme) {
            existingTheme.remove();
        }
        
        // Determine theme file
        const themeFile = currentTheme === 'light' ? 'github.min.css' : 'github-dark.min.css';
        
        // Create and append new theme link
        const link = document.createElement('link');
        link.id = 'docs-highlight-theme';
        link.rel = 'stylesheet';
        link.href = `/assets/libs/highlight-themes/${themeFile}`;
        link.onload = function() {
            console.log(`✅ Highlight.js theme loaded: ${themeFile}`);
        };
        link.onerror = function() {
            console.warn(`⚠️ Failed to load highlight.js theme: ${themeFile}`);
        };
        
        document.head.appendChild(link);
    }

    async showSettings(defaultTab = 'general') {
        const settingsModal = DOM.get('settings-modal');
        const settingsContent = settingsModal?.querySelector('.settings-content');
        
        if (settingsContent) {
            this.renderSettingsContent(settingsContent);
            await this.loadSettingsValues();
            this.switchSettingsTab(defaultTab);
        }
        
        modals.open('settings-modal');
    }
    
    renderSettingsContent(container) {
        container.innerHTML = `
            <div class="settings-panel active" data-panel="general">
                
                <div class="settings-group">
                    <h4>Notifications</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Enable Notifications</div>
                            <div class="settings-item-description">Show system and project notifications</div>
                        </div>
                        <div class="settings-item-control">
                            <div class="toggle-switch" id="notifications-toggle">
                                <input type="checkbox" id="notifications-enabled">
                                <div class="toggle-slider"></div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="settings-group">
                    <h4>Theme</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Application Theme</div>
                            <div class="settings-item-description">Choose between light and dark theme appearance</div>
                        </div>
                        <div class="settings-item-control">
                            <select id="theme-selector" class="theme-selector">
                                <option value="light">Light</option>
                                <option value="dark">Dark</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="settings-group">
                    <h4>Shortcuts Panel</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Show Shortcuts Panel</div>
                            <div class="settings-item-description">Display floating keyboard shortcuts reference panel</div>
                        </div>
                        <div class="settings-item-control">
                            <div class="toggle-switch" id="shortcuts-panel-toggle">
                                <input type="checkbox" id="shortcuts-panel-enabled" checked>
                                <div class="toggle-slider"></div>
                            </div>
                        </div>
                    </div>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Reset Panel Position</div>
                            <div class="settings-item-description">Reset shortcuts panel to default position</div>
                        </div>
                        <div class="settings-item-control">
                            <button class="btn btn-secondary btn-small" id="reset-shortcuts-position">Reset Position</button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="settings-panel" data-panel="terminal">
                <div class="settings-group">
                    <h4>Terminal Appearance</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Font Size</div>
                            <div class="settings-item-description">Terminal font size (8-32 pixels). Changes require TTYd service restart.</div>
                        </div>
                        <div class="settings-item-control">
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="number" id="terminal-font-size" min="8" max="32" value="15" style="width: 80px;">
                                <button class="btn btn-primary btn-small" id="apply-font-size">Apply</button>
                            </div>
                        </div>
                    </div>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">TTYd Service</div>
                            <div class="settings-item-description">Terminal service status information</div>
                        </div>
                        <div class="settings-item-control">
                            <span class="service-status" id="ttyd-status">Loading...</span>
                        </div>
                    </div>
                </div>
                
                <div class="settings-group">
                    <h4>New terminal button</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Show New Terminal Button</div>
                            <div class="settings-item-description">Display new terminal button in terminal status bar (advanced feature)</div>
                        </div>
                        <div class="settings-item-control">
                            <div class="toggle-switch" id="new-terminal-btn-toggle">
                                <input type="checkbox" id="new-terminal-btn-enabled">
                                <div class="toggle-slider"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="settings-panel" data-panel="system">
                <div class="settings-group">
                    <h4>System Information</h4>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">Memory Usage</div>
                            <div class="settings-item-description">${this.systemStats.memory?.used || 0} MB used</div>
                        </div>
                    </div>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <div class="settings-item-title">CPU Usage</div>
                            <div class="settings-item-description">${this.systemStats.cpu?.usage || 0}% average</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Update TTYd status display
        this.updateTTYdStatus();
        
        // Setup settings event handlers
        
        // Theme selector event handler
        DOM.on('theme-selector', 'change', (e) => {
            const selectedTheme = e.target.value;
            this.handleThemeChange(selectedTheme);
        });
        
        // Terminal settings event handlers
        DOM.on('apply-font-size', 'click', async (e) => {
            const fontSize = parseInt(DOM.get('terminal-font-size').value);
            
            if (isNaN(fontSize) || fontSize < 8 || fontSize > 32) {
                console.error('Font size must be between 8 and 32 pixels');
                return;
            }
            
            try {
                e.target.disabled = true;
                e.target.textContent = 'Applying...';
                
                // Get current theme from backend to preserve it during font size change
                let currentTheme = 'light'; // fallback
                try {
                    const themeResponse = await HTTP.get('/api/theme');
                    if (themeResponse.success) {
                        currentTheme = themeResponse.theme;
                    }
                } catch (error) {
                    console.warn('Failed to get current theme for font size update:', error.message);
                }
                
                const response = await HTTP.post('/api/ttyd/config', { fontSize, theme: currentTheme });
                
                if (response.success) {
                    console.log('Font size updated! TTYd service has been restarted.');
                    // Update TTYd status after configuration change
                    this.updateTTYdStatus();
                    // Reload the terminal iframe to reflect changes
                    if (window.terminalManager) {
                        setTimeout(() => {
                            window.terminalManager.reloadTerminal();
                        }, 2000);
                    }
                } else {
                    console.error(`Failed to update font size: ${response.error}`);
                }
            } catch (error) {
                console.error(`Error updating font size: ${error.message}`);
            } finally {
                e.target.disabled = false;
                e.target.textContent = 'Apply';
            }
        });
        
        // Notification settings event handler
        DOM.on('notifications-toggle', 'click', (e) => {
            const toggleElement = e.currentTarget;
            const checkbox = toggleElement.querySelector('input[type="checkbox"]');
            
            // Toggle the checkbox state
            checkbox.checked = !checkbox.checked;
            
            // Update visual state
            toggleElement.classList.toggle('active', checkbox.checked);
            
            // Save state and update NotificationManager
            Storage.set('notifications-enabled', checkbox.checked);
            
            if (window.notifications && window.notifications.isEnabled !== checkbox.checked) {
                window.notifications.toggle();
            }
        });
        
        // Shortcuts panel settings event handlers
        DOM.on('shortcuts-panel-toggle', 'click', (e) => {
            const toggleElement = e.currentTarget;
            const checkbox = toggleElement.querySelector('input[type="checkbox"]');
            
            // Toggle the checkbox state
            checkbox.checked = !checkbox.checked;
            
            // Update visual state
            toggleElement.classList.toggle('active', checkbox.checked);
            
            // Save state and update shortcuts panel
            Storage.set('shortcuts-panel-enabled', checkbox.checked);
            
            if (window.shortcutsPanel) {
                if (checkbox.checked) {
                    window.shortcutsPanel.enable();
                } else {
                    window.shortcutsPanel.disable();
                }
            }
        });
        
        DOM.on('reset-shortcuts-position', 'click', () => {
            if (window.shortcutsPanel && typeof window.shortcutsPanel.resetPosition === 'function') {
                window.shortcutsPanel.resetPosition();
                console.log('Shortcuts panel position reset to default');
            }
        });
        
        // New terminal button settings event handler
        DOM.on('new-terminal-btn-toggle', 'click', (e) => {
            const toggleElement = e.currentTarget;
            const checkbox = toggleElement.querySelector('input[type="checkbox"]');
            
            // Toggle the checkbox state
            checkbox.checked = !checkbox.checked;
            
            // Update visual state
            toggleElement.classList.toggle('active', checkbox.checked);
            
            // Save state and update button visibility
            Storage.set('new-terminal-btn-enabled', checkbox.checked);
            
            // Apply the setting immediately
            this.updateNewTerminalButtonVisibility(checkbox.checked);
        });
        
    }
    
    async loadSettingsValues() {
        // Load terminal settings from TTYd service
        try {
            const response = await HTTP.get('/api/ttyd/config');
            if (response.success) {
                const fontSizeInput = DOM.get('terminal-font-size');
                if (fontSizeInput) {
                    fontSizeInput.value = response.data.fontSize || 15;
                }
                
                // Update TTYd status
                this.updateTTYdStatus();
            }
        } catch (error) {
            console.warn('Failed to load TTYd configuration:', error);
            // Fallback to default value
            const fontSizeInput = DOM.get('terminal-font-size');
            if (fontSizeInput) {
                fontSizeInput.value = 15;
            }
        }
        
        // Load notification settings
        const notificationsEnabled = Storage.get('notifications-enabled', true);
        
        // Set notification toggle switch state
        const notificationToggle = DOM.get('notifications-toggle');
        const notificationCheckbox = DOM.get('notifications-enabled');
        if (notificationToggle && notificationCheckbox) {
            notificationCheckbox.checked = notificationsEnabled;
            notificationToggle.classList.toggle('active', notificationsEnabled);
        }
        
        // Load shortcuts panel settings
        // Default to false on mobile devices, true on desktop
        const isMobile = window.innerWidth <= 768;
        const shortcutsPanelDefaultValue = false;
        const shortcutsPanelEnabled = Storage.get('shortcuts-panel-enabled', shortcutsPanelDefaultValue);
        
        // Set shortcuts panel toggle switch state
        const shortcutsToggle = DOM.get('shortcuts-panel-toggle');
        const shortcutsCheckbox = DOM.get('shortcuts-panel-enabled');
        if (shortcutsToggle && shortcutsCheckbox) {
            shortcutsCheckbox.checked = shortcutsPanelEnabled;
            shortcutsToggle.classList.toggle('active', shortcutsPanelEnabled);
        }
        
        // Load new terminal button settings - default to false (button hidden)
        const newTerminalBtnEnabled = Storage.get('new-terminal-btn-enabled', false);
        
        // Set new terminal button toggle switch state
        const newTerminalBtnToggle = DOM.get('new-terminal-btn-toggle');
        const newTerminalBtnCheckbox = DOM.get('new-terminal-btn-enabled');
        if (newTerminalBtnToggle && newTerminalBtnCheckbox) {
            newTerminalBtnCheckbox.checked = newTerminalBtnEnabled;
            newTerminalBtnToggle.classList.toggle('active', newTerminalBtnEnabled);
        }
        
        // Apply the initial button visibility
        this.updateNewTerminalButtonVisibility(newTerminalBtnEnabled);
        
        // Initialize theme selector with current theme from backend
        try {
            const themeResponse = await HTTP.get('/api/theme');
            const currentTheme = themeResponse.success ? themeResponse.theme : 'light';
            const themeSelector = DOM.get('theme-selector');
            if (themeSelector) {
                themeSelector.value = currentTheme;
            }
        } catch (error) {
            console.warn('Failed to load theme for settings:', error.message);
            // Fallback to light theme for selector
            const themeSelector = DOM.get('theme-selector');
            if (themeSelector) {
                themeSelector.value = 'light';
            }
        }
    }
    
    switchSettingsTab(tabName) {
        // Update tab buttons
        DOM.queryAll('.settings-tab').forEach(tab => {
            DOM.removeClass(tab, 'active');
        });
        DOM.addClass(DOM.query(`[data-tab="${tabName}"]`), 'active');
        
        // Update panels
        DOM.queryAll('.settings-panel').forEach(panel => {
            DOM.removeClass(panel, 'active');
        });
        DOM.addClass(DOM.query(`[data-panel="${tabName}"]`), 'active');
    }
    
    
    
    
    showDebugInfo() {
        const debugInfo = {
            socket: socket.getDebugInfo(),
            projects: projectManager.getAllProjects().length,
            terminals: terminalManager.getAllTerminals().length,
            currentProject: projectManager.getCurrentProject()?.id,
            systemStats: this.systemStats
        };
        
        console.log('🔧 Debug Info:', debugInfo);
        console.log('Debug information logged to console');
    }
    
    
    handleEscapeKey() {
        // Close mobile menu
        if (this.isMobileMenuOpen()) {
            this.closeMobileMenu();
            return;
        }
        
        // Close modals
        if (modals.isOpen()) {
            modals.close();
            return;
        }
        
        // Close context menus
        const contextMenu = DOM.get('context-menu');
        if (contextMenu && DOM.hasClass(contextMenu, 'active')) {
            DOM.removeClass(contextMenu, 'active');
            return;
        }
        
    }
    
    toggleMobileMenu() {
        const sidebar = DOM.get('sidebar');
        const backdrop = DOM.get('mobile-backdrop');
        
        if (sidebar && backdrop) {
            if (DOM.hasClass(sidebar, 'open')) {
                this.closeMobileMenu();
            } else {
                DOM.addClass(sidebar, 'open');
                DOM.addClass(backdrop, 'active');
                document.body.style.overflow = 'hidden';
            }
        }
    }
    
    closeMobileMenu() {
        const sidebar = DOM.get('sidebar');
        const backdrop = DOM.get('mobile-backdrop');
        
        if (sidebar && backdrop) {
            DOM.removeClass(sidebar, 'open');
            DOM.removeClass(backdrop, 'active');
            document.body.style.overflow = '';
        }
    }
    
    isMobileMenuOpen() {
        const sidebar = DOM.get('sidebar');
        return sidebar && DOM.hasClass(sidebar, 'open');
    }
    
    handleWindowResize() {
        // Close mobile menu on resize to larger screen
        if (window.innerWidth > 768 && this.isMobileMenuOpen()) {
            this.closeMobileMenu();
        }
        
        // TTYd iframe handles resizing automatically
        // No need to manually fit terminals in TTYd architecture
        const activeSession = terminalManager.getActiveSession();
        if (activeSession) {
            console.log('Active session:', activeSession.name);
        }
    }
    
    cleanup() {
        console.log('🧹 Cleaning up application...');
        
        // Cleanup shortcuts panel
        if (window.shortcutsPanel && typeof window.shortcutsPanel.destroy === 'function') {
            window.shortcutsPanel.destroy();
        }
        
        // Leave current project
        if (projectManager.getCurrentProject()) {
            socket.leaveProject();
        }
        
        // Disconnect socket
        socket.disconnect();
    }
    
    // Public API methods
    getSystemStats() {
        return this.systemStats;
    }
    
    isReady() {
        return this.isInitialized;
    }
    
    requestNotificationPermission() {
        // Only request permission if notifications are enabled and permission is not already determined
        const notificationsEnabled = Storage.get('notifications-enabled', false);
        
        if (!notificationsEnabled) {
            // Don't request permission if notifications are disabled
            return;
        }
        
        if ('Notification' in window && Notification.permission === 'default') {
            // Add a click handler to request permission on first user interaction
            const requestPermissionOnInteraction = () => {
                // Double-check notifications are still enabled
                const currentlyEnabled = Storage.get('notifications-enabled', false);
                if (currentlyEnabled && socket && socket.requestNotificationPermission) {
                    socket.requestNotificationPermission();
                }
                // Remove the listener after first interaction
                document.removeEventListener('click', requestPermissionOnInteraction, true);
            };
            
            // Add listener to capture any click on the page
            document.addEventListener('click', requestPermissionOnInteraction, true);
            
            // Also try after a short delay as fallback
            setTimeout(() => {
                const currentlyEnabled = Storage.get('notifications-enabled', false);
                if (currentlyEnabled && 'Notification' in window && Notification.permission === 'default') {
                    requestPermissionOnInteraction();
                }
            }, 3000);
        }
    }
    
    setupNotificationStatusHandler() {
        const notificationStatus = document.getElementById('notification-status');
        if (notificationStatus) {
            notificationStatus.addEventListener('click', () => {
                if ('Notification' in window) {
                    if (Notification.permission === 'default') {
                        // Request permission
                        if (socket && socket.requestNotificationPermission) {
                            socket.requestNotificationPermission();
                        }
                    } else if (Notification.permission === 'denied') {
                        // Show instructions to enable in browser settings
                        console.warn('Notification permission denied. Please click the lock icon in the browser address bar and enable notifications.');
                    } else if (Notification.permission === 'granted') {
                        // Show test notification
                        if (socket && socket.showBrowserNotification) {
                            socket.showBrowserNotification('Vibe Code Distiller', 'Notifications working properly!', 'Test');
                        }
                    }
                } else {
                    console.error('Your browser does not support notifications');
                }
            });
        }
    }
    
    async updateTTYdStatus() {
        const statusElement = DOM.get('ttyd-status');
        if (!statusElement) return;
        
        try {
            const response = await HTTP.get('/api/ttyd/status');
            if (response.success) {
                const status = response.data;
                if (status.isRunning) {
                    statusElement.textContent = `Running (PID: ${status.pid}, Port: ${status.port})`;
                    statusElement.style.color = '#4CAF50';
                } else {
                    statusElement.textContent = 'Not Running';
                    statusElement.style.color = '#f44336';
                }
            } else {
                statusElement.textContent = 'Status Unknown';
                statusElement.style.color = '#ff9800';
            }
        } catch (error) {
            statusElement.textContent = 'Error checking status';
            statusElement.style.color = '#f44336';
        }
    }
    
    // Update new terminal button visibility based on setting
    updateNewTerminalButtonVisibility(enabled) {
        const newTerminalBtn = DOM.get('new-terminal-btn');
        if (newTerminalBtn) {
            if (enabled) {
                newTerminalBtn.style.display = '';
                console.log('New terminal button enabled - now visible');
            } else {
                newTerminalBtn.style.display = 'none';
                console.log('New terminal button disabled - now hidden');
            }
        }
    }
    
    // Show notification helper method
    showNotification(message, type = 'info') {
        if (window.notifications) {
            switch (type) {
                case 'success':
                    window.notifications.success(message);
                    break;
                case 'error':
                    window.notifications.error(message);
                    break;
                case 'info':
                case 'warn':
                default:
                    // Use success for info/warn as a fallback
                    window.notifications.success(message);
                    break;
            }
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for all scripts to load
    setTimeout(() => {
        try {
            // Check if required globals are available
            if (typeof socket === 'undefined') {
                throw new Error('Socket client not initialized');
            }
            if (typeof terminalManager === 'undefined') {
                throw new Error('Terminal manager not initialized');
            }
            if (typeof projectManager === 'undefined') {
                throw new Error('Project manager not initialized');
            }
            
            window.app = new ClaudeCodeWebManager();
            
            // Apply initial new terminal button visibility setting after app initialization
            setTimeout(() => {
                if (window.app && typeof window.app.updateNewTerminalButtonVisibility === 'function') {
                    const newTerminalBtnEnabled = Storage.get('new-terminal-btn-enabled', false);
                    window.app.updateNewTerminalButtonVisibility(newTerminalBtnEnabled);
                }
            }, 200);
            
            // Initialize image manager socket connection
            if (window.ImageManager && window.socket) {
                window.ImageManager.setSocket(window.socket);
            }
        } catch (error) {
            console.error('❌ Failed to initialize app:', error);
            
            // Show error in loading screen
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.innerHTML = `
                    <div class="loading-content">
                        <div class="error-icon">❌</div>
                        <h2>Failed to Initialize</h2>
                        <p>Vibe Code Distiller failed to start:</p>
                        <p class="error-message">${error.message}</p>
                        <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                    </div>
                `;
            }
        }
    }, 100);
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('📱 Page hidden');
    } else {
        console.log('📱 Page visible');
        // Refresh when page becomes visible again
        if (window.app && window.app.isReady()) {
            projectManager.refreshProjects();
        }
    }
});

// Global error handling
window.addEventListener('error', (event) => {
    console.error('❌ Global error:', event.error);
    console.error('An unexpected error occurred');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('❌ Unhandled promise rejection:', event.reason);
    console.error('An unexpected error occurred');
});

console.log('🚀 Vibe Code Distiller loading...');