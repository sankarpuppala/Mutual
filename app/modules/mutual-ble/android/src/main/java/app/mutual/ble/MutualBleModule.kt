package app.mutual.ble

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * The JS-facing surface of the BLE module (SPEC.md §14, app/src/presence/bleAdapter.ts).
 *
 * The surface is deliberately tiny, and its shape is the privacy boundary:
 *
 *  - `setScheduleJson` takes `(day, interval, eid)` triples. No daily key, no private key,
 *    no derivation (CLAUDE.md invariant 7). Native could not compute an EID if it wanted to.
 *  - `drainJson` returns window *counts*, never RSSI values and never timestamps, and
 *    clears what it returns (SPEC §14.4).
 *  - There is no "who is nearby now" call, because there is no such concept in this app
 *    (invariant 4). The only way sightings leave is the nightly padded upload.
 *
 * ## Why every signature is a primitive or a JSON string
 *
 * The Expo Modules API builds its JS/native converters by **reifying** the types in each
 * `Function { ... }` signature. Anything it cannot reify throws
 * `UnsupportedOperationException: This function has a reified type parameter` at
 * **module-registration time** — which takes the whole app down on launch, before a line of
 * JS runs, with a stack trace that points at `definition()` and not at the offending
 * signature.
 *
 * Two attempts failed that way: `Map<String, Any?>` first, then `Record` classes. Rather
 * than keep guessing which generic the converter provider accepts, the bridge now carries
 * **only `Boolean`, `Int` and `String`**. Structured data crosses as JSON, built and parsed
 * explicitly here and in `app/src/presence/nativeBle.ts`.
 *
 * That is less elegant and strictly more robust, and it costs nothing at this volume — a
 * drain is a few hundred small records once a night. It also makes the privacy contract
 * easier to audit rather than harder: every field that crosses is written out by name in
 * `toJson` below, so there is no object spread through which an RSSI value or a timestamp
 * could arrive unnoticed. See DECISIONS_LOG 27.
 */
class MutualBleModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "no react context" }

    private val store: SightingStore by lazy { SightingStore(context) }

    override fun definition() = ModuleDefinition {
        Name("MutualBle")

        Function("isSupported") {
            BleRadio(context).isSupported()
        }

        Function("hasPermissions") {
            REQUIRED_PERMISSIONS.all {
                context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
            }
        }

        /**
         * The permissions the app must request, as a JSON array of strings.
         * Never a location permission (invariant 3).
         */
        Function("requiredPermissionsJson") {
            val array = JSONArray()
            for (permission in REQUIRED_PERMISSIONS) array.put(permission)
            array.toString()
        }

        /**
         * Replaces the schedule from a JSON array of `{day, interval, eid}`.
         *
         * Entries outside today and tomorrow are accepted and simply never match a slot,
         * which keeps the JS side free to send a two-day window. A malformed entry is
         * skipped rather than rejecting the batch, so one bad record cannot stop the radio.
         */
        Function("setScheduleJson") { json: String ->
            MutualBleService.State.schedule = parseSchedule(json)
            MutualBleService.State.schedule.size
        }

        Function("start") { scanPeriodSeconds: Int, scanWindowSeconds: Int, rssiThresholdDbm: Int ->
            MutualBleService.setRestartAfterBoot(context, true)
            val intent = Intent(context, MutualBleService::class.java)
                .setAction(MutualBleService.ACTION_CONFIGURE)
                .putExtra(MutualBleService.EXTRA_SCAN_PERIOD, scanPeriodSeconds)
                .putExtra(MutualBleService.EXTRA_SCAN_WINDOW, scanWindowSeconds)
                .putExtra(MutualBleService.EXTRA_RSSI_THRESHOLD, rssiThresholdDbm)
            context.startForegroundService(intent)
            // Explicit Unit: startForegroundService returns ComponentName?, and Kotlin would
            // infer that as this lambda's return type. Expo cannot convert an Android class,
            // so reifying it throws at module-registration time (DECISIONS_LOG 27).
            Unit
        }

        Function("stop") {
            // Pausing must survive a reboot: the user asked to stop being noticed.
            MutualBleService.setRestartAfterBoot(context, false)
            context.startService(
                Intent(context, MutualBleService::class.java)
                    .setAction(MutualBleService.ACTION_STOP),
            )
            // Explicit Unit, for the same reason as `start` above.
            Unit
        }

        /**
         * Returns and clears every aggregated sighting (SPEC §14.4), as a JSON array.
         *
         * Exactly five fields per sighting, each written out by name. There is no RSSI
         * value and no timestamp here, and no mechanism by which one could appear.
         */
        Function("drainJson") {
            val array = JSONArray()
            for (record in store.drain()) {
                array.put(
                    JSONObject()
                        .put("day", record.day)
                        .put("interval", record.interval)
                        .put("ownEid", encode(record.ownEid))
                        .put("heardEid", encode(record.heardEid))
                        .put("windows", record.windows),
                )
            }
            array.toString()
        }

        Function("statusJson") {
            val radio = BleRadio(context)
            JSONObject()
                .put("advertising", MutualBleService.State.running)
                .put("scanning", MutualBleService.State.running)
                .put("layout", MutualBleService.State.layout.name)
                .put("bluetoothOn", radio.isBluetoothOn())
                .put(
                    "scheduledThrough",
                    MutualBleService.State.schedule.maxByOrNull { it.day }?.day ?: JSONObject.NULL,
                )
                .put("scheduleSize", MutualBleService.State.schedule.size)
                .toString()
        }

        /** For the Phase 9a debug screen only: reads the store without clearing it. */
        Function("peekJson") {
            val array = JSONArray()
            for (record in store.peek()) {
                array.put(
                    JSONObject()
                        .put("interval", record.interval)
                        .put("windows", record.windows),
                )
            }
            array.toString()
        }
    }

    private fun parseSchedule(json: String): List<ScheduleEntry> {
        val out = ArrayList<ScheduleEntry>()
        val array = runCatching { JSONArray(json) }.getOrNull() ?: return out
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val day = item.optString("day", "")
            val interval = item.optInt("interval", -1)
            val eid = decode(item.optString("eid", ""))
            if (day.isEmpty() || interval < 0 || eid == null) continue
            if (eid.size != BleConstants.EID_BYTES) continue
            out.add(ScheduleEntry(day, interval, eid))
        }
        return out
    }

    companion object {
        /**
         * Exactly the Bluetooth and notification permissions, and nothing else. If BLE ever
         * seems to need a location permission, that is an escalation (invariant 3), never an
         * addition to this list.
         */
        val REQUIRED_PERMISSIONS = arrayOf(
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.POST_NOTIFICATIONS,
        )

        const val B64URL = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP

        fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, B64URL)

        fun decode(text: String): ByteArray? =
            runCatching { Base64.decode(text, B64URL) }.getOrNull()
    }
}
