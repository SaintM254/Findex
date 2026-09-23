package app.findex.files.security

import android.content.Context
import org.json.JSONObject

class PreferencesStore(context: Context) {
    private val shared = context.getSharedPreferences("findex-preferences", Context.MODE_PRIVATE)
    val vault = KeyVault(context)
    fun read(): JSONObject {
        val stored = runCatching { JSONObject(shared.getString("preferences", "{}") ?: "{}") }.getOrElse { JSONObject() }
        val provider = stored.optString("provider", "openai")
        return JSONObject().put("theme", stored.optString("theme", "system"))
            .put("provider", provider).put("model", stored.optString("model", "gpt-5-mini"))
            .put("metadataConsent", stored.optBoolean("metadataConsent", false))
            .put("showHidden", stored.optBoolean("showHidden", false)).put("hasKey", vault.has(provider))
    }
    fun save(input: JSONObject, apiKey: String?) {
        val provider = input.optString("provider", "openai")
        val theme = input.optString("theme", "system")
        val model = input.optString("model").trim()
        require(provider in setOf("openai", "anthropic", "gemini")) { "Choose a supported AI provider." }
        require(theme in setOf("light", "dark", "system")) { "Choose a supported theme." }
        require(model.isNotEmpty() && model.length <= 120) { "Enter a valid model name." }
        if (apiKey != null) vault.save(provider, apiKey)
        val consent = input.optBoolean("metadataConsent", false)
        check(!consent || vault.has(provider)) { "Save an API key before allowing metadata sharing." }
        val safe = JSONObject().put("provider", provider).put("model", model).put("theme", theme)
            .put("metadataConsent", consent).put("showHidden", input.optBoolean("showHidden", false))
        check(shared.edit().putString("preferences", safe.toString()).commit()) { "Preferences could not be saved." }
    }
}
