package app.findex.files.viewers

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.pdf.PdfRenderer
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.util.LruCache
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import app.findex.files.storage.StorageEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Continuous pages, a single renderer thread, and a bounded bitmap cache. No document upload. */
class PdfViewerActivity : ViewerActivity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val pdfDispatcher = executor.asCoroutineDispatcher()
    private val rendering = CoroutineScope(SupervisorJob() + pdfDispatcher)
    private var renderer: PdfRenderer? = null
    private var descriptor: ParcelFileDescriptor? = null
    private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
    }
    private var viewport: PdfViewport? = null
    private var adapter: PagesAdapter? = null
    private var pill: TextView? = null
    private var pages = 0
    private var currentPage = 0
    private var initialRatio = 1.414f
    private var restoredZoom = 1f
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        currentPage = savedInstanceState?.getInt("page") ?: 0
        restoredZoom = savedInstanceState?.getFloat("zoom") ?: 1f
        toolbar.addView(icon("minus", "Zoom out") { viewport?.changeZoom(-.25f) })
        toolbar.addView(icon("plus", "Zoom in") { viewport?.changeZoom(.25f) })
        addExternalAction()
        val id = intent.getStringExtra("fileId") ?: run { finish(); return }
        lifecycleScope.launch {
            try {
                currentFile = loadFile(id); titleView.text = currentFile?.name
                withContext(pdfDispatcher) {
                    val source = StorageEngine.get(this@PdfViewerActivity).resolve(id)
                    descriptor = ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY)
                    renderer = PdfRenderer(requireNotNull(descriptor))
                    pages = requireNotNull(renderer).pageCount
                    if (pages > 0) requireNotNull(renderer).openPage(0).use { initialRatio = it.height.toFloat() / it.width.coerceAtLeast(1) }
                }
                check(pages > 0) { "This PDF has no pages." }
                installPages()
            } catch (cancelled: CancellationException) { throw cancelled } catch (_: SecurityException) { showError("This PDF is password-protected, or file permission has changed.") } catch (error: Exception) { showError(error.message ?: "This PDF could not be opened.") }
        }
    }
    private fun installPages() {
        val startingPage = currentPage
        val view = PdfViewport(this) { width -> adapter?.setWidth(width) }
        viewport = view
        content.addView(view, FrameLayout.LayoutParams(-1, -1))
        val layout = LinearLayoutManager(this)
        view.list.layoutManager = layout
        adapter = PagesAdapter()
        view.list.adapter = adapter
        view.list.itemAnimator = null
        view.list.setItemViewCacheSize(2)
        view.list.addItemDecoration(object : RecyclerView.ItemDecoration() {
            override fun getItemOffsets(outRect: Rect, itemView: View, parent: RecyclerView, state: RecyclerView.State) { outRect.bottom = dp(18) }
        })
        view.list.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                currentPage = max(0, layout.findFirstVisibleItemPosition()); updatePill()
            }
        })
        pill = TextView(this).apply {
            textSize = 12f; gravity = Gravity.CENTER; setTextColor(0xffdbe4eb.toInt()); setPadding(dp(18), dp(12), dp(18), dp(12))
            background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(0xe6333e46.toInt()) }
            elevation = dp(8).toFloat(); contentDescription = "Document page count"
        }
        root.addView(pill, FrameLayout.LayoutParams(-2, dp(44), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(23) + bottomInset })
        onInsets(); updatePill()
        view.post { view.setZoom(restoredZoom); layout.scrollToPositionWithOffset(startingPage, dp(10)); adapter?.setWidth(view.pageWidth()) }
    }
    private fun updatePill() { pill?.text = "${currentPage + 1}  /  $pages"; pill?.contentDescription = "Page ${currentPage + 1} of $pages" }
    override fun onInsets() {
        viewport?.list?.setPadding(dp(16), dp(78) + topInset, dp(16), dp(90) + bottomInset)
        pill?.layoutParams = (pill?.layoutParams as? FrameLayout.LayoutParams)?.apply { bottomMargin = dp(23) + bottomInset }
    }
    override fun onSaveInstanceState(outState: Bundle) { outState.putInt("page", currentPage); outState.putFloat("zoom", viewport?.zoom ?: 1f); super.onSaveInstanceState(outState) }
    override fun onDestroy() {
        viewport?.list?.adapter = null; rendering.cancel()
        // Queue close behind any in-flight native PdfRenderer call; never close a page while it is rendering.
        executor.execute { runCatching { renderer?.close() }; runCatching { descriptor?.close() }; cache.evictAll() }
        pdfDispatcher.close()
        super.onDestroy()
    }
    private inner class PageHolder(val box: FrameLayout) : RecyclerView.ViewHolder(box) {
        val image = ImageView(this@PdfViewerActivity).apply { scaleType = ImageView.ScaleType.FIT_XY; setBackgroundColor(Color.WHITE) }
        val status = TextView(this@PdfViewerActivity).apply { gravity = Gravity.CENTER; setTextColor(0xff81929e.toInt()); textSize = 12f; text = "Preparing page…" }
        var job: Job? = null
        var key = ""
        init { box.addView(image, FrameLayout.LayoutParams(-1, -1)); box.addView(status, FrameLayout.LayoutParams(-1, -1)); box.elevation = dp(2).toFloat() }
    }
    private inner class PagesAdapter : RecyclerView.Adapter<PageHolder>() {
        private var width = resources.displayMetrics.widthPixels - dp(32)
        private val ratios = java.util.concurrent.ConcurrentHashMap<Int, Float>()
        init { setHasStableIds(true) }
        override fun getItemId(position: Int) = position.toLong()
        override fun getItemCount() = pages
        fun setWidth(value: Int) { if (value > 0 && value != width) { width = value; notifyDataSetChanged() } }
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PageHolder = PageHolder(FrameLayout(this@PdfViewerActivity))
        override fun onBindViewHolder(holder: PageHolder, position: Int) {
            holder.job?.cancel(); holder.image.setImageDrawable(null); holder.status.visibility = View.VISIBLE; holder.status.text = "Preparing page…"
            holder.box.layoutParams = RecyclerView.LayoutParams(-1, min(20_000f, width * (ratios[position] ?: initialRatio)).roundToInt().coerceAtLeast(1))
            holder.image.contentDescription = "PDF page ${position + 1}"
            val displayWidth = width; val key = "$position:$displayWidth"; holder.key = key
            holder.job = rendering.launch {
                try {
                    var ratio = ratios[position] ?: initialRatio
                    val bitmap = cache.get(key) ?: requireNotNull(renderer).openPage(position).use { page ->
                        ratio = page.height.toFloat() / page.width.coerceAtLeast(1)
                        var pixels = min(displayWidth, 1600).coerceAtLeast(1)
                        if (pixels * ratio > 4096) pixels = (4096 / ratio).toInt().coerceAtLeast(1)
                        val image = Bitmap.createBitmap(pixels, (pixels * ratio).roundToInt().coerceIn(1, 4096), Bitmap.Config.ARGB_8888)
                        image.eraseColor(Color.WHITE); page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        cache.put(key, image); image
                    }
                    if (isActive) withContext(Dispatchers.Main) {
                        if (holder.key == key) {
                            ratios[position] = ratio
                            holder.box.layoutParams = RecyclerView.LayoutParams(-1, min(20_000f, displayWidth * ratio).roundToInt().coerceAtLeast(1))
                            holder.image.setImageBitmap(bitmap); holder.status.visibility = View.GONE
                        }
                    }
                } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { withContext(Dispatchers.Main) { if (holder.key == key) holder.status.text = "This page could not be rendered." } }
            }
        }
        override fun onViewRecycled(holder: PageHolder) { holder.job?.cancel(); holder.key = ""; holder.image.setImageDrawable(null); super.onViewRecycled(holder) }
    }
}

/** Horizontal panning belongs to this viewport; ordinary vertical scrolling stays with RecyclerView. */
private class PdfViewport(context: Context, private val widthChanged: (Int) -> Unit) : FrameLayout(context) {
    val list = RecyclerView(context).apply { clipToPadding = false; overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS }
    var zoom = 1f; private set
    private var offsetX = 0f
    private var startX = 0f; private var startY = 0f; private var lastX = 0f
    private var panning = false
    private val scale = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean { setZoom(zoom * detector.scaleFactor); return true }
    })
    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(event: MotionEvent) = true
        override fun onDoubleTap(event: MotionEvent): Boolean { setZoom(if (zoom > 1.1f) 1f else 2f); return true }
    })
    init { clipChildren = true; setBackgroundColor(0xffd4dadf.toInt()); addView(list, LayoutParams(-1, -1)) }
    fun pageWidth(): Int = (width * zoom).roundToInt() - list.paddingLeft - list.paddingRight
    fun changeZoom(delta: Float) = setZoom(zoom + delta)
    fun setZoom(value: Float) {
        val next = value.coerceIn(1f, 4f)
        val manager = list.layoutManager as? LinearLayoutManager
        val position = manager?.findFirstVisibleItemPosition() ?: 0
        val oldOffset = manager?.findViewByPosition(position)?.top?.minus(list.paddingTop) ?: 0
        val ratio = next / zoom; zoom = next
        if (width <= 0) return
        list.layoutParams = LayoutParams((width * zoom).roundToInt(), -1)
        offsetX = (offsetX * ratio).coerceIn(-width * (zoom - 1f), 0f); list.translationX = offsetX
        widthChanged(pageWidth())
        if (position >= 0) list.post { manager?.scrollToPositionWithOffset(position, (oldOffset * ratio).roundToInt()) }
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); setZoom(zoom) }
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        scale.onTouchEvent(event); gestures.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { startX = event.x; lastX = event.x; startY = event.y; panning = false }
            MotionEvent.ACTION_MOVE -> if (zoom > 1 && abs(event.x - startX) > 12 && abs(event.x - startX) > abs(event.y - startY)) panning = true
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> panning = false
        }
        return super.dispatchTouchEvent(event)
    }
    override fun onInterceptTouchEvent(event: MotionEvent): Boolean = scale.isInProgress || panning
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_MOVE && event.pointerCount == 1 && panning) {
            offsetX = (offsetX + event.x - lastX).coerceIn(-width * (zoom - 1f), 0f); list.translationX = offsetX
        }
        lastX = event.x
        if (event.actionMasked == MotionEvent.ACTION_UP) performClick()
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}
