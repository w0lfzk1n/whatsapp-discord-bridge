const os = require("os")
const process = require("process")

function getTimestamp() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "")
}

class StatsManager {
  constructor(bridge) {
    this.bridge = bridge
    this.startTime = Date.now()
  }

  /**
   * Generates comprehensive statistics about the bridge
   * @returns {Object} Statistics object
   */
  async generateStats() {
    const { database, discordManager, whatsappManager } = this.bridge

    // Basic stats
    const uptime = this.getUptime()
    const mappings = database.getAllMappings()
    const recentMessages = database.getRecentMessages(50)
    const isPaused = database.getPauseState()
    const nodeEnv = database.getNodeEnv()

    // Count messages by type
    const messageTypes = {}
    recentMessages.forEach((msg) => {
      messageTypes[msg.message_type] = (messageTypes[msg.message_type] || 0) + 1
    })

    // Count chat types
    const chatTypes = { contact: 0, group: 0 }
    mappings.forEach((mapping) => {
      if (mapping.chat_type) {
        chatTypes[mapping.chat_type] = (chatTypes[mapping.chat_type] || 0) + 1
      }
    })

    // Get WhatsApp info
    let waInfo = { connected: false }
    if (whatsappManager && whatsappManager.client) {
      try {
        waInfo = {
          connected: true,
          hostNumber: whatsappManager.botNumber || "Unknown",
          battery: await this.getBatteryInfo(whatsappManager),
          platform: await this.getPlatformInfo(whatsappManager),
        }
      } catch (error) {
        console.error(`${getTimestamp()} | Error getting WhatsApp info:\n`, error)
      }
    }

    // Get Discord info
    let discordInfo = { connected: false }
    if (discordManager && discordManager.client) {
      try {
        discordInfo = {
          connected: discordManager.isReady,
          username: discordManager.client.user?.tag || "Unknown",
          servers: discordManager.client.guilds.cache.size,
          commandPrefix: discordManager.commandPrefix,
        }
      } catch (error) {
        console.error(`${getTimestamp()} | Error getting Discord info:\n`, error)
      }
    }

    // System stats
    const systemInfo = {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      nodeEnv: nodeEnv,
      cpuUsage: process.cpuUsage(),
      memoryUsage: {
        total: Math.round(os.totalmem() / (1024 * 1024)) + " MB",
        free: Math.round(os.freemem() / (1024 * 1024)) + " MB",
        process: Math.round(process.memoryUsage().rss / (1024 * 1024)) + " MB",
      },
      loadAverage: os.loadavg(),
    }

    // Database stats
    const dbStats = {
      totalMappings: mappings.length,
      activeMappings: this.getActiveMappings(mappings),
      totalMessages: await this.getTotalMessageCount(database),
      messagesByType: messageTypes,
      chatTypes: chatTypes,
      isPaused: isPaused,
    }

    // Recent activity
    const recentActivity = recentMessages.slice(0, 10).map((msg) => ({
      timestamp: new Date(msg.timestamp).toLocaleString(),
      sender: msg.sender_name,
      type: msg.message_type,
      direction: msg.forwarded ? "WhatsApp → Discord" : "Discord → WhatsApp",
    }))

    return {
      status: "online",
      uptime,
      whatsapp: waInfo,
      discord: discordInfo,
      database: dbStats,
      system: systemInfo,
      recentActivity,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Formats statistics into a readable string
   * @param {Object} stats Statistics object
   * @returns {String} Formatted statistics
   */
  formatStats(stats, platform = "discord") {
    // Different formatting for Discord (markdown) vs WhatsApp (plain text)
    const isMd = platform === "discord"
    const b = (text) => (isMd ? `**${text}**` : text) // Bold
    const c = (text) => (isMd ? `\`${text}\`` : text) // Code
    const nl = "\n"
    const hr = isMd ? "---" : "------------------------------"

    let output = ""

    // Header
    output += b("📊 WHATSAPP-DISCORD BRIDGE STATISTICS") + nl
    output += `⏫ GitHub: ${process.env.GITHUB_REPO || ""}` + nl + nl

    // Status and uptime
    const statusIcon = stats.database.isPaused ? "⏸️" : "🔄"
    const statusText = stats.database.isPaused ? "paused" : stats.status
    output += b(`${statusIcon} Status: `) + c(statusText) + nl
    output += b("⏱️ Uptime: ") + c(stats.uptime) + nl
    output += b("🔧 Environment: ") + c(stats.system.nodeEnv) + nl + nl

    // WhatsApp info
    output += b("📱 WHATSAPP") + nl
    output += b("Connected: ") + c(stats.whatsapp.connected ? "Yes" : "No") + nl
    if (stats.whatsapp.connected) {
      output += b("Host Number: ") + c(stats.whatsapp.hostNumber) + nl
      if (stats.whatsapp.battery) {
        output +=
          b("Battery: ") +
          c(`${stats.whatsapp.battery.percentage}% (${stats.whatsapp.battery.plugged ? "Charging" : "Not charging"})`) +
          nl
      }
      if (stats.whatsapp.platform) {
        output += b("Device: ") + c(stats.whatsapp.platform) + nl
      }
    }
    output += nl

    // Discord info
    output += b("🤖 DISCORD") + nl
    output += b("Connected: ") + c(stats.discord.connected ? "Yes" : "No") + nl
    if (stats.discord.connected) {
      output += b("Bot User: ") + c(stats.discord.username) + nl
      output += b("Servers: ") + c(stats.discord.servers) + nl
      output += b("Command Prefix: ") + c(stats.discord.commandPrefix) + nl
    }
    output += nl

    // Database stats
    output += b("📊 CHAT STATISTICS") + nl
    output += b("Total Chats: ") + c(stats.database.totalMappings) + nl
    output += b("Active Chats: ") + c(stats.database.activeMappings) + nl
    output += b("Total Messages: ") + c(stats.database.totalMessages) + nl

    // Chat types
    if (stats.database.chatTypes.contact > 0 || stats.database.chatTypes.group > 0) {
      output += b("Chat Types:") + nl
      output += `  👤 Contacts: ${c(stats.database.chatTypes.contact)}` + nl
      output += `  👥 Groups: ${c(stats.database.chatTypes.group)}` + nl
    }

    // Message types
    if (Object.keys(stats.database.messagesByType).length > 0) {
      output += b("Message Types:") + nl
      for (const [type, count] of Object.entries(stats.database.messagesByType)) {
        output += `  ${this.getEmojiForType(type)} ${type}: ${c(count)}` + nl
      }
    }
    output += nl

    // System info
    output += b("💻 SYSTEM") + nl
    output += b("Platform: ") + c(`${stats.system.platform} (${stats.system.arch})`) + nl
    output += b("Node.js: ") + c(stats.system.nodeVersion) + nl
    output += b("Memory: ") + c(`${stats.system.memoryUsage.process} / ${stats.system.memoryUsage.total}`) + nl
    output += b("CPU Load: ") + c(stats.system.loadAverage.map((load) => load.toFixed(2)).join(", ")) + nl + nl

    // Footer
    output += nl + hr + nl
    output += `Generated at: ${new Date().toLocaleString()}`

    return output
  }

  /**
   * Gets the uptime in a human-readable format
   * @returns {String} Formatted uptime
   */
  getUptime() {
    const uptime = Date.now() - this.startTime
    const seconds = Math.floor(uptime / 1000) % 60
    const minutes = Math.floor(uptime / (1000 * 60)) % 60
    const hours = Math.floor(uptime / (1000 * 60 * 60)) % 24
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24))

    let uptimeStr = ""
    if (days > 0) uptimeStr += `${days}d `
    if (hours > 0 || days > 0) uptimeStr += `${hours}h `
    if (minutes > 0 || hours > 0 || days > 0) uptimeStr += `${minutes}m `
    uptimeStr += `${seconds}s`

    return uptimeStr
  }

  /**
   * Gets the number of active mappings (active in the last 24 hours)
   * @param {Array} mappings Array of chat mappings
   * @returns {Number} Number of active mappings
   */
  getActiveMappings(mappings) {
    return mappings.filter((m) => {
      const lastActivity = new Date(m.last_activity)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      return lastActivity > oneDayAgo
    }).length
  }

  /**
   * Gets the total number of messages in the database
   * @param {Object} database Database manager
   * @returns {Number} Total number of messages
   */
  async getTotalMessageCount(database) {
    try {
      const result = database.db.prepare("SELECT COUNT(*) as count FROM message_logs").get()
      return result.count
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting total message count:\n`, error)
      return 0
    }
  }

  /**
   * Gets battery information from WhatsApp
   * @param {Object} whatsappManager WhatsApp manager
   * @returns {Object} Battery information
   */
  async getBatteryInfo(whatsappManager) {
    try {
      if (whatsappManager.client && typeof whatsappManager.client.getBatteryLevel === "function") {
        const batteryLevel = await whatsappManager.client.getBatteryLevel()
        const isPlugged = await whatsappManager.client.getIsPlugged()
        return {
          percentage: batteryLevel,
          plugged: isPlugged,
        }
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting battery info:\n`, error)
    }
    return null
  }

  /**
   * Gets platform information from WhatsApp
   * @param {Object} whatsappManager WhatsApp manager
   * @returns {String} Platform information
   */
  async getPlatformInfo(whatsappManager) {
    try {
      if (whatsappManager.client && typeof whatsappManager.client.getHostDevice === "function") {
        const hostDevice = await whatsappManager.client.getHostDevice()
        return hostDevice
      }
    } catch (error) {
      console.error(`${getTimestamp()} | Error getting platform info:\n`, error)
    }
    return null
  }

  /**
   * Gets an emoji for a message type
   * @param {String} type Message type
   * @returns {String} Emoji
   */
  getEmojiForType(type) {
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
      cipher: "🔐",
      unknown: "❓",
    }
    return emojiMap[type] || "📱"
  }
}

module.exports = StatsManager
