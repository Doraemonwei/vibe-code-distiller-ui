#!/bin/bash
# restart.sh

# Check for port parameter
if [ -z "$1" ]; then
    echo "Error: Port number required"
    echo "Usage: $0 <port_number>"
    exit 1
fi

CURRENT_PORT=$1

# Clear restart.log history
> restart.log

# Log function to output both to terminal and log file
log_message() {
    echo "$1" | tee -a restart.log
}

echo "Restart initiated on port $CURRENT_PORT"

# Run restart in background
{
    log_message "[$(date)] Restarting on port $CURRENT_PORT..."
    
    # Wait for response to be sent
    sleep 2
    
    # Kill process using the port
    lsof -ti:$CURRENT_PORT | xargs kill -9 2>/dev/null || true
    
    # Wait for port to be freed
    sleep 3
    
    # Restart WebUI on same port
    PORT=$CURRENT_PORT npm start >> restart.log 2>&1 &
    SERVICE_PID=$!
    
    log_message "[$(date)] WebUI restarted successfully with PID: $SERVICE_PID"
}
