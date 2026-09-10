pkgname=h5p-desk
pkgver=0.1.0
pkgrel=1
pkgdesc='Offline desktop player for H5P packages'
arch=('x86_64')
url='https://github.com/tomhense/h5p-gui'
license=('custom')
depends=('webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator')
makedepends=('git' 'nodejs' 'npm' 'rust')
source=("git+$url.git")
sha256sums=('SKIP')

pkgver() {
  cd "$srcdir/h5p-gui"
  local version
  version=$(git describe --long --tags --match 'v*' 2>/dev/null || true)
  if [[ -n "$version" ]]; then
    printf '%s\n' "$version" | sed -E 's/^v//; s/([^-]+)-([0-9]+)-g.*/\1.r\2/'
  else
    printf '0.1.0.r%s\n' "$(git rev-list --count HEAD)"
  fi
}

build() {
  cd "$srcdir/h5p-gui"

  npm ci
  npm run build
  cargo build --release --locked --manifest-path src-tauri/Cargo.toml
}

package() {
  cd "$srcdir/h5p-gui"

  install -Dm755 src-tauri/target/release/h5p-desk "$pkgdir/usr/bin/h5p-desk"
  install -Dm644 h5p-desk.desktop "$pkgdir/usr/share/applications/h5p-desk.desktop"
  install -Dm644 src-tauri/icons/icon.png "$pkgdir/usr/share/icons/hicolor/512x512/apps/h5p-desk.png"
}
