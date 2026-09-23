package app.findex.files.security

import android.content.Context
import app.findex.files.storage.StorageEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.TimeUnit

class AgentClient(private val context: Context) {
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS)
        .callTimeout(55, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    suspend fun plan(query: String, system: String, timezone: String): JSONObject = withContext(Dispatchers.IO) {
        require(query.isNotBlank() && query.length <= 1000)
        require(system.length <= 8000)
        val store = PreferencesStore(context); val preferences = store.read()
        check(preferences.getBoolean("metadataConsent")) { "Allow metadata sharing in Settings before sending a request." }
        val provider = preferences.getString("provider"); val model = resolveModel(preferences.getString("model"))
        val key = store.vault.read(provider) ?: error("Add an API key in Settings first.")
        val engine = StorageEngine.get(context)
        check(engine.hasPermission()) { "Storage permission is required." }
        val contextFiles = engine.catalog.planningContext()
        // Path locators are local capabilities, not provider metadata. Exchange
        // per-request opaque labels and translate only allowlisted folder fields.
        val labels = contextFiles.mapIndexed { index, item -> engine.uiId(item) to "entry-$index" }.toMap()
        val localIds = labels.entries.associate { it.value to it.key }
        val metadata = contextFiles.map { item ->
            val parent = engine.toUi(item).optString("parentId", "root")
            JSONObject().put("id", labels.getValue(engine.uiId(item))).put("name", item.name)
                .put("parentId", if (parent == "root") "root" else labels[parent] ?: "outside-snapshot").put("kind", item.kind)
                .put("category", item.category).put("size", item.size).put("modifiedAt", item.modifiedAt)
        }
        val payload = JSONObject().put("now", Instant.now().toString()).put("timezone", timezone.take(80)).put("query", query).put("files", JSONArray(metadata)).toString()
        val request: Request
        when (provider) {
            "openai" -> {
                val body = JSONObject().put("model", model).put("max_completion_tokens", 1024)
                if (model.startsWith("gpt-5") || model.startsWith("gpt-6")) body.put("reasoning_effort", "low")
                body.put("response_format", JSONObject().put("type", "json_object"))
                    .put("messages", JSONArray().put(JSONObject().put("role", "system").put("content", system)).put(JSONObject().put("role", "user").put("content", payload)))
                request = Request.Builder().url("https://api.openai.com/v1/chat/completions").header("Authorization", "Bearer $key").post(body.toString().toRequestBody(JSON)).build()
            }
            "anthropic" -> {
                val body = JSONObject().put("model", model).put("max_tokens", 1000).put("temperature", 0).put("system", system)
                    .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", payload)))
                request = Request.Builder().url("https://api.anthropic.com/v1/messages").header("x-api-key", key).header("anthropic-version", "2023-06-01").post(body.toString().toRequestBody(JSON)).build()
            }
            "gemini" -> {
                val url = "https://generativelanguage.googleapis.com/v1beta/models/".toHttpUrl().newBuilder().addPathSegment("$model:generateContent").build()
                val body = JSONObject().put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
                    .put("contents", JSONArray().put(JSONObject().put("parts", JSONArray().put(JSONObject().put("text", payload)))))
                    .put("generationConfig", JSONObject().put("responseMimeType", "application/json").put("maxOutputTokens", 1024).put("temperature", 0))
                request = Request.Builder().url(url).header("x-goog-api-key", key).post(body.toString().toRequestBody(JSON)).build()
            }
            else -> error("Unsupported provider.")
        }
        client.newCall(request).execute().use { response ->
            check(response.isSuccessful) {
                when (response.code) {
                    401, 403 -> "Your API key was not accepted. Check it in Settings."
                    404 -> "Your provider could not find the model '$model'. Update the model name in Settings (the current defaults are listed there). No files were changed."
                    else -> "Your provider returned error ${response.code}. No files were changed."
                }
            }
            val source = response.body?.source() ?: error("Your provider returned an empty response.")
            check(!source.request(2L * 1024 * 1024 + 1)) { "The provider response was unexpectedly large." }
            val data = JSONObject(source.readUtf8())
            val text = when (provider) {
                "openai" -> data.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
                "anthropic" -> data.getJSONArray("content").let { parts -> (0 until parts.length()).map { parts.getJSONObject(it) }.first { it.optString("type") == "text" }.getString("text") }
                else -> data.getJSONArray("candidates").getJSONObject(0).getJSONObject("content").getJSONArray("parts").getJSONObject(0).getString("text")
            }
            val cleaned = text.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
            // Parsing is not execution: the UI validates the complete allowlisted schema and asks for confirmation.
            JSONObject(cleaned).also { plan ->
                if (plan.has("sourceFolder")) {
                    val label = plan.getString("sourceFolder")
                    plan.put("sourceFolder", localIds[label] ?: error("Your provider named a folder outside this request's index snapshot."))
                }
                plan.optJSONObject("filter")?.let { filter ->
                    if (filter.has("parentId")) {
                        val label = filter.getString("parentId")
                        filter.put("parentId", if (label == "root") "root" else localIds[label] ?: error("Your provider named an unknown folder."))
                    }
                }
            }
        }
    }
    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
        private val RETIRED = mapOf(
            "gpt-4.1-mini" to "gpt-5-mini", "gpt-4o-mini" to "gpt-5-mini",
            "claude-sonnet-4-20250514" to "claude-haiku-4-5", "claude-3-5-haiku-20241022" to "claude-haiku-4-5",
            "claude-3-haiku-20240307" to "claude-haiku-4-5", "gemini-1.5-flash" to "gemini-2.5-flash", "gemini-2.0-flash" to "gemini-2.5-flash"
        )
        private fun resolveModel(model: String) = RETIRED[model] ?: model
    }
}
