const { Client, GatewayIntentBits, Partials, ChannelType } = require("discord.js")
const fs = require("fs-extra")
const path = require("path")
const https = require("https")
const http = require("http")

function getTimestamp() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "")
}

class DiscordManager {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message],
    })

    this.isReady = false
    this.setupEventHandlers()
    this.whatsappManager = null
    this.statsManager = null
    this.statsChannelId = null
    this.mediaManager = null
    this.database = null

    // Cache for chat lists (for index-based sending)
    this.chatListCache = new Map() // userId -> { chats: [], timestamp: number }
    this.chatCacheTimeout = 5 * 60 * 1000 // 5 minutes

    // Color schemes for different users
    this.userColors = new Map()
    this.colorPalette = [
      0x3498db, // Blue
      0xe74c3c, // Red
      0x9b59b6, // Purple
      0xf39c12, // Orange
      0x1abc9c, // Turquoise
      0xe67e22, // Carrot
      0x34495e, // Wet Asphalt
      0x2980b9, // Belize Hole
      0x8e44ad, // Wisteria
      0x2c3e50, // Midnight Blue
      0xf1c40f, // Sun Flower
      0xd35400, // Pumpkin
      0xc0392b, // Pomegranate
      0x16a085, // Green Sea (darker, less confusing)
      0x7f8c8d, // Asbestos
      0x95a5a6, // Concrete
    ]
    this.ownMessageColor = 0x25d366 // WhatsApp green for own messages
    this.systemMessageColor = 0x95a5a6 // Gray for system messages

    // Get command prefix from environment or use default
    this.commandPrefix = process.env.COMMAND_PREFIX || "!"
  }

  setWhatsAppManager(whatsappManager) {
    this.whatsappManager = whatsappManager
  }

  setStatsManager(statsManager) {
    this.statsManager = statsManager
  }

  setStatsChannelId(channelId) {
    this.statsChannelId = channelId
  }

  setMediaManager(mediaManager) {
    this.mediaManager = mediaManager
  }

  setDatabase(database) {
    this.database = database
  }

  /**
   * Gets a consistent color for a user
   */
  getUserColor(userId, isOwnMessage = false) {
    if (isOwnMessage) {
      return this.ownMessageColor
    }

    if (!this.userColors.has(userId)) {
      // Assign a color based on the hash of the user ID
      const hash = this.hashString(userId)
      const colorIndex = hash % this.colorPalette.length
      this.userColors.set(userId, this.colorPalette[colorIndex])
    }

    return this.userColors.get(userId)
  }

  /**
   * Simple hash function for consistent color assignment
   */
  hashString(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Gets emoji for message type
   */
  getMessageTypeEmoji(type) {
    const emojiMap = {
      text: "💬",
      chat: "💬",
      image: "📷",
      video: "🎥",
      audio: "🎵",
      ptt: "🎤",
      document: "📄",
      sticker: "🎭",
      location: "📍",
      unknown: "❓",
      cipher: "🔐",
    }
    return emojiMap[type] || "📱"
  }

  /**
   * Caches the chat list for a user
   */
  setChatListCache(userId, chats) {
    this.chatListCache.set(userId, {
      chats: chats,
      timestamp: Date.now(),
    })
  }

  /**
   * Gets cached chat list for a user
   */
  getChatListCache(userId) {
    const cached = this.chatListCache.get(userId)
    if (!cached) return null

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.chatCacheTimeout) {
      this.chatListCache.delete(userId)
      return null
    }

    return cached.chats
  }

  /**
   * Checks if a message is a command
   */
  isCommand(content) {
    return content.trim().startsWith(this.commandPrefix)
  }

  /**
   * Parses command from message content
   */
  parseCommand(content) {
    const trimmed = content.trim()
    if (!trimmed.startsWith(this.commandPrefix)) return null

    const withoutPrefix = trimmed.substring(this.commandPrefix.length)
    const args = withoutPrefix.split(/\s+/)
    const command = args[0].toLowerCase()

    return { command, args }
  }

  /**
   * Downloads HTML content from a URL
   */
  async downloadHtmlContent(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https:") ? https : http

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return this.downloadHtmlContent(response.headers.location).then(resolve).catch(reject)
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
          return
        }

        let data = ""
        response.on("data", (chunk) => {
          data += chunk
        })

        response.on("end", () => {
          resolve(data)
        })
      })

      request.on("error", (error) => {
        reject(error)
      })

      request.setTimeout(10000, () => {
        request.destroy()
        reject(new Error("HTML download timeout"))
      })
    })
  }

  /**
   * Extracts GIF URL from HTML content
   */
  extractGifUrlFromHtml(html, originalUrl) {
    try {
      // Look for various meta tags and patterns that contain the direct GIF URL
      const patterns = [
        // Tenor patterns
        /content="(https:\/\/media\d*\.tenor\.com\/[^"]+\.gif)"/i,
        /property="og:image"\s+content="(https:\/\/[^"]*tenor[^"]*\.gif)"/i,
        /name="twitter:image"\s+content="(https:\/\/[^"]*tenor[^"]*\.gif)"/i,

        // Giphy patterns
        /content="(https:\/\/media\d*\.giphy\.com\/[^"]+\.gif)"/i,
        /property="og:image"\s+content="(https:\/\/[^"]*giphy[^"]*\.gif)"/i,
        /name="twitter:image"\s+content="(https:\/\/[^"]*giphy[^"]*\.gif)"/i,

        // Generic GIF patterns
        /content="(https:\/\/[^"]+\.gif)"/i,
        /"(https:\/\/[^"]+\.gif)"/i,
      ]

      for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match && match[1]) {
          console.log(`${getTimestamp()} | 🔍 Found GIF URL in HTML: ${match[1]}`)
          return match[1]
        }
      }

      console.log(`${getTimestamp()} | ❌ No GIF URL found in HTML for: ${originalUrl}`)
      return null
    } catch (error) {
      console.error(`${getTimestamp()} | Error extracting GIF URL from HTML:`, error)
      return null
    }
  }

  /**
   * Gets the direct GIF URL from Tenor
   */
  async getTenorDirectUrl(originalUrl) {
    try {
      // Extract GIF ID from Tenor URL
      let gifId = null
      const patterns = [
        /\/view\/[^-]+-(\w+)/, // /view/example-abc123
        /\/gif\/[^-]+-(\w+)/, // /gif/example-abc123
        /\/(\w{10,})/, // Any 10+ character ID
      ]

      for (const pattern of patterns) {
        const match = originalUrl.match(pattern)
        if (match) {
          gifId = match[1]
          break
        }
      }

      if (!gifId) {
        console.log(`${getTimestamp()} | ❌ Could not extract Tenor GIF ID from: ${originalUrl}`)
        return null
      }

      console.log(`${getTimestamp()} | 🔍 Extracted Tenor GIF ID: ${gifId}`)

      // Try different Tenor URL patterns
      const directUrlPatterns = [
        `https://media1.tenor.com/m/${gifId}/${gifId}.gif`,
        `https://media.tenor.com/m/${gifId}/${gifId}.gif`,
        `https://c.tenor.com/${gifId}/tenor.gif`,
        `https://media1.tenor.com/images/${gifId}/tenor.gif`,
        `https://media.tenor.com/images/${gifId}/tenor.gif`,
      ]

      for (const url of directUrlPatterns) {
        try {
          console.log(`${getTimestamp()} | 🔍 Trying Tenor direct URL: ${url}`)
          const isValid = await this.checkUrlIsGif(url)
          if (isValid) {
            console.log(`${getTimestamp()} | ✅ Found working Tenor GIF URL: ${url}`)
            return url
          }
        } catch (error) {
          console.log(`${getTimestamp()} | ❌ Tenor URL failed: ${url}`)
        }
      }

      // If direct URLs don't work, try parsing the HTML
      console.log(`${getTimestamp()} | 🔍 Trying to extract GIF URL from Tenor HTML...`)
      const html = await this.downloadHtmlContent(originalUrl)
      const extractedUrl = this.extractGifUrlFromHtml(html, originalUrl)

      if (extractedUrl) {
        const isValid = await this.checkUrlIsGif(extractedUrl)
        if (isValid) {
          return extractedUrl
        }
      }

      return null
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting Tenor direct URL:`, error)
      return null
    }
  }

  /**
   * Gets the direct GIF URL from Giphy
   */
  async getGiphyDirectUrl(originalUrl) {
    try {
      // Extract GIF ID from Giphy URL
      let gifId = null
      const patterns = [
        /\/gifs\/[^-]+-([a-zA-Z0-9]+)/, // /gifs/example-abc123def456
        /\/gif\/[^-]+-([a-zA-Z0-9]+)/, // /gif/example-abc123def456
        /\/([a-zA-Z0-9]{10,})/, // Any 10+ character alphanumeric ID
      ]

      for (const pattern of patterns) {
        const match = originalUrl.match(pattern)
        if (match) {
          gifId = match[1]
          break
        }
      }

      if (!gifId) {
        console.log(`${getTimestamp()} | ❌ Could not extract Giphy GIF ID from: ${originalUrl}`)
        return null
      }

      console.log(`${getTimestamp()} | 🔍 Extracted Giphy GIF ID: ${gifId}`)

      // Try different Giphy URL patterns
      const directUrlPatterns = [
        `https://media.giphy.com/media/${gifId}/giphy.gif`,
        `https://media0.giphy.com/media/${gifId}/giphy.gif`,
        `https://media1.giphy.com/media/${gifId}/giphy.gif`,
        `https://media2.giphy.com/media/${gifId}/giphy.gif`,
        `https://media3.giphy.com/media/${gifId}/giphy.gif`,
        `https://media4.giphy.com/media/${gifId}/giphy.gif`,
      ]

      for (const url of directUrlPatterns) {
        try {
          console.log(`${getTimestamp()} | 🔍 Trying Giphy direct URL: ${url}`)
          const isValid = await this.checkUrlIsGif(url)
          if (isValid) {
            console.log(`${getTimestamp()} | ✅ Found working Giphy GIF URL: ${url}`)
            return url
          }
        } catch (error) {
          console.log(`${getTimestamp()} | ❌ Giphy URL failed: ${url}`)
        }
      }

      // If direct URLs don't work, try parsing the HTML
      console.log(`${getTimestamp()} | 🔍 Trying to extract GIF URL from Giphy HTML...`)
      const html = await this.downloadHtmlContent(originalUrl)
      const extractedUrl = this.extractGifUrlFromHtml(html, originalUrl)

      if (extractedUrl) {
        const isValid = await this.checkUrlIsGif(extractedUrl)
        if (isValid) {
          return extractedUrl
        }
      }

      return null
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting Giphy direct URL:`, error)
      return null
    }
  }

  /**
   * Checks if a URL returns a valid GIF file
   */
  async checkUrlIsGif(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https:") ? https : http

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return this.checkUrlIsGif(response.headers.location).then(resolve).catch(reject)
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        // Check content type
        const contentType = response.headers["content-type"]
        if (!contentType || !contentType.includes("image/gif")) {
          reject(new Error(`Not a GIF: ${contentType}`))
          return
        }

        // Read first few bytes to verify GIF header
        let headerData = Buffer.alloc(0)
        let headerChecked = false

        response.on("data", (chunk) => {
          if (!headerChecked) {
            headerData = Buffer.concat([headerData, chunk])
            if (headerData.length >= 6) {
              const header = headerData.slice(0, 6).toString("ascii")
              if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
                headerChecked = true
                resolve(true)
                response.destroy() // We don't need the rest of the file
              } else {
                reject(new Error(`Invalid GIF header: ${header}`))
                response.destroy()
              }
            }
          }
        })

        response.on("end", () => {
          if (!headerChecked) {
            reject(new Error("Could not verify GIF header"))
          }
        })
      })

      request.on("error", (error) => {
        reject(error)
      })

      request.setTimeout(5000, () => {
        request.destroy()
        reject(new Error("Timeout"))
      })
    })
  }

  /**
   * Downloads a GIF from Tenor or Giphy URL
   */
  async downloadGifFromUrl(url) {
    try {
      console.log(`${getTimestamp()} | 🎬 Attempting to download GIF from: ${url}`)

      let directUrl = null

      // Handle Tenor URLs
      if (url.includes("tenor.com")) {
        directUrl = await this.getTenorDirectUrl(url)
      }
      // Handle Giphy URLs
      else if (url.includes("giphy.com")) {
        directUrl = await this.getGiphyDirectUrl(url)
      }
      // For other URLs, try as-is first, then try HTML parsing
      else {
        try {
          const isValid = await this.checkUrlIsGif(url)
          if (isValid) {
            directUrl = url
          }
        } catch (error) {
          console.log(`${getTimestamp()} | ⚠️ Original URL not a direct GIF, trying HTML parsing...`)
          try {
            const html = await this.downloadHtmlContent(url)
            const extractedUrl = this.extractGifUrlFromHtml(html, url)
            if (extractedUrl) {
              const isValid = await this.checkUrlIsGif(extractedUrl)
              if (isValid) {
                directUrl = extractedUrl
              }
            }
          } catch (htmlError) {
            console.error(`${getTimestamp()} | Error parsing HTML:`, htmlError)
          }
        }
      }

      if (!directUrl) {
        throw new Error("Could not find a valid direct GIF URL")
      }

      console.log(`${getTimestamp()} | 🔗 Using direct GIF URL: ${directUrl}`)

      const timestamp = Date.now()
      const filename = `gif_${timestamp}.gif`
      const tempFilePath = path.join(this.mediaManager.tempDir, filename)

      await this.downloadFile(directUrl, tempFilePath)

      // Verify the file was downloaded and has content
      const stats = await fs.stat(tempFilePath)
      if (stats.size === 0) {
        throw new Error("Downloaded file is empty")
      }

      // Verify it's actually a GIF file by checking the file header
      const buffer = await fs.readFile(tempFilePath, { start: 0, end: 5 })
      const header = buffer.toString("ascii")
      if (!header.startsWith("GIF87a") && !header.startsWith("GIF89a")) {
        throw new Error(`Downloaded file is not a valid GIF. Header: ${header}`)
      }

      console.log(`${getTimestamp()} | ✅ Downloaded valid GIF: ${filename} (${stats.size} bytes)`)
      return { filePath: tempFilePath, filename }
    } catch (error) {
      console.error(`${getTimestamp()} | ❌ Error downloading GIF from URL:\n`, error)
      return null
    }
  }

  /**
   * Uploads an image to Discord and returns the URL for use as thumbnail
   * @param {string} channelId - Discord channel ID
   * @param {Object} attachment - Discord attachment object
   * @returns {string|null} - Image URL or null if failed
   */
  async uploadImageForThumbnail(channelId, attachment) {
    try {
      const channel = await this.client.channels.fetch(channelId)
      if (!channel) {
        console.error(`${getTimestamp()} | Channel ${channelId} not found for thumbnail upload`)
        return null
      }

      // Send a temporary message with the image to get the URL
      const tempMessage = await channel.send({
        content: "🖼️ *Quoted image preview*",
        files: [attachment],
      })

      // Extract the image URL from the attachment
      if (tempMessage.attachments && tempMessage.attachments.size > 0) {
        const uploadedAttachment = tempMessage.attachments.first()
        const imageUrl = uploadedAttachment.url

        // Delete the temporary message after a short delay
        setTimeout(async () => {
          try {
            await tempMessage.delete()
          } catch (deleteError) {
            console.error(`${getTimestamp()} | Error deleting temporary thumbnail message:`, deleteError)
          }
        }, 1000) // 1 second delay

        return imageUrl
      }

      return null
    } catch (error) {
      console.error(`${getTimestamp()} | Error uploading image for thumbnail:\n`, error)
      return null
    }
  }

  setupEventHandlers() {
    this.client.once("ready", () => {
      console.log(`Discord bot logged in as ${this.client.user.tag}`)
      this.isReady = true
    })

    this.client.on("error", (error) => {
      console.error(`${getTimestamp()} | Discord client error:\n`, error)
    })

    this.client.on("disconnect", () => {
      console.log(`${getTimestamp()} | Discord client disconnected`)
      this.isReady = false
    })

    this.client.on("messageCreate", async (message) => {
      // Ignore messages from bots (including our own)
      if (message.author.bot) return

      // Check if this is a command in the stats channel
      if (this.statsChannelId && message.channel.id === this.statsChannelId && this.isCommand(message.content)) {
        const parsed = this.parseCommand(message.content)
        if (!parsed) return

        const { command, args } = parsed

        switch (command) {
          case "stats":
            await this.handleStatsCommand(message)
            break
          case "purge":
            await this.handlePurgeCommand(message)
            break
          case "pause":
            await this.handlePauseCommand(message)
            break
          case "start":
            await this.handleStartCommand(message)
            break
          case "getchats":
            await this.handleGetChatsCommand(message, args)
            break
          case "send":
            await this.handleSendCommand(message, args)
            break
          case "setenv":
            await this.handleSetEnvCommand(message, args)
            break
          case "help":
            await this.handleHelpCommand(message)
            break
        }
        return
      }

      // Check for commands in WhatsApp chat channels
      if (this.isCommand(message.content)) {
        const parsed = this.parseCommand(message.content)
        if (!parsed) return

        const { command } = parsed

        switch (command) {
          case "profile":
            await this.handleProfileCommand(message)
            break
          case "help":
            await this.handleHelpCommand(message)
            break
          case "mute":
            await this.handleMuteCommand(message)
            break
          case "unmute":
            await this.handleUnmuteCommand(message)
            break
          case "block":
            await this.handleBlockCommand(message)
            break
          case "unblock":
            await this.handleUnblockCommand(message)
            break
          case "sticker":
            if (message.attachments.size > 0) {
              await this.handleStickerCommand(message)
            }
            break
        }
        return
      }

      // Only process other messages in WhatsApp chat channels
      const waChatId = this.database.getWaChatIdFromChannel(message.channel.id)
      if (!waChatId) return

      try {
        // Check if message has attachments (media)
        if (message.attachments.size > 0) {
          await this.handleDiscordMediaMessage(message, waChatId)
        } else if (message.content.trim()) {
          // Check if message contains GIF URLs
          const gifUrls = this.extractGifUrls(message.content)
          if (gifUrls.length > 0) {
            await this.handleGifUrls(message, waChatId, gifUrls)
          } else {
            // Handle quoted messages
            let quotedContent = message.content.trim()
            if (message.reference && message.reference.messageId) {
              quotedContent = await this.handleQuotedMessage(message, waChatId)
            }

            // Record the message before sending to prevent echo
            if (this.database) {
              this.database.recordDiscordSentMessage(waChatId, quotedContent)
            }

            // Text message
            await this.whatsappManager.sendMessage(waChatId, quotedContent)
            await message.react("✅")
          }
        }

        console.log(`${getTimestamp()} | ✅ Forwarded message from Discord to WhatsApp chat ${waChatId}`)
      } catch (error) {
        console.error(`${getTimestamp()} | Error handling Discord message:\n`, error)
        // Notify the user of the error
        try {
          await message.react("❌")
        } catch (reactError) {
          console.error("Error adding reaction:", reactError)
        }
      }
    })
  }

  /**
   * Extracts GIF URLs from message content
   */
  extractGifUrls(content) {
    const gifUrlRegex = /(https?:\/\/(?:(?:www\.)?tenor\.com|(?:www\.)?giphy\.com)\/[^\s]+)/gi
    const urls = content.match(gifUrlRegex) || []

    // Log found URLs for debugging
    if (urls.length > 0) {
      console.log(`${getTimestamp()} | 🔍 Found GIF URLs:`, urls)
    }

    return urls
  }

  /**
   * Handles GIF URLs in Discord messages
   */
  async handleGifUrls(message, waChatId, gifUrls) {
    // Remove GIF URLs from the message content
    let messageContent = message.content
    for (const url of gifUrls) {
      messageContent = messageContent.replace(url, "").trim()
    }

    // If there's remaining text content after removing URLs, send it as a separate message
    if (messageContent) {
      // Record the text message to prevent echo
      if (this.database) {
        this.database.recordDiscordSentMessage(waChatId, messageContent)
      }

      await this.whatsappManager.sendMessage(waChatId, messageContent)
    }

    // Process each GIF URL
    for (const url of gifUrls) {
      let gifFilePath = null
      let mp4FilePath = null

      try {
        console.log(`${getTimestamp()} | 🎬 Processing GIF URL: ${url}`)

        const gifData = await this.downloadGifFromUrl(url)
        if (!gifData) {
          console.log(`${getTimestamp()} | ❌ Failed to download GIF from URL: ${url}`)
          await message.react("❌")
          continue
        }

        gifFilePath = gifData.filePath

        // Record the GIF for echo prevention using the media counter system
        if (this.database) {
          this.database.incrementPendingMediaCount(waChatId, 1) // 1 media file
        }

        // Try to convert GIF to MP4 for better WhatsApp compatibility
        if (this.mediaManager.ffmpegAvailable) {
          try {
            // Convert GIF to MP4 for WhatsApp compatibility
            mp4FilePath = await this.mediaManager.convertGifToMp4(gifFilePath)

            // Send as video GIF to WhatsApp using the proper method
            const mp4Filename = path.basename(mp4FilePath)
            await this.whatsappManager.sendVideoAsGif(waChatId, mp4FilePath, mp4Filename, "")

            await message.react("✅")
            console.log(`${getTimestamp()} | ✅ Sent converted GIF (MP4) to WhatsApp`)
          } catch (conversionError) {
            console.error(`${getTimestamp()} | ❌ Error converting GIF to MP4:`, conversionError)

            // Fallback: try sending original GIF as video
            await this.whatsappManager.sendVideo(waChatId, gifFilePath, gifData.filename, "")
            await message.react("✅")
            console.log(`${getTimestamp()} | ✅ Sent original GIF as video to WhatsApp (fallback)`)
          }
        } else {
          // FFmpeg not available, send as regular video
          await this.whatsappManager.sendVideo(waChatId, gifFilePath, gifData.filename, "")
          await message.react("✅")
          console.log(`${getTimestamp()} | ✅ Sent GIF as video to WhatsApp`)
        }
      } catch (error) {
        console.error(`${getTimestamp()} | ❌ Error handling GIF URL:`, error)
        await message.react("❌")
      } finally {
        // Clean up temp files
        if (gifFilePath && this.mediaManager) {
          await this.mediaManager.cleanupTempFile(gifFilePath)
        }
        if (mp4FilePath && this.mediaManager) {
          await this.mediaManager.cleanupTempFile(mp4FilePath)
        }
      }
    }
  }

  /**
   * Handles quoted messages from Discord
   */
  async handleQuotedMessage(message, waChatId) {
    try {
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId)
      if (referencedMessage) {
        // Get the quoted message info - improved handling
        let quotedContent = referencedMessage.content || ""

        // If the referenced message has embeds (WhatsApp messages), extract the content
        if (referencedMessage.embeds && referencedMessage.embeds.length > 0) {
          const embed = referencedMessage.embeds[0]

          // Extract content from embed description
          if (embed.description) {
            // Remove quotes and formatting from embed description
            quotedContent = embed.description
              .replace(/^\*\*Caption:\*\* "(.+)"$/, "$1") // Extract caption
              .replace(/^"(.+)"$/, "$1") // Remove outer quotes
              .replace(/^\*(.+)\*$/, "$1") // Remove italic formatting
          }

          // If still no content, use the embed title without emoji
          if (!quotedContent && embed.title) {
            quotedContent = embed.title.replace(/^[📷🎥🎵📄🎭📍💬❓🔐📱]\s*/u, "") // Remove emoji prefix
          }
        }

        // Fallback for attachments
        if (!quotedContent && referencedMessage.attachments.size > 0) {
          const attachment = referencedMessage.attachments.first()
          quotedContent = `[${attachment.name}]`
        }

        // Final fallback
        if (!quotedContent) {
          quotedContent = "[Media/Attachment]"
        }

        // Record the quote for potential reverse lookup
        this.database.recordQuotedMessage(
          message.reference.messageId,
          "discord",
          waChatId,
          message.channel.id,
          quotedContent,
          "Discord User", // Generic sender name
        )

        // Format the quoted message for WhatsApp with proper multi-line formatting
        const formattedQuote = this.formatMultiLineQuote(quotedContent)
        const quotedText = `${formattedQuote}\n\n${message.content}`
        return quotedText
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling quoted message:\n`, error)
    }

    return message.content
  }

  /**
   * Formats multi-line text with proper quote formatting for WhatsApp
   * @param {string} text - The text to format
   * @returns {string} - Formatted text with > prefix on each line
   */
  formatMultiLineQuote(text) {
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")
  }

  /**
   * Truncates text to ensure it fits within Discord embed limits
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length (default: 4000 chars)
   * @returns {string} - Truncated text
   */
  truncateForEmbed(text, maxLength = 4000) {
    if (!text || text.length <= maxLength) return text
    return text.substring(0, maxLength - 3) + "..."
  }

  async handleDiscordMediaMessage(message, waChatId) {
    const attachments = Array.from(message.attachments.values())

    // Track how many files we're sending for echo prevention
    if (this.database) {
      this.database.incrementPendingMediaCount(waChatId, attachments.length)
    }

    for (const attachment of attachments) {
      let tempFilePath = null

      try {
        console.log(`${getTimestamp()} | Processing Discord attachment: ${attachment.name} (${attachment.size} bytes)`)

        // Record the caption if present
        if (message.content.trim()) {
          this.database.recordDiscordSentMessage(waChatId, message.content.trim())
        }

        // Download the attachment
        tempFilePath = await this.downloadDiscordAttachment(attachment)

        if (!tempFilePath) {
          console.error(`${getTimestamp()} | Failed to download attachment`)
          await message.react("❌")
          continue
        }

        // Determine the media type and send to WhatsApp
        const mediaType = this.getMediaTypeFromAttachment(attachment)
        const caption = message.content || ""

        switch (mediaType) {
          case "image":
            await this.whatsappManager.sendImage(waChatId, tempFilePath, attachment.name, caption)
            break
          case "video":
            await this.whatsappManager.sendVideo(waChatId, tempFilePath, attachment.name, caption)
            break
          case "audio":
            await this.whatsappManager.sendAudio(waChatId, tempFilePath, attachment.name)
            break
          case "document":
            await this.whatsappManager.sendDocument(waChatId, tempFilePath, attachment.name, caption)
            break
          default:
            // Fallback to document for unknown types
            await this.whatsappManager.sendDocument(waChatId, tempFilePath, attachment.name, caption)
        }

        console.log(`${getTimestamp()} | ✅ Sent ${mediaType} to WhatsApp: ${attachment.name}`)
        await message.react("✅")
      } catch (error) {
        console.error(`${getTimestamp()} | Error processing attachment ${attachment.name}:\n`, error)
        await message.react("❌")
      } finally {
        // Clean up temp file
        if (tempFilePath && this.mediaManager) {
          await this.mediaManager.cleanupTempFile(tempFilePath)
        }
      }
    }
  }

  async downloadDiscordAttachment(attachment) {
    if (!this.mediaManager) {
      console.error(`${getTimestamp()} | Media manager not available`)
      return null
    }

    try {
      // Create temp file path
      const timestamp = Date.now()
      const extension = path.extname(attachment.name) || ".bin"
      const filename = `discord_${timestamp}${extension}`
      const tempFilePath = path.join(this.mediaManager.tempDir, filename)

      // Download the file
      await this.downloadFile(attachment.url, tempFilePath)

      if (process.env.NODE_ENV === "development") {
        console.log(`${getTimestamp()} | Downloaded Discord attachment to: ${tempFilePath}`)
      }
      return tempFilePath
    } catch (error) {
      console.error(`${getTimestamp()} | Error downloading Discord attachment:\n`, error)
      return null
    }
  }

  downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https:") ? https : http

      console.log(`${getTimestamp()} | 📥 Downloading: ${url}`)

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`${getTimestamp()} | 🔄 Redirecting to: ${response.headers.location}`)
          return this.downloadFile(response.headers.location, filePath).then(resolve).catch(reject)
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
          return
        }

        // Check content type for GIF files
        const contentType = response.headers["content-type"]
        if (url.includes(".gif") && contentType && !contentType.includes("image/gif")) {
          console.warn(`${getTimestamp()} | ⚠️ Warning: Expected GIF but got ${contentType}`)
        }

        const fileStream = fs.createWriteStream(filePath)
        let downloadedBytes = 0

        response.on("data", (chunk) => {
          downloadedBytes += chunk.length
        })

        response.pipe(fileStream)

        fileStream.on("finish", () => {
          fileStream.close()
          console.log(`${getTimestamp()} | ✅ Download complete: ${downloadedBytes} bytes`)
          resolve()
        })

        fileStream.on("error", (error) => {
          fs.unlink(filePath, () => {}) // Clean up on error
          reject(error)
        })
      })

      request.on("error", (error) => {
        reject(error)
      })

      request.setTimeout(30000, () => {
        request.destroy()
        reject(new Error("Download timeout"))
      })
    })
  }

  getMediaTypeFromAttachment(attachment) {
    const { contentType, name } = attachment

    // Check content type first
    if (contentType) {
      if (contentType.startsWith("image/")) return "image"
      if (contentType.startsWith("video/")) return "video"
      if (contentType.startsWith("audio/")) return "audio"
    }

    // Fallback to file extension
    if (name) {
      const ext = path.extname(name).toLowerCase()

      const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]
      const videoExts = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".flv"]
      const audioExts = [".mp3", ".wav", ".ogg", ".aac", ".m4a", ".flac"]

      if (imageExts.includes(ext)) return "image"
      if (videoExts.includes(ext)) return "video"
      if (audioExts.includes(ext)) return "audio"
    }

    return "document"
  }

  async handleStatsCommand(message) {
    if (!this.statsManager) {
      await message.reply(`${getTimestamp()} | Stats manager not available`)
      return
    }

    try {
      // Show typing indicator
      await message.channel.sendTyping()

      // Generate stats
      const stats = await this.statsManager.generateStats()
      const formattedStats = this.statsManager.formatStats(stats, "discord")

      // Send stats
      await message.reply(formattedStats)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling stats command:\n`, error)
      await message.reply("Error generating statistics")
    }
  }

  async handleSetEnvCommand(message, args) {
    try {
      if (args.length < 2) {
        await message.reply(`❌ **Usage:** \`${this.commandPrefix}setenv <production|development>\``)
        return
      }

      const newEnv = args[1].toLowerCase()
      if (newEnv !== "production" && newEnv !== "development") {
        await message.reply(`❌ **Invalid environment**\nMust be either 'production' or 'development'`)
        return
      }

      // Update database and environment
      this.database.setNodeEnv(newEnv)

      await message.reply(`✅ **Environment updated**\nNODE_ENV is now set to: \`${newEnv}\``)
      console.log(`${getTimestamp()} | 🔧 NODE_ENV changed to: ${newEnv}`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling setenv command:\n`, error)
      await message.reply("❌ Error updating environment setting")
    }
  }

  async login() {
    if (!process.env.DISCORD_BOT_TOKEN) {
      throw new Error("DISCORD_BOT_TOKEN environment variable is not set")
    }

    try {
      await this.client.login(process.env.DISCORD_BOT_TOKEN)
      return true
    } catch (error) {
      console.error(`${getTimestamp()} | Failed to login to Discord:\n`, error)
      throw error
    }
  }

  async getOrCreateChannel(chatId, chatName, db, chatType = "contact") {
    if (!this.isReady) {
      throw new Error(`${getTimestamp()} | Discord client is not ready`)
    }

    try {
      // Check if we already have a channel for this chat
      const existingMapping = db.getChatMapping(chatId)

      if (existingMapping) {
        // Update chat type if not set
        if (!existingMapping.chat_type) {
          db.updateChatType(chatId, chatType)
        }

        // Verify the channel still exists
        try {
          const channel = await this.client.channels.fetch(existingMapping.dc_channel_id)
          if (channel) {
            db.updateLastActivity(chatId)
            return existingMapping.dc_channel_id
          }
        } catch (error) {
          console.log(`${getTimestamp()} | Channel ${existingMapping.dc_channel_id} no longer exists, creating new one`)
        }
      }

      // Create a new text channel
      const guildId = process.env.DISCORD_GUILD_ID
      if (!guildId) {
        throw new Error("DISCORD_GUILD_ID environment variable is not set")
      }

      const guild = await this.client.guilds.fetch(guildId)
      if (!guild) {
        throw new Error(`${getTimestamp()} | Discord guild ${guildId} not found`)
      }

      // Get the category ID from environment variable
      const categoryId = process.env.DISCORD_CHANNEL_ID
      let parentCategory = null

      if (categoryId) {
        try {
          parentCategory = await this.client.channels.fetch(categoryId)
          if (!parentCategory || parentCategory.type !== ChannelType.GuildCategory) {
            console.warn(
              `${getTimestamp()} | Warning: DISCORD_CHANNEL_ID ${categoryId} is not a valid category. Creating channels without category.`,
            )
            parentCategory = null
          }
        } catch (error) {
          console.warn(
            `${getTimestamp()} | Warning: Could not fetch category ${categoryId}. Creating channels without category.`,
          )
          parentCategory = null
        }
      } else {
        console.warn(`${getTimestamp()} | Warning: DISCORD_CHANNEL_ID not set. Creating channels without category.`)
      }

      // Clean up chat name for channel name with chat type indicator
      const typeEmoji = chatType === "group" ? "👥" : "👤"
      const channelName = this.sanitizeChannelName(
        `${typeEmoji}-${chatName || `wa-${chatType}-${chatId.substring(0, 10)}`}`,
      )

      const channelOptions = {
        name: channelName,
        type: ChannelType.GuildText,
        reason: `Channel for WhatsApp ${chatType}: ${chatName || chatId}`,
      }

      // Add parent category if available
      if (parentCategory) {
        channelOptions.parent = parentCategory.id
      }

      const channel = await guild.channels.create(channelOptions)

      // Store the new channel ID in the database
      if (existingMapping) {
        // Update existing mapping
        const stmt = db.db.prepare(
          "UPDATE chat_mappings SET dc_channel_id = ?, chat_name = ?, chat_type = ? WHERE wa_chat_id = ?",
        )
        stmt.run(channel.id, chatName, chatType, chatId)
      } else {
        // Create new mapping
        db.createChatMapping(chatId, channel.id, chatName, chatType)
      }

      // Send initial message to the channel
      const typeText = chatType === "group" ? "Group Chat" : "Contact"
      const initialMessage =
        `🔗 **WhatsApp ${typeText} Connected**\n` +
        `📱 **Chat ID:** \`${chatId}\`\n` +
        `${typeEmoji} **${typeText} Name:** ${chatName || "Unknown"}\n` +
        `⏰ **Connected:** ${new Date().toLocaleString()}`

      await channel.send(initialMessage)

      const categoryInfo = parentCategory ? ` in category "${parentCategory.name}"` : " (no category)"
      console.log(
        `${getTimestamp()} | Created new channel ${channel.id} for WhatsApp ${chatType} ${chatId}${categoryInfo}`,
      )
      return channel.id
    } catch (error) {
      console.error(`${getTimestamp()} | Error creating/getting channel:\n`, error)
      throw error
    }
  }

  sanitizeChannelName(name) {
    // Discord channel names have restrictions
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, "") // Remove special characters except hyphens and spaces
      .replace(/\s+/g, "-") // Replace spaces with hyphens
      .substring(0, 90) // Limit length
      .trim()
  }

  async sendMessageToChannel(channelId, content, options = {}) {
    if (!this.isReady) {
      throw new Error(`${getTimestamp()} | Discord client is not ready`)
    }

    try {
      const channel = await this.client.channels.fetch(channelId)
      if (!channel) {
        throw new Error(`${getTimestamp()} | Channel ${channelId} not found`)
      }

      return await channel.send(content)
    } catch (error) {
      console.error(`${getTimestamp()} | Error sending message to channel ${channelId}:\n`, error)
      throw error
    }
  }

  async sendEmbedToChannel(channelId, embed) {
    if (!this.isReady) {
      throw new Error(`${getTimestamp()} | Discord client is not ready`)
    }

    try {
      const channel = await this.client.channels.fetch(channelId)
      if (!channel) {
        throw new Error(`${getTimestamp()} | Channel ${channelId} not found`)
      }

      return await channel.send({ embeds: [embed] })
    } catch (error) {
      console.error(`${getTimestamp()} | Error sending embed to channel ${channelId}:\n`, error)
      throw error
    }
  }

  async sendMediaToChannel(channelId, mediaAttachment, messageData) {
    if (!this.isReady) {
      throw new Error(`${getTimestamp()} | Discord client is not ready`)
    }

    try {
      const channel = await this.client.channels.fetch(channelId)
      if (!channel) {
        throw new Error(`${getTimestamp()} | Channel ${channelId} not found`)
      }

      if (mediaAttachment.error) {
        // Handle file too large or other errors using embed
        const errorEmbed = {
          title: `❌ ${mediaAttachment.description}`,
          description: mediaAttachment.error,
          color: 0xe74c3c, // Red color for errors
          author: {
            name: messageData.senderName,
          },
          timestamp: new Date(messageData.timestamp * 1000).toISOString(),
        }
        return await channel.send({ embeds: [errorEmbed] })
      }

      // Create embed for media message
      const embed = {
        title: `${this.getMessageTypeEmoji(messageData.type)} ${mediaAttachment.description}`,
        color: this.getUserColor(messageData.senderId, messageData.isOwnMessage),
        author: {
          name: messageData.isOwnMessage
            ? messageData.senderName
            : `${messageData.senderName}\n${messageData.formattedSenderId}`,
        },
        timestamp: new Date(messageData.timestamp * 1000).toISOString(),
        footer: {
          text: `Size: ${mediaAttachment.size}`,
        },
      }

      // Add caption if available
      if (mediaAttachment.caption) {
        embed.description = `**Caption:** "${this.truncateForEmbed(mediaAttachment.caption)}"`
      }

      // Add quoted media as thumbnail if available
      if (messageData.quotedThumbnailUrl && messageData.quotedThumbnailUrl.startsWith("http")) {
        embed.thumbnail = { url: messageData.quotedThumbnailUrl }
      }

      // Send message with attachment and embed together
      const messageOptions = {
        embeds: [embed],
        files: [mediaAttachment.attachment],
      }

      return await channel.send(messageOptions)
    } catch (error) {
      console.error(`${getTimestamp()} | Error sending media to channel ${channelId}:\n`, error)
      throw error
    }
  }

  /**
   * Creates an embed for a WhatsApp message
   */
  createMessageEmbed(message, isOwnMessage = false) {
    const { body, sender, type, timestamp, caption } = message
    let senderName = "Unknown"
    let senderId = "unknown"

    if (isOwnMessage) {
      senderName = "You"
      senderId = "own"
    } else {
      senderName = sender?.pushname || sender?.name || "Unknown"
      senderId = sender?.id || sender?.number || "unknown"
    }

    // Format senderId for display (remove @c.us and add +)
    let formattedSenderId = ""
    if (!isOwnMessage && senderId && senderId !== "unknown") {
      formattedSenderId = senderId.replace("@c.us", "").replace("@g.us", "")
      if (formattedSenderId && !formattedSenderId.startsWith("+")) {
        formattedSenderId = "+" + formattedSenderId
      }
    }

    const messageTime = new Date(timestamp * 1000)
    const messageText = caption || body

    // Create base embed
    const embed = {
      color: this.getUserColor(senderId, isOwnMessage),
      author: {
        name: isOwnMessage ? senderName : `${senderName}\n${formattedSenderId}`,
      },
      timestamp: messageTime.toISOString(),
    }

    // Handle different message types
    switch (type) {
      case "chat":
      case "text":
        embed.title = `${this.getMessageTypeEmoji(type)} Message`
        embed.description = messageText ? `"${this.truncateForEmbed(messageText)}"` : "*No text content*"
        break

      case "image":
        embed.title = `${this.getMessageTypeEmoji(type)} Image`
        if (messageText) {
          embed.description = `**Caption:** "${this.truncateForEmbed(messageText)}"`
        }
        break

      case "video":
        embed.title = `${this.getMessageTypeEmoji(type)} Video`
        if (messageText) {
          embed.description = `**Caption:** "${this.truncateForEmbed(messageText)}"`
        }
        break

      case "audio":
      case "ptt":
        embed.title = `${this.getMessageTypeEmoji(type)} ${type === "ptt" ? "Voice Message" : "Audio"}`
        break

      case "document":
        embed.title = `${this.getMessageTypeEmoji(type)} Document`
        if (messageText) {
          embed.description = `**Filename:** "${this.truncateForEmbed(messageText)}"`
        }
        break

      case "sticker":
        embed.title = `${this.getMessageTypeEmoji(type)} Sticker`
        break

      case "location":
        embed.title = `${this.getMessageTypeEmoji(type)} Location`
        embed.description = "Location shared"
        break

      case "cipher":
        embed.title = `${this.getMessageTypeEmoji(type)} Cipher Message`
        embed.description =
          "⚠️ **Unsupported Message-Type for WhatsApp-Web**\nThis message type cannot be processed by the bridge."
        embed.color = 0xffa500 // Orange color for warnings
        break

      default:
        embed.title = `${this.getMessageTypeEmoji(type)} ${type.charAt(0).toUpperCase() + type.slice(1)} Message`
        if (messageText) {
          embed.description = `"${this.truncateForEmbed(messageText)}"`
        }
    }

    return embed
  }

  /**
   * Creates a normal message for reactions (not embed)
   */
  createReactionMessage(displayName, reactText, isOwnMessage = false) {
    return `💫 **${displayName}** reacted with ${reactText}`
  }

  async destroy() {
    if (this.client) {
      await this.client.destroy()
    }
  }

  // ... rest of the methods remain the same as in the original file
  async handlePurgeCommand(message) {
    try {
      await message.channel.sendTyping()

      // Get confirmation
      const confirmMsg = await message.reply(
        "⚠️ **WARNING**: This will delete ALL chat mappings and Discord channels!\n\nReact with ✅ to confirm or ❌ to cancel.",
      )

      await confirmMsg.react("✅")
      await confirmMsg.react("❌")

      // Wait for reaction
      const filter = (reaction, user) => {
        return ["✅", "❌"].includes(reaction.emoji.name) && user.id === message.author.id
      }

      const collected = await confirmMsg.awaitReactions({ filter, max: 1, time: 30000 })

      if (collected.size === 0) {
        await confirmMsg.edit("❌ Purge cancelled - no response received.")
        return
      }

      const reaction = collected.first()

      if (reaction.emoji.name === "❌") {
        await confirmMsg.edit("❌ Purge cancelled by user.")
        return
      }

      if (reaction.emoji.name === "✅") {
        // Perform purge
        const channelIds = this.database.purgeAllData()

        // Delete Discord channels
        let deletedCount = 0
        for (const channelId of channelIds) {
          try {
            const channel = await this.client.channels.fetch(channelId)
            if (channel) {
              await channel.delete("Purged by admin command")
              deletedCount++
            }
          } catch (error) {
            console.error(`${getTimestamp()} | Error deleting channel ${channelId}:\n`, error)
          }
        }

        await confirmMsg.edit(
          `✅ **Purge completed!**\n📊 Deleted ${channelIds.length} chat mappings\n📺 Deleted ${deletedCount} Discord channels\n🗄️ Cleared all message logs`,
        )
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling purge command:\n`, error)
      await message.reply("❌ Error executing purge command")
    }
  }

  async handlePauseCommand(message) {
    try {
      this.database.setPauseState(true)
      await message.reply("⏸️ **Bridge paused**\nNo messages will be forwarded until you use `!start`")
      console.log(`${getTimestamp()} | 🔴 Bridge paused by admin command`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling pause command:\n`, error)
      await message.reply("❌ Error pausing bridge")
    }
  }

  async handleStartCommand(message) {
    try {
      this.database.setPauseState(false)
      await message.reply("▶️ **Bridge resumed**\nMessage forwarding is now active")
      console.log(`${getTimestamp()} | 🟢 Bridge resumed by admin command`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling start command:\n`, error)
      await message.reply("❌ Error starting bridge")
    }
  }

  async handleProfileCommand(message) {
    if (!this.whatsappManager || !this.whatsappManager.client) {
      await message.reply("❌ WhatsApp client not available")
      return
    }

    try {
      await message.channel.sendTyping()

      // Get the WhatsApp chat ID for this channel
      const channelId = message.channel.id
      const stmt = this.database.db.prepare(
        "SELECT wa_chat_id, chat_name, chat_type FROM chat_mappings WHERE dc_channel_id = ?",
      )
      const mapping = stmt.get(channelId)

      if (!mapping) {
        await message.reply("❌ This channel is not linked to any WhatsApp chat")
        return
      }

      if (mapping.chat_type === "group") {
        await message.reply("❌ Profile command only works for individual contacts, not groups")
        return
      }

      // Get profile information
      const profile = await this.whatsappManager.getContactProfile(mapping.wa_chat_id)

      if (!profile) {
        await message.reply("❌ Could not retrieve profile information")
        return
      }

      // Create profile embed
      const embed = {
        title: "👤 Contact Profile",
        fields: [
          { name: "Name", value: profile.name || "Unknown", inline: true },
          { name: "Phone", value: profile.number || "Unknown", inline: true },
          { name: "Status", value: profile.status || "No status", inline: false },
        ],
        color: 0x25d366, // WhatsApp green
        timestamp: new Date().toISOString(),
        footer: { text: "WhatsApp Profile" },
      }

      // Add profile picture if available
      if (profile.profilePicUrl) {
        embed.thumbnail = { url: profile.profilePicUrl }
      }

      await message.reply({ embeds: [embed] })
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling profile command:\n`, error)
      await message.reply("❌ Error retrieving profile information")
    }
  }

  async handleStickerCommand(message) {
    try {
      // Get the WhatsApp chat ID
      const channelId = message.channel.id
      const stmt = this.database.db.prepare("SELECT wa_chat_id FROM chat_mappings WHERE dc_channel_id = ?")
      const mapping = stmt.get(channelId)

      if (!mapping) {
        await message.reply("⚠️ This channel is not linked to any WhatsApp chat.")
        return
      }

      const waChatId = mapping.wa_chat_id
      const attachments = Array.from(message.attachments.values())

      for (const attachment of attachments) {
        let tempFilePath = null

        try {
          // Only process images and videos for stickers
          const mediaType = this.getMediaTypeFromAttachment(attachment)
          if (!["image", "video"].includes(mediaType)) {
            await message.reply(
              `❌ ${attachment.name} is not an image or video. Stickers can only be created from images or videos.`,
            )
            continue
          }

          // Record the sticker message to prevent echo
          if (this.database) {
            this.database.recordDiscordSentMessage(waChatId, `!sticker ${attachment.name}`)
          }

          // Download the attachment
          tempFilePath = await this.downloadDiscordAttachment(attachment)

          if (!tempFilePath) {
            await message.reply(`❌ Failed to download ${attachment.name}`)
            continue
          }

          // Send as sticker to WhatsApp
          await this.whatsappManager.sendSticker(waChatId, tempFilePath, attachment.name)

          console.log(`${getTimestamp()} | ✅ Sent sticker to WhatsApp: ${attachment.name}`)
          await message.react("✅")
        } catch (error) {
          console.error(`${getTimestamp()} | Error processing sticker ${attachment.name}:\n`, error)
          await message.react("❌")
        } finally {
          // Clean up temp file
          if (tempFilePath && this.mediaManager) {
            await this.mediaManager.cleanupTempFile(tempFilePath)
          }
        }
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling sticker command:\n`, error)
      await message.react("❌")
    }
  }

  async handleHelpCommand(message) {
    try {
      const helpText = this.getHelpText("discord")
      await message.reply(helpText)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling help command:\n`, error)
      await message.reply("❌ Error displaying help information")
    }
  }

  async handleMuteCommand(message) {
    try {
      const channelId = message.channel.id
      const waChatId = this.database.getWaChatIdFromChannel(channelId)

      if (!waChatId) {
        await message.reply("❌ This channel is not linked to any WhatsApp chat")
        return
      }

      this.database.setChatMuteState(waChatId, true)
      await message.reply("🔇 **Chat muted**\nMessages from this WhatsApp chat will no longer be forwarded to Discord")
      console.log(`${getTimestamp()} | 🔇 Muted WhatsApp chat ${waChatId}`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling mute command:\n`, error)
      await message.reply("❌ Error muting chat")
    }
  }

  async handleUnmuteCommand(message) {
    try {
      const channelId = message.channel.id
      const waChatId = this.database.getWaChatIdFromChannel(channelId)

      if (!waChatId) {
        await message.reply("❌ This channel is not linked to any WhatsApp chat")
        return
      }

      this.database.setChatMuteState(waChatId, false)
      await message.reply("🔊 **Chat unmuted**\nMessages from this WhatsApp chat will now be forwarded to Discord")
      console.log(`${getTimestamp()} | 🔊 Unmuted WhatsApp chat ${waChatId}`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling unmute command:\n`, error)
      await message.reply("❌ Error unmuting chat")
    }
  }

  async handleBlockCommand(message) {
    if (!this.whatsappManager || !this.whatsappManager.client) {
      await message.reply("❌ WhatsApp client not available")
      return
    }

    try {
      const channelId = message.channel.id
      const stmt = this.database.db.prepare(
        "SELECT wa_chat_id, chat_name, chat_type FROM chat_mappings WHERE dc_channel_id = ?",
      )
      const mapping = stmt.get(channelId)

      if (!mapping) {
        await message.reply("❌ This channel is not linked to any WhatsApp chat")
        return
      }

      if (mapping.chat_type === "group") {
        await message.reply("❌ Block command only works for individual contacts, not groups")
        return
      }

      const waChatId = mapping.wa_chat_id
      const result = await this.whatsappManager.blockContact(waChatId)

      if (result) {
        await message.reply("🚫 **Contact blocked**\nThis contact has been blocked on WhatsApp")
        console.log(`${getTimestamp()} | 🚫 Blocked WhatsApp contact ${waChatId}`)
      } else {
        await message.reply("❌ Failed to block contact")
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling block command:\n`, error)
      await message.reply("❌ Error blocking contact")
    }
  }

  async handleUnblockCommand(message) {
    if (!this.whatsappManager || !this.whatsappManager.client) {
      await message.reply("❌ WhatsApp client not available")
      return
    }

    try {
      const channelId = message.channel.id
      const stmt = this.database.db.prepare(
        "SELECT wa_chat_id, chat_name, chat_type FROM chat_mappings WHERE dc_channel_id = ?",
      )
      const mapping = stmt.get(channelId)

      if (!mapping) {
        await message.reply("❌ This channel is not linked to any WhatsApp chat")
        return
      }

      if (mapping.chat_type === "group") {
        await message.reply("❌ Unblock command only works for individual contacts, not groups")
        return
      }

      const waChatId = mapping.wa_chat_id
      const result = await this.whatsappManager.unblockContact(waChatId)

      if (result) {
        await message.reply("✅ **Contact unblocked**\nThis contact has been unblocked on WhatsApp")
        console.log(`${getTimestamp()} | ✅ Unblocked WhatsApp contact ${waChatId}`)
      } else {
        await message.reply("❌ Failed to unblock contact")
      }
    } catch (error) {
      console.error(`Error handling unblock command:\n`, error)
      await message.reply("❌ Error unblocking contact")
    }
  }

  async handleGetChatsCommand(message, args) {
    if (!this.whatsappManager || !this.whatsappManager.client) {
      await message.reply("❌ WhatsApp client not available")
      return
    }

    try {
      await message.channel.sendTyping()

      // Parse page number (default to 1)
      let page = 1
      if (args.length > 1) {
        const pageArg = Number.parseInt(args[1])
        if (!isNaN(pageArg) && pageArg > 0) {
          page = pageArg
        }
      }

      const chats = await this.whatsappManager.getAllChats()
      const chatsPerPage = 10
      const totalPages = Math.ceil(chats.length / chatsPerPage)

      if (page > totalPages) {
        await message.reply(`❌ Page ${page} does not exist. Total pages: ${totalPages}`)
        return
      }

      const startIndex = (page - 1) * chatsPerPage
      const endIndex = startIndex + chatsPerPage
      const pageChats = chats.slice(startIndex, endIndex)

      // Cache the full chat list for this user
      this.setChatListCache(message.author.id, chats)

      let chatList = `📱 **WhatsApp Chats (Page ${page}/${totalPages})**\n\n`

      for (let i = 0; i < pageChats.length; i++) {
        const chat = pageChats[i]
        const chatNumber = startIndex + i + 1
        const chatType = chat.id.endsWith("@g.us") ? "👥 Group" : "👤 Contact"
        const phoneNumber = chat.id.replace("@c.us", "").replace("@g.us", "")
        const formattedPhone = chat.id.endsWith("@c.us") ? `+${phoneNumber}` : "N/A"

        chatList += `**${chatNumber}.** ${chatType}\n`
        chatList += `📝 **Name:** ${chat.name || "Unknown"}\n`
        chatList += `📞 **Phone:** ${formattedPhone}\n`
        chatList += `🆔 **ID:** \`${chat.id}\`\n`
        chatList += `💬 **Messages:** ${chat.msgs ? chat.msgs.length : 0}\n\n`
      }

      chatList += `---\n**Total Chats:** ${chats.length} | **Page:** ${page}/${totalPages}`

      if (page < totalPages) {
        chatList += `\nUse \`${this.commandPrefix}getchats ${page + 1}\` for next page`
      }

      chatList += `\n\n💡 **Tip:** Use \`${this.commandPrefix}send <number> <message>\` to send to a chat by its number!`

      await message.reply(chatList)
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling getchats command:\n`, error)
      await message.reply("❌ Error retrieving chats")
    }
  }

  async handleSendCommand(message, args) {
    if (!this.whatsappManager || !this.whatsappManager.client) {
      await message.reply("❌ WhatsApp client not available")
      return
    }

    try {
      if (args.length < 3) {
        await message.reply(
          `❌ **Usage:** \`${this.commandPrefix}send <index|phone_number|chat_id> <message>\`\n` +
            "**Examples:**\n" +
            `• \`${this.commandPrefix}send 1 Hello there!\` (chat index from ${this.commandPrefix}getchats)\n` +
            `• \`${this.commandPrefix}send 1234567890 Hello there!\` (contact by phone)\n` +
            `• \`${this.commandPrefix}send 1234567890@c.us Hello there!\` (contact by chat ID)\n` +
            `• \`${this.commandPrefix}send 1234567890@g.us Hello everyone!\` (group by chat ID)`,
        )
        return
      }

      // Extract identifier and message
      let chatIdentifier = args[1]
      const messageText = args.slice(2).join(" ")

      let chatId = null
      let chatInfo = null
      let identifierType = "unknown"

      // Check if it's a numeric index (from !getchats)
      const indexNumber = Number.parseInt(chatIdentifier)
      if (!isNaN(indexNumber) && indexNumber > 0) {
        // It's an index, get from cache
        const cachedChats = this.getChatListCache(message.author.id)
        if (!cachedChats) {
          await message.reply(
            "❌ **Chat list cache expired**\n" +
              `Please run \`${this.commandPrefix}getchats\` first to refresh the chat list, then try again.`,
          )
          return
        }

        if (indexNumber > cachedChats.length) {
          await message.reply(`❌ **Invalid chat index**\nThere are only ${cachedChats.length} chats available.`)
          return
        }

        const selectedChat = cachedChats[indexNumber - 1]
        chatId = selectedChat.id
        chatInfo = {
          name: selectedChat.name || "Unknown",
          type: selectedChat.id.endsWith("@g.us") ? "group" : "contact",
        }
        identifierType = "index"

        // Show confirmation dialog
        const chatType = chatInfo.type === "group" ? "👥 Group" : "👤 Contact"
        const phoneNumber = chatId.replace("@c.us", "").replace("@g.us", "")
        const formattedPhone = chatId.endsWith("@c.us") ? `+${phoneNumber}` : "N/A"

        const confirmMsg = await message.reply(
          `🔍 **Confirm sending message to:**\n\n` +
            `**${indexNumber}.** ${chatType}\n` +
            `📝 **Name:** ${chatInfo.name}\n` +
            `📞 **Phone:** ${formattedPhone}\n` +
            `🆔 **ID:** \`${chatId}\`\n` +
            `💬 **Message:** "${messageText}"\n\n` +
            `React with ✅ to confirm or ❌ to cancel.`,
        )

        await confirmMsg.react("✅")
        await confirmMsg.react("❌")

        // Wait for reaction
        const filter = (reaction, user) => {
          return ["✅", "❌"].includes(reaction.emoji.name) && user.id === message.author.id
        }

        const collected = await confirmMsg.awaitReactions({ filter, max: 1, time: 30000 })

        if (collected.size === 0) {
          await confirmMsg.edit("❌ Send cancelled - no response received.")
          return
        }

        const reaction = collected.first()

        if (reaction.emoji.name === "❌") {
          await confirmMsg.edit("❌ Send cancelled by user.")
          return
        }

        // User confirmed, proceed with sending
        await confirmMsg.edit("📤 **Sending message...**")
      } else {
        // Handle phone number or chat ID as before
        if (!chatIdentifier.includes("@")) {
          // It's a phone number, convert to chat ID
          identifierType = "phone"
          // Remove any non-digit characters except +
          chatIdentifier = chatIdentifier.replace(/[^\d+]/g, "")
          // Remove leading + if present
          if (chatIdentifier.startsWith("+")) {
            chatIdentifier = chatIdentifier.substring(1)
          }
          // Add @c.us suffix for contacts
          chatId = chatIdentifier + "@c.us"
        } else {
          // It's already a chat ID
          chatId = chatIdentifier
          identifierType = "chatId"
        }

        // Validate chat ID format
        if (!chatId.endsWith("@c.us") && !chatId.endsWith("@g.us")) {
          await message.reply("❌ Invalid chat ID format. Must end with @c.us (contact) or @g.us (group)")
          return
        }
      }

      // Check if chat exists
      const chatExists = await this.whatsappManager.checkChatExists(chatId)
      if (!chatExists) {
        const chatType = chatId.endsWith("@g.us") ? "group" : "contact"
        await message.reply(
          `❌ ${chatType.charAt(0).toUpperCase() + chatType.slice(1)} \`${chatId}\` does not exist.\n` +
            `You can only send messages to ${chatType}s that already have an open chat on your WhatsApp.`,
        )
        return
      }

      // Send the message to WhatsApp
      const result = await this.whatsappManager.sendMessage(chatId, messageText)

      if (!result) {
        await message.reply("❌ Failed to send message to WhatsApp")
        return
      }

      console.log(`${getTimestamp()} | 📤 Sent message via ${this.commandPrefix}send command to ${chatId}`)

      // Check if this chat already has a Discord channel
      const existingMapping = this.database.getChatMapping(chatId)
      let channelId
      let isNewChannel = false

      if (existingMapping) {
        // Use existing channel
        channelId = existingMapping.dc_channel_id
      } else {
        // Create a new channel for this chat
        isNewChannel = true

        // Get chat info for channel creation if not already available
        if (!chatInfo) {
          const retrievedChatInfo = await this.whatsappManager.getChatInfo(chatId)
          chatInfo = retrievedChatInfo || {
            name: identifierType === "phone" ? `+${chatIdentifier}` : chatId,
            type: chatId.endsWith("@g.us") ? "group" : "contact",
          }
        }

        // Create channel
        try {
          channelId = await this.getOrCreateChannel(chatId, chatInfo.name, this.database, chatInfo.type)
        } catch (error) {
          console.error(
            `${getTimestamp()} | Error creating channel while using ${this.commandPrefix}send command:\n`,
            error,
          )
          await message.reply("✅ Message sent to WhatsApp, but failed to create Discord channel")
          return
        }
      }

      // Format response message
      const chatType = chatId.endsWith("@g.us") ? "Group" : "Contact"
      let displayId = chatId

      if (identifierType === "phone") {
        displayId = `+${chatIdentifier}`
      } else if (identifierType === "index") {
        displayId = `#${indexNumber} (${chatInfo.name})`
      }

      // Send confirmation to the admin channel
      const confirmationMessage =
        `✅ **Message sent successfully**\n` +
        `**${chatType}:** \`${displayId}\`\n` +
        `**Message:** "${messageText}"\n` +
        `${isNewChannel ? "📺 **New channel created!**" : "📺 **Sent to existing channel**"}`

      if (identifierType === "index") {
        // Edit the existing confirmation message
        const confirmMsg = await message.channel.messages.fetch(message.id)
        const replies = await message.channel.messages.fetch({ after: message.id, limit: 10 })
        const botReply = replies.find((msg) => msg.author.bot && msg.content.includes("Sending message"))

        if (botReply) {
          await botReply.edit(confirmationMessage)
        } else {
          await message.reply(confirmationMessage)
        }
      } else {
        await message.reply(confirmationMessage)
      }

      // Also send the message to the channel to show it was sent
      try {
        // Create a message embed for the sent message
        const embed = {
          title: "📤 Outgoing Message",
          description: `"${messageText}"`,
          color: this.ownMessageColor, // WhatsApp green for own messages
          author: {
            name: `You (via ${this.commandPrefix}send ${identifierType === "index" ? `#${indexNumber}` : "command"})`,
          },
          timestamp: new Date().toISOString(),
          footer: {
            text: "Message sent from admin channel",
          },
        }

        await this.sendEmbedToChannel(channelId, embed)
      } catch (error) {
        console.error(`${getTimestamp()} | Error sending confirmation to channel:\n`, error)
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error handling send command:\n`, error)
      await message.reply("❌ Error sending message")
    }
  }

  /**
   * Gets formatted help text for the specified platform
   * @param {string} platform "discord" or "whatsapp"
   * @returns {string} Formatted help text
   */
  getHelpText(platform = "discord") {
    const isMd = platform === "discord"
    const b = (text) => (isMd ? `**${text}**` : text) // Bold
    const c = (text) => (isMd ? `\`${text}\`` : text) // Code
    const nl = "\n"
    const hr = isMd ? "---" : "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    let help = ""

    // Header
    help += b("🌉 WHATSAPP DISCORD BRIDGE") + nl
    help += "Advanced bridge for seamless WhatsApp ↔ Discord communication" + nl + nl

    // Features
    help += b("✨ KEY FEATURES") + nl
    help += "🔄 Two-way message forwarding" + nl
    help += "📱 Complete media support (images, videos, audio, documents)" + nl
    help += "🎨 Beautiful embed formatting with user-specific colors" + nl
    help += "👥 Group chat support" + nl
    help += "📊 Real-time statistics and monitoring" + nl
    help += "🎭 Sticker support" + nl
    help += "🔇 Individual chat muting" + nl
    help += "🚫 Contact blocking/unblocking" + nl
    help += "📤 Direct message sending" + nl
    help += "🎬 GIF URL support (Tenor/Giphy)" + nl
    help += "💬 Message quoting support with media previews" + nl + nl

    // How it works
    help += b("🔧 HOW IT WORKS") + nl
    help += "• Each WhatsApp chat gets its own Discord channel" + nl
    help += "• Messages are automatically forwarded in both directions" + nl
    help += "• Your messages appear in WhatsApp green, others in unique colors" + nl
    help += "• Media files are processed and forwarded with captions" + nl
    help += "• Quoted media appears as thumbnails in Discord embeds" + nl + nl

    // Commands
    help += b("🎮 AVAILABLE COMMANDS") + nl
    help += `Command prefix: ${c(this.commandPrefix)}` + nl + nl

    if (platform === "discord") {
      help += b("Channel Commands:") + nl
      help += c(`${this.commandPrefix}help`) + " - Show this help message" + nl
      help += c(`${this.commandPrefix}profile`) + " - Show WhatsApp contact info (contacts only)" + nl
      help += c(`${this.commandPrefix}sticker`) + " - Send attached media as WhatsApp sticker" + nl
      help += c(`${this.commandPrefix}mute`) + " - Mute this chat (stop forwarding from WhatsApp)" + nl
      help += c(`${this.commandPrefix}unmute`) + " - Unmute this chat (resume forwarding)" + nl

      help += c(`${this.commandPrefix}block`) + " - Block this contact on WhatsApp (contacts only)" + nl
      help += c(`${this.commandPrefix}unblock`) + " - Unblock this contact on WhatsApp (contacts only)" + nl + nl

      help += b("Admin Commands (Stats/Admin Channel):") + nl
      help += c(`${this.commandPrefix}help`) + " - Show this help message" + nl
      help += c(`${this.commandPrefix}stats`) + " - Show comprehensive bridge statistics" + nl
      help += c(`${this.commandPrefix}pause`) + " - Pause message forwarding globally" + nl
      help += c(`${this.commandPrefix}start`) + " - Resume message forwarding globally" + nl
      help += c(`${this.commandPrefix}purge`) + " - Delete all chat mappings and channels" + nl
      help += c(`${this.commandPrefix}getchats [page]`) + " - List all WhatsApp chats (paginated)" + nl
      help += c(`${this.commandPrefix}send <id> <text>`) + " - Send message to phone number or chat ID" + nl
      help += c(`${this.commandPrefix}setenv <env>`) + " - Change NODE_ENV (production/development)" + nl
    } else {
      help += c(`${this.commandPrefix}help`) + " - Show this help message" + nl
      help += c(`${this.commandPrefix}stats`) + " - Show bridge statistics (authorized chats only)" + nl
    }

    help += nl

    if (platform === "discord") {
      help += nl + `Need more help? Check the bridge logs or open an issue on GitHub\n${process.env.GITHUB_REPO}`
    }

    return help
  }
}

module.exports = DiscordManager
