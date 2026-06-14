package com.hpe.recipe.service;

import com.hpe.recipe.model.HelmRelease;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.ResetCommand;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.representer.Representer;
import org.yaml.snakeyaml.resolver.Resolver;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Git-backed source of truth for catalog deployment state. Sits beside {@link GitOpsService}
 * and reuses the same JGit + credentials configuration (gitops.*), but maintains its own
 * working clone so it can read/write the platform-state layout without disturbing the
 * existing values-file generation.
 *
 * <pre>
 * catalogs/recipe-detection/
 *   versions/v0.16.yaml          full catalog version (recipeData shape, cluster-agnostic)
 *   environments/dev.yaml        { catalogVersion: v0.16 }  -- single current version per env
 *   environment-history/qa.yaml  [v0.16, v0.17]             -- ordered, drives one-step rollback
 *   history.yaml                 [ {timestamp, action, version, env, actor, fromVersion?}, ... ]
 * </pre>
 *
 * Mutates always hard-sync the local clone to the remote branch first (so a write lands on top
 * of the latest state); reads hard-sync only when the cached clone is older than a short TTL
 * ({@code gitops.state-cache-ttl-seconds}), otherwise they are served from the local clone with
 * no network round-trip — this removes the per-read GitHub fetch that made the UI laggy. Git
 * stays authoritative either way: a fresh service (e.g. after a backend restart) has an empty
 * cache and syncs on its first read, and every mutate refreshes the window so this backend's own
 * writes are always visible immediately. Push-bearing work is serialized with {@link GitOpsService}
 * via {@link GitSupport#REMOTE_LOCK} and verified + retried so a concurrent push to the shared
 * branch can't silently drop a state write.
 */
@Service
public class GitStateService {

    private static final Logger log = LoggerFactory.getLogger(GitStateService.class);

    public static final String CATALOG_ID = "recipe-detection";
    private static final String BASE = "catalogs/" + CATALOG_ID;
    private static final String VERSIONS_DIR = BASE + "/versions";
    private static final String ENVIRONMENTS_DIR = BASE + "/environments";
    private static final String ENV_HISTORY_DIR = BASE + "/environment-history";
    private static final String HISTORY_FILE = BASE + "/history.yaml";
    private static final int MAX_PUSH_ATTEMPTS = 3;
    /** Default state-cache TTL (seconds) when {@code gitops.state-cache-ttl-seconds} is unset. */
    private static final long DEFAULT_STATE_CACHE_TTL_SECONDS = 8;

    private final String repoUrl;
    private final String localPath;
    private final String branch;
    private final String username;
    private final String token;

    /**
     * How long a remote sync stays "fresh": within this window reads are served from the local
     * clone with no GitHub fetch. A few seconds trades a small cross-process staleness for the
     * elimination of a network round-trip on every read — changes made by THIS backend are always
     * visible immediately because each mutate refreshes the window. Configurable via
     * {@code gitops.state-cache-ttl-seconds}.
     */
    private final long stateCacheTtlMillis;
    /** Wall-clock millis of the last successful remote sync; 0 = never (first read always syncs). */
    private volatile long lastSyncedAtMillis = 0L;
    /** Count of real remote syncs (fetch+reset) performed — observable by tests. */
    private final AtomicLong remoteSyncCount = new AtomicLong(0);

    /** Spring wiring: cache TTL comes from {@code gitops.state-cache-ttl-seconds} (default 8s). */
    @Autowired
    public GitStateService(
            @Value("${gitops.repo-url}") String repoUrl,
            @Value("${gitops.state-path}") String localPath,
            @Value("${gitops.branch}") String branch,
            @Value("${gitops.username}") String username,
            @Value("${gitops.token}") String token,
            @Value("${gitops.state-cache-ttl-seconds:8}") long stateCacheTtlSeconds) {
        this.repoUrl = repoUrl;
        this.localPath = localPath;
        this.branch = branch;
        this.username = username;
        this.token = token;
        this.stateCacheTtlMillis = Math.max(0L, stateCacheTtlSeconds) * 1000L;
    }

    /** Convenience constructor (tests / programmatic use): uses the default cache TTL. */
    public GitStateService(String repoUrl, String localPath, String branch,
                           String username, String token) {
        this(repoUrl, localPath, branch, username, token, DEFAULT_STATE_CACHE_TTL_SECONDS);
    }

    // ===================== VERSIONS =====================

    /** All version ids (file name minus .yaml) under versions/, sorted. */
    public List<String> listVersions() {
        return read(repo -> {
            File dir = new File(repo, VERSIONS_DIR);
            File[] files = dir.listFiles((d, name) -> name.endsWith(".yaml"));
            if (files == null) {
                return new ArrayList<String>();
            }
            return Arrays.stream(files)
                    .map(f -> f.getName().replaceFirst("\\.yaml$", ""))
                    .sorted()
                    .collect(Collectors.toList());
        });
    }

    public boolean versionExists(String version) {
        String v = validateId("version", version);
        return read(repo -> new File(repo, VERSIONS_DIR + "/" + v + ".yaml").isFile());
    }

    /** Parse versions/&lt;version&gt;.yaml back into a HelmRelease (recipes/components), or null. */
    public HelmRelease readVersion(String version) {
        String v = validateId("version", version);
        return read(repo -> {
            String content = readFileOrNull(new File(repo, VERSIONS_DIR + "/" + v + ".yaml"));
            return content == null ? null : parseVersion(v, content);
        });
    }

    /** Write (create or overwrite) versions/&lt;version&gt;.yaml from a HelmRelease. */
    public void writeVersion(HelmRelease release) {
        String version = validateId("version", release == null ? null : release.getVersion());
        mutate("catalog: write version " + version, repo ->
                writeFile(new File(repo, VERSIONS_DIR + "/" + version + ".yaml"), serializeVersion(release)));
    }

    public void deleteVersion(String version) {
        String v = validateId("version", version);
        mutate("catalog: delete version " + v, repo -> {
            File f = new File(repo, VERSIONS_DIR + "/" + v + ".yaml");
            if (f.exists()) {
                f.delete();
            }
        });
    }

    // ===================== ENVIRONMENTS =====================

    /** Current catalog version for an environment, or null if the env has none. */
    public String readEnvironmentVersion(String env) {
        String e = validateId("environment", env);
        return read(repo -> {
            Map<String, Object> m = loadMap(new File(repo, ENVIRONMENTS_DIR + "/" + e + ".yaml"));
            return m == null ? null : str(m.get("catalogVersion"));
        });
    }

    /** env -> current version, only for environments that currently hold a version. */
    public Map<String, String> readAllEnvironments() {
        return read(repo -> {
            File dir = new File(repo, ENVIRONMENTS_DIR);
            File[] files = dir.listFiles((d, name) -> name.endsWith(".yaml"));
            Map<String, String> result = new LinkedHashMap<>();
            if (files == null) {
                return result;
            }
            for (File f : files) {
                String env = f.getName().replaceFirst("\\.yaml$", "");
                Map<String, Object> m = loadMap(f);
                String v = m == null ? null : str(m.get("catalogVersion"));
                if (v != null && !v.isBlank()) {
                    result.put(env, v);
                }
            }
            return result;
        });
    }

    /** Overwrite the single current version for an environment (promotion/rollback semantics). */
    public void setEnvironmentVersion(String env, String version) {
        String e = validateId("environment", env);
        String v = validateId("version", version);
        mutate("catalog: set " + e + " -> " + v, repo -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("catalogVersion", v);
            writeFile(new File(repo, ENVIRONMENTS_DIR + "/" + e + ".yaml"), dumpYaml().dump(m));
        });
    }

    public void deleteEnvironment(String env) {
        String e = validateId("environment", env);
        mutate("catalog: clear environment " + e, repo -> {
            File f = new File(repo, ENVIRONMENTS_DIR + "/" + e + ".yaml");
            if (f.exists()) {
                f.delete();
            }
        });
    }

    /** True when no environment currently holds a version (drives create-only-when-empty). */
    public boolean isEmpty() {
        return readAllEnvironments().isEmpty();
    }

    // ===================== ENVIRONMENT HISTORY =====================

    /** Ordered list of versions this environment has held (last = current). */
    public List<String> readEnvironmentHistory(String env) {
        String e = validateId("environment", env);
        return read(repo -> loadStringList(new File(repo, ENV_HISTORY_DIR + "/" + e + ".yaml")));
    }

    /**
     * Histories for several environments in ONE synced read, instead of one {@link #read} per env.
     * Returns env -&gt; ordered history (absent/empty files map to an empty list). Lets callers that
     * need the whole pipeline's histories at once (e.g. promotion options) avoid re-opening and
     * re-syncing the clone per environment.
     */
    public Map<String, List<String>> readEnvironmentHistories(List<String> envs) {
        List<String> validated = new ArrayList<>();
        for (String env : envs) {
            validated.add(validateId("environment", env));
        }
        return read(repo -> {
            Map<String, List<String>> result = new LinkedHashMap<>();
            for (String e : validated) {
                result.put(e, loadStringList(new File(repo, ENV_HISTORY_DIR + "/" + e + ".yaml")));
            }
            return result;
        });
    }

    public void appendEnvironmentHistory(String env, String version) {
        String e = validateId("environment", env);
        String v = validateId("version", version);
        mutate("catalog: history " + e + " += " + v, repo -> {
            File f = new File(repo, ENV_HISTORY_DIR + "/" + e + ".yaml");
            List<String> list = loadStringList(f);
            list.add(v);
            writeFile(f, dumpYaml().dump(list));
        });
    }

    /** Overwrite the ordered history (used by rollback to pop the current version). */
    public void setEnvironmentHistory(String env, List<String> versions) {
        String e = validateId("environment", env);
        List<String> validated = new ArrayList<>();
        for (String version : versions) {
            validated.add(validateId("version", version));
        }
        mutate("catalog: history " + e + " = " + validated, repo ->
                writeFile(new File(repo, ENV_HISTORY_DIR + "/" + e + ".yaml"), dumpYaml().dump(validated)));
    }

    // ===================== EVENT LOG =====================

    /** Append-only human-facing event log for the Deployment History UI. */
    public List<Map<String, Object>> readHistory() {
        return read(repo -> loadMapList(new File(repo, HISTORY_FILE)));
    }

    public void appendHistoryEvent(Map<String, Object> event) {
        mutate("catalog: event " + (event == null ? "" : event.get("action")), repo -> {
            File f = new File(repo, HISTORY_FILE);
            List<Map<String, Object>> list = loadMapList(f);
            list.add(event);
            writeFile(f, dumpYaml().dump(list));
        });
    }

    // ===================== GIT MECHANICS =====================

    private <T> T read(Function<File, T> reader) {
        synchronized (GitSupport.REMOTE_LOCK) {
            try (Git git = openOrClone()) {
                syncIfStale(git); // TTL-gated: no GitHub fetch when the local clone is still fresh
                return reader.apply(new File(localPath));
            } catch (Exception e) {
                throw new RuntimeException("Git state read failed: " + e.getMessage(), e);
            }
        }
    }

    /**
     * Apply a mutation, commit, and push — retrying on a non-fast-forward rejection. The retry
     * re-syncs to the (now advanced) remote and RE-APPLIES the mutator, so an append/overwrite
     * lands on top of the latest state instead of being silently lost.
     */
    private void mutate(String message, Consumer<File> mutator) {
        synchronized (GitSupport.REMOTE_LOCK) {
            try (Git git = openOrClone()) {
                for (int attempt = 1; ; attempt++) {
                    syncToRemote(git);
                    mutator.accept(new File(localPath));
                    git.add().addFilepattern(BASE).call();
                    git.add().setUpdate(true).addFilepattern(BASE).call();
                    if (git.status().call().isClean()) {
                        markSynced(); // synced + nothing to write -> local == remote; reads can skip re-fetch
                        return;
                    }
                    git.commit()
                            .setMessage(message)
                            .setAuthor("Recipe Detection", "recipe-detection@hpe.com")
                            .setCommitter("Recipe Detection", "recipe-detection@hpe.com")
                            .call();
                    var results = git.push().setCredentialsProvider(creds()).call();
                    if (GitSupport.pushAccepted(results)) {
                        markSynced(); // our push advanced remote to local; reads reflect it without re-fetch
                        return;
                    }
                    if (attempt >= MAX_PUSH_ATTEMPTS) {
                        throw new IllegalStateException("Git push rejected after " + attempt
                                + " attempts (remote moved): " + GitSupport.pushFailureDetail(results));
                    }
                    log.warn("Git state push rejected (attempt {}/{}), re-syncing and retrying: {}",
                            attempt, MAX_PUSH_ATTEMPTS, GitSupport.pushFailureDetail(results));
                    // Loop: syncToRemote() hard-resets (discarding our rejected commit), mutator re-runs.
                }
            } catch (Exception e) {
                throw new RuntimeException("Git state mutate failed: " + e.getMessage(), e);
            }
        }
    }

    private Git openOrClone() throws Exception {
        File repoDir = new File(localPath);
        if (repoDir.exists() && new File(repoDir, ".git").exists()) {
            try {
                return Git.open(repoDir);
            } catch (IOException e) {
                deleteDirectory(repoDir);
            }
        }
        return Git.cloneRepository()
                .setURI(repoUrl)
                .setDirectory(repoDir)
                .setBranch(branch)
                .setCredentialsProvider(creds())
                .call();
    }

    /**
     * Sync the working clone to the remote branch only if the cached state is older than the TTL.
     * Within the TTL window this is a no-op (no network), which is what removes the per-read GitHub
     * fetch. A brand-new service (lastSyncedAtMillis = 0) is always stale on its first read, so a
     * restart re-syncs immediately and Git stays authoritative.
     */
    private void syncIfStale(Git git) throws Exception {
        if (nowMillis() - lastSyncedAtMillis > stateCacheTtlMillis) {
            syncToRemote(git);
        }
    }

    /**
     * Hard-sync the working clone to the remote branch so reads/writes start from truth, then
     * clean any untracked leftovers under BASE (e.g. a file written by a mutate that failed
     * before commit) so they can't be re-staged into a later unrelated commit. Refreshes the
     * freshness window so immediately-following reads don't re-fetch.
     */
    private void syncToRemote(Git git) throws Exception {
        git.fetch().setCredentialsProvider(creds()).call();
        git.reset().setMode(ResetCommand.ResetType.HARD).setRef("origin/" + branch).call();
        git.clean().setCleanDirectories(true).setForce(true).setPaths(Set.of(BASE)).call();
        remoteSyncCount.incrementAndGet();
        markSynced();
    }

    /** Mark the local clone fresh as of now (after a sync, or after our own mutate pushed). */
    private void markSynced() {
        lastSyncedAtMillis = nowMillis();
    }

    /** Wall-clock millis; overridable in tests to exercise TTL expiry deterministically. */
    protected long nowMillis() {
        return System.currentTimeMillis();
    }

    /** Number of real remote syncs performed so far — for tests asserting the cache is used. */
    long remoteSyncCountForTest() {
        return remoteSyncCount.get();
    }

    private UsernamePasswordCredentialsProvider creds() {
        return new UsernamePasswordCredentialsProvider(username, token);
    }

    /** Reject ids that would escape the catalog subtree or produce bogus file names. */
    private static String validateId(String kind, String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException(kind + " must not be blank");
        }
        String trimmed = id.trim();
        if (trimmed.contains("..") || trimmed.contains("/") || trimmed.contains("\\")) {
            throw new IllegalArgumentException(
                    "Invalid " + kind + " '" + id + "' (must not contain '..', '/', or '\\')");
        }
        return trimmed;
    }

    // ===================== YAML <-> MODEL =====================

    /** recipeData shape, cluster-agnostic (no target_cluster/values_file — those are per-deploy). */
    private String serializeVersion(HelmRelease release) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("recipeData", RecipeDataMapper.toRecipeData(release));
        return dumpYaml().dump(root);
    }

    @SuppressWarnings("unchecked")
    private HelmRelease parseVersion(String versionId, String content) {
        Object loaded = loadYaml().load(content);
        if (!(loaded instanceof Map)) {
            return null;
        }
        Map<String, Object> root = (Map<String, Object>) loaded;
        Object rdObj = root.get("recipeData");
        Map<String, Object> rd = rdObj instanceof Map ? (Map<String, Object>) rdObj : root;
        return RecipeDataMapper.fromRecipeData(rd, versionId);
    }

    // ===================== FILE / YAML HELPERS =====================

    private Yaml dumpYaml() {
        DumperOptions o = new DumperOptions();
        o.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        o.setPrettyFlow(true);
        return new Yaml(o);
    }

    /**
     * Loader whose resolver registers no implicit type rules, so every plain scalar stays a
     * String. This preserves version-like values ("3.50", "1.0", "0.16") that a hand-edited
     * file may leave unquoted, instead of coercing them to Double/Integer and losing precision.
     * Uses SafeConstructor for good measure.
     */
    private Yaml loadYaml() {
        LoaderOptions loaderOptions = new LoaderOptions();
        DumperOptions dumperOptions = new DumperOptions();
        return new Yaml(new SafeConstructor(loaderOptions), new Representer(dumperOptions),
                dumperOptions, loaderOptions, new StringResolver());
    }

    private static final class StringResolver extends Resolver {
        @Override
        protected void addImplicitResolvers() {
            // Intentionally empty: no scalar is auto-typed, so all plain scalars resolve to String.
        }
    }

    private String readFileOrNull(File f) {
        try {
            return f.isFile() ? Files.readString(f.toPath()) : null;
        } catch (IOException e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> loadMap(File f) {
        String content = readFileOrNull(f);
        if (content == null || content.isBlank()) {
            return null;
        }
        Object loaded = loadYaml().load(content);
        return loaded instanceof Map ? (Map<String, Object>) loaded : null;
    }

    @SuppressWarnings("unchecked")
    private List<String> loadStringList(File f) {
        String content = readFileOrNull(f);
        List<String> result = new ArrayList<>();
        if (content == null || content.isBlank()) {
            return result;
        }
        Object loaded = loadYaml().load(content);
        if (loaded instanceof List<?> list) {
            for (Object o : list) {
                if (o != null) {
                    result.add(String.valueOf(o));
                }
            }
        } else if (loaded instanceof Map<?, ?> m) {
            Object v = ((Map<String, Object>) m).get("versions");
            if (v instanceof List<?> vl) {
                for (Object o : vl) {
                    if (o != null) {
                        result.add(String.valueOf(o));
                    }
                }
            }
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> loadMapList(File f) {
        String content = readFileOrNull(f);
        List<Map<String, Object>> result = new ArrayList<>();
        if (content == null || content.isBlank()) {
            return result;
        }
        Object loaded = loadYaml().load(content);
        if (loaded instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map) {
                    result.add((Map<String, Object>) o);
                }
            }
        }
        return result;
    }

    private void writeFile(File file, String content) {
        try {
            File parent = file.getParentFile();
            if (parent != null) {
                parent.mkdirs();
            }
            Files.writeString(file.toPath(), content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("Failed to write " + file, e);
        }
    }

    private void deleteDirectory(File dir) {
        if (dir.isDirectory()) {
            File[] children = dir.listFiles();
            if (children != null) {
                for (File c : children) {
                    deleteDirectory(c);
                }
            }
        }
        dir.delete();
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
