# Test Directory

This directory contains test scripts, test outputs, and temporary test data.

## Structure

```
test/
├── README.md                    # This file
├── output/                      # Test outputs (ignored by git)
│   ├── test-installer-output/   # Installer configuration test results
│   └── *.json                   # Test result files
├── tmp/                         # Temporary test files (ignored by git)
│   └── test-api-key.txt         # API key for test event generator
└── test-run.bat                 # Test runner script (Windows)
```

## Test Scripts

Test scripts are located in `scripts/` directory:
- `scripts/test-installer-configs.js` - Tests installer configuration generation
- `scripts/test-event-generator.js` - Generates test radio call events
- `scripts/validate-installer-integration.js` - Validates installer integration

## Running Tests

### Installer Configuration Tests

```bash
npm run test-installer
```

This will:
- Test all configuration combinations
- Generate test outputs in `test/output/test-installer-output/`
- Save results to `test/output/test-results.json`

### Test Event Generator

```bash
node scripts/test-event-generator.js
```

This will:
- Generate random test radio call events
- Send them to the running Scanner Map instance
- Use API key from `test/tmp/test-api-key.txt` or environment variable

### Test Runner (Windows)

```bash
test\test-run.bat
```

This will:
- Clean up runtime files
- Start Scanner Map (Docker or local)
- Start test event generator
- Enable live reload

## Temporary Files

Temporary test files are stored in `test/tmp/`:
- `test-api-key.txt` - API key for test event generator (create manually if needed)

## Output Files

Test outputs are stored in `test/output/`:
- All files in this directory are ignored by git
- Test results, generated configs, and other outputs go here

## Note

The `test/` directory structure allows test outputs to be organized while keeping test scripts accessible in `scripts/`. All outputs and temporary files are ignored by git to keep the repository clean.

