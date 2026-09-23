package app.findex.files.workers

import android.content.Context
import android.os.SystemClock
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.findex.files.storage.StorageEngine
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/** Media probes and document snippets are optional, deferred work—not a startup prerequisite. */
class EnrichmentWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val engine = StorageEngine.get(applicationContext)
        if (!engine.hasPermission()) return Result.success()
        return try {
            val deadline = SystemClock.elapsedRealtime() + 4 * 60_000
            while (!isStopped && SystemClock.elapsedRealtime() < deadline) {
                if (engine.enrichIdleBatch() == 0) break
            }
            Result.success()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { Result.retry() }
    }
    companion object {
        fun schedule(context: Context) {
            val work = PeriodicWorkRequestBuilder<EnrichmentWorker>(60, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiresCharging(true).setRequiresDeviceIdle(true).setRequiresBatteryNotLow(true).build()).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("findex-idle-details", ExistingPeriodicWorkPolicy.KEEP, work)
        }
    }
}
