#!/bin/sh
# Real-Firefox test (see real_install.py). Needs ~/.local/firefox-real (Firefox + geckodriver) and the browser venv.
cd "$(dirname "$0")/.." || exit 1
for f in src/*.js; do $HOME/.local/node/bin/node --check "$f" || exit 1; done
export LD_LIBRARY_PATH=$HOME/.local/fxlibs/usr/lib/aarch64-linux-gnu:$HOME/.local/chromelibs/usr/lib/aarch64-linux-gnu
exec $HOME/.local/venv-browser/bin/python -I -u tests/real_install.py
