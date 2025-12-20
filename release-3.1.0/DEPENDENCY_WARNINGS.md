# Dependency Deprecation Warnings

## Overview

During `npm install`, you may see deprecation warnings for packages like:
- `rimraf@3.0.2` (use v5+)
- `glob@7.2.3` (use v9+)
- `npmlog@5.0.1` / `6.0.2`
- `inflight@1.0.6`
- `are-we-there-yet@2.0.0` / `3.0.1`
- `gauge@3.0.2` / `4.0.4`
- `querystring@0.2.0`
- `node-domexception@1.0.0`

## Why These Warnings Appear

These warnings are **mostly harmless** and come from:
1. **Transitive dependencies** - Packages that our dependencies depend on
2. **npm tooling itself** - Some deprecated packages are used by npm's own tooling
3. **Legacy packages** - Some packages (like `aws-sdk@2.x`) use older dependency versions

## What We've Done

### Updated Packages (as of latest changes)
- ✅ `fs-extra`: `^11.2.0` → `^11.3.3`
- ✅ `moment-timezone`: `^0.5.45` → `^0.6.0`
- ⚠️ `opusscript`: Kept at `^0.0.8` (prism-media requires this version, it's an optional dependency)
- ✅ `@discordjs/opus`: `^0.9.0` → `^0.10.0`
- ✅ Added npm `overrides` to force newer versions of `rimraf` and `glob` where possible

### Packages We Cannot Update (Breaking Changes)
- `inquirer`: v8 → v13 (major breaking changes, would require extensive refactoring)
- `aws-sdk`: v2 → v3 (major API changes, requires code migration)
- `chalk`: v4 → v5 (ESM-only, requires module system changes)
- `node-fetch`: v2 → v3 (ESM-only, requires module system changes)

### Warnings That Will Remain
Some warnings will persist because:
- They're dependencies of npm itself (we can't control these)
- They're deeply nested transitive dependencies
- The parent packages haven't been updated yet by their maintainers

## Impact

These warnings are **informational only** and do NOT affect:
- ✅ Functionality of the application
- ✅ Security (they're deprecated, not vulnerable)
- ✅ Installation success
- ✅ Runtime behavior

## Future Mitigation

As maintainers update their packages, these warnings should naturally decrease. We monitor and update dependencies regularly.

## If You Want to Reduce Warnings Further

You can suppress npm warnings (not recommended for production):

```bash
npm install --loglevel=error
```

Or filter warnings:

```bash
npm install 2>&1 | grep -v "warn deprecated"
```

## References

- [npm deprecation warnings](https://docs.npmjs.com/cli/v10/using-npm/deprecations)
- [npm overrides](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides)

