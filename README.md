# H5P Desk

H5P Desk is a lightweight desktop player for `.h5p` learning packages. It uses [Tauri](https://tauri.app/) instead of Electron and processes packages locally.

## Features

- Open `.h5p` files with a file picker or drag and drop.
- Read ZIP entries directly in memory without extracting the package to disk.
- Play H5P content with `h5p-standalone`.
- Keep the package and its media on the local machine.
- Linux desktop integration through the included `.desktop` file.

## Running the application

Use the release executable:

```bash
./src-tauri/target/release/h5p-desk
```

You can also open a package directly by passing its path:

```bash
./src-tauri/target/release/h5p-desk /path/to/activity.h5p
```

The file is read through Tauri's local asset protocol and is not uploaded.

## Development

Requirements:

- Node.js 20 or newer
- Rust and Cargo
- Linux WebKitGTK development libraries required by Tauri

Install dependencies and start the development application:

```bash
npm install
npm run tauri:dev
```

Build the frontend only:

```bash
npm run build
```

Build the release executable and Linux packages:

```bash
npm run tauri:build
```

Artifacts are written to `src-tauri/target/release/` and `src-tauri/target/release/bundle/`. The release workflow publishes Debian and RPM packages.

## Release process

Push a version tag to build and publish release artifacts with GitHub Actions:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow in `.github/workflows/release.yml` builds the application and attaches the Debian and RPM packages to the GitHub Release.

## How package loading works

An H5P file is a ZIP archive. H5P Desk reads the selected file with JSZip, creates temporary in-memory blob URLs for archive entries, and maps H5P's generated resource URLs to those blobs. No extracted working directory is created and the archive is not uploaded.

## License

H5P Desk does not currently declare a project license. The bundled H5P player remains subject to its own license.
