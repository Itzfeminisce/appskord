#!/usr/bin/env bash
# Installs a pinned penv. The installer is checked by hash; it then checks the binary's signed checksum.
set -euo pipefail
version=v1.0.0
installer_sha256=87b9224dac53e3bdfc723f731931ab50d91ef5f12227e335e777cd5bebd9880f
dir="$RUNNER_TEMP/penv"
mkdir -p "$dir"
curl -fsSL "https://raw.githubusercontent.com/penvhq/penvhq/$version/install.sh" -o "$dir/install.sh"
echo "$installer_sha256  $dir/install.sh" | sha256sum -c --quiet
PENV_VERSION="$version" PENV_RELEASE_BASE=https://github.com/penvhq/penvhq PENV_INSTALL_DIR="$dir/bin" sh "$dir/install.sh"
echo "$dir/bin" >> "$GITHUB_PATH"
