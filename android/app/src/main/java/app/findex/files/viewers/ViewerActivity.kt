package app.findex.files.viewers

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.findex.files.data.FileRecord
import app.findex.files.storage.SharedFileProvider
import app.findex.files.storage.StorageEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

abstract class ViewerActivity : AppCompatActivity() {
    protected lateinit var root: FrameLayout
    protected lateinit var content: FrameLayout
    protected lateinit var toolbar: LinearLayout
    protected lateinit var titleView: TextView
    protected var currentFile: FileRecord? = null
    protected var topInset = 0
    protected var bottomInset = 0
    protected fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT; window.navigationBarColor = Color.TRANSPARENT
        WindowCompat.getInsetsController(window, window.decorView).apply { isAppearanceLightStatusBars = false; isAppearanceLightNavigationBars = false }
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
        if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(25, 35, 30)) }
        content = FrameLayout(this)
        root.addView(content, FrameLayout.LayoutParams(-1, -1))
        toolbar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0); setBackgroundColor(0xde1d2a23.toInt()) }
        toolbar.addView(icon("back", "Close viewer") { finish() })
        titleView = TextView(this).apply { textSize = 14f; setTextColor(Color.rgb(230, 237, 223)); isSingleLine = true; ellipsize = TextUtils.TruncateAt.END; setPadding(dp(11), 0, dp(10), 0) }
        toolbar.addView(titleView, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(toolbar, FrameLayout.LayoutParams(-1, dp(64), Gravity.TOP))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            topInset = bars.top; bottomInset = bars.bottom
            toolbar.setPadding(dp(12) + bars.left, bars.top, dp(12) + bars.right, 0)
            toolbar.layoutParams = (toolbar.layoutParams as FrameLayout.LayoutParams).apply { height = dp(64) + bars.top }
            onInsets(); insets
        }
        ViewCompat.requestApplyInsets(root)
    }
    protected open fun onInsets() {}
    protected fun icon(glyph: String, label: String, action: () -> Unit): ImageButton = ImageButton(this).apply {
        contentDescription = label; setImageDrawable(Glyph(glyph)); scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        setPadding(dp(11), dp(11), dp(11), dp(11)); minimumWidth = dp(44); minimumHeight = dp(44)
        background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(0x153f5540) }
        layoutParams = LinearLayout.LayoutParams(dp(44), dp(44)).apply { marginStart = dp(2) }
        setOnClickListener { action() }
    }
    protected fun addExternalAction() { toolbar.addView(icon("external", "Open with another application") { openExternal() }) }
    protected suspend fun loadFile(id: String): FileRecord = withContext(Dispatchers.IO) {
        val engine = StorageEngine.get(this@ViewerActivity)
        engine.record(id).also { check(it.trashedAt == null && it.kind == "file" && engine.resolve(id).isFile) { "This file is no longer available." } }
    }
    protected fun showError(message: String) {
        content.removeAllViews()
        content.addView(TextView(this).apply {
            text = "$message\n\nUse the open-with button to try another app."
            textSize = 15f; setLineSpacing(dp(5).toFloat(), 1f); setTextColor(0xffbacbb0.toInt()); gravity = Gravity.CENTER
            setPadding(dp(35), dp(90), dp(35), dp(50))
        }, FrameLayout.LayoutParams(-1, -1))
    }
    private fun openExternal() {
        val item = currentFile ?: return
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(SharedFileProvider.uri(this, item.id), item.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { startActivity(intent) } catch (_: ActivityNotFoundException) { Toast.makeText(this, "No installed application can open this file type.", Toast.LENGTH_LONG).show() }
    }
}
internal class Glyph(private val kind: String) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffdce8d3.toInt(); style = Paint.Style.STROKE; strokeWidth = 1.6f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    override fun draw(canvas: Canvas) {
        canvas.save(); canvas.translate(bounds.left.toFloat(), bounds.top.toFloat()); canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
        val path = Path()
        when (kind) {
            "back" -> { path.moveTo(15f, 5f); path.lineTo(8f, 12f); path.lineTo(15f, 19f) }
            "plus" -> { path.moveTo(5f, 12f); path.lineTo(19f, 12f); path.moveTo(12f, 5f); path.lineTo(12f, 19f) }
            "minus" -> { path.moveTo(5f, 12f); path.lineTo(19f, 12f) }
            "external" -> { path.moveTo(13f, 4f); path.lineTo(20f, 4f); path.lineTo(20f, 11f); path.moveTo(20f, 4f); path.lineTo(10f, 14f); path.moveTo(9f, 5f); path.lineTo(5f, 5f); path.lineTo(5f, 20f); path.lineTo(19f, 20f); path.lineTo(19f, 15f) }
        }
        canvas.drawPath(path, paint); canvas.restore()
    }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(filter: ColorFilter?) { paint.colorFilter = filter }
    @Deprecated("Deprecated in Android") override fun getOpacity() = PixelFormat.TRANSLUCENT
}
