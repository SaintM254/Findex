package app.findex.files.storage

import android.os.SystemClock
import androidx.sqlite.db.SimpleSQLiteQuery
import app.findex.files.data.FileDao
import app.findex.files.data.FileRecord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.attribute.BasicFileAttributes
import java.util.LinkedHashMap

/** The browsing path never waits for the background index or opens document/media bytes. */
class FileCatalog(private val engine: StorageEngine) {
    private val dao get() = engine.database.files()
    private data class Entry(val file: File, val attributes: BasicFileAttributes, val sortName: String)
    private data class Directory(val modified: Long, val created: Long, val entries: List<Entry>)
    private val directories = LinkedHashMap<String, Directory>(8, .75f, true)
    private var totalsAt = 0L
    private var totals: JSONObject? = null
    @Synchronized fun invalidate(path: String? = null) {
        if (path == null) directories.clear() else directories.remove(path)
        totalsAt = 0L
    }
    private fun directory(parent: File): List<Entry> {
        val now = SystemClock.elapsedRealtime()
        val modified = parent.lastModified()
        synchronized(this) {
            directories[parent.path]?.takeIf { it.modified == modified && now - it.created < 15_000 }?.let { return it.entries }
        }
        val children = parent.listFiles() ?: error("This folder could not be read. Check its permission or reconnect the storage device.")
        val entries = children.mapNotNull { child ->
            if (child.name in setOf(".findex-trash", ".findex-staging") && engine.policy.isRoot(parent)) return@mapNotNull null
            if (child.name in setOf("data", "obb") && engine.roots.any { parent == File(it, "Android") }) return@mapNotNull null
            runCatching {
                val attributes = Files.readAttributes(child.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
                if (attributes.isSymbolicLink || (!attributes.isDirectory && !attributes.isRegularFile)) null
                else Entry(child, attributes, child.name.lowercase())
            }.getOrNull()
        }
        synchronized(this) {
            // Keep at most one exceptionally large directory, not eight full libraries.
            directories[parent.path] = Directory(modified, now, entries)
            while (directories.size > 1 && (directories.size > 8 || directories.values.sumOf { it.entries.size } > 40_000)) directories.remove(directories.keys.first())
        }
        return entries
    }
    suspend fun browse(input: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        check(engine.hasPermission()) { "Allow file access first." }
        val page = input.optInt("page", 0).coerceAtLeast(0)
        val limit = input.optInt("pageSize", 80).coerceIn(1, 500)
        val section = input.optString("section", "all")
        val sort = input.optString("sort", "name").takeIf { it in setOf("name", "modified", "size") } ?: "name"
        val showHidden = input.optBoolean("showHidden", false)
        if (section in setOf("all", "folder")) {
            val parentId = if (section == "all") "root" else input.getString("id")
            val parent = engine.resolve(parentId)
            check(parent.isDirectory) { "This folder is no longer available." }
            val entries = directory(parent).filter { (showHidden || !it.file.name.startsWith('.')) && (!input.optBoolean("filesOnly", false) || it.attributes.isRegularFile) }.toMutableList()
            if (parentId == "root") engine.roots.drop(1).forEach { volume ->
                runCatching { entries.add(Entry(volume, Files.readAttributes(volume.toPath(), BasicFileAttributes::class.java), volume.name.lowercase())) }
            }
            entries.sortWith(compareByDescending<Entry> { it.attributes.isDirectory }.thenComparator { a, b ->
                when (sort) { "modified" -> b.attributes.lastModifiedTime().compareTo(a.attributes.lastModifiedTime()); "size" -> b.attributes.size().compareTo(a.attributes.size()); else -> a.sortName.compareTo(b.sortName) }
            }.thenBy { it.sortName })
            val offset = (page.toLong() * limit).coerceAtMost(entries.size.toLong()).toInt()
            val records = engine.previewEntries(entries.drop(offset).take(limit).map { it.file to it.attributes }, parentId)
            val ancestors = ArrayList<FileRecord>()
            var cursor: File? = if (parentId == "root") null else parent
            while (cursor != null && cursor.canonicalFile != engine.roots.first() && ancestors.size < 64) {
                val current = cursor
                ancestors.add(engine.record(engine.locator(current.path)))
                if (engine.policy.isRoot(current)) break
                cursor = current.parentFile
            }
            return@withContext pageJson(records, entries.size, page, limit).put("ancestors", JSONArray(ancestors.map { engine.toUi(it) }))
        }
        val filter = input.optJSONObject("filter") ?: JSONObject()
        val clauses = mutableListOf<String>()
        val args = ArrayList<Any>()
        if (section == "trash") clauses.add("f.trashedAt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM files p WHERE p.id = f.parentId AND p.trashedAt IS NOT NULL)")
        else clauses.add("f.trashedAt IS NULL")
        if (!showHidden && section != "trash") clauses.add("f.path NOT LIKE '%/.%'")
        if (section == "category") { clauses.add("f.category = ? AND f.kind = 'file'"); args.add(input.getString("id")) }
        if (section == "recent") clauses.add("f.kind = 'file'")
        if (section == "favorites") clauses.add("f.favorite = 1")
        if (section == "search" || section == "plan") {
            clauses.add("f.kind = 'file'")
            for (key in listOf("category", "extension", "parentId")) {
                val value = filter.optString(key).trim().removePrefix(if (key == "extension") "." else "")
                if (value.isNotEmpty()) {
                    if (key == "parentId" && value.startsWith("fs:")) {
                        clauses.add("f.parentId IN (SELECT id FROM files WHERE path = ?)"); args.add(engine.resolve(value).path)
                    } else { clauses.add("f.$key = ?"); args.add(value) }
                }
            }
            for ((key, sql) in mapOf("modifiedAfter" to "f.modifiedAt >= ?", "modifiedBefore" to "f.modifiedAt < ?", "minSize" to "f.size >= ?")) {
                if (filter.has(key)) { clauses.add(sql); args.add(filter.getLong(key)) }
            }
            val text = filter.optString("text", input.optString("search", "")).trim().take(400)
            for (term in text.split(Regex("\\s+")).filter { it.isNotBlank() }) {
                if (term.lowercase() in setOf("cv", "resume", "résumé")) {
                    clauses.add("(LOWER(' ' || REPLACE(REPLACE(REPLACE(f.name, '.', ' '), '-', ' '), '_', ' ') || ' ') LIKE ? OR LOWER(f.name) LIKE ? OR LOWER(f.name) LIKE ?)")
                    args.add("% cv %"); args.add("%resume%"); args.add("%résumé%")
                } else {
                    clauses.add("LOWER(f.name || ' ' || f.path || ' ' || COALESCE(f.summary, '')) LIKE ? ESCAPE '\\'")
                    args.add(like(term))
                }
            }
            val name = filter.optString("nameIncludes").trim()
            if (name.isNotEmpty()) { clauses.add("LOWER(f.name) LIKE ? ESCAPE '\\'"); args.add(like(name)) }
        }
        val where = clauses.joinToString(" AND ")
        val order = if (section == "trash" && sort == "modified") "f.trashedAt DESC" else when (sort) {
            "modified" -> "CASE WHEN f.kind = 'folder' THEN 0 ELSE 1 END, f.modifiedAt DESC"
            "size" -> "CASE WHEN f.kind = 'folder' THEN 0 ELSE 1 END, f.size DESC"
            else -> "CASE WHEN f.kind = 'folder' THEN 0 ELSE 1 END, f.name COLLATE NOCASE"
        }
        val total = dao.scalar(SimpleSQLiteQuery("SELECT COUNT(*) FROM files f WHERE $where", args.toTypedArray())).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        val records = dao.page(SimpleSQLiteQuery("SELECT ${FileDao.LIGHT_COLUMNS} FROM files f WHERE $where ORDER BY $order, f.id LIMIT ? OFFSET ?", (args + listOf(limit, page.toLong() * limit)).toTypedArray()))
        pageJson(records, total, page, limit).put("ancestors", JSONArray())
    }
    fun dashboard(): JSONObject {
        val now = SystemClock.elapsedRealtime()
        synchronized(this) { totals?.takeIf { now - totalsAt < 2_000 }?.let { return JSONObject(it.toString()) } }
        val value = JSONObject().put("categories", JSONArray(dao.categoryTotals().map {
            JSONObject().put("category", it.category).put("count", it.count).put("bytes", it.bytes)
        })).put("trashCount", dao.trashCount()).put("indexing", engine.indexing)
        value.put("folders", JSONArray(dao.navigation().filter { it.kind == "folder" && it.pinned }.take(4).map { folder ->
            JSONObject().put("id", engine.uiId(folder))
                .put("count", dao.scalar(SimpleSQLiteQuery("SELECT COUNT(*) FROM files WHERE parentId = ? AND kind = 'file' AND trashedAt IS NULL", arrayOf(folder.id))))
                .put("bytes", dao.scalar(SimpleSQLiteQuery("SELECT COALESCE(SUM(size),0) FROM files WHERE instr(path, ?) = 1 AND kind = 'file' AND trashedAt IS NULL", arrayOf(folder.path + "/"))))
        }))
        synchronized(this) { totals = value; totalsAt = now }
        return value
    }
    fun navigation(): List<FileRecord> = (dao.navigation() + dao.recentPreview()).distinctBy { it.id }
    suspend fun planningContext(): List<FileRecord> {
        val root = engine.resolve("root")
        val folders = directory(root).filter { it.attributes.isDirectory }.take(80)
        val fresh = engine.previewEntries(folders.map { it.file to it.attributes }, "root")
        return (fresh + dao.planningFolders() + dao.agentContext()).distinctBy { it.path }.take(500)
    }
    fun planningFolders(): List<FileRecord> = dao.planningFolders()
    private fun like(text: String) = "%" + text.lowercase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    private fun pageJson(records: List<FileRecord>, total: Int, page: Int, size: Int): JSONObject = JSONObject()
        .put("files", JSONArray(records.map { engine.toUi(it) })).put("total", total).put("page", page).put("pageSize", size)
}
