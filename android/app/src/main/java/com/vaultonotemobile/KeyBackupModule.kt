package com.vaultonotemobile

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.auth.blockstore.Blockstore
import com.google.android.gms.auth.blockstore.DeleteBytesRequest
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest
import com.google.android.gms.auth.blockstore.StoreBytesData

/**
 * Keeps the end-to-end encryption key in Google Block Store, so a reinstall or a new
 * phone restores it without the user typing the recovery key.
 *
 * Block Store data survives uninstall/reinstall when Google backup is on, and moves
 * to a new phone in the device restore flow. Cloud backup is requested only when
 * Google can end-to-end encrypt it with the phone's screen lock; otherwise the key
 * stays on this device (still kept across reinstalls) and is never uploaded in clear.
 */
class KeyBackupModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "KeyBackup"

    private val client by lazy { Blockstore.getClient(reactContext) }

    private fun keyFor(account: String) = "vaulto.e2ee.$account"

    /** { available: Block Store usable, cloudEncrypted: E2EE cloud backup possible } */
    @ReactMethod
    fun getStatus(promise: Promise) {
        try {
            client.isEndToEndEncryptionAvailable
                .addOnSuccessListener { e2ee ->
                    promise.resolve(Arguments.createMap().apply {
                        putBoolean("available", true)
                        putBoolean("cloudEncrypted", e2ee == true)
                    })
                }
                .addOnFailureListener {
                    promise.resolve(Arguments.createMap().apply {
                        putBoolean("available", false)
                        putBoolean("cloudEncrypted", false)
                    })
                }
        } catch (error: Exception) {
            promise.resolve(Arguments.createMap().apply {
                putBoolean("available", false)
                putBoolean("cloudEncrypted", false)
            })
        }
    }

    /** Stores the secret; resolves { cloud: whether it is also backed up to the cloud }. */
    @ReactMethod
    fun store(account: String, secret: String, promise: Promise) {
        try {
            client.isEndToEndEncryptionAvailable
                .addOnCompleteListener { e2eeTask ->
                    val cloud = e2eeTask.isSuccessful && e2eeTask.result == true
                    val request = StoreBytesData.Builder()
                        .setBytes(secret.toByteArray(Charsets.UTF_8))
                        .setKey(keyFor(account))
                        .setShouldBackupToCloud(cloud)
                        .build()
                    client.storeBytes(request)
                        .addOnSuccessListener {
                            promise.resolve(Arguments.createMap().apply { putBoolean("cloud", cloud) })
                        }
                        .addOnFailureListener { promise.reject("KEY_BACKUP_STORE_FAILED", it) }
                }
        } catch (error: Exception) {
            promise.reject("KEY_BACKUP_STORE_FAILED", error)
        }
    }

    /** Resolves the stored secret, or null when there is none. */
    @ReactMethod
    fun retrieve(account: String, promise: Promise) {
        try {
            val request = RetrieveBytesRequest.Builder()
                .setKeys(listOf(keyFor(account)))
                .build()
            client.retrieveBytes(request)
                .addOnSuccessListener { response ->
                    val data = response.blockstoreDataMap[keyFor(account)]
                    promise.resolve(data?.bytes?.toString(Charsets.UTF_8))
                }
                .addOnFailureListener { promise.resolve(null) }
        } catch (error: Exception) {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun remove(account: String, promise: Promise) {
        try {
            val request = DeleteBytesRequest.Builder()
                .setKeys(listOf(keyFor(account)))
                .build()
            client.deleteBytes(request)
                .addOnSuccessListener { promise.resolve(true) }
                .addOnFailureListener { promise.resolve(false) }
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }
}
