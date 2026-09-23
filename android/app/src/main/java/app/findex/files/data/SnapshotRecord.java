package app.findex.files.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "snapshots")
public class SnapshotRecord {
    @PrimaryKey @NonNull public String folderId = "";
    public long bytes;
    public long takenAt;
}
