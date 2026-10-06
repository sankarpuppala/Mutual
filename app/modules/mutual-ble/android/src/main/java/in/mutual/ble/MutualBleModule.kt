package `in`.mutual.ble

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS-facing surface of the BLE module (SPEC.md §14, app/src/presence/bleAdapter.ts).
 *
 * The surface is deliberately tiny, and its shape is the privacy boundary:
 *
 *  - `setSchedule` takes `(day, interval, eid)` triples. No daily key, no private key, no
 *    derivation (CLAUDE.md invariant 7). Native could not compute an EID if it wanted to.
 *  - `drain` returns window *counts*, never RSSI values and never timestamps, and clears
 *    what it returns (SPEC §14.4).
 *  - There is no "who is nearby now" call, because there is no such concept in this app
 *    (invariant 4). The only way sightings leave is the nightly padded upload.
 *
 * Base64url is the wire format for bytes across the bridge, matching
 * `packages/protocol-ts/src/encoding.ts`, so JS never has to reason about two encodings.
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

        /** The permissions the app must request. Never a location permission (invariant 3). */
        Function("requiredPermissions") {
            REQUIRED_PERMISSIONS.toList()
        }

        /**
         * Replaces the schedule. Entries outside today and tomorrow are accepted and simply
         * never match a slot, which keeps the JS side free to send a two-day window.
         */
        Function("setSchedule") { entries: List<Map<String, Any?>> ->
            MutualBleService.State.schedule = entries.mapNotNull { toEntry(it) }
        }

        Function("start") { config: Map<String, Any?> ->
            MutualBleService.setRestartAfterBoot(context, true)
            val intent = Intent(context, MutualBleService::class.java)
                .setAction(MutualBleService.ACTION_CONFIGURE)
                .putExtra(
                    MutualBleService.EXTRA_SCAN_PERIOD,
                    (config["scanPeriodSeconds"] as? Number)?.toInt() ?: 60,
                )
                .putExtra(
                    MutualBleService.EXTRA_SCAN_WINDOW,
                    (config["scanWindowSeconds"] as? Number)?.toInt() ?: 8,
                )
                .putExtra(
                    MutualBleService.EXTRA_RSSI_THRESHOLD,
                    (config["rssiThresholdDbm"] as? Number)?.toInt() ?: -80,
                )
            context.startForegroundService(intent)
        }

        Function("stop") {
            // Pausing must survive a reboot: the user asked to stop being noticed.
            MutualBleService.setRestartAfterBoot(context, false)
            context.startService(
                Intent(context, MutualBleService::class.java)
                    .setAction(MutualBleService.ACTION_STOP),
            )
        }

        /** Returns and clears every aggregated sighting (SPEC §14.4). */
        Function("drain") {
            store.drain().map { record ->
                mapOf(
                    "day" to record.day,
                    "interval" to record.interval,
                    "ownEid" to encode(record.ownEid),
                    "heardEid" to encode(record.heardEid),
                    "windows" to record.windows,
                )
            }
        }

        Function("status") {
            val radio = BleRadio(context)
            mapOf(
                "advertising" to MutualBleService.State.running,
                "scanning" to MutualBleService.State.running,
                "layout" to MutualBleService.State.layout.name,
                "bluetoothOn" to radio.isBluetoothOn(),
                "scheduledThrough" to
                    MutualBleService.State.schedule.maxByOrNull { it.day }?.day,
                "scheduleSize" to MutualBleService.State.schedule.size,
            )
        }

        /** For the Phase 9a debug screen only: reads the store without clearing it. */
        Function("peek") {
            store.peek().map { mapOf("windows" to it.windows, "interval" to it.interval) }
        }
    }

    private fun toEntry(raw: Map<String, Any?>): ScheduleEntry? {
        val day = raw["day"] as? String ?: return null
        val interval = (raw["interval"] as? Number)?.toInt() ?: return null
        val eid = (raw["eid"] as? String)?.let { decode(it) } ?: return null
        if (eid.size != BleConstants.EID_BYTES) return null
        return ScheduleEntry(day, interval, eid)
    }

    private companion object {
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

        fun decode(text: String): ByteArray? = runCatching { Base64.decode(text, B64URL) }.getOrNull()
    }
}
