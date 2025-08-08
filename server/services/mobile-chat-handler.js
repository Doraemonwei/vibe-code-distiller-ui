const WebSocketServer = require('ws').WebSocketServer;
const ClaudeChatProvider = require('./claudeChat');
const logger = require('../utils/logger');

class MobileChatHandler {
  constructor(server) {
    this.server = server;
    this.wss = new WebSocketServer({ 
      server,
      path: '/mobile-chat'
    });
    this.activeConnections = new Map();
    this.chatProviders = new Map();
    
    this.setupWebSocketServer();
  }
  
  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const connectionId = this.generateConnectionId();
      logger.info(`Mobile chat WebSocket connection: ${connectionId}`);
      
      // Store connection
      this.activeConnections.set(connectionId, ws);
      
      // Initialize chat provider for this connection
      const PROJECT_ROOT = process.cwd(); // Use current working directory
      const chatProvider = new ClaudeChatProvider(PROJECT_ROOT);
      
      // Override postMessage to use this WebSocket
      chatProvider._postMessage = (message) => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify(message));
        }
      };
      
      this.chatProviders.set(connectionId, chatProvider);
      
      // Send initial connection confirmation
      ws.send(JSON.stringify({ 
        type: 'connected',
        connectionId: connectionId
      }));
      
      // Restore session if exists
      const sessionInfo = chatProvider.getSessionInfo();
      if (sessionInfo) {
        ws.send(JSON.stringify({ 
          type: 'sessionResumed', 
          data: sessionInfo 
        }));
        
        // Load conversation history
        chatProvider.loadLatestConversation();
      }
      
      // Handle incoming messages
      ws.on('message', (message) => {
        this.handleMessage(connectionId, message);
      });
      
      // Handle connection close
      ws.on('close', () => {
        this.handleClose(connectionId);
      });
      
      // Handle errors
      ws.on('error', (error) => {
        logger.error(`Mobile chat WebSocket error (${connectionId}):`, error);
        this.handleClose(connectionId);
      });
    });
    
    logger.info('Mobile chat WebSocket server initialized on /mobile-chat');
  }
  
  generateConnectionId() {
    return 'mobile-' + Math.random().toString(36).substr(2, 9);
  }
  
  handleMessage(connectionId, message) {
    try {
      const data = JSON.parse(message.toString());
      const chatProvider = this.chatProviders.get(connectionId);
      
      if (!chatProvider) {
        logger.error(`No chat provider for connection: ${connectionId}`);
        return;
      }
      
      logger.debug(`Mobile chat message (${connectionId}):`, data.type);
      
      // Route messages to chat provider
      switch (data.type) {
        case 'sendMessage':
          chatProvider.sendMessage(data.text, data.planMode, data.thinkingMode);
          break;
          
        case 'newSession':
          chatProvider.newSession();
          break;
          
        case 'stopRequest':
          chatProvider.stopCurrentRequest();
          break;
          
        case 'getWorkspaceFiles':
          chatProvider.getWorkspaceFiles(data.searchTerm);
          break;
          
        case 'selectModel':
          chatProvider.selectModel(data.model);
          break;
          
        case 'getSettings':
          chatProvider.getSettings();
          break;
          
        case 'updateSettings':
          chatProvider.updateSettings(data.settings);
          break;
          
        case 'permissionResponse':
          chatProvider.handlePermissionResponse(data.id, data.approved, data.alwaysAllow);
          break;
          
        case 'getPermissions':
          chatProvider.getPermissions();
          break;
          
        case 'removePermission':
          chatProvider.removePermission(data.tool, data.command);
          break;
          
        case 'getConversationList':
          const conversations = chatProvider.getConversationList();
          const wsConn1 = this.activeConnections.get(connectionId);
          if (wsConn1 && wsConn1.readyState === 1) {
            wsConn1.send(JSON.stringify({
              type: 'conversationList',
              data: conversations
            }));
          }
          break;
          
        case 'loadConversation':
          const conversation = chatProvider.loadConversation(data.sessionId);
          if (conversation) {
            const wsConn2 = this.activeConnections.get(connectionId);
            if (wsConn2 && wsConn2.readyState === 1) {
              // Send all messages to UI
              conversation.messages.forEach(msg => {
                wsConn2.send(JSON.stringify(msg));
              });
              // Send session info
              wsConn2.send(JSON.stringify({
                type: 'sessionInfo',
                data: chatProvider.getSessionInfo()
              }));
            }
          }
          break;
          
        case 'deleteConversation':
          const success = chatProvider.deleteConversation(data.sessionId);
          const wsConn3 = this.activeConnections.get(connectionId);
          if (wsConn3 && wsConn3.readyState === 1) {
            wsConn3.send(JSON.stringify({
              type: 'conversationDeleted',
              data: { sessionId: data.sessionId, success }
            }));
          }
          break;
          
        default:
          logger.warn(`Unknown mobile chat message type: ${data.type}`);
      }
    } catch (error) {
      logger.error(`Error handling mobile chat message (${connectionId}):`, error);
      const wsConnError = this.activeConnections.get(connectionId);
      if (wsConnError && wsConnError.readyState === 1) {
        wsConnError.send(JSON.stringify({ 
          type: 'error', 
          data: `Error: ${error.message}` 
        }));
      }
    }
  }
  
  handleClose(connectionId) {
    logger.info(`Mobile chat WebSocket disconnected: ${connectionId}`);
    
    // Cleanup chat provider
    const chatProvider = this.chatProviders.get(connectionId);
    if (chatProvider && typeof chatProvider.cleanup === 'function') {
      chatProvider.cleanup();
    }
    
    // Remove from maps
    this.activeConnections.delete(connectionId);
    this.chatProviders.delete(connectionId);
  }
  
  getActiveConnections() {
    return this.activeConnections.size;
  }
  
  shutdown() {
    logger.info('Shutting down mobile chat handler...');
    
    // Close all WebSocket connections
    this.activeConnections.forEach((ws, connectionId) => {
      if (ws.readyState === 1) {
        ws.close();
      }
      this.handleClose(connectionId);
    });
    
    // Close WebSocket server
    this.wss.close();
  }
}

module.exports = MobileChatHandler;