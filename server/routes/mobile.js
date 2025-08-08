const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../utils/logger');

// Get current project root from working directory
let PROJECT_ROOT = process.cwd();

// File system API endpoints (scoped to project root)
router.get('/files', (req, res) => {
  const relativePath = req.query.path || '';
  const fullPath = path.join(PROJECT_ROOT, relativePath);
  
  // Security: Ensure path doesn't escape project root
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      const items = fs.readdirSync(fullPath).map(name => {
        const itemPath = path.join(fullPath, name);
        const itemStats = fs.statSync(itemPath);
        return {
          name,
          type: itemStats.isDirectory() ? 'directory' : 'file',
          path: path.relative(PROJECT_ROOT, itemPath)
        };
      });
      
      res.json({ type: 'directory', items });
    } else {
      const content = fs.readFileSync(fullPath, 'utf8');
      res.json({ type: 'file', content });
    }
  } catch (error) {
    logger.error('Error reading file/directory:', error);
    res.status(404).json({ error: 'Path not found' });
  }
});

// Read file endpoint
router.get('/file/:path(*)', (req, res) => {
  const relativePath = req.params.path;
  const fullPath = path.join(PROJECT_ROOT, relativePath);
  
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ content });
  } catch (error) {
    logger.error('Error reading file:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// Mobile-specific health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    projectRoot: PROJECT_ROOT,
    interface: 'mobile'
  });
});

// Project management endpoints
router.get('/projects', (req, res) => {
  const projectsDir = path.join(os.homedir(), 'projects');
  
  try {
    const items = fs.readdirSync(projectsDir, { withFileTypes: true });
    const projects = items
      .filter(item => item.isDirectory())
      .map(dir => ({
        name: dir.name,
        path: path.join(projectsDir, dir.name),
        isCurrent: path.join(projectsDir, dir.name) === PROJECT_ROOT
      }));
    
    res.json({ 
      projects,
      currentProject: PROJECT_ROOT
    });
  } catch (error) {
    logger.error('Error reading projects directory:', error);
    res.status(500).json({ error: 'Failed to read projects directory' });
  }
});

router.get('/projects/current', (req, res) => {
  res.json({ 
    projectRoot: PROJECT_ROOT,
    projectName: path.basename(PROJECT_ROOT)
  });
});

router.post('/projects/switch', (req, res) => {
  const { projectPath } = req.body;
  
  if (!projectPath) {
    return res.status(400).json({ error: 'Project path is required' });
  }
  
  // Validate the project path exists
  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: 'Project path does not exist' });
  }
  
  // Update the project root
  const oldRoot = PROJECT_ROOT;
  PROJECT_ROOT = projectPath;
  logger.info(`Mobile: Switching project from ${oldRoot} to ${PROJECT_ROOT}`);
  
  res.json({ 
    success: true,
    projectRoot: PROJECT_ROOT,
    projectName: path.basename(PROJECT_ROOT)
  });
});

router.post('/projects/create', (req, res) => {
  const { projectName } = req.body;
  
  if (!projectName) {
    return res.status(400).json({ error: 'Project name is required' });
  }
  
  // Sanitize project name
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9-_]/g, '-');
  const projectsDir = path.join(os.homedir(), 'projects');
  const newProjectPath = path.join(projectsDir, sanitizedName);
  
  // Check if project already exists
  if (fs.existsSync(newProjectPath)) {
    return res.status(400).json({ error: 'Project already exists' });
  }
  
  try {
    // Create the project directory
    fs.mkdirSync(newProjectPath, { recursive: true });
    
    // Create a README file
    const readmeContent = `# ${projectName}\n\nCreated on ${new Date().toLocaleDateString()}\n`;
    fs.writeFileSync(path.join(newProjectPath, 'README.md'), readmeContent);
    
    res.json({ 
      success: true,
      projectName: sanitizedName,
      projectPath: newProjectPath
    });
  } catch (error) {
    logger.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

module.exports = router;