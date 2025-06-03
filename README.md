# WhatsApp Discord Bridge

A comprehensive bridge that forwards messages between WhatsApp and Discord with full two-way communication, beautiful embed formatting, media support, and advanced admin controls.

## ✨ Key Features

- 🔄 **Two-way message forwarding** between WhatsApp and Discord
- 🎨 **Beautiful embed formatting** with user-specific colors
- 📱 **Complete media support** (images, videos, audio, documents, stickers)
- 👥 **Group chat support** with distinct user colors
- 📊 **Stats and monitoring** commands
- 🎛️ **Advanced admin controls** (pause, resume, purge, mute)
- 📤 **Smart message sending** with index support and confirmation
- 🔇 **Individual chat muting** and contact blocking
- 👤 **Contact profile viewing** and management

## ❓ Why?

Imagine, you are playing a game on your PC or doing something else. Your phone is on the other side of the room.

Or your phone runs out of battery.

This project also allows to see messages, without appearing as **Online** for your contacts or display the blue ticks that you have seen it.

Deleted messages are preserved too.

## Before you start...

Yes, you need a server/computer that runs 24/7 to use this.

Yes, your messages are safe using this.

This project implements a unofficial WhatsApp API, which runs on your own PC.

- GitHub: https://github.com/open-wa/wa-automate-nodejs
- Documentation: https://docs.openwa.dev

Abuse of this project or violating the Whatsapp Terms of Usage, could result in a ban of your number! Use it wisely!

## 📖 Complete Documentation

For detailed setup instructions, configuration options, and troubleshooting, see the **[Complete Guide](GUIDE.md)**.

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Discord bot token, guild ID, and category ID
   ```

**Important Setup Notes:**
- For copying IDs you need to turn on the `Developer Mode` in the Discord Settings.
- `DISCORD_CHANNEL_ID` should be a **Discord category ID** where all WhatsApp chat channels will be created
- Create a category in your Discord server first, then copy its ID
- This keeps all WhatsApp chats organized in one place

3. **Start the bridge:**
   ```bash
   npm start
   ```

4. **Scan QR code** with WhatsApp mobile app

## 🎨 Message Display

Messages now appear as beautiful embeds with:
- **Your messages**: WhatsApp green color
- **Other users**: Unique consistent colors per user
- **Media support**: Images, videos, audio with captions
- **Reactions**: Special embed format
- **Timestamps**: Accurate message timing

## 🛠️ Commands

### Thread Commands (Discord)
- `!help` - Show help information
- `!profile` - Show contact information (contacts only)
- `!sticker` - Send media as WhatsApp sticker
- `!mute` / `!unmute` - Control chat forwarding
- `!block` / `!unblock` - Block/unblock contacts

### Admin Commands (Stats Channel)
- `!stats` - Show bridge statistics
- `!pause` / `!start` - Control message forwarding globally
- `!getchats [page]` - List all WhatsApp chats (paginated)
- `!send <index|phone|id> <message>` - Send messages with smart targeting
- `!purge` - Delete all data (admin only)
- `!help` - Show comprehensive help

## 📤 Smart Message Sending

The `!send` command now supports three convenient methods:

### 1. Index-Based Sending (NEW!)
```bash
!getchats              # List chats with numbers
!send 1 Hello there!   # Send to chat #1 with confirmation
```

### 2. Phone Number
```bash
!send 1234567890 Hello!
```

### 3. Chat ID
```bash
!send 1234567890@c.us Hello!     # Contact
!send 1234567890@g.us Hello all! # Group
```

## 🔒 Safety Features

- **Confirmation dialogs** for index-based sending
- **Chat list caching** with 5-minute expiration
- **Echo prevention** to avoid message loops
- **User-specific caches** for multi-admin setups
- **Comprehensive validation** and error handling

## 📄 License

For educational and personal use. Please respect WhatsApp's and Discord's Terms of Service.
