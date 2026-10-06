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

**This also breaks the pre-commit hooks**, which shell out to bare `python`
and `pytest`. Until the policy is changed, either commit with
`--no-verify` **and run the checks by hand first**, or create a shim directory
early on `PATH` whose `python`/`pytest` call the allowed interpreter.

**The proper fix is yours to make, not a workaround:** ask whoever administers
this machine to allow the venv, or add an exclusion. A research project whose
whole point is privacy should not be quietly running with its test gate
disabled.

### What else that policy blocks

- **`scipy`'s compiled `_alternative` module**, which is why the study's
  mixed-effects model cannot be fitted here. `study/analysis/analyze.py`
  reports it as an environment problem and still prints all eight
  pre-registered tables.

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
Build through a short junction instead:

```powershell
cmd /c 'mklink /J C:\mtl "C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2"'
cd C:\mtl\app\android
.\gradlew.bat assembleDebug
```

`C:\mtl` already exists. It is a junction, not a copy — the same files.

## Building and running the app

```powershell
# PowerShell, with JAVA_HOME / ANDROID_HOME set as above.
cd C:\mtl\app
npx expo prebuild --platform android --no-install
"sdk.dir=C:\\Users\\sanka\\AppData\\Local\\Android\\Sdk" | Set-Content android\local.properties -Encoding ascii
cd android
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

### Metro and the server

```bash
adb reverse tcp:8081 tcp:8081      # Metro
adb reverse tcp:8000 tcp:8000      # the Mutual server

cd app && npx expo start --dev-client --port 8081
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

- **`SYSTEM_ALERT_WINDOW` in the debug manifest.** React Native's debug AAR
  declares it for LogBox. `npm run check:privacy -w app` reports it as a note
  in debug and **fails on it in release**. See `docs/DECISIONS_LOG.md` 26.
- **`expo start` says "An update for expo is available".** Ignore it during a
  verification run; upgrading mid-check invalidates what you just measured.
