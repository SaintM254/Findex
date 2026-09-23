package app.findex.files.storage

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.os.StatFs
import android.provider.OpenableColumns
import android.system.Os
import android.webkit.MimeTypeMap
import androidx.core.content.ContextCompat
import app.findex.files.data.FileRecord
import app.findex.files.data.FindexDatabase
import app.findex.files.data.SnapshotRecord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import java.util.UUID
import kotlin.coroutines.coroutineContext

/** A single serialized writer protects metadata and filesystem changes from competing workers. */
class StorageEngine private constructor(private val context: Context) {
    val database = FindexDatabase.get(context)
    private val dao = database.files()
    @Volatile var roots: List<File> = discoverRoots()
        private set
    private fun discoverRoots(): List<File> = buildList {
        add(Environment.getExternalStorageDirectory().canonicalFile)
        context.getExternalFilesDirs(null).filterNotNull().forEach { directory ->
            val root = File(directory.absolutePath.substringBefore("/Android/")).canonicalFile
            if (root.exists() && none { it.path == root.path }) add(root)
        }
    }
    @Volatile var policy = PathPolicy(roots)
        private set
    private val mutation = Mutex()
    private val jobs = File(context.filesDir, "operations").apply { mkdirs() }
    data class Progress(val completed: Int, val total: Int, val label: String, val bytes: Long = 0)

    fun hasPermission(): Boolean = if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
    private fun requirePermission() { check(hasPermission()) { "Allow all-files access in Android Settings first." } }
    fun record(id: String): FileRecord = dao.byId(id) ?: throw IOException("This file is no longer in the index. Refresh and try again.")
    fun all(): List<FileRecord> = dao.all()
    fun resolve(id: String, internal: Boolean = false): File {
        requirePermission()
        val file = if (id == "root") roots.first() else File(record(id).path)
        return policy.requireAllowed(file, internal)
    }
    private fun destination(id: String): File {
        val parent = resolve(id)
        check(parent.isDirectory && parent.canWrite()) { "This destination is not a writable folder." }
        if (id != "root") check(record(id).trashedAt == null) { "Restore this folder before using it." }
        return parent
    }

    suspend fun scan(progress: suspend (Progress) -> Unit = {}) = withContext(Dispatchers.IO) {
        mutation.withLock { scanUnlocked(progress) }
    }
    private suspend fun scanUnlocked(progress: suspend (Progress) -> Unit = {}, saveBaseline: Boolean = true) {
        requirePermission()
        roots = discoverRoots(); policy = PathPolicy(roots)
        // With the mutation lock held, no active writer can own these staging directories.
        roots.forEach { root -> File(root, ".findex-staging").listFiles()?.forEach { abandoned ->
            if (abandoned.isDirectory && runCatching { UUID.fromString(abandoned.name) }.isSuccess && File(abandoned, ".findex-owned").isFile) {
                deleteTree(abandoned)
            }
        } }
        val before = dao.all()
        val existing = before.associateBy { it.path }
        if (saveBaseline && before.isNotEmpty()) {
            before.filter { it.kind == "folder" && it.parentId == "root" && it.trashedAt == null }.forEach { folder ->
                val total = before.filter { it.kind == "file" && it.trashedAt == null && it.path.startsWith(folder.path + "/") }.sumOf { it.size }
                dao.snapshot(SnapshotRecord().apply { folderId = folder.id; bytes = total; takenAt = System.currentTimeMillis() })
            }
        }
        val seen = mutableSetOf<String>()
        val inaccessible = mutableListOf<String>()
        val stack = ArrayDeque<Pair<File, String>>()
        val pending = ArrayList<FileRecord>(128)
        var count = 0
        roots.forEachIndexed { index, root ->
            if (index == 0) {
                val children = root.listFiles()
                if (children == null) inaccessible.add(root.path) else children.forEach { stack.add(it to "root") }
            } else stack.add(root to "root")
        }
        while (stack.isNotEmpty()) {
            coroutineContext.ensureActive()
            val (raw, parentId) = stack.removeLast()
            val file = try { policy.requireAllowed(raw, false) } catch (_: Exception) { continue }
            if (!file.exists()) continue
            val previous = existing[file.path]
            val item = metadata(file, parentId, previous)
            if (policy.isRoot(file)) item.name = "SD card · ${file.name}"
            seen.add(item.id); pending.add(item); count++
            if (file.isDirectory) {
                val children = file.listFiles()
                if (children == null) inaccessible.add(file.path) else children.forEach { stack.add(it to item.id) }
            }
            if (pending.size >= 128) {
                dao.putAll(pending.toList()); pending.clear()
                progress(Progress(count, 0, "Indexing $count items"))
            }
        }
        if (pending.isNotEmpty()) dao.putAll(pending)
        requirePermission()
        database.runInTransaction {
            before.filter { it.trashedAt == null && it.id !in seen && inaccessible.none { path -> it.path == path || it.path.startsWith("$path/") } }
                .filter { !File(it.path).exists() }.forEach { dao.delete(it.id) }
        }
        recoverTrash()
        progress(Progress(count, count, "Your index is up to date"))
    }
    private fun metadata(file: File, parentId: String, previous: FileRecord? = null): FileRecord {
        val size = if (file.isFile) file.length() else 0L
        val modified = file.lastModified()
        val unchanged = previous != null && previous.size == size && previous.modifiedAt == modified
        val item = FileRecord().apply {
            id = previous?.id ?: UUID.randomUUID().toString()
            name = file.name; path = file.path; this.parentId = parentId
            kind = if (file.isDirectory) "folder" else "file"
            extension = if (kind == "file") file.extension.lowercase() else ""
            mime = if (kind == "folder") "inode/directory" else MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: when (extension) { "mkv" -> "video/x-matroska"; "md" -> "text/markdown"; else -> "application/octet-stream" }
            category = if (kind == "folder") "other" else category(extension, mime)
            this.size = size; modifiedAt = modified
            createdAt = previous?.createdAt ?: runCatching { Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS).creationTime().toMillis().takeIf { it > 0 } ?: modified }.getOrDefault(modified)
            favorite = previous?.favorite ?: false
            pinned = previous?.pinned ?: (kind == "folder" && parentId == "root" && name.lowercase() in setOf("download", "downloads", "documents", "pictures", "dcim"))
            color = when (name.lowercase()) { "download", "downloads" -> "blue"; "documents" -> "sand"; "pictures", "dcim" -> "lavender"; else -> previous?.color ?: "sage" }
            if (unchanged) { fingerprint = previous?.fingerprint; summary = previous?.summary; width = previous?.width; height = previous?.height; duration = previous?.duration }
        }
        if (!unchanged && item.kind == "file") enrich(item, file)
        return item
    }
    private fun enrich(item: FileRecord, file: File) {
        runCatching {
            when {
                item.extension in setOf("txt", "md", "csv", "json", "log", "xml") -> {
                    FileInputStream(file).use { input -> val buffer = ByteArray(8192); val read = input.read(buffer); if (read > 0) item.summary = String(buffer, 0, read, Charsets.UTF_8).take(4000) }
                }
                item.category == "images" -> {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(file.path, bounds)
                    if (bounds.outWidth > 0) { item.width = bounds.outWidth; item.height = bounds.outHeight }
                }
                item.category in setOf("audio", "videos") -> {
                    val retriever = MediaMetadataRetriever()
                    try {
                        retriever.setDataSource(file.path)
                        item.duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()?.div(1000)
                        item.width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
                        item.height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
                        item.summary = listOfNotNull(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE), retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST), retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)).joinToString(" · ").take(2000)
                    } finally { retriever.release() }
                }
                item.extension == "pdf" && item.size <= 64L * 1024 * 1024 -> {
                    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                        PdfRenderer(descriptor).use { renderer ->
                            item.summary = "PDF document · ${renderer.pageCount} pages"
                            // Text extraction exists on newer Android PDF implementations; gracefully keep page metadata on older releases.
                            if (Build.VERSION.SDK_INT >= 35 && renderer.pageCount > 0) renderer.openPage(0).use { page ->
                                val contents = runCatching { page.javaClass.getMethod("getTextContents").invoke(page) as? List<*> }.getOrNull()
                                val text = contents?.mapNotNull { runCatching { it?.javaClass?.getMethod("getText")?.invoke(it)?.toString() }.getOrNull() }?.joinToString(" ")?.take(4000)
                                if (!text.isNullOrBlank()) item.summary = text
                            }
                        }
                    }
                }
            }
        }
    }
    suspend fun createFolder(name: String, parentId: String): String = withContext(Dispatchers.IO) {
        mutation.withLock {
            val parent = destination(parentId)
            val target = policy.requireAllowed(File(parent, PathPolicy.validName(name)), false)
            check(!target.exists()) { "An item with this name already exists." }
            Files.createDirectory(target.toPath())
            metadata(target, parentId).also { dao.put(it); refreshParents(parent) }.id
        }
    }
    suspend fun rename(id: String, name: String) = withContext(Dispatchers.IO) {
        mutation.withLock {
            val item = record(id); check(item.trashedAt == null) { "Restore this item before renaming it." }
            val source = resolve(id); check(!policy.isRoot(source)) { "Storage volumes cannot be renamed." }
            val target = policy.requireAllowed(File(source.parentFile, PathPolicy.validName(name)), false)
            if (target.path == source.path) return@withLock
            check(!target.exists()) { "An item with this name already exists." }
            Files.move(source.toPath(), target.toPath()) // No REPLACE_EXISTING: never silently overwrite.
            relocate(item, source, target, item.parentId, null)
            refreshParents(source.parentFile, target.parentFile)
        }
    }
    fun favorite(id: String, favorite: Boolean) { requirePermission(); dao.favorite(id, favorite) }
    private fun refreshParents(vararg parents: File?) {
        parents.filterNotNull().distinctBy { it.path }.forEach { parent ->
            if (parent.exists()) dao.byPath(parent.path)?.let { item -> item.modifiedAt = parent.lastModified(); dao.put(item) }
        }
    }
    private fun tree(item: FileRecord): List<FileRecord> = if (item.kind == "file") listOf(item) else dao.subtree(item.path)
    private fun relocate(item: FileRecord, old: File, target: File, parentId: String, trashTime: Long?) {
        val records = if (item.kind == "file") listOf(item) else dao.subtree(old.path)
        val originalParent = item.parentId
        records.forEach { child ->
            val original = child.path
            child.path = target.path + child.path.removePrefix(old.path)
            File(child.path).takeIf { it.exists() }?.let { child.modifiedAt = it.lastModified() }
            if (child.id == item.id) {
                child.parentId = parentId
                if (trashTime == null) {
                    child.name = target.name
                    if (child.kind == "file") {
                        child.extension = target.extension.lowercase()
                        child.mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(child.extension) ?: "application/octet-stream"
                        child.category = category(child.extension, child.mime)
                    }
                }
            }
            if (trashTime != null) {
                child.originalPath = original; child.originalParentId = if (child.id == item.id) originalParent else child.parentId
                child.trashedAt = trashTime; child.favorite = false; child.pinned = false
            } else { child.trashedAt = null; child.originalParentId = null; child.originalPath = null }
        }
        database.runInTransaction { dao.putAll(records) }
    }
    fun newJob(action: String, ids: List<String>, destination: String?): String {
        require(action in setOf("copy", "move", "trash", "restore", "delete")) { "Unsupported operation." }
        require(ids.isNotEmpty()) { "Select at least one item." }
        val id = UUID.randomUUID().toString()
        val value = JSONObject().put("id", id).put("action", action).put("ids", JSONArray(ids.distinct())).put("destination", destination ?: "root").put("completed", JSONArray())
        saveJob(id, value)
        return id
    }
    private fun jobFile(id: String): File { require(runCatching { UUID.fromString(id) }.isSuccess); return File(jobs, "$id.json") }
    private fun saveJob(id: String, value: JSONObject) {
        val target = jobFile(id); val temp = File(jobs, "$id.writing")
        FileOutputStream(temp).use { output -> output.write(value.toString().toByteArray()); output.fd.sync() }
        Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }
    private fun pendingFile(id: String) = File(jobs, "$id.pending.json")
    private fun checkpoint(id: String, fileId: String, done: MutableSet<String>) {
        done.add(fileId)
        FileOutputStream(File(jobs, "$id.done"), true).use { output -> output.write("$fileId\n".toByteArray()); output.fd.sync() }
        pendingFile(id).delete()
    }
    private fun savePending(id: String, value: JSONObject) {
        val temp = File(jobs, "$id.pending.writing")
        FileOutputStream(temp).use { output -> output.write(value.toString().toByteArray()); output.fd.sync() }
        Files.move(temp.toPath(), pendingFile(id).toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }
    suspend fun executeJob(jobId: String, progress: suspend (Progress) -> Unit) = withContext(Dispatchers.IO) {
        mutation.withLock {
            requirePermission()
            val job = JSONObject(jobFile(jobId).readText())
            val action = job.getString("action")
            val done = job.getJSONArray("completed").strings().toMutableSet()
            File(jobs, "$jobId.done").takeIf { it.isFile }?.useLines { lines -> lines.forEach { if (runCatching { UUID.fromString(it) }.isSuccess) done.add(it) } }
            val all = dao.all().associateBy { it.id }; val selected = job.getJSONArray("ids").strings().toSet()
            val ids = selected.filter { id ->
                var parent = all[id]?.parentId; val visited = mutableSetOf<String>(); var included = true
                while (parent != null && visited.add(parent)) {
                    if (parent in selected) { included = false; break }
                    parent = all[parent]?.parentId
                }
                included
            }
            for (id in ids) {
                coroutineContext.ensureActive()
                if (id in done) continue
                val item = dao.byId(id)
                if (item == null && action == "delete") {
                    checkpoint(jobId, id, done); continue
                }
                check(item != null) { "This file is no longer in the index. Refresh and try again." }
                progress(Progress(done.size, ids.size, when(action) { "copy" -> "Copying ${item.name}"; "move" -> "Moving ${item.name}"; "trash" -> "Moving ${item.name} to Trash"; "restore" -> "Restoring ${item.name}"; else -> "Deleting ${item.name}" }))
                val pending = pendingFile(jobId).takeIf { it.isFile }?.let { JSONObject(it.readText()) }?.takeIf { it.optString("id") == id }
                if (pending != null && action in setOf("move", "trash", "restore") && item.path == pending.optString("target") && File(item.path).exists()) {
                    checkpoint(jobId, id, done); continue
                }
                val source = if (pending != null) policy.requireAllowed(File(pending.getString("source")), true) else resolve(id, item.trashedAt != null)
                check(!policy.isRoot(source)) { "Storage volumes cannot be moved or removed." }
                if (pending == null && source.exists()) {
                    check(source.lastModified() == item.modifiedAt && (item.kind == "folder" || source.length() == item.size)) {
                        "This item changed since the index was built. Refresh and review the action again."
                    }
                    if (action == "trash" && item.kind == "file" && item.fingerprint != null) {
                        check(hashBytes(source).joinToString("") { "%02x".format(it) } == item.fingerprint) { "This file no longer matches the reviewed fingerprint. Refresh and review it again." }
                    }
                }
                if (action == "delete") {
                    check(item.trashedAt != null) { "Move files to Trash before deleting permanently." }
                    if (pending == null) savePending(jobId, JSONObject().put("id", id).put("source", source.path))
                    if (source.exists()) deleteTree(source)
                    database.runInTransaction { tree(item).forEach { dao.delete(it.id) } }
                    cleanupTrashSlot(source); refreshParents(source.parentFile)
                } else {
                    if (action in setOf("copy", "move", "trash")) check(item.trashedAt == null) { "Restore this item before using it." }
                    if (action == "restore") check(item.trashedAt != null) { "This item is not in Trash." }
                    var parentId = job.getString("destination")
                    val target: File
                    val trashTime = if (action == "trash") pending?.optLong("trashTime") ?: System.currentTimeMillis() else null
                    if (pending != null) {
                        target = policy.requireAllowed(File(pending.getString("target")), action == "trash")
                        parentId = pending.getString("parentId")
                    } else {
                        target = when (action) {
                            "trash" -> {
                                val slot = File(policy.rootFor(source), ".findex-trash/${UUID.randomUUID()}").apply { check(mkdirs()) { "Cannot create Trash on this volume." } }
                                // The manifest is written BEFORE the move and permits recovery after an app-data reset.
                                val manifest = JSONObject().put("records", JSONArray(tree(item).map { toJson(it) })).put("originalPath", source.path).put("trashTime", trashTime)
                                FileOutputStream(File(slot, ".meta.json")).use { it.write(manifest.toString().toByteArray()); it.fd.sync() }
                                parentId = "trash"; File(slot, "payload")
                            }
                            "restore" -> {
                                val originalParent = item.originalParentId?.let { original -> dao.byId(original) }
                                parentId = if (originalParent != null && originalParent.trashedAt == null && File(originalParent.path).isDirectory) originalParent.id else "root"
                                val folder = destination(parentId)
                                PathPolicy.uniqueDestination(folder, item.name)
                            }
                            else -> {
                                val folder = destination(parentId)
                                check(!PathPolicy.inside(folder, source)) { "A folder cannot be placed inside itself." }
                                if (action == "move" && source.parentFile?.canonicalFile == folder) {
                                    checkpoint(jobId, id, done); continue
                                }
                                PathPolicy.uniqueDestination(folder, item.name)
                            }
                        }
                        savePending(jobId, JSONObject().put("id", id).put("source", source.path).put("target", target.path).put("parentId", parentId).put("trashTime", trashTime))
                    }
                    policy.requireAllowed(target, action == "trash")
                    if (action == "copy") {
                        if (target.exists() && pending != null) verifyTree(source, target)
                        else verifiedCopy(source, target, progress, done.size, ids.size)
                        indexCopiedTree(target, parentId)
                    } else {
                        // Recover a completed rename whose metadata transaction was interrupted.
                        if (source.exists()) {
                            check(!target.exists()) { "A file appeared at the destination. Nothing was overwritten." }
                            if (Os.stat(source.path).st_dev == Os.stat(target.parentFile!!.path).st_dev) Files.move(source.toPath(), target.toPath())
                            else { verifiedCopy(source, target, progress, done.size, ids.size); deleteTree(source) }
                        } else check(pending != null && target.exists()) { "The source file is no longer available." }
                        relocate(item, source, target, parentId, trashTime)
                        if (action == "restore") cleanupTrashSlot(source)
                    }
                    refreshParents(source.parentFile, target.parentFile)
                }
                checkpoint(jobId, id, done)
                progress(Progress(done.size, ids.size, "${done.size} of ${ids.size} items complete"))
            }
            jobFile(jobId).delete(); File(jobs, "$jobId.done").delete(); pendingFile(jobId).delete()
        }
    }
    private suspend fun verifiedCopy(source: File, target: File, progress: suspend (Progress) -> Unit, completed: Int, total: Int) {
        val stagingRoot = File(policy.rootFor(target), ".findex-staging").apply { mkdirs() }
        val staging = File(stagingRoot, UUID.randomUUID().toString()).apply { check(mkdir()) { "Cannot create a staging directory." }; File(this, ".findex-owned").writeText("1") }
        val payload = File(staging, "payload")
        var bytes = 0L; var lastReport = 0L
        try {
            copyTree(source, payload) { count ->
                bytes += count
                if (System.currentTimeMillis() - lastReport > 150) { lastReport = System.currentTimeMillis(); progress(Progress(completed, total, "Copying ${source.name}", bytes)) }
            }
            coroutineContext.ensureActive()
            check(!target.exists()) { "A file appeared at the destination. Nothing was overwritten." }
            Files.move(payload.toPath(), target.toPath())
        } finally { staging.deleteRecursively() }
    }
    private suspend fun copyTree(source: File, target: File, bytesCopied: suspend (Long) -> Unit) {
        coroutineContext.ensureActive(); policy.requireAllowed(source, true)
        if (source.isDirectory) {
            check(target.mkdir()) { "Cannot create a destination folder." }
            val children = source.listFiles() ?: throw IOException("A source folder could not be read.")
            for (child in children) copyTree(child, File(target, child.name), bytesCopied)
            target.setLastModified(source.lastModified())
        } else {
            val initialSize = source.length(); val initialDate = source.lastModified(); val digest = MessageDigest.getInstance("SHA-256")
            FileInputStream(source).use { input -> FileOutputStream(target).use { output ->
                val buffer = ByteArray(1024 * 1024)
                while (true) { coroutineContext.ensureActive(); val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count); digest.update(buffer, 0, count); bytesCopied(count.toLong()) }
                output.fd.sync()
            } }
            check(source.length() == initialSize && source.lastModified() == initialDate && target.length() == initialSize) { "The source changed while copying. Nothing was overwritten." }
            check(digest.digest().contentEquals(hashBytes(target))) { "Copy verification failed. Your original is unchanged." }
            target.setLastModified(initialDate)
        }
    }
    private suspend fun verifyTree(source: File, target: File) {
        coroutineContext.ensureActive()
        policy.requireAllowed(source, true); policy.requireAllowed(target, true)
        check(source.exists() && source.isDirectory == target.isDirectory) { "The interrupted copy cannot be verified safely." }
        if (source.isDirectory) {
            val children = source.listFiles() ?: throw IOException("Cannot verify the source folder.")
            check(children.size == target.listFiles()?.size) { "The destination changed. No files were overwritten." }
            for (child in children) verifyTree(child, File(target, child.name))
        } else check(source.length() == target.length() && hashBytes(source).contentEquals(hashBytes(target))) { "The destination changed. No files were overwritten." }
    }
    private suspend fun hashBytes(file: File): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input -> val buffer = ByteArray(1024 * 1024); while (true) { coroutineContext.ensureActive(); val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) } }
        return digest.digest()
    }
    private suspend fun deleteTree(file: File) {
        coroutineContext.ensureActive(); policy.requireAllowed(file, true)
        if (file.isDirectory) for (child in file.listFiles() ?: throw IOException("Cannot read a folder scheduled for deletion.")) deleteTree(child)
        Files.deleteIfExists(file.toPath())
    }
    private fun indexCopiedTree(file: File, parentId: String) {
        val stack = ArrayDeque<Pair<File, String>>(); stack.add(file to parentId)
        val records = mutableListOf<FileRecord>()
        while (stack.isNotEmpty()) {
            val (entry, parent) = stack.removeLast()
            val item = metadata(entry, parent, dao.byPath(entry.path)); records.add(item)
            if (entry.isDirectory) entry.listFiles()?.forEach { stack.add(it to item.id) }
        }
        database.runInTransaction { dao.putAll(records) }
    }
    private fun cleanupTrashSlot(source: File) {
        val slot = source.parentFile ?: return
        if (slot.parentFile?.name == ".findex-trash" && !File(slot, "payload").exists()) slot.deleteRecursively()
    }
    private fun recoverTrash() {
        for (root in roots) {
            File(root, ".findex-trash").listFiles()?.filter { it.isDirectory }?.forEach { slot ->
                runCatching {
                    val payload = File(slot, "payload"); val manifestFile = File(slot, ".meta.json")
                    if (!payload.exists() || !manifestFile.isFile || manifestFile.length() > 16L * 1024 * 1024) return@runCatching
                    policy.requireAllowed(payload, true)
                    if (dao.byPath(payload.path) != null) return@runCatching
                    val manifest = JSONObject(manifestFile.readText()); val old = policy.requireAllowed(File(manifest.getString("originalPath")), false)
                    val records = manifest.getJSONArray("records")
                    for (index in 0 until records.length()) {
                        val value = records.getJSONObject(index)
                        val original = policy.requireAllowed(File(value.getString("path")), false)
                        if (!PathPolicy.inside(original, old)) continue
                        val restoredPath = File(payload.path + original.path.removePrefix(old.path))
                        if (!restoredPath.exists()) continue
                        val item = metadata(restoredPath, value.optString("parentId", "root"))
                        item.id = value.getString("id"); item.name = value.getString("name")
                        item.originalPath = original.path; item.originalParentId = value.optString("parentId", "root")
                        item.trashedAt = manifest.getLong("trashTime"); item.favorite = false; item.pinned = false
                        if (original.path == old.path) item.parentId = "trash"
                        // If an ID is already used by a live file, do not overwrite it during recovery.
                        if (dao.byId(item.id) == null) dao.put(item)
                    }
                }
            }
        }
    }
    suspend fun importUris(uris: List<Uri>, parentId: String, progress: suspend (Progress) -> Unit) = withContext(Dispatchers.IO) {
        mutation.withLock {
            val parent = destination(parentId)
            for ((index, uri) in uris.withIndex()) {
                coroutineContext.ensureActive()
                val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null } ?: "Imported file"
                val target = PathPolicy.uniqueDestination(parent, name)
                policy.requireAllowed(target, false)
                val staging = File(policy.rootFor(target), ".findex-staging/${UUID.randomUUID()}").apply { check(mkdirs()) { "Cannot prepare the import." }; File(this, ".findex-owned").writeText("1") }
                try {
                    val payload = File(staging, "payload")
                    progress(Progress(index, uris.size, "Importing $name"))
                    val input = context.contentResolver.openInputStream(uri) ?: throw IOException("This provider did not return a readable file.")
                    input.use { source -> FileOutputStream(payload).use { output ->
                        val buffer = ByteArray(1024 * 1024)
                        while (true) { coroutineContext.ensureActive(); val count = source.read(buffer); if (count < 0) break; output.write(buffer, 0, count) }
                        output.fd.sync()
                    } }
                    check(!target.exists()) { "The destination changed. No files were overwritten." }
                    Files.move(payload.toPath(), target.toPath()); dao.put(metadata(target, parentId)); refreshParents(parent)
                } finally { staging.deleteRecursively() }
                progress(Progress(index + 1, uris.size, "Files imported"))
            }
        }
    }
    suspend fun analyze(progress: suspend (Progress) -> Unit = {}): JSONObject = withContext(Dispatchers.IO) {
        mutation.withLock {
            requirePermission()
            scanUnlocked(progress, saveBaseline = false)
            val files = dao.live()
            val candidates = files.filter { it.kind == "file" && it.size > 0 }.groupBy { it.size }.values.filter { it.size > 1 }.flatten()
            for ((index, item) in candidates.withIndex()) {
                coroutineContext.ensureActive()
                if (item.fingerprint == null) {
                    val source = policy.requireAllowed(File(item.path), false)
                    if (!source.isFile || source.length() != item.size || source.lastModified() != item.modifiedAt) continue
                    val hash = hashBytes(source).joinToString("") { "%02x".format(it) }
                    if (source.length() == item.size && source.lastModified() == item.modifiedAt) { item.fingerprint = hash; dao.put(item) }
                }
                progress(Progress(index + 1, candidates.size, "Verifying duplicate candidates"))
            }
            val docs = files.filter { it.kind == "file" }
            val duplicateGroups = docs.filter { it.fingerprint != null }.groupBy { it.fingerprint }.values.filter { it.size > 1 }
                .map { group -> group.sortedWith(compareByDescending<FileRecord> { it.favorite }.thenBy { it.createdAt }) }
            val stale = docs.filter { it.extension in setOf("apk", "tmp", "temp", "bak") && it.modifiedAt < System.currentTimeMillis() - 30L * 86400_000 }
            val cleanup = (duplicateGroups.flatMap { it.drop(1) } + stale).distinctBy { it.id }
            val parentsWithChildren = files.mapTo(mutableSetOf()) { it.parentId }
            val empty = files.filter { it.kind == "folder" && it.id !in parentsWithChildren && !policy.isRoot(File(it.path)) && File(it.path).listFiles()?.isEmpty() == true }
            val baseline = dao.snapshots().associateBy { it.folderId }
            val growth = files.filter { it.kind == "folder" && it.parentId == "root" }.map { folder ->
                JSONObject().put("name", folder.name).put("bytes", docs.filter { it.path.startsWith(folder.path + "/") }.sumOf { it.size }).put("previousBytes", baseline[folder.id]?.bytes ?: JSONObject.NULL)
            }
            JSONObject().put("totalBytes", docs.sumOf { it.size }).put("totalFiles", docs.size)
                .put("largeFiles", JSONArray(docs.sortedByDescending { it.size }.take(8).map { toJson(it) }))
                .put("duplicates", JSONArray(duplicateGroups.map { group -> JSONArray(group.map { toJson(it) }) }))
                .put("cleanup", JSONArray(cleanup.map { toJson(it) })).put("emptyFolders", JSONArray(empty.map { toJson(it) })).put("growth", JSONArray(growth))
        }
    }
    fun storage(): JSONObject {
        var total = 0L; var free = 0L
        roots.forEach { root -> runCatching { StatFs(root.path).also { total += it.totalBytes; free += it.availableBytes } } }
        return JSONObject().put("total", total).put("free", free).put("used", total - free)
            .put("indexed", dao.live().filter { it.kind == "file" }.sumOf { it.size }).put("isDemo", false).put("rootId", "root")
    }
    companion object {
        @Volatile private var instance: StorageEngine? = null
        fun get(context: Context): StorageEngine = instance ?: synchronized(this) { instance ?: StorageEngine(context.applicationContext).also { instance = it } }
        fun category(extension: String, mime: String): String = when {
            mime.startsWith("image/") || extension in setOf("jpg", "jpeg", "png", "webp", "gif", "heic", "avif", "bmp", "svg") -> "images"
            mime.startsWith("video/") || extension in setOf("mp4", "mkv", "webm", "mov", "avi", "m4v") -> "videos"
            mime.startsWith("audio/") || extension in setOf("mp3", "wav", "aac", "flac", "m4a", "opus", "ogg") -> "audio"
            extension in setOf("pdf", "doc", "docx", "txt", "md", "rtf", "xls", "xlsx", "csv", "ppt", "pptx", "json") -> "documents"
            extension in setOf("zip", "rar", "7z", "tar", "gz", "bz2") -> "archives"
            else -> "other"
        }
        fun toJson(item: FileRecord): JSONObject = JSONObject().put("id", item.id).put("name", item.name).put("path", item.path)
            .put("parentId", item.parentId).put("kind", item.kind).put("category", item.category).put("extension", item.extension).put("mime", item.mime)
            .put("size", item.size).put("createdAt", item.createdAt).put("modifiedAt", item.modifiedAt).put("favorite", item.favorite).put("pinned", item.pinned).put("color", item.color)
            .put("trashedAt", item.trashedAt ?: JSONObject.NULL).put("originalParentId", item.originalParentId ?: JSONObject.NULL)
            .put("summary", item.summary ?: JSONObject.NULL).put("fingerprint", item.fingerprint ?: JSONObject.NULL)
            .put("width", item.width ?: JSONObject.NULL).put("height", item.height ?: JSONObject.NULL).put("duration", item.duration ?: JSONObject.NULL)
    }
}
internal fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
