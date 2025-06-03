require("dotenv").config()
const DatabaseManager = require("./lib/database")
const DiscordManager = require("./lib/discord-manager")
const WhatsAppManager = require("./lib/whatsapp-manager")
const StatsManager = require("./lib/stats-manager")
const MediaManager = require("./lib/media-manager")
const fs = require("fs-extra")

function getTimestamp() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "")
}

class WhatsAppDiscordBridge {
  constructor() {
    this.database = null
    this.discordManager = null
    this.whatsappManager = null
    this.statsManager = null
    this.mediaManager = null
    this.isRunning = false
  }

  async initialize() {
    try {
      console.log("🚀 Initializing WhatsApp Discord Bridge...")

      // Ensure data directory exists
      await fs.ensureDir("./data")

      // Initialize database
      console.log("📊 Initializing database...")
      this.database = new DatabaseManager()

      // Initialize Discord manager
      console.log("🤖 Initializing Discord bot...")
      this.discordManager = new DiscordManager()
      await this.discordManager.login()

      // Wait for Discord to be ready
      await this.waitForDiscordReady()

      // Initialize WhatsApp manager
      console.log("📱 Initializing WhatsApp bot...")
      this.whatsappManager = new WhatsAppManager(this.discordManager, this.database)

      // Initialize Stats manager
      console.log("📈 Initializing Stats manager...")
      this.statsManager = new StatsManager(this)

      // Initialize Media manager
      console.log("🎬 Initializing Media manager...")
      this.mediaManager = new MediaManager()

      // Connect the managers
      this.discordManager.setWhatsAppManager(this.whatsappManager)
      this.discordManager.setStatsManager(this.statsManager)
      this.discordManager.setMediaManager(this.mediaManager)
      this.discordManager.setDatabase(this.database)
      this.whatsappManager.setStatsManager(this.statsManager)
      this.whatsappManager.setMediaManager(this.mediaManager)

      await this.whatsappManager.start()

      // Start periodic cleanup for media files and Discord-sent message records
      this.mediaManager.startPeriodicCleanup()
      this.startPeriodicDatabaseCleanup()

      this.isRunning = true
      console.log(`
··································································
: W     W  AA      DDD   CCC     BBBB  RRRR  III DDD   GGG  EEEE :
: W     W A  A     D  D C        B   B R   R  I  D  D G     E    :
: W  W  W AAAA     D  D C    --- BBBB  RRRR   I  D  D G  GG EEE  :
:  W W W  A  A     D  D C        B   B R R    I  D  D G   G E    :
:   W W   A  A     DDD   CCC     BBBB  R  RR III DDD   GGG  EEEE :
:································································:
: ⏰ Time: ${getTimestamp()}
: 📦 Version: ${process.env.VERSION || "development"}
: 🖊️ By: ${process.env.AUTHOR || "Unknown"}
:   Check for updates at:
: ⏫ ${process.env.GITHUB_REPO || ""}
··································································`)
      console.log("\n✅ WhatsApp Discord Bridge is now running!")
      console.log("📋 Current chat mappings:", this.database.getAllMappings().length)
      console.log(`🎮 Command prefix: ${process.env.COMMAND_PREFIX || "!"}`)
      console.log(`🔧 Running in ${process.env.NODE_ENV} Mode`)
      console.log(`❓ Send '${process.env.COMMAND_PREFIX || "!"}help' in Discord AdminChannel for further help.`)

      // Set stats command channels
      if (process.env.ADMIN_DISCORD_CHANNEL_ID) {
        this.discordManager.setStatsChannelId(process.env.ADMIN_DISCORD_CHANNEL_ID)
        console.log(`⚜️ Admin Discord channel set to: ${process.env.ADMIN_DISCORD_CHANNEL_ID}`)
      }

      if (process.env.ADMIN_WHATSAPP_CHAT_ID) {
        this.whatsappManager.setStatsChatId(process.env.ADMIN_WHATSAPP_CHAT_ID)
        console.log(`⚜️ Admin WhatsApp ID set to: ${process.env.ADMIN_WHATSAPP_CHAT_ID}`)
      }

      // Set up graceful shutdown
      this.setupGracefulShutdown()
    } catch (error) {
      console.error("❌ Failed to initialize bridge:", error)
      await this.shutdown()
      process.exit(1)
    }
  }

  startPeriodicDatabaseCleanup() {
    // Clean up expired Discord-sent message records every 10 minutes
    setInterval(
      () => {
        this.database.cleanupExpiredDiscordSentMessages()
        this.database.cleanupExpiredDiscordSentMessageIds()
        this.database.cleanupExpiredDiscordSentFileHashes()
      },
      10 * 60 * 1000,
    )

    console.log(`${getTimestamp()} | 🧹 Started periodic database cleanup`)
  }

  async waitForDiscordReady() {
    return new Promise((resolve) => {
      if (this.discordManager.isReady) {
        resolve()
      } else {
        const checkReady = () => {
          if (this.discordManager.isReady) {
            resolve()
          } else {
            setTimeout(checkReady, 100)
          }
        }
        checkReady()
      }
    })
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)
      await this.shutdown()
      process.exit(0)
    }

    process.on("SIGINT", () => shutdown("SIGINT"))
    process.on("SIGTERM", () => shutdown("SIGTERM"))
    process.on("uncaughtException", async (error) => {
      console.error("Uncaught Exception:", error)
      await this.shutdown()
      process.exit(1)
    })
  }

  async shutdown() {
    if (!this.isRunning) return

    console.log("🔄 Shutting down bridge...")
    this.isRunning = false

    try {
      if (this.discordManager) {
        await this.discordManager.destroy()
      }

      if (this.database) {
        this.database.close()
      }

      // Clean up any remaining temp files
      if (this.mediaManager) {
        await this.mediaManager.cleanupOldTempFiles()
      }

      console.log("✅ Bridge shutdown complete")
    } catch (error) {
      console.error("Error during shutdown:", error)
    }
  }

  // Utility methods for monitoring
  getStats() {
    if (!this.database) return null

    const mappings = this.database.getAllMappings()
    const recentMessages = this.database.getRecentMessages(10)

    return {
      totalChats: mappings.length,
      activeMappings: mappings.filter((m) => {
        const lastActivity = new Date(m.last_activity)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
        return lastActivity > oneDayAgo
      }).length,
      recentMessages: recentMessages.length,
      isRunning: this.isRunning,
    }
  }
}

// Start the bridge
const bridge = new WhatsAppDiscordBridge()
bridge.initialize().catch(console.error)

// Export for potential API usage
module.exports = WhatsAppDiscordBridge
