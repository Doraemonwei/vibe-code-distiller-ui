const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(cp.exec);

class ClaudeChatProvider {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.sessionStorePath = path.join(projectRoot, '.claude-code-chat');
    this.conversationsPath = path.join(this.sessionStorePath, 'conversations');
    this.settingsPath = path.join(this.sessionStorePath, 'settings.json');
    this.permissionRequestsPath = path.join(this.sessionStorePath, 'permission-requests');
    this.mcpConfigPath = path.join(this.sessionStorePath, 'mcp-servers.json');
    
    // State
    this._currentClaudeProcess = null;
    this._currentSessionId = null;
    this._selectedModel = 'default';
    this._isProcessing = false;
    this._totalCost = 0;
    this._totalTokensInput = 0;
    this._totalTokensOutput = 0;
    this._requestCount = 0;
    this._currentConversation = [];
    this._conversationStartTime = null;
    this._thinkingMode = false;
    
    // Initialize storage
    this._initializeStorage();
    
    // Load settings
    this._loadSettings();
    
    // Resume latest session
    this._resumeLatestSession();
    
    // Permission system
    this._permissions = {};
    this._pendingPermissions = new Map();
    this._loadPermissions();
    
    // Set up MCP configuration
    this._setupMCPConfig();
    
    // Set up file watcher for permission requests
    this._setupPermissionWatcher();
  }
  
  cleanup() {
    // Clean up before switching projects
    if (this._currentClaudeProcess) {
      this.stopCurrentRequest();
    }
    
    // Clear permission watcher if exists
    if (this._permissionWatcher) {
      this._permissionWatcher.close();
    }
  }
  
  _initializeStorage() {
    // Create storage directories if they don't exist
    if (!fs.existsSync(this.sessionStorePath)) {
      fs.mkdirSync(this.sessionStorePath, { recursive: true });
    }
    if (!fs.existsSync(this.conversationsPath)) {
      fs.mkdirSync(this.conversationsPath, { recursive: true });
    }
    if (!fs.existsSync(this.permissionRequestsPath)) {
      fs.mkdirSync(this.permissionRequestsPath, { recursive: true });
    }
  }
  
  _loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
        this._selectedModel = settings.selectedModel || 'default';
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }
  
  _saveSettings() {
    try {
      const settings = {
        selectedModel: this._selectedModel,
        thinkingMode: this._thinkingMode
      };
      fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }
  
  _resumeLatestSession() {
    try {
      const files = fs.readdirSync(this.conversationsPath)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Sort descending
        
      if (files.length > 0) {
        const latestFile = files[0];
        const data = JSON.parse(fs.readFileSync(path.join(this.conversationsPath, latestFile), 'utf8'));
        this._currentSessionId = data.sessionId;
        this._currentConversation = data.messages || [];
        this._conversationStartTime = data.startTime;
        this._totalCost = data.totalCost || 0;
        this._totalTokensInput = data.totalTokens?.input || 0;
        this._totalTokensOutput = data.totalTokens?.output || 0;
        this._requestCount = data.messages.filter(m => m.messageType === 'userInput').length;
      }
    } catch (error) {
      console.error('Error resuming session:', error);
    }
  }
  
  getSessionInfo() {
    if (!this._currentSessionId) return null;
    
    return {
      sessionId: this._currentSessionId,
      totalCost: this._totalCost,
      totalTokensInput: this._totalTokensInput,
      totalTokensOutput: this._totalTokensOutput,
      requestCount: this._requestCount
    };
  }
  
  getConversationList() {
    try {
      console.log('Reading conversations from:', this.conversationsPath);
      console.log('Expected path:', path.join(this.projectRoot, '.claude-code-chat', 'conversations'));
      const files = fs.readdirSync(this.conversationsPath);
      console.log('Found files:', files);
      const conversations = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.conversationsPath, file);
            const stats = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);
            
            console.log(`File ${file} has title: "${data.title}"`);
            
            conversations.push({
              sessionId: data.sessionId,
              title: data.title || 'Untitled Conversation',
              startTime: data.startTime,
              endTime: data.endTime || stats.mtime.toISOString(),
              messageCount: data.messageCount || data.messages?.length || 0,
              totalCost: data.totalCost || 0,
              fileName: file
            });
          } catch (error) {
            console.error('Error reading conversation file:', file, error);
          }
        }
      }
      
      // Sort by most recent first
      conversations.sort((a, b) => new Date(b.endTime) - new Date(a.endTime));
      
      console.log('Returning conversations:', conversations.map(c => ({ sessionId: c.sessionId, title: c.title })));
      return conversations;
    } catch (error) {
      console.error('Error listing conversations:', error);
      return [];
    }
  }
  
  loadConversation(sessionId) {
    try {
      // Find the conversation file
      const files = fs.readdirSync(this.conversationsPath);
      const conversationFile = files.find(f => {
        if (f.includes(sessionId)) return true;
        // Also check inside the file
        try {
          const content = fs.readFileSync(path.join(this.conversationsPath, f), 'utf8');
          const data = JSON.parse(content);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });
      
      if (!conversationFile) {
        return null;
      }
      
      const filePath = path.join(this.conversationsPath, conversationFile);
      const content = fs.readFileSync(filePath, 'utf8');
      const conversation = JSON.parse(content);
      
      // Load the conversation into current state
      this._currentSessionId = conversation.sessionId;
      this._currentConversation = conversation.messages || [];
      this._conversationStartTime = conversation.startTime;
      this._totalCost = conversation.totalCost || 0;
      this._totalTokensInput = conversation.totalTokens?.input || 0;
      this._totalTokensOutput = conversation.totalTokens?.output || 0;
      this._requestCount = conversation.messages.filter(m => m.type === 'userInput').length;
      
      return conversation;
    } catch (error) {
      console.error('Error loading conversation:', error);
      return null;
    }
  }
  
  deleteConversation(sessionId) {
    try {
      const conversations = this.getConversationList();
      const conversation = conversations.find(c => c.sessionId === sessionId);
      
      if (conversation && conversation.fileName) {
        const filePath = path.join(this.conversationsPath, conversation.fileName);
        fs.unlinkSync(filePath);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error deleting conversation:', error);
      return false;
    }
  }
  
  loadLatestConversation() {
    // Send all messages from current conversation to UI
    this._currentConversation.forEach(msg => {
      // Messages are stored with timestamp and messageType, need to extract the actual message
      if (msg.messageType && msg.data) {
        this._postMessage({
          type: msg.messageType,
          data: msg.data
        });
      }
    });
    
    // Send totals update
    this._postMessage({
      type: 'updateTotals',
      data: {
        totalCost: this._totalCost,
        totalTokensInput: this._totalTokensInput,
        totalTokensOutput: this._totalTokensOutput,
        requestCount: this._requestCount
      }
    });
  }
  
  sendMessage(message, planMode = false, thinkingMode = false) {
    if (this._isProcessing) {
      this._postMessage({
        type: 'error',
        data: 'Already processing a message. Please wait or stop the current request.'
      });
      return;
    }
    
    // Initialize session if needed
    if (!this._currentSessionId) {
      // Don't create our own session ID - let Claude create it
      this._conversationStartTime = new Date().toISOString();
    }
    
    // Save and send user message
    this._sendAndSaveMessage({
      type: 'userInput',
      data: message
    });
    
    // Set processing state
    this._isProcessing = true;
    this._postMessage({
      type: 'setProcessing',
      data: { isProcessing: true }
    });
    
    // Prepare Claude command
    const args = [];
    
    // Add flags for JSON streaming output (same as VS Code extension)
    args.push('-p', '--output-format', 'stream-json', '--verbose');
    
    // Add MCP configuration for permissions
    if (fs.existsSync(this.mcpConfigPath)) {
      args.push('--mcp-config', this.mcpConfigPath);
      args.push('--allowedTools', 'mcp__claude-code-chat-permissions__approval_prompt');
      args.push('--permission-prompt-tool', 'mcp__claude-code-chat-permissions__approval_prompt');
    }
    
    // Add continue flag to maintain conversation context
    // Only use --resume with actual Claude session IDs
    if (this._currentSessionId && !this._currentSessionId.startsWith('session_') && !this._currentSessionId.startsWith('conversation_')) {
      args.push('--resume', this._currentSessionId);
    } else if (this._currentConversation.length > 0) {
      // Use --continue for ongoing conversations
      args.push('--continue');
    }
    
    // Add model selection
    if (this._selectedModel && this._selectedModel !== 'default') {
      args.push('--model', this._selectedModel);
    }
    
    // Add thinking mode
    if (thinkingMode) {
      args.push('--think');
    }
    
    // Prepare message with plan mode prefix if needed
    let actualMessage = message;
    if (planMode) {
      actualMessage = `plan\n\n${message}`;
    }
    
    // Debug: Log the command being run
    console.log('Running claude with args:', args);
    console.log('Message:', actualMessage);
    console.log('Working directory:', this.projectRoot);
    console.log('Full command:', `claude ${args.join(' ')}`);
    
    // Spawn Claude process with unbuffered output
    this._currentClaudeProcess = cp.spawn('claude', args, {
      shell: process.platform === 'win32',
      cwd: this.projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        PYTHONUNBUFFERED: '1', // In case Claude uses Python
        NODE_NO_READLINE: '1'  // Disable readline buffering
      }
    });
    
    // Send message to Claude
    this._currentClaudeProcess.stdin.write(actualMessage + '\n');
    
    // We need to end stdin for the initial message, but Claude's permission
    // system requires stdin to remain open. This is a limitation of the current
    // implementation. For now, we'll close stdin and permissions won't work.
    this._currentClaudeProcess.stdin.end();
    
    // Handle stdout - JSON stream
    let rawOutput = '';
    let totalOutput = ''; // Debug: store all output
    
    this._currentClaudeProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      console.log('=== STDOUT CHUNK ===');
      console.log(chunk);
      console.log('===================');
      
      totalOutput += chunk;
      rawOutput += chunk;
      
      // Process JSON stream line by line
      const lines = rawOutput.split('\n');
      rawOutput = lines.pop() || ''; // Keep incomplete line
      
      for (const line of lines) {
        console.log('Processing line:', JSON.stringify(line));
        if (line.trim()) {
          try {
            const jsonData = JSON.parse(line.trim());
            console.log('Parsed JSON:', jsonData);
            this._processJsonStreamData(jsonData);
          } catch (error) {
            // Only show non-JSON lines that look like actual user output
            // Filter out system messages, partial JSON, and internal Claude data
            const trimmedLine = line.trim();
            
            // Skip lines that are clearly system messages or internal JSON structures
            if (
              // System message patterns
              trimmedLine.includes('system-reminder') ||
              trimmedLine.includes('"session_id":') ||
              trimmedLine.includes('"tool_use_id":') ||
              trimmedLine.includes('"parent_tool_use_id":') ||
              // Complete JSON objects (start and end with braces)
              (trimmedLine.startsWith('{') && trimmedLine.endsWith('}')) ||
              // Multi-line JSON fragments with commas and quotes
              (trimmedLine.includes('","') && trimmedLine.includes(':')) ||
              // Line number prefixes from file reads
              trimmedLine.match(/^\d+→/) ||
              // Empty or very short lines
              trimmedLine.length < 3
            ) {
              console.log('Filtered out internal output:', trimmedLine.substring(0, 100));
              return;
            }
            
            // Only send actual user-readable text output
            console.log('Non-JSON output:', line);
            console.log('Parse error:', error.message);
            this._sendAndSaveMessage({
              type: 'output',
              data: trimmedLine
            });
          }
        }
      }
    });
    
    // Handle stderr
    let errorOutput = '';
    this._currentClaudeProcess.stderr.on('data', (data) => {
      const stderr = data.toString();
      errorOutput += stderr;
      console.error('Claude stderr:', stderr);
    });
    
    // Handle process exit
    this._currentClaudeProcess.on('close', (code) => {
      console.log('Claude process exited with code:', code);
      console.log('Total stdout output:', totalOutput);
      console.log('Total stderr output:', errorOutput);
      console.log('Remaining buffer:', rawOutput);
      
      // Close stdin if still open
      if (this._currentClaudeProcess && this._currentClaudeProcess.stdin) {
        this._currentClaudeProcess.stdin.end();
      }
      
      this._isProcessing = false;
      this._currentClaudeProcess = null;
      
      this._postMessage({
        type: 'setProcessing',
        data: { isProcessing: false }
      });
      
      if (code !== 0) {
        console.error('Claude exited with error. Full stderr:', errorOutput);
        this._sendAndSaveMessage({
          type: 'error',
          data: errorOutput.trim() || `Claude exited with code ${code}`
        });
      }
      
      // Save conversation after each message
      this._saveCurrentConversation();
    });
    
    // Handle errors
    this._currentClaudeProcess.on('error', (error) => {
      this._isProcessing = false;
      this._currentClaudeProcess = null;
      
      this._postMessage({
        type: 'setProcessing',
        data: { isProcessing: false }
      });
      
      if (error.code === 'ENOENT') {
        this._sendAndSaveMessage({
          type: 'error',
          data: 'Claude CLI not found. Please install it with: npm install -g @anthropic/claude-code'
        });
      } else {
        this._sendAndSaveMessage({
          type: 'error',
          data: `Error running Claude: ${error.message}`
        });
      }
    });
  }
  
  _processJsonStreamData(jsonData) {
    switch (jsonData.type) {
      case 'system':
        if (jsonData.subtype === 'init') {
          this._currentSessionId = jsonData.session_id;
          this._sendAndSaveMessage({
            type: 'sessionInfo',
            data: {
              sessionId: jsonData.session_id,
              tools: jsonData.tools || [],
              mcpServers: jsonData.mcp_servers || []
            }
          });
        }
        break;
        
      case 'user':
        // Handle tool results and permission requests from Claude
        if (jsonData.message && jsonData.message.content && jsonData.message.content[0]) {
          const content = jsonData.message.content[0];
          if (content.type === 'tool_result') {
            this._sendAndSaveMessage({
              type: 'toolResult',
              data: {
                content: content.content || '',
                isError: content.is_error || false,
                toolUseId: content.tool_use_id,
                toolName: content.name || 'unknown'
              }
            });
          }
        }
        break;
        
      case 'permission_request':
        // Permission requests are now handled through MCP server file watching
        console.log('Permission request received through stream (legacy):', jsonData);
        break;
        
      case 'assistant':
        // Handle the new JSON format from Claude CLI
        console.log('Processing assistant message:', JSON.stringify(jsonData, null, 2));
        if (jsonData.message && jsonData.message.role === 'assistant') {
          // Update token tracking
          if (jsonData.message.usage) {
            this._totalTokensInput += jsonData.message.usage.input_tokens || 0;
            this._totalTokensOutput += jsonData.message.usage.output_tokens || 0;
            this._requestCount++;
            
            this._sendAndSaveMessage({
              type: 'updateTokens',
              data: {
                totalTokensInput: this._totalTokensInput,
                totalTokensOutput: this._totalTokensOutput,
                currentInputTokens: jsonData.message.usage.input_tokens || 0,
                currentOutputTokens: jsonData.message.usage.output_tokens || 0,
                currentCost: jsonData.message.usage.total_cost || 0,
                requestCount: this._requestCount,
                cacheCreationTokens: jsonData.message.usage.cache_creation_input_tokens || 0,
                cacheReadTokens: jsonData.message.usage.cache_read_input_tokens || 0
              }
            });
            
            this._totalCost += jsonData.message.usage.total_cost || 0;
          }
          
          // Process content
          console.log('Processing message content:', jsonData.message.content);
          jsonData.message.content.forEach(content => {
            console.log('Processing content item:', content);
            if (content.type === 'text' && content.text.trim()) {
              console.log('Sending text message:', content.text.trim());
              this._sendAndSaveMessage({
                type: 'output',
                data: content.text.trim()
              });
            } else if (content.type === 'thinking' && content.thinking.trim()) {
              this._sendAndSaveMessage({
                type: 'thinking',
                data: content.thinking.trim()
              });
            } else if (content.type === 'tool_use') {
              // Format tool input for better display
              let toolInput = '';
              if (content.name === 'TodoWrite' && content.input && content.input.todos) {
                // Special formatting for TodoWrite
                toolInput = 'Todo List Update:';
                for (const todo of content.input.todos) {
                  const status = todo.status === 'completed' ? '[DONE]' :
                    todo.status === 'in_progress' ? '[IN PROGRESS]' : '[TODO]';
                  toolInput += `\n${status} ${todo.content} (priority: ${todo.priority})`;
                }
              }
              
              this._sendAndSaveMessage({
                type: 'toolUse',
                data: {
                  toolInfo: content.name,
                  toolInput: toolInput,
                  rawInput: content.input,
                  toolName: content.name,
                  toolUseId: content.tool_use_id
                }
              });
            }
          });
        }
        break;
        
      case 'final':
        if (jsonData.session_id) {
          this._currentSessionId = jsonData.session_id;
        }
        
        // Send final token update
        this._sendAndSaveMessage({
          type: 'updateTotals',
          data: {
            totalCost: this._totalCost,
            totalTokensInput: this._totalTokensInput,
            totalTokensOutput: this._totalTokensOutput,
            requestCount: this._requestCount,
            totalDuration: jsonData.duration || 0,
            currentDuration: jsonData.duration || 0,
            currentCost: jsonData.cost || 0
          }
        });
        break;
        
      case 'result':
        // Handle completion result
        if (jsonData.session_id) {
          this._currentSessionId = jsonData.session_id;
        }
        // Update final token usage if provided
        if (jsonData.usage) {
          this._sendAndSaveMessage({
            type: 'updateTokens',
            data: {
              totalTokensInput: this._totalTokensInput,
              totalTokensOutput: this._totalTokensOutput,
              currentInputTokens: jsonData.usage.input_tokens || 0,
              currentOutputTokens: jsonData.usage.output_tokens || 0,
              currentCost: jsonData.total_cost_usd || 0,
              requestCount: this._requestCount,
              cacheCreationTokens: jsonData.usage.cache_creation_input_tokens || 0,
              cacheReadTokens: jsonData.usage.cache_read_input_tokens || 0
            }
          });
        }
        break;
        
      default:
        console.log('Unhandled JSON data type:', jsonData.type, jsonData);
        // Check if this might be a permission request in a different format
        if (jsonData.type === 'system' && jsonData.subtype === 'permission_request') {
          console.log('Permission request received through stream (legacy system format):', jsonData);
        }
    }
  }
  
  _sendAndSaveMessage(message) {
    console.log('_sendAndSaveMessage called with:', message);
    
    // Initialize conversation if needed
    if (this._currentConversation.length === 0) {
      this._conversationStartTime = new Date().toISOString();
    }
    
    // Add timestamp
    const timestampedMessage = {
      timestamp: new Date().toISOString(),
      messageType: message.type,
      data: message.data
    };
    
    // Save to conversation
    this._currentConversation.push(timestampedMessage);
    
    // Send to UI
    console.log('Sending message to UI via _postMessage:', message);
    this._postMessage(message);
  }
  
  _saveCurrentConversation() {
    if (!this._currentSessionId || this._currentConversation.length === 0) {
      return;
    }
    
    // Generate a title from the first user message
    let title = 'Untitled Conversation';
    const firstUserMessage = this._currentConversation.find(msg => msg.messageType === 'userInput');
    
    console.log('Looking for first user message. Total messages:', this._currentConversation.length);
    console.log('Message types:', this._currentConversation.map(m => m.messageType));
    
    if (firstUserMessage && firstUserMessage.data && typeof firstUserMessage.data === 'string') {
      // Take first 50 characters of first user message as title
      title = firstUserMessage.data.substring(0, 50).trim();
      if (firstUserMessage.data.length > 50) {
        title += '...';
      }
    }
    
    console.log(`Saving conversation with title: "${title}"`);
    console.log('First user message:', firstUserMessage);
    
    const conversationData = {
      sessionId: this._currentSessionId,
      title: title,
      startTime: this._conversationStartTime,
      endTime: new Date().toISOString(),
      messageCount: this._currentConversation.length,
      totalCost: this._totalCost,
      totalTokens: {
        input: this._totalTokensInput,
        output: this._totalTokensOutput
      },
      messages: this._currentConversation
    };
    
    // Use timestamp for filename if no session ID from Claude yet
    const filename = this._currentSessionId ? 
      `${this._currentSessionId}.json` : 
      `conversation_${Date.now()}.json`;
    const filepath = path.join(this.conversationsPath, filename);
    
    try {
      fs.writeFileSync(filepath, JSON.stringify(conversationData, null, 2));
    } catch (error) {
      console.error('Error saving conversation:', error);
    }
  }
  
  newSession() {
    // Stop any running process
    this.stopCurrentRequest();
    
    // Save current conversation
    this._saveCurrentConversation();
    
    // Reset state
    this._currentSessionId = null;
    this._currentConversation = [];
    this._conversationStartTime = null;
    this._totalCost = 0;
    this._totalTokensInput = 0;
    this._totalTokensOutput = 0;
    this._requestCount = 0;
    
    // Notify UI
    this._postMessage({ type: 'sessionCleared' });
  }
  
  stopCurrentRequest() {
    if (this._currentClaudeProcess) {
      this._currentClaudeProcess.kill('SIGTERM');
      this._currentClaudeProcess = null;
      this._isProcessing = false;
      
      this._sendAndSaveMessage({
        type: 'error',
        data: 'Claude code was stopped.'
      });
    }
  }
  
  getWorkspaceFiles(searchTerm = '') {
    // Simple file search implementation
    const results = [];
    
    const searchDir = (dir, prefix = '') => {
      try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relativePath = prefix ? path.join(prefix, item) : item;
          
          // Skip hidden files and common ignore patterns
          if (item.startsWith('.') || item === 'node_modules') continue;
          
          const stats = fs.statSync(fullPath);
          
          if (stats.isDirectory()) {
            searchDir(fullPath, relativePath);
          } else if (!searchTerm || item.toLowerCase().includes(searchTerm.toLowerCase())) {
            results.push(relativePath);
          }
        }
      } catch (error) {
        console.error('Error reading directory:', error);
      }
    };
    
    searchDir(this.projectRoot);
    
    // Limit results and format as objects
    const limited = results.slice(0, 50).map(filepath => ({
      name: path.basename(filepath),
      path: filepath
    }));
    
    this._postMessage({
      type: 'workspaceFiles',
      data: limited
    });
  }
  
  
  
  selectModel(model) {
    this._selectedModel = model;
    this._saveSettings();
  }
  
  getSettings() {
    this._postMessage({
      type: 'settings',
      data: {
        selectedModel: this._selectedModel,
        thinkingMode: this._thinkingMode
      }
    });
  }
  
  updateSettings(settings) {
    if (settings.selectedModel) {
      this._selectedModel = settings.selectedModel;
    }
    if (settings.thinkingMode !== undefined) {
      this._thinkingMode = settings.thinkingMode;
    }
    this._saveSettings();
  }
  
  cleanup() {
    this.stopCurrentRequest();
    this._saveCurrentConversation();
  }
  
  // Permission system methods (legacy - replaced by MCP)
  
  _loadPermissions() {
    try {
      const permissionsPath = path.join(this.sessionStorePath, 'permissions.json');
      if (fs.existsSync(permissionsPath)) {
        this._permissions = JSON.parse(fs.readFileSync(permissionsPath, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading permissions:', error);
    }
  }
  
  _savePermissions() {
    try {
      const permissionsPath = path.join(this.sessionStorePath, 'permissions.json');
      fs.writeFileSync(permissionsPath, JSON.stringify(this._permissions, null, 2));
    } catch (error) {
      console.error('Error saving permissions:', error);
    }
  }
  
  _setupMCPConfig() {
    try {
      // Get the path to mcp-permissions.js from the current directory
      const mcpPermissionsPath = path.join(__dirname, 'mcp-permissions.js');
      
      // Create MCP config
      const mcpConfig = {
        mcpServers: {
          'claude-code-chat-permissions': {
            command: 'node',
            args: [mcpPermissionsPath],
            env: {
              CLAUDE_PERMISSIONS_PATH: this.permissionRequestsPath
            }
          }
        }
      };
      
      // Write MCP config
      fs.writeFileSync(this.mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      console.log('MCP config created at:', this.mcpConfigPath);
    } catch (error) {
      console.error('Failed to set up MCP config:', error);
    }
  }
  
  _setupPermissionWatcher() {
    try {
      // Watch for .request files
      const watcher = fs.watch(this.permissionRequestsPath, (eventType, filename) => {
        if (eventType === 'rename' && filename && filename.endsWith('.request')) {
          const requestFile = path.join(this.permissionRequestsPath, filename);
          if (fs.existsSync(requestFile)) {
            this._handlePermissionRequestFile(requestFile);
          }
        }
      });
      
      // Clean up on process exit
      process.on('exit', () => watcher.close());
    } catch (error) {
      console.error('Failed to set up permission watcher:', error);
    }
  }
  
  async _handlePermissionRequestFile(requestFile) {
    try {
      // Read the request with retry logic for race conditions
      let content;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          content = fs.readFileSync(requestFile, 'utf8');
          if (content.trim().length === 0) {
            throw new Error('Empty file');
          }
          break;
        } catch (error) {
          attempts++;
          if (attempts >= maxAttempts) {
            console.warn(`Failed to read permission file ${requestFile} after ${maxAttempts} attempts:`, error.message);
            return;
          }
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      const request = JSON.parse(content);
      
      // Generate a unique ID for the UI
      const uiRequestId = Date.now().toString();
      
      // Store the mapping between UI request ID and file request
      this._pendingPermissions.set(uiRequestId, (approved) => {
        // Write response file
        const responseFile = requestFile.replace('.request', '.response');
        const response = {
          id: request.id,
          approved: approved,
          timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync(responseFile, JSON.stringify(response));
        
        // Delete request file
        try {
          fs.unlinkSync(requestFile);
        } catch (e) {
          // Ignore if already deleted
        }
      });
      
      // Send permission request to UI
      this._postMessage({
        type: 'permissionRequest',
        data: {
          id: uiRequestId,
          tool: request.tool,
          command: JSON.stringify(request.input, null, 2)
        }
      });
    } catch (error) {
      console.error('Failed to handle permission request file:', error);
    }
  }
  
  handlePermissionRequest(toolName, command) {
    // Check if we have a saved permission
    const permissionKey = `${toolName}:${command}`;
    if (this._permissions[permissionKey]) {
      return Promise.resolve(true);
    }
    
    // Create permission request
    const requestId = `perm_${Date.now()}`;
    
    return new Promise((resolve) => {
      this._pendingPermissions.set(requestId, resolve);
      
      this._postMessage({
        type: 'permissionRequest',
        data: {
          id: requestId,
          tool: toolName,
          command: command
        }
      });
    });
  }
  
  handlePermissionResponse(id, approved, alwaysAllow) {
    const resolver = this._pendingPermissions.get(id);
    if (resolver) {
      resolver(approved);
      this._pendingPermissions.delete(id);
      
      // Save permission if always allow
      if (approved && alwaysAllow) {
        const data = this._pendingPermissions.get(id + '_data');
        if (data) {
          const permissionKey = `${data.tool}:${data.command}`;
          this._permissions[permissionKey] = true;
          this._savePermissions();
        }
      }
    }
  }
  
  getPermissions() {
    const permissions = [];
    for (const [key, value] of Object.entries(this._permissions)) {
      if (value) {
        const [tool, ...commandParts] = key.split(':');
        permissions.push({
          tool,
          command: commandParts.join(':')
        });
      }
    }
    
    this._postMessage({
      type: 'permissions',
      data: permissions
    });
  }
  
  removePermission(tool, command) {
    const permissionKey = `${tool}:${command}`;
    delete this._permissions[permissionKey];
    this._savePermissions();
    this.getPermissions();
  }
  
  // This will be overridden by server.js
  _postMessage(message) {
    console.log('PostMessage:', message.type);
  }
}

module.exports = ClaudeChatProvider;