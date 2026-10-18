/**
 * Storage utility functions for handling resumable file uploads
 * Uses TUS protocol for reliable, resumable uploads to Supabase Storage
 */

import * as tus from 'tus-js-client';

/**
 * Default configuration for file uploads
 */
const DEFAULT_CONFIG = {
  chunkSize: 6 * 1024 * 1024, // 6MB chunks (recommended for large files)
  retryDelays: [0, 1000, 3000, 5000], // Retry delays in milliseconds
  parallelUploads: 1,
};

/**
 * Get the Supabase project URL from environment
 */
export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * Get the TUS resumable upload endpoint
 */
export function getStorageEndpoint() {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not defined');
  }
  return `${supabaseUrl}/storage/v1/upload/resumable`;
}

/**
 * Create a resumable upload instance
 *
 * @param {File} file - The file to upload
 * @param {Object} options - Upload configuration options
 * @param {string} options.bucketName - Supabase storage bucket name
 * @param {string} options.path - File path within the bucket
 * @param {string} options.uploadToken - Authentication token from API
 * @param {Function} options.onProgress - Progress callback (percent, bytesUploaded, bytesTotal)
 * @param {Function} options.onSuccess - Success callback
 * @param {Function} options.onError - Error callback
 * @param {boolean} options.upsert - Whether to overwrite existing files (default: false)
 * @param {Object} options.metadata - Additional metadata for the upload
 * @returns {tus.Upload} TUS upload instance
 */
export function createResumableUpload(file, options) {
  const {
    bucketName,
    path,
    uploadToken,
    onProgress,
    onSuccess,
    onError,
    upsert = false,
    metadata = {},
  } = options;

  if (!file) {
    throw new Error('File is required');
  }

  if (!bucketName || !path) {
    throw new Error('Bucket name and path are required');
  }

  if (!uploadToken) {
    throw new Error('Upload token is required. Call the API to generate one.');
  }

  const endpoint = getStorageEndpoint();

  // Prepare metadata
  const uploadMetadata = {
    bucketName,
    objectName: path,
    contentType: file.type || 'application/octet-stream',
    ...metadata,
  };

  // Create TUS upload instance
  const upload = new tus.Upload(file, {
    endpoint,
    retryDelays: DEFAULT_CONFIG.retryDelays,
    chunkSize: DEFAULT_CONFIG.chunkSize,
    headers: {
      authorization: `Bearer ${uploadToken}`,
      ...(upsert && { 'x-upsert': 'true' }),
    },
    metadata: uploadMetadata,
    onError: (error) => {
      console.error('Upload failed:', error);
      if (onError) {
        onError(error);
      }
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
      if (onProgress) {
        onProgress(parseFloat(percentage), bytesUploaded, bytesTotal);
      }
    },
    onSuccess: () => {
      console.log('Upload completed successfully');
      if (onSuccess) {
        const publicUrl = getPublicUrl(bucketName, path);
        onSuccess({
          path,
          bucketName,
          publicUrl,
          fullPath: `${bucketName}/${path}`,
        });
      }
    },
  });

  return upload;
}

/**
 * Get public URL for an uploaded file
 *
 * @param {string} bucketName - Storage bucket name
 * @param {string} path - File path within the bucket
 * @returns {string} Public URL
 */
export function getPublicUrl(bucketName, path) {
  const supabaseUrl = getSupabaseUrl();
  return `${supabaseUrl}/storage/v1/object/public/${bucketName}/${path}`;
}

/**
 * Format file size for display
 *
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Validate file before upload
 *
 * @param {File} file - File to validate
 * @param {Object} constraints - Validation constraints
 * @param {number} constraints.maxSize - Maximum file size in bytes
 * @param {string[]} constraints.allowedTypes - Allowed MIME types
 * @returns {Object} Validation result { valid: boolean, error?: string }
 */
export function validateFile(file, constraints = {}) {
  const { maxSize, allowedTypes } = constraints;

  if (maxSize && file.size > maxSize) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${formatFileSize(maxSize)}`,
    };
  }

  if (allowedTypes && allowedTypes.length > 0) {
    const fileType = file.type || '';
    const isAllowed = allowedTypes.some((type) => {
      // Support wildcards like "image/*"
      if (type.endsWith('/*')) {
        const category = type.split('/')[0];
        return fileType.startsWith(category + '/');
      }
      return fileType === type;
    });

    if (!isAllowed) {
      return {
        valid: false,
        error: `File type "${fileType}" is not allowed. Allowed types: ${allowedTypes.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Generate a unique file path to avoid collisions
 *
 * @param {string} fileName - Original file name
 * @param {string} prefix - Path prefix (e.g., 'chat-attachments', 'user-123')
 * @returns {string} Unique file path
 */
export function generateUniqueFilePath(fileName, prefix = '') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');

  const uniqueName = `${timestamp}-${random}-${sanitizedName}`;

  return prefix ? `${prefix}/${uniqueName}` : uniqueName;
}

/**
 * Upload multiple files with progress tracking
 *
 * @param {File[]} files - Array of files to upload
 * @param {Object} options - Upload options (same as createResumableUpload)
 * @param {Function} options.onFileProgress - Progress callback for individual files
 * @param {Function} options.onAllComplete - Callback when all uploads complete
 * @returns {Array} Array of upload instances
 */
export function uploadMultipleFiles(files, options) {
  const {
    onFileProgress,
    onAllComplete,
    ...uploadOptions
  } = options;

  const uploads = [];
  const results = [];
  let completedCount = 0;

  files.forEach((file, index) => {
    const fileOptions = {
      ...uploadOptions,
      onProgress: (percent, bytesUploaded, bytesTotal) => {
        if (onFileProgress) {
          onFileProgress(index, file, percent, bytesUploaded, bytesTotal);
        }
      },
      onSuccess: (result) => {
        results[index] = { success: true, file, ...result };
        completedCount++;

        if (completedCount === files.length && onAllComplete) {
          onAllComplete(results);
        }
      },
      onError: (error) => {
        results[index] = { success: false, file, error: error.message };
        completedCount++;

        if (completedCount === files.length && onAllComplete) {
          onAllComplete(results);
        }
      },
    };

    const upload = createResumableUpload(file, fileOptions);
    uploads.push(upload);
  });

  return uploads;
}
