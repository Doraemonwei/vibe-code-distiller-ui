const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const logger = require('./logger');

class TmuxUtils {
  static SESSION_PREFIX = 'claude-web';
  
  static generateSessionName(projectId, sequenceNumber = null) {
    if (sequenceNumber !== null) {
      return `${this.SESSION_PREFIX}-${projectId}-${sequenceNumber}`;
    }
    return `${this.SESSION_PREFIX}-${projectId}-${Date.now()}`;
  }
  
  static parseSessionName(sessionName) {
    const match = sessionName.match(/^claude-web-(.+)-(\d+)$/);
    if (match) {
      return {
        projectId: match[1],
        identifier: parseInt(match[2]) // Can be timestamp or sequence number
      };
    }
    return null;
  }
  
  static async hasSession(sessionName) {
    try {
      await execAsync(`tmux has-session -t ${sessionName}`);
      return true;
    } catch (error) {
      return false;
    }
  }
  
  static async createSession(sessionName, workingDir = null) {
    try {
      const cdCmd = workingDir ? `cd ${workingDir}` : '';
      const cmd = `tmux new-session -d -s ${sessionName} ${cdCmd ? `-c ${workingDir}` : ''}`;
      await execAsync(cmd);
      
      // Configure session for persistence and web terminal use
      await execAsync(`tmux set-option -t ${sessionName} status off`); // Disable status bar
      await execAsync(`tmux set-option -t ${sessionName} remain-on-exit on`); // Keep windows alive when command exits
      await execAsync(`tmux set-option -t ${sessionName} destroy-unattached off`); // Don't destroy when no clients attached
      
      // Configure for programmatic use and prevent automatic exit
      await execAsync(`tmux set-option -t ${sessionName} exit-empty off`); // Don't exit when all windows are closed
      await execAsync(`tmux set-option -t ${sessionName} detach-on-destroy off`); // Don't detach when session destroyed
      
      return true;
    } catch (error) {
      logger.error(`Failed to create session ${sessionName}:`, error.message);
      return false;
    }
  }
  
  static async listSessions() {
    try {
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}"');
      const sessions = stdout.trim().split('\n').filter(name => name.startsWith(this.SESSION_PREFIX));
      return sessions;
    } catch (error) {
      // No sessions exist
      return [];
    }
  }
  
  static async getNextSequenceNumber(projectId) {
    try {
      const sessions = await this.listSessions();
      const projectSessions = sessions.filter(name => {
        const parsed = this.parseSessionName(name);
        return parsed && parsed.projectId === projectId;
      });
      
      if (projectSessions.length === 0) {
        return 1;
      }
      
      const sequenceNumbers = projectSessions.map(name => {
        const parsed = this.parseSessionName(name);
        return parsed ? parsed.identifier : 0;
      }).filter(num => num > 0 && num < 1000000); // Filter out timestamps
      
      if (sequenceNumbers.length === 0) {
        return 1;
      }
      
      return Math.max(...sequenceNumbers) + 1;
    } catch (error) {
      logger.error('Error getting next sequence number:', error.message);
      return 1;
    }
  }
  
  static async getSessionInfo(sessionName) {
    try {
      const { stdout } = await execAsync(`tmux list-sessions -F "#{session_name},#{session_windows},#{session_created}" | grep "^${sessionName},"`);
      const [name, windows, created] = stdout.trim().split(',');
      return {
        name,
        windows: parseInt(windows),
        created: new Date(parseInt(created) * 1000)
      };
    } catch (error) {
      return null;
    }
  }
  
  static async killSession(sessionName) {
    try {
      await execAsync(`tmux kill-session -t ${sessionName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to kill session ${sessionName}:`, error.message);
      return false;
    }
  }
  
  static async sendTmuxCommand(sessionName, command) {
    try {
      // Send a command to the terminal in the session
      // Use tmux send-keys with -l flag for literal interpretation
      logger.info(`Sending command to session ${sessionName}: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`);
      
      // Check if session exists first
      const sessionExists = await this.hasSession(sessionName);
      if (!sessionExists) {
        logger.error(`Cannot send command - session ${sessionName} does not exist`);
        return false;
      }
      
      try {
        // Method 1: Direct command execution (for simple commands)
        if (!command.includes('\\n') && !command.includes('|') && !command.includes(';') && !command.includes('&&')) {
          await execAsync(`tmux send-keys -t ${sessionName} "${command}" Enter`);
          logger.debug(`Sent command using direct method: ${command}`);
        } else {
          // Method 2: Literal mode for complex commands (safer for special characters)
          await execAsync(`tmux send-keys -t ${sessionName} -l "${command}"`);
          await execAsync(`tmux send-keys -t ${sessionName} Enter`);
          logger.debug(`Sent command using literal method: ${command}`);
        }
        return true;
      } catch (sendError) {
        logger.error(`Failed to send command to session ${sessionName}:`, sendError.message);
        return false;
      }
    } catch (error) {
      logger.error(`Error in sendTmuxCommand for session ${sessionName}:`, error.message);
      return false;
    }
  }
  
  static async enterCopyMode(sessionName) {
    try {
      await execAsync(`tmux copy-mode -t ${sessionName}`);
      return true;
    } catch (error) {
      logger.debug(`Failed to enter copy mode for ${sessionName}:`, error.message);
      return false;
    }
  }
  
  static async exitCopyMode(sessionName) {
    try {
      await execAsync(`tmux send-keys -t ${sessionName} q`);
      return true;
    } catch (error) {
      logger.debug(`Failed to exit copy mode for ${sessionName}:`, error.message);
      return false;
    }
  }
  
  static async scrollUp(sessionName, lines = 'line') {
    try {
      // Check if session is in copy mode, if not enter copy mode first
      const inCopyMode = await this.isInCopyMode(sessionName);
      if (!inCopyMode) {
        await this.enterCopyMode(sessionName);
        // Small delay to ensure copy mode is active
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Perform scrolling in copy mode
      if (lines === 'page') {
        await execAsync(`tmux send-keys -t ${sessionName} Page_Up`);
      } else if (lines === 'halfpage') {
        // Send multiple line ups for half page
        for (let i = 0; i < 10; i++) {
          await execAsync(`tmux send-keys -t ${sessionName} Up`);
        }
      } else {
        // Default: scroll up by one line
        await execAsync(`tmux send-keys -t ${sessionName} Up`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Scroll up failed for ${sessionName}:`, error.message);
      return false;
    }
  }
  
  static async scrollDown(sessionName, lines = 'line') {
    try {
      // Check if session is in copy mode
      const inCopyMode = await this.isInCopyMode(sessionName);
      if (!inCopyMode) {
        // If not in copy mode, we can't scroll down in history
        logger.debug(`Session ${sessionName} not in copy mode, cannot scroll down in history`);
        return false;
      }
      
      // Perform scrolling in copy mode
      if (lines === 'page') {
        await execAsync(`tmux send-keys -t ${sessionName} Page_Down`);
      } else if (lines === 'halfpage') {
        // Send multiple line downs for half page
        for (let i = 0; i < 10; i++) {
          await execAsync(`tmux send-keys -t ${sessionName} Down`);
        }
      } else {
        // Default: scroll down by one line
        await execAsync(`tmux send-keys -t ${sessionName} Down`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Scroll down failed for ${sessionName}:`, error.message);
      return false;
    }
  }
  
  static async isInCopyMode(sessionName) {
    try {
      const { stdout } = await execAsync(`tmux display-message -t ${sessionName} -p "#{pane_in_mode}"`);
      return stdout.trim() === '1';
    } catch (error) {
      logger.debug(`Failed to check copy mode status for ${sessionName}:`, error.message);
      return false;
    }
  }
  
  static async scrollInCopyMode(sessionName, direction, lines = 'line') {
    try {
      if (direction === 'up') {
        return await this.scrollUp(sessionName, lines);
      } else if (direction === 'down') {
        return await this.scrollDown(sessionName, lines);
      } else {
        throw new Error(`Invalid scroll direction: ${direction}`);
      }
    } catch (error) {
      logger.error(`Scroll in copy mode failed:`, error.message);
      return false;
    }
  }
  
  static async goToBottomAndExit(sessionName) {
    try {
      // Check if in copy mode
      const inCopyMode = await this.isInCopyMode(sessionName);
      
      if (inCopyMode) {
        // Go to bottom (end of buffer) then exit copy mode
        await execAsync(`tmux send-keys -t ${sessionName} G`); // Go to end in copy mode
        await new Promise(resolve => setTimeout(resolve, 100));
        await execAsync(`tmux send-keys -t ${sessionName} q`); // Exit copy mode
      }
      
      return true;
    } catch (error) {
      logger.error(`Go to bottom and exit failed for ${sessionName}:`, error.message);
      return false;
    }
  }

  // Switch to specific tmux session by finding and switching TTYd client
  static async switchToSession(sessionName, currentSessionName = null, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // First check if target session exists
        const exists = await this.hasSession(sessionName);
        if (!exists) {
          logger.warn(`Target session ${sessionName} does not exist`);
          return false;
        }
        
        logger.info(`Switching to session ${sessionName} via direct tmux command (attempt ${attempt + 1}/${maxRetries})`);
        
        // Find TTYd client (connected to base-session)
        const ttydClient = await this.findTTYdClient();
        if (!ttydClient) {
          throw new Error('Could not find TTYd client');
        }
        
        logger.debug(`Found TTYd client: ${ttydClient}`);
        
        // Switch the TTYd client to target session
        await execAsync(`tmux switch-client -c ${ttydClient} -t ${sessionName}`);
        
        // Wait a bit and verify the switch
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Send clear screen command for better UX
        try {
          await execAsync(`tmux send-keys -t ${ttydClient} 'C-l'`);
        } catch (clearError) {
          logger.debug('Failed to clear screen after switch:', clearError.message);
        }
        
        logger.info(`Successfully switched TTYd client to session ${sessionName}`);
        return true;
        
      } catch (error) {
        if (attempt < maxRetries - 1) {
          logger.warn(`Switch attempt ${attempt + 1} failed, retrying: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
        } else {
          logger.error(`Failed to switch to session ${sessionName} after ${maxRetries} attempts: ${error.message}`);
          return false;
        }
      }
    }
    
    return false;
  }

  // Find the TTYd client (simplified approach - look for base-session client)
  static async findTTYdClient() {
    try {
      const { stdout: clients } = await execAsync('tmux list-clients');
      
      // Look for client connected to base-session (that's the TTYd client)
      const ttydClientLine = clients.trim().split('\n').find(line => 
        line.includes('base-session') || line.includes(': base-session ')
      );
      
      if (ttydClientLine) {
        const ptsMatch = ttydClientLine.match(/\/dev\/pts\/(\d+)/);
        if (ptsMatch) {
          const ttyPts = `/dev/pts/${ptsMatch[1]}`;
          logger.debug(`Found TTYd client at: ${ttyPts}`);
          return ttyPts;
        }
      }
      
      // Fallback: look for any client that might be TTYd
      // TTYd clients often have specific terminal types
      const fallbackClient = clients.trim().split('\n').find(line => 
        line.includes('xterm-256color') && !line.includes('tmux-256color')
      );
      
      if (fallbackClient) {
        const ptsMatch = fallbackClient.match(/\/dev\/pts\/(\d+)/);
        if (ptsMatch) {
          const ttyPts = `/dev/pts/${ptsMatch[1]}`;
          logger.debug(`Found potential TTYd client (fallback): ${ttyPts}`);
          return ttyPts;
        }
      }
      
      logger.warn('Could not find TTYd client in tmux client list');
      return null;
      
    } catch (error) {
      logger.error('Failed to find TTYd client:', error.message);
      return null;
    }
  }
  
  static async capturePane(sessionName, includeHistory = true) {
    try {
      let captureCommand = `tmux capture-pane -t ${sessionName} -p`;
      if (includeHistory) {
        captureCommand += ' -S -'; // Include scrollback history
      }
      
      const { stdout } = await execAsync(captureCommand);
      return stdout;
    } catch (error) {
      logger.error(`Failed to capture pane for session ${sessionName}:`, error.message);
      return null;
    }
  }
  
  static async getCursorPosition(sessionName) {
    try {
      const { stdout } = await execAsync(`tmux display-message -t ${sessionName} -p "#{cursor_x},#{cursor_y}"`);
      const [x, y] = stdout.trim().split(',').map(Number);
      return { x, y };
    } catch (error) {
      logger.debug(`Failed to get cursor position for ${sessionName}:`, error.message);
      return { x: 0, y: 0 };
    }
  }
  
  static async disableStatusBar(sessionName) {
    try {
      await execAsync(`tmux set-option -t ${sessionName} status off`);
      return true;
    } catch (error) {
      logger.error(`Failed to disable status bar for session ${sessionName}:`, error.message);
      return false;
    }
  }

  static async isAnyClientOnBaseSession() {
    try {
      const baseSessionExists = await this.hasSession('base-session');
      return baseSessionExists;
      
    } catch (error) {
      logger.debug('Failed to check base-session status:', error.message);
      return false;
    }
  }
}

module.exports = TmuxUtils;