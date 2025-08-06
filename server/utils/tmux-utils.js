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
      
      // Set reasonable limits for web use
      await execAsync(`tmux set-option -t ${sessionName} history-limit 10000`);
      
      // Set environment variables in the session to prevent shell timeout
      await execAsync(`tmux set-environment -t ${sessionName} TMOUT ""`); // Disable bash timeout
      await execAsync(`tmux set-environment -t ${sessionName} TERM xterm-256color`);
      
      logger.info(`Created persistent tmux session: ${sessionName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create tmux session: ${error.message}`);
      throw error;
    }
  }
  
  static async listSessions() {
    try {
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}"');
      const sessions = stdout.trim().split('\n').filter(Boolean);
      return sessions.filter(session => session.startsWith(this.SESSION_PREFIX));
    } catch (error) {
      if (error.message.includes('no server running') || 
          error.message.includes('No such file or directory')) {
        return [];
      }
      throw error;
    }
  }
  
  static async getNextSequenceNumber(projectId) {
    try {
      const sessions = await this.listSessions();
      const projectSessions = sessions.filter(session => {
        const parsed = this.parseSessionName(session);
        return parsed && parsed.projectId === projectId;
      });
      
      if (projectSessions.length === 0) {
        return 1;
      }
      
      const sequenceNumbers = projectSessions.map(session => {
        const parsed = this.parseSessionName(session);
        return parsed ? parsed.identifier : 0;
      }).filter(num => num > 0 && num < 1000000000); // Filter out timestamps
      
      return sequenceNumbers.length > 0 ? Math.max(...sequenceNumbers) + 1 : 1;
    } catch (error) {
      logger.error(`Failed to get next sequence number: ${error.message}`);
      return 1;
    }
  }
  
  static async getSessionInfo(sessionName) {
    try {
      const { stdout } = await execAsync(
        `tmux list-sessions -F "#{session_name}:#{session_created}:#{session_attached}" | grep "^${sessionName}:"`
      );
      const [name, created, attached] = stdout.trim().split(':');
      return {
        name,
        created: new Date(parseInt(created) * 1000),
        attached: attached === '1'
      };
    } catch (error) {
      return null;
    }
  }
  
  static async killSession(sessionName) {
    try {
      await execAsync(`tmux kill-session -t ${sessionName}`);
      logger.info(`Killed tmux session: ${sessionName}`);
      return true;
    } catch (error) {
      if (error.message.includes("can't find session")) {
        logger.debug(`Tmux session already gone: ${sessionName}`);
        return true; // Session doesn't exist, which is what we wanted
      }
      logger.error(`Failed to kill tmux session: ${error.message}`);
      return false;
    }
  }
  
  static async sendTmuxCommand(sessionName, command) {
    try {
      logger.info(`Sending tmux command sequence to ${sessionName}: ${command}`);
      
      // Method 1: Try sending all keys in one command (most reliable)
      try {
        await execAsync(`tmux send-keys -t ${sessionName} 'C-b' ':' '${command}' 'Enter'`);
        logger.info(`Successfully sent tmux command sequence to ${sessionName}`);
        return true;
      } catch (error) {
        logger.warn(`Single command failed, trying step-by-step approach: ${error.message}`);
      }
      
      // Method 2: Step-by-step with delays (fallback)
      // Send Ctrl+B (tmux prefix key)
      await execAsync(`tmux send-keys -t ${sessionName} 'C-b'`);
      
      // Small delay to ensure tmux processes the prefix key
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Send ':' to enter command mode
      await execAsync(`tmux send-keys -t ${sessionName} ':'`);
      
      // Small delay to ensure command mode is activated
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Send the actual command
      await execAsync(`tmux send-keys -t ${sessionName} '${command}'`);
      
      // Small delay before sending Enter
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Send Enter to execute
      await execAsync(`tmux send-keys -t ${sessionName} 'Enter'`);
      
      logger.info(`Successfully sent tmux command with delays to ${sessionName}: ${command}`);
      return true;
    } catch (error) {
      logger.error(`Failed to send tmux command to session: ${error.message}`);
      return false;
    }
  }
  
  // Terminal scrolling functions for copy mode
  static async enterCopyMode(sessionName) {
    try {
      await execAsync(`tmux copy-mode -t "${sessionName}"`);
      logger.info(`Entered copy mode for session: ${sessionName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to enter copy mode: ${error.message}`);
      return false;
    }
  }

  static async exitCopyMode(sessionName) {
    try {
      await execAsync(`tmux send-keys -t "${sessionName}" 'q'`);
      logger.info(`Exited copy mode for session: ${sessionName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to exit copy mode: ${error.message}`);
      return false;
    }
  }

  static async scrollUp(sessionName, lines = 'line') {
    try {
      let scrollCommand;
      switch(lines) {
        case 'line':
          scrollCommand = 'Up';
          break;
        case 'page':
          scrollCommand = 'PageUp';
          break;
        case 'halfpage':
          scrollCommand = 'C-u';
          break;
        default:
          // Custom number of lines, send multiple Up keys
          for(let i = 0; i < parseInt(lines); i++) {
            await execAsync(`tmux send-keys -t "${sessionName}" 'Up'`);
          }
          return true;
      }
      
      await execAsync(`tmux send-keys -t "${sessionName}" '${scrollCommand}'`);
      return true;
    } catch (error) {
      logger.error(`Failed to scroll up: ${error.message}`);
      return false;
    }
  }

  static async scrollDown(sessionName, lines = 'line') {
    try {
      let scrollCommand;
      switch(lines) {
        case 'line':
          scrollCommand = 'Down';
          break;
        case 'page':
          scrollCommand = 'PageDown';
          break;
        case 'halfpage':
          scrollCommand = 'C-d';
          break;
        default:
          // Custom number of lines, send multiple Down keys
          for(let i = 0; i < parseInt(lines); i++) {
            await execAsync(`tmux send-keys -t "${sessionName}" 'Down'`);
          }
          return true;
      }
      
      await execAsync(`tmux send-keys -t "${sessionName}" '${scrollCommand}'`);
      return true;
    } catch (error) {
      logger.error(`Failed to scroll down: ${error.message}`);
      return false;
    }
  }

  // Check if session is in copy mode
  static async isInCopyMode(sessionName) {
    try {
      const { stdout } = await execAsync(`tmux display-message -t "${sessionName}" -p '#{pane_in_mode}'`);
      return stdout.trim() === '1';
    } catch (error) {
      logger.error(`Failed to check copy mode status: ${error.message}`);
      return false;
    }
  }

  // Enhanced method: intelligently manage copy mode and scroll with better down scrolling support
  static async scrollInCopyMode(sessionName, direction, lines = 'line') {
    try {
      // Check if already in copy mode to avoid unnecessary mode entry
      const alreadyInCopyMode = await this.isInCopyMode(sessionName);
      
      if (!alreadyInCopyMode) {
        await this.enterCopyMode(sessionName);
        // Longer delay to ensure copy mode is fully active
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // Execute scroll based on direction - use same simple logic for both directions
      if (direction === 'up') {
        await this.scrollUp(sessionName, lines);
      } else {
        await this.scrollDown(sessionName, lines);
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to scroll in copy mode: ${error.message}`);
      return false;
    }
  }


  // Go to bottom in copy mode and exit
  static async goToBottomAndExit(sessionName) {
    try {
      // Send Shift+G to jump to bottom in copy mode
      await execAsync(`tmux send-keys -t "${sessionName}" 'S-g'`);
      logger.info(`Jumped to bottom in copy mode for session: ${sessionName}`);
      
      // Small delay to ensure the jump is processed
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Exit copy mode
      await this.exitCopyMode(sessionName);
      
      return true;
    } catch (error) {
      logger.error(`Failed to go to bottom and exit copy mode: ${error.message}`);
      return false;
    }
  }
  
  static async getTTYdClients(maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Find TTYd process with multiple possible names
        let ttydPid = null;
        const possibleNames = ['ttyd.aarch64', 'ttyd'];
        
        for (const name of possibleNames) {
          try {
            const { stdout: ttydProcess } = await execAsync(`pgrep -f "${name}"`);
            if (ttydProcess.trim()) {
              ttydPid = ttydProcess.trim().split('\n')[0]; // Get first PID if multiple
              break;
            }
          } catch (e) {
            // Continue to next name
          }
        }
        
        if (!ttydPid) {
          if (attempt < maxRetries - 1) {
            logger.warn(`TTYd process not found, retrying in ${(attempt + 1) * 500}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
            continue;
          }
          logger.warn('TTYd process not found after all retries');
          return [];
        }
        
        // Find tmux client processes under TTYd with improved detection
        let clientPids = '';
        try {
          // Method 1: Direct child processes
          const { stdout: directChildren } = await execAsync(`pgrep -P ${ttydPid}`);
          if (directChildren.trim()) {
            // Check if any are tmux processes
            const { stdout: tmuxClients } = await execAsync(
              `echo "${directChildren.trim()}" | xargs -I {} sh -c 'ps -p {} -o comm= 2>/dev/null | grep -q "tmux" && echo {}'`
            );
            clientPids = tmuxClients;
          }
        } catch (e) {
          // Method 2: Search for tmux processes with TTYd as ancestor
          try {
            const { stdout: allTmux } = await execAsync(`pgrep tmux`);
            for (const pid of allTmux.trim().split('\n').filter(Boolean)) {
              try {
                const { stdout: parent } = await execAsync(`ps -o ppid= -p ${pid}`);
                if (parent.trim() === ttydPid) {
                  clientPids += pid + '\n';
                }
              } catch (e) {
                // Skip this PID
              }
            }
          } catch (e) {
            logger.warn('Failed to find tmux clients using fallback method');
          }
        }
        
        if (!clientPids.trim()) {
          if (attempt < maxRetries - 1) {
            logger.warn(`No tmux client found under TTYd, retrying in ${(attempt + 1) * 500}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
            continue;
          }
          logger.warn('No tmux client found under TTYd after all retries');
          return [];
        }
        
        const clients = [];
        const pids = clientPids.trim().split('\n').filter(Boolean);
        
        for (const clientPid of pids) {
          try {
            // Get the pts connected to this client with multiple methods
            let ptsPath = null;
            
            // Method 1: lsof
            try {
              const { stdout: lsofOutput } = await execAsync(`lsof -p ${clientPid} 2>/dev/null | grep pts`);
              const ptsMatch = lsofOutput.match(/\/dev\/pts\/(\d+)/);
              if (ptsMatch) {
                ptsPath = `/dev/pts/${ptsMatch[1]}`;
              }
            } catch (e) {
              // Method 2: /proc filesystem
              try {
                const { stdout: fdLinks } = await execAsync(`ls -la /proc/${clientPid}/fd/ 2>/dev/null | grep pts`);
                const ptsMatch = fdLinks.match(/\/dev\/pts\/(\d+)/);
                if (ptsMatch) {
                  ptsPath = `/dev/pts/${ptsMatch[1]}`;
                }
              } catch (e2) {
                logger.warn(`Failed to get pts for client ${clientPid} using both methods`);
              }
            }
            
            if (ptsPath && !clients.includes(ptsPath)) {
              clients.push(ptsPath);
            }
          } catch (error) {
            logger.warn(`Failed to process client ${clientPid}: ${error.message}`);
          }
        }
        
        if (clients.length > 0) {
          logger.info(`Found TTYd clients: ${clients.join(', ')} (attempt ${attempt + 1})`);
          return clients;
        } else if (attempt < maxRetries - 1) {
          logger.warn(`No valid pts found, retrying in ${(attempt + 1) * 500}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
        }
      } catch (error) {
        if (attempt < maxRetries - 1) {
          logger.warn(`Error finding TTYd clients, retrying in ${(attempt + 1) * 500}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
        } else {
          logger.error(`Failed to get TTYd clients after ${maxRetries} attempts: ${error.message}`);
        }
      }
    }
    return [];
  }

  // Verify which session a client is currently attached to
  static async getCurrentSession(clientPath) {
    try {
      // Get the session name that this client is attached to
      const { stdout } = await execAsync(`tmux display-message -c ${clientPath} -p '#S'`);
      return stdout.trim();
    } catch (error) {
      logger.debug(`Failed to get current session for ${clientPath}: ${error.message}`);
      return null;
    }
  }

  // Verify that the session switch was successful
  static async verifySessionSwitch(clientPath, targetSession, maxWaitMs = 3000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const currentSession = await this.getCurrentSession(clientPath);
      if (currentSession === targetSession) {
        return true;
      }
      
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return false;
  }

  static async switchToSession(sessionName, currentSessionName = null, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // First check if target session exists
        const exists = await this.hasSession(sessionName);
        if (!exists) {
          logger.warn(`Target session ${sessionName} does not exist`);
          return false;
        }
        
        // Get all TTYd client paths with retries
        const ttydClients = await this.getTTYdClients(3);
        if (ttydClients.length === 0) {
          if (attempt < maxRetries - 1) {
            logger.warn(`Cannot find any TTYd clients, retrying attempt ${attempt + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
            continue;
          }
          logger.warn('Cannot find any TTYd clients after all retries');
          return false;
        }
        
        logger.info(`Attempting to switch TTYd clients ${ttydClients.join(', ')} to ${sessionName} (attempt ${attempt + 1})`);
        
        let overallSuccess = false;
        
        // Try to switch all clients
        for (const ttydClient of ttydClients) {
          let clientSuccess = false;
          
          // Check current session before switching
          const currentSession = await this.getCurrentSession(ttydClient);
          if (currentSession === sessionName) {
            logger.info(`Client ${ttydClient} already on session ${sessionName}`);
            clientSuccess = true;
            overallSuccess = true;
            continue;
          }
          
          logger.info(`Switching client ${ttydClient} from '${currentSession}' to '${sessionName}'`);
          
          // Method 1: Direct tmux command with specific client
          try {
            await execAsync(`tmux switch-client -c ${ttydClient} -t ${sessionName}`);
            
            // Verify the switch worked
            const verified = await this.verifySessionSwitch(ttydClient, sessionName, 2000);
            if (verified) {
              // Clear screen after successful switch
              await execAsync(`tmux send-keys -c ${ttydClient} 'C-l'`);
              logger.info(`Successfully switched TTYd client ${ttydClient} to ${sessionName} (verified)`);
              clientSuccess = true;
              overallSuccess = true;
            } else {
              logger.warn(`Direct switch command executed but verification failed for ${ttydClient}`);
            }
          } catch (error) {
            logger.warn(`Direct client switch failed for ${ttydClient}: ${error.message}`);
          }
          
          // Method 2: Send keys to the specific client (if Method 1 failed)
          if (!clientSuccess) {
            try {
              const switchCommand = `switch-client -t ${sessionName}`;
              logger.info(`Trying send-keys method for ${ttydClient}: Ctrl+B : ${switchCommand}`);
              
              // Send Ctrl+B prefix
              await execAsync(`tmux send-keys -c ${ttydClient} 'C-b'`);
              await new Promise(resolve => setTimeout(resolve, 150));
              
              // Send : for command mode
              await execAsync(`tmux send-keys -c ${ttydClient} ':'`);
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Send the switch command
              await execAsync(`tmux send-keys -c ${ttydClient} '${switchCommand}'`);
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Send Enter to execute
              await execAsync(`tmux send-keys -c ${ttydClient} 'Enter'`);
              
              // Verify the switch worked
              const verified = await this.verifySessionSwitch(ttydClient, sessionName, 3000);
              if (verified) {
                // Clear screen after successful switch
                await new Promise(resolve => setTimeout(resolve, 300));
                await execAsync(`tmux send-keys -c ${ttydClient} 'C-l'`);
                logger.info(`Successfully switched TTYd client ${ttydClient} to ${sessionName} via send-keys (verified)`);
                clientSuccess = true;
                overallSuccess = true;
              } else {
                logger.error(`Send-keys method failed verification for ${ttydClient}`);
              }
            } catch (sendKeysError) {
              logger.error(`Send-keys method failed for ${ttydClient}: ${sendKeysError.message}`);
            }
          }
          
          if (!clientSuccess) {
            logger.error(`All methods failed for client ${ttydClient}`);
          }
        }
        
        if (overallSuccess) {
          logger.info(`Successfully switched at least one client to ${sessionName}`);
          return true;
        } else if (attempt < maxRetries - 1) {
          logger.warn(`All clients failed to switch, retrying attempt ${attempt + 2}/${maxRetries} in ${(attempt + 1) * 1000}ms`);
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
        }
        
      } catch (error) {
        if (attempt < maxRetries - 1) {
          logger.warn(`Error in switch attempt ${attempt + 1}, retrying: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
        } else {
          logger.error(`Failed to switch to session after ${maxRetries} attempts: ${error.message}`);
        }
      }
    }
    
    return false;
  }

  // Check if any TTYd client is currently on base-session
  static async isAnyClientOnBaseSession() {
    try {
      const ttydClients = await this.getTTYdClients(1); // Quick check, no retries
      
      for (const client of ttydClients) {
        const currentSession = await this.getCurrentSession(client);
        if (currentSession === 'base-session') {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.debug(`Error checking base-session status: ${error.message}`);
      return false; // Assume not on base-session if check fails
    }
  }
  
  static async capturePane(sessionName, includeHistory = true) {
    try {
      // Capture with history buffer for full terminal content
      // -S - : Start from beginning of history buffer
      // -e : Include escape sequences for proper formatting
      // -p : Print to stdout
      const captureCmd = includeHistory 
        ? `tmux capture-pane -t ${sessionName} -e -p -S -`
        : `tmux capture-pane -t ${sessionName} -e -p`;
      
      const { stdout } = await execAsync(captureCmd);
      
      if (!stdout || !stdout.trim()) {
        logger.debug(`No content captured for ${sessionName}`);
        return '';
      }
      
      // Remove excessive trailing newlines but keep the structure
      const trimmed = stdout.replace(/\n{3,}$/, '\n');
      
      logger.debug(`Captured pane content for ${sessionName}:`, {
        originalLength: stdout.length,
        trimmedLength: trimmed.length,
        includeHistory,
        hasEscapeSequences: /\x1b\[/.test(trimmed),
        preview: trimmed.substring(0, 200).replace(/\x1b\[[0-9;]*[mGKHFJST]/g, '<ESC>').replace(/\r?\n/g, '\\n')
      });
      
      return trimmed;
    } catch (error) {
      logger.error(`Failed to capture tmux pane: ${error.message}`);
      return '';
    }
  }
  
  static async getCursorPosition(sessionName) {
    try {
      // Get exact cursor position using tmux built-in variables
      const { stdout } = await execAsync(`tmux display-message -t ${sessionName} -p -F '#{cursor_x} #{cursor_y}'`);
      const positions = stdout.trim().split(' ');
      
      if (positions.length === 2) {
        const cursorX = parseInt(positions[0], 10);
        const cursorY = parseInt(positions[1], 10);
        
        logger.debug(`Got cursor position for ${sessionName}: x=${cursorX}, y=${cursorY}`);
        return { cursorX, cursorY };
      }
      
      logger.warn(`Invalid cursor position format for ${sessionName}: ${stdout}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get cursor position for ${sessionName}: ${error.message}`);
      return null;
    }
  }
  
  static async disableStatusBar(sessionName) {
    try {
      // Disable tmux status bar to prevent delayed appearance in web terminal
      await execAsync(`tmux set-option -t ${sessionName} status off`);
      logger.debug(`Disabled status bar for session: ${sessionName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to disable status bar for ${sessionName}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = TmuxUtils;