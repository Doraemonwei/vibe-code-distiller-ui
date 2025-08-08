#!/usr/bin/env node

require('dotenv').config();

// Disable Node config strict mode
process.env.NODE_CONFIG_STRICT_MODE = 'false';
delete process.env.NODE_APP_INSTANCE;

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const config = require('config');

// Import utilities and middleware
const logger = require('./utils/logger');
const { SERVER } = require('./utils/constants');
const { 
  errorHandler, 
  notFoundHandler, 
  setupProcessErrorHandlers 
} = require('./middleware/error-handler');
const { 
  corsWithLogging, 
  securityHeaders, 
  preflightRateLimit 
} = require('./middleware/cors');

// Import routes
const apiRoutes = require('./routes/api');
const projectRoutes = require('./routes/projects');
const systemRoutes = require('./routes/system');
const claudeRoutes = require('./routes/claude');
const imageRoutes = require('./routes/images');
const ttydRoutes = require('./routes/ttyd');
const filesystemRoutes = require('./routes/filesystem');
const gitRoutes = require('./routes/git');

// Import services
const proxyService = require('./services/proxy-service');
const systemSetupService = require('./services/system-setup');
const websocketManager = require('./services/websocket-manager');

// Import device detection middleware  
const deviceDetection = require('./middleware/device-detection');

// Import socket handler (if it exists)
let socketHandler;
try {
  socketHandler = require('./socket-handler');
} catch (e) {
  // socket-handler might not exist in current version
  socketHandler = null;
}
const ttydService = require('./services/ttyd-service');

// Setup process error handlers
setupProcessErrorHandlers();

// Create Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.IO
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1024 * 1024, // 1MB
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  upgradeTimeout: 30000,
  allowUpgrades: true
});

// Store io instance for access in routes
app.set('io', io);

// Initialize theme state management (in-memory storage)
app.set('app-theme', 'light');

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Basic security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Compression middleware
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Request logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// CORS and security headers
app.use(preflightRateLimit);
app.use(corsWithLogging);
app.use(securityHeaders);

// Device detection middleware
app.use(deviceDetection);

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      const error = new Error('Invalid JSON');
      error.status = 400;
      throw error;
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Cookie parsing
app.use(cookieParser());

// Session management for mobile project persistence
app.use(session({
  secret: process.env.SESSION_SECRET || 'claude-code-mobile-session',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Static files
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));

// Mobile static files with proper MIME types
app.use('/mobile', express.static(path.join(__dirname, '../public/mobile'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    }
  }
}));

// Monaco Editor static files
app.use('/node_modules', express.static(path.join(__dirname, '../node_modules')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// Setup proxy routes using ProxyService
app.use('/terminal', proxyService.getTTYdProxy());
app.use('/vscode', proxyService.getCodeServerProxy());

// API routes
app.use('/api', apiRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/ttyd', ttydRoutes);
app.use('/api/filesystem', filesystemRoutes);
app.use('/api/git', gitRoutes);

// Mobile project routes (mobile-only, desktop unaffected)
app.get('/mobile/project/:projectName', (req, res) => {
  const projectName = req.params.projectName;
  logger.info(`Serving mobile interface for project: ${projectName}`);
  
  // Store project context for this request
  req.mobileProjectName = projectName;
  
  res.sendFile(path.join(__dirname, '../public/mobile/index.html'));
});

// Mobile project redirect helper
function getMobileProjectPath(req) {
  // Try to get project from session or default to current working directory
  const sessionProject = req.session?.mobileCurrentProject;
  if (sessionProject && fs.existsSync(sessionProject)) {
    return path.basename(sessionProject);
  }
  
  // Fallback to current working directory name
  return path.basename(process.cwd());
}

// Serve main application with device detection
app.get('/', (req, res) => {
  if (req.deviceInfo && req.deviceInfo.isMobile) {
    // For mobile users, redirect to project-specific URL for better state management
    const projectName = getMobileProjectPath(req);
    const projectUrl = `/mobile/project/${projectName}`;
    
    logger.info(`Redirecting mobile user to project URL: ${projectUrl}`);
    res.redirect(projectUrl);
  } else {
    // Serve desktop interface (unchanged)
    logger.info(`Serving desktop interface to ${req.deviceInfo ? req.deviceInfo.browser : 'unknown'} on ${req.deviceInfo ? req.deviceInfo.os : 'unknown'}`);
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Serve other static files
app.use(express.static(path.join(__dirname, '../public'), {
  index: false,
  maxAge: '0'
}));

// Setup Socket.IO handlers
const websocketManagerInstance = websocketManager(io);

// Store websocket manager instance for access in routes
app.set('websocketManager', websocketManagerInstance);

// Setup WebSocket upgrade handling
proxyService.setupWebSocketUpgrade(server, io);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Get port from environment, config, or default
const port = process.env.PORT || config.get('server.port') || SERVER.DEFAULT_PORT;
const host = process.env.HOST || config.get('server.host') || SERVER.DEFAULT_HOST;

// Start server
const startServer = async () => {
  try {
    // Initialize system setup (Git check, aliases, tmux config)
    logger.info('Initializing system setup...');
    await systemSetupService.initialize();
    
    // Start TTYd service
    logger.info('Starting TTYd service...');
    try {
      await ttydService.start();
      logger.info('TTYd service started successfully');
    } catch (ttydError) {
      logger.error('Failed to start TTYd service:', ttydError);
      logger.error('Application will not start without TTYd service');
      process.exit(1);
    }
    
    // Start HTTP server
    server.listen(port, host, () => {
      logger.system('Server started', {
        port,
        host,
        environment: 'development',
        pid: process.pid,
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      });

      console.log(`
╔════════════════════════════════════════════════════════════════╗
║                 🔧 Claude Code Web Manager                     ║
║                                                                ║
║  Server running at: http://${host}:${port}                           ║
║  Environment: development       ║
║  PID: ${process.pid.toString().padEnd(25)}                          ║
║  Memory: ${(Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB').padEnd(20)} ║
║                                                                ║
║  Ready to manage your Claude Code projects! 🚀                 ║
╚════════════════════════════════════════════════════════════════╝
      `);
    });

    // Handle server errors
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use`);
        process.exit(1);
      } else {
        logger.error('Server error:', err);
        process.exit(1);
      }
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.system('Shutdown initiated', { signal });
      
      try {
        logger.info('Stopping TTYd service...');
        await ttydService.stop();
        logger.info('TTYd service stopped');
      } catch (ttydError) {
        logger.error('Error stopping TTYd service:', ttydError);
      }
      
      server.close(() => {
        logger.system('HTTP server closed');
        
        io.close(() => {
          logger.system('Socket.IO server closed');
          process.exit(0);
        });
      });
      
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, SERVER.SHUTDOWN_TIMEOUT);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = { app, server, io };