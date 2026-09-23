package app.findex.files.workers

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.findex.files.storage.StorageEngine
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

class IndexWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val engine = StorageEngine.get(applicationContext)
        if (!engine.hasPermission()) return Result.success()
        return try {
            engine.scan { setProgress(workDataOf("completed" to it.completed, "total" to it.total, "label" to it.label)) }
            EnrichmentWorker.schedule(applicationContext)
            Result.success()
        } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { if (runAttemptCount < 2) Result.retry() else Result.failure() }
    }
    companion object {
        const val TAG = "findex-index"
        fun schedule(context: Context, immediate: Boolean = true) {
            val manager = WorkManager.getInstance(context)
            val periodic = PeriodicWorkRequestBuilder<IndexWorker>(60, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build()).addTag(TAG).build()
            manager.enqueueUniquePeriodicWork("findex-periodic-index", ExistingPeriodicWorkPolicy.KEEP, periodic)
            if (immediate) manager.enqueueUniqueWork("findex-index-now", ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<IndexWorker>().setInitialDelay(3, TimeUnit.SECONDS).setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build()).addTag(TAG).build())
        }
    }
}
