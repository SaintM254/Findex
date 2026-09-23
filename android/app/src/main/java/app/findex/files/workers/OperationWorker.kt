package app.findex.files.workers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.findex.files.R
import app.findex.files.storage.StorageEngine
import kotlinx.coroutines.CancellationException

/** Durable, user-initiated work. A process restart resumes completed-item checkpoints. */
class OperationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun getForegroundInfo(): ForegroundInfo = foreground("Taking care of your files")
    private fun foreground(label: String): ForegroundInfo {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("findex-operations", "File operations", NotificationManager.IMPORTANCE_LOW))
        val cancelIntent = androidx.work.WorkManager.getInstance(applicationContext).createCancelPendingIntent(id)
        val notification = NotificationCompat.Builder(applicationContext, "findex-operations")
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("Findex").setContentText(label)
            .setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", cancelIntent).build()
        val notificationId = id.hashCode() and Int.MAX_VALUE
        return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else ForegroundInfo(notificationId, notification)
    }
    override suspend fun doWork(): Result {
        val jobId = inputData.getString("jobId") ?: return Result.failure()
        return try {
            setForeground(getForegroundInfo())
            StorageEngine.get(applicationContext).executeJob(jobId) {
                setProgress(workDataOf("completed" to it.completed, "total" to it.total, "label" to it.label, "bytes" to it.bytes))
            }
            Result.success()
        } catch (cancelled: CancellationException) { throw cancelled } catch (error: Exception) { Result.failure(workDataOf("error" to (error.message ?: "The file operation could not be completed."))) }
    }
    companion object { const val TAG = "findex-operation" }
}
