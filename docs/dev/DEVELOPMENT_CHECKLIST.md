# Development Checklist

**CRITICAL RULE**: Whenever anything is added that requires dependencies or configuration, it MUST be automatically integrated into the installer and startup.

---

## 🔴 Before Adding Any New Feature

### Step 1: Identify What's Needed
- [ ] Does it need a new npm package?
- [ ] Does it need a new Python package?
- [ ] Does it need new environment variables?
- [ ] Does it need a new service/container?
- [ ] Does it need API keys or credentials?
- [ ] Does it need ports or URLs configured?

### Step 2: Update Dependencies

#### npm Package
- [ ] Add to `package.json` dependencies
- [ ] Run `npm install` to test
- [ ] **MUST** add to `scripts/installer/dependency-installer.js` if it's a system dependency
- [ ] **MUST** add installation check to installer prerequisites

#### Python Package
- [ ] Add to `requirements.txt`
- [ ] Test installation: `pip install -r requirements.txt`
- [ ] **MUST** add Python check to `dependency-installer.js`
- [ ] **MUST** add to installer prerequisites if required

### Step 3: Update Configuration

#### Environment Variables
- [ ] Add to `.env.example` with:
  - Clear description
  - Default value (if applicable)
  - Example value
  - Whether it's required or optional
- [ ] **MUST** add to `scripts/installer/env-generator.js`:
  - Include in config object
  - Add prompt if user input needed
  - Auto-configure if possible (URLs, ports, etc.)
  - Set sensible defaults
- [ ] Update `docs/CONFIGURATION.md` with new variable
- [ ] Add validation in code that uses it

### Step 4: Update Installer

#### New Service/Integration
- [ ] **MUST** add to `scripts/installer/installer-core.js`:
  - New configuration step (if needed)
  - Add to config object
  - Add to summary display
- [ ] **MUST** add to `scripts/installer/service-config.js`:
  - Service configuration method
  - API key generation (if needed)
  - Auto-configuration of URLs/ports
- [ ] **MUST** add to `scripts/installer/env-generator.js`:
  - Include in .env generation
  - Auto-configure URLs based on installation type

#### Docker Service
- [ ] **MUST** add to `scripts/installer/docker-compose-builder.js`:
  - Service definition
  - Ports configuration
  - Volume mounts
  - Environment variables
  - Network configuration
  - GPU support (if applicable)
- [ ] **MUST** add to `scripts/installer/docker-installer.js`:
  - Service enablement logic
  - Image pulling/building
  - Startup configuration

#### Local Service
- [ ] **MUST** add to `scripts/installer/local-installer.js`:
  - Installation check
  - Installation method
  - Configuration steps
  - Auto-start setup (if applicable)

### Step 5: Update Documentation

- [ ] Update `README.md` if it's a major feature
- [ ] Update `docs/CONFIGURATION.md` with new settings
- [ ] Update relevant feature docs (e.g., `docs/DOCKER.md`, `docs/TRANSCRIPTION.md`)
- [ ] Update `CHANGELOG.md`

### Step 6: Test

- [ ] Test installer with new feature
- [ ] Test Docker installation path
- [ ] Test Local installation path
- [ ] Verify auto-configuration works
- [ ] Verify defaults are sensible
- [ ] Test error handling

---

## 📋 Quick Reference: Files to Update

| What You're Adding | Files to Update |
|-------------------|----------------|
| **npm package** | `package.json`, `dependency-installer.js` |
| **Python package** | `requirements.txt`, `dependency-installer.js` |
| **Environment variable** | `.env.example`, `env-generator.js`, `docs/CONFIGURATION.md` |
| **New service** | `installer-core.js`, `service-config.js`, `env-generator.js` |
| **Docker service** | `docker-compose-builder.js`, `docker-installer.js`, `installer-core.js` |
| **Local service** | `local-installer.js`, `dependency-installer.js` |
| **GPU support** | `gpu-detector.js`, `docker-compose-builder.js` |
| **New port** | `installer-core.js` (DEFAULTS), `docker-compose-builder.js`, docs |

---

## 🎯 Auto-Configuration Principles

1. **URLs**: Always auto-configure based on installation type (Docker vs Local)
2. **Ports**: Use sensible defaults, document in DEFAULTS constant
3. **API Keys**: Auto-generate when possible, save to files
4. **Service Detection**: Auto-detect if service is running/installed
5. **Dependencies**: Auto-install missing dependencies when possible
6. **Defaults**: Always provide sensible defaults, never require manual config

---

## ⚠️ Common Mistakes to Avoid

- ❌ Adding a package but not updating installer
- ❌ Adding env var but not adding to env-generator.js
- ❌ Adding service but not adding Docker support
- ❌ Hardcoding URLs/ports instead of using DEFAULTS
- ❌ Requiring manual configuration when auto-config is possible
- ❌ Not updating documentation

---

## ✅ Example: Adding a New Service

Let's say you want to add "Redis" for caching:

1. **Dependencies**: Add `redis` to `package.json`
2. **Environment**: Add `REDIS_URL`, `REDIS_PORT` to `.env.example`
3. **Installer**: 
   - Add Redis detection to `dependency-installer.js`
   - Add Redis service to `docker-compose-builder.js`
   - Add Redis config to `env-generator.js` (auto-configure URL)
   - Add optional Redis step to `installer-core.js`
4. **Documentation**: Update `docs/CONFIGURATION.md` and `docs/DOCKER.md`
5. **Test**: Run installer, verify Redis is auto-configured

---

## 🔍 Verification Checklist

Before committing, verify:
- [ ] Installer runs without errors
- [ ] New feature appears in installer flow
- [ ] Auto-configuration works (URLs, ports, keys)
- [ ] Defaults are sensible
- [ ] Documentation is updated
- [ ] .env.example includes new variables
- [ ] Docker Compose includes new services (if applicable)
- [ ] Error handling is in place

