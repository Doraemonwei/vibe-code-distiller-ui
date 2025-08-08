const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const config = require('config');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

class CodeServerService {
    constructor() {
        this.process = null;
        this.pid = null;
        this.isStarting = false;
        this.isStopping = false;
        
        // Get configuration from config file
        const vscodeConfig = config.get('vscode');
        this.config = {
            port: vscodeConfig.port || 8081,
            password: vscodeConfig.password,
            executable: 'code-server'
        };
        
        this.actualPort = null; // Track the actual port code-server starts on
        this.startupTimeout = 15000; // 15 seconds
        this.shutdownTimeout = 5000; // 5 seconds
    }

    /**
     * Check if code-server executable exists
     */
    async checkExecutable() {
        try {
            await execAsync(`which ${this.config.executable}`);
            return true;
        } catch (error) {
            return false;
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
     * Kill process using specific port (simplified version from ttyd-service)
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
     * Build code-server command with current configuration
     */
    buildCommand() {
        const args = [
            '--bind-addr', `0.0.0.0:${this.config.port}`,
            '--disable-update-check',
            '--disable-workspace-trust', // Disable workspace trust for better compatibility
            '--verbose' // Enable verbose logging for debugging
        ];

        let env = { ...process.env };
        
        // Override PORT environment variable to ensure code-server uses our specified port
        // This prevents conflicts when main app is started with PORT=8080
        env.PORT = this.config.port.toString();
        
        // Configure authentication based on password setting
        if (this.config.password === null || this.config.password === undefined || this.config.password === '') {
            args.push('--auth', 'none', '--disable-telemetry');
        } else {
            args.push('--auth', 'password');
            env.PASSWORD = '19981008'; // Set the password as specified
        }
        
        return { 
            executable: this.config.executable, 
            args,
            env
        };
    }

    /**
     * Start code-server service
     */
    async start() {
        if (this.process || this.isStarting) {
            logger.warn('Code-server service is already starting or running');
            return false;
        }

        this.isStarting = true;
        
        try {
            // Check if code-server executable exists
            const executableExists = await this.checkExecutable();
            if (!executableExists) {
                const installMessage = 'code-server not found. Please install it by running:\n  curl -fsSL https://code-server.dev/install.sh | sh';
                logger.error(installMessage);
                console.error(`\n❌ ${installMessage}\n`);
                process.exit(1);
            }
            
            // Check port availability (simplified like ttyd-service)
            const portAvailable = await this.isPortAvailable(this.config.port);
            if (!portAvailable) {
                logger.warn(`Port ${this.config.port} is occupied, attempting to clear it`);
                await this.killProcessOnPort(this.config.port);
                
                // Double check
                const stillOccupied = !(await this.isPortAvailable(this.config.port));
                if (stillOccupied) {
                    throw new Error(`Failed to clear port ${this.config.port}`);
                }
            }

            // Build command
            const { executable, args, env } = this.buildCommand();
            
            logger.info('Starting code-server service', { 
                executable, 
                args, 
                port: this.config.port,
                authMode: this.config.password ? 'password' : 'none'
            });

            // Start process
            this.process = spawn(executable, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
                cwd: process.cwd(),
                env
            });

            this.pid = this.process.pid;
            this.actualPort = this.config.port; // Initialize with configured port
            
            // Setup process event handlers
            this.process.stdout.on('data', (data) => {
                const message = data.toString().trim();
                logger.debug(`Code-server stdout: ${message}`);
                
                // Extract actual port from HTTP server listening message
                const httpMatch = message.match(/HTTP server listening on http:\/\/[^:]+:(\d+)/);
                if (httpMatch) {
                    this.actualPort = parseInt(httpMatch[1]);
                    if (this.actualPort !== this.config.port) {
                        logger.warn(`Code-server started on port ${this.actualPort} instead of configured port ${this.config.port}`);
                        this.config.port = this.actualPort; // Update config to match reality
                    }
                    logger.info(`Code-server: ${message}`);
                }
                
                // Log other important startup messages
                if (message.includes('Session server listening on')) {
                    logger.info(`Code-server: ${message}`);
                }
            });

            this.process.stderr.on('data', (data) => {
                const message = data.toString().trim();
                
                // Extract actual port from stderr HTTP server listening message
                const httpMatch = message.match(/HTTP server listening on http:\/\/[^:]+:(\d+)/);
                if (httpMatch) {
                    this.actualPort = parseInt(httpMatch[1]);
                    if (this.actualPort !== this.config.port) {
                        logger.warn(`Code-server started on port ${this.actualPort} instead of configured port ${this.config.port}`);
                        this.config.port = this.actualPort; // Update config to match reality
                    }
                    logger.info(`Code-server: ${message}`);
                } else if (message.includes('Session server listening on')) {
                    logger.info(`Code-server: ${message}`);
                } else if (message.includes('Using config file')) {
                    logger.debug(`Code-server: ${message}`);
                } else {
                    logger.warn(`Code-server stderr: ${message}`);
                }
            });

            this.process.on('error', (error) => {
                logger.error('Code-server process error:', error);
                this.process = null;
                this.pid = null;
                this.actualPort = null; // Reset actual port
            });

            this.process.on('exit', (code, signal) => {
                logger.info('Code-server process exited', { code, signal, pid: this.pid });
                this.process = null;
                this.pid = null;
                this.actualPort = null; // Reset actual port
            });

            // Wait for startup
            const started = await this.waitForStartup();
            if (!started) {
                throw new Error('Code-server failed to start within timeout');
            }

            logger.info('Code-server service started successfully', { 
                pid: this.pid, 
                port: this.config.port,
                authMode: this.config.password ? 'password' : 'none'
            });
            
            return true;

        } catch (error) {
            logger.error('Failed to start code-server service:', error);
            
            // Cleanup on failure
            if (this.process) {
                try {
                    this.process.kill('SIGKILL');
                } catch (killError) {
                    logger.error('Failed to cleanup failed code-server process:', killError);
                }
                this.process = null;
                this.pid = null;
                this.actualPort = null; // Reset actual port
            }
            
            throw error;
        } finally {
            this.isStarting = false;
        }
    }

    /**
     * Wait for code-server to start listening (simplified like ttyd-service)
     */
    async waitForStartup() {
        const startTime = Date.now();
        
        while (Date.now() - startTime < this.startupTimeout) {
            try {
                // Check if process is still running
                if (!this.process || this.process.killed) {
                    return false;
                }

                // Check the port (use actualPort if detected, otherwise configured port)
                const portToCheck = this.actualPort || this.config.port;
                const portOccupied = !(await this.isPortAvailable(portToCheck));
                if (portOccupied) {
                    // Additional check: try to connect to the service
                    try {
                        const { stdout } = await execAsync(`curl -f http://localhost:${portToCheck} --max-time 2 -s -o /dev/null`);
                        return true;
                    } catch (curlError) {
                        // Port occupied but service not responding yet, wait a bit more
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                logger.debug('Code-server startup check error:', error.message);
            }
        }
        
        return false;
    }

    /**
     * Stop code-server service
     */
    async stop() {
        if (!this.process || this.isStopping) {
            logger.info('Code-server service is not running or already stopping');
            return true;
        }

        this.isStopping = true;
        
        try {
            logger.info('Stopping code-server service', { pid: this.pid });

            // Try graceful termination first
            this.process.kill('SIGTERM');
            
            // Wait for graceful shutdown
            const stopped = await this.waitForShutdown();
            
            if (!stopped) {
                logger.warn('Code-server did not stop gracefully, forcing termination');
                this.process.kill('SIGKILL');
                
                // Wait a bit more for force kill
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            this.process = null;
            this.pid = null;
            this.actualPort = null; // Reset actual port
            
            logger.info('Code-server service stopped');
            return true;

        } catch (error) {
            logger.error('Error stopping code-server service:', error);
            
            // Force cleanup
            this.process = null;
            this.pid = null;
            this.actualPort = null; // Reset actual port
            
            return false;
        } finally {
            this.isStopping = false;
        }
    }

    /**
     * Wait for code-server to shutdown
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
     * Restart code-server service
     */
    async restart() {
        logger.info('Restarting code-server service');
        
        await this.stop();
        
        // Wait a moment between stop and start
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return await this.start();
    }

    /**
     * Get code-server service status
     */
    getStatus() {
        return {
            isRunning: !!this.process && !this.process.killed,
            pid: this.pid,
            port: this.actualPort || this.config.port, // Return actual port if available, otherwise configured port
            configuredPort: this.config.port, // Always show the originally configured port
            actualPort: this.actualPort, // Show the actual detected port
            authMode: this.config.password ? 'password' : 'none',
            isStarting: this.isStarting,
            isStopping: this.isStopping
        };
    }

    /**
     * Update configuration and restart if necessary
     */
    async updateConfig(newConfig) {
        const oldConfig = { ...this.config };
        
        if (newConfig.port !== undefined) {
            this.config.port = newConfig.port;
            logger.info('Updated code-server port configuration', { 
                old: oldConfig.port, 
                new: this.config.port 
            });
        }
        
        if (newConfig.password !== undefined) {
            this.config.password = newConfig.password;
            logger.info('Updated code-server password configuration');
        }
        
        // Check if restart is needed
        const needsRestart = (
            oldConfig.port !== this.config.port ||
            oldConfig.password !== this.config.password
        );

        if (needsRestart && this.process) {
            logger.info('Configuration changed, restarting code-server service');
            return await this.restart();
        }
        
        return true;
    }

    /**
     * Cleanup on application shutdown
     */
    async cleanup() {
        if (this.process) {
            logger.info('Cleaning up code-server service on application shutdown');
            await this.stop();
        }
    }
}

// Create singleton instance
const codeServerService = new CodeServerService();

module.exports = codeServerService;