package app.mutual.ble

/**
 * The advertisement schedule handed down from TypeScript (SPEC.md §14.5).
 *
 * This module never derives an ephemeral id. It is given `(day, interval, eid)` triples and
 * advertises them at the right time; when it runs out it stops advertising and asks the
 * user to open Mutual. That is a privacy rule, not a convenience: daily keys and ephemeral
 * private keys stay in TypeScript, so there is no cryptography in Kotlin at all
 * (CLAUDE.md invariant 7).
 *
 * @param day local day, `YYYY-MM-DD`
 * @param interval 15-minute slot index, 0..95
 * @param eid the 32-byte ephemeral id to advertise during that slot
 */
data class ScheduleEntry(
    val day: String,
    val interval: Int,
    val eid: ByteArray,
) {
    // ByteArray makes the generated equals/hashCode reference-based, which would quietly
    // break schedule replacement. Both are written out.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ScheduleEntry) return false
        return day == other.day && interval == other.interval && eid.contentEquals(other.eid)
    }

    override fun hashCode(): Int =
        (day.hashCode() * 31 + interval) * 31 + eid.contentHashCode()
}

/** One aggregated sighting, as drained by TypeScript. No RSSI value, no timestamp. */
data class SightingRecord(
    val day: String,
    val interval: Int,
    val ownEid: ByteArray,
    val heardEid: ByteArray,
    /** Scan windows in which the peer was heard at or above the RSSI threshold, 1..15. */
    val windows: Int,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SightingRecord) return false
        return day == other.day &&
            interval == other.interval &&
            ownEid.contentEquals(other.ownEid) &&
            heardEid.contentEquals(other.heardEid) &&
            windows == other.windows
    }

    override fun hashCode(): Int {
        var result = day.hashCode()
        result = 31 * result + interval
        result = 31 * result + ownEid.contentHashCode()
        result = 31 * result + heardEid.contentHashCode()
        result = 31 * result + windows
        return result
    }
}

/** Protocol and radio constants, mirroring `packages/protocol-spec/constants.json`. */
object BleConstants {
    /** Bluetooth SIG test company id. Not for a shipping product (decision D17). */
    const val COMPANY_ID = 0xFFFF

    /** `magic(0x4D 0x55) || payload_version(1) || EID(32)` = 35 bytes (SPEC §14.2). */
    val MAGIC = byteArrayOf(0x4D, 0x55)
    const val PAYLOAD_VERSION: Byte = 1
    const val EID_BYTES = 32
    const val PAYLOAD_BYTES = 35

    const val INTERVALS_PER_DAY = 96
    const val INTERVAL_MINUTES = 15

    /** The highest window count a 15-minute interval can produce at a 60 s scan period. */
    const val MAX_WINDOWS = 15
}

/** Which advertisement layout the radio is using (SPEC §14.2, decision D23). */
enum class AdvertiseLayout {
    /** BLE 5 extended advertising carrying all 35 bytes. Preferred. */
    EXTENDED,

    /** Neither worked on this device: advertising is off and the app must say so. */
    UNSUPPORTED,
}

/** Builds and parses the manufacturer-data payload. Pure functions, so they are unit-testable. */
object Payload {
    /** The full 35-byte payload for extended advertising. */
    fun full(eid: ByteArray): ByteArray {
        require(eid.size == BleConstants.EID_BYTES) { "EID must be 32 bytes" }
        return BleConstants.MAGIC + byteArrayOf(BleConstants.PAYLOAD_VERSION) + eid
    }

    /** The scan filter prefix: magic + version, which every Mutual advertisement starts with. */
    fun filterPrefix(): ByteArray = BleConstants.MAGIC + byteArrayOf(BleConstants.PAYLOAD_VERSION)

    fun filterMask(): ByteArray = byteArrayOf(-1, -1, -1)

    /**
     * Extracts a 32-byte EID from received manufacturer data, or null for anything that is
     * not exactly Mutual's 35-byte payload.
     *
     * The length check is not cosmetic. Without it a crafted advertisement of any size
     * carrying Mutual's magic produced an "EID" of that size, and the only thing stopping
     * it from being counted was a `length !== 32` test on the TypeScript side. A radio
     * parser should not depend on a later layer to reject what it hands over.
     */
    fun extractEid(data: ByteArray?): ByteArray? {
        if (data == null) return null
        val prefix = filterPrefix()
        if (data.size != prefix.size + BleConstants.EID_BYTES) return null
        for (i in prefix.indices) if (data[i] != prefix[i]) return null
        return data.copyOfRange(prefix.size, data.size)
    }
}
