#!/bin/bash

# Complete Installation Script for Claude Code Web Manager
# This script installs all dependencies and sets up the systemd service

set -e  # Exit on any error

echo "=========================================="
echo "🔧 Claude Code Web Manager Complete Setup"
echo "=========================================="

# Check if running as root/sudo
if [ "$EUID" -ne 0 ]; then
    echo "❌ This script must be run with sudo"
    echo "Usage: sudo ./install-complete.sh"
    exit 1
fi

# Get current user and paths
CURRENT_USER="${SUDO_USER:-$USER}"
SERVICE_NAME="claude-code-ui"
SERVICE_FILE="${SERVICE_NAME}.service"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

echo "Installing for user: ${CURRENT_USER}"
echo "Working directory: ${SCRIPT_DIR}"

# Step 1: Install system dependencies
echo ""
echo "📦 Installing system dependencies..."
apt update -qq
apt install -y lsof curl wget tmux

echo "✅ System dependencies installed successfully!"

# Download TTYd binary if not present
TTYD_BINARY="${SCRIPT_DIR}/ttyd.aarch64"
if [ -f "$TTYD_BINARY" ]; then
    echo "✅ TTYd binary already exists: $TTYD_BINARY"
else
    echo "📥 Downloading TTYd binary for ARM64..."
    
    # Download TTYd binary
    TTYD_URL="https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.aarch64"
    
    curl -L -o "$TTYD_BINARY" "$TTYD_URL"
    
    # Verify download and make executable
    if [ -f "$TTYD_BINARY" ]; then
        chmod +x "$TTYD_BINARY"
        chown ${CURRENT_USER}:${CURRENT_USER} "$TTYD_BINARY"
        echo "✅ TTYd binary downloaded successfully: $TTYD_BINARY"
    else
        echo "❌ Failed to download TTYd binary"
        exit 1
    fi
fi

# Step 2: Verify Node.js/NVM setup and get paths
echo ""
echo "🔍 Checking Node.js setup..."

# Find npm path - source NVM directly to avoid interactive shell issues
NPM_PATH=$(sudo -u ${CURRENT_USER} bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; which npm 2>/dev/null' 2>/dev/null || echo "")
NODE_PATH=$(sudo -u ${CURRENT_USER} bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; which node 2>/dev/null' 2>/dev/null || echo "")

if [ -z "${NPM_PATH}" ]; then
    echo "❌ Error: npm not found. Please install Node.js first."
    echo "Recommended: Install Node.js using NVM"
    exit 1
fi

echo "✅ Found npm at: ${NPM_PATH}"
echo "✅ Found node at: ${NODE_PATH}"

# Step 3: Install Node.js dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
cd "${SCRIPT_DIR}"

# Install missing dependencies
echo "Installing http-proxy-middleware..."
sudo -u ${CURRENT_USER} bash -c "export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \\. \"\$NVM_DIR/nvm.sh\"; npm install http-proxy-middleware"

echo "Installing other dependencies..."
sudo -u ${CURRENT_USER} bash -c "export NVM_DIR=\"\$HOME/.nvm\"; [ -s \"\$NVM_DIR/nvm.sh\" ] && \\. \"\$NVM_DIR/nvm.sh\"; npm install"

# Step 4: Clean and reinstall PM2
echo ""
echo "🔄 Setting up PM2..."

# Kill existing PM2 daemon if running
sudo -u ${CURRENT_USER} bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; pm2 kill 2>/dev/null || true' 2>/dev/null || true

# Remove old PM2 installation
sudo -u ${CURRENT_USER} bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; npm uninstall -g pm2 2>/dev/null || true' 2>/dev/null || true

# Clean PM2 data directory
sudo -u ${CURRENT_USER} rm -rf /home/${CURRENT_USER}/.pm2 2>/dev/null || true

# Install PM2 fresh
echo "Installing PM2..."
sudo -u ${CURRENT_USER} bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; npm install -g pm2'

# Verify PM2 installation
PM2_PATH=$(sudo -u ${CURRENT_USER} bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; which pm2 2>/dev/null' 2>/dev/null || echo "")
if [ -z "${PM2_PATH}" ]; then
    echo "❌ Error: PM2 installation failed"
    exit 1
fi
echo "✅ PM2 installed at: ${PM2_PATH}"

# Step 5: Create systemd service
echo ""
echo "⚙️  Creating systemd service..."

# Stop any existing service
systemctl stop ${SERVICE_NAME} 2>/dev/null || true
systemctl disable ${SERVICE_NAME} 2>/dev/null || true

# Remove old service file
rm -f /etc/systemd/system/${SERVICE_FILE}

# Get the npm directory for PATH
NPM_DIR=$(dirname "${NPM_PATH}")

# Create new service file
cat > "/etc/systemd/system/${SERVICE_FILE}" << EOF
[Unit]
Description=Claude Code Web Manager
Documentation=https://github.com/yourusername/claude-code-ui
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=${CURRENT_USER}
Group=${CURRENT_USER}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${NPM_PATH} run pm2:start
ExecReload=${NPM_PATH} run pm2:restart
ExecStop=${NPM_PATH} run pm2:stop
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
Environment="PATH=${NPM_DIR}:/usr/bin:/usr/local/bin"
Environment="PM2_HOME=/home/${CURRENT_USER}/.pm2"

[Install]
WantedBy=multi-user.target
EOF

# Step 6: Set up PM2 ecosystem config if not exists
echo ""
echo "📝 Setting up PM2 configuration..."

if [ ! -f "${SCRIPT_DIR}/ecosystem.config.js" ]; then
    cat > "${SCRIPT_DIR}/ecosystem.config.js" << EOF
module.exports = {
  apps: [{
    name: 'claude-code-web-manager',
    script: './server/app.js',
    cwd: '${SCRIPT_DIR}',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'development',
      NODE_CONFIG_STRICT_MODE: 'false',
      PORT: 3000
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '200M',
    node_args: '--max-old-space-size=128 --optimize-for-size'
  }]
};
EOF
    chown ${CURRENT_USER}:${CURRENT_USER} "${SCRIPT_DIR}/ecosystem.config.js"
fi

# Create logs directory
sudo -u ${CURRENT_USER} mkdir -p "${SCRIPT_DIR}/logs"

# Step 7: Enable and start the service
echo ""
echo "🚀 Starting service..."

# Reload systemd and enable service
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}

# Start the service
systemctl start ${SERVICE_NAME}

# Wait a moment for startup
sleep 3

# Check service status
if systemctl is-active --quiet ${SERVICE_NAME}; then
    echo ""
    echo "✅ Service installed and started successfully!"
    echo ""
    echo "📊 Service Status:"
    systemctl status ${SERVICE_NAME} --no-pager -l
    echo ""
    echo "🌐 Web interface should be available at:"
    echo "   http://localhost:3000"
    echo "   http://$(hostname -I | awk '{print $1}'):3000"
    echo ""
    echo "📋 Available commands:"
    echo "  sudo systemctl start ${SERVICE_NAME}     # Start the service"
    echo "  sudo systemctl stop ${SERVICE_NAME}      # Stop the service"  
    echo "  sudo systemctl restart ${SERVICE_NAME}   # Restart the service"
    echo "  sudo systemctl status ${SERVICE_NAME}    # Check service status"
    echo "  sudo journalctl -u ${SERVICE_NAME} -f   # View service logs"
    echo ""
else
    echo "❌ Service failed to start"
    echo "Check logs with: sudo journalctl -u ${SERVICE_NAME} -f"
    exit 1
fi

echo "=========================================="
echo "🎉 Installation Complete!"
echo "=========================================="
echo ""
echo "Dependencies installed/verified:"
echo "- System packages: lsof, curl, wget, tmux"
echo "- TTYd binary: ARM64 web-based terminal interface"
echo "- Node.js dependencies: All required packages"
echo "- PM2: Process manager"
echo "- Systemd service: Auto-start on boot"
echo ""
echo "Features enabled:"
echo "- Persistent terminal sessions"
echo "- Web-based terminal interface"
echo "- Auto-start on system boot"
echo "- Process management with PM2"