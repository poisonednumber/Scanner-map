# Dependency Update Notes

## Changes Made

### Node.js Version Support
- Updated `engines.node` from `<24.0.0` to `<25.0.0` to support Node.js v24

### Package Updates
- Updated `@discordjs/voice` from `^0.16.0` to `^0.18.0` (addresses deprecated encryption modes warning)

### Install Scripts
- Removed deprecated `--ignore-optional` flag from `install.bat` and `install.sh`
  - Modern npm versions handle optional dependencies better automatically
  - This flag will stop working in future npm versions

## Remaining Deprecation Warnings

Many of the deprecation warnings you see are from **transitive dependencies** (dependencies of dependencies) that we don't directly control. These include:

- `rimraf@3.0.2` - Used by fs-extra and other packages
- `glob@7.2.3` - Used by various build tools
- `npmlog@5.0.1` / `npmlog@6.0.2` - Used by npm tooling
- `inflight`, `are-we-there-yet`, `gauge`, `querystring`, `node-domexception` - Used by various npm packages

These will be updated automatically when the packages that depend on them are updated.

## Optional Dependencies

The `@discordjs/opus` package is marked as optional. If it fails to build (common on some systems), npm will skip it automatically and the app will still function, just without Opus support.

## Recommendations

1. **For production**: Consider using Node.js LTS (v22.x or v20.x) for maximum stability
2. **For development**: Node.js v24 should work fine now with the updated engine constraint
3. **Testing**: After updating, test all functionality to ensure everything works correctly

## Future Updates

When updating dependencies in the future:
- Test thoroughly after major version updates
- Review changelogs for breaking changes
- Consider using `npm outdated` to check for updates
- Use `npm audit` to check for security vulnerabilities

