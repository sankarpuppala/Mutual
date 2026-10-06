package app.mutual.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * The foreground service (SPEC.md §14.5): advertise the scheduled EID, rotate it every 15
 * minutes with an advertising restart, and open one scan window every
 * `ble.scan_period_seconds`.
 *
 * It is a *foreground* service, with a permanent notification, because that is the only way
 * Android keeps BLE work alive for a whole day -- and because a user whose phone is quietly
 * noticing other phones should be able to see that it is, and stop it, at any moment. The
 * notification is part of the privacy promise, not an Android tax.
 *
 * Fail-safe: when the schedule runs out, advertising stops and the notification asks the
 * user to open Mutual. The service never invents an EID, because an EID it invented would
 * not be derivable by the peer and would produce crossings that can never resolve.
 */
class MutualBleService : Service(), BleRadio.Listener {

    private lateinit var radio: BleRadio
    private lateinit var store: SightingStore

    private val handler = Handler(Looper.getMainLooper())
    private var scanPeriodSeconds = 60
    private var scanWindowSeconds = 8
    private var zone: ZoneId = ZoneId.systemDefault()

    /** The EID currently on air, and the slot it belongs to. */
    private var currentEntry: ScheduleEntry? = null

    override fun onCreate() {
        super.onCreate()
        radio = BleRadio(this)
        radio.listener = this
        store = SightingStore(this)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopEverything()
                return START_NOT_STICKY
            }
            ACTION_CONFIGURE -> applyConfig(intent)
        }

        startForeground(NOTIFICATION_ID, buildNotification(advertising = radio.isAdvertising))
        State.running = true
        tick()
        return START_STICKY
    }

    private fun applyConfig(intent: Intent) {
        scanPeriodSeconds = intent.getIntExtra(EXTRA_SCAN_PERIOD, scanPeriodSeconds)
        scanWindowSeconds = intent.getIntExtra(EXTRA_SCAN_WINDOW, scanWindowSeconds)
        radio.rssiThresholdDbm = intent.getIntExtra(EXTRA_RSSI_THRESHOLD, radio.rssiThresholdDbm)
    }

    /**
     * One pass of the loop: make sure the right EID is on air, open a scan window, and come
     * back after the scan period.
     */
    private fun tick() {
        handler.removeCallbacks(::tick)
        ensureCorrectEid()
        if (radio.isAdvertising || State.schedule.isEmpty()) {
            // Scan even when advertising is impossible: hearing others is still useful, and
            // the other device's own dwell check is what makes a crossing anyway (§6.13).
            radio.scanOnce(scanWindowSeconds)
        }
        handler.postDelayed(::tick, scanPeriodSeconds * 1000L)
    }

    /**
     * Rotates the advertisement when the 15-minute slot changes (SPEC §14.2): stop, let the
     * stack pick a new random device address, then start the new EID. Whether the address
     * really changes is a measured question for the spike -- if it does not, a sniffer can
     * link EIDs across rotations, and that is escalated rather than quietly accepted.
     */
    private fun ensureCorrectEid() {
        val now = LocalTime.now(zone)
        val today = LocalDate.now(zone).toString()
        val interval = (now.hour * 60 + now.minute) / BleConstants.INTERVAL_MINUTES

        val wanted = State.schedule.firstOrNull { it.day == today && it.interval == interval }
        if (wanted == null) {
            if (currentEntry != null || radio.isAdvertising) {
                Log.i(TAG, "no EID for the current slot; stopping advertising (fail-safe)")
                currentEntry?.let { radio.forgetOwnEid(it.eid) }
                radio.stopAdvertising()
                currentEntry = null
                updateNotification(advertising = false)
            }
            return
        }
        if (wanted == currentEntry && radio.isAdvertising) return

        currentEntry?.let { radio.forgetOwnEid(it.eid) }
        radio.stopAdvertising()
        currentEntry = wanted
        // A short pause before restarting: the address is re-randomised between advertising
        // sessions, not within one.
        handler.postDelayed({ radio.startAdvertising(wanted.eid) }, ROTATE_PAUSE_MS)
        updateNotification(advertising = true)
    }

    override fun onQualifyingWindow(heardEid: ByteArray) {
        val entry = currentEntry ?: return
        store.addWindow(entry.day, entry.interval, entry.eid, heardEid)
    }

    override fun onLayoutResolved(layout: AdvertiseLayout) {
        State.layout = layout
        updateNotification(advertising = layout != AdvertiseLayout.UNSUPPORTED)
    }

    private fun stopEverything() {
        handler.removeCallbacks(::tick)
        radio.stopScan()
        radio.stopAdvertising()
        currentEntry = null
        State.running = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacks(::tick)
        radio.stopScan()
        radio.stopAdvertising()
        State.running = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ------------------------------------------------------------- notification

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Discovery",
            // Low importance: a permanent notification should be visible, never noisy.
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shown while Mutual is noticing nearby phones."
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(advertising: Boolean): Notification {
        val text = when {
            State.schedule.isEmpty() -> "Open Mutual to keep discovery running."
            !advertising -> "Discovery is paused by your phone. Open Mutual."
            else -> "Mutual is on · tap to pause"
        }
        val pause = PendingIntent.getService(
            this,
            0,
            Intent(this, MutualBleService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Mutual")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOngoing(true)
            .setContentIntent(pause)
            .build()
    }

    private fun updateNotification(advertising: Boolean) {
        if (!State.running) return
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(advertising))
    }

    /**
     * Shared between the service and the Expo module. A companion object rather than a bound
     * service because the module only ever reads status and hands down a schedule, and a
     * binder for that would be more moving parts than the job needs.
     */
    object State {
        @Volatile
        var running: Boolean = false

        @Volatile
        var layout: AdvertiseLayout = AdvertiseLayout.UNSUPPORTED

        @Volatile
        var schedule: List<ScheduleEntry> = emptyList()
    }

    companion object {
        const val ACTION_CONFIGURE = "app.mutual.ble.CONFIGURE"
        const val ACTION_STOP = "app.mutual.ble.STOP"
        const val EXTRA_SCAN_PERIOD = "scanPeriodSeconds"
        const val EXTRA_SCAN_WINDOW = "scanWindowSeconds"
        const val EXTRA_RSSI_THRESHOLD = "rssiThresholdDbm"

        private const val CHANNEL_ID = "mutual-discovery"
        private const val NOTIFICATION_ID = 1
        private const val ROTATE_PAUSE_MS = 400L
        private const val TAG = "MutualBle"

        /** Whether discovery should restart after a reboot (SPEC §14.5). */
        fun setRestartAfterBoot(context: Context, enabled: Boolean) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("restart", enabled)
                .apply()
        }

        fun shouldRestartAfterBoot(context: Context): Boolean =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean("restart", false)

        private const val PREFS = "mutual-ble-service"
    }
}
