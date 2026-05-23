# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-23

### Added

- `POST /prompt/add` accepts an optional `overwrite` boolean. When `true`, an existing prompt with the same `clientName + requestId` is deleted and replaced, provided its status is `queued`, `completed`, `failed`, or `failed_retry`. Returns `409` if the prompt is currently `in_progress`.

## [1.0.0] - 2026-05-23

### Added

- Initial release.

[Unreleased]: https://github.com/BCsabaEngine/llm-relay/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/BCsabaEngine/llm-relay/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/BCsabaEngine/llm-relay/releases/tag/v1.0.0
