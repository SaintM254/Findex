package app.findex.files.viewers

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

internal class PhotoCanvasView(context: Context, private val navigate: (Int) -> Unit, private val toggleChrome: () -> Unit) : View(context) {
    private var bitmap: Bitmap? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    var zoom = 1f; private set
    private var panX = 0f; private var panY = 0f
    private val baseScale get() = bitmap?.let { min(width / it.width.toFloat(), height / it.height.toFloat()) } ?: 1f
    private val scale = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean { setZoom(zoom * detector.scaleFactor, detector.focusX, detector.focusY); return true }
    })
    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(event: MotionEvent) = true
        override fun onSingleTapConfirmed(event: MotionEvent): Boolean { toggleChrome(); performClick(); return true }
        override fun onDoubleTap(event: MotionEvent): Boolean {
            ValueAnimator.ofFloat(zoom, if (zoom > 1.1f) 1f else 2.5f).apply { duration = 180; addUpdateListener { setZoom(it.animatedValue as Float, event.x, event.y) }; start() }
            return true
        }
        override fun onScroll(first: MotionEvent?, last: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
            if (zoom <= 1f || scale.isInProgress) return false
            panX -= distanceX; panY -= distanceY; clamp(); invalidate(); return true
        }
        override fun onFling(first: MotionEvent?, last: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
            if (zoom <= 1f && first != null && abs(last.x - first.x) > width * .2f && abs(velocityX) > abs(velocityY)) { navigate(if (velocityX < 0) 1 else -1); return true }
            return false
        }
    })
    init { isClickable = true; isFocusable = true; contentDescription = "Image. Pinch or double-tap to zoom; swipe to change images." }
    fun setPhoto(value: Bitmap, initialZoom: Float = 1f) { bitmap = value; zoom = initialZoom.coerceIn(1f, 6f); panX = 0f; panY = 0f; invalidate() }
    fun changeZoom(delta: Float) = setZoom(zoom + delta, width / 2f, height / 2f)
    private fun setZoom(value: Float, focusX: Float, focusY: Float) {
        val next = value.coerceIn(1f, 6f); val ratio = next / zoom
        panX = focusX - width / 2f - (focusX - width / 2f - panX) * ratio
        panY = focusY - height / 2f - (focusY - height / 2f - panY) * ratio
        zoom = next; clamp(); invalidate()
    }
    private fun clamp() {
        val value = bitmap ?: return
        val maxX = max(0f, (value.width * baseScale * zoom - width) / 2)
        val maxY = max(0f, (value.height * baseScale * zoom - height) / 2)
        panX = panX.coerceIn(-maxX, maxX); panY = panY.coerceIn(-maxY, maxY)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { clamp() }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val value = bitmap ?: return
        canvas.save(); canvas.translate(width / 2f + panX, height / 2f + panY); canvas.scale(baseScale * zoom, baseScale * zoom)
        canvas.drawBitmap(value, -value.width / 2f, -value.height / 2f, paint); canvas.restore()
    }
    override fun onTouchEvent(event: MotionEvent): Boolean { scale.onTouchEvent(event); gestures.onTouchEvent(event); return true }
    override fun performClick(): Boolean { super.performClick(); return true }
}
