package `in`.mutual.ble

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts discovery after a reboot, but only if the user had it on (SPEC.md §14.5).
 *
 * A phone that restarts discovery after the user paused it would be a privacy failure, so
 * the flag is written when the user starts or stops discovery and read here. Advertising
 * still only resumes for slots that are actually in the schedule the app handed down; if
 * the reboot outlasted the schedule, the service starts, finds nothing for the current slot
 * and shows the "open Mutual" notification instead of inventing an EID.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!MutualBleService.shouldRestartAfterBoot(context)) return

        context.startForegroundService(
            Intent(context, MutualBleService::class.java)
                .setAction(MutualBleService.ACTION_CONFIGURE),
        )
    }
}
