// ===== PROJECT MANAGER =====

class ProjectManager extends EventEmitter {
    constructor() {
        super();
        this.projects = new Map();
        this.currentProject = null;
        this.projectListElement = DOM.get('project-list');
        this.searchInput = DOM.get('project-search');
        
        this.setupEventHandlers();
        this.loadProjects();
    }
    
    setupEventHandlers() {
        // New project button
        DOM.on('new-project-btn', 'click', () => {
            this.showCreateProjectModal();
        });
        
        // Welcome screen buttons
        DOM.on('welcome-new-project', 'click', () => {
            this.showCreateProjectModal();
        });
        
        DOM.on('welcome-import-project', 'click', () => {
            this.showImportProjectModal();
        });
        
        // Project search
        if (this.searchInput) {
            DOM.on(this.searchInput, 'input', Utils.debounce(() => {
                this.filterProjects(this.searchInput.value);
            }, 300));
        }
        
        // Project form submission
        DOM.on('project-form', 'submit', (e) => {
            e.preventDefault();
            this.handleProjectFormSubmit(e.target);
        });
        
        // Modal close buttons - add specific handler for project modal
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-close') || e.target.closest('.modal-close')) {
                const modal = e.target.closest('.modal');
                if (modal && modal.id === 'project-modal') {
                    this.closeProjectModal();
                }
            }
        });
        
        // Socket events
        socket.onProjectStatus(this.handleProjectStatus.bind(this));
        socket.onConnected(() => {
            this.loadProjects();
        });
        
        // Terminal session events
        socket.socket.on('terminal_session_created', (data) => {
            this.handleTerminalSessionCreated(data);
        });
        
        // Remove duplicate listener - let TerminalManager handle terminal:session-created
        
        socket.socket.on('project_ready', (data) => {
            this.handleProjectReady(data);
        });
        
        socket.socket.on('project_disconnected', (data) => {
            this.handleProjectDisconnected(data);
        });
    }
    
    async loadProjects() {
        try {
            const response = await HTTP.get('/api/projects');
            
            if (response.success) {
                this.projects.clear();
                response.projects.forEach(project => {
                    this.projects.set(project.id, project);
                });
                
                this.renderProjectList();
                this.emit('projects_loaded', response.projects);
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
            console.error('Failed to load projects: ' + error.message);
        }
    }
    
    renderProjectList() {
        if (!this.projectListElement) return;
        
        // Clear existing projects
        this.projectListElement.innerHTML = '';
        
        if (this.projects.size === 0) {
            const placeholder = DOM.create('div', {
                className: 'loading-placeholder',
                html: '<span>No projects found. Create your first project!</span>'
            });
            this.projectListElement.appendChild(placeholder);
            return;
        }
        
        // Sort projects by last modified
        const sortedProjects = Array.from(this.projects.values())
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        
        sortedProjects.forEach(project => {
            const projectElement = this.createProjectElement(project);
            this.projectListElement.appendChild(projectElement);
        });
    }
    
    createProjectElement(project) {
        const projectItem = DOM.create('div', {
            className: 'project-item',
            attributes: { 'data-project-id': project.id }
        });
        
        const projectContent = DOM.create('div', {
            className: 'project-content'
        });
        
        const projectName = DOM.create('div', {
            className: 'project-name',
            text: project.name
        });
        
        const projectMeta = DOM.create('div', {
            className: 'project-meta'
        });
        
        const projectDate = DOM.create('span', {
            className: 'project-date',
            text: Utils.formatDate(project.updatedAt)
        });
        
        projectMeta.appendChild(projectDate);
        
        projectContent.appendChild(projectName);
        projectContent.appendChild(projectMeta);
        
        // Options button
        const optionsButton = DOM.create('button', {
            className: 'project-options-btn btn-icon small',
            html: '<img src="assets/icons/more-vertical.svg" alt="Options" class="icon" style="width: 14px; height: 14px;">',
            attributes: { 'title': 'Project options' }
        });
        
        // Options dropdown
        const optionsDropdown = DOM.create('div', {
            className: 'project-options-dropdown',
            html: `
                <div class="dropdown-item" data-action="delete">
                    <span class="text">Delete Project</span>
                </div>
                <div class="dropdown-item" data-action="download">
                    <span class="text">Download Project</span>
                </div>
            `
        });
        
        // Stop event propagation to prevent project selection when clicking options
        DOM.on(optionsButton, 'click', (e) => {
            e.stopPropagation();
            this.toggleProjectOptions(e, project, optionsDropdown);
        });
        
        // Handle dropdown clicks
        DOM.on(optionsDropdown, 'click', (e) => {
            e.stopPropagation();
            const action = e.target.closest('.dropdown-item')?.dataset.action;
            if (action === 'delete') {
                this.deleteProject(project.id);
            } else if (action === 'download') {
                this.downloadProject(project.id);
            }
            // Hide dropdown after action using dropdown manager
            const dropdownId = `project-options-${project.id}`;
            if (window.dropdownManager) {
                window.dropdownManager.hide(dropdownId);
            } else {
                // Fallback
                optionsDropdown.style.display = 'none';
            }
        });
        
        // Create VSCode button
        const createVSCodeButton = DOM.create('button', {
            className: 'project-create-vscode-btn btn-icon small',
            html: '<img src="assets/icons/code.svg" alt="Open in VSCode" class="icon" style="width: 14px; height: 14px;">',
            attributes: { 'title': 'Open in VSCode' }
        });
        
        // Handle VSCode button click
        DOM.on(createVSCodeButton, 'click', (e) => {
            e.stopPropagation();
            this.openInVSCode(project);
        });
        
        // Create New Terminal button
        const createTerminalButton = DOM.create('button', {
            className: 'project-create-terminal-btn btn-icon small',
            html: '<img src="assets/icons/plus.svg" alt="Create Terminal" class="icon" style="width: 14px; height: 14px;">',
            attributes: { 'title': 'Create New Terminal' }
        });
        
        // Handle create terminal button click
        DOM.on(createTerminalButton, 'click', (e) => {
            e.stopPropagation();
            this.createNewTerminal(project.id);
        });
        
        // Options container
        const optionsContainer = DOM.create('div', {
            className: 'project-options-container'
        });
        optionsContainer.appendChild(createVSCodeButton);
        optionsContainer.appendChild(createTerminalButton);
        optionsContainer.appendChild(optionsButton);
        optionsContainer.appendChild(optionsDropdown);
        
        projectItem.appendChild(projectContent);
        projectItem.appendChild(optionsContainer);
        
        // Click handler for project content
        DOM.on(projectContent, 'click', () => {
            this.selectProject(project.id);
        });
        
        // Context menu
        DOM.on(projectItem, 'contextmenu', (e) => {
            e.preventDefault();
            this.showProjectContextMenu(e, project);
        });
        
        return projectItem;
    }
    
    filterProjects(searchTerm) {
        const projectItems = this.projectListElement.querySelectorAll('.project-item');
        
        projectItems.forEach(item => {
            const projectName = item.querySelector('.project-name').textContent.toLowerCase();
            const matches = projectName.includes(searchTerm.toLowerCase());
            
            item.style.display = matches ? '' : 'none';
        });
    }
    
    async selectProject(projectId) {
        try {
            // Deselect current project
            if (this.currentProject) {
                const currentElement = this.projectListElement.querySelector(`[data-project-id="${this.currentProject}"]`);
                if (currentElement) {
                    DOM.removeClass(currentElement, 'active');
                }
                
                // Leave current project socket room
                socket.leaveProject(this.currentProject);
            }
            
            // Select new project
            this.currentProject = projectId;
            const projectElement = this.projectListElement.querySelector(`[data-project-id="${projectId}"]`);
            if (projectElement) {
                DOM.addClass(projectElement, 'active');
            }
            
            // Join project socket room
            socket.joinProject(projectId);
            
            // Load project details
            const project = await this.getProjectDetails(projectId);
            
            // Update UI
            this.updateBreadcrumb(project);
            this.updateInfoPanel(project);
            
            // NOTE: Terminal management is now independent of project selection
            // Users control terminals via the terminal tab bar
            // Projects only affect the file management system
            
            this.emit('project_selected', project);
            
            // Auto-select corresponding terminal tab if exists (only if not triggered by terminal)
            if (!this._skipTerminalAutoSelect) {
                this.autoSelectTerminalTab(project);
            }
            
            // Notify file tree manager about project change
            if (window.fileTreeManager) {
                document.dispatchEvent(new CustomEvent('projectChanged', {
                    detail: { projectId: projectId, project: project }
                }));
            }
            
            // Close mobile menu after selecting project
            if (window.app && window.app.isMobileMenuOpen()) {
                window.app.closeMobileMenu();
            }
            
        } catch (error) {
            console.error('Failed to select project:', error);
            console.error('Failed to select project: ' + error.message);
        }
    }
    
    async getProjectDetails(projectId) {
        try {
            const response = await HTTP.get(`/api/projects/${projectId}`);
            if (response.success) {
                // Update cached project
                this.projects.set(projectId, response.project);
                return response.project;
            }
        } catch (error) {
            console.error('Failed to get project details:', error);
            throw error;
        }
    }
    
    updateBreadcrumb(project) {
        const breadcrumb = DOM.get('breadcrumb');
        if (breadcrumb) {
            breadcrumb.innerHTML = `
                <span class="breadcrumb-item">Dashboard</span>
                <span class="breadcrumb-separator"><img src="/assets/icons/arrow-right.svg" alt="separator" style="width: 16px; height: 16px;"></span>
                <span class="breadcrumb-item active">${project.name}</span>
            `;
        }
    }
    
    updateInfoPanel(project) {
        const infoPanelTitle = DOM.get('info-panel-title');
        const infoPanelContent = DOM.get('info-panel-content');
        
        if (infoPanelTitle) {
            infoPanelTitle.textContent = project.name;
        }
        
        if (infoPanelContent) {
            infoPanelContent.innerHTML = `
                <div class="project-details">
                    <div class="detail-group">
                        <h4>Project Information</h4>
                        <div class="detail-item">
                            <span class="label">Name:</span>
                            <span class="value">${project.name}</span>
                        </div>
                        ${project.framework ? `
                        <div class="detail-item">
                            <span class="label">Framework:</span>
                            <span class="value">${project.framework}</span>
                        </div>
                        ` : ''}
                        <div class="detail-item">
                            <span class="label">Created:</span>
                            <span class="value">${Utils.formatDate(project.createdAt)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Modified:</span>
                            <span class="value">${Utils.formatDate(project.updatedAt)}</span>
                        </div>
                    </div>
                    
                    <div class="detail-group">
                        <h4>Statistics</h4>
                        <div class="detail-item">
                            <span class="label">Size:</span>
                            <span class="value">${Utils.formatBytes(project.size || 0)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Files:</span>
                            <span class="value">${project.fileCount || 0}</span>
                        </div>
                    </div>
                    
                    <div class="detail-group">
                        <h4>Actions</h4>
                        <div class="project-actions">
                            <button class="btn btn-primary btn-small" onclick="projectManager.startClaude('${project.id}')">
                                Start Claude
                            </button>
                            <button class="btn btn-secondary btn-small" onclick="projectManager.openInTerminal('${project.id}')">
                                Open Terminal
                            </button>
                            <button class="btn btn-secondary btn-small" onclick="projectManager.showProjectSettings('${project.id}')">
                                Settings
                            </button>
                        </div>
                    </div>
                    
                    ${project.claudeConfig.exists ? `
                    <div class="detail-group">
                        <h4>Claude Configuration</h4>
                        <div class="detail-item">
                            <span class="label">Config Files:</span>
                            <span class="value">${project.claudeConfig.files.length}</span>
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;
        }
    }
    
    showCreateProjectModal() {
        const modal = DOM.get('project-modal');
        const form = DOM.get('project-form');
        const title = DOM.get('project-modal-title');
        
        if (!modal) {
            console.error('❌ project-modal element not found in DOM');
            return;
        }
        
        if (title) title.textContent = 'Create New Project';
        if (form) form.reset();
        
        // Show modal with inline styles to ensure it appears above welcome screen
        modal.style.display = 'flex';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.opacity = '0';
        modal.style.visibility = 'hidden';
        
        // Force browser to recognize the changes
        modal.offsetHeight; // Force reflow
        
        setTimeout(() => {
            modal.classList.add('active');
            modal.style.opacity = '1';
            modal.style.visibility = 'visible';
            
            // Focus first input
            const firstInput = modal.querySelector('input, textarea, select');
            if (firstInput) {
                firstInput.focus();
            }
        }, 10);
        
        // Add backdrop click handler
        const handleBackdropClick = (e) => {
            if (e.target === modal) {
                this.closeProjectModal();
                modal.removeEventListener('click', handleBackdropClick);
            }
        };
        modal.addEventListener('click', handleBackdropClick);
    }
    
    closeProjectModal() {
        const modal = DOM.get('project-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.opacity = '0';
            modal.style.visibility = 'hidden';
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
        }
    }
    
    showImportProjectModal() {
        console.log('Import project functionality coming soon!');
    }
    
    async handleProjectFormSubmit(form) {
        try {
            // Prevent multiple submissions
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Creating...';
            }
            
            const formData = new FormData(form);
            const projectData = {
                name: formData.get('name')
            };
            
            const response = await HTTP.post('/api/projects', projectData);
            
            if (response.success) {
                console.log('Project created successfully!');
                
                // Always use our custom close method since we're using direct DOM manipulation
                this.closeProjectModal();
                
                // Add to projects map
                this.projects.set(response.project.id, response.project);
                
                // Refresh project list
                this.renderProjectList();
                
                // Select the new project
                this.selectProject(response.project.id);
                
                // Automatically create terminal session for the new project
                this.createNewTerminal(response.project.id);
                
                this.emit('project_created', response.project);
            }
        } catch (error) {
            console.error('Failed to create project:', error);
            
            // Show user-friendly error messages
            if (error.message.includes('409') || error.message.includes('already exists')) {
                // Show user-friendly notification using global notification system
                if (window.notifications) {
                    window.notifications.error('Project name already exists. Please choose a different name.', {
                        title: 'Project Creation Failed',
                        duration: 5000
                    });
                }
            } else {
                if (window.notifications) {
                    window.notifications.error('Failed to create project: ' + error.message, {
                        title: 'Project Creation Failed',
                        duration: 5000
                    });
                }
            }
        } finally {
            // Always restore button state
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = 'Create Project';
            }
        }
    }
    
    showProjectContextMenu(event, project) {
        const contextMenu = DOM.get('context-menu');
        const contextMenuItems = DOM.get('context-menu-items');
        
        if (!contextMenu || !contextMenuItems) return;
        
        contextMenuItems.innerHTML = `
            <button class="context-menu-item" onclick="projectManager.selectProject('${project.id}')">
                <img src="assets/icons/folder.svg" alt="Open" class="icon" style="width: 14px; height: 14px;">
                <span>Open Project</span>
            </button>
            <button class="context-menu-item" onclick="projectManager.startClaude('${project.id}')">
                <img src="assets/icons/lightbulb.svg" alt="Claude" class="icon" style="width: 14px; height: 14px;">
                <span>Start Claude</span>
            </button>
            <button class="context-menu-item" onclick="projectManager.openInTerminal('${project.id}')">
                <img src="assets/icons/terminal.svg" alt="Terminal" class="icon" style="width: 14px; height: 14px;">
                <span>Open Terminal</span>
            </button>
            <div class="context-menu-separator"></div>
            <button class="context-menu-item" onclick="projectManager.showProjectSettings('${project.id}')">
                <img src="assets/icons/settings.svg" alt="Settings" class="icon" style="width: 14px; height: 14px;">
                <span>Project Settings</span>
            </button>
            <button class="context-menu-item" onclick="projectManager.duplicateProject('${project.id}')">
                <img src="assets/icons/document.svg" alt="Duplicate" class="icon" style="width: 14px; height: 14px;">
                <span>Duplicate</span>
            </button>
            <div class="context-menu-separator"></div>
            <button class="context-menu-item" onclick="projectManager.deleteProject('${project.id}')">
                <img src="assets/icons/trash.svg" alt="Delete" class="icon" style="width: 14px; height: 14px;">
                <span>Delete Project</span>
            </button>
        `;
        
        // Position context menu
        contextMenu.style.left = event.pageX + 'px';
        contextMenu.style.top = event.pageY + 'px';
        
        // Show context menu
        DOM.addClass(contextMenu, 'active');
        
        // Hide context menu on click outside
        const hideContextMenu = (e) => {
            if (!contextMenu.contains(e.target)) {
                DOM.removeClass(contextMenu, 'active');
                document.removeEventListener('click', hideContextMenu);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', hideContextMenu);
        }, 0);
    }
    
    async startClaude(projectId) {
        try {
            if (!socket.isConnected()) {
                console.error('Not connected to server');
                return;
            }
            
            console.log('Starting Claude session...');
            socket.startClaude(projectId);
            
        } catch (error) {
            console.error('Failed to start Claude:', error);
            console.error('Failed to start Claude: ' + error.message);
        }
    }
    
    async openInTerminal(projectId) {
        try {
            // Use the "Create New Terminal" button in the project menu instead
            this.createNewTerminal(projectId);
            
        } catch (error) {
            console.error('Failed to open terminal:', error);
            console.error('Failed to open terminal: ' + error.message);
        }
    }
    
    openInVSCode(project) {
        try {
            if (!project || !project.path) {
                console.error('Project path not available');
                return;
            }
            
            // Get current URL without query parameters or hash
            const baseUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
            
            // Remove any trailing slash and add VSCode path with folder parameter
            const cleanBaseUrl = baseUrl.replace(/\/$/, '');
            const vscodeUrl = `${cleanBaseUrl}/vscode/?folder=${encodeURIComponent(project.path)}`;
            
            // Open in new tab
            window.open(vscodeUrl, '_blank');
            
            console.log(`Opening project "${project.name}" in VSCode: ${vscodeUrl}`);
            
        } catch (error) {
            console.error('Failed to open VSCode:', error);
            console.error('Failed to open VSCode: ' + error.message);
        }
    }
    
    showProjectSettings(projectId) {
        console.log('Project settings coming soon!');
    }
    
    async duplicateProject(projectId) {
        try {
            const project = this.projects.get(projectId);
            if (!project) return;
            
            const newName = prompt('Enter name for duplicated project:', project.name + ' Copy');
            if (!newName) return;
            
            const projectData = {
                name: newName,
                description: project.description,
                framework: project.framework
            };
            
            const response = await HTTP.post('/api/projects', projectData);
            
            if (response.success) {
                console.log('Project duplicated successfully!');
                this.projects.set(response.project.id, response.project);
                this.renderProjectList();
            }
            
        } catch (error) {
            console.error('Failed to duplicate project:', error);
            console.error('Failed to duplicate project: ' + error.message);
        }
    }
    
    async deleteProject(projectId) {
        try {
            const project = this.projects.get(projectId);
            if (!project) return;
            
            const confirmed = confirm(`Are you sure you want to delete "${project.name}"? This action cannot be undone.`);
            if (!confirmed) return;
            
            await HTTP.delete(`/api/projects/${projectId}`);
            
            // Remove from projects map
            this.projects.delete(projectId);
            
            // NOTE: Terminals are now independent of projects
            // Users can manually close terminal sessions if needed
            
            // If this was the current project, clear selection
            if (this.currentProject === projectId) {
                this.currentProject = null;
                socket.leaveProject(projectId);
            }
            
            // Refresh project list
            this.renderProjectList();
            
            console.log('Project deleted successfully');
            this.emit('project_deleted', projectId);
            
        } catch (error) {
            console.error('Failed to delete project:', error);
            console.error('Failed to delete project: ' + error.message);
        }
    }
    
    toggleProjectOptions(event, project, dropdown) {
        // Generate unique dropdown ID for this project
        const dropdownId = `project-options-${project.id}`;
        const triggerButton = event.target.closest('.project-options-btn');
        
        // Register dropdown with dropdown manager
        if (window.dropdownManager) {
            window.dropdownManager.register(dropdownId, dropdown, triggerButton);
        }
        
        // Position dropdown relative to button
        const rect = event.target.getBoundingClientRect();
        dropdown.style.position = 'absolute';
        dropdown.style.top = '100%';
        dropdown.style.right = '0';
        dropdown.style.zIndex = '1000';
        
        // Toggle dropdown using dropdown manager
        if (window.dropdownManager) {
            if (window.dropdownManager.isVisible(dropdownId)) {
                window.dropdownManager.hide(dropdownId);
            } else {
                window.dropdownManager.show(dropdownId);
            }
        } else {
            // Fallback for when dropdown manager is not available
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
        }
    }
    
    async downloadProject(projectId) {
        try {
            const project = this.projects.get(projectId);
            if (!project) return;
            
            console.log(`Preparing download for "${project.name}"...`);
            
            // Create download request using native fetch for blob handling
            const response = await fetch(`/api/projects/${projectId}/download`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Get the blob data
            const blob = await response.blob();
            
            // Extract filename from Content-Disposition header or use project name
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `${project.name}.zip`;
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="([^"]+)"/);
                if (match) {
                    filename = match[1];
                }
            }
            
            // Create download link
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename;
            
            // Trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Clean up
            window.URL.revokeObjectURL(downloadUrl);
            
            console.log(`"${project.name}" downloaded successfully`);
            
        } catch (error) {
            console.error('Failed to download project:', error);
            console.error('Failed to download project: ' + error.message);
        }
    }
    
    async restartTerminal(projectId) {
        try {
            const project = this.projects.get(projectId);
            if (!project) return;
            
            const confirmed = confirm(`Restart terminal for "${project.name}"? This will close the current session and create a new one.`);
            if (!confirmed) return;
            
            console.log(`Restarting terminal for "${project.name}"...`);
            
            // Send restart terminal command to the socket
            socket.restartTerminal(projectId);
            
        } catch (error) {
            console.error('Failed to restart terminal:', error);
            console.error('Failed to restart terminal: ' + error.message);
        }
    }
    
    async createNewTerminal(projectId) {
        try {
            const project = this.projects.get(projectId);
            if (!project) {
                console.error('Project not found');
                return;
            }
            
            // Creating new terminal for project
            
            // Check socket connection with enhanced error handling
            if (!socket || !socket.isConnected()) {
                console.error('Connection lost. Please refresh the page.');
                console.error('❌ Cannot create terminal: Not connected to server');
                return;
            }
            
            // Show creating notification
            console.log(`Creating new terminal for "${project.name}"...`);
            
            // Get calculated terminal dimensions or use defaults
            let dimensions = { cols: 80, rows: 24 }; // fallback
            if (window.terminalManager && window.terminalManager.getActualTerminalDimensions) {
                dimensions = window.terminalManager.getActualTerminalDimensions(null);
            }
            
            // Send socket request to create new session for project with calculated dimensions
            socket.socket.emit('terminal:create-project-session', {
                projectName: project.name,
                projectPath: project.path,
                cols: dimensions.cols,
                rows: dimensions.rows
            });
            
            // Request sent to create project session
            
            // Set up timeout to check if session was created
            setTimeout(() => {
                // Check if any new sessions were created for this project
                if (window.terminalManager && window.terminalManager.terminals) {
                    const projectSessions = Array.from(window.terminalManager.terminals.keys())
                        .filter(sessionName => sessionName.includes(project.name));
                    
                    if (projectSessions.length === 0) {
                        console.warn('⚠️ No terminal sessions found after creation timeout for project:', project.name);
                        console.warn(`Terminal creation may have failed for "${project.name}". Please try again.`);
                    }
                }
            }, 8000); // 8 second timeout
            
        } catch (error) {
            console.error('❌ Failed to create new terminal:', error);
            console.error('Failed to create new terminal: ' + error.message);
        }
    }
    
    handleProjectStatus(data) {
        const { projectId, status } = data;
        
        switch (status) {
            case 'claude_started':
                console.log('Claude session started');
                break;
            case 'claude_stopped':
                console.log('Claude session stopped');
                break;
            case 'terminal_created':
                console.log('Terminal session created');
                break;
            case 'terminal_destroyed':
                console.log('Terminal session destroyed');
                break;
            case 'terminal_restarted':
                console.log('Terminal session restarted successfully');
                break;
        }
        
        this.emit('project_status_changed', data);
    }
    
    // Public API methods
    getCurrentProject() {
        return this.currentProject ? this.projects.get(this.currentProject) : null;
    }
    
    getProject(projectId) {
        return this.projects.get(projectId);
    }
    
    getAllProjects() {
        return Array.from(this.projects.values());
    }
    
    hasProjects() {
        return this.projects.size > 0;
    }
    
    async refreshProjects() {
        await this.loadProjects();
    }
    
    /**
     * Select project by name (for terminal-to-project linking)
     */
    selectProjectByName(projectName) {
        if (!projectName) {
            return false;
        }
        
        // Find project by name
        const project = Array.from(this.projects.values()).find(p => p.name === projectName);
        if (project) {
            console.log(`🎯 Auto-selecting project "${projectName}" from terminal`);
            
            // Set flag to prevent terminal auto-selection when triggered by terminal
            this._skipTerminalAutoSelect = true;
            this.selectProject(project.id);
            this._skipTerminalAutoSelect = false;
            
            return true;
        }
        
        return false;
    }
    
    // Terminal session event handlers
    handleTerminalSessionCreated(data) {
        const { projectId } = data;
        
        // NOTE: Terminal display is now managed by the terminal tab system
        // Project events no longer directly control terminal visibility
    }
    
    handleProjectSessionCreated(data) {
        const { sessionName, projectName, sequenceNumber } = data;
        
        console.log(`New terminal session created for "${projectName}": ${sessionName}`);
        
        // The terminal manager will handle the actual connection
        // This is just for project-level notifications
    }
    
    handleProjectReady(data) {
        const { projectId } = data;
        
        // Update project status in UI if needed
        const projectElement = DOM.get(`project-${projectId}`);
        if (projectElement) {
            DOM.removeClass(projectElement, 'connecting');
            DOM.addClass(projectElement, 'connected');
        }
    }
    
    handleProjectDisconnected(data) {
        const { projectId } = data;
        
        // Update project status in UI
        const projectElement = DOM.get(`project-${projectId}`);
        if (projectElement) {
            DOM.removeClass(projectElement, 'connected');
            DOM.addClass(projectElement, 'disconnected');
        }
        
        // Show notification if this is the current project
        if (this.currentProject === projectId) {
            console.warn(`Project ${projectId} disconnected`);
        }
    }
    
    /**
     * Auto-select terminal tab when project is selected
     */
    autoSelectTerminalTab(project) {
        if (!project || !window.terminalManager) {
            return;
        }
        
        // Get all sessions from terminal manager
        const sessions = window.terminalManager.getAllSessions();
        if (!sessions || sessions.length === 0) {
            return;
        }
        
        // Find sessions for this project (actual session name format: claude-web-{projectName}-{number})
        const projectSessions = [];
        sessions.forEach(session => {
            const projectName = this.extractProjectNameFromSessionName(session.name);
            if (projectName === project.name) {
                projectSessions.push(session);
            }
        });
        
        // Select the first terminal session for this project (from left to right)
        if (projectSessions.length > 0) {
            const firstSession = projectSessions[0];
            
            console.log(`🎯 Auto-selecting terminal for project "${project.name}":`, firstSession.name);
            
            // Use terminalManager to select the session
            if (window.terminalManager.selectSessionTab) {
                window.terminalManager.selectSessionTab(firstSession.name);
            }
        }
    }
    
    /**
     * Extract project name from session name (not display name)
     * Expected format: claude-web-{projectName}-{number}
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
    
    /**
     * Extract project name from terminal tab name (display name)
     * Expected format: {projectName}-{number} (after claude-web- prefix removed)
     */
    extractProjectNameFromTerminalName(terminalName) {
        if (!terminalName || typeof terminalName !== 'string') {
            return null;
        }
        
        // Skip temporary terminals (session-{timestamp})
        if (terminalName.startsWith('session-')) {
            return null;
        }
        
        // Parse display name: {projectName}-{number}
        const match = terminalName.match(/^(.+)-\d+$/);
        if (match) {
            return match[1];
        }
        
        return null;
    }
    
    /**
     * Validate terminal name format
     */
    isValidTerminalName(terminalName) {
        if (!terminalName || typeof terminalName !== 'string') {
            return false;
        }
        
        // Check naming rule: {projectName}-{number} or session-{timestamp}
        return /^.+-\d+$/.test(terminalName);
    }
}

// Initialize project manager
const projectManager = new ProjectManager();

// Make project manager globally available
window.projectManager = projectManager;

// Export for other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProjectManager };
}