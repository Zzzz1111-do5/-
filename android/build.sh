#!/usr/bin/env bash
# Build the 蓝星纪元 Android APK without Gradle:
#   aapt2 compile + link -> javac -> d8 -> add classes.dex -> zipalign -> apksigner
#
# Usage:  android/build.sh [page.html] [out.apk]
#   page.html  defaults to dist/blue-planet-offline.html, falling back to index.html
#   out.apk    defaults to dist/blue-planet.apk
# Env:
#   ANDROID_HOME (or ANDROID_SDK_ROOT)  SDK root, default /root/android-sdk
#   BUILD_TOOLS_VERSION                 default 34.0.0
#   PLATFORM                            default android-34
#   BP_DEBUG=1                          mark the APK debuggable (enables chrome://inspect)
#   D8                                  d8 executable, default build-tools d8
#   BP_KEYSTORE / BP_KEY_ALIAS / BP_STORE_PASS / BP_KEY_PASS   use another signing key
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/root/android-sdk}}"
BT_VER="${BUILD_TOOLS_VERSION:-34.0.0}"
PLATFORM="${PLATFORM:-android-34}"
BT="$SDK/build-tools/$BT_VER"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"

KEYSTORE="${BP_KEYSTORE:-$HERE/keystore/blue-planet.jks}"
KEY_ALIAS="${BP_KEY_ALIAS:-blueplanet}"
STORE_PASS="${BP_STORE_PASS:-blueplanet2026}"
KEY_PASS="${BP_KEY_PASS:-$STORE_PASS}"

# ---- inputs ---------------------------------------------------------------
if [[ $# -ge 1 && -n "$1" ]]; then
  PAGE="$1"
elif [[ -f "$REPO/dist/blue-planet-offline.html" ]]; then
  PAGE="$REPO/dist/blue-planet-offline.html"
else
  PAGE="$REPO/index.html"
  echo "note: dist/blue-planet-offline.html not found, packaging $PAGE instead" >&2
fi
OUT="${2:-$REPO/dist/blue-planet.apk}"

die() { echo "error: $*" >&2; exit 1; }
[[ -f "$PAGE" ]] || die "page not found: $PAGE"
[[ -x "$BT/aapt2" ]] || die "build-tools $BT_VER not found under $SDK (install: sdkmanager \"build-tools;$BT_VER\")"
[[ -f "$ANDROID_JAR" ]] || die "platform $PLATFORM not found under $SDK (install: sdkmanager \"platforms;$PLATFORM\")"
command -v javac >/dev/null || die "javac not on PATH (need JDK 11+)"
command -v keytool >/dev/null || die "keytool not on PATH"
command -v zip >/dev/null || die "zip not on PATH"

case "$PAGE" in /*) ;; *) PAGE="$(pwd)/$PAGE" ;; esac
case "$OUT" in /*) ;; *) OUT="$(pwd)/$OUT" ;; esac

# ---- signing key: created once, then always reused --------------------------
if [[ ! -f "$KEYSTORE" ]]; then
  [[ -z "${BP_KEYSTORE:-}" ]] || die "keystore $KEYSTORE does not exist"
  echo "warning: no keystore at $KEYSTORE - generating a NEW one." >&2
  echo "         APKs signed with it cannot update installs signed with the old key." >&2
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -noprompt -keystore "$KEYSTORE" -storetype PKCS12 \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10958 \
    -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
    -dname "CN=Blue Planet Era, OU=Hobby, O=Blue Planet Era, C=CN"
fi

# ---- clean intermediates ------------------------------------------------------
B="$HERE/build"
rm -rf "$B"
mkdir -p "$B/compiled" "$B/gen" "$B/classes" "$B/dex" "$B/assets" "$(dirname "$OUT")"

cp "$PAGE" "$B/assets/index.html"
echo "page:   $PAGE ($(wc -c < "$B/assets/index.html") bytes)"

# ---- resources + manifest -----------------------------------------------------
"$BT/aapt2" compile --dir "$HERE/res" -o "$B/compiled/res.zip"

LINK_DEBUG=()
if [[ "${BP_DEBUG:-0}" == "1" ]]; then LINK_DEBUG=(--debug-mode); fi
"$BT/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" \
  --java "$B/gen" \
  -A "$B/assets" \
  ${LINK_DEBUG[@]+"${LINK_DEBUG[@]}"} \
  -o "$B/base.apk" \
  "$B/compiled/res.zip"

# ---- java -> dex ----------------------------------------------------------------
find "$HERE/src" "$B/gen" -name '*.java' | sort > "$B/sources.txt"
javac -J-Duser.language=en -encoding UTF-8 -source 8 -target 8 -Xlint:-options -nowarn \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
  -d "$B/classes" @"$B/sources.txt"

find "$B/classes" -name '*.class' | sort > "$B/classes.txt"
D8_MODE=--release
if [[ "${BP_DEBUG:-0}" == "1" ]]; then D8_MODE=--debug; fi
D8="${D8:-$BT/d8}"
if ! "$D8" "$D8_MODE" --min-api 21 --lib "$ANDROID_JAR" --output "$B/dex" @"$B/classes.txt"; then
  echo "hint: d8 from build-tools 34 crashes on javac 21 class files that contain anonymous/inner" >&2
  echo "      classes or generic bridge methods; keep MainActivity free of them, or run with" >&2
  echo "      D8=$SDK/cmdline-tools/latest/bin/d8 (a newer d8)." >&2
  exit 1
fi

# ---- package, align, sign -----------------------------------------------------
cp "$B/base.apk" "$B/unsigned.apk"
TZ=UTC touch -t 198001010000 "$B/dex/classes.dex"   # fixed timestamp, like the aapt2 entries
(cd "$B/dex" && TZ=UTC zip -q -X -9 "$B/unsigned.apk" classes.dex)
"$BT/zipalign" -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"

"$BT/apksigner" sign \
  --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$STORE_PASS" --key-pass "pass:$KEY_PASS" \
  --min-sdk-version 21 \
  --out "$OUT" "$B/aligned.apk"
rm -f "$OUT.idsig"

"$BT/apksigner" verify "$OUT"
echo "apk:    $OUT ($(wc -c < "$OUT") bytes)"
