# Chainshorts dApp Store Publishing

This folder contains Solana dApp Store CLI tooling and templates for publishing Chainshorts.

## Prerequisites

- Node.js `18` to `21` (latest tested in Solana docs: `21.7.3`)
- Android SDK build tools (AAPT2 available)
- Java JDK (`JAVA_HOME` configured)
- `ffmpeg` if you include preview videos

## Setup

1. Create local env file:

```bash
cp .env.example .env
```

2. Copy and edit config:

```bash
cp config.yaml.example config.yaml
```

## Build Inputs

- Use a signed release APK (debug APKs are rejected).
- Keep media files under `publishing/media` and APK under `publishing/files`.
- Solana docs require at least 4 screenshots/videos and a 1200x600 banner.

## CLI Flow

1. Run local preflight checks first:

```bash
npm run validate:local
```

2. Validate with the Solana CLI:

```bash
npm run validate
```

3. Create App NFT (one-time):

```bash
npm run create:app
```

4. Create Release NFT (every release):

```bash
npm run create:release
```

5. Submit initial app:

```bash
npm run publish:submit
```

6. Submit update:

```bash
npm run publish:update
```

## Notes

- Publishing scripts run the Solana CLI via `npx @solana-mobile/dapp-store-cli`.
- `validate:local` catches broken assets, missing metadata, and unsigned APKs before invoking the CLI.
- Set `DAPP_STORE_CLI_VERSION` (for example `0.15.0`) to pin a specific CLI release.
- `publish:submit` and `publish:update` enforce policy attestation flags.
- Keep publisher keypairs and signing keys outside source control.
