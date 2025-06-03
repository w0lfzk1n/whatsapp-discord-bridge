const { decryptMedia } = require("@open-wa/wa-decrypt")
const fs = require("fs-extra")
const path = require("path")
const { AttachmentBuilder } = require("discord.js")

function getTimestamp() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "")
}

class MediaManager {
  constructor() {
    this.mediaDir = path.resolve(process.cwd(), "./data/media")
    this.tempDir = path.resolve(process.cwd(), "./data/temp")
    this.initializeDirectories()
  }

  async initializeDirectories() {
    await fs.ensureDir(this.mediaDir)
    await fs.ensureDir(this.tempDir)
    console.log(`Media directories initialized`)
  }

  /**
   * Processes media from WhatsApp message and prepares it for Discord
   * @param {Object} message WhatsApp message object
   * @param {Object} client WhatsApp client
   * @returns {Object} Media information for Discord
   */
  async processWhatsAppMedia(message, client) {
    const { type, mimetype, filename, caption } = message

    try {
      // Check if message has media
      if (!this.hasMedia(message)) {
        return null
      }

      if (process.env.NODE_ENV === "development") {
        console.log(
          `${getTimestamp()} | 📎 ${type.charAt(0).toUpperCase() + type.slice(1)} media detected: ${filename || "unnamed"}`,
        )
      } else {
        console.log(`${getTimestamp()} | 📎 ${type.charAt(0).toUpperCase() + type.slice(1)} media detected`)
      }

      // Decrypt media data
      const mediaData = await decryptMedia(message)
      if (!mediaData) {
        throw new Error(`${getTimestamp()} | Failed to decrypt media`)
      }

      // Generate unique filename
      const timestamp = Date.now()
      const extension = this.getFileExtension(message)
      const safeFilename = this.sanitizeFilename(filename || `media_${timestamp}`)
      const finalFilename = `${safeFilename}_${timestamp}.${extension}`
      const tempFilePath = path.join(this.tempDir, finalFilename)

      // Handle different media types
      let processedMedia = null

      switch (type) {
        case "image":
          processedMedia = await this.processImage(mediaData, tempFilePath, message)
          break
        case "video":
          processedMedia = await this.processVideo(mediaData, tempFilePath, message)
          break
        case "audio":
        case "ptt": // Push-to-talk voice message
          processedMedia = await this.processAudio(mediaData, tempFilePath, message)
          break
        case "document":
          processedMedia = await this.processDocument(mediaData, tempFilePath, message)
          break
        case "sticker":
          processedMedia = await this.processSticker(mediaData, tempFilePath, message)
          break
        default:
          console.log(`Unsupported media type: ${type}`)
          return null
      }

      if (processedMedia) {
        processedMedia.caption = caption || ""
        processedMedia.originalType = type
        processedMedia.mimetype = mimetype
      }

      return processedMedia
    } catch (error) {
      console.error(`${getTimestamp()} | Error processing WhatsApp media:\n`, error)
      return null
    }
  }

  /**
   * Processes image media
   */
  async processImage(mediaData, filePath, message) {
    await fs.writeFile(filePath, mediaData)
    return {
      type: "image",
      filePath,
      filename: path.basename(filePath),
      size: mediaData.length,
      description: "Image",
    }
  }

  /**
   * Processes video media
   */
  async processVideo(mediaData, filePath, message) {
    await fs.writeFile(filePath, mediaData)

    return {
      type: "video",
      filePath,
      filename: path.basename(filePath),
      size: mediaData.length,
      description: "Video",
    }
  }

  /**
   * Processes audio media (including voice messages)
   */
  async processAudio(mediaData, filePath, message) {
    await fs.writeFile(filePath, mediaData)

    const isVoiceMessage = message.type === "ptt"

    return {
      type: "audio",
      filePath,
      filename: path.basename(filePath),
      size: mediaData.length,
      description: isVoiceMessage ? "Voice Message" : "Audio",
    }
  }

  /**
   * Processes document media
   */
  async processDocument(mediaData, filePath, message) {
    await fs.writeFile(filePath, mediaData)

    return {
      type: "document",
      filePath,
      filename: path.basename(filePath),
      size: mediaData.length,
      description: `Document: ${message.filename || "Unknown"}`,
    }
  }

  /**
   * Processes sticker media (both static and animated)
   */
  async processSticker(mediaData, filePath, message) {
    const isAnimated = message.mediaData?.isAnimated || false

    if (!isAnimated) {
      // Static sticker - convert to PNG
      const pngPath = filePath.replace(/\.[^/.]+$/, ".png")
      await fs.writeFile(pngPath, mediaData)

      return {
        type: "sticker",
        filePath: pngPath,
        filename: path.basename(pngPath),
        size: mediaData.length,
        description: "Sticker (Static)",
        isAnimated: false,
      }
    } else {
      // Animated sticker - save as WebP
      const webpPath = filePath.replace(/\.[^/.]+$/, ".webp")
      await fs.writeFile(webpPath, mediaData)

      return {
        type: "sticker",
        filePath: webpPath,
        filename: path.basename(webpPath),
        size: mediaData.length,
        description: "Sticker (Animated)",
        isAnimated: true,
      }
    }
  }

  /**
   * Creates Discord attachment from processed media
   */
  async createDiscordAttachment(processedMedia) {
    if (!processedMedia || !processedMedia.filePath) {
      return null
    }

    try {
      // Check file size (Discord has limits)
      const stats = await fs.stat(processedMedia.filePath)
      const fileSizeMB = stats.size / (1024 * 1024)

      // Discord file size limits (8MB for regular users, 50MB for Nitro)
      const maxSizeMB = 8
      if (fileSizeMB > maxSizeMB) {
        console.log(`${getTimestamp()} | File too large for Discord: ${fileSizeMB.toFixed(2)}MB > ${maxSizeMB}MB`)
        return {
          error: `File too large: ${fileSizeMB.toFixed(2)}MB (max: ${maxSizeMB}MB)`,
          description: processedMedia.description,
        }
      }

      const attachment = new AttachmentBuilder(processedMedia.filePath, {
        name: processedMedia.filename,
        description: processedMedia.description,
      })

      return {
        attachment,
        description: processedMedia.description,
        caption: processedMedia.caption,
        size: this.formatFileSize(stats.size),
        originalType: processedMedia.originalType,
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error creating Discord attachment:\n`, error)
      return null
    }
  }

  /**
   * Cleans up temporary files
   */
  async cleanupTempFile(filePath) {
    try {
      if (await fs.pathExists(filePath)) {
        await fs.unlink(filePath)
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | Cleaned up temp file: ${path.basename(filePath)}`)
        }
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up temp file:\n`, error)
    }
  }

  /**
   * Cleans up old temporary files (older than 1 hour)
   */
  async cleanupOldTempFiles() {
    try {
      const files = await fs.readdir(this.tempDir)
      const oneHourAgo = Date.now() - 60 * 60 * 1000

      for (const file of files) {
        const filePath = path.join(this.tempDir, file)
        const stats = await fs.stat(filePath)

        if (stats.mtime.getTime() < oneHourAgo) {
          await fs.unlink(filePath)
          if (process.env.NODE_ENV === "development") {
            console.log(`${getTimestamp()} | Cleaned up old temp file: ${file}`)
          }
        }
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up old temp files:\n`, error)
    }
  }

  /**
   * Checks if message has media
   */
  hasMedia(message) {
    const mediaTypes = ["image", "video", "audio", "ptt", "document", "sticker"]
    return mediaTypes.includes(message.type)
  }

  /**
   * Gets appropriate file extension for media type
   */
  getFileExtension(message) {
    const { type, mimetype, filename } = message

    // Try to get extension from filename first
    if (filename) {
      const ext = path.extname(filename).slice(1)
      if (ext) return ext
    }

    // Fallback to mimetype mapping
    const mimetypeMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "audio/mpeg": "mp3",
      "audio/ogg": "ogg",
      "audio/wav": "wav",
      "audio/aac": "aac",
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "text/plain": "txt",
    }

    if (mimetype && mimetypeMap[mimetype]) {
      return mimetypeMap[mimetype]
    }

    // Type-based fallbacks
    const typeMap = {
      image: "jpg",
      video: "mp4",
      audio: "mp3",
      ptt: "ogg",
      document: "bin",
      sticker: "webp",
    }

    return typeMap[type] || "bin"
  }

  /**
   * Sanitizes filename for safe file system usage
   */
  sanitizeFilename(filename) {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .replace(/_{2,}/g, "_")
      .substring(0, 50)
  }

  /**
   * Formats file size in human readable format
   */
  formatFileSize(bytes) {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  /**
   * Starts periodic cleanup of old temp files
   */
  startPeriodicCleanup() {
    // Clean up old temp files every hour
    setInterval(
      () => {
        this.cleanupOldTempFiles()
      },
      60 * 60 * 1000,
    )

    console.log(`${getTimestamp()} | 🧹 Started periodic temp file cleanup`)
  }
}

module.exports = MediaManager
