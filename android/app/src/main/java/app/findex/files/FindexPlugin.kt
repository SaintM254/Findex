package app.findex.files

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.FileObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import app.findex.files.security.AgentClient
import app.findex.files.security.PreferencesStore
import app.findex.files.storage.SharedFileProvider
import app.findex.files.storage.StorageEngine
import app.findex.files.storage.strings
import app.findex.files.viewers.MediaViewerActivity
import app.findex.files.viewers.PdfViewerActivity
import app.findex.files.workers.IndexWorker
import app.findex.files.workers.OperationWorker
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

@CapacitorPlugin(name = "Findex", permissions = [Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE], alias = "legacyStorage")])
class FindexPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val engine get() = StorageEngine.get(context)
    private val preferences get() = PreferencesStore(context)
    @Volatile private var currentOperation: UUID? = null
    private var lastResumeScan = 0L
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listingSequence = java.util.concurrent.atomic.AtomicLong()
    private var watchedPath: String? = null
    private var directoryObserver: FileObserver? = null
    private var pendingDirectoryEvent: Runnable? = null
    private val finishedIndexWork = mutableSetOf<UUID>()

    override fun load() {
        activity.runOnUiThread {
            WindowCompat.setDecorFitsSystemWindows(activity.window, false)
            ViewCompat.setOnApplyWindowInsetsListener(bridge.webView) { view, insets ->
                val system = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
                val density = view.resources.displayMetrics.density
                notifyListeners("insets", JSObject().put("top", system.top / density).put("bottom", maxOf(system.bottom, ime.bottom) / density), true)
                insets
            }
            ViewCompat.requestApplyInsets(bridge.webView)
            WorkManager.getInstance(context).getWorkInfosByTagLiveData(IndexWorker.TAG).observe(activity) { work ->
                val completed = work.filter { it.state == WorkInfo.State.SUCCEEDED }.map { it.id }
                val changed = completed.any { it !in finishedIndexWork }
                finishedIndexWork.addAll(completed) // Consume every completed id, not only the first.
                if (changed) notifyListeners("indexUpdated", JSObject())
            }
            WorkManager.getInstance(context).getWorkInfosByTagLiveData(OperationWorker.TAG).observe(activity) { work ->
                val active = work.firstOrNull { !it.state.isFinished }
                if (active != null) currentOperation = active.id
            }
        }
    }
    private fun io(call: PluginCall, action: suspend () -> JSONObject?) {
        scope.launch {
            try { val result = action(); if (result == null) call.resolve() else call.resolve(JSObject.fromJSONObject(result)) } catch (_: CancellationException) { call.reject("Operation cancelled. Completed items are kept; incomplete copies are cleaned up.") } catch (error: Exception) { call.reject(error.message ?: "Findex could not complete this request.") }
        }
    }
    private suspend fun emitProgress(progress: StorageEngine.Progress, cancellable: Boolean = false) = withContext(Dispatchers.Main) {
        notifyListeners("progress", JSObject().put("completed", progress.completed).put("total", progress.total).put("label", progress.label).put("bytes", progress.bytes).put("cancellable", cancellable))
    }
    private fun required(call: PluginCall, key: String): String = call.getString(key)?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("Missing $key.")

    private fun thumbnail(value: JSONObject): JSONObject {
        if (value.optString("category") == "images" && value.isNull("trashedAt")) value.put("previewUrl", SharedFileProvider.uri(context, value.getString("id"), true).toString())
        return value
    }
    @PluginMethod fun load(call: PluginCall) = io(call) {
        val options = preferences.read()
        withContext(Dispatchers.Main) { applyTheme(options.getString("theme")) }
        val allowed = engine.hasPermission()
        // No recursive scan and no whole-database JSON transfer on startup/resume.
        JSONObject().put("files", JSONArray(if (allowed) engine.catalog.navigation().map { thumbnail(engine.toUi(it)) } else emptyList<JSONObject>()))
            .put("storage", engine.storage()).put("permission", allowed).put("preferences", options)
            .put("summary", if (allowed) engine.catalog.dashboard() else JSONObject())
    }
    @PluginMethod fun listFiles(call: PluginCall) {
        val sequence = listingSequence.incrementAndGet()
        io(call) {
        val query = call.data
        val result = engine.catalog.browse(query)
        val items = result.getJSONArray("files")
        for (index in 0 until items.length()) thumbnail(items.getJSONObject(index))
        if (query.optString("section") in setOf("all", "folder")) {
            val path = engine.resolve(if (query.optString("section") == "all") "root" else required(call, "id")).path
            withContext(Dispatchers.Main) { if (listingSequence.get() == sequence) watchDirectory(path) }
        }
        result
        }
    }
    @PluginMethod fun inspectFiles(call: PluginCall) = io(call) {
        val ids = call.getArray("ids")?.strings() ?: emptyList()
        require(ids.size <= 500) { "Inspect files in bounded batches." }
        val detail = call.getBoolean("details", false) ?: false
        JSONObject().put("files", JSONArray(ids.map { id ->
            val item = if (detail) engine.details(id) else engine.record(id)
            thumbnail(engine.toUi(item, detail).put("id", id)).also { value ->
                if (detail && item.kind == "folder" && item.trashedAt == null) value.put("childCount", engine.resolve(id).list()?.size ?: JSONObject.NULL)
            }
        }))
    }
    @PluginMethod fun planningContext(call: PluginCall) = io(call) {
        JSONObject().put("files", JSONArray(engine.catalog.planningContext().map { engine.toUi(it) }))
    }
    @PluginMethod fun ensureFolderPath(call: PluginCall) = io(call) {
        JSONObject().put("id", engine.ensureFolderPath(required(call, "path"), required(call, "parentId")))
    }
    @Suppress("DEPRECATION")
    private fun watchDirectory(path: String) {
        if (watchedPath == path) return
        directoryObserver?.stopWatching()
        pendingDirectoryEvent?.let { mainHandler.removeCallbacks(it) }
        watchedPath = path
        directoryObserver = object : FileObserver(path, FileObserver.CREATE or FileObserver.DELETE or FileObserver.MOVED_FROM or FileObserver.MOVED_TO or FileObserver.CLOSE_WRITE or FileObserver.ATTRIB or FileObserver.DELETE_SELF or FileObserver.MOVE_SELF) {
            override fun onEvent(event: Int, name: String?) {
                if (name?.startsWith(".findex-") == true) return
                engine.catalog.invalidate(path)
                pendingDirectoryEvent?.let { mainHandler.removeCallbacks(it) }
                val task = Runnable { notifyListeners("directoryChanged", JSObject().put("path", path)) }
                pendingDirectoryEvent = task
                mainHandler.postDelayed(task, 100)
            }
        }.also { it.startWatching() }
    }
    @PluginMethod fun requestPermission(call: PluginCall) {
        if (engine.hasPermission()) { call.resolve(); return }
        if (Build.VERSION.SDK_INT >= 30) {
            try { startActivityForResult(call, Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}")), "permissionReturned") } catch (_: ActivityNotFoundException) { startActivityForResult(call, Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "permissionReturned") }
        } else if (getPermissionState("legacyStorage") != PermissionState.GRANTED) requestPermissionForAlias("legacyStorage", call, "legacyPermissionReturned")
        else call.resolve()
    }
    @ActivityCallback private fun permissionReturned(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
        call?.resolve(); if (engine.hasPermission()) IndexWorker.schedule(context)
        notifyListeners("indexUpdated", JSObject())
    }
    @PermissionCallback private fun legacyPermissionReturned(call: PluginCall) {
        call.resolve(); if (engine.hasPermission()) IndexWorker.schedule(context)
        notifyListeners("indexUpdated", JSObject())
    }
    @PluginMethod fun createFolder(call: PluginCall) = io(call) { JSONObject().put("id", engine.createFolder(required(call, "name"), required(call, "parentId"))) }
    @PluginMethod fun rename(call: PluginCall) = io(call) { engine.rename(required(call, "id"), required(call, "name")); null }
    @PluginMethod fun setFavorite(call: PluginCall) = io(call) { engine.favorite(required(call, "id"), call.getBoolean("favorite", false) ?: false); null }
    @PluginMethod fun reindex(call: PluginCall) = io(call) { engine.scan { emitProgress(it) }; null }
    @PluginMethod fun analyze(call: PluginCall) = io(call) { engine.analyze { emitProgress(it) } }
    @PluginMethod fun operate(call: PluginCall) = io(call) {
        val action = required(call, "action"); val ids = call.getArray("ids")?.strings() ?: error("Select files first.")
        val jobId = engine.newJob(action, ids, call.getString("destination"))
        val work = OneTimeWorkRequestBuilder<OperationWorker>().setInputData(workDataOf("jobId" to jobId)).addTag(OperationWorker.TAG).build()
        val manager = WorkManager.getInstance(context)
        currentOperation = work.id
        manager.enqueueUniqueWork("findex-file-operations", ExistingWorkPolicy.APPEND_OR_REPLACE, work)
        val info = manager.getWorkInfoByIdFlow(work.id).filterNotNull().onEach { state ->
            val data = state.progress
            if (!state.state.isFinished) emitProgress(StorageEngine.Progress(data.getInt("completed", 0), data.getInt("total", ids.size), data.getString("label") ?: "Preparing your files", data.getLong("bytes", 0)), true)
        }.first { it.state.isFinished }
        if (currentOperation == work.id) currentOperation = null
        check(info.state == WorkInfo.State.SUCCEEDED) { if (info.state == WorkInfo.State.CANCELLED) "Operation cancelled. Completed items are kept; incomplete copies are cleaned up." else info.outputData.getString("error") ?: "The operation could not be completed." }
        JSONObject().put("ids", JSONArray(engine.takeJobResult(jobId)))
    }
    @PluginMethod fun exitApp(call: PluginCall) { call.resolve(); activity.runOnUiThread { activity.finish() } }
    @PluginMethod fun cancelOperation(call: PluginCall) { currentOperation?.let { WorkManager.getInstance(context).cancelWorkById(it) }; call.resolve() }
    @PluginMethod fun pickFiles(call: PluginCall) {
        if (!engine.hasPermission()) { call.reject("Allow file access first."); return }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivityForResult(call, intent, "filesPicked")
    }
    @ActivityCallback private fun filesPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) { call.reject("No files selected."); return }
        io(call) {
            val data = result.data ?: error("The file picker returned no files.")
            val uris = data.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } } ?: listOfNotNull(data.data)
            engine.importUris(uris, required(call, "parentId")) { emitProgress(it) }; null
        }
    }
    @PluginMethod fun readFile(call: PluginCall) = io(call) {
        val id = required(call, "id"); val record = engine.record(id)
        check(record.trashedAt == null && record.kind == "file") { "This file is not available." }
        engine.resolve(id)
        JSONObject().put("uri", SharedFileProvider.uri(context, id).toString())
    }
    @PluginMethod fun openFile(call: PluginCall) = io(call) {
        val id = required(call, "id"); val file = engine.record(id)
        check(file.trashedAt == null && file.kind == "file") { "This file cannot be opened." }
        check(engine.resolve(id).isFile) { "This file is no longer on the device." }
        val intent = when {
            file.extension == "pdf" -> Intent(context, PdfViewerActivity::class.java).putExtra("fileId", id)
            file.category in setOf("images", "audio", "videos") -> Intent(context, MediaViewerActivity::class.java).putExtra("fileId", id)
            else -> Intent(Intent.ACTION_VIEW).setDataAndType(SharedFileProvider.uri(context, id), file.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        // Do not wrap ACTION_VIEW in createChooser: Android's resolver retains Just once / Always defaults.
        withContext(Dispatchers.Main) { try { activity.startActivity(intent) } catch (_: ActivityNotFoundException) { error("No installed app can open this file type.") } }
        null
    }
    @PluginMethod fun savePreferences(call: PluginCall) = io(call) {
        val value = call.getObject("preferences") ?: error("Preferences are missing.")
        preferences.save(value, call.getString("apiKey"))
        withContext(Dispatchers.Main) { applyTheme(value.optString("theme", "system")) }
        null
    }
    @PluginMethod fun askAgent(call: PluginCall) = io(call) {
        val plan = AgentClient(context).plan(required(call, "prompt"), required(call, "system"), call.getString("timezone") ?: "UTC")
        JSONObject().put("plan", plan)
    }
    private fun applyTheme(theme: String) {
        val mode = when (theme) { "dark" -> AppCompatDelegate.MODE_NIGHT_YES; "light" -> AppCompatDelegate.MODE_NIGHT_NO; else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM }
        if (AppCompatDelegate.getDefaultNightMode() != mode) AppCompatDelegate.setDefaultNightMode(mode)
        val dark = theme == "dark" || (theme == "system" && context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES)
        WindowCompat.getInsetsController(activity.window, bridge.webView).apply { isAppearanceLightStatusBars = !dark; isAppearanceLightNavigationBars = !dark }
    }
    override fun handleOnResume() {
        if (System.currentTimeMillis() - lastResumeScan > 15 * 60_000) {
            lastResumeScan = System.currentTimeMillis()
            scope.launch { if (engine.hasPermission()) IndexWorker.schedule(context) }
        }
    }
    override fun handleOnDestroy() { directoryObserver?.stopWatching(); pendingDirectoryEvent?.let { mainHandler.removeCallbacks(it) }; scope.cancel() }
}
