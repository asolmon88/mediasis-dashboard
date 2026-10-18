"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  X,
  FileIcon,
  Loader2,
  Upload,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  GripVertical,
} from "lucide-react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { cn } from '../lib/utils'
import {
  createResumableUpload,
  validateFile,
  formatFileSize,
  generateUniqueFilePath,
} from "../lib/storage"
import { ScrollArea } from "./ui/scroll-area";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Validation result interface
 */
interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * File status states
 */
const FILE_STATUS = {
  PENDING: "pending",
  UPLOADING: "uploading",
  SUCCESS: "success",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;

type FileStatus = typeof FILE_STATUS[keyof typeof FILE_STATUS];

interface FileData {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: FileStatus;
  progress: number;
  error: string | null;
  path: string | null;
  publicUrl: string | null;
}

interface UploadResult {
  path: string;
  publicUrl: string;
}

interface FileUploadProps {
  bucketName: string;
  customUpload?: (file: File) => Promise<UploadResult>;
  pathPrefix?: string;
  multiple?: boolean;
  maxSize?: number;
  allowedTypes?: string[];
  onUploadComplete?: (file: FileData, result: UploadResult) => void;
  onUploadError?: (file: FileData, error: Error) => void;
  onFilesChange?: (files: FileData[]) => void;
  showPreview?: boolean;
  autoUpload?: boolean;
  className?: string;
  existingFiles?: string[];
  onExistingFileRemove?: (url: string) => void;
}

interface ResumableUpload {
  start: () => void;
  abort: () => void;
}

interface SortableFileItemProps {
  file: FileData;
  imagePreview?: string;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onImageClick: (url: string) => void;
  renderStatusIcon: (file: FileData, isOverlay?: boolean) => React.ReactElement;
}

const SortableFileItem = ({
  file,
  imagePreview,
  onRemove,
  onRetry,
  onCancel,
  onImageClick,
  renderStatusIcon,
}: SortableFileItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: file.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.5 : 1,
    position: "relative" as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/30 p-2 bg-background hover:border-border transition-colors w-full group",
        isDragging && "shadow-md ring-1 ring-primary/20"
      )}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Image Preview or File Icon */}
      <div className="flex-shrink-0">
        {imagePreview ? (
          <div
            className="relative w-10 h-10 rounded-md overflow-hidden bg-muted border border-border/30 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() =>
              file.status === FILE_STATUS.SUCCESS && onImageClick(imagePreview)
            }
          >
            <img
              src={imagePreview}
              alt={file.name}
              className="w-full h-full object-cover"
            />
            {/* Status overlay for images - hide when upload is complete */}
            {file.status !== FILE_STATUS.SUCCESS && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                {renderStatusIcon(file, true)}
              </div>
            )}
          </div>
        ) : (
          renderStatusIcon(file, false)
        )}
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-start gap-2 w-full">
          <p className="text-xs font-medium text-foreground truncate flex-1 min-w-0 max-w-[200px]">
            {file.name}
          </p>
          <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
            {formatFileSize(file.size)}
          </span>
        </div>

        {/* Progress Bar */}
        {file.status === FILE_STATUS.UPLOADING && (
          <Progress value={file.progress} className="h-1 mt-1.5 w-full" />
        )}

        {/* Error Message */}
        {file.error && (
          <p className="text-[10px] text-destructive mt-1 truncate">
            {file.error}
          </p>
        )}

        {/* Success Message */}
        {file.status === FILE_STATUS.SUCCESS && (
          <p className="text-[10px] text-green-600 mt-1">✓ Complete</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex items-center gap-0.5">
        {file.status === FILE_STATUS.UPLOADING && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCancel(file.id)}
            className="h-6 w-6 p-0 hover:bg-destructive/10"
          >
            <X className="h-3 w-3" />
          </Button>
        )}

        {(file.status === FILE_STATUS.ERROR ||
          file.status === FILE_STATUS.CANCELLED) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRetry(file.id)}
            className="h-6 px-1.5 text-[10px]"
          >
            Retry
          </Button>
        )}

        {file.status !== FILE_STATUS.UPLOADING && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(file.id)}
            className="h-6 w-6 p-0 hover:bg-destructive/10"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * Reusable FileUpload component for handling large file uploads with progress tracking
 *
 * @param {Object} props
 * @param {string} props.bucketName - Supabase storage bucket name (required)
 * @param {string} props.pathPrefix - Path prefix for uploaded files (e.g., 'chat-attachments')
 * @param {boolean} props.multiple - Allow multiple file uploads (default: false)
 * @param {number} props.maxSize - Maximum file size in bytes (default: 2GB)
 * @param {string[]} props.allowedTypes - Allowed MIME types (e.g., ['image/*', 'application/pdf'])
 * @param {Function} props.onUploadComplete - Callback when upload completes (file, result)
 * @param {Function} props.onUploadError - Callback when upload fails (file, error)
 * @param {Function} props.onFilesChange - Callback when file list changes (files)
 * @param {boolean} props.showPreview - Show file preview (default: true)
 * @param {boolean} props.autoUpload - Start upload automatically on file selection (default: true)
 * @param {string} props.className - Additional CSS classes
 * @param {string[]} props.existingFiles - Array of existing file URLs for edit mode
 * @param {Function} props.onExistingFileRemove - Callback when existing file is removed (url)
 */
const FileUpload: React.FC<FileUploadProps> = ({
  bucketName,
  customUpload,
  pathPrefix = "",
  multiple = false,
  maxSize = 2 * 1024 * 1024 * 1024, // 2GB default
  allowedTypes = [],
  onUploadComplete,
  onUploadError,
  onFilesChange,
  showPreview = true,
  autoUpload = true,
  className,
  existingFiles = [],
  onExistingFileRemove,
}) => {
  const [files, setFiles] = useState<FileData[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadInstancesRef = useRef<Record<string, ResumableUpload>>({});
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const onFilesChangeRef = useRef(onFilesChange);
  useEffect(() => { onFilesChangeRef.current = onFilesChange; });
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onFilesChangeRef.current?.(files);
  }, [files]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setFiles((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  /**
   * Helper: Extract filename from URL
   */
  const getFilenameFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop();
      return decodeURIComponent(filename || 'Unknown file');
    } catch {
      return 'Unknown file';
    }
  };

  /**
   * Helper: Check if URL is an image
   */
  const isImageUrl = (url: string): boolean => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const lowerUrl = url.toLowerCase();
    return imageExtensions.some(ext => lowerUrl.includes(ext));
  };

  /**
   * Helper: Remove existing file
   */
  const removeExistingFile = (url: string): void => {
    if (onExistingFileRemove) {
      onExistingFileRemove(url);
    }
  };

  /**
   * Generate image preview
   */
  const generateImagePreview = useCallback((file: File, fileId: string): void => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviews((prev) => ({
          ...prev,
          [fileId]: reader.result as string,
        }));
      };
      reader.readAsDataURL(file);
    }
  }, []);

  /**
   * Handle file selection
   */
  const handleFileSelect = useCallback(
    (selectedFiles: FileList): void => {
      const fileArray = Array.from(selectedFiles);
      const newFiles: FileData[] = fileArray.map((file) => {
        const validation = validateFile(file, { maxSize, allowedTypes }) as ValidationResult;
        const fileId = `${file.name}-${Date.now()}-${Math.random()}`;

        // Generate preview for images
        generateImagePreview(file, fileId);

        return {
          id: fileId,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          status: validation.valid ? FILE_STATUS.PENDING : FILE_STATUS.ERROR,
          progress: 0,
          error: validation.error || null,
          path: null,
          publicUrl: null,
        };
      });

      setFiles((prev) => multiple ? [...prev, ...newFiles] : newFiles);

      // Auto upload if enabled
      if (autoUpload) {
        newFiles.forEach((fileData) => {
          if (fileData.status === FILE_STATUS.PENDING) {
            uploadFile(fileData);
          }
        });
      }
    },
    [multiple, maxSize, allowedTypes, autoUpload, generateImagePreview]
  );

  /**
   * Upload a single file
   */
  const uploadFile = async (fileData: FileData): Promise<void> => {
    try {
      // Update status to uploading
      updateFileStatus(fileData.id, { status: FILE_STATUS.UPLOADING });

      if (customUpload) {
        const result = await customUpload(fileData.file);
        updateFileStatus(fileData.id, {
          status: FILE_STATUS.SUCCESS,
          progress: 100,
          path: result.path,
          publicUrl: result.publicUrl,
        });
        onUploadComplete?.(fileData, result);
        return;
      }

      // Get upload token from API
      const response = await fetch("/api/storage/upload-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucketName,
          path: pathPrefix,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "No se pudo autorizar la carga del archivo.");
      }

      const { uploadToken } = await response.json();

      // Generate unique file path
      const filePath = generateUniqueFilePath(fileData.name, pathPrefix);

      // Create resumable upload
      const upload = createResumableUpload(fileData.file, {
        bucketName,
        path: filePath,
        uploadToken,
        upsert: false,
        metadata: {},
        onProgress: (percent: number) => {
          updateFileStatus(fileData.id, { progress: percent });
        },
        onSuccess: (result: UploadResult) => {
          updateFileStatus(fileData.id, {
            status: FILE_STATUS.SUCCESS,
            progress: 100,
            path: result.path,
            publicUrl: result.publicUrl,
          });

          if (onUploadComplete) {
            onUploadComplete(fileData, result);
          }

          // Clean up upload instance
          delete uploadInstancesRef.current[fileData.id];
        },
        onError: (error: Error) => {
          updateFileStatus(fileData.id, {
            status: FILE_STATUS.ERROR,
            error: error.message || "Upload failed",
          });

          if (onUploadError) {
            onUploadError(fileData, error);
          }

          // Clean up upload instance
          delete uploadInstancesRef.current[fileData.id];
        },
      });

      // Store upload instance for cancellation
      uploadInstancesRef.current[fileData.id] = upload;

      // Start upload
      upload.start();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to start upload";
      updateFileStatus(fileData.id, {
        status: FILE_STATUS.ERROR,
        error: errorMessage,
      });

      if (onUploadError) {
        onUploadError(fileData, error instanceof Error ? error : new Error(errorMessage));
      }
    }
  };

  /**
   * Update file status
   */
  const updateFileStatus = (fileId: string, updates: Partial<FileData>): void => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, ...updates } : f)));
  };

  /**
   * Cancel upload
   */
  const cancelUpload = (fileId: string): void => {
    const upload = uploadInstancesRef.current[fileId];
    if (upload) {
      upload.abort();
      delete uploadInstancesRef.current[fileId];
    }
    updateFileStatus(fileId, { status: FILE_STATUS.CANCELLED });
  };

  /**
   * Retry upload
   */
  const retryUpload = (fileId: string): void => {
    const fileData = files.find((f) => f.id === fileId);
    if (fileData) {
      updateFileStatus(fileId, {
        status: FILE_STATUS.PENDING,
        progress: 0,
        error: null,
      });
      uploadFile(fileData);
    }
  };

  /**
   * Remove file from list
   */
  const removeFile = (fileId: string): void => {
    cancelUpload(fileId);
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    // Clean up image preview
    setImagePreviews((prev) => {
      const updated = { ...prev };
      delete updated[fileId];
      return updated;
    });
  };

  /**
   * Drag and drop handlers
   */
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      handleFileSelect(droppedFiles);
    }
  };

  /**
   * Handle file input change
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      handleFileSelect(selectedFiles);
    }
    // Reset input value to allow selecting the same file again
    e.target.value = "";
  };

  /**
   * Render file status icon
   */
  const renderStatusIcon = (file: FileData, isOverlay = false): React.ReactElement => {
    const iconClasses = isOverlay ? "h-5 w-5" : "h-4 w-4";
    const colorClasses = isOverlay ? {
      uploading: "text-white",
      success: "text-white",
      error: "text-white",
      default: "text-white"
    } : {
      uploading: "text-primary",
      success: "text-green-500",
      error: "text-destructive",
      default: "text-muted-foreground"
    };

    switch (file.status) {
      case FILE_STATUS.UPLOADING:
        return <Loader2 className={`${iconClasses} animate-spin ${colorClasses.uploading}`} />;
      case FILE_STATUS.SUCCESS:
        return <CheckCircle2 className={`${iconClasses} ${colorClasses.success}`} />;
      case FILE_STATUS.ERROR:
      case FILE_STATUS.CANCELLED:
        return <AlertCircle className={`${iconClasses} ${colorClasses.error}`} />;
      default:
        return <FileIcon className={`${iconClasses} ${colorClasses.default}`} />;
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Existing Attachments Section */}
      {existingFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground font-medium">Existing Attachments</p>
          <div className="space-y-1.5">
            {existingFiles.map((url, index) => {
              const filename = getFilenameFromUrl(url);
              const isImage = isImageUrl(url);

              return (
                <div
                  key={`existing-${index}-${url}`}
                  className="flex items-center gap-2 rounded-md border border-border/30 p-2 bg-background hover:border-border transition-colors"
                >
                  {/* Image Preview or File Icon */}
                  <div className="flex-shrink-0">
                    {isImage ? (
                      <div
                        className="relative w-10 h-10 rounded-md overflow-hidden bg-muted border border-border/30 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setLightboxImage(url)}
                      >
                        <img
                          src={url}
                          alt={filename}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {filename}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="h-6 w-6 p-0 hover:bg-primary/10"
                    >
                      <a href={url} download target="_blank" rel="noopener noreferrer">
                        <Download className="h-3 w-3" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeExistingFile(url)}
                      className="h-6 w-6 p-0 hover:bg-destructive/10"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Drop Zone */}
      {(files.length === 0 || multiple) && (
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "relative flex items-center justify-center rounded-xl border-2 border-dashed transition-all cursor-pointer",
            files.length === 0 ? "flex-col p-6" : "p-3 gap-2",
            "hover:border-primary/50 hover:bg-primary/5",
            isDragging && "border-primary bg-primary/10",
            !isDragging && "border-border/50"
          )}
        >
          <Upload className={cn(
            "text-muted-foreground",
            files.length === 0 ? "h-8 w-8 mb-2" : "h-4 w-4"
          )} />
          {files.length === 0 ? (
            <>
              <p className="text-sm font-medium text-foreground">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {maxSize && `Max size: ${formatFileSize(maxSize)}`}
                {allowedTypes.length > 0 && ` • Types: ${allowedTypes.join(", ")}`}
              </p>
            </>
          ) : (
            <p className="text-xs font-medium text-muted-foreground">
              Click or drag to add more files
            </p>
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={allowedTypes.join(",")}
        onChange={handleInputChange}
        className="hidden"
      />

      {/* File List */}
      {showPreview && files.length > 0 && (
        <div className="w-full rounded-lg border border-border/50 bg-background/50 overflow-hidden">
          {/* File Count Header */}
          <div className={cn(
            "flex items-center justify-between px-3 py-2 bg-background transition-all",
            isExpanded && "border-b border-border/50"
          )}>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 hover:bg-primary/5 rounded-md px-1.5 py-1 transition-colors"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  isExpanded && "rotate-180"
                )}
              />
              <span className="text-sm font-medium text-foreground">
                {files.length} file{files.length !== 1 ? 's' : ''} selected
              </span>
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                files.forEach(f => removeFile(f.id));
              }}
              className="h-6 text-xs text-muted-foreground hover:text-destructive"
            >
              Clear all
            </Button>
          </div>

          {/* Scrollable File List */}
          {isExpanded && (
            <ScrollArea className="h-[180px] w-full">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={files.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="p-2 space-y-1.5 w-full">
                    {files.map((file) => (
                      <SortableFileItem
                        key={file.id}
                        file={file}
                        imagePreview={imagePreviews[file.id]}
                        onRemove={removeFile}
                        onRetry={retryUpload}
                        onCancel={cancelUpload}
                        onImageClick={setLightboxImage}
                        renderStatusIcon={renderStatusIcon}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </ScrollArea>
          )}
        </div>
      )}

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center p-4">
            {/* Close button */}
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X className="h-6 w-6 text-white" />
            </button>

            {/* Image */}
            <img
              src={lightboxImage}
              alt="Preview"
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
