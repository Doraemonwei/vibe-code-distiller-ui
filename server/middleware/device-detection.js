const UAParser = require('ua-parser-js');
const logger = require('../utils/logger');

/**
 * Device Detection Middleware
 * Detects device type (mobile, tablet, desktop) based on user-agent
 * Sets req.deviceType and req.isMobile properties
 */
function deviceDetection(req, res, next) {
    try {
        const userAgent = req.get('User-Agent') || '';
        const parser = new UAParser(userAgent);
        const result = parser.getResult();
        
        // Determine device type
        const deviceType = result.device.type || 'desktop';
        const isMobile = deviceType === 'mobile';
        const isTablet = deviceType === 'tablet';
        
        // Add device info to request
        req.deviceInfo = {
            type: deviceType,
            isMobile: isMobile,
            isTablet: isTablet,
            isDesktop: !isMobile && !isTablet,
            browser: result.browser.name,
            os: result.os.name,
            userAgent: userAgent
        };
        
        // Backward compatibility
        req.deviceType = deviceType;
        req.isMobile = isMobile;
        
        // Log device detection for debugging
        logger.debug(`Device detected: ${deviceType} - ${result.browser.name} on ${result.os.name}`);
        
        next();
    } catch (error) {
        logger.error('Device detection error:', error);
        
        // Fallback: assume desktop if detection fails
        req.deviceInfo = {
            type: 'desktop',
            isMobile: false,
            isTablet: false,
            isDesktop: true,
            browser: 'unknown',
            os: 'unknown',
            userAgent: req.get('User-Agent') || ''
        };
        req.deviceType = 'desktop';
        req.isMobile = false;
        
        next();
    }
}

module.exports = deviceDetection;