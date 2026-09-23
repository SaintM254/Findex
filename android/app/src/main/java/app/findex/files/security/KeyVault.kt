package app.findex.files.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Ciphertext only in preferences; the non-exportable encryption key never leaves Android Keystore. */
class KeyVault(context: Context) {
    private val preferences = context.getSharedPreferences("findex-vault", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setKeySize(256).build())
        }.generateKey()
    }
    @Synchronized fun save(provider: String, value: String) {
        require(provider in setOf("openai", "anthropic", "gemini"))
        if (value.isBlank()) { preferences.edit().remove(provider).commit(); return }
        require(value.length <= 1024) { "This API key is too long." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(value.trim().toByteArray(Charsets.UTF_8))
        val encoded = "1:" + Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP)
        check(preferences.edit().putString(provider, encoded).commit()) { "The API key could not be saved." }
    }
    fun has(provider: String): Boolean = !preferences.getString(provider, null).isNullOrBlank()
    @Synchronized fun read(provider: String): String? {
        val value = preferences.getString(provider, null) ?: return null
        return try {
            val parts = value.split(':'); require(parts.size == 3 && parts[0] == "1")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[1], Base64.NO_WRAP))) }
            String(cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) { preferences.edit().remove(provider).commit(); null }
    }
    companion object { private const val ALIAS = "findex.personal-api.v1" }
}
