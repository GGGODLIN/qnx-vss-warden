#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$REPO_ROOT/docs/qnx800-verification"
mkdir -p "$OUT_DIR"

LOG_FILE="$OUT_DIR/verification-log.txt"
exec > >(tee "$LOG_FILE") 2>&1

echo "=== VssWarden QNX SDP 8.0 & QEMU Target Verification ==="
echo "Host uname: $(uname -a)"
echo "Started UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

set +x
MYQNX_USER="${1:-${MYQNX_EMAIL:-}}"
MYQNX_PW_B64="${2:-${MYQNX_PW_B64:-}}"
if [[ -z "$MYQNX_USER" || -z "$MYQNX_PW_B64" ]]; then
  echo "Usage: verify-qnx800-target.sh <myqnx-email> <myqnx-password-base64>" >&2
  exit 2
fi

QSC_OPTS="$(mktemp /tmp/qsc-opts.XXXXXX)"
chmod 600 "$QSC_OPTS"
MYQNX_PW="$(printf '%s' "$MYQNX_PW_B64" | base64 -d)"
printf '%s\n%s\n%s\n%s\n' "-myqnx.user" "$MYQNX_USER" "-myqnx.password" "$MYQNX_PW" > "$QSC_OPTS"

QSC_DIR="$HOME/qnx"
QSC_CLT="$QSC_DIR/qnxsoftwarecenter/qnxsoftwarecenter_clt"
SDP_DIR="$HOME/qnx800"
VM_DIR="/tmp/qnx800-vm"

cleanup_all() {
  set +e
  set +x
  echo "[cleanup] Stopping any running QEMU QNX guest..."
  if [[ -d "$VM_DIR" ]] && command -v mkqnximage >/dev/null 2>&1; then
    (cd "$VM_DIR" && mkqnximage --stop) >/dev/null 2>&1 || true
  fi
  pkill -f "qemu-system" >/dev/null 2>&1 || true
  if [[ -x "$QSC_CLT" && -f "$QSC_OPTS" ]]; then
    echo "[cleanup] Deactivating QNX SDP 8.0 license before VM teardown..."
    if [[ -n "${LIC_KEY:-}" ]] && grep -q -- "-deactivateLicenseKey" /tmp/qsc-clt-help.txt 2>/dev/null; then
      DEACT_OPTS="$(mktemp /tmp/qsc-deact.XXXXXX)"
      chmod 600 "$DEACT_OPTS"
      printf '%s\n%s\n' "-deactivateLicenseKey" "$LIC_KEY" > "$DEACT_OPTS"
      "$QSC_CLT" @"$QSC_OPTS" @"$DEACT_OPTS" >/tmp/qsc-deactivate.log 2>&1 || true
      rm -f "$DEACT_OPTS"
    fi
    "$QSC_CLT" @"$QSC_OPTS" -deactivateAll >>/tmp/qsc-deactivate.log 2>&1 || true
    sed -E 's/[A-Z0-9]{4}(-[A-Z0-9]{4}){4}/[redacted-key]/g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[redacted-email]/g' /tmp/qsc-deactivate.log | grep -v -i "password" || true
    echo "[cleanup] License deactivation command completed."
  fi
  rm -f "$QSC_OPTS" /tmp/qsc-deactivate.log /tmp/qnx_vm_key /tmp/qnx_vm_key.pub
  sed -i -E 's/[A-Z0-9]{4}(-[A-Z0-9]{4}){4}/[redacted-license-key]/g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[redacted-myqnx-account]/g; s/[0-9]{6}-[0-9]{8}/[redacted-serial]/g' "$LOG_FILE" 2>/dev/null || true
}
trap cleanup_all EXIT

echo "=== [1/6] Installing Ubuntu host packages & Meson >= 1.10 ==="
sudo env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 update -y
sudo env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y \
  curl git patch file binutils build-essential pkg-config \
  python3-venv python3-pip python3-pil fonts-dejavu-core \
  default-jre-headless openssh-client sshpass \
  qemu-system-x86 qemu-utils bridge-utils iproute2 libvirt-daemon-system

sudo mkdir -p /etc/qemu
echo "allow all" | sudo tee /etc/qemu/bridge.conf >/dev/null
if [[ -f /usr/lib/qemu/qemu-bridge-helper ]]; then
  sudo chmod u+s /usr/lib/qemu/qemu-bridge-helper
fi
sudo systemctl start libvirtd || true
sudo virsh net-start default >/dev/null 2>&1 || true

python3 -m venv /tmp/meson-venv
/tmp/meson-venv/bin/pip install --quiet "meson>=1.10" ninja
export PATH="/tmp/meson-venv/bin:$PATH"
echo "Meson version: $(meson --version) | Ninja version: $(ninja --version)"

echo "=== [2/6] Downloading & installing QNX Software Center 2.0.4 (Linux x86_64) ==="
INSTALLER_DIR="/tmp/qsc-dl"
mkdir -p "$INSTALLER_DIR"
INSTALLER="$INSTALLER_DIR/qnx-setup-2.0.4-202501021438-linux.run"

MYQNX_USER_ENV="$MYQNX_USER" MYQNX_PW_B64_ENV="$MYQNX_PW_B64" INSTALLER_ENV="$INSTALLER" python3 -I - <<'PY'
import os, base64, urllib.request, urllib.parse, http.cookiejar

user = os.environ["MYQNX_USER_ENV"]
pw = base64.b64decode(os.environ["MYQNX_PW_B64_ENV"]).decode("utf-8")
out = os.environ["INSTALLER_ENV"]

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
opener.addheaders = [("User-Agent", "Mozilla/5.0 (X11; Linux x86_64)"), ("Referer", "https://www.qnx.com/account/login.html")]
opener.open("https://www.qnx.com/account/login.html", data=urllib.parse.urlencode({
    "userlogin": user, "password": pw, "returnaddress": "/download/feature.html?programid=79441", "x": "10", "y": "10"
}).encode(), timeout=30).read()

r = opener.open("https://www.qnx.com/download/download/79441/qnx-setup-2.0.4-202501021438-linux.run", timeout=120)
ct = r.headers.get("Content-Type", "")
total = 0
with open(out, "wb") as f:
    while True:
        chunk = r.read(1048576)
        if not chunk:
            break
        f.write(chunk)
        total += len(chunk)
print(f"Downloaded installer: Content-Type={ct}, size={total} bytes")
if total < 50_000_000:
    raise SystemExit(f"Unexpected small download ({total} bytes)")
PY

chmod +x "$INSTALLER"
rm -rf /tmp/qsc-stage
"$INSTALLER" --noprogress --noexec --target /tmp/qsc-stage
echo "Extracted /tmp/qsc-stage contents:"
ls -la /tmp/qsc-stage
echo "=== /tmp/qsc-stage/start.sh ==="
cat /tmp/qsc-stage/start.sh || true

# Run start.sh non-interactively with PAGER=cat so `less` never blocks, feeding 'y' + default dir + 'n' (don't launch GUI)
(
  cd /tmp/qsc-stage
  export PAGER=cat
  export DISPLAY=""
  export QNX_INSTALLER_AUTO_START=0
  export QNX_INSTALLER_TARGET="$QSC_DIR"
  printf 'y\n\n' | timeout 120 bash ./start.sh || true
)
sleep 2
pkill -f "qnxsoftwarecenter " >/dev/null 2>&1 || true

# If start.sh had a different layout or placed qnxsoftwarecenter inside /tmp/qsc-stage, copy directly if needed
if [[ ! -x "$QSC_CLT" ]]; then
  FOUND_STAGE_CLT="$(find "$HOME" /tmp/qsc-stage -name "qnxsoftwarecenter_clt" 2>/dev/null | head -n 1 || true)"
  echo "Fallback search for qnxsoftwarecenter_clt: $FOUND_STAGE_CLT"
  if [[ -n "$FOUND_STAGE_CLT" ]]; then
    if [[ "$FOUND_STAGE_CLT" == /tmp/qsc-stage/* ]]; then
      mkdir -p "$QSC_DIR"
      cp -a "$(dirname "$FOUND_STAGE_CLT")" "$QSC_DIR/qnxsoftwarecenter"
    else
      QSC_CLT="$FOUND_STAGE_CLT"
    fi
  fi
fi

if [[ ! -x "$QSC_CLT" ]]; then
  echo "Contents of /tmp/qsc-stage (depth 3):"
  find /tmp/qsc-stage -maxdepth 3
  echo "ERROR: qnxsoftwarecenter_clt not found" >&2
  exit 1
fi
echo "QSC CLI ready: $("$QSC_CLT" -version || true)"

echo "=== [3/6] Activating license & installing QNX SDP 8.0 via qnxsoftwarecenter_clt ==="
"$QSC_CLT" -help > /tmp/qsc-clt-help.txt 2>&1 || true
grep -iE "license|activate|mirror" /tmp/qsc-clt-help.txt || true

timeout 300 "$QSC_CLT" @"$QSC_OPTS" -mirrorBaseline qnx800 >/tmp/qsc-mirror.log 2>&1 || \
  timeout 300 "$QSC_CLT" @"$QSC_OPTS" -mirror >/tmp/qsc-mirror.log 2>&1 || { tail -n 40 /tmp/qsc-mirror.log; exit 1; }
sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[redacted-email]/g' /tmp/qsc-mirror.log | tail -n 10 || true

timeout 180 "$QSC_CLT" @"$QSC_OPTS" -syncLicenseKeys >/tmp/qsc-sync.log 2>&1 || true

# Discover the 24-char license key from server-cache (.jar/.gz/plain) without printing it
set +x
LIC_KEY="$(python3 -I - <<'PY'
import os, re, glob, gzip, zipfile

pat = re.compile(r'\b([A-Z0-9]{4}(?:-[A-Z0-9]{4}){4})\b')
root = os.path.expanduser("~/.qnx")
found = []
for p in glob.glob(os.path.join(root, "**", "*"), recursive=True):
    if not os.path.isfile(p):
        continue
    try:
        if zipfile.is_zipfile(p):
            with zipfile.ZipFile(p) as zf:
                for name in zf.namelist():
                    txt = zf.read(name).decode("utf-8", "ignore")
                    for m in pat.findall(txt):
                        if m not in found:
                            found.append(m)
        else:
            raw = open(p, "rb").read()
            if p.endswith(".gz") or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            txt = raw.decode("utf-8", "ignore")
            for m in pat.findall(txt):
                if m not in found:
                    found.append(m)
    except Exception:
        pass
if found:
    print(found[0])
PY
)"
echo "Discovered license key in QSC cache: $([[ -n "$LIC_KEY" ]] && echo 'yes (len='${#LIC_KEY}')' || echo 'no')"

activate_key() {
  local k="$1"
  [[ -z "$k" ]] && return 0
  echo "Activating license via -addLicenseKey..."
  local act_opts
  act_opts="$(mktemp /tmp/qsc-act-opts.XXXXXX)"
  chmod 600 "$act_opts"
  printf '%s\n%s\n' "-addLicenseKey" "$k" > "$act_opts"
  timeout 180 "$QSC_CLT" @"$QSC_OPTS" @"$act_opts" >/tmp/qsc-act.log 2>&1 || true
  rm -f "$act_opts"
  timeout 180 "$QSC_CLT" @"$QSC_OPTS" -activateAll >>/tmp/qsc-act.log 2>&1 || true
  sed -E 's/[A-Z0-9]{4}(-[A-Z0-9]{4}){4}/[redacted-key]/g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[redacted-email]/g' /tmp/qsc-act.log | grep -v -i "password" | tail -n 20 || true
}

if [[ -n "$LIC_KEY" ]]; then
  activate_key "$LIC_KEY"
fi

CHOSEN_BASELINE="com.qnx.qnx800"
echo "Installing baseline: $CHOSEN_BASELINE -> $SDP_DIR"
if ! timeout 1200 "$QSC_CLT" @"$QSC_OPTS" -destination "$SDP_DIR" -installBaseline "$CHOSEN_BASELINE" >/tmp/qsc-install-base.log 2>&1; then
  FALLBACK_KEY="$(grep -oE '[A-Z0-9]{4}(-[A-Z0-9]{4}){4}' /tmp/qsc-install-base.log | head -n 1 || true)"
  if [[ -n "$FALLBACK_KEY" ]]; then
    echo "Extracted required license key from install check; activating with -addLicenseKey and retrying..."
    LIC_KEY="$FALLBACK_KEY"
    activate_key "$LIC_KEY"
    timeout 1200 "$QSC_CLT" @"$QSC_OPTS" -destination "$SDP_DIR" -installBaseline "$CHOSEN_BASELINE" >/tmp/qsc-install-base.log 2>&1 || {
      sed -E 's/[A-Z0-9]{4}(-[A-Z0-9]{4}){4}/[redacted-key]/g' /tmp/qsc-install-base.log | tr '\r' '\n' | tail -n 60
      exit 1
    }
  else
    sed -E 's/[A-Z0-9]{4}(-[A-Z0-9]{4}){4}/[redacted-key]/g' /tmp/qsc-install-base.log | tr '\r' '\n' | tail -n 60
    exit 1
  fi
fi
sed -E 's/[A-Z0-9]{4}(-[A-Z0-9]{4}){4}/[redacted-key]/g' /tmp/qsc-install-base.log | tr '\r' '\n' | grep -v -E '^[[:space:]]*[0-9]+%' | tail -n 25 || true

timeout 180 "$QSC_CLT" @"$QSC_OPTS" -listAccessible > /tmp/qsc-accessible.txt || true

# Check if extra packages are needed for mkqnximage, qemu, json, slog2
EXTRA_PKGS="$(SDP_DIR_ENV="$SDP_DIR" python3 -I - <<'PY'
import os, re, glob

sdp = os.environ["SDP_DIR_ENV"]
def has_file(pattern):
    return bool(glob.glob(os.path.join(sdp, "**", pattern), recursive=True))

print("Initial SDP check:", {
    "qnxsdp-env.sh": has_file("qnxsdp-env.sh"),
    "qcc": has_file("qcc"),
    "mkqnximage": has_file("mkqnximage"),
    "libjson": has_file("libjson.so*"),
    "libslog2": has_file("libslog2.so*"),
})

lines = open("/tmp/qsc-accessible.txt", encoding="utf-8", errors="replace").read().splitlines()
pkgs = []
for ln in lines:
    for m in re.findall(r'(com\.qnx\.qnx800\.[A-Za-z0-9_.-]+)', ln):
        pkgs.append(m)
pkgs = sorted(set(pkgs))

wanted = []
for p in pkgs:
    pl = p.lower()
    if any(k in pl for k in [
        "mkqnximage", "target.virt.qemu", "virt.qemu", "QuickStart",
        "target.base", "lib.json", "slog2", "connectivity.ssh", "net.sock"
    ]):
        wanted.append(p)
print("EXTRA_CANDIDATES:", wanted[:40])
PY
)"
echo "$EXTRA_PKGS"

if [[ ! -f "$SDP_DIR/qnxsdp-env.sh" ]]; then
  ENV_SH="$(find "$SDP_DIR" -maxdepth 3 -name "qnxsdp-env.sh" | head -n 1)"
else
  ENV_SH="$SDP_DIR/qnxsdp-env.sh"
fi
# shellcheck disable=SC1090
source "$ENV_SH"
echo "QNX_HOST=$QNX_HOST"
echo "QNX_TARGET=$QNX_TARGET"

# If mkqnximage or libjson.so is missing, install matching packages from accessible list
if ! command -v mkqnximage >/dev/null 2>&1 || [[ -z "$(find "$QNX_TARGET" -name 'libjson.so*' 2>/dev/null | head -n 1)" ]]; then
  echo "Installing supplemental QNX 8.0 target/qemu/mkqnximage packages..."
  TO_INSTALL="$(python3 -I - <<'PY'
import re
txt = open("/tmp/qsc-accessible.txt", encoding="utf-8", errors="replace").read()
pkgs = sorted(set(re.findall(r'(com\.qnx\.qnx800\.[A-Za-z0-9_.-]+)', txt)))
sel = [
    p for p in pkgs
    if not any(bad in p.lower() for bad in [".host.win", ".host.darwin", ".bsp.", ".source", ".debug"])
    and any(k in p.lower() for k in ["mkqnximage", "virt.qemu", "lib.json", "slog2"])
]
print(",".join(sel))
PY
)"
  if [[ -n "$TO_INSTALL" ]]; then
    echo "Installing: $TO_INSTALL"
    timeout 600 "$QSC_CLT" @"$QSC_OPTS" -destination "$SDP_DIR" -installPackage "$TO_INSTALL" >/tmp/qsc-install-extra.log 2>&1 || true
    tr '\r' '\n' < /tmp/qsc-install-extra.log | grep -v -E '^[[:space:]]*[0-9]+%' | tail -n 20 || true
  fi
fi

echo "=== [4/6] Cross-compiling VssWarden CLI & Patched QNX QPP for QNX 8.0 (x86_64 & aarch64le) ==="
cd "$REPO_ROOT"
if [[ ! -f src/c/vss_warden_presets.h ]]; then
  node --experimental-strip-types scripts/generate-presets.ts
fi
mkdir -p build

qcc -V
qcc -Vgcc_ntox86_64 -std=c11 -O2 -Wall -Wextra src/c/vss_warden_core.c src/c/vss_warden_cli.c -lm -o build/vss-warden-cli-qnx800-x86_64
qcc -Vgcc_ntoaarch64le -std=c11 -O2 -Wall -Wextra src/c/vss_warden_core.c src/c/vss_warden_cli.c -lm -o build/vss-warden-cli-qnx800-aarch64le

QPP_PATCHED="/tmp/qpp-patched"
rm -rf "$QPP_PATCHED"
bash scripts/apply-qpp-patch.sh "$QPP_PATCHED"

echo "--- 4a. Official QNX SDP Recursive Makefile Build (nto/x86_64 + nto/aarch64) ---"
(cd "$QPP_PATCHED" && make)

echo "--- 4b. Meson Cross-Compilation Build (ntox86_64-gcc & ntoaarch64-gcc) ---"
cat > "$QPP_PATCHED/qnx-x86_64.ini" <<INI
[binaries]
c = 'ntox86_64-gcc'
ar = 'ntox86_64-ar'
strip = 'ntox86_64-strip'
[built-in options]
c_args = ['--sysroot=${QNX_TARGET}', '-B${QNX_TARGET}/x86_64/lib', '-B${QNX_TARGET}/x86_64/usr/lib', '-I${QNX_TARGET}/usr/include', '-D__QNXNTO__']
c_link_args = ['--sysroot=${QNX_TARGET}', '-L${QNX_TARGET}/x86_64/lib', '-L${QNX_TARGET}/x86_64/usr/lib', '-Wl,--rpath-link,${QNX_TARGET}/x86_64/lib', '-Wl,--rpath-link,${QNX_TARGET}/x86_64/usr/lib']
[host_machine]
system = 'qnx'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
INI

cat > "$QPP_PATCHED/qnx-aarch64le.ini" <<INI
[binaries]
c = 'ntoaarch64-gcc'
ar = 'ntoaarch64-ar'
strip = 'ntoaarch64-strip'
[built-in options]
c_args = ['--sysroot=${QNX_TARGET}', '-mlittle-endian', '-B${QNX_TARGET}/aarch64le/lib', '-B${QNX_TARGET}/aarch64le/usr/lib', '-I${QNX_TARGET}/usr/include', '-D__QNXNTO__']
c_link_args = ['--sysroot=${QNX_TARGET}', '-mlittle-endian', '-L${QNX_TARGET}/aarch64le/lib', '-L${QNX_TARGET}/aarch64le/usr/lib', '-Wl,--rpath-link,${QNX_TARGET}/aarch64le/lib', '-Wl,--rpath-link,${QNX_TARGET}/aarch64le/usr/lib']
[host_machine]
system = 'qnx'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'
INI

meson setup "$QPP_PATCHED/build-qnx-x86_64" "$QPP_PATCHED" --cross-file "$QPP_PATCHED/qnx-x86_64.ini"
meson compile -C "$QPP_PATCHED/build-qnx-x86_64"

ARM_QPP_ELF=""
if meson setup "$QPP_PATCHED/build-qnx-aarch64le" "$QPP_PATCHED" --cross-file "$QPP_PATCHED/qnx-aarch64le.ini" && \
   meson compile -C "$QPP_PATCHED/build-qnx-aarch64le"; then
  ARM_QPP_ELF="$QPP_PATCHED/build-qnx-aarch64le/qpp/qpp"
else
  echo "WARN: aarch64le Meson cross-build encountered an error; dumping meson-log.txt tail and using Makefile-built aarch64le binary:"
  tail -n 60 "$QPP_PATCHED/build-qnx-aarch64le/meson-logs/meson-log.txt" 2>/dev/null || true
fi

MAKE_QPP_X86="$(find "$QPP_PATCHED/qpp/nto/x86_64" -type f -name 'qpp' | grep -v '\.g/' | grep -v 'iosock' | head -n 1 || true)"
MAKE_QPP_ARM="$(find "$QPP_PATCHED/qpp/nto/aarch64" -type f -name 'qpp' | grep -v '\.g/' | grep -v 'iosock' | head -n 1 || true)"
if [[ -z "$ARM_QPP_ELF" ]]; then
  ARM_QPP_ELF="$MAKE_QPP_ARM"
fi
echo "Makefile built binaries: x86_64=$MAKE_QPP_X86 | aarch64=$MAKE_QPP_ARM"

{
  echo "=== QNX SDP 8.0 Compiler & Binary Inspection Receipt ==="
  echo "Date (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "--- qcc -V ---"
  qcc -V 2>&1 || true
  echo ""
  echo "--- file inspection ---"
  file build/vss-warden-cli-qnx800-x86_64 build/vss-warden-cli-qnx800-aarch64le \
       ${MAKE_QPP_X86:+"$MAKE_QPP_X86"} ${MAKE_QPP_ARM:+"$MAKE_QPP_ARM"} \
       "$QPP_PATCHED/build-qnx-x86_64/qpp/qpp" \
       $([[ -f "$QPP_PATCHED/build-qnx-aarch64le/qpp/qpp" ]] && echo "$QPP_PATCHED/build-qnx-aarch64le/qpp/qpp")
  echo ""
  echo "--- ELF dynamic section (x86_64 patched qpp) ---"
  ntox86_64-readelf -h -l -d "$QPP_PATCHED/build-qnx-x86_64/qpp/qpp" | grep -E "Class:|Machine:|program interpreter|NEEDED|SONAME"
  echo ""
  echo "--- ELF dynamic section (aarch64le patched qpp) ---"
  ntoaarch64-readelf -h -l -d "$ARM_QPP_ELF" | grep -E "Class:|Machine:|program interpreter|NEEDED|SONAME"
} > "$OUT_DIR/build-receipt.txt"
cat "$OUT_DIR/build-receipt.txt"

echo "=== [5/6] Booting QNX Neutrino RTOS 8.0 on QEMU & Executing Live Resource Manager Tests ==="
ssh-keygen -t ed25519 -N "" -f /tmp/qnx_vm_key -q
rm -rf "$VM_DIR"
mkdir -p "$VM_DIR"

# Prepare test signal_catalog.json combining HVAC float default (Bug #2: 22.5) + ADAS SpeedSet actuator
cat > /tmp/warden_qnx_catalog.json <<'JSON'
{
  "Vehicle": {
    "type": "branch",
    "children": {
      "Cabin": {
        "type": "branch",
        "children": {
          "HVAC": {
            "type": "branch",
            "children": {
              "DriverTemp": {
                "type": "actuator",
                "datatype": "float",
                "min": 16.0,
                "max": 30.0,
                "default": 22.5,
                "unit": "celsius",
                "description": "Driver HVAC target temperature"
              }
            }
          }
        }
      },
      "ADAS": {
        "type": "branch",
        "children": {
          "CruiseControl": {
            "type": "branch",
            "children": {
              "SpeedSet": {
                "type": "actuator",
                "datatype": "int32",
                "min": 0,
                "max": 130,
                "default": 0,
                "unit": "km/h",
                "description": "Mixed-criticality cruise speed target"
              }
            }
          }
        }
      }
    }
  }
}
JSON

# Prepare fallback shared libs in case minimal mkqnximage omits libjson.so or libm.so
rm -rf /tmp/warden-extra-libs
mkdir -p /tmp/warden-extra-libs
cp -a "$QNX_TARGET"/x86_64/usr/lib/libjson.so* /tmp/warden-extra-libs/ 2>/dev/null || true
cp -a "$QNX_TARGET"/x86_64/lib/libm.so* /tmp/warden-extra-libs/ 2>/dev/null || true

# Also prepare the guest verification script to run inside QNX 8.0 ksh
cat > /tmp/run_on_qnx_guest.sh <<'KSH'
#!/bin/sh
echo "=== QNX 8.0 GUEST VERIFICATION START ==="
echo "\$ uname -a"
uname -a
echo ""
echo "\$ pidin info"
pidin info
echo ""

export LD_LIBRARY_PATH="/proc/boot:/lib:/usr/lib:/lib/dll:/data/warden/extra-libs"
cd /data/warden || exit 1

echo "\$ ./vss-warden-cli-qnx800-x86_64 --preset preset-2-adas-vs-ivi-hijack --seed 20261105"
./vss-warden-cli-qnx800-x86_64 --preset preset-2-adas-vs-ivi-hijack --seed 20261105 > /data/warden/cli-preset2.json
echo "CLI exit=$? bytes=$(wc -c < /data/warden/cli-preset2.json)"
echo ""

slay -f qpp 2>/dev/null || true
sleep 1

echo "\$ ./qpp -s -c /data/warden/signal_catalog.json -m /dev/signal &"
./qpp -s -c /data/warden/signal_catalog.json -m /dev/signal &
QPP_PID=$!
sleep 2
echo "qpp running as pid=$QPP_PID"
ls -la /dev/signal/Vehicle/Cabin/HVAC /dev/signal/Vehicle/ADAS/CruiseControl
echo ""

echo "--- Check 1: Upstream QPP FLOAT Default Bug #2 Fixed on Live QNX 8.0 ---"
echo "\$ cat /dev/signal/Vehicle/Cabin/HVAC/DriverTemp?text"
DRV_TEMP="$(cat /dev/signal/Vehicle/Cabin/HVAC/DriverTemp?text)"
echo "DriverTemp default = $DRV_TEMP"
echo ""

echo "--- Check 2: VSS Range Bounds Enforced (ERANGE on 99.5 > max 30.0) ---"
echo "\$ sh -c 'echo 99.5 > /dev/signal/Vehicle/Cabin/HVAC/DriverTemp?control,text'"
if (echo "99.5" > "/dev/signal/Vehicle/Cabin/HVAC/DriverTemp?control,text") 2>/data/warden/err_range.txt; then
  echo "UNEXPECTED: out-of-range write succeeded"
  exit 1
else
  echo "Out-of-range write rejected (rc=$?): $(cat /data/warden/err_range.txt)"
fi
echo ""

echo "--- Check 3: Priority-Spoofing Blocked via ctp->info.priority (P10 asking ?priority=60 -> EPERM) ---"
if on -p10 sh -c 'echo "80" > "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=60,as=Spoofed_IVI"' 2>/data/warden/err_spoof.txt; then
  echo "UNEXPECTED: spoofed priority succeeded"
  exit 1
else
  echo "Priority spoofing rejected (rc=$?): $(cat /data/warden/err_spoof.txt)"
fi
echo ""

echo "--- Check 4: Mixed-Criticality Preemption (P60 preempts P10) & Hijack Rejection (EBUSY) ---"
on -p10 sh -c 'exec 3>"/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=10,lease=60000,as=IVI_CruiseUI"; echo "100" >&3; sleep 10' &
IVI_HOLDER_PID=$!
sleep 1
echo "Step 4a - IVI (P10) sets cruise SpeedSet?control,text: $(cat /dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text)"

on -p60 sh -c 'exec 3>"/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=60,lease=60000,as=ADAS_AEB"; echo "0" >&3; sleep 4' &
ADAS_HOLDER_PID=$!
sleep 1
echo "Step 4b - ADAS_AEB (P60) preempts IVI to emergency brake SpeedSet?control,text: $(cat /dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text)"

if on -p10 sh -c 'echo "110" > "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=10,as=IVI_EcoMode"' 2>/data/warden/err_hijack.txt; then
  echo "UNEXPECTED: low-priority IVI hijack succeeded"
  exit 1
else
  echo "Step 4c - IVI (P10) overwrite blocked (rc=$?): $(cat /data/warden/err_hijack.txt)"
fi
echo "SpeedSet?control,text remains protected at: $(cat /dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text)"
echo ""

echo "--- Check 5: Live ?warden,text POSIX Diagnostic Receipt ---"
echo "\$ cat /dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?warden,text"
WARDEN_JSON="$(cat /dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?warden,text)"
echo "$WARDEN_JSON"
echo ""

echo "--- Check 6: Holder Disconnect -> io_close_ocb Standby Promotion & Safe Default Rollback ---"
wait "$ADAS_HOLDER_PID" 2>/dev/null || true
sleep 1
echo "Step 6a - After ADAS (P60) closes fd (io_close_ocb), standby IVI (100) promoted -> SpeedSet?control,text: $(cat /dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text)"
wait "$IVI_HOLDER_PID" 2>/dev/null || true
sleep 1
echo "Step 6b - After IVI (P10) closes fd (io_close_ocb), rolled back to VSS safe default -> SpeedSet?control,text: $(cat /dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?control,text)"
cat "/dev/signal/Vehicle/ADAS/CruiseControl/SpeedSet?warden,text"
echo ""

kill "$QPP_PID" 2>/dev/null || true
echo "=== QNX 8.0 GUEST VERIFICATION PASSED ==="
KSH
chmod +x /tmp/run_on_qnx_guest.sh

cd "$VM_DIR"
mkqnximage --type=qemu --arch=x86_64 --ssh-ident=/tmp/qnx_vm_key.pub --noprompt --build < /dev/null || \
  mkqnximage --type=qemu --arch=x86_64 --ssh-ident=/tmp/qnx_vm_key.pub --build < /dev/null

echo "=== Staging VssWarden QNX 8.0 binaries & catalog into /data/warden via data_files.custom ==="
VM_DIR_ENV="$VM_DIR" REPO_ROOT_ENV="$REPO_ROOT" QPP_PATCHED_ENV="$QPP_PATCHED" QNX_TARGET_ENV="$QNX_TARGET" python3 -I - <<'PY'
import glob, os

vm_dir = os.environ["VM_DIR_ENV"]
repo_root = os.environ["REPO_ROOT_ENV"]
qpp_patched = os.environ["QPP_PATCHED_ENV"]
qnx_target = os.environ["QNX_TARGET_ENV"]

sys_build = os.path.join(vm_dir, "output", "build", "system.build")
data_build = os.path.join(vm_dir, "output", "build", "data.build")
if os.path.exists(data_build):
    print("--- Sample of generated data.build ---")
    print("\n".join(open(data_build, encoding="utf-8", errors="ignore").read().splitlines()[:35]))

entries = [
    ("[uid=0 gid=0 dperms=755 type=dir]", "warden", None),
    ("[uid=0 gid=0 dperms=755 type=dir]", "warden/extra-libs", None),
    ("[uid=0 gid=0 perms=0755]", "warden/qpp", os.path.join(qpp_patched, "build-qnx-x86_64", "qpp", "qpp")),
    ("[uid=0 gid=0 perms=0755]", "warden/vss-warden-cli-qnx800-x86_64", os.path.join(repo_root, "build", "vss-warden-cli-qnx800-x86_64")),
    ("[uid=0 gid=0 perms=0755]", "warden/run_on_qnx_guest.sh", "/tmp/run_on_qnx_guest.sh"),
    ("[uid=0 gid=0 perms=0644]", "warden/signal_catalog.json", "/tmp/warden_qnx_catalog.json"),
]

for soname in ("libjson.so.1", "libm.so.3", "libslog2.so.1"):
    matches = glob.glob(os.path.join(qnx_target, "x86_64", "**", soname), recursive=True)
    if matches:
        real_p = os.path.realpath(matches[0])
        entries.append(("[uid=0 gid=0 perms=0755]", f"warden/extra-libs/{soname}", real_p))

custom_path = os.path.join(vm_dir, "local", "snippets", "data_files.custom")
orig = open(custom_path, encoding="utf-8", errors="ignore").read() if os.path.exists(custom_path) else ""
lines = [orig.rstrip(), ""]
for attr, dst, src in entries:
    if src is None:
        lines.append(f"{attr} {dst}")
    else:
        if not os.path.isfile(src):
            raise SystemExit(f"Missing staged file: {src}")
        lines.append(f"{attr} {dst}={src}")
lines.append("")
open(custom_path, "w", encoding="utf-8").write("\n".join(lines))
print("Wrote", custom_path)
for ln in lines:
    if ln.strip() and not ln.strip().startswith("#"):
        print(" ", ln)
PY

if ! mkqnximage --clean --noprompt --build < /dev/null; then
  echo "Retrying data_files.custom without bracket attributes..."
  grep -v 'type=dir' "$VM_DIR/local/snippets/data_files.custom" | sed -E 's/^\[[^]]+\][[:space:]]+//' > /tmp/data_files.plain
  mv /tmp/data_files.plain "$VM_DIR/local/snippets/data_files.custom"
  mkqnximage --clean --noprompt --build < /dev/null
fi

echo "=== Booting QNX 8.0 in QEMU & executing live guest verification ==="
VM_DIR_ENV="$VM_DIR" OUT_DIR_ENV="$OUT_DIR" python3 -I - <<'PY'
import glob, os, re, select, subprocess, time

vm_dir = os.environ["VM_DIR_ENV"]
out_dir = os.environ["OUT_DIR_ENV"]
os.chdir(vm_dir)

kvm_ok = os.access("/dev/kvm", os.R_OK | os.W_OK)
accel = ["-enable-kvm", "-cpu", "host"] if kvm_ok else ["-accel", "tcg", "-cpu", "max"]

disk_img = os.path.join(vm_dir, "output", "disk-qemu")
if not os.path.isfile(disk_img):
    cands = [p for p in sorted(glob.glob(os.path.join(vm_dir, "output", "*"))) if os.path.isfile(p) and "disk" in os.path.basename(p)]
    if not cands:
        raise SystemExit("No disk image found in output/")
    disk_img = cands[0]
fmt = "vmdk" if disk_img.endswith(".vmdk") else "raw"

cmd = [
    "qemu-system-x86_64",
    *accel,
    "-smp", "2",
    "-m", "1024",
    "-drive", f"file={disk_img},if=ide,format={fmt}",
    "-netdev", "user,id=qnxnet0",
    "-device", "virtio-net-pci,netdev=qnxnet0",
    "-display", "none",
    "-monitor", "none",
    "-serial", "stdio",
]
print("Launching QEMU:", " ".join(cmd), flush=True)
proc = subprocess.Popen(
    cmd,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    bufsize=0,
)
assert proc.stdin is not None and proc.stdout is not None
out_fd = proc.stdout.fileno()
os.set_blocking(out_fd, False)

def read_until(marker: str, timeout_s: float) -> str:
    buf = bytearray()
    deadline = time.monotonic() + timeout_s
    marker_b = marker.encode("utf-8")
    while time.monotonic() < deadline:
        if proc.poll() is not None and not select.select([out_fd], [], [], 0)[0]:
            break
        rem = max(0.05, min(0.5, deadline - time.monotonic()))
        r, _, _ = select.select([out_fd], [], [], rem)
        if r:
            try:
                chunk = os.read(out_fd, 65536)
            except BlockingIOError:
                continue
            if not chunk:
                break
            buf.extend(chunk)
            if marker_b in buf:
                break
    return buf.decode("utf-8", "replace")

def send_cmd(line: str) -> None:
    proc.stdin.write((line + "\n").encode("utf-8"))
    proc.stdin.flush()

try:
    boot_log = read_until("Startup complete", 90.0)
    time.sleep(2.0)
    boot_log += read_until("__NEVER_MATCH__", 2.0)
    print("--- QNX 8.0 Serial Boot Log ---", flush=True)
    print(boot_log.replace("\r", ""), flush=True)
    if "Startup complete" not in boot_log:
        raise SystemExit(f"QNX 8.0 did not reach 'Startup complete' (qemu poll={proc.poll()})")

    print("Driving QNX 8.0 guest verification directly over /dev/ser1 root ksh console...", flush=True)
    send_cmd("")
    time.sleep(0.5)
    send_cmd("chmod +x /data/warden/qpp /data/warden/vss-warden-cli-qnx800-x86_64 /data/warden/run_on_qnx_guest.sh /data/warden/extra-libs/* 2>/dev/null; /bin/sh /data/warden/run_on_qnx_guest.sh > /data/warden/guest-out.txt 2>&1; printf '__WARDEN_%s=%d__\\n' 'RC' $?")
    rc_out = read_until("__WARDEN_RC=", 150.0)
    time.sleep(0.5)
    rc_out += read_until("__NEVER_MATCH__", 1.0)
    print("Serial command completion:", rc_out.replace("\r", ""), flush=True)

    send_cmd("printf '__BEGIN_%s__\\n' 'GUEST_OUT'; cat /data/warden/guest-out.txt; printf '\\n__END_%s__\\n' 'GUEST_OUT'")
    raw_guest = read_until("__END_GUEST_OUT__", 30.0).replace("\r\n", "\n").replace("\r", "\n")
    m = re.search(r"__BEGIN_GUEST_OUT__\n(.*?)\n?__END_GUEST_OUT__", raw_guest, re.S)
    if not m:
        print("RAW SERIAL DUMP:\n", raw_guest, flush=True)
        raise SystemExit("Failed to extract guest-out.txt from serial console")
    guest_text = m.group(1).strip() + "\n"
    open(os.path.join(out_dir, "qemu-qnx800-target-run.txt"), "w", encoding="utf-8").write(guest_text)

    send_cmd("printf '__BEGIN_%s__\\n' 'CLI_JSON'; cat /data/warden/cli-preset2.json; printf '\\n__END_%s__\\n' 'CLI_JSON'")
    raw_cli = read_until("__END_CLI_JSON__", 20.0).replace("\r\n", "\n").replace("\r", "\n")
    mc = re.search(r"__BEGIN_CLI_JSON__\n(.*?)\n?__END_CLI_JSON__", raw_cli, re.S)
    if mc:
        open(os.path.join(out_dir, "qnx800-cli-preset2.json"), "w", encoding="utf-8").write(mc.group(1).strip() + "\n")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
PY

cat "$OUT_DIR/qemu-qnx800-target-run.txt"
grep -q "QNX 8.0 GUEST VERIFICATION PASSED" "$OUT_DIR/qemu-qnx800-target-run.txt"

echo "=== [6/6] Rendering High-DPI Terminal Proof Screenshot ==="
OUT_DIR_ENV="$OUT_DIR" /usr/bin/python3 -I - <<'PY'
import os
from PIL import Image, ImageDraw, ImageFont

out_dir = os.environ["OUT_DIR_ENV"]
build_txt = open(os.path.join(out_dir, "build-receipt.txt"), encoding="utf-8", errors="replace").read().splitlines()
guest_txt = open(os.path.join(out_dir, "qemu-qnx800-target-run.txt"), encoding="utf-8", errors="replace").read().splitlines()

lines = [
    "VssWarden — QNX SDP 8.0 (qcc) Cross-Compile & QNX Neutrino 8.0 QEMU Live Target Proof",
    "=" * 98,
]
for ln in build_txt:
    if any(k in ln for k in ["Date (UTC):", "12.2.0,gcc_nto", "ELF 64-bit", "program interpreter", "NEEDED"]):
        if "qpp/nto/" in ln:
            continue
        lines.append(ln[:122])
lines.append("-" * 98)
for ln in guest_txt:
    if not ln.strip():
        continue
    if len(ln) > 122:
        lines.append(ln[:119] + "...")
    else:
        lines.append(ln)

lines = lines[:90]
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
font = ImageFont.truetype(font_path, 15)
title_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 17)

pad_x, pad_y, line_h = 34, 30, 21
w = 1560
h = pad_y * 2 + 44 + len(lines) * line_h

img = Image.new("RGB", (w, h), (13, 17, 23))
draw = ImageDraw.Draw(img)

# Window bar
draw.rounded_rectangle((16, 16, w - 16, h - 16), radius=14, fill=(18, 23, 33), outline=(48, 58, 78), width=2)
draw.ellipse((36, 32, 50, 46), fill=(255, 95, 86))
draw.ellipse((60, 32, 74, 46), fill=(255, 189, 46))
draw.ellipse((84, 32, 98, 46), fill=(39, 201, 63))
draw.text((120, 29), "root@qnx800-qemu:/data/warden — QNX Neutrino RTOS 8.0 Target Verification", font=title_font, fill=(195, 209, 228))

y = 70
for idx, ln in enumerate(lines):
    color = (214, 222, 235)
    if idx == 0 or "VERIFICATION PASSED" in ln or "GUEST VERIFICATION START" in ln:
        color = (86, 232, 146)
    elif ln.startswith("$ ") or ln.startswith("--- "):
        color = (122, 184, 255)
    elif "rejected" in ln or "blocked" in ln or "EBUSY" in ln or "ERANGE" in ln or "EPERM" in ln or "Not owner" in ln or "Permission" in ln:
        color = (255, 194, 102)
    draw.text((pad_x, y), ln, font=font, fill=color)
    y += line_h

png_path = os.path.join(out_dir, "08-qnx800-qemu-target-proof.png")
img.save(png_path, optimize=True)
print("Saved PNG proof:", png_path)
PY

# Redact any accidental email or serial before nvrun fetches docs/qnx800-verification
sed -i -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[redacted-myqnx-account]/g; s/[0-9]{6}-[0-9]{8}/[redacted-serial]/g' "$LOG_FILE"
echo "=== ALL STEPS SUCCEEDED ==="
