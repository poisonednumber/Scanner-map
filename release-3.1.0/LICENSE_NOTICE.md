# License Notice

## Scanner Map License

Scanner Map does not currently have an explicit license file. Please contact the project maintainer for licensing information.

## Third-Party Components

### TrunkRecorder

**License:** GNU General Public License v3.0 (GPL-3.0)  
**Official Repository:** https://github.com/TrunkRecorder/trunk-recorder  
**Docker Image:** `lwcooper/trunk-recorder:latest` (community-maintained)  
**Docker Repository:** https://github.com/TrunkRecorder/trunk-recorder-docker (official Docker setup)

#### License Compliance

TrunkRecorder is included in the Docker Compose setup as an **optional service**. The Docker Compose configuration references the official TrunkRecorder Docker image, which is pulled at runtime from Docker Hub.

**Important Notes:**

1. **Runtime Dependency**: TrunkRecorder is not bundled with Scanner Map source code. The Docker Compose file references the public Docker image, which users pull separately when running `docker-compose up`.

2. **GPL-3.0 Implications**: 
   - If you distribute Scanner Map with TrunkRecorder as part of a combined work, GPL-3.0 copyleft may apply
   - Using separate Docker containers (as in the current setup) provides better license isolation
   - Users can choose to not use TrunkRecorder if they prefer

3. **Recommendation**: 
   - Make TrunkRecorder **optional** in docker-compose.yml (users can comment it out)
   - Document that TrunkRecorder is a separate, GPL-3.0 licensed project
   - Provide clear attribution to TrunkRecorder in documentation

4. **Attribution**: When using TrunkRecorder, please include:
   - Copyright notice for TrunkRecorder
   - Link to official TrunkRecorder repository: https://github.com/TrunkRecorder/trunk-recorder
   - Link to Docker repository: https://github.com/TrunkRecorder/trunk-recorder-docker
   - GPL-3.0 license text (available in TrunkRecorder repository at https://github.com/TrunkRecorder/trunk-recorder/blob/master/LICENSE)

## Recommendations

1. **Add a LICENSE file** to Scanner Map to clarify the project's license
2. **Make TrunkRecorder optional** in docker-compose.yml (not required)
3. **Document license compatibility** - ensure Scanner Map's license is compatible with GPL-3.0 if bundling
4. **Consider alternatives** - users can use SDRTrunk or other compatible software instead of TrunkRecorder

## Current Setup

The current Docker Compose setup:
- References TrunkRecorder as a separate service
- Does not bundle TrunkRecorder source code
- Pulls the Docker image at runtime (user's responsibility)
- Can be easily disabled by commenting out the service

This approach minimizes license concerns while providing convenience to users.

