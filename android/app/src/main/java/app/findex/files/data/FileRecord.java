package app.findex.files.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

@Entity(tableName = "files", indices = {@Index(value = "path", unique = true), @Index("parentId"), @Index("modifiedAt"), @Index("category"), @Index("fingerprint")})
public class FileRecord {
    @PrimaryKey @NonNull public String id = "";
    @NonNull public String name = "";
    @NonNull public String path = "";
    @NonNull public String parentId = "root";
    @NonNull public String kind = "file";
    @NonNull public String category = "other";
    @NonNull public String extension = "";
    @NonNull public String mime = "application/octet-stream";
    public long size;
    public long createdAt;
    public long modifiedAt;
    public boolean favorite;
    public boolean pinned;
    @NonNull public String color = "sage";
    @Nullable public Long trashedAt;
    @Nullable public String originalParentId;
    @Nullable public String originalPath;
    @Nullable public String summary;
    @Nullable public String fingerprint;
    @Nullable public Integer width;
    @Nullable public Integer height;
    @Nullable public Double duration;
}
