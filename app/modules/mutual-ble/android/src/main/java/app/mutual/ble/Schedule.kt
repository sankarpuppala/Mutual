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

    /** Legacy advertisements carry at most 27 bytes of manufacturer data (SPEC §14.2, D23). */
    const val LEGACY_MANUFACTURER_LIMIT = 27
    const val LEGACY_EID_HEAD = 24
    val LEGACY_EID_TAIL = EID_BYTES - LEGACY_EID_HEAD

    const val INTERVALS_PER_DAY = 96
    const val INTERVAL_MINUTES = 15

    /** The highest window count a 15-minute interval can produce at a 60 s scan period. */
    const val MAX_WINDOWS = 15
}

/** Which advertisement layout the radio is using (SPEC §14.2, decision D23). */
enum class AdvertiseLayout {
    /** BLE 5 extended advertising carrying all 35 bytes. Preferred. */
    EXTENDED,

    /** Legacy advertisement with `EID[0:24]`, scan response with `EID[24:32]`. */
    LEGACY_SPLIT,

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

    /** The advertisement half of the legacy split layout: magic, version, `EID[0:24]`. */
    fun legacyHead(eid: ByteArray): ByteArray {
        require(eid.size == BleConstants.EID_BYTES) { "EID must be 32 bytes" }
        return BleConstants.MAGIC +
            byteArrayOf(BleConstants.PAYLOAD_VERSION) +
            eid.copyOfRange(0, BleConstants.LEGACY_EID_HEAD)
    }

    /** The scan-response half of the legacy split layout: `EID[24:32]`. */
    fun legacyTail(eid: ByteArray): ByteArray {
        require(eid.size == BleConstants.EID_BYTES) { "EID must be 32 bytes" }
        return eid.copyOfRange(BleConstants.LEGACY_EID_HEAD, BleConstants.EID_BYTES)
    }

    /** The scan filter prefix: magic + version, which every Mutual advertisement starts with. */
    fun filterPrefix(): ByteArray = BleConstants.MAGIC + byteArrayOf(BleConstants.PAYLOAD_VERSION)

    fun filterMask(): ByteArray = byteArrayOf(-1, -1, -1)

    /**
     * Extracts an EID from received manufacturer data.
     *
     * Returns the 32-byte id for a full payload, the 24-byte head for a legacy
     * advertisement, or null for anything else -- including a payload of some other length.
     *
     * The length check is not cosmetic. Without it a crafted advertisement of any size
     * carrying Mutual's magic produced a "EID" of that size, and the only thing stopping it
     * from being counted was a `length !== 32` test on the TypeScript side. A radio parser
     * should not depend on a later layer to reject what it hands over.
     */
    fun extractEid(data: ByteArray?): ByteArray? {
        if (data == null) return null
        val prefix = filterPrefix()
        val full = prefix.size + BleConstants.EID_BYTES
        val head = prefix.size + BleConstants.LEGACY_EID_HEAD
        if (data.size != full && data.size != head) return null
        for (i in prefix.indices) if (data[i] != prefix[i]) return null
        return data.copyOfRange(prefix.size, data.size)
    }
}
