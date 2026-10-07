package app.mutual.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * The radio itself: advertising Mutual's 35-byte payload and duty-cycled filtered scanning
 * (SPEC.md §14.2, §14.3).
 *
 * **BLE 5 extended advertising only** (decision D23, risk R12): it carries all 35 bytes in
 * one advertisement. A device that cannot manage it is reported as UNSUPPORTED, and this
 * class reports what it achieved rather than assuming. The split-advertisement fallback
 * that used to live here was withdrawn on 2026-10-07 -- it could never be received, because
 * both of its halves used company id 0xFFFF and Android keeps only one structure per
 * company id (SPEC §14.2, DECISIONS_LOG 30).
 *
 * Scanning is filtered on manufacturer id `0xFFFF` plus the magic+version prefix. The
 * filter is mandatory, not an optimisation: Android pauses unfiltered scans while the
 * screen is off, which would silently end discovery for the whole day.
 */
@SuppressLint("MissingPermission") // The module checks permissions before starting the service.
class BleRadio(private val context: Context) {

    interface Listener {
        /**
         * One qualifying scan window: [heardEid] is a 32-byte ephemeral id, already above
         * the RSSI threshold.
         */
        fun onQualifyingWindow(heardEid: ByteArray)

        /** The layout changed, e.g. extended advertising turned out to be unavailable. */
        fun onLayoutResolved(layout: AdvertiseLayout)
    }

    var listener: Listener? = null

    /** dBm floor for a sighting to count at all (`ble.rssi_threshold_dbm`, default -80). */
    var rssiThresholdDbm: Int = -80

    private val handler = Handler(Looper.getMainLooper())
    private val manager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val adapter: BluetoothAdapter? get() = manager?.adapter

    private var advertisingSetActive = false
    private var scanning = false
    private var layout = AdvertiseLayout.UNSUPPORTED

    /** EIDs this device is currently advertising, so its own echoes are dropped (§14.3). */
    private val ownEids = linkedSetOf<String>()

    /**
     * Peers heard in the window currently open, so many packets from one phone count once.
     * Cleared at the start of every scan window.
     */
    private val heardThisWindow = linkedSetOf<String>()

    val isAdvertising: Boolean get() = advertisingSetActive
    val isScanning: Boolean get() = scanning
    val currentLayout: AdvertiseLayout get() = layout

    fun isSupported(): Boolean {
        val a = adapter ?: return false
        return a.isMultipleAdvertisementSupported && a.bluetoothLeScanner != null
    }

    fun isBluetoothOn(): Boolean = adapter?.isEnabled == true

    // ---------------------------------------------------------------- advertising

    /**
     * Starts advertising [eid] using BLE 5 extended advertising, the only layout Mutual
     * supports (SPEC §14.2). Restarting is how a rotation happens: the caller stops, waits
     * for a new random device address, and starts again.
     *
     * A device without extended advertising is reported as UNSUPPORTED rather than put on
     * the old split layout. That fallback advertised correctly and could never be received
     * -- both halves shared company id 0xFFFF, and Android collapses manufacturer-specific
     * data into a map keyed by it -- so a phone on that path looked healthy and heard
     * nobody, for good. Saying "not supported" is the only honest answer available without
     * changing what goes on air (DECISIONS_LOG 29 and 30).
     */
    fun startAdvertising(eid: ByteArray) {
        stopAdvertising()
        ownEids.add(eid.toHex())
        val a = adapter ?: return
        if (a.isLeExtendedAdvertisingSupported) {
            startExtended(eid)
        } else {
            Log.w(TAG, "no BLE 5 extended advertising on this device; discovery cannot run")
            resolveLayout(AdvertiseLayout.UNSUPPORTED)
        }
    }

    private fun startExtended(eid: ByteArray) {
        val advertiser = adapter?.bluetoothLeAdvertiser ?: return
        val parameters = AdvertisingSetParameters.Builder()
            .setLegacyMode(false)
            .setConnectable(false)
            .setScannable(true)
            .setInterval(AdvertisingSetParameters.INTERVAL_MEDIUM)
            .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_MEDIUM)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addManufacturerData(BleConstants.COMPANY_ID, Payload.full(eid))
            .build()

        runCatching {
            advertiser.startAdvertisingSet(parameters, data, null, null, null, extendedCallback)
        }.onFailure {
            Log.w(TAG, "extended advertising rejected; discovery cannot run on this device")
            resolveLayout(AdvertiseLayout.UNSUPPORTED)
        }
    }

    fun stopAdvertising() {
        val advertiser = adapter?.bluetoothLeAdvertiser
        if (advertisingSetActive) {
            runCatching { advertiser?.stopAdvertisingSet(extendedCallback) }
            advertisingSetActive = false
        }
    }

    /** Called on rotation: the old EID stops being ours once it is no longer advertised. */
    fun forgetOwnEid(eid: ByteArray) {
        ownEids.remove(eid.toHex())
    }

    private val extendedCallback = object : AdvertisingSetCallback() {
        override fun onAdvertisingSetStarted(set: android.bluetooth.le.AdvertisingSet?, txPower: Int, status: Int) {
            if (status == ADVERTISE_SUCCESS) {
                advertisingSetActive = true
                resolveLayout(AdvertiseLayout.EXTENDED)
            } else {
                Log.w(TAG, "extended advertising failed with status $status")
                resolveLayout(AdvertiseLayout.UNSUPPORTED)
            }
        }
    }

    private fun resolveLayout(next: AdvertiseLayout) {
        if (layout == next) return
        layout = next
        listener?.onLayoutResolved(next)
    }

    // ------------------------------------------------------------------- scanning

    /**
     * Opens one scan window of [windowSeconds]. The caller re-opens it every
     * `ble.scan_period_seconds`; keeping the radio on continuously is what drains a battery.
     */
    fun scanOnce(windowSeconds: Int) {
        val scanner = adapter?.bluetoothLeScanner ?: return
        if (scanning) return

        heardThisWindow.clear()
        val filter = ScanFilter.Builder()
            .setManufacturerData(BleConstants.COMPANY_ID, Payload.filterPrefix(), Payload.filterMask())
            .build()
        // Low latency inside a short window gives the best chance of catching a low-power
        // advertiser without leaving the radio on between windows.
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .build()

        runCatching {
            scanner.startScan(listOf(filter), settings, scanCallback)
            scanning = true
            handler.postDelayed(::stopScan, windowSeconds * 1000L)
        }.onFailure { Log.w(TAG, "could not start scanning") }
    }

    fun stopScan() {
        if (!scanning) return
        runCatching { adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
        scanning = false
        handler.removeCallbacks(::stopScan)
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            val record = result?.scanRecord ?: return
            if (result.rssi < rssiThresholdDbm) return

            val data = record.getManufacturerSpecificData(BleConstants.COMPANY_ID)
            val heard = Payload.extractEid(data) ?: return
            val hex = heard.toHex()

            // Own echoes are dropped (SPEC §14.3): a phone hears itself through reflections
            // and through a second advertiser, and a self-crossing is meaningless.
            if (ownEids.contains(hex)) return

            // One count per peer per window, however many packets arrive.
            if (!heardThisWindow.add(hex)) return
            listener?.onQualifyingWindow(heard)
        }

        override fun onScanFailed(errorCode: Int) {
            Log.w(TAG, "scan failed with error $errorCode")
            scanning = false
        }
    }

    private companion object {
        const val TAG = "MutualBle"
    }
}
