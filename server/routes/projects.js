const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const { schemas, middleware } = require('../utils/validator');
const projectService = require('../services/project-service');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

// Simple in-memory state for current project (per session/user)
// In production, this would be stored in Redis or database
const currentProjectState = new Map(); // socketId -> projectPath

// Get all projects
router.get('/', asyncHandler(async (req, res) => {
  const socketId = req.headers['x-socket-id'];
  
  // If no socket ID, this is a desktop request - use original behavior
  if (!socketId) {
    const { limit, offset, type } = req.query;
    const projects = await projectService.getAllProjects({ limit, offset, type });
    
    return res.json({
      success: true,
      projects,
      total: projects.length,
      timestamp: new Date().toISOString()
    });
  }
  
  // Mobile request with socket ID - use session-aware behavior
  try {
    const os = require('os');
    const projectsDir = process.env.PROJECTS_DIR || path.join(os.homedir(), 'projects');
    const currentWorkingDir = process.cwd();
    
    // Get socket-specific current project or fall back to current working directory
    const sessionCurrentProject = currentProjectState.get(socketId);
    const currentProjectPath = sessionCurrentProject || currentWorkingDir;
    
    // Read projects directory directly (fast)
    let projects = [];
    if (fs.existsSync(projectsDir)) {
      const items = fs.readdirSync(projectsDir, { withFileTypes: true });
      projects = items
        .filter(item => item.isDirectory())
        .map(dir => ({
          name: dir.name,
          path: path.join(projectsDir, dir.name),
          isCurrent: path.join(projectsDir, dir.name) === currentProjectPath
        }));
    }
    
    // Also include current working directory if it's not in projects dir
    if (!projects.some(p => p.path === currentWorkingDir)) {
      projects.unshift({
        name: path.basename(currentWorkingDir),
        path: currentWorkingDir,
        isCurrent: currentProjectPath === currentWorkingDir
      });
    }
    
    const currentProject = projects.find(p => p.isCurrent);
    
    res.json({
      success: true,
      projects: projects,
      currentProject: currentProject ? currentProject.name : path.basename(currentProjectPath),
      total: projects.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error loading projects:', error);
    res.json({
      success: true,
      projects: [{
        name: path.basename(process.cwd()),
        path: process.cwd(),
        isCurrent: true
      }],
      currentProject: path.basename(process.cwd()),
      total: 1,
      error: 'Using current directory as fallback',
      timestamp: new Date().toISOString()
    });
  }
}));

// Create new project
router.post('/', 
  middleware(schemas.project.create),
  asyncHandler(async (req, res) => {
    const project = await projectService.createProject(req.validated);
    
    res.status(201).json({
      success: true,
      project,
      message: 'Project created successfully',
      timestamp: new Date().toISOString()
    });
  })
);

// Create new project (mobile-compatible endpoint)
router.post('/create',
  asyncHandler(async (req, res) => {
    const { projectName } = req.body;
    
    if (!projectName || typeof projectName !== 'string' || !projectName.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Project name is required',
        timestamp: new Date().toISOString()
      });
    }
    
    try {
      // Use the existing project service to create project
      const project = await projectService.createProject({ 
        name: projectName.trim(),
        description: `Project created from mobile interface`
      });
      
      res.status(201).json({
        success: true,
        projectName: project.name,
        projectPath: project.path,
        message: 'Project created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

// Switch to project (mobile-compatible endpoint)
router.post('/switch',
  asyncHandler(async (req, res) => {
    const { projectPath } = req.body;
    
    if (!projectPath || typeof projectPath !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Project path is required',
        timestamp: new Date().toISOString()
      });
    }
    
    try {
      const path = require('path');
      const fs = require('fs');
      
      // Verify project exists
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({
          success: false,
          error: 'Project path does not exist',
          timestamp: new Date().toISOString()
        });
      }
      
      // Get socket ID for session tracking
      const socketId = req.headers['x-socket-id'] || 'default';
      
      // Update current project state
      currentProjectState.set(socketId, projectPath);
      
      const projectName = path.basename(projectPath);
      
      // Notify websocket manager about project switch for mobile chat providers
      const io = req.app.get('io');
      const websocketManager = req.app.get('websocketManager');
      
      if (websocketManager && socketId !== 'default') {
        // Update mobile chat provider context directly
        websocketManager.updateMobileChatProviderProject(socketId, projectPath);
        
        // Emit to specific socket about the project switch
        const targetSocket = io.sockets.sockets.get(socketId);
        if (targetSocket) {
          targetSocket.emit('mobile:message', {
            type: 'projectSwitched',
            data: {
              projectPath: projectPath,
              projectName: projectName
            }
          });
        }
      }
      
      // Store mobile project in session for persistence
      if (req.session) {
        req.session.mobileCurrentProject = projectPath;
      }
      
      res.json({
        success: true,
        projectName: projectName,
        projectPath: projectPath,
        mobileProjectUrl: `/mobile/project/${projectName}`, // New field for mobile redirect
        message: 'Project switched successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

// Update notification settings for all projects (must be before /:id routes)
router.put('/notification-settings',
  asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    
    // Validate enabled parameter
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled parameter must be a boolean',
        timestamp: new Date().toISOString()
      });
    }
    
    const results = await projectService.updateAllProjectsNotificationSettings(enabled);
    
    res.json({
      success: true,
      message: `Notification settings ${enabled ? 'enabled' : 'disabled'} for all projects`,
      results,
      timestamp: new Date().toISOString()
    });
  })
);

// Get project by ID
router.get('/:id',
  middleware(schemas.project.id, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const project = await projectService.getProject(id);
    
    res.json({
      success: true,
      project,
      timestamp: new Date().toISOString()
    });
  })
);

// Update project
router.put('/:id',
  middleware(schemas.project.id, 'params'),
  middleware(schemas.project.update),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const project = await projectService.updateProject(id, req.validated);
    
    res.json({
      success: true,
      project,
      message: 'Project updated successfully',
      timestamp: new Date().toISOString()
    });
  })
);

// Delete project
router.delete('/:id',
  middleware(schemas.project.id, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await projectService.deleteProject(id);
    
    res.json({
      success: true,
      message: 'Project deleted successfully',
      timestamp: new Date().toISOString()
    });
  })
);

// Get project files
router.get('/:id/files',
  middleware(schemas.project.id, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { path = '' } = req.query;
    const files = await projectService.getProjectFiles(id, path);
    
    res.json({
      success: true,
      files,
      path,
      timestamp: new Date().toISOString()
    });
  })
);

// Get project statistics
router.get('/:id/stats',
  middleware(schemas.project.id, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const stats = await projectService.getProjectStats(id);
    
    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  })
);

// Download project as ZIP
router.get('/:id/download',
  middleware(schemas.project.id, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { filename } = await projectService.downloadProject(id, res);
    
    // Headers are already set by the service
    // The response stream is handled by the service
    // This endpoint just ensures proper error handling
  })
);

// Export both the router and the currentProjectState for access from other modules
module.exports = router;
module.exports.currentProjectState = currentProjectState;