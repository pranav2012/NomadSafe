#!/usr/bin/env bash
# Renders the PNG brand assets from assets/brand/*.svg. Needs rsvg-convert (brew install librsvg).
# feature-graphic.svg isn't rendered here: rsvg on macOS can't load Instrument Sans from node_modules,
# so export it from a browser (or with the font installed) to assets/store/feature-graphic-1024x500.png.
set -euo pipefail
cd "$(dirname "$0")/.."

render() { rsvg-convert -w "$2" -h "$3" "assets/brand/$1" -o "$4"; }

render logo.svg 1024 1024 assets/images/icon.png
render logo.svg 48 48 assets/images/favicon.png
render logo.svg 512 512 assets/store/play-icon-512.png
render background.svg 512 512 assets/images/android-icon-background.png
render foreground.svg 512 512 assets/images/android-icon-foreground.png
render monochrome.svg 432 432 assets/images/android-icon-monochrome.png
render notification.svg 96 96 assets/images/notification-icon.png
render splash.svg 1024 1024 assets/images/splash-icon.png

echo "Brand assets rendered."
