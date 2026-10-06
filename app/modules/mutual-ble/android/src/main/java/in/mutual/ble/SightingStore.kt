package `in`.mutual.ble

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Per-(own EID, heard EID, interval) window counts, persisted on device (SPEC.md §14.4).
 *
 * Three rules shape this class, and each is a privacy rule rather than an implementation
 * choice:
 *
 *  - **RSSI never leaves.** The threshold is applied as a sighting arrives; only the count
 *    of qualifying windows is stored. There is nowhere to read a dBm value from afterwards.
 *  - **No timestamps.** A sighting is identified by its 15-minute interval, which is all the
 *    coarse time chip needs. An exact time would let a compromised device, or a future
 *    careless feature, reconstruct a movement trace.
 *  - **Counts are per interval and never summed across intervals** (SPEC §6.13: "the best
 *    single sighting counts"), so carrying several advertisers buys an attacker nothing.
 *
 * Draining is destructive by contract: the raw pairs must not outlive the upload.
 */
class SightingStore(context: Context) {

    private val prefs =
        context.getSharedPreferences("mutual-ble-sightings", Context.MODE_PRIVATE)

    /** key -> windows. The key encodes day, interval and both ids; see [key]. */
    private val counts = linkedMapOf<String, Int>()

    init {
        load()
    }

    private fun key(day: String, interval: Int, own: ByteArray, heard: ByteArray): String =
        "$day|$interval|${own.toHex()}|${heard.toHex()}"

    /**
     * Records one scan window in which [heard] was received at or above the threshold while
     * [own] was being advertised.
     *
     * Call once per scan window per peer, not once per advertisement packet: a phone sends
     * many packets per window and they must not inflate the count.
     */
    @Synchronized
    fun addWindow(day: String, interval: Int, own: ByteArray, heard: ByteArray) {
        if (interval == 0 || interval == BleConstants.INTERVALS_PER_DAY - 1) {
            // Midnight rule (SPEC §6.13): nothing is recorded in the first or last interval,
            // so both devices are certain to be on the same local day.
            return
        }
        val k = key(day, interval, own, heard)
        val next = ((counts[k] ?: 0) + 1).coerceAtMost(BleConstants.MAX_WINDOWS)
        counts[k] = next
        persist()
    }

    /** Everything recorded so far, without clearing it. For the debug screen only. */
    @Synchronized
    fun peek(): List<SightingRecord> = counts.entries.mapNotNull { (k, windows) ->
        val parts = k.split("|")
        if (parts.size != 4) return@mapNotNull null
        val interval = parts[1].toIntOrNull() ?: return@mapNotNull null
        SightingRecord(parts[0], interval, parts[2].fromHex(), parts[3].fromHex(), windows)
    }

    /**
     * Returns everything and clears it, in one atomic step. The caller is committing to
     * uploading or discarding what it receives: a drain that returned without clearing
     * would leave the raw pairs on the device past the upload (SPEC §14.4).
     */
    @Synchronized
    fun drain(): List<SightingRecord> {
        val out = peek()
        counts.clear()
        prefs.edit().remove(STORE_KEY).apply()
        return out
    }

    @Synchronized
    fun clear() {
        counts.clear()
        prefs.edit().remove(STORE_KEY).apply()
    }

    private fun persist() {
        val array = JSONArray()
        for ((k, v) in counts) {
            array.put(JSONObject().put("k", k).put("w", v))
        }
        prefs.edit().putString(STORE_KEY, array.toString()).apply()
    }

    private fun load() {
        val raw = prefs.getString(STORE_KEY, null) ?: return
        runCatching {
            val array = JSONArray(raw)
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                counts[item.getString("k")] = item.getInt("w")
            }
        }
        // A corrupt store is dropped rather than crashing the service: losing a night's
        // sightings costs one digest, and crashing on boot costs every night after it.
    }

    private companion object {
        const val STORE_KEY = "counts"
    }
}

internal fun ByteArray.toHex(): String {
    val out = StringBuilder(size * 2)
    for (b in this) out.append("%02x".format(b))
    return out.toString()
}

internal fun String.fromHex(): ByteArray {
    val out = ByteArray(length / 2)
    for (i in out.indices) {
        out[i] = substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
    return out
}
