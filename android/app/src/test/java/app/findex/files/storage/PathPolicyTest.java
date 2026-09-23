package app.findex.files.storage;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.file.Files;
import java.util.Collections;
import static org.junit.Assert.*;

public class PathPolicyTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private File root;
    private PathPolicy policy;
    @Before public void setup() throws Exception { root = temporary.newFolder("storage"); policy = new PathPolicy(Collections.singletonList(root)); }
    @Test public void permitsChildrenButNotSiblingsWithTheSamePrefix() throws Exception {
        assertEquals(new File(root, "Notes.txt").getCanonicalFile(), policy.requireAllowed(new File(root, "Notes.txt"), false));
        File sibling = temporary.newFolder("storage-private");
        assertThrows(SecurityException.class, () -> policy.requireAllowed(new File(sibling, "secret"), false));
    }
    @Test public void rejectsTraversalAndProtectedDirectories() {
        assertThrows(SecurityException.class, () -> policy.requireAllowed(new File(root, "../private"), false));
        assertThrows(SecurityException.class, () -> policy.requireAllowed(new File(root, "Android/data/app/private"), false));
        assertThrows(SecurityException.class, () -> policy.requireAllowed(new File(root, "Android/obb/game"), true));
    }
    @Test public void reservesInternalBookkeepingPaths() throws Exception {
        assertThrows(SecurityException.class, () -> policy.requireAllowed(new File(root, ".findex-trash/payload"), false));
        assertNotNull(policy.requireAllowed(new File(root, ".findex-trash/payload"), true));
    }
    @Test public void neverFollowsSymbolicLinks() throws Exception {
        File outside = temporary.newFolder("outside");
        Files.createSymbolicLink(new File(root, "alias").toPath(), outside.toPath());
        assertThrows(SecurityException.class, () -> policy.requireAllowed(new File(root, "alias/secret"), false));
        File inside = new File(root, "Photos"); assertTrue(inside.mkdir());
        Files.createSymbolicLink(new File(root, "photo-alias").toPath(), inside.toPath());
        assertThrows(SecurityException.class, () -> policy.requireAllowed(new File(root, "photo-alias/test.jpg"), false));
    }
    @Test public void validatesUtf8NamesAndControlCharacters() {
        for (String name : new String[]{"", "..", ".", "a/b", "a\\b", "a\u0000b", ".findex-trash", "é".repeat(121)}) {
            assertThrows(IllegalArgumentException.class, () -> PathPolicy.validName(name));
        }
        assertEquals("Autumn.pdf", PathPolicy.validName("  Autumn.pdf  "));
    }
    @Test public void neverOverwritesANameCollision() throws Exception {
        assertTrue(new File(root, "Report.pdf").createNewFile());
        assertTrue(new File(root, "Report (1).pdf").createNewFile());
        assertEquals("Report (2).pdf", PathPolicy.uniqueDestination(root, "Report.pdf").getName());
    }
    @Test public void rootAndAncestryChecksAreCanonical() throws Exception {
        File child = new File(root, "Photos");
        assertTrue(policy.isRoot(root)); assertFalse(policy.isRoot(child));
        assertTrue(PathPolicy.inside(child, root)); assertFalse(PathPolicy.inside(root, child));
    }
}
