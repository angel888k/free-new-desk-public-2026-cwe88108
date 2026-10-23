# Third-Party Notices

Free New Desk is a clean implementation. Third-party dependencies retain their own licenses.

| Name | Version | License | Source | Bundled |
| --- | --- | --- | --- | --- |
| Electron | 44.7.0 | MIT | https://github.com/electron/electron | Yes |
| Vue | 3.5.43 | MIT | https://github.com/vuejs/core | Yes |
| Pinia | 3.0.3 | MIT | https://github.com/vuejs/pinia | Yes |
| Vue Router | 4.5.1 | MIT | https://github.com/vuejs/router | Yes |
| Zod | 3.25.76 | MIT | https://github.com/colinhacks/zod | Yes |
| music-metadata | 11.16.1 | MIT | https://github.com/Borewit/music-metadata | Yes |
| mpv / libmpv | commit `c152964208` | LGPL-2.1-or-later build; bundled FFmpeg declared LGPLv3 by provider | https://github.com/zhongfly/mpv-winbuild/releases/tag/2026-10-04-c152964208 | Windows package |

SQLite persistence uses the `node:sqlite` module embedded in Node.js/Electron. It does not add a separate npm native addon to the package.

The Windows package currently bundles `mpv-dev-lgpl-x86_64-20261004-git-c152964208.7z` from `zhongfly/mpv-winbuild`. The archive SHA-256 recorded by the source manifest is `b656b1d3f18f3db619894c22b68023acabd856e9e026b2a8516f30f1a44ee0bc`; the bundled `libmpv-2.dll` SHA-256 is `ee7dde89da6ddecb2adf7fc7585d4d89124dfaa2e1b476393a04c06ab7b02ad6`. See `third_party/mpv/win-x64/SOURCE.txt` for the pinned provider and upstream commit. A validated archive is retained in the local runtime cache for repeat builds because upstream daily releases may expire.

Source adapters are independently implemented from documented protocol behavior. No FongMi/TV or zyfun source code is copied into this repository.

## Compatibility protocol references

TVBox configuration shell compatibility is independently implemented from observable public protocol behavior. No third-party TVBox source code is bundled or copied into Free New Desk; the implementation uses Node.js built-in crypto primitives only.

## Non-bundled compatibility test fixtures

The byte-pinned qist/tvbox drpy2 test fixtures already present in this public repository contain upstream cryptographic parser markers and published demonstration keys. These are test-only data, not application credentials, and tests/ is excluded from installer payloads. Fixture integrity is pinned to its reviewed SHA-256; changes require review. Upstream: https://github.com/qist/tvbox .
