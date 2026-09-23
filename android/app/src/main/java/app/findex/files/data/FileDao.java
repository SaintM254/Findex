package app.findex.files.data;

import androidx.room.Dao;
import androidx.room.Query;
import androidx.room.Upsert;
import androidx.room.RawQuery;
import androidx.sqlite.db.SupportSQLiteQuery;
import java.util.List;

@Dao
public interface FileDao {
    String BASIC_COLUMNS = "id,name,path,parentId,kind,category,extension,mime,size,createdAt,modifiedAt,favorite,pinned,color,trashedAt,originalParentId,originalPath";
    String LIGHT_COLUMNS = BASIC_COLUMNS + ",NULL AS summary,NULL AS fingerprint,width,height,duration";
    String ANALYSIS_COLUMNS = BASIC_COLUMNS + ",NULL AS summary,fingerprint,width,height,duration";
    @Query("SELECT " + ANALYSIS_COLUMNS + " FROM files WHERE trashedAt IS NULL") List<FileRecord> analysisFiles();
    @Query("SELECT * FROM files WHERE kind = 'file' AND trashedAt IS NULL AND summary IS NULL AND category IN ('documents','images','audio','videos') ORDER BY modifiedAt DESC LIMIT 32") List<FileRecord> awaitingDetails();
    @Query("SELECT * FROM files WHERE path IN (:paths)") List<FileRecord> byPaths(List<String> paths);
    @Query("SELECT " + LIGHT_COLUMNS + " FROM files WHERE parentId = :parentId AND trashedAt IS NULL") List<FileRecord> children(String parentId);
    @Query("SELECT " + LIGHT_COLUMNS + " FROM files WHERE trashedAt IS NULL AND (parentId = 'root' OR pinned = 1) ORDER BY kind DESC, name COLLATE NOCASE LIMIT 64") List<FileRecord> navigation();
    @Query("SELECT " + LIGHT_COLUMNS + " FROM files WHERE kind = 'file' AND trashedAt IS NULL ORDER BY modifiedAt DESC LIMIT 12") List<FileRecord> recentPreview();
    @Query("SELECT COALESCE(SUM(size),0) FROM files WHERE kind = 'file' AND trashedAt IS NULL") long indexedBytes();
    @Query("SELECT category, COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM files WHERE kind = 'file' AND trashedAt IS NULL GROUP BY category") List<CategoryTotal> categoryTotals();
    @Query("SELECT COUNT(*) FROM files f WHERE f.trashedAt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM files p WHERE p.id = f.parentId AND p.trashedAt IS NOT NULL)") int trashCount();
    @Query("SELECT " + LIGHT_COLUMNS + " FROM files WHERE kind = 'folder' AND trashedAt IS NULL ORDER BY CASE WHEN parentId = 'root' THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT 500") List<FileRecord> planningFolders();
    @Query("SELECT " + LIGHT_COLUMNS + " FROM files WHERE trashedAt IS NULL ORDER BY CASE WHEN kind = 'folder' THEN 0 ELSE 1 END, modifiedAt DESC LIMIT 500") List<FileRecord> agentContext();
    @RawQuery List<FileRecord> page(SupportSQLiteQuery query);
    @RawQuery long scalar(SupportSQLiteQuery query);
    @Query("SELECT * FROM files ORDER BY name COLLATE NOCASE") List<FileRecord> all();
    @Query("SELECT * FROM files WHERE trashedAt IS NULL") List<FileRecord> live();
    @Query("SELECT * FROM files WHERE id = :id LIMIT 1") FileRecord byId(String id);
    @Query("SELECT * FROM files WHERE path = :path LIMIT 1") FileRecord byPath(String path);
    @Query("SELECT COUNT(*) FROM files") int count();
    @Query("SELECT * FROM files WHERE path = :path OR instr(path, :path || '/') = 1") List<FileRecord> subtree(String path);
    @Upsert void put(FileRecord record);
    @Upsert void putAll(List<FileRecord> records);
    @Query("DELETE FROM files WHERE id = :id") void delete(String id);
    @Query("DELETE FROM files WHERE id = :id AND path = :path AND trashedAt IS NULL") void deleteUnchanged(String id, String path);
    @Query("UPDATE files SET favorite = :favorite, pinned = CASE WHEN kind = 'folder' THEN :favorite ELSE pinned END WHERE id = :id") void favorite(String id, boolean favorite);
    @Query("SELECT * FROM snapshots") List<SnapshotRecord> snapshots();
    @Upsert void snapshot(SnapshotRecord record);
}
