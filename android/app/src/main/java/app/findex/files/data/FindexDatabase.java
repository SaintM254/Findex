package app.findex.files.data;

import android.content.Context;
import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

@Database(entities = {FileRecord.class, SnapshotRecord.class}, version = 1, exportSchema = true)
public abstract class FindexDatabase extends RoomDatabase {
    private static volatile FindexDatabase instance;
    public abstract FileDao files();
    public static FindexDatabase get(Context context) {
        if (instance == null) synchronized (FindexDatabase.class) {
            if (instance == null) instance = Room.databaseBuilder(context.getApplicationContext(), FindexDatabase.class, "findex-index.db")
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING).build();
        }
        return instance;
    }
}
