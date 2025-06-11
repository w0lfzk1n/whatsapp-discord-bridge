const { create, Events, ev } = require("@open-wa/wa-automate")
const fs = require("fs-extra")
const path = require("path")

function getTimestamp() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "")
}

class WhatsAppManager {
  constructor(discordManager, database) {
    this.discordManager = discordManager
    this.database = database
    this.client = null
    this.botNumber = null
    this.statsManager = null
    this.statsChatId = null
    this.mediaManager = null
    this.setupQRHandler()

    // Get command prefix from environment or use default
    this.commandPrefix = process.env.COMMAND_PREFIX || "!"
  }

  setStatsManager(statsManager) {
    this.statsManager = statsManager
  }

  setStatsChatId(chatId) {
    this.statsChatId = chatId
  }

  setMediaManager(mediaManager) {
    this.mediaManager = mediaManager
  }

  setupQRHandler() {
    ev.on("qr.**", async (qrcode, sessionId) => {
      try {
        const qrDir = path.resolve(process.cwd(), "./data/qr-codes")
        await fs.ensureDir(qrDir)

        const imageBuffer = Buffer.from(qrcode.replace("data:image/png;base64,", ""), "base64")
        const qrPath = path.join(qrDir, `${sessionId}.png`)

        await fs.writeFile(qrPath, imageBuffer)
        console.log(`QR Code saved to ${qrPath}`)
        console.log("Please scan the QR code with your WhatsApp mobile app")
      } catch (error) {
        console.error("Error saving QR code:", error)
      }
    })
  }

  async start() {
    try {
      // Ensure directories exist
      await fs.ensureDir("./data/sessions")
      await fs.ensureDir("./data/qr-codes")

      const isDebug = process.env.NODE_ENV === "development"

      const client = await create({
        headless: true,
        cacheEnabled: true,
        useChrome: true,
        restartOnCrash: this.handleRestart.bind(this),
        qrTimeout: 0,
        authTimeout: 120,
        sessionId: "wa-discord-bridge",
        sessionDataPath: "./data/sessions",
        multiDevice: true,
        cachedPatch: true,
        skipBrokenMethodsCheck: false,
        blockAssets: false,
        skipUpdateCheck: true,
        logConsoleErrors: true,
        disableSpins: true,
        debug: true,
      })

      await this.setupClient(client)
      return client
    } catch (error) {
      console.error(`${getTimestamp()} | Error starting WhatsApp client:\n`, error)
      throw error
    }
  }

  async setupClient(client) {
    this.client = client
    this.botNumber = await client.getHostNumber()
    console.log(`${getTimestamp()} | WhatsApp bot started with number: ${this.botNumber}`)

    // Set up message handler
    client.onAnyMessage(async (message) => {
      const isLidGroup = message.chat.groupMetadata?.isLidAddressingMode ? true : false
      message.sender.id = isLidGroup ? await LidToWid(message.sender.id) : message.sender.id
      message.author = isLidGroup ? await LidToWid(message.author) : message.author

      if (message.quotedMsgObj) {
        message.quotedMsgObj.sender.id = isLidGroup ? await LidToWid(message.quotedMsgObj.sender.id) : message.quotedMsgObj.sender.id
        if (message.quotedMsgObj.author) {
          message.quotedMsgObj.author = isLidGroup ? await LidToWid(message.quotedMsgObj.author) : message.quotedMsgObj.author
        }
      }

      async function LidToWid(lidHere) {
        const wid = await client.getPage().evaluate((lid) => {
          const WAWebLidMigrationUtils = require("WAWebLidMigrationUtils");
          const WAWebWidFactory = require("WAWebWidFactory");
          return WAWebLidMigrationUtils.toPn(WAWebWidFactory.createWidFromWidLike(lid));
        }, lidHere);
        return wid._serialized;
      }
      await this.handleMessage(message)
    })

    // Handle message reactions
    client.onReaction(async (reaction) => {
      await this.handleReaction(reaction)
    })

    // Set up other event handlers
    client.onStateChanged((state) => {
      console.log(`${getTimestamp()} | WhatsApp state changed:`, state)
    })
  }

  async handleMessage(message) {
    try {
      // Check if bridge is paused (except for commands)
      const isPaused = this.database.getPauseState()
      const isCommand =
        message.body &&
        (message.body.trim().toLowerCase() === `${this.commandPrefix}stats` ||
          message.body.trim().toLowerCase() === `${this.commandPrefix}pause` ||
          message.body.trim().toLowerCase() === `${this.commandPrefix}start` ||
          message.body.trim().toLowerCase() === `${this.commandPrefix}help`)

      if (isPaused && !isCommand) {
        console.log(`${getTimestamp()} | ⏸️ Bridge is paused, skipping message processing`)
        return
      }

      const { body, chat, author, from, type, sender, id, filename, size } = message

      // Skip album messages (they're just notifications for multiple media)
      if (type === "album") {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 📱 Skipping album message notification`)
        }
        return
      }

      const isMe = from.includes(this.botNumber) || (author && author.includes(this.botNumber))

      // Determine and validate chat type
      const chatType = this.getChatType(from)
      if (!chatType) {
        console.log(`${getTimestamp()} | 🚫 Ignoring message from unsupported chat type: ${from}`)
        return
      }

      // For own messages, use the 'to' field or chatId, for others use 'from'
      const chatId = isMe ? message.to || message.chatId || from : from

      // Check if this chat is muted
      if (this.database.getChatMuteState(chatId)) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 🔇 Chat ${chatId} is muted, skipping message processing`)
        }
        return
      }

      // Check if this chat is locked for sending
      if (this.database.isChatLockedForSending(chatId)) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 🔒 Chat ${chatId} is locked for sending, queuing message`)
        }
        this.database.queueMessageForProcessing(chatId, message, this.handleMessage.bind(this))
        return
      }

      // Log all messages for debugging
      if (process.env.NODE_ENV === "development") {
        if (type === "chat" || type === "text") {
          console.log(`${getTimestamp()} | 📱 ${from} | ${type} | ${isMe ? "[ME]" : ""} ${body || "[no text]"}`)
        } else {
          console.log(`${getTimestamp()} | 📱 ${from} | ${type} | ${isMe ? "[ME]" : ""}`)
        }
      }

      // Check if this is a stats command from the authorized chat
      if (
        body?.trim().toLowerCase() === `${this.commandPrefix}stats` &&
        this.statsChatId &&
        from === this.statsChatId
      ) {
        await this.handleStatsCommand(message.chatId)
        return
      }

      // Check if this is a help command
      if (body?.trim().toLowerCase() === `${this.commandPrefix}help` && !isMe) {
        await this.handleHelpCommand(from)
        return
      }

      // Handle messages from yourself (not sent via Discord)
      if (isMe) {
        await this.handleOwnMessage(message)
        return
      }

      // Handle messages from others
      await this.forwardMessageToDiscord(message)

      // Log to database
      const chatName = chat?.name || sender?.pushname || "Unknown"
      const senderName = sender?.pushname || sender?.name || "Unknown"

      // Get channel ID for logging
      const mapping = this.database.getChatMapping(chatId)
      const channelId = mapping?.dc_channel_id || "unknown"

      this.database.logMessage(chatId, channelId, body, senderName, type, true)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling WhatsApp message:\n`, error)
    }
  }

  // Update the handleOwnMessage method to use counter-based echo prevention for media
  async handleOwnMessage(message) {
    try {
      const { body, from, type, filename, to, size, id } = message

      // For own messages, the chatId is where the message was sent TO, not FROM
      const chatId = to || message.chatId || from

      // First check if this message ID was sent from Discord (most reliable method)
      if (id && this.database.wasMessageIdSentFromDiscord(id)) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 🔄 Skipping own message with ID ${id} (sent from Discord)`)
        }
        return
      }

      // For media messages, use counter-based echo prevention
      if (type !== "chat" && type !== "text") {
        const senderNumber = from || message.from
        if (this.database.shouldIgnoreOwnMedia(chatId, senderNumber, this.botNumber)) {
          if (process.env.NODE_ENV === "development") {
            console.log(`${getTimestamp()} | 🔄 Skipping own media ${type} (counter-based echo prevention)`)
          }
          return
        }
      }

      // Fallback to content matching for text messages
      const messageContent = body || ""

      if (this.database.wasMessageSentFromDiscord(chatId, messageContent)) {
        if (process.env.NODE_ENV === "development") {
          console.log(
            `${getTimestamp()} | 🔄 Skipping own message (sent from Discord): ${messageContent.substring(0, 50)}...`,
          )
        }
        return
      }

      console.log(`${getTimestamp()} | 📤 Processing own message to forward to Discord: ${type}`)

      // Forward your own message to Discord
      await this.forwardMessageToDiscord(message, true)

      // Log to database
      const chatName = message.chat?.name || "Unknown"
      const mapping = this.database.getChatMapping(chatId)
      const channelId = mapping?.dc_channel_id || "unknown"

      this.database.logMessage(chatId, channelId, body, "You", type, true)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling own message:\n`, error)
    }
  }

  async handleStatsCommand(chatId) {
    if (!this.statsManager) {
      await this.sendMessage(chatId, "Stats manager not available")
      return
    }

    try {
      // Generate stats
      const stats = await this.statsManager.generateStats()
      const formattedStats = this.statsManager.formatStats(stats, "whatsapp")

      // Send stats
      await this.sendMessage(chatId, formattedStats)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling stats command:\n`, error)
      await this.sendMessage(chatId, "Error generating statistics")
    }
  }

  async handleHelpCommand(chatId) {
    try {
      // Get help text formatted for WhatsApp
      const helpText = this.discordManager.getHelpText("whatsapp")

      // Send help text
      await this.sendMessage(chatId, helpText)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling help command:\n`, error)
      await this.sendMessage(chatId, "❌ Error displaying help information")
    }
  }

  /**
   * Detects if content contains Base64 data and returns media info
   * @param {string} content - Content to check
   * @returns {Object|null} - Media info or null if no Base64 detected
   */
  detectBase64Media(content) {
    if (!content) return null

    // Check for Base64 data URL pattern (more comprehensive)
    const base64Patterns = [
      /data:([^;]+);base64,([A-Za-z0-9+/=]+)/,
      /^([A-Za-z0-9+/=]{100,})$/, // Raw base64 without data URL prefix
    ]

    for (const pattern of base64Patterns) {
      const match = content.match(pattern)
      if (match) {
        let mimeType = match[1] || "application/octet-stream"
        const base64Data = match[2] || match[1]

        // If no MIME type detected, try to guess from content
        if (!match[1]) {
          // Try to detect image signatures
          const firstBytes = base64Data.substring(0, 20)
          if (firstBytes.startsWith("/9j/") || firstBytes.startsWith("iVBOR") || firstBytes.startsWith("R0lGOD")) {
            mimeType = firstBytes.startsWith("/9j/")
              ? "image/jpeg"
              : firstBytes.startsWith("iVBOR")
                ? "image/png"
                : "image/gif"
          } else if (firstBytes.includes("GIF")) {
            mimeType = "image/gif"
          }
        }

        // Determine media type from MIME type
        let mediaType = "unknown"
        if (mimeType.startsWith("image/")) {
          mediaType = "image"
        } else if (mimeType.startsWith("video/")) {
          mediaType = "video"
        } else if (mimeType.startsWith("audio/")) {
          mediaType = "audio"
        } else {
          mediaType = "document"
        }

        return {
          mimeType,
          base64Data,
          mediaType,
          fullMatch: match[0],
        }
      }
    }

    return null
  }

  /**
   * Processes quoted media and creates a thumbnail URL for Discord
   * @param {Object} quotedMsg - The quoted message object
   * @param {string} channelId - Discord channel ID for uploading
   * @returns {Object|null} - Processed media info with thumbnail URL or null
   */
  async processQuotedMediaForThumbnail(quotedMsg, channelId) {
    if (!quotedMsg || !this.mediaManager) return null

    let tempFilePath = null

    try {
      // Check if the quoted message has media directly
      let processedMedia = null
      if (this.mediaManager.hasMedia(quotedMsg)) {
        processedMedia = await this.mediaManager.processWhatsAppMedia(quotedMsg, this.client)
      } else {
        // Check if the quoted message body contains Base64 data
        const mediaInfo = this.detectBase64Media(quotedMsg.body)
        if (mediaInfo) {
          // Create a temporary file from the Base64 data
          const timestamp = Date.now()
          const extension = this.getExtensionFromMimeType(mediaInfo.mimeType)
          const filename = `quoted_media_${timestamp}${extension}`
          tempFilePath = path.join(this.mediaManager.tempDir, filename)

          // Write Base64 data to file
          const buffer = Buffer.from(mediaInfo.base64Data, "base64")
          await fs.writeFile(tempFilePath, buffer)

          processedMedia = {
            filePath: tempFilePath,
            filename,
            type: mediaInfo.mediaType,
            mimeType: mediaInfo.mimeType,
            size: buffer.length,
          }
        }
      }

      if (!processedMedia) return null

      // Only process images for thumbnails
      if (processedMedia.type !== "image") {
        return {
          description: this.createQuoteDescription(quotedMsg, processedMedia.type),
          thumbnailUrl: null,
        }
      }

      // Create a Discord attachment just to get the URL
      const attachment = await this.mediaManager.createDiscordAttachment(processedMedia)
      if (!attachment || attachment.error) {
        return {
          description: this.createQuoteDescription(quotedMsg, processedMedia.type),
          thumbnailUrl: null,
        }
      }

      // Upload the image to Discord to get a URL (we'll use a temporary message approach)
      const thumbnailUrl = await this.discordManager.uploadImageForThumbnail(channelId, attachment.attachment)

      return {
        description: this.createQuoteDescription(quotedMsg, processedMedia.type),
        thumbnailUrl: thumbnailUrl,
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error processing quoted media for thumbnail:\n`, error)
      return null
    } finally {
      // Clean up temp file
      if (tempFilePath && this.mediaManager) {
        await this.mediaManager.cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Gets file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} - File extension
   */
  getExtensionFromMimeType(mimeType) {
    const mimeToExt = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "video/webm": ".webm",
      "video/quicktime": ".mov",
      "audio/mpeg": ".mp3",
      "audio/wav": ".wav",
      "audio/ogg": ".ogg",
      "application/pdf": ".pdf",
      "text/plain": ".txt",
    }

    return mimeToExt[mimeType] || ".bin"
  }

  /**
   * Creates a clean quote description for media
   * @param {Object} quotedMsg - The quoted message
   * @param {string} mediaType - Type of media
   * @returns {string} - Clean description
   */
  createQuoteDescription(quotedMsg, mediaType) {
    const senderName = quotedMsg.sender?.pushname || quotedMsg.sender?.name || "Unknown"

    const mediaEmojis = {
      image: "🖼️",
      video: "🎥",
      audio: "🎵",
      document: "📄",
      unknown: "📎",
    }

    const emoji = mediaEmojis[mediaType] || mediaEmojis.unknown
    return `${emoji} [${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}]`
  }

  /**
   * Enhanced media detection that checks multiple sources
   * @param {Object} message - WhatsApp message object
   * @returns {boolean} - True if message has media
   */
  hasMediaContent(message) {
    // Check if media manager detects media
    if (this.mediaManager && this.mediaManager.hasMedia(message)) {
      return true
    }

    // Check if message body contains Base64 data (for GIFs/videos that might not be detected)
    if (message.body && this.detectBase64Media(message.body)) {
      return true
    }

    // Check for specific media types
    const mediaTypes = ["image", "video", "audio", "ptt", "document", "sticker"]
    if (mediaTypes.includes(message.type)) {
      return true
    }

    return false
  }

  async forwardMessageToDiscord(message, isOwnMessage = false) {
    try {
      const { from, chat, sender, type, to, quotedMsg } = message

      // For own messages, use the 'to' field or chatId, for others use 'from'
      const chatId = isOwnMessage ? to || message.chatId || from : from
      const chatName = chat?.name || sender?.pushname || "Unknown"
      const chatType = this.getChatType(chatId)

      if (!chatType) {
        console.log(`${getTimestamp()} | 🚫 Skipping message from unsupported chat type: ${chatId}`)
        return
      }

      // Get or create Discord channel
      const channelId = await this.discordManager.getOrCreateChannel(chatId, chatName, this.database, chatType)

      // Handle quoted messages with potential media
      let quotedThumbnailUrl = null
      let quotedDescription = null

      if (quotedMsg && quotedMsg.body) {
        // Record the quote for potential reverse lookup
        this.database.recordQuotedMessage(
          quotedMsg.id,
          "whatsapp",
          chatId,
          channelId,
          quotedMsg.body,
          quotedMsg.sender?.pushname || quotedMsg.sender?.name || "Unknown",
        )

        // Check if quoted message contains media and get thumbnail URL
        const quotedMediaInfo = await this.processQuotedMediaForThumbnail(quotedMsg, channelId)

        if (quotedMediaInfo) {
          quotedDescription = quotedMediaInfo.description
          quotedThumbnailUrl = quotedMediaInfo.thumbnailUrl
        } else {
          // No media detected, use regular text processing
          quotedDescription = this.cleanQuotedContent(quotedMsg.body)
        }
      }

      // Enhanced media detection - check multiple sources
      if (this.hasMediaContent(message)) {
        await this.forwardMediaMessage(message, channelId, isOwnMessage, quotedDescription, quotedThumbnailUrl)
      } else {
        // Regular text message - use embed
        const embed = this.discordManager.createMessageEmbed(message, isOwnMessage)

        // Add quoted message info if present
        if (quotedDescription) {
          const formattedQuote = this.discordManager.formatMultiLineQuote(quotedDescription)
          embed.description = `${formattedQuote}\n\n${embed.description || ""}`
        }

        // Add quoted media as thumbnail if available
        if (quotedThumbnailUrl) {
          embed.thumbnail = { url: quotedThumbnailUrl }
        }

        await this.discordManager.sendEmbedToChannel(channelId, embed)
      }

      const senderInfo = isOwnMessage ? "You" : chatName
      console.log(`${getTimestamp()} | ✅ Forwarded ${type} message from ${senderInfo} to Discord channel ${channelId}`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error forwarding message to Discord:\n`, error)
    }
  }

  /**
   * Cleans quoted content by removing Base64 data and providing clean descriptions
   * @param {string} content - Raw quoted content
   * @returns {string} - Cleaned content
   */
  cleanQuotedContent(content) {
    if (!content) return "[Empty message]"

    // Check for Base64 data and replace with clean description
    const mediaInfo = this.detectBase64Media(content)
    if (mediaInfo) {
      return this.createQuoteDescription({ body: content }, mediaInfo.mediaType)
    }

    // Return original content if no Base64 detected
    return content
  }

  async forwardMediaMessage(
    message,
    channelId,
    isOwnMessage = false,
    quotedDescription = null,
    quotedThumbnailUrl = null,
  ) {
    if (!this.mediaManager) {
      console.error(`${getTimestamp()} | Media manager not available`)
      return
    }

    let tempFilePath = null
    const { sender, type, body } = message
    const senderInfo = isOwnMessage ? "You" : sender?.pushname || sender?.name || "Unknown"

    try {
      if (process.env.NODE_ENV === "development") {
        console.log(`${getTimestamp()} | 📱 Processing ${type} media from ${senderInfo}`)
      }

      let processedMedia = null

      // Try standard media processing first
      if (this.mediaManager.hasMedia(message)) {
        processedMedia = await this.mediaManager.processWhatsAppMedia(message, this.client)
      }
      // Handle Base64 media in message body
      else if (body) {
        const mediaInfo = this.detectBase64Media(body)
        if (mediaInfo) {
          console.log(`${getTimestamp()} | 📎 Processing Base64 media from message body (${mediaInfo.mediaType})`)

          // Create a temporary file from the Base64 data
          const timestamp = Date.now()
          const extension = this.getExtensionFromMimeType(mediaInfo.mimeType)
          const filename = `wa_media_${timestamp}${extension}`
          tempFilePath = path.join(this.mediaManager.tempDir, filename)

          // Write Base64 data to file
          try {
            const buffer = Buffer.from(mediaInfo.base64Data, "base64")
            await fs.writeFile(tempFilePath, buffer)

            processedMedia = {
              filePath: tempFilePath,
              filename,
              type: mediaInfo.mediaType,
              mimeType: mediaInfo.mimeType,
              size: buffer.length,
              description: `${mediaInfo.mediaType.charAt(0).toUpperCase() + mediaInfo.mediaType.slice(1)}`,
            }

            console.log(
              `${getTimestamp()} | ✅ Successfully processed Base64 ${mediaInfo.mediaType} (${buffer.length} bytes)`,
            )
          } catch (base64Error) {
            console.error(`${getTimestamp()} | Error processing Base64 data:\n`, base64Error)
            // Fall back to text message
            processedMedia = null
          }
        }
      }

      if (!processedMedia) {
        // Fallback to text message embed if media processing fails
        const embed = this.discordManager.createMessageEmbed(message, isOwnMessage)

        // Add quoted message info if present
        if (quotedDescription) {
          const formattedQuote = this.discordManager.formatMultiLineQuote(quotedDescription)
          embed.description = `${formattedQuote}\n\n${embed.description || ""}`
        }

        // Add quoted media as thumbnail if available
        if (quotedThumbnailUrl) {
          embed.thumbnail = { url: quotedThumbnailUrl }
        }

        await this.discordManager.sendEmbedToChannel(channelId, embed)
        return
      }

      // Update tempFilePath if it was set during Base64 processing
      if (!tempFilePath) {
        tempFilePath = processedMedia.filePath
      }

      // Create Discord attachment
      const mediaAttachment = await this.mediaManager.createDiscordAttachment(processedMedia)

      if (!mediaAttachment) {
        // Fallback to text message embed if attachment creation fails
        const embed = this.discordManager.createMessageEmbed(message, isOwnMessage)
        embed.description = (embed.description || "") + "\n\n❌ *Failed to process media attachment*"
        embed.color = 0xe74c3c // Red color for error

        // Add quoted message info if present
        if (quotedDescription) {
          const formattedQuote = this.discordManager.formatMultiLineQuote(quotedDescription)
          embed.description = `${formattedQuote}\n\n${embed.description || ""}`
        }

        await this.discordManager.sendEmbedToChannel(channelId, embed)
        return
      }

      // Prepare message data for embed
      const { timestamp } = message
      let senderName = "Unknown"
      let senderId = "unknown"
      let formattedSenderId = ""

      if (isOwnMessage) {
        senderName = "You"
        senderId = "own"
      } else {
        senderName = sender?.pushname || sender?.name || sender?.shortName || message.chat?.name || "Unknown"
        senderId = sender?.id || sender?.number || "unknown"

        // Format senderId for display (remove @c.us and add +)
        if (senderId && senderId !== "unknown") {
          formattedSenderId = senderId.replace("@c.us", "").replace("@g.us", "")
          if (formattedSenderId && !formattedSenderId.startsWith("+")) {
            formattedSenderId = "+" + formattedSenderId
          }
        }
      }

      const messageData = {
        senderName,
        senderId,
        formattedSenderId,
        timestamp,
        type,
        isOwnMessage,
        quotedDescription,
        quotedThumbnailUrl,
      }

      // Add quoted message info to caption if present
      if (quotedDescription && mediaAttachment.caption) {
        const formattedQuote = this.discordManager.formatMultiLineQuote(quotedDescription)
        mediaAttachment.caption = `${formattedQuote}\n\n${mediaAttachment.caption}`
      }

      // Send media to Discord with embed
      await this.discordManager.sendMediaToChannel(channelId, mediaAttachment, messageData)

      console.log(`${getTimestamp()} | ✅ Forwarded media (${processedMedia.type}) to Discord`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error forwarding media message:\n`, error)

      // Fallback to text message embed
      try {
        const embed = this.discordManager.createMessageEmbed(message, isOwnMessage)
        embed.description = (embed.description || "") + "\n\n❌ *Media forwarding failed*"
        embed.color = 0xe74c3c // Red color for error

        // Add quoted message info if present
        if (quotedDescription) {
          const formattedQuote = this.discordManager.formatMultiLineQuote(quotedDescription)
          embed.description = `${formattedQuote}\n\n${embed.description || ""}`
        }

        // Add quoted media as thumbnail if available
        if (quotedThumbnailUrl) {
          embed.thumbnail = { url: quotedThumbnailUrl }
        }

        await this.discordManager.sendEmbedToChannel(channelId, embed)
      } catch (fallbackError) {
        console.error(`${getTimestamp()} | Error sending fallback message:`, fallbackError)
      }
    } finally {
      // Clean up temporary file
      if (tempFilePath && this.mediaManager) {
        await this.mediaManager.cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Sends a video file as a GIF to WhatsApp
   * @param {string} chatId - WhatsApp chat ID
   * @param {string} filePath - Path to the video file
   * @param {string} filename - Filename
   * @param {string} caption - Optional caption
   * @returns {Promise<boolean>} - Success status
   */
  async sendVideoAsGif(chatId, filePath, filename, caption = "") {
    try {
      if (!this.client) {
        throw new Error("WhatsApp client not available")
      }

      console.log(`${getTimestamp()} | 🎬 Sending video as GIF to WhatsApp: ${filename}`)

      // Use the sendVideoAsGif method from open-wa
      await this.client.sendVideoAsGif(chatId, filePath, filename, caption)

      console.log(`${getTimestamp()} | ✅ Sent video as GIF to WhatsApp: ${filename}`)
      return true
    } catch (error) {
      console.error(`${getTimestamp()} | ❌ Error sending video as GIF to WhatsApp:`, error)
      throw error
    }
  }

  async handleRestart(client) {
    console.log(`${getTimestamp()} | WhatsApp client restarting...`)
    await this.setupClient(client)
  }

  // Update the sendMessage method to use chat locking
  async sendMessage(chatId, message) {
    let result = null
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      // Lock the chat before sending
      this.database.lockChatForSending(chatId)

      if (process.env.NODE_ENV === "development") {
        console.log(`${getTimestamp()} | Sending message to WhatsApp chat ${chatId}: ${message}`)
      }
      result = await this.client.sendText(chatId, message)

      // result is the message ID directly, not result.id
      const messageId = result

      console.log(`${getTimestamp()} | ✅ Message sent successfully to WhatsApp`)
      return result
    } catch (error) {
      console.error(`${getTimestamp()} | Error sending WhatsApp message:\n`, error)
      throw error
    } finally {
      // Always unlock the chat, even if sending failed
      setTimeout(() => {
        this.database.unlockChatAfterSending(chatId, result)
      }, 500) // Small delay to ensure message is processed
    }
  }

  // Update the sendImage method to use chat locking
  async sendImage(chatId, filePath, filename, caption = "") {
    let result = null
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      // Lock the chat before sending
      this.database.lockChatForSending(chatId)

      console.log(`${getTimestamp()} | Sending image to WhatsApp chat ${chatId}: ${filename}`)

      // Convert file to base64 data URL
      const fileData = await fs.readFile(filePath)
      const mimeType = this.getMimeTypeFromFile(filePath)
      const base64Data = `data:${mimeType};base64,${fileData.toString("base64")}`

      result = await this.client.sendImage(chatId, base64Data, filename, caption)

      // result is the message ID directly
      const messageId = result

      console.log(`${getTimestamp()} | ✅ Image sent successfully`)
      return result
    } catch (error) {
      console.error(`${getTimestamp()} | Error sending WhatsApp image:\n`, error)
      throw error
    } finally {
      // Always unlock the chat, even if sending failed
      setTimeout(() => {
        this.database.unlockChatAfterSending(chatId, result)
      }, 500) // Small delay to ensure message is processed
    }
  }

  // Update the sendVideo method to use chat locking
  async sendVideo(chatId, filePath, filename, caption = "") {
    let result = null
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      // Lock the chat before sending
      this.database.lockChatForSending(chatId)

      console.log(`${getTimestamp()} | Sending video to WhatsApp chat ${chatId}: ${filename}`)

      // Convert file to base64 data URL
      const fileData = await fs.readFile(filePath)
      const mimeType = this.getMimeTypeFromFile(filePath)
      const base64Data = `data:${mimeType};base64,${fileData.toString("base64")}`

      result = await this.client.sendVideo(chatId, base64Data, filename, caption)

      // result is the message ID directly
      const messageId = result

      console.log(`${getTimestamp()} | ✅ Video sent successfully`)
      return result
    } catch (error) {
      console.error("Error sending WhatsApp video:", error)
      throw error
    } finally {
      // Always unlock the chat, even if sending failed
      setTimeout(() => {
        this.database.unlockChatAfterSending(chatId, result)
      }, 500) // Small delay to ensure message is processed
    }
  }

  // Update the sendAudio method to use chat locking
  async sendAudio(chatId, filePath, filename) {
    let result = null
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      // Lock the chat before sending
      this.database.lockChatForSending(chatId)

      console.log(`${getTimestamp()} | Sending audio to WhatsApp chat ${chatId}: ${filename}`)

      // Convert file to base64 data URL
      const fileData = await fs.readFile(filePath)
      const mimeType = this.getMimeTypeFromFile(filePath)
      const base64Data = `data:${mimeType};base64,${fileData.toString("base64")}`

      result = await this.client.sendAudio(chatId, base64Data, filename)

      // result is the message ID directly
      const messageId = result

      console.log(`${getTimestamp()} | ✅ Audio sent successfully`)
      return result
    } catch (error) {
      console.error(`${getTimestamp()} | Error sending WhatsApp audio:\n`, error)
      throw error
    } finally {
      // Always unlock the chat, even if sending failed
      setTimeout(() => {
        this.database.unlockChatAfterSending(chatId, result)
      }, 500) // Small delay to ensure message is processed
    }
  }

  // Update the sendDocument method to use chat locking and file hash tracking
  async sendDocument(chatId, filePath, filename, caption = "") {
    let result = null
    let fileSize = 0

    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      // Lock the chat before sending
      this.database.lockChatForSending(chatId)

      console.log(`${getTimestamp()} | Sending document to WhatsApp chat ${chatId}: ${filename}`)

      // Get file size for hash tracking
      const fileStats = await fs.stat(filePath)
      fileSize = fileStats.size

      // Convert file to base64 data URL
      const fileData = await fs.readFile(filePath)
      const mimeType = this.getMimeTypeFromFile(filePath)
      const base64Data = `data:${mimeType};base64,${fileData.toString("base64")}`

      result = await this.client.sendFile(chatId, base64Data, filename, caption)

      console.log(`${getTimestamp()} | ✅ Document sent successfully`)
      return result
    } catch (error) {
      console.error(`${getTimestamp()} | Error sending WhatsApp document:\n`, error)
      throw error
    } finally {
      // Always unlock the chat, even if sending failed
      // For documents, pass file info since we might not get a message ID
      setTimeout(() => {
        this.database.unlockChatAfterSending(chatId, result, {
          filename: filename,
          fileSize: fileSize,
        })
      }, 500) // Small delay to ensure message is processed
    }
  }

  // Update the sendSticker method to use chat locking
  async sendSticker(chatId, filePath, filename) {
    let result = null
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      // Lock the chat before sending
      this.database.lockChatForSending(chatId)

      console.log(`${getTimestamp()} | Sending sticker to WhatsApp chat ${chatId}: ${filename}`)

      // Convert file to base64 data URL
      const fileData = await fs.readFile(filePath)
      const mimeType = this.getMimeTypeFromFile(filePath)
      const base64Data = `data:${mimeType};base64,${fileData.toString("base64")}`

      result = await this.client.sendImageAsSticker(chatId, base64Data)

      // result is the message ID directly
      const messageId = result

      console.log(`${getTimestamp()} | ✅ Sticker sent successfully`)
      return result
    } catch (error) {
      console.error(`${getTimestamp()} | Error sending WhatsApp sticker:\n`, error)
      return false
    } finally {
      // Always unlock the chat, even if sending failed
      setTimeout(() => {
        this.database.unlockChatAfterSending(chatId, result)
      }, 500) // Small delay to ensure message is processed
    }
  }

  /**
   * Blocks a contact on WhatsApp
   * @param {string} contactId WhatsApp contact ID
   * @returns {boolean} True if successful
   */
  async blockContact(contactId) {
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      const result = await this.client.contactBlock(contactId)
      console.log(`${getTimestamp()} | 🚫 Blocked contact ${contactId}`)
      return result
    } catch (error) {
      console.error(`${getTimestamp()} | Error blocking contact:\n`, error)
      return false
    }
  }

  /**
   * Unblocks a contact on WhatsApp
   * @param {string} contactId WhatsApp contact ID
   * @returns {boolean} True if successful
   */
  async unblockContact(contactId) {
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      const result = await this.client.contactUnblock(contactId)
      console.log(`${getTimestamp()} | ✅ Unblocked contact ${contactId}`)
      return result
    } catch (error) {
      console.error(`${getTimestamp()} | Error unblocking contact:\n`, error)
      return false
    }
  }

  /**
   * Gets all WhatsApp chats
   * @returns {Array} Array of chat objects
   */
  async getAllChats() {
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      const chats = await this.client.getAllChats()
      // Filter out status broadcasts and other non-chat types
      return chats.filter((chat) => {
        return chat.id.endsWith("@c.us") || chat.id.endsWith("@g.us")
      })
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting all chats:\n`, error)
      return []
    }
  }

  /**
   * Checks if a chat exists
   * @param {string} chatId WhatsApp chat ID
   * @returns {boolean} True if chat exists
   */
  async checkChatExists(chatId) {
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      const chat = await this.client.getChatById(chatId)
      return chat !== null && chat !== undefined
    } catch (error) {
      console.error(`${getTimestamp()} | Error checking if chat exists:\n`, error)
      return false
    }
  }

  /**
   * Gets information about a chat
   * @param {string} chatId WhatsApp chat ID
   * @returns {Object|null} Chat information or null if not found
   */
  async getChatInfo(chatId) {
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      const chat = await this.client.getChatById(chatId)
      if (!chat) return null

      // For contacts, try to get more detailed info
      if (chatId.endsWith("@c.us")) {
        try {
          const contact = await this.client.getContact(chatId)
          return {
            id: chatId,
            name: contact.pushname || contact.name || contact.shortName || chat.name || "Unknown",
            type: "contact",
            isGroup: false,
          }
        } catch (contactError) {
          console.error(`${getTimestamp()} | Error getting contact info:\n`, contactError)
        }
      }

      // Default or group chat info
      return {
        id: chatId,
        name: chat.name || "Unknown",
        type: chatId.endsWith("@g.us") ? "group" : "contact",
        isGroup: chatId.endsWith("@g.us"),
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting chat info:\n`, error)
      return null
    }
  }

  getMimeTypeFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase()

    const mimeTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".aac": "audio/aac",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".txt": "text/plain",
    }

    return mimeTypes[ext] || "application/octet-stream"
  }

  async getChats() {
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      return await this.client.getAllChats()
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting WhatsApp chats:\n`, error)
      throw error
    }
  }

  /**
   * Determines the chat type based on chat ID
   */
  getChatType(chatId) {
    if (chatId.endsWith("@c.us")) {
      return "contact"
    } else if (chatId.endsWith("@g.us")) {
      return "group"
    }
    // Ignore other chat types
    return null
  }

  /**
   * Gets contact profile information
   */
  async getContactProfile(contactId) {
    if (!this.client) {
      throw new Error(`${getTimestamp()} | WhatsApp client not initialized`)
    }

    try {
      if (process.env.NODE_ENV === "development") {
        console.log(`Getting profile for contact: ${contactId}`)
      }

      // Get contact info
      const contact = await this.client.getContact(contactId)
      const profilePic = await this.client.getProfilePicFromServer(contactId).catch(() => null)

      // Format phone number
      const phoneNumber = contactId.replace("@c.us", "")
      const formattedPhone = `+${phoneNumber}`

      return {
        name: contact.pushname || contact.name || contact.shortName || "Unknown",
        number: formattedPhone,
        status: contact.statusMsg || "No status",
        profilePicUrl: profilePic,
        isBusiness: contact.isBusiness || false,
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting contact profile:\n`, error)
      return null
    }
  }

  async handleReaction(reaction) {
    try {
      const { msgId, reactText, senderId, chatId } = reaction

      // Check if bridge is paused
      if (this.database.getPauseState()) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | ⏸️ Bridge is paused, skipping reaction processing`)
        }
        return
      }

      // Check if this chat is muted
      if (this.database.getChatMuteState(chatId)) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 🔇 Chat ${chatId} is muted, skipping reaction processing`)
        }
        return
      }

      // Check if this chat is locked for sending
      if (this.database.isChatLockedForSending(chatId)) {
        console.log(`${getTimestamp()} | 🔒 Chat ${chatId} is locked for sending, queuing reaction`)
        this.database.queueMessageForProcessing(chatId, reaction, this.handleReaction.bind(this))
        return
      }

      // Get chat type
      const chatType = this.getChatType(chatId)
      if (!chatType) {
        return
      }

      // Get sender info
      const senderName = reaction.senderName || "Unknown"
      const isMe = senderId.includes(this.botNumber)
      const displayName = isMe ? "You" : senderName

      if (process.env.NODE_ENV === "development") {
        console.log(`${getTimestamp()} | 📱 Reaction: ${displayName} reacted with ${reactText} in ${chatId}`)
      }

      // Get or create Discord channel
      const mapping = this.database.getChatMapping(chatId)
      if (!mapping) {
        console.log(`${getTimestamp()} | No Discord channel found for reaction`)
        return
      }

      // Send reaction info to Discord as normal message
      const reactionMessage = this.discordManager.createReactionMessage(displayName, reactText, isMe)
      await this.discordManager.sendMessageToChannel(mapping.dc_channel_id, reactionMessage)

      console.log(`${getTimestamp()} | ✅ Forwarded reaction from ${displayName} to Discord`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling WhatsApp reaction:\n`, error)
    }
  }
}

module.exports = WhatsAppManager
