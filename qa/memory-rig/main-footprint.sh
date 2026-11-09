#!/bin/zsh
# Main-process footprint of one main.cjs (a bundle from bundle-main.mjs, or the source file) with NO inspector or debugging port attached, on a throwaway profile
# under /tmp/acira-qa. The rig's own inspector and seeding add noise to the main process, so bundle comparisons use this: footprint at 75 s and 90 s.
# usage: qa/memory-rig/main-footprint.sh <label> <main.cjs to run>      (it copies that file over desktop/main.cjs: restore with git checkout -- desktop/main.cjs)
# Footprint swings by about +-10 MB between launches (macOS compresses cold pages), so alternate two builds three times and compare the medians.
L=$1; B=$2; R=${0:A:h}/../..
ROOT=/tmp/acira-qa/main-footprint/$L; cp $B $R/desktop/main.cjs; rm -rf $ROOT; mkdir -p $ROOT/home $ROOT/dl $ROOT/fixture-roaming $ROOT/fixture-local
cd $R
env NODE_OPTIONS="--require /tmp/acira-qa/mock-keychain-hook.cjs" ACIRA_BROWSER_TEST_DATA=$ROOT ACIRA_QA_RUN=1 ACIRA_BROWSER_TEST_DOWNLOAD_DIR=$ROOT/dl APPDATA=$ROOT/fixture-roaming LOCALAPPDATA=$ROOT/fixture-local HOME=$ROOT/home \
  $R/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --use-mock-keychain --mute-audio $R/desktop/main.cjs > $ROOT/out.log 2>&1 &
P=$!
sleep 75; A=$(/usr/bin/footprint -p $P 2>/dev/null | grep -o 'phys_footprint: [0-9.]* MB' | grep -o '[0-9.]*' | head -1)
sleep 15; C=$(/usr/bin/footprint -p $P 2>/dev/null | grep -o 'phys_footprint: [0-9.]* MB' | grep -o '[0-9.]*' | head -1)
echo "$L main footprint MB: T75=$A T90=$C"
kill -TERM $P 2>/dev/null; for i in {1..20}; do kill -0 $P 2>/dev/null || break; sleep 1; done; kill -0 $P 2>/dev/null && kill -KILL $P
rm -rf $ROOT
