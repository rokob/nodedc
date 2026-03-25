# Changelog

## [0.5.0](https://github.com/rokob/nodedc/compare/nodedc-v0.4.0...nodedc-v0.5.0) (2026-03-25)


### Features

* **stream:** move dictionary compression onto async worker threads ([bb8cd57](https://github.com/rokob/nodedc/commit/bb8cd574c64ddccef0693c14fa6ec43164bd9b24))

## [0.4.0](https://github.com/rokob/nodedc/compare/nodedc-v0.3.0...nodedc-v0.4.0) (2026-03-24)

### Features

- **http:** make compression negotiation algorithm preference configurable ([b707627](https://github.com/rokob/nodedc/commit/b707627477c03d0e18cff7464b8e9f4005d1768a))

### Bug Fixes

- **http:** align dictionary negotiation with RFC 9842 ([8da6ccb](https://github.com/rokob/nodedc/commit/8da6ccbd898788d975bb41889ea09b6e00793dba))

## [0.3.0](https://github.com/rokob/nodedc/compare/nodedc-v0.2.1...nodedc-v0.3.0) (2026-03-23)

### Features

- add dictionary file loading and zstd reuse benchmark ([60680ce](https://github.com/rokob/nodedc/commit/60680ced265a9a9bf81ad3b72a3f12e01ab52976))
- add store-optimized compression negotiation ([bf0c2fa](https://github.com/rokob/nodedc/commit/bf0c2fa5be7f11a3371cfbeef8d09dbed5950958))

## [0.2.1](https://github.com/rokob/nodedc/compare/nodedc-v0.2.0...nodedc-v0.2.1) (2026-03-23)

### Bug Fixes

- use node 24 for trusted publishing ([f3450a8](https://github.com/rokob/nodedc/commit/f3450a8fac15bd9ce8637ca289eabc0af9614fa7))

## [0.2.0](https://github.com/rokob/nodedc/compare/nodedc-v0.1.0...nodedc-v0.2.0) (2026-03-23)

### Features

- automate releases and scoped npm publishing ([d1f0c31](https://github.com/rokob/nodedc/commit/d1f0c313629cc1cf2149e7aaa15d4a69ab94f21c))
- prepare automated release pipeline ([329a5f9](https://github.com/rokob/nodedc/commit/329a5f9651cc174cda29a59550a387be3fe08bcc))

### Bug Fixes

- enable c++ exceptions for linux builds ([37dd51e](https://github.com/rokob/nodedc/commit/37dd51ea935a45ddd2ed481a5330e8fe03a82e26))
