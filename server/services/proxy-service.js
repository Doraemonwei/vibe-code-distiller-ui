const { createProxyMiddleware } = require('http-proxy-middleware');
const logger = require('../utils/logger');
const ttydService = require('./ttyd-service');
const codeServerService = require('./code-server-service');

class ProxyService {
  constructor() {
    this.ttydProxy = null;
    this.codeServerProxy = null;
  }

  createTTYdProxy() {
    return (req, res, next) => {
      const ttydPort = ttydService.getStatus().port;
      const proxy = createProxyMiddleware({
        target: `http://localhost:${ttydPort}`,
        changeOrigin: true,
        pathRewrite: {
          '^/terminal': '',
        },
        ws: false,
        logLevel: 'silent',
        timeout: 30000,
        proxyTimeout: 30000,
        secure: false,
        onError: (err, req, res) => {
          logger.error('TTYd proxy error:', { error: err.message, url: req.url, method: req.method });
          if (!res.headersSent) {
            res.status(502).json({ error: 'Terminal service unavailable', details: err.message });
          }
        },
        onProxyRes: (proxyRes, req, res) => {
          delete proxyRes.headers['x-frame-options'];
          delete proxyRes.headers['content-security-policy'];
          delete proxyRes.headers['x-content-type-options'];
          logger.debug('TTYd proxy response:', { statusCode: proxyRes.statusCode, url: req.url });
        }
      });
      
      return proxy(req, res, next);
    };
  }

  createCodeServerProxy() {
    return (req, res, next) => {
      const codeServerPort = codeServerService.getStatus().port;
      const proxy = createProxyMiddleware({
        target: `http://127.0.0.1:${codeServerPort}`,
        changeOrigin: true,
        pathRewrite: {
          '^/vscode': '',
        },
        ws: false,
        logLevel: 'silent',
        timeout: 30000,
        proxyTimeout: 30000,
        secure: false,
        headers: {
          'Host': `127.0.0.1:${codeServerPort}`,
          'Origin': `http://127.0.0.1:${codeServerPort}`
        },
        onProxyReq: (proxyReq, req, res) => {
          proxyReq.setHeader('X-Forwarded-For', req.ip || req.connection.remoteAddress);
          proxyReq.setHeader('X-Forwarded-Proto', 'https');
          proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
        },
        onError: (err, req, res) => {
          logger.error('Code-server proxy error:', { 
            error: err.message, 
            url: req.url, 
            method: req.method,
            stack: err.stack 
          });
          if (!res.headersSent) {
            res.status(502).json({ error: 'Code-server service unavailable', details: err.message });
          }
        },
        onProxyRes: (proxyRes, req, res) => {
          delete proxyRes.headers['x-frame-options'];
          delete proxyRes.headers['content-security-policy'];
          delete proxyRes.headers['x-content-type-options'];
        }
      });
      
      return proxy(req, res, next);
    };
  }

  setupWebSocketUpgrade(server) {
    server.on('upgrade', (request, socket, head) => {
      const pathname = request.url;
      logger.debug('WebSocket upgrade request:', { pathname });
      
      if (pathname.startsWith('/terminal')) {
        logger.debug('Forwarding terminal WebSocket upgrade to ttyd');
        
        const ttydPort = ttydService.getStatus().port;
        const wsProxy = createProxyMiddleware({
          target: `http://localhost:${ttydPort}`,
          changeOrigin: true,
          pathRewrite: {
            '^/terminal': '',
          },
          ws: true,
          logLevel: 'silent'
        });
        
        wsProxy.upgrade(request, socket, head);
      } else if (pathname.startsWith('/vscode')) {
        logger.debug('Forwarding code-server WebSocket upgrade to code-server');
        
        const codeServerPort = codeServerService.getStatus().port;
        const wsProxy = createProxyMiddleware({
          target: `http://127.0.0.1:${codeServerPort}`,
          changeOrigin: true,
          pathRewrite: {
            '^/vscode': '',
          },
          ws: true,
          logLevel: 'silent',
          secure: false,
          headers: {
            'Host': `127.0.0.1:${codeServerPort}`,
            'Origin': `http://127.0.0.1:${codeServerPort}`
          },
          onError: (err, req, socket) => {
            logger.error('Code-server WebSocket proxy error:', { error: err.message, url: req.url });
            if (socket && !socket.destroyed) {
              socket.destroy();
            }
          }
        });
        
        wsProxy.upgrade(request, socket, head);
      } else if (pathname.startsWith('/socket.io/')) {
        logger.debug('Letting Socket.IO handle WebSocket upgrade for:', pathname);
      } else {
        logger.warn('Unknown WebSocket upgrade request:', { pathname });
        socket.destroy();
      }
    });
  }

  getTTYdProxy() {
    if (!this.ttydProxy) {
      this.ttydProxy = this.createTTYdProxy();
    }
    return this.ttydProxy;
  }

  getCodeServerProxy() {
    if (!this.codeServerProxy) {
      this.codeServerProxy = this.createCodeServerProxy();
    }
    return this.codeServerProxy;
  }
}

module.exports = new ProxyService();