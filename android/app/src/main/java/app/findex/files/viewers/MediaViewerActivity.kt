package app.findex.files.viewers

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.exifinterface.media.ExifInterface
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import app.findex.files.storage.SharedFileProvider
import app.findex.files.storage.StorageEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.min

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class MediaViewerActivity : ViewerActivity() {
    private var player: ExoPlayer? = null
    private var photo: PhotoCanvasView? = null
    private var imageJob: Job? = null
    private var position = 0L
    private var resumePlaying = false
    private var siblings = emptyList<String>()
    private var initialZoom = 1f
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        position = savedInstanceState?.getLong("position") ?: 0L
        initialZoom = savedInstanceState?.getFloat("zoom") ?: 1f
        resumePlaying = savedInstanceState?.getBoolean("playing") ?: false
        val id = savedInstanceState?.getString("fileId") ?: intent.getStringExtra("fileId") ?: run { finish(); return }
        lifecycleScope.launch {
            try {
                val item = loadFile(id); currentFile = item; titleView.text = item.name
                if (item.category == "images") {
                    toolbar.addView(icon("minus", "Zoom out") { photo?.changeZoom(-.4f) })
                    toolbar.addView(icon("plus", "Zoom in") { photo?.changeZoom(.4f) })
                    addExternalAction()
                    siblings = withContext(Dispatchers.IO) { StorageEngine.get(this@MediaViewerActivity).all().filter { it.category == "images" && it.kind == "file" && it.parentId == item.parentId && it.trashedAt == null }.sortedBy { it.name }.map { it.id } }
                    photo = PhotoCanvasView(this@MediaViewerActivity, { direction ->
                        val index = siblings.indexOf(currentFile?.id); siblings.getOrNull(index + direction)?.let { showImage(it) }
                    }, { toolbar.visibility = if (toolbar.visibility == View.VISIBLE) View.GONE else View.VISIBLE })
                    content.addView(photo, FrameLayout.LayoutParams(-1, -1)); showImage(id)
                } else {
                    addExternalAction()
                    if (item.category == "audio") addAudioMeta(item)
                    showPlayer(item.id, item.mime, item.category == "audio")
                }
            } catch (cancelled: CancellationException) { throw cancelled } catch (error: Exception) { addExternalAction(); showError(error.message ?: "This media could not be opened.") }
        }
    }
    private fun showImage(id: String) {
        imageJob?.cancel()
        imageJob = lifecycleScope.launch {
            try {
                val item = loadFile(id)
                val decoded = withContext(Dispatchers.IO) {
                    val path = StorageEngine.get(this@MediaViewerActivity).resolve(id).path
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(path, bounds)
                    check(bounds.outWidth > 0 && bounds.outHeight > 0) { "This image format needs another viewer." }
                    var sample = 1
                    while (bounds.outWidth / sample > 2560 || bounds.outHeight / sample > 2560 || bounds.outWidth.toLong() / sample * (bounds.outHeight / sample) * 4 > 24L * 1024 * 1024) sample *= 2
                    val bitmap = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 }) ?: error("This image could not be decoded.")
                    val transform = Matrix()
                    when (runCatching { ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)) {
                        ExifInterface.ORIENTATION_ROTATE_90 -> transform.postRotate(90f)
                        ExifInterface.ORIENTATION_ROTATE_180 -> transform.postRotate(180f)
                        ExifInterface.ORIENTATION_ROTATE_270 -> transform.postRotate(270f)
                        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> transform.postScale(-1f, 1f)
                        ExifInterface.ORIENTATION_FLIP_VERTICAL -> transform.postScale(1f, -1f)
                        ExifInterface.ORIENTATION_TRANSPOSE -> { transform.postRotate(90f); transform.postScale(-1f, 1f) }
                        ExifInterface.ORIENTATION_TRANSVERSE -> { transform.postRotate(270f); transform.postScale(-1f, 1f) }
                    }
                    if (transform.isIdentity) bitmap else Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, transform, true).also { if (it !== bitmap) bitmap.recycle() }
                }
                currentFile = item; titleView.text = item.name; photo?.setPhoto(decoded, initialZoom); initialZoom = 1f
            } catch (cancelled: CancellationException) { throw cancelled } catch (error: Exception) { showError(error.message ?: "This image could not be decoded.") }
        }
    }
    private fun addAudioMeta(item: FileRecord) {
        val meta = TextView(this).apply {
            textSize = 12.5f; setTextColor(0xff9fb4c2.toInt()); gravity = Gravity.CENTER
            setPadding(dp(24), dp(6), dp(24), dp(6)); maxLines = 2; visibility = View.GONE
        }
        content.addView(meta, FrameLayout.LayoutParams(-1, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(72) })
        lifecycleScope.launch {
            // Local-only detection: tags and duration come from the file itself.
            val line = withContext(Dispatchers.IO) {
                val path = runCatching { StorageEngine.get(this@MediaViewerActivity).resolve(item.id).path }.getOrNull() ?: return@withContext null
                val retriever = android.media.MediaMetadataRetriever()
                try {
                    retriever.setDataSource(path)
                    val seconds = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()?.div(1000)?.takeIf { it > 0 }?.let { Math.round(it) }
                    val duration = seconds?.let {
                        val h = it / 3600; val m = (it % 3600) / 60; val sec = it % 60
                        if (h > 0) String.format("%d:%02d:%02d", h, m, sec) else String.format("%d:%02d", m, sec)
                    } ?: item.duration?.let { d ->
                        val t = Math.round(d); val h = t / 3600; val m = (t % 3600) / 60; val sec = t % 60
                        if (h > 0) String.format("%d:%02d:%02d", h, m, sec) else String.format("%d:%02d", m, sec)
                    }
                    val tags = listOfNotNull(
                        retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ARTIST),
                        retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ALBUM)
                    ).distinct().joinToString(" · ").takeIf { it.isNotBlank() } ?: item.summary?.takeIf { it.isNotBlank() }
                    listOfNotNull(tags, duration).joinToString("   ·   ").takeIf { it.isNotEmpty() }
                } catch (_: Exception) { null } finally { runCatching { retriever.release() } }
            }
            if (line != null) { meta.text = line; meta.visibility = View.VISIBLE }
        }
    }
    private fun showPlayer(id: String, mime: String, audio: Boolean) {
        val view = PlayerView(this).apply {
            setBackgroundColor(0xff191f23.toInt()); setShutterBackgroundColor(0xff191f23.toInt())
            useController = true; controllerShowTimeoutMs = if (audio) 0 else 3500
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            setShowNextButton(false); setShowPreviousButton(false)
            if (audio) defaultArtwork = AudioArtwork()
        }
        content.addView(view, FrameLayout.LayoutParams(-1, -1))
        player = ExoPlayer.Builder(this).setRenderersFactory(DefaultRenderersFactory(this).setEnableDecoderFallback(true)).build().also { media ->
            view.player = media
            media.setAudioAttributes(androidx.media3.common.AudioAttributes.DEFAULT, true)
            media.setHandleAudioBecomingNoisy(true)
            media.setMediaItem(MediaItem.Builder().setUri(SharedFileProvider.uri(this, id)).setMimeType(mime).build())
            media.seekTo(position); media.prepare(); media.playWhenReady = resumePlaying && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)
            media.addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) { showError("This device cannot decode this media. Your original file is unchanged.") }
            })
            view.showController()
        }
    }
    override fun onStart() { super.onStart(); if (resumePlaying) player?.play() }
    override fun onStop() { player?.let { position = it.currentPosition; resumePlaying = it.isPlaying; it.pause() }; super.onStop() }
    override fun onSaveInstanceState(outState: Bundle) { outState.putBoolean("playing", player?.isPlaying == true || resumePlaying); outState.putLong("position", player?.currentPosition ?: position); outState.putString("fileId", currentFile?.id); outState.putFloat("zoom", photo?.zoom ?: 1f); super.onSaveInstanceState(outState) }
    override fun onDestroy() { player?.release(); player = null; super.onDestroy() }
}
private class AudioArtwork : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun draw(canvas: Canvas) {
        val cx = bounds.exactCenterX(); val cy = bounds.exactCenterY(); val radius = min(bounds.width(), bounds.height()) * .28f
        paint.color = 0xff263139.toInt(); canvas.drawCircle(cx, cy, radius, paint)
        paint.style = Paint.Style.STROKE; paint.strokeWidth = 1f; paint.color = 0xff3f4c55.toInt()
        for (index in 1..24) canvas.drawCircle(cx, cy, radius * (.2f + index * .032f), paint)
        paint.style = Paint.Style.FILL; paint.color = 0xff879fb0.toInt(); canvas.drawCircle(cx, cy, radius * .31f, paint)
        paint.color = 0xffdae5ed.toInt(); paint.strokeWidth = radius * .018f; paint.strokeCap = Paint.Cap.ROUND
        for (index in -2..2) { val height = radius * (.13f - kotlin.math.abs(index) * .03f); val x = cx + index * radius * .055f; canvas.drawLine(x, cy - height, x, cy + height, paint) }
    }
    override fun getIntrinsicWidth() = 720
    override fun getIntrinsicHeight() = 720
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(filter: ColorFilter?) { paint.colorFilter = filter }
    @Deprecated("Deprecated in Android") override fun getOpacity() = PixelFormat.OPAQUE
}
