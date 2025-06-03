# WhatsApp Discord Bridge - Complete Guide

A comprehensive bridge that forwards messages between WhatsApp and Discord with full two-way communication, media support, and echo prevention.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Discord Bot Setup](#discord-bot-setup)
- [Project Installation](#project-installation)
- [Configuration](#configuration)
- [Running the Application](#running_the_application)
- [How to Use](#how_to_use)
- [Smart Message Sending](#smart-message-sending)
- [Stats Command](#stats-command)
- [Media Forwarding](#media-forwarding)
- [Echo Prevention](#echo-prevention)
- [Advanced Admin Commands](#advanced-admin-commands)
- [Troubleshooting](#troubleshooting)
- [Advanced Features](#advanced-features)
- [Production Deployment](#production-deployment)
- [FAQ](#faq)

## Features

✅ **Automatic Message Forwarding**: WhatsApp messages are automatically forwarded to Discord threads  
✅ **Dedicated Threads**: Each WhatsApp chat gets its own Discord thread  
✅ **Two-Way Communication**: Reply from Discord threads back to WhatsApp  
✅ **Media Forwarding**: Full media support in both directions (images, videos, audio, documents)  
✅ **Echo Prevention**: Your own WhatsApp messages appear in Discord without infinite loops  
✅ **Complete Conversation View**: See all messages (yours and others) in Discord threads  
✅ **Database Logging**: Tracks all messages and chat mappings  
✅ **Auto-Reconnection**: Handles connection drops gracefully  
✅ **Thread Management**: Automatically unarchives threads when new messages arrive  
✅ **Visual Feedback**: Reactions confirm successful message delivery  
✅ **Stats Command**: Monitor bridge status and statistics  
✅ **Automatic Cleanup**: Manages temporary files and database records  
✅ **Smart Message Sending**: Send messages by index, phone number, or chat ID with confirmation  
✅ **Chat Management**: Mute, block, and manage individual chats  
✅ **Contact Profiles**: View detailed WhatsApp contact information  
✅ **Advanced Admin Controls**: Pause, resume, purge, and comprehensive chat listing  

## Prerequisites

Before starting, ensure you have:

- **Node.js 16.9.0 or higher** ([Download here](https://nodejs.org/))
- **A Discord account** with a server where you have admin permissions
- **A WhatsApp account** (will be used for the bot)
- **Google Chrome** (required for WhatsApp Web automation)
- **Basic command line knowledge**

## Discord Bot Setup

### Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"**
3. Enter a name for your bot (e.g., "WhatsApp Bridge")
4. Click **"Create"**

### Step 2: Create the Bot

1. In your application, navigate to the **"Bot"** tab in the left sidebar
2. Click **"Add Bot"**
3. Customize your bot:
   - Set a username
   - Upload an avatar (optional)
   - Uncheck **"Public Bot"** if you want it private

### Step 3: Configure Bot Permissions

1. Still in the **"Bot"** tab, scroll down to **"Privileged Gateway Intents"**
2. Enable the following intents:
   - ✅ **SERVER MEMBERS INTENT**
   - ✅ **MESSAGE CONTENT INTENT**
   - ✅ **PRESENCE INTENT**
3. Click **"Save Changes"**

### Step 4: Get Your Bot Token

1. In the **"Bot"** tab, find the **"Token"** section
2. Click **"Reset Token"** (or "Copy" if it's your first time)
3. **IMPORTANT**: Copy and save this token securely
4. ⚠️ **Never share this token publicly or commit it to version control**

### Step 5: Invite Bot to Your Server

1. Go to the **"OAuth2"** > **"URL Generator"** tab
2. Select the following **Scopes**:
   - ✅ `bot`
   - ✅ `applications.commands`

3. Select the following **Bot Permissions**:
   - ✅ Read Messages/View Channels
   - ✅ Send Messages
   - ✅ Create Public Threads
   - ✅ Send Messages in Threads
   - ✅ Manage Threads
   - ✅ Read Message History
   - ✅ Use Slash Commands
   - ✅ Add Reactions
   - ✅ Attach Files

4. Copy the generated URL and open it in your browser
5. Select your Discord server and click **"Authorize"**

### Step 6: Create Category and Get IDs

1. In Discord, go to **User Settings** > **Advanced**
2. Enable **"Developer Mode"**
3. **Create a category** for WhatsApp chats:
   - Right-click in your server's channel list
   - Select **"Create Category"**
   - Name it something like "WhatsApp Chats" or "WA Bridge"
4. Right-click on the **category** you just created
5. Click **"Copy ID"** - this is your `DISCORD_CHANNEL_ID` (category ID)
6. (Optional) Create a separate channel for admin commands
7. Right-click on that channel and **"Copy ID"** - this is your `STATS_DISCORD_CHANNEL_ID`

**Important:** The `DISCORD_CHANNEL_ID` should be a **category ID**, not a regular channel ID. All WhatsApp chat channels will be created inside this category for better organization.

## Project Installation

### Step 1: Download the Project

```bash
# Clone or download the project files
# If you have the files, navigate to the project directory
cd whatsapp-discord-bridge
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Create Data Directories

```bash
# Create necessary directories
mkdir -p data/sessions data/qr-codes data/media data/temp
```

## Configuration

### Step 1: Create Environment File

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

### Step 2: Configure Environment Variables

Edit the `.env` file with your values:

```env
# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CHANNEL_ID=your_discord_channel_id_here

# Stats Command Configuration (Optional)
STATS_DISCORD_CHANNEL_ID=your_stats_discord_channel_id_here
STATS_WHATSAPP_CHAT_ID=your_stats_whatsapp_chat_id_here

# Optional: Set to 'development' for more verbose logging
NODE_ENV=production
```

**Replace the values:**
- `DISCORD_BOT_TOKEN`: The token you copied from Discord Developer Portal
- `DISCORD_CHANNEL_ID`: The channel ID where threads will be created
- `STATS_DISCORD_CHANNEL_ID`: (Optional) Channel ID where `!stats` command works
- `STATS_WHATSAPP_CHAT_ID`: (Optional) WhatsApp chat ID where `!stats` command works

### Step 3: Verify Configuration

Double-check that:
- ✅ Bot token is correct and complete
- ✅ Channel ID is correct
- ✅ Bot has been invited to your server
- ✅ Bot has proper permissions in the channel

## Running the Application

### Step 1: Start the Bridge

```bash
npm start
```

You should see output similar to:
```
🚀 Initializing WhatsApp Discord Bridge...
📊 Initializing database...
Database tables initialized
🤖 Initializing Discord bot...
Discord bot logged in as YourBot#1234
📱 Initializing WhatsApp bot...
🎬 Initializing Media manager...
QR Code saved to ./data/qr-codes/wa-discord-bridge.png
Please scan the QR code with your WhatsApp mobile app
```

### Step 2: Scan WhatsApp QR Code

1. Open the QR code image from `./data/qr-codes/wa-discord-bridge.png`
2. Open WhatsApp on your phone
3. Go to **Settings** > **Linked Devices** > **Link a Device**
4. Scan the QR code displayed in the image

### Step 3: Verify Connection

Once connected, you should see:
```
WhatsApp bot started with number: +1234567890
✅ WhatsApp Discord Bridge is now running!
📋 Current chat mappings: 0
🎬 Media forwarding enabled (both directions)
🔄 Echo prevention enabled for your own messages
```

## How to Use

### WhatsApp to Discord

1. **Automatic Forwarding**: When someone sends you a message on WhatsApp, it will automatically appear as a beautiful embed in a Discord thread
2. **Thread Creation**: Each WhatsApp chat gets its own dedicated thread in your specified Discord channel
3. **Your Own Messages**: Messages you send directly on WhatsApp also appear in Discord (marked as "You" in WhatsApp green)
4. **Visual Design**: Messages now appear as embeds with:
   - **Your messages**: WhatsApp green color (`#25d366`)
   - **Other users**: Unique, consistent colors from a 16-color palette
   - **Author field**: Shows sender name
   - **Timestamps**: Accurate message timing
   - **Message type icons**: 💬📷🎥🎵📄🎭📍 for different content types

### Message Types & Visual Indicators

The bridge recognizes and beautifully displays all message types:
- 💬 **Text messages**: Clean embed with message content
- 📷 **Images**: Thumbnail with caption support
- 🎥 **Videos**: Preview with caption support  
- 🎵 **Audio/Voice messages**: Audio icon with file info
- 📄 **Documents**: Document icon with filename
- 🎭 **Stickers**: Sticker display with type indicator
- 📍 **Location shares**: Location icon with coordinates
- 💫 **Reactions**: Special reaction embeds showing who reacted with what emoji

### Group Chat Colors

In group chats, each participant gets a unique color that remains consistent:
- Colors are assigned based on user ID hash for consistency
- 16 different colors available in the palette
- Same user always gets the same color across all chats
- Your messages always appear in WhatsApp green regardless of chat type

### Discord to WhatsApp

1. **Reply in Threads**: Simply type your message in any Discord thread created by the bot
2. **Media Support**: Attach files, images, videos, or audio to send them to WhatsApp
3. **Automatic Forwarding**: Your message will be sent to the corresponding WhatsApp chat
4. **Visual Confirmation**: The bot will react with ✅ when the message is sent successfully, or ❌ if there's an error

### Echo Prevention

The bridge intelligently prevents infinite loops:

- **Messages sent from Discord to WhatsApp**: Tracked to prevent showing them again in Discord
- **Your direct WhatsApp messages**: Appear in Discord as "You" in WhatsApp green without creating loops
- **Smart Detection**: Uses message hashing to identify previously sent messages
- **Automatic Cleanup**: Tracking records expire after 5 minutes

### Example Workflow

1. Someone sends you "Hello!" on WhatsApp
2. A new Discord thread is created: "👤 John Doe"
3. The message appears as a beautiful embed:
   - **Author**: John Doe
   - **Title**: 💬 Message
   - **Content**: Hello!
   - **Color**: Unique color for John Doe (e.g., blue)
   - **Timestamp**: 2024-01-15 14:30
4. You reply in the Discord thread: "Hi there!"
5. Your reply is sent to John Doe on WhatsApp
6. The bot reacts with ✅ to confirm delivery
7. You send a message directly on WhatsApp: "How are you?"
8. This message appears in Discord as an embed:
   - **Author**: You
   - **Title**: 💬 Message  
   - **Content**: How are you?
   - **Color**: WhatsApp green
   - **Timestamp**: 2024-01-15 14:32

## Smart Message Sending

The bridge includes a powerful `!send` command that allows administrators to send messages to any WhatsApp chat directly from Discord. This feature supports three different targeting methods for maximum convenience.

### Method 1: Index-Based Sending (Recommended)

This is the easiest and most user-friendly method:

#### Step 1: List Available Chats
```
!getchats
```

**Example Output:**
```
📱 WhatsApp Chats (Page 1/16)

1. 👥 Group
📝 Name: Wolfz Hub Classroom
📞 Phone: N/A
🆔 ID: 120363202271671360@g.us
💬 Messages: 0

2. 👤 Contact
📝 Name: John Doe
📞 Phone: +1234567890
🆔 ID: 1234567890@c.us
💬 Messages: 15

3. 👤 Contact
📝 Name: Alice Smith
📞 Phone: +9876543210
🆔 ID: 9876543210@c.us
💬 Messages: 8

---
Total Chats: 156 | Page: 1/16
Use `!getchats 2` for next page

💡 Tip: Use `!send <number> <message>` to send to a chat by its number!
```

#### Step 2: Send by Index with Confirmation
```
!send 1 Hey everyone, meeting starts in 10 minutes!
```

**Confirmation Dialog:**
```
🔍 Confirm sending message to:

1. 👥 Group
📝 Name: Wolfz Hub Classroom
📞 Phone: N/A
🆔 ID: 120363202271671360@g.us
💬 Message: "Hey everyone, meeting starts in 10 minutes!"

React with ✅ to confirm or ❌ to cancel.
```

#### Step 3: Confirm and Send
React with ✅ to send the message:

```
✅ Message sent successfully
Group: #1 (Wolfz Hub Classroom)
Message: "Hey everyone, meeting starts in 10 minutes!"
🧵 New thread created!
```

### Method 2: Phone Number Sending

Send directly to a contact using their phone number:

```
!send 1234567890 Hello! How are you doing?
```

**Features:**
- Automatically converts phone number to WhatsApp chat ID
- Works with or without country code
- Supports + prefix or plain numbers
- Only works for contacts (not groups)

### Method 3: Chat ID Sending

Send using the full WhatsApp chat ID:

```
!send 1234567890@c.us Hello there!           # Contact
!send 120363202271671360@g.us Hello everyone! # Group
```

**Features:**
- Direct targeting using WhatsApp's internal chat IDs
- Works for both contacts (@c.us) and groups (@g.us)
- No confirmation dialog (immediate sending)
- Most precise targeting method

### Chat List Caching System

The index-based sending uses a smart caching system:

- **5-minute cache**: Chat lists are cached for 5 minutes per user
- **User-specific**: Each Discord user has their own independent cache
- **Automatic expiration**: Cache expires for security and data freshness
- **Refresh required**: Run `!getchats` again if cache expires

**Cache Expiration Example:**
```
User: !send 1 Hello!
Bot: ❌ Chat list cache expired
Please run `!getchats` first to refresh the chat list, then try again.
```

### Pagination Support

For users with many chats, the system supports pagination:

```
!getchats 1    # Page 1 (default)
!getchats 2    # Page 2
!getchats 3    # Page 3
```

Each page shows 10 chats with their index numbers continuing sequentially.

### Thread Creation and Management

When you send a message to a chat that doesn't have a Discord thread:

1. **Automatic Thread Creation**: A new thread is created automatically
2. **Thread Naming**: Uses chat name and type emoji (👤 for contacts, 👥 for groups)
3. **Initial Message**: Shows connection details and timestamp
4. **Message Display**: Your sent message appears in the thread with a special "sent via !send" indicator

### Error Handling and Validation

The system includes comprehensive error handling:

- **Invalid Index**: "❌ Invalid chat index. There are only 156 chats available."
- **Non-existent Chat**: "❌ Contact `1234567890@c.us` does not exist."
- **Invalid Format**: "❌ Invalid chat ID format. Must end with @c.us or @g.us"
- **WhatsApp Unavailable**: "❌ WhatsApp client not available"
- **Timeout**: "❌ Send cancelled - no response received."

### Security Features

1. **Confirmation Required**: Index-based sending always requires confirmation
2. **30-second Timeout**: Confirmation dialogs timeout after 30 seconds
3. **User Cancellation**: Users can cancel with ❌ reaction
4. **Cache Expiration**: Prevents sending to wrong chats with stale data
5. **Validation Checks**: Multiple layers of validation before sending

### Best Practices

1. **Use Index Method**: Most convenient for frequently accessed chats
2. **Keep Cache Fresh**: Run `!getchats` regularly to update your chat list
3. **Verify Before Confirming**: Always check the confirmation dialog details
4. **Use Pagination**: Navigate through pages to find specific chats
5. **Bookmark Important Chats**: Note down index numbers of frequently used chats

## Advanced Admin Commands

The bridge includes powerful administrative commands for managing chats, monitoring activity, and controlling the bridge operation.

### Chat Management Commands

#### !getchats - List All WhatsApp Chats

**Usage:**
```
!getchats [page_number]
```

**Examples:**
```
!getchats      # Show page 1 (default)
!getchats 2    # Show page 2
!getchats 5    # Show page 5
```

**Features:**
- **Paginated Display**: Shows 10 chats per page
- **Chat Indexing**: Each chat gets a number for easy reference
- **Detailed Information**: Shows name, phone, chat ID, and message count
- **Type Indicators**: 👤 for contacts, 👥 for groups
- **Cache Integration**: Results are cached for index-based sending

**Sample Output:**
```
📱 WhatsApp Chats (Page 1/16)

1. 👥 Group
📝 Name: Wolfz Hub Classroom
📞 Phone: N/A
🆔 ID: 120363202271671360@g.us
💬 Messages: 0

2. 👤 Contact
📝 Name: John Doe
📞 Phone: +1234567890
🆔 ID: 1234567890@c.us
💬 Messages: 15

---
Total Chats: 156 | Page: 1/16
Use `!getchats 2` for next page

💡 Tip: Use `!send <number> <message>` to send to a chat by its number!
```

#### !send - Smart Message Sending

**Usage:**
```
!send <index|phone_number|chat_id> <message>
```

**Three Targeting Methods:**

1. **Index-Based (with confirmation):**
   ```
   !send 1 Hello there!
   ```

2. **Phone Number:**
   ```
   !send 1234567890 Hello!
   !send +1234567890 Hello!
   ```

3. **Chat ID:**
   ```
   !send 1234567890@c.us Hello!     # Contact
   !send 1234567890@g.us Hello all! # Group
   ```

**Index-Based Confirmation Flow:**
1. Shows detailed chat information
2. Displays the message to be sent
3. Requires ✅ reaction to confirm
4. 30-second timeout for safety
5. Can be cancelled with ❌ reaction

#### !purge - Complete Data Reset

**Usage:**
```
!purge
```

**What it does:**
- Deletes ALL chat mappings from database
- Removes ALL Discord threads created by the bridge
- Clears ALL message logs
- Resets bridge state to initial condition
- Requires confirmation to prevent accidents

**Confirmation Process:**
```
⚠️ WARNING: This will delete ALL chat mappings and Discord threads!

React with ✅ to confirm or ❌ to cancel.
```

**Results:**
```
✅ Purge completed!
📊 Deleted 156 chat mappings
🧵 Deleted 142 Discord threads
🗄️ Cleared all message logs
```

### Bridge Control Commands

#### !pause - Pause Message Forwarding

**Usage:**
```
!pause
```

**What it does:**
- Stops all message forwarding between WhatsApp and Discord
- Commands still work (stats, help, etc.)
- Useful for maintenance or troubleshooting
- Can be resumed with `!start`

**Response:**
```
⏸️ Bridge paused
No messages will be forwarded until you use `!start`
```

#### !start - Resume Message Forwarding

**Usage:**
```
!start
```

**What it does:**
- Resumes message forwarding after being paused
- Restores normal bridge operation
- All queued messages will be processed

**Response:**
```
▶️ Bridge resumed
Message forwarding is now active
```

### Information Commands

#### !stats - Comprehensive Statistics

**Usage:**
```
!stats
```

**Available in:**
- Discord stats channel (if configured)
- WhatsApp stats chat (if configured)

**Information Provided:**
- Bridge status and uptime
- WhatsApp connection details (phone number, battery, device)
- Discord connection details (bot user, servers)
- Chat statistics (total chats, active chats, message counts)
- System information (platform, memory, CPU)
- Recent activity log
- Message type breakdown

#### !help - Command Reference

**Usage:**
```
!help
```

**Available in:**
- Any Discord thread (thread-specific commands)
- Discord stats channel (all commands)
- WhatsApp (basic commands)

**Provides:**
- Complete command list
- Usage examples
- Feature overview
- Troubleshooting tips

### Thread-Specific Commands

These commands work within Discord threads linked to WhatsApp chats:

#### !profile - Contact Information

**Usage:**
```
!profile
```

**Requirements:**
- Must be used in a Discord thread
- Thread must be linked to a WhatsApp contact (not group)
- WhatsApp client must be available

**Information Shown:**
- Contact name and phone number
- Status message
- Profile picture (if available)
- Business account status

#### !mute / !unmute - Chat Control

**Usage:**
```
!mute      # Stop forwarding from this WhatsApp chat
!unmute    # Resume forwarding from this WhatsApp chat
```

**Features:**
- Per-chat muting (doesn't affect other chats)
- Immediate effect
- Persists across bridge restarts
- Commands still work when muted

#### !block / !unblock - Contact Management

**Usage:**
```
!block     # Block this contact on WhatsApp
!unblock   # Unblock this contact on WhatsApp
```

**Requirements:**
- Only works for contacts (not groups)
- WhatsApp client must be available
- Changes are applied directly to WhatsApp

#### !sticker - Media as Sticker

**Usage:**
```
!sticker
```

**Requirements:**
- Must attach an image or video file
- Use `!sticker` as the message caption
- File will be sent as a WhatsApp sticker

### Command Permissions

**Stats Channel Commands:**
- Only work in the designated stats Discord channel
- Require admin access to that channel
- Include all administrative functions

**Thread Commands:**
- Work in any Discord thread created by the bridge
- Limited to thread-specific functions
- Available to anyone with thread access

**WhatsApp Commands:**
- Only work from the designated stats WhatsApp chat
- Limited to basic commands (!stats, !help)
- Require access to the specific chat

### Error Handling

All commands include comprehensive error handling:

- **Permission Errors**: Clear messages about required permissions
- **Validation Errors**: Helpful guidance for correct usage
- **Connection Errors**: Status information about WhatsApp/Discord availability
- **Timeout Errors**: Automatic cleanup of expired operations
- **User Errors**: Friendly error messages with usage examples

### Security Considerations

1. **Channel Restrictions**: Admin commands only work in designated channels
2. **Confirmation Dialogs**: Destructive operations require explicit confirmation
3. **Timeout Protection**: Operations timeout to prevent hanging
4. **User Isolation**: Each user has independent caches and sessions
5. **Audit Trail**: All operations are logged for monitoring

## New Commands

### Admin Commands (Stats Channel Only)

- **`!stats`** - Display comprehensive bridge statistics
- **`!pause`** - Pause all message forwarding (commands still work)
- **`!start`** - Resume message forwarding after pause
- **`!purge`** - Delete all chat mappings and Discord threads (requires confirmation)

### Thread Commands (Discord Only)

- **`!profile`** - Display WhatsApp contact information (contacts only, not groups)
- **`!sticker`** - Send attached image/video as a sticker to WhatsApp (use as caption)

### Enhanced Features

#### Message Reactions
When someone reacts to a message on WhatsApp (e.g., with ❤️), the reaction will appear in the Discord thread:
```
💫 **John Doe** reacted with ❤️
```

#### Media Captions
Images and videos sent from WhatsApp with captions will now display the caption text in Discord:
```
**John Doe** (2024-01-15 14:30):
📷 *Image*
**Caption:** Check out this sunset!
```

#### Chat Type Detection
The bridge now identifies and handles different chat types:
- 👤 **Contacts** (ending with @c.us) - Individual conversations
- 👥 **Groups** (ending with @g.us) - Group conversations  
- Other chat types are automatically ignored

#### Sticker Support
Send images or videos from Discord as WhatsApp stickers by using `!sticker` as the message caption.

#### Pause/Resume Functionality
Administrators can pause the bridge to stop message forwarding while keeping commands active. Useful for maintenance or troubleshooting.

#### Profile Information
Get detailed contact information including:
- Name and phone number
- Status message
- Profile picture
- Last seen (if available)
- Business account status

## Visual Design & User Experience

### Beautiful Embed System

All WhatsApp messages now appear as Discord embeds for a clean, professional look:

#### **Color Coding System**
- 🟢 **Your Messages**: WhatsApp green (`#25d366`) - easily identify your own messages
- 🔵 **Other Users**: 16 unique colors assigned consistently per user
- ⚪ **System Messages**: Gray for connection notifications and system info
- 🔴 **Error Messages**: Red for failed operations or warnings

#### **Embed Components**
- **Author Field**: Shows sender name (e.g., "John Doe" or "You")
- **Title**: Message type with emoji (💬 Message, 📷 Image, 🎥 Video, etc.)
- **Description**: Message content, caption, or filename
- **Timestamp**: Exact time when message was sent on WhatsApp
- **Footer**: Additional info like file size for media
- **Color Bar**: Left border showing user's assigned color

#### **Group Chat Experience**
In group chats, the color system really shines:
- Each participant gets a unique, consistent color
- Easy to follow conversations with multiple people
- Colors are assigned using a hash of the user ID for consistency
- Same person always gets the same color, even across different groups

#### **Media Display**
Media messages get special treatment:
- **Images/Videos**: Embedded with thumbnail and caption
- **Audio**: File icon with duration and size info
- **Documents**: File type icon with filename and size
- **Stickers**: Special sticker indicator with type (static/animated)
- **File Size**: Always shown in footer for transparency

#### **Reaction Display**
When someone reacts to a message on WhatsApp:
```
💫 Message Reaction
John Doe reacted with ❤️
```
- Special embed format for reactions
- Shows who reacted and with what emoji
- Uses the reactor's assigned color

#### **Error Handling**
When something goes wrong:
- Red-colored embeds for errors
- Clear error messages
- Fallback to text display if media fails
- Visual indicators for failed operations

### Accessibility Features

- **High Contrast**: Color choices ensure readability
- **Consistent Layout**: Same embed structure for all message types
- **Clear Timestamps**: Easy to track conversation timing
- **Visual Hierarchy**: Important info prominently displayed
- **Icon System**: Universal symbols for message types

## Stats Command

Monitor your bridge with the `!stats` command.

### Usage

Simply type: `!stats`

### Where to Use

- **Discord**: In the channel specified by `STATS_DISCORD_CHANNEL_ID`
- **WhatsApp**: From the chat specified by `STATS_WHATSAPP_CHAT_ID`

### Sample Output

```
📊 **WHATSAPP-DISCORD BRIDGE STATISTICS**

🔄 **Status:** `online`
⏱️ **Uptime:** `1d 3h 25m 12s`

📱 **WHATSAPP**
**Connected:** `Yes`
**Host Number:** `+1234567890`
**Battery:** `78% (Not charging)`
**Device:** `Android`

🤖 **DISCORD**
**Connected:** `Yes`
**Bot User:** `WhatsAppBridge#1234`
**Servers:** `1`

📊 **CHAT STATISTICS**
**Total Chats:** `12`
**Active Chats:** `5`
**Total Messages:** `156`
**Message Types:**
  💬 text: `134`
  📷 image: `15`
  🎥 video: `4`
  📄 document: `3`

💻 **SYSTEM**
**Platform:** `win32 (x64)`
**Node.js:** `v18.16.0`
**Memory:** `95 MB / 16384 MB`
**CPU Load:** `0.12, 0.08, 0.05`

🔄 **RECENT ACTIVITY**
`2024-01-15 14:30:25` 💬 John Doe (WhatsApp → Discord)
`2024-01-15 14:28:12` 📷 Alice Smith (WhatsApp → Discord)
`2024-01-15 14:25:01` 💬 You (Discord → WhatsApp)

---
Generated at: 2024-01-15 14:35:20
```

### Statistics Explained

- **Status**: Current operational status of the bridge
- **Uptime**: How long the bridge has been running since last restart
- **WhatsApp Section**: Connection status, phone number, battery level, device type
- **Discord Section**: Bot connection status, username, server count
- **Chat Statistics**: Number of chats, active chats, message counts by type
- **System Information**: OS, Node.js version, memory usage, CPU load
- **Recent Activity**: Last 5 messages processed by the bridge

## Media Forwarding

### WhatsApp to Discord

**Supported Media Types:**
- 📷 **Images**: JPG, PNG, GIF, WebP
- 🎥 **Videos**: MP4, WebM, MOV
- 🎵 **Audio**: MP3, WAV, OGG, AAC
- 🎤 **Voice Messages**: Converted and forwarded
- 📄 **Documents**: PDF, DOC, TXT, etc.
- 🎭 **Stickers**: Both static and animated

**Features:**
- Automatic file type detection
- File size checking (Discord 8MB limit)
- Caption preservation
- Automatic cleanup of temporary files

### Discord to WhatsApp

**Supported Attachments:**
- All image formats supported by WhatsApp
- Video files (automatically optimized)
- Audio files and voice recordings
- Documents and files

**Features:**
- Automatic format conversion when needed
- Caption support (use message text)
- File size optimization
- Error handling with user feedback

### File Size Limits

- **Discord**: 8MB for regular users, 50MB for Nitro users
- **WhatsApp**: Varies by media type (typically 16MB for videos, 100MB for documents)
- **Automatic Handling**: Files too large will show an error message instead of failing silently

## Echo Prevention

### How It Works

1. **Message Tracking**: When you send a message from Discord to WhatsApp, it's recorded in the database
2. **Hash Comparison**: Messages are identified using content hashing
3. **Smart Filtering**: When your WhatsApp sends a message, it's checked against recent Discord-sent messages
4. **Automatic Cleanup**: Tracking records expire after 5 minutes and are cleaned up every 10 minutes

### What You'll See

**Your Discord messages in WhatsApp**: Normal WhatsApp messages  
**Your WhatsApp messages in Discord**: Appear as "**You** (timestamp): message"  
**Others' messages**: Appear as "**Their Name** (timestamp): message"

### Console Logs

```bash
# When sending from Discord to WhatsApp:
📝 Recorded Discord-sent message for chat 1234567890@c.us
✅ Forwarded message from Discord to WhatsApp chat 1234567890@c.us

# When you send directly on WhatsApp:
📤 Processing own message to forward to Discord: text
✅ Forwarded text message from You to Discord thread 9876543210

# When preventing echo:
🔄 Message was sent from Discord, skipping echo to Discord
```

## Troubleshooting

### Common Issues

#### 1. "Discord client is not ready"
**Solution**: Wait a few seconds for the Discord bot to fully connect, then try again.

#### 2. "WhatsApp client not initialized"
**Solution**: 
- Check if the QR code was scanned successfully
- Restart the application
- Ensure WhatsApp Web is working in your browser

#### 3. "Thread not found" or "Channel not found"
**Solution**:
- Verify your `DISCORD_CHANNEL_ID` is correct
- Ensure the bot has permissions in that channel
- Check that the bot is still in your Discord server

#### 4. Messages not forwarding
**Solution**:
- Check console logs for error messages
- Verify both WhatsApp and Discord connections are active
- Restart the application

#### 5. Media files not sending
**Solution**:
- Check file size limits (8MB for Discord, varies for WhatsApp)
- Verify file format is supported
- Check available disk space for temporary files

#### 6. Echo prevention not working
**Solution**:
- Restart the bridge to reset tracking
- Check database permissions
- Verify timestamps are correct on your system

#### 7. Stats command not working
**Solution**:
- Check that you're using the command in the correct channel/chat
- Verify environment variables are set correctly
- Ensure the bot has permission to read and send messages

### Debug Mode

Enable debug mode for more detailed logging:

1. Edit your `.env` file:
```env
NODE_ENV=development
```

2. Or modify the WhatsApp configuration in `lib/whatsapp-manager.js`:
```javascript
debug: true, // Change from false to true
```

### Log Files

Check the console output for detailed information about:
- Connection status
- Message forwarding
- Error messages
- Database operations
- Media processing
- Echo prevention

## Advanced Features

### Database Management

The bridge uses SQLite to store:
- **Chat Mappings**: Links between WhatsApp chats and Discord threads
- **Message Logs**: History of all forwarded messages
- **Echo Prevention**: Tracking of Discord-sent messages

Database location: `./data/datenbank.db`

### Automatic Cleanup

- **Temporary Files**: Cleaned up after use and every hour
- **Echo Prevention Records**: Expire after 5 minutes, cleaned every 10 minutes
- **Old Media Files**: Removed automatically to save disk space

### Custom Configuration

You can modify various settings in the code:

#### Thread Auto-Archive Duration
In `lib/discord-manager.js`:
```javascript
autoArchiveDuration: 1440, // 24 hours (in minutes)
```

#### Echo Prevention TTL
In `lib/database.js`:
```javascript
recordDiscordSentMessage(waChatId, messageContent, 5) // 5 minutes TTL
```

#### Message Body Length Limit
In `lib/database.js`:
```javascript
const safeMessageBody = messageBody ? String(messageBody).substring(0, 1000) : ""
```

#### Session Data Location
In `lib/whatsapp-manager.js`:
```javascript
sessionDataPath: "./data/sessions",
```

## Production Deployment

### Using PM2 (Recommended)

1. **Install PM2**:
```bash
npm install -g pm2
```

2. **Create PM2 configuration** (`ecosystem.config.js`):
```javascript
module.exports = {
  apps: [{
    name: 'whatsapp-discord-bridge',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
```

3. **Start with PM2**:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Using Docker

1. **Create Dockerfile**:
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN mkdir -p data/sessions data/qr-codes data/media data/temp

EXPOSE 3000
CMD ["npm", "start"]
```

2. **Build and run**:
```bash
docker build -t whatsapp-discord-bridge .
docker run -d --name wa-discord-bridge \
  -v $(pwd)/data:/app/data \
  -e DISCORD_BOT_TOKEN=your_token \
  -e DISCORD_CHANNEL_ID=your_channel_id \
  whatsapp-discord-bridge
```

### VPS Deployment

1. **Server Requirements**:
   - Ubuntu 20.04+ or similar
   - Node.js 16.9.0+
   - At least 1GB RAM
   - Persistent storage for database

2. **Setup Steps**:
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install dependencies for Chrome
sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget

# Clone and setup project
git clone <your-repo-url>
cd whatsapp-discord-bridge
npm install
```

## FAQ

### Q: Can I use this with multiple WhatsApp accounts?
A: Currently, the bridge supports one WhatsApp account per instance. You can run multiple instances with different session IDs for multiple accounts.

### Q: Will this work with WhatsApp Business?
A: Yes, the bridge works with both regular WhatsApp and WhatsApp Business accounts.

### Q: Can I customize the message format?
A: Yes, you can modify the `formatMessageForDiscord` function in `lib/whatsapp-manager.js` to change how messages appear in Discord.

### Q: Is my data secure?
A: The bridge runs locally on your machine/server. WhatsApp session data is stored locally, and no messages are sent to external services except Discord.

### Q: Can I add more Discord servers?
A: Currently, the bridge supports one Discord channel per instance. You can modify the code to support multiple channels or run multiple instances.

### Q: What happens if the bot goes offline?
A: When the bot comes back online, it will reconnect to both WhatsApp and Discord. Messages sent while offline won't be forwarded, but new messages will work normally.

### Q: How do I get WhatsApp chat IDs for stats?
A: Enable debug mode and check the console logs. Chat IDs are displayed when messages are received. Alternatively, use `!getchats` to see all chat IDs.

### Q: Can I disable echo prevention?
A: Yes, you can comment out the echo prevention checks in `lib/whatsapp-manager.js`, but this is not recommended as it may cause infinite loops.

### Q: How much storage does the bridge use?
A: The database is typically small (a few MB). Temporary media files are cleaned up automatically, but ensure you have enough space for processing large media files.

### Q: Can I backup my chat mappings?
A: Yes, backup the `./data/datenbank.db` file. This contains all chat mappings and message logs.

### Q: How do I update the bridge?
A: 
1. Stop the current instance
2. Backup your `data` folder
3. Update the code files
4. Run `npm install` to update dependencies
5. Restart the bridge

### Q: Why do some media files fail to send?
A: Common reasons include file size limits, unsupported formats, or network issues. Check the console logs for specific error messages.

### Q: Can I customize the message colors?
A: The color system is designed for optimal readability and consistency. You can modify the `colorPalette` array in `lib/discord-manager.js` to use different colors, but the current palette was chosen for good contrast and accessibility.

### Q: Why do some users have the same color in different chats?
A: Colors are assigned consistently per user across all chats. This means John Doe will always have the same color whether you're talking in a group chat or individual chat, making it easier to recognize who's speaking.

### Q: Can I disable the embed system and go back to plain text?
A: The embed system is now the default for better visual organization. If you need plain text for any reason, you can modify the `forwardMessageForDiscord` function in `lib/whatsapp-manager.js` to use the old `formatMessageForDiscord` method instead of embeds.

### Q: How many different colors are available for users?
A: There are 16 different colors in the palette. If you have more than 16 active users, colors will be reused, but the same user will always get the same color.

### Q: Do reactions from Discord get sent to WhatsApp?
A: Currently, only WhatsApp reactions are forwarded to Discord. Discord reactions are not sent back to WhatsApp due to WhatsApp API limitations.

### Q: Why are my messages a different color than others?
A: Your own messages always appear in WhatsApp green (`#25d366`) to make it easy to distinguish your messages from others in the conversation flow.

### Q: How does the index-based sending work?
A: When you run `!getchats`, the chat list is cached for 5 minutes. You can then use `!send 1 message` to send to chat #1 from that list. A confirmation dialog shows the chat details before sending.

### Q: What happens if my chat list cache expires?
A: You'll get an error message asking you to run `!getchats` again. The cache expires after 5 minutes for security and to ensure you're working with current data.

### Q: Can multiple admins use the index-based sending?
A: Yes! Each Discord user has their own independent chat list cache. Multiple admins can use `!getchats` and `!send` simultaneously without conflicts.

### Q: Why do I need to confirm index-based sends?
A: The confirmation dialog prevents accidentally sending messages to the wrong chat. It shows you exactly which chat you're targeting and what message will be sent before you confirm.

### Q: Can I send to groups using phone numbers?
A: No, phone number sending only works for individual contacts. Groups must be targeted using their full chat ID (ending in @g.us) or by index from the `!getchats` list.

### Q: What's the difference between the three sending methods?
A: 
- **Index**: Most convenient, requires confirmation, uses cached chat list
- **Phone**: Direct contact targeting, no confirmation needed
- **Chat ID**: Most precise, works for both contacts and groups, no confirmation

### Q: How do I find a specific chat in a long list?
A: Use pagination with `!getchats 2`, `!getchats 3`, etc. You can also search the output for specific names or phone numbers.

### Q: What happens when I send a message via !send?
A: The message is sent to WhatsApp, a Discord thread is created (if it doesn't exist), and the sent message appears in the thread with a special indicator showing it was sent via the admin command.

### Q: Can I cancel a send operation?
A: Yes, for index-based sending, you can react with ❌ to cancel during the confirmation dialog. For other methods, the send happens immediately.

### Q: Why does the !purge command require confirmation?
A: `!purge` deletes ALL chat mappings and Discord threads permanently. The confirmation prevents accidental data loss. Always backup your data before using this command.

### Q: What's the difference between !pause and !mute?
A: `!pause` stops ALL message forwarding globally, while `!mute` only stops forwarding from a specific chat. `!pause` affects the entire bridge, `!mute` is per-chat.

### Q: Can I see who sent a message via !send in the WhatsApp chat?
A: The message appears as if sent from your WhatsApp account normally. The Discord thread shows it was sent via the admin command, but WhatsApp recipients see it as a regular message from you.

## Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. Enable debug mode for detailed logs
3. Check that all prerequisites are met
4. Verify your Discord bot permissions
5. Ensure WhatsApp Web works in your browser
6. Check file permissions for the data directory

## Security Notes

- Only users with access to the designated Discord channel can use the Discord stats command
- Only the specified WhatsApp chat can trigger the WhatsApp stats command
- No sensitive information (like tokens or passwords) is included in the stats output
- The bridge provides monitoring information only and cannot be used to control sensitive operations
- Always keep your Discord bot token secure and never share it publicly

## License

This project is for educational and personal use. Please respect WhatsApp's Terms of Service and Discord's Terms of Service when using this bridge.

---

**Happy bridging! 🌉**

*Last updated: January 2024*
