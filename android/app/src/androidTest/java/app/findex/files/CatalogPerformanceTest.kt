package app.findex.files

import android.content.Context
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.findex.files.data.FileRecord
import app.findex.files.storage.StorageEngine
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class CatalogPerformanceTest {
    private lateinit var context: Context
    private lateinit var engine: StorageEngine
    private lateinit var sandbox: File
    private val fixtureIds = ArrayList<String>()
    @Before fun prepare() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        context = instrumentation.targetContext
        instrumentation.uiAutomation.executeShellCommand("appops set --uid ${context.packageName} MANAGE_EXTERNAL_STORAGE allow").use { descriptor ->
            ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
        }
        engine = StorageEngine.get(context)
        assertTrue("The test emulator must grant all-files access", engine.hasPermission())
        sandbox = File(Environment.getExternalStorageDirectory(), "Findex-performance-${UUID.randomUUID()}")
        check(sandbox.mkdirs())
    }
    @After fun clean() {
        // Only this test's UUID-named directory and rows are touched.
        if (::sandbox.isInitialized) {
            engine.database.files().subtree(sandbox.path).forEach { engine.database.files().delete(it.id) }
            sandbox.deleteRecursively()
        }
        for (id in fixtureIds) engine.database.files().delete(id)
    }
    @Test fun uncachedFolderIsBrowsableBeforeTheIndexExists() = runBlocking {
        repeat(220) { File(sandbox, "Report-${it.toString().padStart(4, '0')}.txt").writeText("local bytes") }
        File(sandbox, "Broken video.mp4").writeText("not a media file; browsing must not invoke a decoder")
        File(sandbox, "Broken document.pdf").writeText("not a PDF; browsing must not invoke PdfRenderer")
        val id = engine.locator(sandbox.path)
        assertNull(engine.database.files().byPath(sandbox.path))
        val start = SystemClock.elapsedRealtime()
        val page = engine.catalog.browse(JSONObject().put("section", "folder").put("id", id).put("pageSize", 80).put("sort", "name"))
        val elapsed = SystemClock.elapsedRealtime() - start
        assertEquals(222, page.getInt("total"))
        assertEquals(80, page.getJSONArray("files").length())
        assertNull("Browsing must not depend on database population", engine.database.files().byPath(sandbox.path))
        assertTrue("A 222-entry folder took ${elapsed}ms", elapsed < 2500)
        val next = engine.catalog.browse(JSONObject().put("section", "folder").put("id", id).put("page", 1).put("pageSize", 80))
        assertEquals(80, next.getJSONArray("files").length())
        assertNotEquals(page.getJSONArray("files").getJSONObject(0).getString("id"), next.getJSONArray("files").getJSONObject(0).getString("id"))
    }
    @Test fun pathLocatorsCopyTrashAndRestoreUsingDurableIds() = runBlocking {
        val source = File(sandbox, "notes.txt").apply { writeText("exact original bytes") }
        val destination = File(sandbox, "Destination").apply { mkdir() }
        val copy = engine.newJob("copy", listOf(engine.locator(source.path)), engine.locator(destination.path))
        engine.executeJob(copy) {}
        assertEquals(source.readText(), File(destination, "notes.txt").readText())
        engine.takeJobResult(copy)
        val trash = engine.newJob("trash", listOf(engine.locator(source.path)), null)
        engine.executeJob(trash) {}
        val durable = engine.takeJobResult(trash)
        assertEquals(1, durable.size)
        assertFalse(source.exists())
        assertNotNull(engine.record(durable.first()).trashedAt)
        val restore = engine.newJob("restore", durable, null)
        engine.executeJob(restore) {}
        engine.takeJobResult(restore)
        assertEquals("exact original bytes", source.readText())
    }
    @Test fun largeIndexDoesNotCrossTheBridgeOrBlockTheNavigationButton() {
        val prefix = UUID.randomUUID().toString()
        repeat(20) { chunk ->
            val records = (0 until 500).map { offset ->
                val n = chunk * 500 + offset
                FileRecord().apply {
                    id = "$prefix-$n"; name = "Indexed-$n.txt"; path = "${sandbox.path}/database-only-$n.txt"; parentId = "root"
                    category = "documents"; size = 10; summary = "An existing indexed document. ".repeat(60)
                    modifiedAt = 1000 + n.toLong(); createdAt = modifiedAt
                }.also { fixtureIds.add(it.id) }
            }
            engine.database.files().putAll(records)
        }
        val small = engine.catalog.navigation()
        assertTrue("Navigation snapshot must remain bounded", small.size <= 76)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            fun javascript(script: String): String {
                val value = AtomicReference<String>("")
                val latch = CountDownLatch(1)
                scenario.onActivity { activity -> activity.bridge.webView.evaluateJavascript(script) { result -> value.set(result); latch.countDown() } }
                assertTrue("WebView must respond without a full-index stall", latch.await(2, TimeUnit.SECONDS))
                return value.get()
            }
            val deadline = SystemClock.elapsedRealtime() + 10_000
            while (javascript("Boolean(document.querySelector('.app-shell'))") != "true" && SystemClock.elapsedRealtime() < deadline) Thread.sleep(80)
            assertEquals("true", javascript("Boolean(document.querySelector('.app-shell'))"))
            val response = javascript("""
                (function() {
                    var button = document.querySelector('[aria-label="Open navigation"]');
                    if (!button) return false;
                    button.click();
                    return true;
                })()
            """.trimIndent())
            assertEquals("true", response)
            Thread.sleep(200)
            assertEquals("true", javascript("Boolean(document.querySelector('.sidebar.is-open'))"))
        }
    }
}
