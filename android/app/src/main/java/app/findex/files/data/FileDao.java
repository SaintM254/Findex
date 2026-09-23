package app.findex.files.data;

import androidx.room.Dao;
import androidx.room.Query;
import androidx.room.Upsert;
import java.util.List;

@Dao
public interface FileDao {
    @Query("SELECT * FROM files ORDER BY name COLLATE NOCASE") List<FileRecord> all();
    @Query("SELECT * FROM files WHERE trashedAt IS NULL") List<FileRecord> live();
    @Query("SELECT * FROM files WHERE id = :id LIMIT 1") FileRecord byId(String id);
    @Query("SELECT * FROM files WHERE path = :path LIMIT 1") FileRecord byPath(String path);
    @Query("SELECT COUNT(*) FROM files") int count();
    @Query("SELECT * FROM files WHERE path = :path OR instr(path, :path || '/') = 1") List<FileRecord> subtree(String path);
    @Upsert void put(FileRecord record);
    @Upsert void putAll(List<FileRecord> records);
    @Query("DELETE FROM files WHERE id = :id") void delete(String id);
    @Query("UPDATE files SET favorite = :favorite, pinned = CASE WHEN kind = 'folder' THEN :favorite ELSE pinned END WHERE id = :id") void favorite(String id, boolean favorite);
    @Query("SELECT * FROM snapshots") List<SnapshotRecord> snapshots();
    @Upsert void snapshot(SnapshotRecord record);
}
