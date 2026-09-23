package app.findex.files.storage

import android.content.ContentProvider
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.content.ContentValues
import androidx.exifinterface.media.ExifInterface
import app.findex.files.data.FileRecord
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns

/** Read-only, per-URI grants work on primary and removable storage without exposing a root-path provider. */
class SharedFileProvider : ContentProvider() {
    override fun onCreate() = true
    private fun id(uri: Uri): String {
        require(uri.pathSegments.size == 2 && uri.pathSegments[0] in setOf("file", "thumbnail")) { "Invalid file URI." }
        return uri.pathSegments[1]
    }
    override fun getType(uri: Uri): String = if (uri.pathSegments.firstOrNull() == "thumbnail") "image/jpeg" else StorageEngine.get(requireNotNull(context)).record(id(uri)).mime
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        require(mode == "r") { "Findex shares read-only file access." }
        val engine = StorageEngine.get(requireNotNull(context)); val record = engine.record(id(uri))
        check(record.trashedAt == null && record.kind == "file") { "This file cannot be shared." }
        val source = engine.resolve(record.id)
        val target = if (uri.pathSegments[0] == "thumbnail") thumbnail(record, source) else source
        val descriptor = ParcelFileDescriptor.open(target, ParcelFileDescriptor.MODE_READ_ONLY)
        if (target == source) {
            // Check the actual opened descriptor, not only the pre-open path, to narrow symlink races.
            try { engine.policy.requireAllowed(File("/proc/self/fd/${descriptor.fd}").canonicalFile, false) }
            catch (error: Exception) { descriptor.close(); throw error }
        }
        return descriptor
    }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        val item = StorageEngine.get(requireNotNull(context)).record(id(uri))
        val columns = projection?.filter { it == OpenableColumns.DISPLAY_NAME || it == OpenableColumns.SIZE }?.toTypedArray() ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        return MatrixCursor(columns).apply { addRow(columns.map { if (it == OpenableColumns.DISPLAY_NAME) item.name else item.size }.toTypedArray()) }
    }
    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("Read-only provider")
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException("Read-only provider")
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException("Read-only provider")
    private val thumbnailLock = Any()
    private var createdThumbnails = 0
    private fun thumbnail(item: FileRecord, source: File): File = synchronized(thumbnailLock) {
        check(item.category == "images") { "No image thumbnail is available." }
        val directory = File(requireNotNull(context).cacheDir, "thumbnails").apply { mkdirs() }
        val cacheId = UUID.nameUUIDFromBytes("${item.id}:${item.modifiedAt}:${item.size}".toByteArray()).toString()
        val cached = File(directory, "$cacheId.jpg")
        if (cached.isFile) { cached.setLastModified(System.currentTimeMillis()); return@synchronized cached }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        check(bounds.outWidth > 0 && bounds.outHeight > 0) { "This image format has no thumbnail." }
        var sample = 1
        while (bounds.outWidth / sample > 384 || bounds.outHeight / sample > 384) sample *= 2
        val bitmap = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 }) ?: error("Could not decode thumbnail.")
        val matrix = Matrix()
        when (runCatching { ExifInterface(source.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
        }
        val oriented = if (matrix.isIdentity) bitmap else Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        val temporary = File(directory, "$cacheId.writing")
        try {
            FileOutputStream(temporary).use { output -> check(oriented.compress(Bitmap.CompressFormat.JPEG, 86, output)); output.fd.sync() }
            check(temporary.renameTo(cached)) { "Cannot cache this thumbnail." }
        } finally { if (oriented !== bitmap) oriented.recycle(); bitmap.recycle(); temporary.delete() }
        if (++createdThumbnails % 32 == 0) {
            val files = directory.listFiles()?.sortedBy { it.lastModified() }.orEmpty()
            var bytes = files.sumOf { it.length() }
            for (file in files) { if (bytes <= 40L * 1024 * 1024) break; if (file != cached) { val size = file.length(); if (file.delete()) bytes -= size } }
        }
        cached
    }
    companion object {
        fun uri(context: Context, id: String, thumbnail: Boolean = false): Uri = Uri.Builder().scheme("content").authority("${context.packageName}.files").appendPath(if (thumbnail) "thumbnail" else "file").appendPath(id).build()
    }
}
