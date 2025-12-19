# Troubleshooting Guide

[← Back to README](../README.md)

Common issues and solutions for Scanner Map.

---

## Quick Checks

Before diving into specific issues:

1. **Check logs:**
   ```bash
   # Docker
   docker-compose logs -f scanner-map
   
   # Local
   npm start  # Watch console output
   ```

2. **Verify .env file exists and is configured**

3. **Confirm services are running:**
   ```bash
   docker-compose ps  # Docker
   ```

---

## Installation Issues

### "Node.js not found"

**Solution:** Install Node.js 18+
- Download from [nodejs.org](https://nodejs.org/)
- Restart terminal after installation

### "npm install fails"

**Common causes:**
- Network issues
- Missing build tools (Windows)

**Solutions:**
```bash
# Clear npm cache
npm cache clean --force

# Windows: Install build tools
npm install --global windows-build-tools

# Retry
npm install
```

### "Docker not found"

**Solution:** Install Docker Desktop
- [Windows](https://docs.docker.com/desktop/install/windows-install/)
- [macOS](https://docs.docker.com/desktop/install/mac-install/)
- [Linux](https://docs.docker.com/engine/install/)

### "Docker daemon not running"

**Solution:** Start Docker Desktop or Docker service
```bash
# Linux
sudo systemctl start docker
```

---

## Startup Issues

### "AI_PROVIDER is not set"

**Solution:** Add to `.env`:
```env
AI_PROVIDER=openai  # or 'ollama'
```

See [Configuration](CONFIGURATION.md) for full settings.

### "TRANSCRIPTION_MODE invalid"

**Valid values:** `local`, `remote`, `openai`, `icad`

```env
TRANSCRIPTION_MODE=local
```

### "Missing required environment variables"

The app validates required settings on startup. Check the error message and add missing variables to `.env`.

### "Port already in use"

**Solution:** Change the port or stop the conflicting service:
```bash
# Find what's using the port (Linux/macOS)
lsof -i :3001

# Windows
netstat -ano | findstr :3001
```

Or change in `.env`:
```env
WEBSERVER_PORT=3002
BOT_PORT=3307
```

---

## Transcription Issues

### No transcriptions appearing

1. **Check transcription mode:**
   ```env
   TRANSCRIPTION_MODE=local
   TRANSCRIPTION_DEVICE=cpu
   ```

2. **Check logs for errors:**
   ```bash
   docker-compose logs scanner-map | grep -i transcri
   ```

3. **Verify audio is being received:**
   - Check web UI for new calls
   - Check logs for upload messages

### "Python not found" (local mode)

**Solution:**
```env
PYTHON_COMMAND=python3
# or full path:
PYTHON_COMMAND=/usr/bin/python3
```

### "CUDA out of memory"

**Solutions:**
- Use smaller model: `WHISPER_MODEL=base`
- Switch to CPU: `TRANSCRIPTION_DEVICE=cpu`
- Close other GPU applications

### OpenAI: "401 Unauthorized"

- Verify `OPENAI_API_KEY` is correct
- Check API key has credits
- Ensure no extra spaces in `.env`

### iCAD: Empty transcriptions

1. Access iCAD web UI: http://localhost:9912
2. Install transcription models
3. Verify `ICAD_PROFILE` matches installed model

---

## Geocoding Issues

### Addresses not being extracted

1. **Check AI provider:**
   - Verify `AI_PROVIDER` settings
   - Ensure Ollama is running or OpenAI key is valid

2. **Check talk group mapping:**
   ```env
   MAPPED_TALK_GROUPS=1001,1002
   TALK_GROUP_1001=Your Area Description
   ```

3. **Verify dispatch channels:**
   - Only dispatch channels contain addresses
   - Tactical channels usually won't have addresses

### Wrong locations on map

1. **Expand target counties:**
   ```env
   GEOCODING_TARGET_COUNTIES=County1,County2,County3
   ```

2. **Verify location settings:**
   ```env
   GEOCODING_STATE=MD
   GEOCODING_CITY=Baltimore
   GEOCODING_COUNTRY=us
   ```

### "Geocoding failed" errors

| Provider | Solution |
|----------|----------|
| Nominatim | Rate limited - wait 1 second between requests |
| LocationIQ | Check API key and daily quota |
| Google | Verify billing is enabled |

---

## Web Interface Issues

### Can't access http://localhost:3001

1. **Check service is running:**
   ```bash
   docker-compose ps
   # or
   curl http://localhost:3001/api/test
   ```

2. **Check firewall:**
   ```bash
   # Windows
   netsh advfirewall firewall add rule name="Scanner Map" dir=in action=allow protocol=TCP localport=3001
   ```

3. **Try different browser or incognito mode**

### Map not loading

- Check browser console for errors (F12)
- Verify internet connection (map tiles need network)
- Clear browser cache

### Real-time updates not working

1. **Check WebSocket connection:**
   - Open browser dev tools → Network → WS tab
   - Should see socket.io connection

2. **Restart browser/clear cache**

3. **Check for proxy interference**

---

## Discord Issues

### Bot not responding

1. Verify settings:
   ```env
   ENABLE_DISCORD=true
   DISCORD_TOKEN=your-token
   ```

2. Check bot is in server with permissions

3. Restart Scanner Map

### "Missing Access" errors

Bot needs channel permissions:
- Right-click channel → Edit Channel → Permissions
- Add bot with Send Messages, Embed Links

### Slash commands not showing

1. Verify `CLIENT_ID` in `.env`
2. Wait up to 1 hour for sync
3. Try kicking and re-inviting bot

---

## Docker-Specific Issues

### Container keeps restarting

```bash
# Check exit code
docker inspect scanner-map --format='{{.State.ExitCode}}'

# Check logs
docker logs scanner-map --tail 100
```

### "Permission denied"

```bash
# Fix ownership
sudo chown -R $USER:$USER appdata/
```

### Out of disk space

```bash
# Clean Docker
docker system prune -a
```

### Can't connect between containers

Use service names, not localhost:
- Ollama: `http://ollama:11434`
- iCAD: `http://icad-transcribe:9912`

---

## Database Issues

### "Database locked"

Usually means multiple processes accessing the database.
- Ensure only one Scanner Map instance is running
- Restart the application

### "Database corrupted"

1. Stop Scanner Map
2. Backup the current database:
   ```bash
   cp data/botdata.db data/botdata.db.backup
   ```
3. Delete and let it recreate:
   ```bash
   rm data/botdata.db
   ```
4. Restart Scanner Map

**Note:** This will lose historical data.

---

## Getting Help

If you can't resolve an issue:

1. **Check logs** for specific error messages
2. **Search [GitHub Issues](https://github.com/poisonednumber/Scanner-map/issues)**
3. **Join [Discord](https://discord.gg/X7vej75zZy)** for community help
4. **Open a new issue** with:
   - Error messages
   - Your `.env` (remove sensitive keys)
   - Steps to reproduce
   - OS and Docker version

---

## Log Locations

| Installation | Location |
|--------------|----------|
| Docker | `appdata/scanner-map/logs/` |
| Docker | `docker-compose logs scanner-map` |
| Local | `logs/` directory |
| Local | Console output |

### Enabling Debug Logging

For more verbose output, check the application logs directly in the console or log files.

