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

/**
 * Validates environment variables to ensure they have been properly configured
 * @returns {Object} Validation result with success status and errors
 */
function validateEnvironmentVariables() {
  const errors = []
  const warnings = []

  // Required environment variables with their placeholder values
  const requiredVars = {
    DISCORD_BOT_TOKEN: "your_discord_bot_token_here",
    DISCORD_GUILD_ID: "your_discord_guild_id_here",
    DISCORD_CHANNEL_ID: "your_discord_category_id_here",
  }

  // Optional environment variables with their placeholder values
  const optionalVars = {
    ADMIN_DISCORD_CHANNEL_ID: "your_ADMIN_DISCORD_CHANNEL_ID_here",
    ADMIN_WHATSAPP_CHAT_ID: "your_ADMIN_WHATSAPP_CHAT_ID_here",
  }

  // Check required variables
  for (const [varName, placeholder] of Object.entries(requiredVars)) {
    const value = process.env[varName]

    if (!value) {
      errors.push(`❌ ${varName} is not set in .env file`)
    } else if (value === placeholder) {
      errors.push(
        `❌ ${varName} is still using the default placeholder value. Please update it with your actual ${varName.toLowerCase().replace(/_/g, " ")}.`,
      )
    } else if (value.trim() === "") {
      errors.push(`❌ ${varName} is empty. Please provide a valid value.`)
    }
  }

  // Check optional variables for placeholder values
  for (const [varName, placeholder] of Object.entries(optionalVars)) {
    const value = process.env[varName]

    if (value === placeholder) {
      warnings.push(`⚠️  ${varName} is using the default placeholder value. This feature will be disabled.`)
    }
  }

  // Additional validation for specific formats
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN !== requiredVars.DISCORD_BOT_TOKEN) {
    // Discord bot tokens should be around 70 characters and contain dots
    if (process.env.DISCORD_BOT_TOKEN.length < 50 || !process.env.DISCORD_BOT_TOKEN.includes(".")) {
      errors.push(
        `❌ DISCORD_BOT_TOKEN appears to be invalid. Discord bot tokens are typically 70+ characters long and contain dots.`,
      )
    }
  }

  // Check Discord IDs format (should be numeric and 17-19 characters)
  const discordIdVars = ["DISCORD_GUILD_ID", "DISCORD_CHANNEL_ID", "ADMIN_DISCORD_CHANNEL_ID"]
  for (const varName of discordIdVars) {
    const value = process.env[varName]
    if (value && value !== requiredVars[varName] && value !== optionalVars[varName]) {
      if (!/^\d{17,19}$/.test(value)) {
        errors.push(`❌ ${varName} should be a numeric Discord ID (17-19 digits). Current value: "${value}"`)
      }
    }
  }

  // Check WhatsApp chat ID format if provided
  if (
    process.env.ADMIN_WHATSAPP_CHAT_ID &&
    process.env.ADMIN_WHATSAPP_CHAT_ID !== optionalVars.ADMIN_WHATSAPP_CHAT_ID
  ) {
    const waId = process.env.ADMIN_WHATSAPP_CHAT_ID
    if (!waId.includes("@") || (!waId.endsWith("@c.us") && !waId.endsWith("@g.us"))) {
      errors.push(
        `❌ ADMIN_WHATSAPP_CHAT_ID should be a WhatsApp chat ID ending with @c.us (contact) or @g.us (group). Current value: "${waId}"`,
      )
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
  }
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

      // Validate environment variables before proceeding
      console.log("🔍 Validating environment configuration...")
      const validation = validateEnvironmentVariables()

      if (!validation.success) {
        console.error("\n❌ CONFIGURATION ERROR: Environment variables are not properly configured!\n")

        validation.errors.forEach((error) => console.error(error))

        console.error("\n📝 TO FIX THIS:")
        console.error("1. Copy .env.example to .env if you haven't already:")
        console.error("   cp .env.example .env")
        console.error("2. Edit the .env file and replace all placeholder values with your actual values")
        console.error("3. Make sure you have:")
        console.error("   - Created a Discord bot and copied its token")
        console.error("   - Copied your Discord server (guild) ID")
        console.error("   - Created a Discord category and copied its ID")
        console.error("4. Restart the application after updating .env\n")

        process.exit(1)
      }

      // Show warnings for optional configurations
      if (validation.warnings.length > 0) {
        console.log("\n⚠️  CONFIGURATION WARNINGS:")
        validation.warnings.forEach((warning) => console.log(warning))
        console.log("These features will be disabled but the bridge will still work.\n")
      }

      console.log("✅ Environment configuration validated successfully!")

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
        this.database.cleanupExpiredPendingMediaCounts()
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
