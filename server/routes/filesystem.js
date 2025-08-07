const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { AppError, asyncHandler } = require('../middleware/error-handler');
const { ERROR_CODES } = require('../utils/constants');
// Simple text detection fallback
const isText = (filename, buffer) => {
    const textExts = ['.txt', '.js', '.ts', '.json', '.md', '.html', '.css', '.jsx', '.tsx', '.vue', '.py', '.sh', '.yml', '.yaml', '.xml', '.svg'];
    const ext = require('path').extname(filename).toLowerCase();
    if (textExts.includes(ext)) return true;
    if (!buffer) return false;
    // Simple binary detection - if buffer contains null bytes, it's likely binary
    for (let i = 0; i < Math.min(512, buffer.length); i++) {
        if (buffer[i] === 0) return false;
    }
    return true;
};

/**
 * Filesystem Routes - Support for absolute path browsing
 * These endpoints allow browsing the entire filesystem starting from root (/)
 * with appropriate security measures
 */

// Security configuration - define allowed paths
const SECURITY_CONFIG = {
    // Allow access to common user directories
    allowedPaths: [
        '/home',
        '/tmp',
        '/var/log',  // For system logs (read-only)
        '/opt',      // For optional software
        '/usr/local' // For locally installed software
    ],
    
    // Block sensitive system paths
    blockedPaths: [
        '/etc/passwd',
        '/etc/shadow',
        '/root',
        '/sys',
        '/proc',
        '/dev'
    ]
};

/**
 * Validate if a path is allowed to be accessed
 * @param {string} requestedPath - The absolute path being requested
 * @returns {boolean} - Whether the path is allowed
 */
function isPathAllowed(requestedPath) {
    // Normalize the path
    const normalizedPath = path.resolve(requestedPath);
    
    // Check if path is explicitly blocked
    for (const blockedPath of SECURITY_CONFIG.blockedPaths) {
        if (normalizedPath.startsWith(blockedPath)) {
            return false;
        }
    }
    
    // Check if path is within allowed paths
    if (normalizedPath === '/') {
        return true; // Allow root directory listing
    }
    
    for (const allowedPath of SECURITY_CONFIG.allowedPaths) {
        if (normalizedPath.startsWith(allowedPath)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Configure multer for file upload
 */
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    // File size limit (10MB)
    const maxSize = 10 * 1024 * 1024;
    
    // Allow all file types but with size restriction
    cb(null, true);
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: fileFilter
});

/**
 * Generate unique filename to avoid conflicts
 */
async function generateUniqueFilename(dir, originalName) {
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    let filename = originalName;
    let counter = 1;

    try {
        while (true) {
            try {
                await fs.access(path.join(dir, filename));
                // File exists, generate new name
                filename = `${baseName}_${counter}${ext}`;
                counter++;
            } catch (error) {
                // File doesn't exist, use this name
                break;
            }
        }
    } catch (error) {
        // Error checking file existence, use original name
    }

    return filename;
}


/**
 * Detect if a file is text or binary using content analysis
 * @param {string} filePath - Full path to the file
 * @param {string} fileName - Name of the file
 * @param {number} fileSize - Size of the file in bytes
 * @returns {Promise<{isText: boolean, mimeType: string, isImage: boolean}>} - File type information
 */
async function detectFileType(filePath, fileName, fileSize) {
    const fileExt = path.extname(fileName).toLowerCase();
    
    // Known binary file extensions - skip content analysis for these
    const knownBinaryExtensions = {
        // Images
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff',
        
        // Archives
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
        '.bz2': 'application/x-bzip2',
        '.7z': 'application/x-7z-compressed',
        '.rar': 'application/vnd.rar',
        
        // Executables
        '.exe': 'application/x-executable',
        '.bin': 'application/octet-stream',
        '.so': 'application/x-sharedlib',
        '.dll': 'application/x-msdownload',
        
        // Media
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        
        // Documents (binary formats)
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    
    // Quick check for known binary files
    if (knownBinaryExtensions[fileExt]) {
        const mimeType = knownBinaryExtensions[fileExt];
        return {
            isText: false,
            mimeType: mimeType,
            isImage: mimeType.startsWith('image/')
        };
    }
    
    // Known text file extensions with specific MIME types
    const knownTextExtensions = {
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.jsx': 'text/javascript',
        '.ts': 'text/typescript',
        '.tsx': 'text/typescript',
        '.html': 'text/html',
        '.htm': 'text/html',
        '.css': 'text/css',
        '.scss': 'text/css',
        '.sass': 'text/css',
        '.less': 'text/css',
        '.json': 'application/json',
        '.xml': 'text/xml',
        '.csv': 'text/csv',
        '.md': 'text/markdown',
        '.markdown': 'text/markdown',
        '.svg': 'image/svg+xml' // SVG is text-based
    };
    
    // For files that are too large, avoid reading content for analysis
    const maxAnalysisSize = 1024 * 1024; // 1MB
    if (fileSize > maxAnalysisSize) {
        // For large files, rely on extension or default to binary
        if (knownTextExtensions[fileExt]) {
            return {
                isText: true,
                mimeType: knownTextExtensions[fileExt],
                isImage: false
            };
        }
        return {
            isText: false,
            mimeType: 'application/octet-stream',
            isImage: false
        };
    }
    
    try {
        // Read first 512 bytes for content analysis
        const sampleSize = Math.min(512, fileSize);
        const fileHandle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(sampleSize);
        await fileHandle.read(buffer, 0, sampleSize, 0);
        await fileHandle.close();
        
        // Use istextorbinary for intelligent detection
        const isTextFile = isText(fileName, buffer);
        
        let mimeType;
        if (isTextFile) {
            // Use specific MIME type if known, otherwise default to text/plain
            mimeType = knownTextExtensions[fileExt] || 'text/plain';
        } else {
            mimeType = 'application/octet-stream';
        }
        
        return {
            isText: isTextFile,
            mimeType: mimeType,
            isImage: mimeType.startsWith('image/') && mimeType !== 'image/svg+xml'
        };
        
    } catch (error) {
        console.warn(`Error analyzing file ${filePath}:`, error.message);
        // Fallback to extension-based detection
        if (knownTextExtensions[fileExt]) {
            return {
                isText: true,
                mimeType: knownTextExtensions[fileExt],
                isImage: false
            };
        }
        return {
            isText: false,
            mimeType: 'application/octet-stream',
            isImage: false
        };
    }
}

/**
 * Get file stats and determine file type
 * @param {string} filePath - Full path to the file
 * @param {string} fileName - Name of the file
 * @returns {Object} - File information object
 */
async function getFileInfo(filePath, fileName) {
    try {
        const stats = await fs.stat(filePath);
        return {
            name: fileName,
            path: filePath,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.isFile() ? stats.size : 0,
            modified: stats.mtime.toISOString(),
            isHidden: fileName.startsWith('.')
        };
    } catch (error) {
        // If we can't stat the file, skip it
        return null;
    }
}

/**
 * Browse filesystem at absolute path
 * GET /api/filesystem/browse?path=/absolute/path&showHidden=true
 */
router.get('/browse', asyncHandler(async (req, res) => {
        const requestedPath = req.query.path || '/';
        const showHidden = req.query.showHidden === 'true';
        
        // Security validation
        if (!isPathAllowed(requestedPath)) {
            throw new AppError('Access denied to this path', 403, ERROR_CODES.ACCESS_DENIED);
        }
        
        
        // Resolve and normalize the path
        const fullPath = path.resolve(requestedPath);
        
        // Check if path exists
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile()) {
            // If it's a file, return file information
            const fileInfo = await getFileInfo(fullPath, path.basename(fullPath));
            res.json({
                success: true,
                file: fileInfo,
                timestamp: new Date().toISOString()
            });
            return;
        }
        
        if (!stats.isDirectory()) {
            throw new AppError('Path is not a file or directory', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        // Read directory contents
        const entries = await fs.readdir(fullPath);
        const files = [];
        
        for (const entry of entries) {
            // Skip hidden files if not requested
            if (!showHidden && entry.startsWith('.')) {
                continue;
            }
            
            const entryPath = path.join(fullPath, entry);
            const fileInfo = await getFileInfo(entryPath, entry);
            
            if (fileInfo) {
                files.push(fileInfo);
            }
        }
        
        // Sort files: directories first, then by name
        files.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        res.json({
            success: true,
            directory: {
                path: fullPath,
                files: files
            },
            timestamp: new Date().toISOString()
        });
}));

/**
 * Get file preview for absolute path
 * GET /api/filesystem/preview?path=/absolute/path/to/file
 */
router.get('/preview', asyncHandler(async (req, res) => {
        const requestedPath = req.query.path;
        
        if (!requestedPath) {
            throw new AppError('File path is required', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        // Security validation
        if (!isPathAllowed(requestedPath)) {
            throw new AppError('Access denied to this path', 403, ERROR_CODES.ACCESS_DENIED);
        }
        
        const fullPath = path.resolve(requestedPath);
        
        // Check if file exists and is readable
        const stats = await fs.stat(fullPath);
        
        if (!stats.isFile()) {
            throw new AppError('Path is not a file', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        // File size limit for preview (5MB)
        const maxPreviewSize = 5 * 1024 * 1024;
        if (stats.size > maxPreviewSize) {
            throw new AppError('File too large for preview (max 5MB)', 413, ERROR_CODES.FILE_TOO_LARGE);
        }
        
        const fileName = path.basename(fullPath);
        
        // Use intelligent file type detection
        const fileTypeInfo = await detectFileType(fullPath, fileName, stats.size);
        const { isText, mimeType, isImage } = fileTypeInfo;
        
        let content = null;
        
        if (isText) {
            // Read as text
            content = await fs.readFile(fullPath, 'utf8');
        } else if (isImage) {
            // Read as base64 for images
            const buffer = await fs.readFile(fullPath);
            content = buffer.toString('base64');
        }
        
        res.json({
            success: true,
            file: {
                name: fileName,
                path: fullPath,
                size: stats.size,
                modified: stats.mtime.toISOString(),
                mimeType: mimeType,
                isText: isText,
                isImage: isImage,
                content: content
            },
            timestamp: new Date().toISOString()
        });
}));

/**
 * Download file from absolute path
 * GET /api/filesystem/download?path=/absolute/path/to/file
 */
router.get('/download', asyncHandler(async (req, res) => {
        const requestedPath = req.query.path;
        
        if (!requestedPath) {
            throw new AppError('File path is required', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        // Security validation
        if (!isPathAllowed(requestedPath)) {
            throw new AppError('Access denied to this path', 403, ERROR_CODES.ACCESS_DENIED);
        }
        
        const fullPath = path.resolve(requestedPath);
        
        // Check if file exists
        const stats = await fs.stat(fullPath);
        
        if (!stats.isFile()) {
            throw new AppError('Path is not a file', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        const fileName = path.basename(fullPath);
        
        // Set headers for file download
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', stats.size);
        
        // Stream the file
        const readStream = require('fs').createReadStream(fullPath);
        readStream.pipe(res);
}));

/**
 * Save file content to absolute path
 * PUT /api/filesystem/save
 * Body: { path: string, content: string }
 */
router.put('/save', asyncHandler(async (req, res) => {
        const { path: filePath, content } = req.body;
        
        if (!filePath) {
            throw new AppError('File path is required', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        if (typeof content !== 'string') {
            throw new AppError('File content must be a string', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        // Security validation
        if (!isPathAllowed(filePath)) {
            throw new AppError('Access denied to this path', 403, ERROR_CODES.ACCESS_DENIED);
        }
        
        const fullPath = path.resolve(filePath);
        
        // Ensure parent directory exists
        const parentDir = path.dirname(fullPath);
        try {
            await fs.mkdir(parentDir, { recursive: true });
        } catch (error) {
            // Directory might already exist, continue
        }
        
        // Write file content
        await fs.writeFile(fullPath, content, 'utf8');
        
        // Get file stats for response
        const stats = await fs.stat(fullPath);
        
        res.json({
            success: true,
            message: 'File saved successfully',
            file: {
                path: fullPath,
                size: stats.size,
                modified: stats.mtime.toISOString()
            },
            timestamp: new Date().toISOString()
        });
}));

/**
 * Upload files to filesystem path
 * POST /api/filesystem/upload
 * Body: FormData with files and targetPath
 */
router.post('/upload', upload.array('files', 10), asyncHandler(async (req, res) => {
        const { targetPath } = req.body;
        
        if (!targetPath) {
            throw new AppError('Target path is required', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        if (!req.files || req.files.length === 0) {
            throw new AppError('No files provided', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        // Security validation
        if (!isPathAllowed(targetPath)) {
            throw new AppError('Access denied to this path', 403, ERROR_CODES.ACCESS_DENIED);
        }
        
        const fullTargetPath = path.resolve(targetPath);
        
        // Check if target directory exists
        try {
            const stats = await fs.stat(fullTargetPath);
            if (!stats.isDirectory()) {
                throw new AppError('Target path is not a directory', 400, ERROR_CODES.VALIDATION_ERROR);
            }
        } catch (error) {
            throw new AppError('Target directory does not exist', 404, ERROR_CODES.NOT_FOUND);
        }
        
        const uploadResults = [];
        const errors = [];
        
        // Process each file
        for (const file of req.files) {
            try {
                // Validate file size
                if (file.size > 10 * 1024 * 1024) {
                    errors.push({
                        filename: file.originalname,
                        error: 'File size exceeds 10MB limit'
                    });
                    continue;
                }
                
                // Generate unique filename
                const filename = await generateUniqueFilename(fullTargetPath, file.originalname);
                const filePath = path.join(fullTargetPath, filename);
                
                // Write file
                await fs.writeFile(filePath, file.buffer);
                
                // Get file stats
                const stats = await fs.stat(filePath);
                
                uploadResults.push({
                    originalName: file.originalname,
                    filename: filename,
                    path: filePath,
                    size: stats.size,
                    mimetype: file.mimetype,
                    uploaded: stats.mtime.toISOString()
                });
                
            } catch (error) {
                errors.push({
                    filename: file.originalname,
                    error: error.message
                });
            }
        }
        
        const response = {
            success: true,
            message: `${uploadResults.length} files uploaded successfully`,
            uploaded: uploadResults,
            timestamp: new Date().toISOString()
        };
        
        if (errors.length > 0) {
            response.errors = errors;
            response.message += `, ${errors.length} files failed`;
        }
        
        res.json(response);
}));

/**
 * Delete file or directory at absolute path
 * DELETE /api/filesystem/delete
 * Body: { path: string, type?: string }
 */
router.delete('/delete', asyncHandler(async (req, res) => {
        const { path: filePath, type } = req.body;
        
        if (!filePath) {
            throw new AppError('File path is required', 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        // Security validation
        if (!isPathAllowed(filePath)) {
            throw new AppError('Access denied to this path', 403, ERROR_CODES.ACCESS_DENIED);
        }
        
        const fullPath = path.resolve(filePath);
        
        // Check if file/directory exists
        let stats;
        try {
            stats = await fs.stat(fullPath);
        } catch (error) {
            throw new AppError('File or directory not found', 404, ERROR_CODES.NOT_FOUND);
        }
        
        const itemName = path.basename(fullPath);
        const isDirectory = stats.isDirectory();
        const actualType = isDirectory ? 'directory' : 'file';
        
        // Validate type if provided
        if (type && type !== actualType) {
            throw new AppError(`Path is a ${actualType}, not a ${type}`, 400, ERROR_CODES.VALIDATION_ERROR);
        }
        
        // Additional safety check: prevent deletion of system directories
        const systemPaths = ['/', '/home', '/usr', '/var', '/opt', '/tmp'];
        if (systemPaths.includes(fullPath)) {
            throw new AppError('Cannot delete system directories', 403, ERROR_CODES.ACCESS_DENIED);
        }
        
        try {
            if (isDirectory) {
                // Remove directory recursively
                await fs.rm(fullPath, { recursive: true, force: true });
            } else {
                // Remove file
                await fs.unlink(fullPath);
            }
            
            res.json({
                success: true,
                message: `${actualType === 'directory' ? 'Directory' : 'File'} deleted successfully`,
                deleted: {
                    name: itemName,
                    path: fullPath,
                    type: actualType
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            // Handle specific deletion errors
            if (error.code === 'ENOTEMPTY') {
                throw new AppError('Directory is not empty', 400, ERROR_CODES.VALIDATION_ERROR);
            } else if (error.code === 'EACCES' || error.code === 'EPERM') {
                throw new AppError('Permission denied', 403, ERROR_CODES.ACCESS_DENIED);
            } else if (error.code === 'EBUSY') {
                throw new AppError('File or directory is busy', 400, ERROR_CODES.VALIDATION_ERROR);
            } else {
                throw new AppError(`Failed to delete ${actualType}: ${error.message}`, 500, ERROR_CODES.INTERNAL_ERROR);
            }
        }
}));


module.exports = router;