package app.findex.files.data;

import androidx.annotation.NonNull;

/** Aggregate projection; does not change the on-device schema. */
public class CategoryTotal {
    @NonNull public String category = "other";
    public long bytes;
    public int count;
}
