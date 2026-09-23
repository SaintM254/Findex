package app.findex.files.storage;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/** All callers, including assistant plans, pass through this boundary. */
public final class PathPolicy {
    private final List<File> roots = new ArrayList<>();
    public PathPolicy(List<File> roots) throws IOException {
        for (File root : roots) this.roots.add(root.getCanonicalFile());
    }
    public File requireAllowed(File file, boolean internal) throws IOException {
        File canonical = file.getCanonicalFile();
        File root = null;
        for (File candidate : roots) if (inside(canonical, candidate)) { root = candidate; break; }
        if (root == null) throw new SecurityException("This path is outside shared storage.");
        String relative = canonical.getPath().substring(root.getPath().length());
        if (relative.equals("/Android/data") || relative.startsWith("/Android/data/") || relative.equals("/Android/obb") || relative.startsWith("/Android/obb/")) {
            throw new SecurityException("Android protects this app directory.");
        }
        if (!internal && (relative.equals("/.findex-trash") || relative.startsWith("/.findex-trash/") || relative.equals("/.findex-staging") || relative.startsWith("/.findex-staging/"))) {
            throw new SecurityException("This directory is managed internally by Findex.");
        }
        // Never traverse symlinks, even if their current target happens to be permitted.
        File cursor = file.getAbsoluteFile();
        while (cursor != null && !roots.contains(cursor)) {
            if (Files.isSymbolicLink(cursor.toPath())) throw new SecurityException("Symbolic links are not followed.");
            cursor = cursor.getParentFile();
        }
        return canonical;
    }
    public File rootFor(File file) throws IOException {
        File canonical = file.getCanonicalFile();
        for (File root : roots) if (inside(canonical, root)) return root;
        throw new SecurityException("No permitted storage volume contains this file.");
    }
    public boolean isRoot(File file) throws IOException { return roots.contains(file.getCanonicalFile()); }
    public static boolean inside(File file, File parent) throws IOException {
        String path = file.getCanonicalPath(), root = parent.getCanonicalPath();
        return path.equals(root) || path.startsWith(root + File.separator);
    }
    public static String validName(String input) {
        String name = input.trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) throw new IllegalArgumentException("Enter a valid name.");
        if (name.contains("/") || name.contains("\\") || name.chars().anyMatch(c -> c < 32)) throw new IllegalArgumentException("Names cannot contain slashes or control characters.");
        if (name.getBytes(StandardCharsets.UTF_8).length > 240) throw new IllegalArgumentException("This name is too long.");
        if (name.equals(".findex-trash") || name.equals(".findex-staging")) throw new IllegalArgumentException("This name is reserved for Findex.");
        return name;
    }
    public static File uniqueDestination(File parent, String originalName) {
        String name = validName(originalName);
        File candidate = new File(parent, name);
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String suffix = dot > 0 ? name.substring(dot) : "";
        int number = 1;
        while (candidate.exists()) candidate = new File(parent, stem + " (" + number++ + ")" + suffix);
        return candidate;
    }
}
