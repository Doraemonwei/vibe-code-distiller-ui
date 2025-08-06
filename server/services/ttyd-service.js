const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs-extra');
const path = require('path');
const config = require('config');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

class TTYdService {
    constructor() {
        this.process = null;
        this.pid = null;
        this.isStarting = false;
        this.isStopping = false;
        
        // Hardcoded static configuration
        this.staticConfig = {
            executable: "./ttyd.aarch64",
            baseCommand: "tmux new-session -A -s base-session",
            arguments: [
                "-W", 
                "-t", "disableLeaveAlert=true",
                "-t", "disableReconnect=true",
                "-t", "macOptionIsMeta=true",
                "-t", "macOptionClickForcesSelection=true"
            ]
        };
        
        // Dynamic configuration from config file (mutable, user settings)
        const ttydConfig = config.get('ttyd');
        this.dynamicConfig = {
            fontSize: ttydConfig.fontSize || 15,
            port: ttydConfig.port || 7681,
            theme: ttydConfig.theme || 'light'
        };
        
        this.startupTimeout = 10000; // 10 seconds
        this.shutdownTimeout = 5000; // 5 seconds
    }

    /**
     * Check if TTYd executable exists
     */
    async checkExecutable() {
        const executablePath = path.resolve(this.staticConfig.executable);
        try {
            const stats = await fs.stat(executablePath);
            if (!stats.isFile()) {
                throw new Error(`TTYd executable is not a file: ${executablePath}`);
            }
            
            // Check if executable
            try {
                await fs.access(executablePath, fs.constants.X_OK);
            } catch (error) {
                logger.warn(`TTYd executable may not have execute permissions: ${executablePath}`);
            }
            
            return executablePath;
        } catch (error) {
            throw new Error(`TTYd executable not found: ${executablePath}`);
        }
    }

    /**
     * Check if port is available
     */
    async isPortAvailable(port) {
        try {
            const { stdout } = await execAsync(`lsof -i :${port}`);
            return !stdout.trim();
        } catch (error) {
            // lsof returns non-zero exit code when no process is found, which means port is available
            return true;
        }
    }

    /**
     * Kill process using specific port
     */
    async killProcessOnPort(port) {
        try {
            const { stdout } = await execAsync(`lsof -ti :${port}`);
            const pids = stdout.trim().split('\n').filter(pid => pid.trim());
            
            for (const pid of pids) {
                logger.info(`Killing process ${pid} on port ${port}`);
                try {
                    await execAsync(`kill -9 ${pid}`);
                } catch (killError) {
                    logger.warn(`Failed to kill process ${pid}: ${killError.message}`);
                }
            }
            
            // Wait a moment for processes to die
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return true;
        } catch (error) {
            // No processes found on port
            return true;
        }
    }

    /**
     * Build TTYd command with current configuration
     */
    buildCommand() {
        const executablePath = path.resolve(this.staticConfig.executable);
        
        // Split base command into individual arguments
        const baseCommandArgs = this.staticConfig.baseCommand.split(' ').filter(arg => arg.trim());
        
        const args = [
            ...this.staticConfig.arguments,
            '-t', `fontSize=${this.dynamicConfig.fontSize}`,
            '-p', this.dynamicConfig.port.toString()
        ];

        // Add theme-specific arguments
        if (this.dynamicConfig.theme === 'light') {
            args.push('-t', 'theme={"background": "#f8f9fa", "foreground": "#2b2b2b", "cursor": "#adadad", "selectionBackground": "#0366d6"}');
        }
        // For dark theme, no additional theme arguments needed (default)

        args.push(...baseCommandArgs);  // Spread the command arguments
        
        return { executable: executablePath, args };
    }

    /**
     * Start TTYd service
     */
    async start() {
        if (this.process || this.isStarting) {
            logger.warn('TTYd service is already starting or running');
            return false;
        }

        this.isStarting = true;
        
        try {
            // Check executable
            const executablePath = await this.checkExecutable();
            
            // Check port availability
            const portAvailable = await this.isPortAvailable(this.dynamicConfig.port);
            if (!portAvailable) {
                logger.warn(`Port ${this.dynamicConfig.port} is occupied, attempting to clear it`);
                await this.killProcessOnPort(this.dynamicConfig.port);
                
                // Double check
                const stillOccupied = !(await this.isPortAvailable(this.dynamicConfig.port));
                if (stillOccupied) {
                    throw new Error(`Failed to clear port ${this.dynamicConfig.port}`);
                }
            }

            // Build command
            const { executable, args } = this.buildCommand();
            
            logger.info('Starting TTYd service', { 
                executable, 
                args, 
                port: this.dynamicConfig.port,
                fontSize: this.dynamicConfig.fontSize,
                theme: this.dynamicConfig.theme
            });

            // Start process
            this.process = spawn(executable, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
                cwd: process.cwd()
            });

            this.pid = this.process.pid;

            // Setup process event handlers
            this.process.stdout.on('data', (data) => {
                logger.debug(`TTYd stdout: ${data.toString().trim()}`);
            });

            this.process.stderr.on('data', (data) => {
                const message = data.toString().trim();
                if (message.includes('listening on') || message.includes('started')) {
                    logger.info(`TTYd: ${message}`);
                } else {
                    logger.warn(`TTYd stderr: ${message}`);
                }
            });

            this.process.on('error', (error) => {
                logger.error('TTYd process error:', error);
                this.process = null;
                this.pid = null;
            });

            this.process.on('exit', (code, signal) => {
                logger.info('TTYd process exited', { code, signal, pid: this.pid });
                this.process = null;
                this.pid = null;
            });

            // Wait for startup
            const started = await this.waitForStartup();
            if (!started) {
                throw new Error('TTYd failed to start within timeout');
            }

            logger.info('TTYd service started successfully', { 
                pid: this.pid, 
                port: this.dynamicConfig.port 
            });
            
            return true;

        } catch (error) {
            logger.error('Failed to start TTYd service:', error);
            
            // Cleanup on failure
            if (this.process) {
                try {
                    this.process.kill('SIGKILL');
                } catch (killError) {
                    logger.error('Failed to cleanup failed TTYd process:', killError);
                }
                this.process = null;
                this.pid = null;
            }
            
            throw error;
        } finally {
            this.isStarting = false;
        }
    }

    /**
     * Wait for TTYd to start listening
     */
    async waitForStartup() {
        const startTime = Date.now();
        
        while (Date.now() - startTime < this.startupTimeout) {
            try {
                // Check if process is still running
                if (!this.process || this.process.killed) {
                    return false;
                }

                // Check if port is now occupied (by our process)
                const portOccupied = !(await this.isPortAvailable(this.dynamicConfig.port));
                if (portOccupied) {
                    // Additional check: try to connect to the service
                    try {
                        const { stdout } = await execAsync(`curl -f http://localhost:${this.dynamicConfig.port} --max-time 2 -s -o /dev/null`);
                        return true;
                    } catch (curlError) {
                        // Port occupied but service not responding yet, wait a bit more
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                logger.debug('Startup check error:', error.message);
            }
        }
        
        return false;
    }

    /**
     * Stop TTYd service
     */
    async stop() {
        if (!this.process || this.isStopping) {
            logger.info('TTYd service is not running or already stopping');
            return true;
        }

        this.isStopping = true;
        
        try {
            logger.info('Stopping TTYd service', { pid: this.pid });

            // Try graceful termination first
            this.process.kill('SIGTERM');
            
            // Wait for graceful shutdown
            const stopped = await this.waitForShutdown();
            
            if (!stopped) {
                logger.warn('TTYd did not stop gracefully, forcing termination');
                this.process.kill('SIGKILL');
                
                // Wait a bit more for force kill
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            this.process = null;
            this.pid = null;
            
            logger.info('TTYd service stopped');
            return true;

        } catch (error) {
            logger.error('Error stopping TTYd service:', error);
            
            // Force cleanup
            this.process = null;
            this.pid = null;
            
            return false;
        } finally {
            this.isStopping = false;
        }
    }

    /**
     * Wait for TTYd to shutdown
     */
    async waitForShutdown() {
        const startTime = Date.now();
        
        while (Date.now() - startTime < this.shutdownTimeout) {
            if (!this.process || this.process.killed) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        return false;
    }

    /**
     * Restart TTYd service
     */
    async restart() {
        logger.info('Restarting TTYd service');
        
        await this.stop();
        
        // Wait a moment between stop and start
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return await this.start();
    }

    /**
     * Get TTYd service status
     */
    getStatus() {
        return {
            isRunning: !!this.process && !this.process.killed,
            pid: this.pid,
            port: this.dynamicConfig.port,
            fontSize: this.dynamicConfig.fontSize,
            theme: this.dynamicConfig.theme,
            isStarting: this.isStarting,
            isStopping: this.isStopping
        };
    }

    /**
     * Get static configuration
     */
    getStaticConfig() {
        return { ...this.staticConfig };
    }

    /**
     * Update configuration and restart if necessary
     */
    async updateConfig(newConfig) {
        const oldDynamicConfig = { ...this.dynamicConfig };
        
        // Update only dynamic configuration (never touch static config)
        if (newConfig.fontSize !== undefined) {
            this.dynamicConfig.fontSize = newConfig.fontSize;
            logger.info('Updated TTYd fontSize configuration', { 
                old: oldDynamicConfig.fontSize, 
                new: this.dynamicConfig.fontSize 
            });
        }
        
        if (newConfig.port !== undefined) {
            this.dynamicConfig.port = newConfig.port;
            logger.info('Updated TTYd port configuration', { 
                old: oldDynamicConfig.port, 
                new: this.dynamicConfig.port 
            });
        }

        if (newConfig.theme !== undefined) {
            this.dynamicConfig.theme = newConfig.theme;
            logger.info('Updated TTYd theme configuration', { 
                old: oldDynamicConfig.theme, 
                new: this.dynamicConfig.theme 
            });
        }
        
        // Check if restart is needed
        const needsRestart = (
            oldDynamicConfig.port !== this.dynamicConfig.port ||
            oldDynamicConfig.fontSize !== this.dynamicConfig.fontSize ||
            oldDynamicConfig.theme !== this.dynamicConfig.theme
        );

        if (needsRestart && this.process) {
            logger.info('Dynamic configuration changed, restarting TTYd service');
            return await this.restart();
        }
        
        return true;
    }

    /**
     * Cleanup on application shutdown
     */
    async cleanup() {
        if (this.process) {
            logger.info('Cleaning up TTYd service on application shutdown');
            await this.stop();
        }
    }
}

// Create singleton instance
const ttydService = new TTYdService();

module.exports = ttydService;