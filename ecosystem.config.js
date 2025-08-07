module.exports = {
  apps: [{
    name: 'claude-code-web-manager',
    script: 'server/app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      PORT: 3000,
      NODE_ENV: 'development',
      NODE_CONFIG_STRICT_MODE: 'false'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    exec_mode: 'fork',
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    kill_timeout: 5000,
    
    // Raspberry Pi specific optimizations
    node_args: [
      '--max-old-space-size=128',
      '--optimize-for-size'
    ],
    
    // Monitoring
    monitoring: false,
    pmx: false
  }]
};