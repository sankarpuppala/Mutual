# Running this project on the development laptop

Status: written 2026-10-07, after getting the app to build and launch on an
emulator for the first time. Every workaround here is one that was actually
needed, not a precaution.

Added to `SPEC.md` §20's file list in the same change that introduced it.

---

## The short version

```bash
# Git Bash, from the repository root.
export PATH="/c/Program Files/nodejs:$LOCALAPPDATA/Android/Sdk/platform-tools:$PATH"
export JAVA_HOME="$LOCALAPPDATA/Programs/Microsoft/jdk-17.0.10.7-hotspot"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export MSYS_NO_PATHCONV=1            # or adb's /sdcard/... paths get mangled

# Python: see "the Device Guard problem" below -- do NOT use .venv/Scripts/python.exe
R="$PWD"
PY="C:/Users/sanka/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe"
export PYTHONPATH="$R/.venv/Lib/site-packages;$R/packages/protocol_py;$R/server;$R/sim"

"$PY" -m pytest packages/protocol_py server sim -q      # 272 tests
npm test -w app                                          # 174 tests
```

---

## The Device Guard problem (the important one)

> **Resolved on 2026-10-16: Smart App Control was turned off**, deliberately,
> to get the first release build through (it blocked `hermesc.exe`; see below).
> `VerifiedAndReputablePolicyState` now reads **0**, and `.venv\Scripts\python.exe`,
> `ruff.exe` and `hermesc.exe` all run normally. The shim directory and the
> `PYTHONPATH` dance below are no longer required — they are kept because the
> machine cannot be put back the way it was (the switch is one-way), so if this
> project is ever set up on another Windows laptop with Smart App Control on,
> everything here applies again from scratch.

**It was Smart App Control, and it was on.** Checked on 2026-10-07:

```powershell
(Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy).VerifiedAndReputablePolicyState
# 1 = enforced, 2 = evaluation, 0 = off
```

It returned **1**. Smart App Control blocks executables it does not consider
signed and reputable, which is exactly what a freshly created virtualenv's
`python.exe` is — a copy with no signature of its own.

**Turning it off is a one-way door.** Windows Security → App & browser control
→ Smart App Control settings → Off. Once off it cannot be switched back on
without resetting or reinstalling Windows, so it is worth deciding deliberately
rather than in the middle of a build. Defender's real-time protection is
separate and stays on either way.

The alternative is the shim directory below, which works and costs nothing but
having to remember it. The one thing the shim cannot fix is `scipy`'s compiled
module, so the study's mixed-effects model cannot be fitted on this machine
while Smart App Control is on; that analysis can be run elsewhere (it needs no
paid service) and the eight descriptive tables print regardless.

**`.venv\Scripts\python.exe` is blocked by this machine's Device Guard / WDAC
policy.** Running it gives:

```
'...\.venv\Scripts\python.exe' was blocked by your organization's Device Guard policy.
```

It worked for most of the build session and then started being blocked, so the
policy evidently re-evaluates. The **uv-managed interpreter it was copied from
is still allowed**:

```
C:\Users\sanka\AppData\Roaming\uv\python\cpython-3.11-windows-x86_64-none\python.exe
```

So: use that interpreter, and put the venv's packages on `PYTHONPATH`. The
three editable installs (`mutual_protocol`, `mutual_server`, `mutual_sim`) are
installed via `.pth` files, which `PYTHONPATH` does not process, so their
source directories have to be listed too — that is why `PYTHONPATH` has four
entries and not one.

Verified: `272 passed`.

### The pre-commit gate works, but only with the shim directory on `PATH`

The hooks shell out to bare `python`, `pytest` and `ruff`. With the venv's own
interpreter blocked, they find the system Python 3.14 instead, which has none of
the dependencies.

`%LOCALAPPDATA%\mutual-dev-shim` holds `python`, `pytest`, `ruff`, `alembic` and
`uvicorn` shims that route through the allowed uv interpreter with the right
`PYTHONPATH`. **Put it first on `PATH` before committing** and the whole gate
runs — verified on 2026-10-07, all eleven hooks passing:

```bash
export PATH="/c/Users/sanka/AppData/Local/mutual-dev-shim:$PATH"
git add -A && git commit -F message.txt
```

(An earlier version of this file said the four Python hooks fail regardless.
That was written after a run where the shim directory was not on `PATH`, and it
was wrong. They pass.)

`.git/hooks/pre-commit` is also patched to use the allowed interpreter, so a
commit from a shell without the shim still gets most of the way.

**The proper fix is still yours to make.** Ask whoever administers this machine
to allow the `.venv\Scripts\` directory under the Device Guard / WDAC policy,
then delete the shim directory. A workaround that has to be remembered is one
that will eventually be forgotten.

### What else that policy blocks

- **`scipy`'s compiled `_alternative` module**, which is why the study's
  mixed-effects model cannot be fitted here. `study/analysis/analyze.py`
  reports it as an environment problem and still prints all eight
  pre-registered tables.
- **`hermesc.exe`, and therefore every release build** — found on 2026-10-10,
  and the reason Smart App Control was switched off on 2026-10-16. The rest of
  this entry describes the machine as it was before that.
  the first time a release APK was attempted. `node_modules/hermes-compiler/
  hermesc/win64-bin/hermesc.exe` is unsigned, so Smart App Control refuses it
  and `:app:createBundleReleaseJsAndAssets` dies with
  `finished with non-zero exit value 4551`. Debug builds never hit this,
  because they load JS from Metro and never compile bytecode — which is why
  everything worked for months before anyone asked for a release build.

  Confirmed, not guessed: the CodeIntegrity event log
  (`Microsoft-Windows-CodeIntegrity/Operational`, events 3033/3077) names
  policy `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`, the Smart App Control
  policy. The file has no Mark-of-the-Web stream, so `Unblock-File` does
  nothing, and the package ships no WASM or JS compiler to fall back to.

  There is no per-file exception: Smart App Control has no allowlist, by
  design. The ways out are the one-way door above, or installing WSL and
  routing the Linux `hermesc` the same package ships through a path-
  translating shim. **Do not "fix" this by setting `hermesEnabled=false`** —
  that switches the app to JSC, and Phase 2 of `PLAN.md` exists to prove the
  protocol runs under *Hermes* (`packages/protocol-ts`, the in-app
  self-test). Changing the JS engine to dodge a local machine policy would
  invalidate that, and is a spec change, not a build fix.

## PowerShell: two separate problems

1. **`.venv\Scripts\Activate.ps1` fails** with
   `running scripts is disabled on this system`. Fix with
   `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
   (no admin needed) — **but it will not help**, because of (2).
2. **PowerShell cannot run the venv's Python at all** (Device Guard, above).

**Use Git Bash for anything involving Python.** PowerShell is fine for Gradle,
the emulator and `adb`.

## The 260-character path limit

The C++ part of the Android build fails from this project's real path:

```
ninja: error: Stat(...RNGestureHandlerDetectorShadowNode.cpp.o): Filename longer than 260 characters
```

Windows `LongPathsEnabled` is already `1`; ninja and CMake do not honour it.
CMake mangles each source file's absolute path into its object-file name, so the
project's own path has to be short before the build starts.

**Use a `subst` drive, not a junction.** `C:\mtl` is a junction, which is a
reparse point, and Java's `getCanonicalPath()` — used by Gradle and by the React
Native Gradle plugin when it writes `Android-autolinking.cmake` — resolves it
straight back to the long path, so the generated CMake files name
`C:/Users/sanka/Desktop/STUDIES/AIDS/Project 2/node_modules/...` however the
build was launched. A `subst` drive is not a reparse point and survives
canonicalisation:

```powershell
subst M: "C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2"
cd M:\app\android
.\gradlew.bat assembleDebug
```

`subst` does not survive a reboot; re-run it.

**The stale cache turned out to matter more than the path.** On 2026-10-07 this
error came back after an `expo prebuild`, and rebuilding through the junction
did not clear it. What did was deleting the two generated directories first:

```powershell
Remove-Item -Recurse -Force app\android\app\.cxx, app\android\app\build\generated\autolinking
```

With those gone the build succeeded in 25 minutes. So when the 260-character
error appears, delete those two directories before trying anything cleverer —
and note that the generated `Android-autolinking.cmake` still names the real
long path whether you build from `M:`, from `C:\mtl`, or from the project
itself, because the React Native Gradle plugin canonicalises. The short path is
insurance, not the fix.

The junction is still there and is still convenient for everything that is not
the C++ build:

```powershell
cmd /c 'mklink /J C:\mtl "C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2"'
cd C:\mtl\app\android
.\gradlew.bat assembleDebug
```

`C:\mtl` already exists. It is a junction, not a copy — the same files.

## Building and running the app

**Set `EXPO_PUBLIC_MUTUAL_ENV=dev` before building or starting Metro.** The app
config defaults to `prod` on purpose (invariant 11: a build made without the
variable must be the safe one), and `isDev()` is what shows the dev panel,
enables clock travel and allows the fake BLE adapter on an emulator. Without it
the build works, but the dev panel is gone and `pickAdapter` returns the native
adapter, which honestly reports `unsupported_device` on an emulator.

```powershell
# PowerShell, with JAVA_HOME / ANDROID_HOME set as above.
$env:EXPO_PUBLIC_MUTUAL_ENV = "dev"
subst M: "C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2"   # see the 260-character section
cd M:\app
npx expo prebuild --platform android --no-install
# prebuild wipes android/, and the stale C++ paths under it are what fail the build.
Remove-Item -Recurse -Force android\app\.cxx, android\app\build\generated\autolinking -ErrorAction SilentlyContinue
# Forward slashes on purpose. A .properties file reads a single backslash as an
# escape, so C:\Users\... becomes C:UsersAppData... and Gradle fails with "The
# filename, directory name, or volume label syntax is incorrect".
"sdk.dir=C:/Users/sanka/AppData/Local/Android/Sdk" | Set-Content android\local.properties -Encoding ascii
cd M:\app\android
.\gradlew.bat assembleDebug          # about 12 minutes cold, 2 warm
```

Then, in Git Bash:

```bash
emulator -avd mutual-a -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 5; done

adb shell wm size 1080x1920 && adb shell wm density 420   # the default skin is 320x640
adb install -r "C:/Users/sanka/Desktop/STUDIES/AIDS/Project 2/app/android/app/build/outputs/apk/debug/app-debug.apk"
```

Two AVDs already exist: **`mutual-a`** and **`mutual-b`**. Two are needed from
§4 of `docs/E2E_CHECKLIST.md` onwards, because a mutual match needs two people.

Drop `-no-window` to watch it on screen.

### Release builds: only from a short path, and only in a worktree

First produced on 2026-10-16, for a phone that should open the app without the
dev-client launcher. Two things make a release build different from every
debug build before it, and both cost a day to find.

**It compiles JS to Hermes bytecode**, which debug builds never do (they load
JS from Metro). That is what hit the blocked `hermesc.exe` above.

**It cannot be built from this project's real path**, because of the
260-character limit. This is the same limit as the section above but a
different, worse case: CMake names each object file after its source's
*absolute* path, and for the autolinked codegen targets that produces a path
**294 characters long measured relative to the ninja build directory**, which
is what ninja's `Stat()` actually checks. Measured, not estimated. Two things
that look like fixes are not:

- **`subst` / junctions do not help.** The React Native Gradle plugin
  canonicalises them straight back to the long path. Worse, building from
  `M:` fails *earlier*, in `:react-native-svg:generateCodegenSchemaFromJavaScript`,
  with `this and base files have different roots` — the codegen CLI resolves
  through `M:` while the project model resolves through `C:`.
- **`CMAKE_OBJECT_PATH_MAX` does not help.** Setting it to 240 does reach
  CMake (it appears in `CMakeCache.txt`), and is simply ignored: the object
  path shortening it controls is implemented in CMake's *Makefile* generator,
  and Android's native build uses *Ninja*.

What works is a **real** short directory — a git worktree:

```powershell
git worktree add C:\m HEAD --detach
cd C:\m; npm install
$env:EXPO_PUBLIC_MUTUAL_ENV = "dev"
$env:EXPO_PUBLIC_SERVER_URL = "http://<laptop-ip>:8000"
cd C:\m\app; npx expo prebuild --platform android --no-install
"sdk.dir=C:/Users/sanka/AppData/Local/Android/Sdk" | Set-Content android\local.properties -Encoding ascii
cd C:\m\app\android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
```

At `C:\m` that same worst-case path measures **253** — it fits, with **seven
characters to spare**. That margin is the fragile part: a new dependency with
deeper C++ paths breaks release builds again, and the error will point at
ninja rather than at the dependency. `-PreactNativeArchitectures=arm64-v8a`
builds for a phone only and cuts the native compile roughly fourfold; drop it
if the APK also has to run on an x86_64 emulator.

Cold build ≈ 15 minutes. A rebuild that only changes JS (a new server address,
say) reuses the native outputs and takes ≈ 50 seconds, so do **not** re-run
`expo prebuild` for one — it wipes `android/` and costs the full 15 again.

The APK lands at
`C:\m\app\android\app\build\outputs\apk\release\app-release.apk` (≈ 85 MB,
against ≈ 322 MB for debug). It is signed with the same Expo-template debug
keystore as the debug build, so it installs over it without an uninstall.

**Verify the merged release manifest, not the prebuild one.** This is the
only build where `npm run check:privacy` can check what actually ships:
release drops the debug manifest overlay, so `SYSTEM_ALERT_WINDOW` disappears
and the cleartext permission comes from `app.config.ts` instead. Confirmed on
the first release build: no location permission, `BLUETOOTH_SCAN` with
`neverForLocation`, no `SYSTEM_ALERT_WINDOW`.

### Metro and the server

```bash
adb reverse tcp:8081 tcp:8081      # Metro
adb reverse tcp:8000 tcp:8000      # the Mutual server

cd app && EXPO_PUBLIC_MUTUAL_ENV=dev npx expo start --dev-client --port 8081
```

The app is a **dev build**, so it opens a launcher listing development
servers. Tap the "Mutual" row, or skip the tap with a deep link:

```bash
adb shell am start -a android.intent.action.VIEW \
  -d 'mutual://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
```

The server, in Git Bash with the Python setup above:

```bash
"$PY" -m alembic -c server/alembic.ini upgrade head
MUTUAL_ENV=dev "$PY" -m mutual_server.admin campuses approve example.ac.in --name "Example College"
MUTUAL_ENV=dev "$PY" -m uvicorn mutual_server.main:create_app --factory \
  --no-access-log --app-dir server --host 0.0.0.0 --port 8000
```

`MUTUAL_ENV=dev` is required for the admin CLI too: `config.example.yaml` has
`email.mode: console`, which the config refuses outside dev/test.

## Screenshots

```bash
export MSYS_NO_PATHCONV=1           # without this, /sdcard/... becomes a Windows path
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png ./shot.png
```

Do **not** use PowerShell's `adb exec-out screencap -p > file.png` — the
redirect adds a BOM and corrupts the PNG.

## Things that look broken and are not

- **Nothing uploads during the day.** Both uploads now wait for a random minute
  inside their window — `signal_upload_window` (18:00–23:30) and
  `presence_upload_window` (00:05–06:00), SPEC §6.11. Running the app at noon
  and expecting a request is a misreading of the system, not a bug. Use the dev
  panel's clock travel to move into a window, or shift the windows in
  `server/config.yaml` for a demo and change them back.
- **A night missed is a night gone.** If the device is not awake during the
  presence window, that day is not uploaded late; the server's cutoff then
  drops it. Deliberate (DECISIONS_LOG 29, Board Q11).

- **`SYSTEM_ALERT_WINDOW` in the debug manifest.** React Native's debug AAR
  declares it for LogBox. `npm run check:privacy -w app` reports it as a note
  in debug and **fails on it in release**. See `docs/DECISIONS_LOG.md` 26.
- **`expo start` says "An update for expo is available".** Ignore it during a
  verification run; upgrading mid-check invalidates what you just measured.

## The laptop's IP moves, and it takes the phone with it

On this campus Wi-Fi the DHCP lease turned over four times in six days —
`10.217.8.118`, `10.178.241.80`, `10.217.8.226`, `10.214.240.37`, the last two
minutes apart. Everything that points a phone at this laptop by IP dies each
time, and the symptom is just "the app doesn't open": the download link 404s,
or the installed app reaches nothing.

A release APK has `EXPO_PUBLIC_SERVER_URL` compiled in, so historically each
change meant rebuilding. It does not any more — **the dev panel's "Server
address" card repoints the device**, stored on the device, surviving restart
and logout (`app/src/api/client.ts`, dev builds only). Get the current address
with `ipconfig` and type it in.

Reaching the dev panel on a release build is the awkward part: **there is no
in-app link to it**. On the emulator it was the dev-client's floating bubble,
which a release build does not have. Open **`mutual://dev`** from the phone's
browser instead — the `mutual` scheme is in the release manifest. If a visible
entry point is ever wanted, it needs a spec change, because every screen is
supposed to match `docs/design/prototype.html`.

Two other things die the same way and just need restarting: a `uvicorn` left
running for days can wedge (alive, listening, answering nothing — restart it),
and anything bound for the phone must be `--host 0.0.0.0`, never the default
localhost.
