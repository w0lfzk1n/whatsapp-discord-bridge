const Database = require("better-sqlite3")
const path = require("path")

function getTimestamp() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "")
}

class DatabaseManager {
  constructor() {
    const dbPath = path.resolve(process.cwd(), "./data/database.db")
    this.db = new Database(dbPath)
    this.initializeTables()

    // In-memory cache for faster message ID lookups
    this.pendingMessageIds = new Set()

    // Chat-specific sending locks to prevent race conditions
    this.sendingLocks = new Map() // chatId -> { locked: boolean, queue: [] }

    // File hash cache for documents without message IDs
    this.pendingFileHashes = new Set()

    // Counter-based echo prevention for media files
    this.pendingMediaCounts = new Map() // chatId -> count
  }

  initializeTables() {
    // Create the main mapping table (updated for channels instead of threads)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_chat_id TEXT UNIQUE NOT NULL,
        dc_channel_id TEXT NOT NULL,
        chat_name TEXT,
        chat_type TEXT DEFAULT 'contact',
        is_muted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        message_count INTEGER DEFAULT 0
      )
    `)

    // Create a table for message logs (optional, for debugging)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_chat_id TEXT NOT NULL,
        dc_channel_id TEXT NOT NULL,
        message_body TEXT,
        sender_name TEXT,
        message_type TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        forwarded BOOLEAN DEFAULT FALSE
      )
    `)

    // Create a table to track messages sent from Discord to WhatsApp
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discord_sent_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_chat_id TEXT NOT NULL,
        message_content TEXT NOT NULL,
        message_hash TEXT NOT NULL,
        sent_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )
    `)

    // Create a table to track WhatsApp message IDs sent from Discord
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discord_sent_message_ids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_message_id TEXT NOT NULL UNIQUE,
        sent_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )
    `)

    // Create a table to track file hashes for documents without message IDs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discord_sent_file_hashes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_chat_id TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        sent_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )
    `)

    // Create a table to track quoted messages
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quoted_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_message_id TEXT NOT NULL,
        original_platform TEXT NOT NULL,
        wa_chat_id TEXT NOT NULL,
        dc_channel_id TEXT NOT NULL,
        message_content TEXT,
        sender_name TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create a table to track pending media counts for echo prevention
    this.db.exec(`
  CREATE TABLE IF NOT EXISTS pending_media_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_chat_id TEXT NOT NULL UNIQUE,
    count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
  )
`)

    // Create index for faster lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_wa_message_id 
      ON discord_sent_message_ids(wa_message_id)
    `)

    // Create index for faster lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_discord_sent_hash 
      ON discord_sent_messages(message_hash, wa_chat_id)
    `)

    // Create index for file hash lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_file_hash 
      ON discord_sent_file_hashes(file_hash, wa_chat_id)
    `)

    // Create index for quoted messages
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_quoted_messages 
      ON quoted_messages(original_message_id, original_platform)
    `)

    // Create index for pending media counts
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pending_media 
      ON pending_media_counts(wa_chat_id, expires_at)
    `)

    // Add a new table for bridge state:
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bridge_state (
        id INTEGER PRIMARY KEY,
        is_paused BOOLEAN DEFAULT FALSE,
        node_env TEXT DEFAULT 'production',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Insert default state if not exists:
    this.db.exec(`
      INSERT OR IGNORE INTO bridge_state (id, is_paused, node_env) VALUES (1, FALSE, 'production')
    `)

    console.log(`♻️ Database tables initialized`)
  }

  /**
   * Increments the pending media count for a chat (when sending from Discord to WhatsApp)
   * @param {string} waChatId WhatsApp chat ID
   * @param {number} count Number of media files being sent
   * @param {number} ttlMinutes Time to live in minutes (default: 10)
   */
  incrementPendingMediaCount(waChatId, count, ttlMinutes = 10) {
    try {
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()

      // Update in-memory cache
      const currentCount = this.pendingMediaCounts.get(waChatId) || 0
      this.pendingMediaCounts.set(waChatId, currentCount + count)

      // Check if record exists
      const checkStmt = this.db.prepare(`
      SELECT count FROM pending_media_counts WHERE wa_chat_id = ?
    `)
      const existing = checkStmt.get(waChatId)

      if (existing) {
        // Update existing record
        const updateStmt = this.db.prepare(`
        UPDATE pending_media_counts 
        SET count = count + ?, expires_at = ? 
        WHERE wa_chat_id = ?
      `)
        updateStmt.run(count, expiresAt, waChatId)
      } else {
        // Insert new record
        const insertStmt = this.db.prepare(`
        INSERT INTO pending_media_counts (wa_chat_id, count, expires_at)
        VALUES (?, ?, ?)
      `)
        insertStmt.run(waChatId, count, expiresAt)
      }

      if (process.env.NODE_ENV === "development") {
        console.log(
          `${getTimestamp()} | 📊 Incremented pending media count for ${waChatId}: +${count} (total: ${currentCount + count})`,
        )
      }

      // Set timeout to clean up memory cache
      setTimeout(
        () => {
          const newCount = this.pendingMediaCounts.get(waChatId) || 0
          if (newCount <= count) {
            this.pendingMediaCounts.delete(waChatId)
          } else {
            this.pendingMediaCounts.set(waChatId, newCount - count)
          }
        },
        ttlMinutes * 60 * 1000,
      )
    } catch (error) {
      console.error(`${getTimestamp()} | Error incrementing pending media count:\n`, error)
    }
  }

  /**
   * Checks if we should ignore a media message from the user (counter-based echo prevention)
   * @param {string} waChatId WhatsApp chat ID
   * @param {string} senderNumber WhatsApp sender number (should be bot's number for own messages)
   * @param {string} botNumber Bot's WhatsApp number
   * @returns {boolean} True if message should be ignored
   */
  shouldIgnoreOwnMedia(waChatId, senderNumber, botNumber) {
    try {
      // Only check for own messages
      if (!senderNumber || !botNumber || !senderNumber.includes(botNumber)) {
        return false
      }

      // Check in-memory cache first
      const memoryCount = this.pendingMediaCounts.get(waChatId) || 0
      if (memoryCount > 0) {
        this.pendingMediaCounts.set(waChatId, memoryCount - 1)
        if (process.env.NODE_ENV === "development") {
          console.log(
            `${getTimestamp()} | 🔄 Ignoring own media (memory cache): ${waChatId} (remaining: ${memoryCount - 1})`,
          )
        }
        return true
      }

      // Check database
      const now = new Date().toISOString()
      const stmt = this.db.prepare(`
        SELECT count FROM pending_media_counts 
        WHERE wa_chat_id = ? AND expires_at > ? AND count > 0
        ORDER BY created_at DESC LIMIT 1
      `)
      const result = stmt.get(waChatId, now)

      if (result && result.count > 0) {
        // Decrement the count
        const updateStmt = this.db.prepare(`
          UPDATE pending_media_counts 
          SET count = count - 1 
          WHERE wa_chat_id = ? AND expires_at > ?
        `)
        updateStmt.run(waChatId, now)

        if (process.env.NODE_ENV === "development") {
          console.log(
            `${getTimestamp()} | 🔄 Ignoring own media (database): ${waChatId} (remaining: ${result.count - 1})`,
          )
        }
        return true
      }

      return false
    } catch (error) {
      console.error(`${getTimestamp()} | Error checking pending media count:\n`, error)
      return false
    }
  }

  /**
   * Cleans up expired pending media counts
   */
  cleanupExpiredPendingMediaCounts() {
    try {
      const now = new Date().toISOString()
      const stmt = this.db.prepare(`
        DELETE FROM pending_media_counts 
        WHERE expires_at <= ?
      `)
      const result = stmt.run(now)

      if (result.changes > 0) {
        console.log(`${getTimestamp()} | 🧹 Cleaned up ${result.changes} expired pending media count records`)
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up expired pending media counts:\n`, error)
    }
  }

  getChatMapping(waChatId) {
    const stmt = this.db.prepare("SELECT * FROM chat_mappings WHERE wa_chat_id = ?")
    return stmt.get(waChatId)
  }

  createChatMapping(waChatId, dcChannelId, chatName, chatType = "contact") {
    const stmt = this.db.prepare(`
      INSERT INTO chat_mappings (wa_chat_id, dc_channel_id, chat_name, chat_type) 
      VALUES (?, ?, ?, ?)
    `)
    return stmt.run(waChatId, dcChannelId, chatName, chatType)
  }

  updateLastActivity(waChatId) {
    const stmt = this.db.prepare(`
      UPDATE chat_mappings 
      SET last_activity = CURRENT_TIMESTAMP, message_count = message_count + 1 
      WHERE wa_chat_id = ?
    `)
    return stmt.run(waChatId)
  }

  logMessage(waChatId, dcChannelId, messageBody, senderName, messageType, forwarded = false) {
    try {
      // Ensure all values are of valid types for SQLite
      const safeWaChatId = String(waChatId || "")
      const safeDcChannelId = String(dcChannelId || "")
      const safeMessageBody = messageBody ? String(messageBody).substring(0, 1000) : "" // Limit length and convert to string
      const safeSenderName = senderName ? String(senderName) : "Unknown"
      const safeMessageType = messageType ? String(messageType) : "unknown"
      const safeForwarded = forwarded ? 1 : 0 // Convert boolean to integer for SQLite

      const stmt = this.db.prepare(`
        INSERT INTO message_logs (wa_chat_id, dc_channel_id, message_body, sender_name, message_type, forwarded) 
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      return stmt.run(safeWaChatId, safeDcChannelId, safeMessageBody, safeSenderName, safeMessageType, safeForwarded)
    } catch (error) {
      console.error(`${getTimestamp()} | Error logging message to database:\n`, error)
      console.error("Values:", {
        waChatId,
        dcChannelId,
        messageBody: typeof messageBody,
        senderName,
        messageType,
        forwarded,
      })
      // Continue execution even if logging fails
      return null
    }
  }

  /**
   * Records a quoted message for reference
   * @param {string} originalMessageId Original message ID
   * @param {string} originalPlatform Platform where original message was sent ('discord' or 'whatsapp')
   * @param {string} waChatId WhatsApp chat ID
   * @param {string} dcChannelId Discord channel ID
   * @param {string} messageContent Message content
   * @param {string} senderName Sender name
   */
  recordQuotedMessage(originalMessageId, originalPlatform, waChatId, dcChannelId, messageContent, senderName) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO quoted_messages (original_message_id, original_platform, wa_chat_id, dc_channel_id, message_content, sender_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      stmt.run(originalMessageId, originalPlatform, waChatId, dcChannelId, messageContent, senderName)
      console.log(`${getTimestamp()} | 📝 Recorded quoted message reference`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error recording quoted message:\n`, error)
    }
  }

  /**
   * Gets quoted message information
   * @param {string} messageId Message ID to look up
   * @param {string} platform Platform to search ('discord' or 'whatsapp')
   * @returns {Object|null} Quoted message info or null
   */
  getQuotedMessage(messageId, platform) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM quoted_messages 
        WHERE original_message_id = ? AND original_platform = ?
        ORDER BY timestamp DESC LIMIT 1
      `)
      return stmt.get(messageId, platform)
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting quoted message:\n`, error)
      return null
    }
  }

  /**
   * Records a message sent from Discord to WhatsApp to prevent echo
   * @param {string} waChatId WhatsApp chat ID
   * @param {string} messageContent Message content
   * @param {number} ttlMinutes Time to live in minutes (default: 5)
   */
  recordDiscordSentMessage(waChatId, messageContent, ttlMinutes = 5) {
    try {
      // Create a hash of the message content for comparison
      const messageHash = this.createMessageHash(messageContent)
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()

      const stmt = this.db.prepare(`
        INSERT INTO discord_sent_messages (wa_chat_id, message_content, message_hash, expires_at)
        VALUES (?, ?, ?, ?)
      `)

      stmt.run(waChatId, messageContent, messageHash, expiresAt)
      console.log(`${getTimestamp()} | 📝 Recorded Discord-sent message for chat ${waChatId}`)
    } catch (error) {
      console.error(`${getTimestamp()} | Error recording Discord-sent message:\n`, error)
    }
  }

  /**
   * Checks if a message was recently sent from Discord to WhatsApp
   * @param {string} waChatId WhatsApp chat ID
   * @param {string} messageContent Message content to check
   * @returns {boolean} True if message was sent from Discord
   */
  wasMessageSentFromDiscord(waChatId, messageContent) {
    try {
      const messageHash = this.createMessageHash(messageContent)
      const now = new Date().toISOString()

      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM discord_sent_messages 
        WHERE wa_chat_id = ? AND message_hash = ? AND expires_at > ?
      `)

      const result = stmt.get(waChatId, messageHash, now)
      const wasSentFromDiscord = result.count > 0

      // Skip echo if message was sent from Discord
      if (wasSentFromDiscord) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 🔄 Message "${messageContent}" was sent from Discord, skipping echo`)
        }
        this.cleanupDiscordSentMessage(waChatId, messageHash)
      }

      return wasSentFromDiscord
    } catch (error) {
      console.error(`${getTimestamp()} | Error checking Discord-sent message:\n`, error)
      return false // If error, assume it wasn't sent from Discord to be safe
    }
  }

  /**
   * Creates a hash of message content for comparison
   * @param {string} content Message content
   * @returns {string} Hash string
   */
  createMessageHash(content) {
    // Simple hash function - you could use crypto for more security if needed
    let hash = 0
    const str = String(content || "")
      .trim()
      .toLowerCase()

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }

    return hash.toString()
  }

  /**
   * Creates a file hash for documents/media
   * @param {string} filename File name
   * @param {number} fileSize File size in bytes
   * @param {string} chatId Chat ID
   * @returns {string} File hash
   */
  createFileHash(filename, fileSize, chatId) {
    const timestamp = Date.now()
    const content = `${filename}:${fileSize}:${chatId}:${timestamp}`
    return this.createMessageHash(content)
  }

  /**
   * Records a file hash for documents without message IDs
   * @param {string} waChatId WhatsApp chat ID
   * @param {string} filename File name
   * @param {number} fileSize File size
   * @param {number} ttlMinutes Time to live in minutes (default: 10)
   */
  recordDiscordSentFileHash(waChatId, filename, fileSize, ttlMinutes = 10) {
    try {
      const fileHash = this.createFileHash(filename, fileSize, waChatId)
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()

      // Add to in-memory cache
      this.pendingFileHashes.add(fileHash)

      // Store in database
      const stmt = this.db.prepare(`
        INSERT INTO discord_sent_file_hashes (wa_chat_id, file_hash, filename, file_size, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      stmt.run(waChatId, fileHash, filename, fileSize, expiresAt)
      console.log(`${getTimestamp()} | 📝 Recorded Discord-sent file hash for ${filename} (${fileSize} bytes)`)

      // Set a timeout to remove from memory cache
      setTimeout(
        () => {
          this.pendingFileHashes.delete(fileHash)
        },
        ttlMinutes * 60 * 1000,
      )

      return fileHash
    } catch (error) {
      console.error(`${getTimestamp()} | Error recording Discord-sent file hash:\n`, error)
      return null
    }
  }

  /**
   * Checks if a file was recently sent from Discord to WhatsApp
   * @param {string} waChatId WhatsApp chat ID
   * @param {string} filename File name
   * @param {number} fileSize File size
   * @returns {boolean} True if file was sent from Discord
   */
  wasFileSentFromDiscord(waChatId, filename, fileSize) {
    try {
      // Create multiple possible hashes since timestamp varies
      const now = Date.now()
      const timeWindow = 30000 // 30 seconds window

      // Check recent hashes in memory cache first
      for (const hash of this.pendingFileHashes) {
        // Simple check - if we have any pending hash for this chat, it's likely ours
        const dbStmt = this.db.prepare(`
          SELECT COUNT(*) as count 
          FROM discord_sent_file_hashes 
          WHERE file_hash = ? AND wa_chat_id = ? AND filename = ? AND file_size = ?
        `)
        const result = dbStmt.get(hash, waChatId, filename, fileSize)
        if (result.count > 0) {
          if (process.env.NODE_ENV === "development") {
            console.log(`🔄 File ${filename} was sent from Discord (memory cache), skipping echo`)
          }
          this.pendingFileHashes.delete(hash)
          this.cleanupDiscordSentFileHash(hash)
          return true
        }
      }

      // Check database for recent files with same name and size
      const dbNow = new Date().toISOString()
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM discord_sent_file_hashes 
        WHERE wa_chat_id = ? AND filename = ? AND file_size = ? AND expires_at > ?
      `)

      const result = stmt.get(waChatId, filename, fileSize, dbNow)
      const wasSentFromDiscord = result.count > 0

      if (wasSentFromDiscord) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 🔄 File ${filename} was sent from Discord (database), skipping echo`)
        }
        // Clean up the record
        const cleanupStmt = this.db.prepare(`
          DELETE FROM discord_sent_file_hashes 
          WHERE wa_chat_id = ? AND filename = ? AND file_size = ?
        `)
        cleanupStmt.run(waChatId, filename, fileSize)
      }

      return wasSentFromDiscord
    } catch (error) {
      console.error(`${getTimestamp()} | Error checking Discord-sent file:\n`, error)
      return false
    }
  }

  /**
   * Cleans up a specific Discord-sent message record
   * @param {string} waChatId WhatsApp chat ID
   * @param {string} messageHash Message hash
   */
  cleanupDiscordSentMessage(waChatId, messageHash) {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM discord_sent_messages 
        WHERE wa_chat_id = ? AND message_hash = ?
      `)
      stmt.run(waChatId, messageHash)
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up Discord-sent message:\n`, error)
    }
  }

  /**
   * Cleans up a specific Discord-sent file hash record
   * @param {string} fileHash File hash
   */
  cleanupDiscordSentFileHash(fileHash) {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM discord_sent_file_hashes 
        WHERE file_hash = ?
      `)
      stmt.run(fileHash)
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up Discord-sent file hash:\n`, error)
    }
  }

  /**
   * Cleans up expired Discord-sent message records
   */
  cleanupExpiredDiscordSentMessages() {
    try {
      const now = new Date().toISOString()
      const stmt = this.db.prepare(`
        DELETE FROM discord_sent_messages 
        WHERE expires_at <= ?
      `)
      const result = stmt.run(now)

      if (result.changes > 0) {
        console.log(`${getTimestamp()} | 🧹 Cleaned up ${result.changes} expired Discord-sent message records`)
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up expired Discord-sent messages:\n`, error)
    }
  }

  /**
   * Cleans up expired Discord-sent file hash records
   */
  cleanupExpiredDiscordSentFileHashes() {
    try {
      const now = new Date().toISOString()
      const stmt = this.db.prepare(`
        DELETE FROM discord_sent_file_hashes 
        WHERE expires_at <= ?
      `)
      const result = stmt.run(now)

      if (result.changes > 0) {
        console.log(`${getTimestamp()} | 🧹 Cleaned up ${result.changes} expired Discord-sent file hash records`)
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up expired Discord-sent file hashes:\n`, error)
    }
  }

  /**
   * Locks a chat to prevent processing incoming messages while sending
   * @param {string} chatId WhatsApp chat ID
   */
  lockChatForSending(chatId) {
    if (!this.sendingLocks.has(chatId)) {
      this.sendingLocks.set(chatId, { locked: false, queue: [] })
    }

    const lock = this.sendingLocks.get(chatId)
    lock.locked = true

    console.log(`${getTimestamp()} | 🔒 Locked chat ${chatId} for sending`)
  }

  /**
   * Unlocks a chat and processes any queued messages
   * @param {string} chatId WhatsApp chat ID
   * @param {string|boolean} result The result from WhatsApp send operation
   * @param {Object} fileInfo Optional file info for documents { filename, fileSize }
   */
  unlockChatAfterSending(chatId, result, fileInfo = null) {
    if (!this.sendingLocks.has(chatId)) {
      return
    }

    const lock = this.sendingLocks.get(chatId)

    // Record the message ID or file hash for echo prevention
    if (result && typeof result === "string") {
      // We got a message ID
      this.recordDiscordSentMessageId(result)
      console.log(`${getTimestamp()} | 🔓 Unlocked chat ${chatId} after sending (ID: ${result})`)
    } else if (result === true && fileInfo) {
      // Document sent successfully but no ID returned
      this.recordDiscordSentFileHash(chatId, fileInfo.filename, fileInfo.fileSize)
      console.log(`${getTimestamp()} | 🔓 Unlocked chat ${chatId} after sending document (${fileInfo.filename})`)
    } else {
      console.log(`${getTimestamp()} | 🔓 Unlocked chat ${chatId} after sending (no ID/hash recorded)`)
    }

    lock.locked = false

    // Process any queued messages
    if (lock.queue.length > 0) {
      console.log(`${getTimestamp()} | 📋 Processing ${lock.queue.length} queued messages for chat ${chatId}`)
      const queuedMessages = [...lock.queue]
      lock.queue = []

      // Process queued messages asynchronously
      setTimeout(() => {
        queuedMessages.forEach(({ message, handler }) => {
          try {
            handler(message)
          } catch (error) {
            console.error(`${getTimestamp()} | Error processing queued message:\n`, error)
          }
        })
      }, 100) // Small delay to ensure the message ID is fully processed
    }
  }

  /**
   * Checks if a chat is currently locked for sending
   * @param {string} chatId WhatsApp chat ID
   * @returns {boolean} True if chat is locked
   */
  isChatLockedForSending(chatId) {
    const lock = this.sendingLocks.get(chatId)
    return lock ? lock.locked : false
  }

  /**
   * Queues a message for processing after the chat is unlocked
   * @param {string} chatId WhatsApp chat ID
   * @param {Object} message WhatsApp message object
   * @param {Function} handler Message handler function
   */
  queueMessageForProcessing(chatId, message, handler) {
    if (!this.sendingLocks.has(chatId)) {
      this.sendingLocks.set(chatId, { locked: false, queue: [] })
    }

    const lock = this.sendingLocks.get(chatId)
    lock.queue.push({ message, handler })

    console.log(`${getTimestamp()} | 📋 Queued message from chat ${chatId} (queue size: ${lock.queue.length})`)
  }

  /**
   * Records a WhatsApp message ID for messages sent from Discord
   * @param {string} messageId WhatsApp message ID
   * @param {number} ttlMinutes Time to live in minutes (default: 10)
   */
  recordDiscordSentMessageId(messageId, ttlMinutes = 10) {
    try {
      if (!messageId) return

      // Add to in-memory cache
      this.pendingMessageIds.add(messageId)

      // Also store in database for persistence
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()

      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO discord_sent_message_ids (wa_message_id, expires_at)
        VALUES (?, ?)
      `)

      stmt.run(messageId, expiresAt)
      if (process.env.NODE_ENV === "development") {
        console.log(`${getTimestamp()} | ✅ Recorded Discord-sent message ID: ${messageId}`)
      }

      // Set a timeout to remove from memory cache
      setTimeout(
        () => {
          this.pendingMessageIds.delete(messageId)
        },
        ttlMinutes * 60 * 1000,
      )
    } catch (error) {
      console.error(`${getTimestamp()} | Error recording Discord-sent message ID:\n`, error)
    }
  }

  /**
   * Checks if a message ID was sent from Discord (using both memory cache and database)
   * @param {string} messageId WhatsApp message ID
   * @returns {boolean} True if message was sent from Discord
   */
  wasMessageIdSentFromDiscord(messageId) {
    try {
      if (!messageId) return false

      // First check in-memory cache (fastest)
      if (this.pendingMessageIds.has(messageId)) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 🔄 Message ID ${messageId} found in memory cache, skipping echo to Discord`)
        }
        return true
      }

      // Then check database
      const now = new Date().toISOString()

      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM discord_sent_message_ids 
        WHERE wa_message_id = ? AND expires_at > ?
      `)

      const result = stmt.get(messageId, now)
      const wasSentFromDiscord = result.count > 0

      if (wasSentFromDiscord) {
        if (process.env.NODE_ENV === "development") {
          console.log(`${getTimestamp()} | 🔄 Message ID ${messageId} found in database, skipping echo to Discord`)
        }
        // Clean up the record since we found it
        this.cleanupDiscordSentMessageId(messageId)
      }

      return wasSentFromDiscord
    } catch (error) {
      console.error(`${getTimestamp()} | Error checking Discord-sent message ID:\n`, error)
      return false // If error, assume it wasn't sent from Discord to be safe
    }
  }

  /**
   * Cleans up a specific Discord-sent message ID record
   * @param {string} messageId WhatsApp message ID
   */
  cleanupDiscordSentMessageId(messageId) {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM discord_sent_message_ids 
        WHERE wa_message_id = ?
      `)
      stmt.run(messageId)
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up Discord-sent message ID:\n`, error)
    }
  }

  /**
   * Cleans up expired Discord-sent message ID records
   */
  cleanupExpiredDiscordSentMessageIds() {
    try {
      const now = new Date().toISOString()
      const stmt = this.db.prepare(`
        DELETE FROM discord_sent_message_ids 
        WHERE expires_at <= ?
      `)
      const result = stmt.run(now)

      if (result.changes > 0) {
        console.log(`${getTimestamp()} | 🧹 Cleaned up ${result.changes} expired Discord-sent message ID records`)
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error cleaning up expired Discord-sent message IDs:\n`, error)
    }
  }

  getAllMappings() {
    const stmt = this.db.prepare("SELECT * FROM chat_mappings ORDER BY last_activity DESC")
    return stmt.all()
  }

  getRecentMessages(limit = 50) {
    const stmt = this.db.prepare("SELECT * FROM message_logs ORDER BY timestamp DESC LIMIT ?")
    return stmt.all(limit)
  }

  close() {
    this.db.close()
  }

  /**
   * Sets the bridge pause state
   */
  setPauseState(isPaused) {
    const stmt = this.db.prepare(`
      UPDATE bridge_state 
      SET is_paused = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = 1
    `)
    return stmt.run(isPaused ? 1 : 0)
  }

  /**
   * Gets the current bridge pause state
   */
  getPauseState() {
    const stmt = this.db.prepare("SELECT is_paused FROM bridge_state WHERE id = 1")
    const result = stmt.get()
    return result ? Boolean(result.is_paused) : false
  }

  /**
   * Sets the NODE_ENV value
   */
  setNodeEnv(nodeEnv) {
    const stmt = this.db.prepare(`
      UPDATE bridge_state 
      SET node_env = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = 1
    `)
    process.env.NODE_ENV = nodeEnv
    return stmt.run(nodeEnv)
  }

  /**
   * Gets the current NODE_ENV value
   */
  getNodeEnv() {
    const stmt = this.db.prepare("SELECT node_env FROM bridge_state WHERE id = 1")
    const result = stmt.get()
    return result ? result.node_env : "production"
  }

  /**
   * Sets the mute state for a specific chat
   * @param {string} waChatId WhatsApp chat ID
   * @param {boolean} isMuted Mute state
   */
  setChatMuteState(waChatId, isMuted) {
    const stmt = this.db.prepare(`
      UPDATE chat_mappings 
      SET is_muted = ? 
      WHERE wa_chat_id = ?
    `)
    return stmt.run(isMuted ? 1 : 0, waChatId)
  }

  /**
   * Gets the mute state for a specific chat
   * @param {string} waChatId WhatsApp chat ID
   * @returns {boolean} True if chat is muted
   */
  getChatMuteState(waChatId) {
    const stmt = this.db.prepare("SELECT is_muted FROM chat_mappings WHERE wa_chat_id = ?")
    const result = stmt.get(waChatId)
    return result ? Boolean(result.is_muted) : false
  }

  /**
   * Gets WhatsApp chat ID from Discord channel ID
   * @param {string} dcChannelId Discord channel ID
   * @returns {string|null} WhatsApp chat ID or null if not found
   */
  getWaChatIdFromChannel(dcChannelId) {
    const stmt = this.db.prepare("SELECT wa_chat_id FROM chat_mappings WHERE dc_channel_id = ?")
    const result = stmt.get(dcChannelId)
    return result ? result.wa_chat_id : null
  }

  /**
   * Purges all data and resets the database
   */
  purgeAllData() {
    try {
      // Get all channel IDs before purging
      const mappings = this.getAllMappings()

      // Clear all tables
      this.db.exec("DELETE FROM chat_mappings")
      this.db.exec("DELETE FROM message_logs")
      this.db.exec("DELETE FROM discord_sent_messages")
      this.db.exec("DELETE FROM discord_sent_message_ids")
      this.db.exec("DELETE FROM discord_sent_file_hashes")
      this.db.exec("DELETE FROM quoted_messages")
      this.db.exec("DELETE FROM pending_media_counts")
      this.db.exec("UPDATE bridge_state SET is_paused = FALSE")

      // Clear in-memory caches
      this.pendingMessageIds.clear()
      this.pendingFileHashes.clear()
      this.sendingLocks.clear()
      this.pendingMediaCounts.clear()

      console.log(`${getTimestamp()} | 🧹 Database purged successfully`)
      return mappings.map((m) => m.dc_channel_id) // Return channel IDs for deletion
    } catch (error) {
      console.error(`${getTimestamp()} | Error purging database:\n`, error)
      throw error
    }
  }

  /**
   * Updates chat mapping with chat type
   */
  updateChatType(waChatId, chatType) {
    const stmt = this.db.prepare(`
      UPDATE chat_mappings 
      SET chat_type = ? 
      WHERE wa_chat_id = ?
    `)
    return stmt.run(chatType, waChatId)
  }
}

module.exports = DatabaseManager
