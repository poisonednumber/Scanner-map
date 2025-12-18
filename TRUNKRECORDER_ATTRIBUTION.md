# TrunkRecorder Attribution

This project uses TrunkRecorder as an optional component for recording trunked radio systems.

## Official Repository

**TrunkRecorder** - https://github.com/TrunkRecorder/trunk-recorder

Records calls from a Trunked Radio System (P25 & SmartNet)

## License

TrunkRecorder is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

Full license text: https://github.com/TrunkRecorder/trunk-recorder/blob/master/LICENSE

## Copyright

Copyright (c) TrunkRecorder contributors

## Usage in Scanner Map

TrunkRecorder is integrated as an **optional Docker service** in Scanner Map. It is:
- Disabled by default in `docker-compose.yml`
- Can be enabled by uncommenting the service
- Uses the community-maintained Docker image: `lwcooper/trunk-recorder:latest`
- Official Docker repository: https://github.com/TrunkRecorder/trunk-recorder-docker

## GPL-3.0 Compliance

When using TrunkRecorder with Scanner Map:
- TrunkRecorder source code is not bundled with Scanner Map
- The Docker image is pulled at runtime from Docker Hub
- TrunkRecorder runs as a separate container/service
- Users can choose to not use TrunkRecorder (Scanner Map supports SDRTrunk, rdio-scanner, etc.)

This approach provides license isolation while maintaining user convenience.

## Links

- **Official Repository:** https://github.com/TrunkRecorder/trunk-recorder
- **Docker Repository:** https://github.com/TrunkRecorder/trunk-recorder-docker
- **License:** https://github.com/TrunkRecorder/trunk-recorder/blob/master/LICENSE
- **Documentation:** See the README in the official repository

