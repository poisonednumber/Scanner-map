# Discord Bot Setup

[← Back to README](../README.md)

The Discord bot posts radio call transcriptions and provides AI-powered features.

---

## Features

- 📢 Auto-post transcriptions by talk group
- 🔔 Keyword alerts for specific terms
- 📊 AI-generated summaries
- 💬 "Ask AI" about recent calls
- 🔊 Live audio streaming (optional)

---

## Creating a Discord Bot

### Step 1: Create Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it "Scanner Map" (or your preference)
4. Click **Create**

### Step 2: Create Bot

1. Go to **Bot** section
2. Click **Add Bot** → **Yes, do it!**
3. Under **Token**, click **Reset Token**
4. **Copy the token** - you'll need this for `.env`

### Step 3: Configure Permissions

1. Under **Privileged Gateway Intents**, enable:
   - ✅ Message Content Intent
   - ✅ Server Members Intent (optional)

2. Go to **OAuth2** → **URL Generator**
3. Select scopes:
   - ✅ `bot`
   - ✅ `applications.commands`

4. Select bot permissions:
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Read Message History
   - ✅ Use Slash Commands
   - ✅ Connect (for voice)
   - ✅ Speak (for voice)

5. Copy the generated URL

### Step 4: Invite Bot

1. Paste the URL in your browser
2. Select your Discord server
3. Click **Authorize**

---

## Configuration

Add these settings to your `.env` file:

```env
# Enable Discord bot
ENABLE_DISCORD=true

# Bot token (from Developer Portal)
DISCORD_TOKEN=your-bot-token-here

# Client ID (from Developer Portal → General Information)
CLIENT_ID=your-client-id
```

---

## Channel Setup

After the bot joins your server:

### Transcription Channel

Use slash commands to configure which talk groups post to which channels:

```
/setup channel:#fire-dispatch talkgroup:1001
/setup channel:#police-dispatch talkgroup:1002
```

### Keyword Alerts

Set up keyword notifications:

```
/alert add keyword:structure fire channel:#alerts
/alert add keyword:shooting channel:#alerts
/alert add keyword:pursuit channel:#alerts
```

### Summary Channel

Configure the AI summary feature:

```
/summary channel:#summary
```

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/setup` | Configure talk group to channel mapping |
| `/alert` | Manage keyword alerts |
| `/summary` | Generate AI summary of recent calls |
| `/ask` | Ask AI about recent call history |
| `/status` | Show bot status and statistics |

---

## AI Summary

The bot can generate periodic AI summaries of radio activity.

### Configuration

```env
# Hours of history to include in summary
SUMMARY_LOOKBACK_HOURS=1
```

### Manual Summary

Use `/summary` in Discord to generate an on-demand summary.

### Features

- Incident counts by category
- Notable events
- Activity trends
- Refresh button for updates

---

## Ask AI Feature

Chat with AI about recent call history.

### Configuration

```env
# Hours of history for Ask AI context
ASK_AI_LOOKBACK_HOURS=8
```

### Usage

```
/ask question:What structure fires have there been today?
/ask question:Any vehicle pursuits in the last hour?
/ask question:Summarize activity in Baltimore City
```

---

## Voice Channel (Optional)

Stream live audio to a Discord voice channel.

### Requirements

- Bot needs Connect and Speak permissions
- FFmpeg installed on server
- Sufficient bandwidth

### Note

This feature is experimental and may require additional configuration.

---

## Troubleshooting

### Bot not responding

1. Verify `ENABLE_DISCORD=true`
2. Check bot token is correct
3. Ensure bot is in the server
4. Check bot has required permissions

### "Missing Access" errors

- Bot needs channel permissions
- Right-click channel → Edit Channel → Permissions
- Add bot with Send Messages, Embed Links

### Slash commands not appearing

1. Verify `CLIENT_ID` is correct
2. Wait up to 1 hour for global command sync
3. Try kicking and re-inviting the bot

### Transcriptions not posting

1. Verify channel is configured: `/status`
2. Check talk group is mapped
3. Verify transcriptions are working (check web UI)

---

## Security Notes

⚠️ **Never share your bot token!**

If your token is compromised:
1. Go to Developer Portal → Bot
2. Click **Reset Token**
3. Update `.env` with new token
4. Restart Scanner Map

---

## Disabling Discord

To run Scanner Map without Discord:

```env
ENABLE_DISCORD=false
```

The web interface and all other features will continue to work normally.

