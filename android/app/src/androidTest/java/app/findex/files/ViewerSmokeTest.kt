package app.findex.files

import android.content.Intent
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.findex.files.storage.StorageEngine
import app.findex.files.viewers.MediaViewerActivity
import app.findex.files.viewers.PdfViewerActivity
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class ViewerSmokeTest {
    private lateinit var engine: StorageEngine
    private lateinit var sandbox: File
    @Before fun prepare() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.uiAutomation.executeShellCommand("appops set --uid ${context.packageName} MANAGE_EXTERNAL_STORAGE allow").use { descriptor ->
            ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
        }
        engine = StorageEngine.get(context)
        assertTrue("The test emulator must grant all-files access", engine.hasPermission())
        sandbox = File(Environment.getExternalStorageDirectory(), "Findex-viewers-${UUID.randomUUID()}")
        check(sandbox.mkdirs())
    }
    @After fun clean() {
        if (::sandbox.isInitialized) sandbox.deleteRecursively()
    }

    @Test fun pdfViewerRendersARealTwoPageDocument() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val pdf = File(sandbox, "Spec.pdf").apply { writeBytes(twoPagePdf()) }
        val id = engine.locator(pdf.path)
        ActivityScenario.launch<PdfViewerActivity>(Intent(context, PdfViewerActivity::class.java).putExtra("fileId", id)).use { scenario ->
            val deadline = SystemClock.elapsedRealtime() + 20_000
            while (SystemClock.elapsedRealtime() < deadline && textFor(scenario, "Page 1 of 2") == null) Thread.sleep(200)
            assertNotNull("The page pill must report the parsed page count", textFor(scenario, "Page 1 of 2"))
            assertFalse("The PDF must not be replaced by an error page", text(scenario).contains("could not be opened"))
        }
    }

    @Test fun pdfViewerShowsAnErrorInsteadOfCrashingOnGarbage() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val broken = File(sandbox, "Broken.pdf").apply { writeText("definitely not a pdf document") }
        ActivityScenario.launch<PdfViewerActivity>(Intent(context, PdfViewerActivity::class.java).putExtra("fileId", engine.locator(broken.path))).use { scenario ->
            val deadline = SystemClock.elapsedRealtime() + 10_000
            while (SystemClock.elapsedRealtime() < deadline && !text(scenario).contains("open-with")) Thread.sleep(200)
            assertTrue("A broken PDF must surface the graceful error copy", text(scenario).contains("open-with"))
        }
    }

    @Test fun audioViewerPlaysALocalWavAndShowsDetectedMetadata() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val wav = File(sandbox, "Chime.wav").apply { writeBytes(oneSecondWav()) }
        ActivityScenario.launch<MediaViewerActivity>(Intent(context, MediaViewerActivity::class.java).putExtra("fileId", engine.locator(wav.path))).use { scenario ->
            val deadline = SystemClock.elapsedRealtime() + 10_000
            while (SystemClock.elapsedRealtime() < deadline && !text(scenario).contains("open-with") && !text(scenario).contains("0:01")) Thread.sleep(200)
            val body = text(scenario)
            assertFalse("The audio player must not fall back to the error copy", body.contains("could not be opened"))
            assertTrue("Detected playback duration must be displayed", body.contains("0:01"))
        }
    }

    private fun textFor(scenario: ActivityScenario<PdfViewerActivity>, description: String): String? {
        val result = AtomicReference<String?>(null)
        scenario.onActivity { activity ->
            fun walk(view: View) {
                if (view is TextView && view.contentDescription?.toString() == description) result.set(view.text.toString())
                if (view is ViewGroup) for (index in 0 until view.childCount) walk(view.getChildAt(index))
            }
            walk(activity.window.decorView)
        }
        return result.get()
    }
    private fun text(scenario: ActivityScenario<*>): String {
        val result = AtomicReference("")
        scenario.onActivity { activity ->
            val builder = StringBuilder()
            fun walk(view: View) {
                if (view is TextView) builder.append(view.text).append('\n')
                if (view is ViewGroup) for (index in 0 until view.childCount) walk(view.getChildAt(index))
            }
            walk(activity.window.decorView)
            result.set(builder.toString())
        }
        return result.get()
    }

    private fun twoPagePdf(): ByteArray {
        val sb = StringBuilder("%PDF-1.4\n")
        val offsets = ArrayList<Long>()
        fun obj(body: String) { offsets.add(sb.length.toLong()); sb.append("${offsets.size} 0 obj\n$body\nendobj\n") }
        val first = "BT /F1 24 Tf 72 720 Td (Findex page one) Tj ET"
        val second = "BT /F1 24 Tf 72 720 Td (Findex page two) Tj ET"
        obj("<< /Type /Catalog /Pages 2 0 R >>")
        obj("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>")
        obj("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>")
        obj("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>")
        obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        for (stream in listOf(first, second)) {
            offsets.add(sb.length.toLong())
            sb.append("${offsets.size} 0 obj\n<< /Length ${stream.length} >>\nstream\n$stream\nendstream\nendobj\n")
        }
        val xref = sb.length.toLong()
        sb.append("xref\n0 ${offsets.size + 1}\n0000000000 65535 f \n")
        for (offset in offsets) sb.append(String.format("%010d 00000 n \n", offset))
        sb.append("trailer\n<< /Size ${offsets.size + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n")
        return sb.toString().toByteArray(Charsets.US_ASCII)
    }
    private fun oneSecondWav(): ByteArray {
        val sampleRate = 8000; val seconds = 1
        val data = ByteArray(sampleRate * seconds * 2)
        for (i in data.indices step 2) {
            val sample = (Math.sin(i / 32.0) * 6000).toInt()
            data[i] = (sample and 0xff).toByte(); data[i + 1] = ((sample shr 8) and 0xff).toByte()
        }
        val header = java.io.ByteArrayOutputStream()
        val w = java.io.DataOutputStream(header)
        fun ascii(value: String) = value.toByteArray(Charsets.US_ASCII)
        fun le32(value: Int) { w.write(value and 0xff); w.write((value shr 8) and 0xff); w.write((value shr 16) and 0xff); w.write((value shr 24) and 0xff) }
        fun le16(value: Int) { w.write(value and 0xff); w.write((value shr 8) and 0xff) }
        w.write(ascii("RIFF")); le32(36 + data.size); w.write(ascii("WAVEfmt "))
        le32(16); le16(1); le16(1); le32(sampleRate); le32(sampleRate * 2); le16(2); le16(16)
        w.write(ascii("data")); le32(data.size); w.write(data)
        return header.toByteArray()
    }
}
