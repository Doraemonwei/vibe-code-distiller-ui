const logger = require('../utils/logger');
const { WEBSOCKET } = require('../utils/constants');
const ConnectionManager = require('./websocket/connection-manager');
const ProjectHandler = require('./websocket/project-handler');
const TerminalHandler = require('./websocket/terminal-handler');
const ClaudeChatProvider = require('./claudeChat');

class SocketManager {
  constructor(io) {
    this.io = io;
    this.connectionManager = new ConnectionManager();
    this.projectHandler = new ProjectHandler(this.connectionManager);
    this.terminalHandler = new TerminalHandler();
    
    // Mobile chat providers (one per mobile connection)
    this.mobileChatProviders = new Map();
    
    this.setupNamespace();
  }

  setupNamespace() {
    this.io.use((socket, next) => {
      socket.metadata = {
        ip: socket.request.connection.remoteAddress,
        userAgent: socket.request.headers['user-agent'],
        connectedAt: Date.now(),
        projectId: null,
        currentProjectPath: null
      };
      
      next();
    });

    // Handle project switching events
    this.io.on('project:switched', (data) => {
      if (data.socketId && this.mobileChatProviders.has(data.socketId)) {
        // Update the chat provider's project context
        this.updateMobileChatProviderProject(data.socketId, data.projectPath);
      }
    });

    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    logger.system('Socket.IO manager initialized');
  }

  handleConnection(socket) {
    this.connectionManager.handleConnection(socket, this.io);
    this.setupSocketEvents(socket);

    socket.on('disconnect', (reason) => {
      this.connectionManager.handleDisconnect(socket, reason, this.io);
      
      // Cleanup mobile chat provider if exists
      this.cleanupMobileChatProvider(socket.id);
    });
  }

  setupSocketEvents(socket) {
    // Health check events
    socket.on('ping', () => {
      socket.emit('pong');
    });
    
    // Project management events - delegate to ConnectionManager
    socket.on(WEBSOCKET.EVENTS.JOIN_PROJECT, (data) => {
      this.connectionManager.handleJoinProject(socket, data, this.io);
    });

    socket.on(WEBSOCKET.EVENTS.LEAVE_PROJECT, (data) => {
      this.connectionManager.handleLeaveProject(socket, data, this.io);
    });

    // Terminal session events - delegate to TerminalHandler
    socket.on('terminal:create-project-session', (data) => {
      this.terminalHandler.handleCreateProjectSession(socket, data, this.io);
    });
    
    socket.on('terminal:delete-session', (data) => {
      this.terminalHandler.handleDeleteSession(socket, data, this.io);
    });
    
    socket.on('terminal:switch-session', (data) => {
      this.terminalHandler.handleSwitchSession(socket, data, this.io);
    });

    // Terminal scroll events - delegate to TerminalHandler
    socket.on(WEBSOCKET.EVENTS.TERMINAL_SCROLL, (data) => {
      this.terminalHandler.handleTerminalScroll(socket, data, this.io);
    });
    
    socket.on(WEBSOCKET.EVENTS.TERMINAL_GO_TO_BOTTOM, (data) => {
      this.terminalHandler.handleTerminalGoToBottom(socket, data, this.io);
    });

    // Claude Code events - delegate to ProjectHandler
    socket.on(WEBSOCKET.EVENTS.CLAUDE_COMMAND, (data) => {
      this.projectHandler.handleClaudeCommand(socket, data, this.io);
    });

    // Project action events - delegate to ProjectHandler
    socket.on(WEBSOCKET.EVENTS.PROJECT_ACTION, (data) => {
      this.projectHandler.handleProjectAction(socket, data, this.io);
    });

    // Mobile chat events
    socket.on('mobile:sendMessage', (data) => {
      this.handleMobileSendMessage(socket, data);
    });

    socket.on('mobile:newSession', () => {
      this.handleMobileNewSession(socket);
    });

    socket.on('mobile:stopRequest', () => {
      this.handleMobileStopRequest(socket);
    });

    socket.on('mobile:getConversationList', () => {
      this.handleMobileGetConversationList(socket);
    });

    socket.on('mobile:loadConversation', (data) => {
      this.handleMobileLoadConversation(socket, data);
    });

    socket.on('mobile:getWorkspaceFiles', (data) => {
      this.handleMobileGetWorkspaceFiles(socket, data);
    });

    socket.on('mobile:selectModel', (data) => {
      this.handleMobileSelectModel(socket, data);
    });

    socket.on('mobile:getSettings', () => {
      this.handleMobileGetSettings(socket);
    });

    socket.on('mobile:permissionResponse', (data) => {
      this.handleMobilePermissionResponse(socket, data);
    });

    // Error handling
    socket.on('error', (error) => {
      logger.error('Socket error:', {
        socketId: socket.id,
        error: error.message,
        stack: error.stack
      });
    });
  }

  // Delegate to ConnectionManager
  broadcastToProject(projectId, event, data) {
    this.connectionManager.broadcastToProject(projectId, event, data, this.io);
  }

  broadcastSystemStatus() {
    const stats = {
      timestamp: new Date().toISOString(),
      connectedClients: this.connectionManager.connections.size,
      activeProjects: this.connectionManager.projectRooms.size,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };

    this.io.emit(WEBSOCKET.EVENTS.SYSTEM_STATUS, stats);
  }

  getConnectionStats() {
    return this.connectionManager.getConnectionStats();
  }

  // Mobile event handlers
  handleMobileSendMessage(socket, data) {
    logger.info(`Mobile message from ${socket.id}: ${data.text}`);
    
    // Get or create Claude chat provider for this socket
    const chatProvider = this.getMobileChatProvider(socket.id);
    
    // Send message to Claude
    chatProvider.sendMessage(data.text, data.planMode || false, data.thinkingMode || false);
  }

  handleMobileNewSession(socket) {
    logger.info(`Mobile new session request from ${socket.id}`);
    
    const chatProvider = this.getMobileChatProvider(socket.id);
    chatProvider.newSession();
  }

  handleMobileStopRequest(socket) {
    logger.info(`Mobile stop request from ${socket.id}`);
    
    const chatProvider = this.getMobileChatProvider(socket.id);
    chatProvider.stopCurrentRequest();
  }

  handleMobileGetConversationList(socket) {
    logger.info(`Mobile conversation list request from ${socket.id}`);
    
    const chatProvider = this.getMobileChatProvider(socket.id);
    const conversations = chatProvider.getConversationList();
    
    socket.emit('mobile:message', {
      type: 'conversationList',
      data: conversations
    });
  }

  handleMobileLoadConversation(socket, data) {
    logger.info(`Mobile load conversation request from ${socket.id}: ${data.sessionId}`);
    
    const chatProvider = this.getMobileChatProvider(socket.id);
    const conversation = chatProvider.loadConversation(data.sessionId);
    
    logger.info(`Conversation loaded: ${conversation ? 'success' : 'failed'}`);
    if (conversation) {
      logger.info(`Conversation has ${conversation.messages?.length || 0} messages`);
      
      // Clear current messages before loading conversation
      socket.emit('mobile:message', {
        type: 'conversationLoading'
      });
      
      // Send all loaded messages to mobile UI
      if (conversation.messages && conversation.messages.length > 0) {
        conversation.messages.forEach((msg, index) => {
          // Transform messageType to type for mobile UI compatibility
          const mobileMsg = {
            ...msg,
            type: msg.messageType
          };
          logger.info(`Sending message ${index + 1}/${conversation.messages.length}: ${mobileMsg.type}`);
          socket.emit('mobile:message', mobileMsg);
        });
      }
      
      // Send updated session info
      socket.emit('mobile:message', {
        type: 'sessionInfo',
        data: chatProvider.getSessionInfo()
      });
      
      logger.info(`Mobile conversation load completed for ${data.sessionId}`);
    } else {
      logger.error(`Failed to load conversation ${data.sessionId}`);
    }
  }

  handleMobileGetWorkspaceFiles(socket, data) {
    logger.info(`Mobile workspace files request from ${socket.id}: ${data.searchTerm}`);
    
    const chatProvider = this.getMobileChatProvider(socket.id);
    chatProvider.getWorkspaceFiles(data.searchTerm || '');
  }

  handleMobileSelectModel(socket, data) {
    logger.info(`Mobile select model request from ${socket.id}: ${data.model}`);
    
    const chatProvider = this.getMobileChatProvider(socket.id);
    chatProvider.selectModel(data.model);
  }

  handleMobileGetSettings(socket) {
    logger.info(`Mobile get settings request from ${socket.id}`);
    
    const chatProvider = this.getMobileChatProvider(socket.id);
    chatProvider.getSettings();
  }

  handleMobilePermissionResponse(socket, data) {
    logger.info(`Mobile permission response from ${socket.id}: ${data.id} -> ${data.approved}`);
    
    const chatProvider = this.getMobileChatProvider(socket.id);
    chatProvider.handlePermissionResponse(data.id, data.approved, data.alwaysAllow || false);
  }

  // Helper methods for mobile chat providers
  getMobileChatProvider(socketId) {
    if (!this.mobileChatProviders.has(socketId)) {
      // Get project context from socket connection query or fallback
      const socket = this.io.sockets.sockets.get(socketId);
      let projectRoot = process.cwd(); // fallback
      
      if (socket) {
        // Try to get project from connection query (preferred method)
        const projectName = socket.handshake.query.project;
        console.log(`Socket ${socketId} connected with project query: "${projectName}"`);
        
        if (projectName && projectName !== 'Current Project') {
          const projectPath = this.getProjectPathFromName(projectName);
          if (projectPath) {
            projectRoot = projectPath;
            console.log(`Resolved project "${projectName}" to path: ${projectRoot}`);
            
            // Store in session for persistence
            if (socket.request && socket.request.session) {
              socket.request.session.mobileCurrentProject = projectRoot;
            }
            
            // Update server-side project state for API consistency
            this.updateProjectState(socketId, projectRoot);
          } else {
            console.warn(`Could not resolve project "${projectName}" to a valid path`);
          }
        } else if (socket.request && socket.request.session?.mobileCurrentProject) {
          // Fallback to session project if available
          projectRoot = socket.request.session.mobileCurrentProject;
          console.log(`Using session project: ${projectRoot}`);
        } else {
          console.log(`No project context found, using current working directory: ${projectRoot}`);
        }
      }
      
      const chatProvider = new ClaudeChatProvider(projectRoot);
      
      // Override _postMessage to send to this specific socket
      chatProvider._postMessage = (message) => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('mobile:message', message);
        }
      };
      
      this.mobileChatProviders.set(socketId, chatProvider);
      
      // Send initial settings
      setTimeout(() => {
        chatProvider.getSettings();
        // Load latest conversation if exists
        chatProvider.loadLatestConversation();
      }, 100);
    }
    
    return this.mobileChatProviders.get(socketId);
  }

  cleanupMobileChatProvider(socketId) {
    const chatProvider = this.mobileChatProviders.get(socketId);
    if (chatProvider) {
      chatProvider.cleanup();
      this.mobileChatProviders.delete(socketId);
      logger.info(`Mobile chat provider cleaned up for socket ${socketId}`);
    }
  }

  updateMobileChatProviderProject(socketId, projectPath) {
    const existingProvider = this.mobileChatProviders.get(socketId);
    if (existingProvider) {
      // Clean up the old provider
      existingProvider.cleanup();
    }
    
    // Create new provider with the new project path
    const chatProvider = new ClaudeChatProvider(projectPath);
    
    // Override _postMessage to send to this specific socket
    chatProvider._postMessage = (message) => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('mobile:message', message);
      }
    };
    
    this.mobileChatProviders.set(socketId, chatProvider);
    
    logger.info(`Mobile chat provider updated for socket ${socketId} to project ${projectPath}`);
    
    // Send project switched confirmation and load latest conversation
    setTimeout(() => {
      chatProvider.getSettings();
      chatProvider.loadLatestConversation();
      
      // Notify mobile client about successful switch
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('mobile:message', {
          type: 'projectSwitched',
          data: {
            projectName: require('path').basename(projectPath),
            projectPath: projectPath
          }
        });
      }
    }, 100);
  }

  // Update server-side project state for API consistency
  updateProjectState(socketId, projectPath) {
    try {
      // Access the currentProjectState from projects router
      const { currentProjectState } = require('../routes/projects');
      
      // Update the state directly
      currentProjectState.set(socketId, projectPath);
      
      console.log(`Updated project state for socket ${socketId} to ${projectPath}`);
    } catch (error) {
      console.error('Error updating project state:', error);
    }
  }

  // Helper to resolve project name to full path
  getProjectPathFromName(projectName) {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    
    // Check if it's the current working directory
    if (projectName === path.basename(process.cwd())) {
      return process.cwd();
    }
    
    // Check in projects directory
    const projectsDir = process.env.PROJECTS_DIR || path.join(os.homedir(), 'projects');
    const projectPath = path.join(projectsDir, projectName);
    
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }
    
    // Not found, return null
    return null;
  }
}

// Factory function for socket handler setup
function setupSocketHandlers(io) {
  const socketManager = new SocketManager(io);
  
  // Broadcast system status periodically (optimized for Raspberry Pi)
  setInterval(() => {
    // Only broadcast if there are connected clients to save resources
    if (io.engine.clientsCount > 0) {
      socketManager.broadcastSystemStatus();
    }
  }, 60000); // Every 60 seconds (reduced frequency for better performance)

  // Store socket manager on io instance for external access
  io.socketManager = socketManager;
  
  logger.system('Socket.IO handlers initialized with full integration');
  
  return socketManager;
}

module.exports = setupSocketHandlers;