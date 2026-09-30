package org.tochat.app
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object ProfileKey {
    fun get(context: Context): String {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "tochat.profile.key.v1"
        if (!ks.containsAlias(alias)) {
            val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            g.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            g.generateKey()
        }
        val key = ks.getKey(alias, null) as SecretKey
        val prefs = context.getSharedPreferences("tochat", Context.MODE_PRIVATE)
        val saved = prefs.getString("profileSecret", null)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val bytes: ByteArray
        if (saved != null) {
            val j = JSONObject(saved)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(j.getString("iv"), Base64.NO_WRAP)))
            bytes = cipher.doFinal(Base64.decode(j.getString("data"), Base64.NO_WRAP))
        } else {
            // If a key vanished, never silently replace an existing Tox identity.
            check(!java.io.File(context.filesDir, "identity.tox").exists()) { "身份密钥缺失，未替换原身份" }
            bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val encrypted = cipher.doFinal(bytes)
            val j = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            check(prefs.edit().putString("profileSecret", j.toString()).commit()) { "无法保存身份密钥" }
        }
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
