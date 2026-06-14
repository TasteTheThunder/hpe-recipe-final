package com.hpe.recipe.service;

import com.hpe.recipe.model.ComponentSpec;
import com.hpe.recipe.model.HelmRelease;
import com.hpe.recipe.model.Recipe;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.transport.RefSpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Exercises {@link GitStateService} against a throwaway local bare repository (no network).
 * Each assertion that matters for "Git is the source of truth" is verified through a FRESH
 * clone, proving the state was persisted to Git rather than held in memory.
 */
class GitStateServiceTest {

    @TempDir
    Path tmp;

    private String remoteUri;

    @BeforeEach
    void setup() throws Exception {
        File remote = tmp.resolve("remote.git").toFile();
        Git.init().setBare(true).setInitialBranch("main").setDirectory(remote).call().close();
        remoteUri = remote.toURI().toString();

        // Seed an initial commit so 'main' exists on the remote.
        File seed = tmp.resolve("seed").toFile();
        try (Git g = Git.cloneRepository().setURI(remoteUri).setDirectory(seed).call()) {
            Files.writeString(new File(seed, "README.md").toPath(), "seed\n");
            g.add().addFilepattern("README.md").call();
            g.commit().setMessage("seed").call();
            g.push().setRefSpecs(new RefSpec("HEAD:refs/heads/main")).call();
        }
    }

    private GitStateService newService(String cloneName) {
        return new GitStateService(remoteUri, tmp.resolve(cloneName).toString(), "main", "user", "");
    }

    @Test
    void writesAndReadsVersionThroughGit() {
        newService("clone-a").writeVersion(sampleRelease("v0.16"));

        // Fresh clone -> proves persistence in Git, not memory.
        GitStateService fresh = newService("clone-b");
        assertThat(fresh.listVersions()).containsExactly("v0.16");
        assertThat(fresh.versionExists("v0.16")).isTrue();

        HelmRelease loaded = fresh.readVersion("v0.16");
        assertThat(loaded).isNotNull();
        assertThat(loaded.getVersion()).isEqualTo("v0.16");
        assertThat(loaded.getCatalogName()).isEqualTo("Recipe Detection");
        assertThat(loaded.getRecipes()).hasSize(1);

        Recipe rec = loaded.getRecipes().get(0);
        assertThat(rec.getVersion()).isEqualTo("1.0.0");
        assertThat(rec.getComponents()).containsKey("spark");
        ComponentSpec spark = rec.getComponents().get("spark");
        assertThat(spark.getVersion()).isEqualTo("3.5.0");
        assertThat(spark.getUpgradeFrom()).containsExactly("3.4.0");
        assertThat(spark.getUpgradeTo()).containsExactly("3.6.0");
    }

    @Test
    void environmentVersionOverwritesRatherThanAppends() {
        GitStateService svc = newService("clone-a");
        assertThat(svc.isEmpty()).isTrue();

        svc.setEnvironmentVersion("dev", "v0.16");
        assertThat(svc.readEnvironmentVersion("dev")).isEqualTo("v0.16");

        svc.setEnvironmentVersion("dev", "v0.17"); // overwrite, single current version
        assertThat(svc.readEnvironmentVersion("dev")).isEqualTo("v0.17");
        assertThat(svc.readAllEnvironments()).containsEntry("dev", "v0.17").hasSize(1);
        assertThat(svc.isEmpty()).isFalse();

        // Persisted to Git.
        assertThat(newService("clone-c").readEnvironmentVersion("dev")).isEqualTo("v0.17");

        // Deleting from all envs returns the system to empty.
        svc.deleteEnvironment("dev");
        assertThat(newService("clone-d").isEmpty()).isTrue();
    }

    @Test
    void environmentHistoryAppendsAndSupportsOneStepRollback() {
        GitStateService svc = newService("clone-a");
        svc.appendEnvironmentHistory("qa", "v0.16");
        svc.appendEnvironmentHistory("qa", "v0.17");
        assertThat(svc.readEnvironmentHistory("qa")).containsExactly("v0.16", "v0.17");

        // One-step rollback: pop the current so the previous becomes current.
        List<String> hist = new ArrayList<>(svc.readEnvironmentHistory("qa"));
        hist.remove(hist.size() - 1);
        svc.setEnvironmentHistory("qa", hist);

        assertThat(newService("clone-b").readEnvironmentHistory("qa")).containsExactly("v0.16");
    }

    @Test
    void eventLogAppendsInOrder() {
        GitStateService svc = newService("clone-a");
        svc.appendHistoryEvent(event("create", "v0.16", null, null));
        svc.appendHistoryEvent(event("promote", "v0.16", "qa", "dev"));

        List<Map<String, Object>> hist = newService("clone-b").readHistory();
        assertThat(hist).hasSize(2);
        assertThat(hist.get(0)).containsEntry("action", "create").containsEntry("version", "v0.16");
        assertThat(hist.get(1)).containsEntry("action", "promote")
                .containsEntry("env", "qa").containsEntry("fromVersion", "dev");
    }

    @Test
    void rejectsPathTraversalIds() {
        GitStateService svc = newService("clone-a");
        assertThatThrownBy(() -> svc.writeVersion(sampleRelease("../../evil")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> svc.readVersion("../../../etc/passwd"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> svc.setEnvironmentVersion("../x", "v0.16"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> svc.readEnvironmentVersion("a/b"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> svc.writeVersion(sampleRelease("   ")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void preservesNumericLookingVersionStringsFromExternalFiles() throws Exception {
        // A hand-edited version file with UNQUOTED numeric scalars on the remote.
        String raw = "recipeData:\n"
                + "  chartVersion: v9\n"
                + "  recipes:\n"
                + "    - version: \"1.0\"\n"
                + "      components:\n"
                + "        spark:\n"
                + "          version: 3.50\n"
                + "          upgrade_from: []\n"
                + "          upgrade_to: []\n";
        writeRawToRemote("catalogs/recipe-detection/versions/v9.yaml", raw);

        HelmRelease loaded = newService("clone-read").readVersion("v9");
        assertThat(loaded).isNotNull();
        assertThat(loaded.getRecipes()).hasSize(1);
        // Without a string-preserving loader, 3.50 parses as Double 3.5 -> "3.5".
        assertThat(loaded.getRecipes().get(0).getComponents().get("spark").getVersion())
                .isEqualTo("3.50");
    }

    // ---------- state cache (perf: reads don't fetch from the remote every time) ----------

    @Test
    void readReflectsOwnWriteWithoutRefetching() {
        GitStateService svc = newService("clone-a");
        svc.setEnvironmentVersion("dev", "v0.16"); // mutate: syncs, pushes, refreshes the cache window
        long syncsAfterWrite = svc.remoteSyncCountForTest();

        // The very next read must reflect our own write (no stale-after-own-write)...
        assertThat(svc.readEnvironmentVersion("dev")).isEqualTo("v0.16");
        // ...and must NOT have triggered another remote fetch (served from the fresh local clone).
        assertThat(svc.remoteSyncCountForTest()).isEqualTo(syncsAfterWrite);
    }

    @Test
    void readsWithinTtlAreServedLocallyWithoutRefetching() {
        newService("clone-writer").writeVersion(sampleRelease("v0.16")); // populate the remote

        GitStateService reader = newService("clone-reader"); // fresh instance: empty cache
        assertThat(reader.remoteSyncCountForTest()).isZero();

        assertThat(reader.listVersions()).containsExactly("v0.16"); // first read -> exactly one sync
        assertThat(reader.remoteSyncCountForTest()).isEqualTo(1);

        // Further reads within the (default 8s) TTL window must not hit the network again.
        reader.readEnvironmentVersion("dev");
        reader.readHistory();
        reader.listVersions();
        assertThat(reader.remoteSyncCountForTest()).isEqualTo(1);
    }

    @Test
    void readAfterTtlExpiryRefetches() {
        long[] clock = { 1_000_000L };
        GitStateService svc = new GitStateService(
                remoteUri, tmp.resolve("clone-clock").toString(), "main", "user", "") {
            @Override
            protected long nowMillis() {
                return clock[0];
            }
        };

        svc.listVersions(); // first read -> sync #1
        svc.listVersions(); // same instant, within TTL -> still one sync
        assertThat(svc.remoteSyncCountForTest()).isEqualTo(1);

        clock[0] += 9_000L; // advance past the default 8s TTL
        svc.listVersions(); // now stale -> sync #2
        assertThat(svc.remoteSyncCountForTest()).isEqualTo(2);
    }

    private void writeRawToRemote(String repoRelativePath, String content) throws Exception {
        File work = tmp.resolve("raw-clone").toFile();
        try (Git g = Git.cloneRepository().setURI(remoteUri).setDirectory(work).setBranch("main").call()) {
            File f = new File(work, repoRelativePath);
            f.getParentFile().mkdirs();
            Files.writeString(f.toPath(), content);
            g.add().addFilepattern(repoRelativePath).call();
            g.commit().setMessage("raw " + repoRelativePath)
                    .setAuthor("t", "t@t").setCommitter("t", "t@t").call();
            g.push().setRefSpecs(new RefSpec("HEAD:refs/heads/main")).call();
        }
    }

    private Map<String, Object> event(String action, String version, String env, String fromVersion) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("action", action);
        m.put("version", version);
        if (env != null) {
            m.put("env", env);
        }
        if (fromVersion != null) {
            m.put("fromVersion", fromVersion);
        }
        return m;
    }

    private HelmRelease sampleRelease(String version) {
        Map<String, ComponentSpec> comps = new LinkedHashMap<>();
        comps.put("spark", new ComponentSpec("3.5.0", "2024-01-01",
                new ArrayList<>(List.of("3.4.0")), new ArrayList<>(List.of("3.6.0"))));

        Recipe recipe = new Recipe();
        recipe.setVersion("1.0.0");
        recipe.setDescription("base recipe");
        recipe.setComponents(comps);
        recipe.setUpgradeTo(new ArrayList<>());
        recipe.setUpgradeFrom(new ArrayList<>());

        HelmRelease r = new HelmRelease();
        r.setVersion(version);
        r.setCatalogName("Recipe Detection");
        r.setRecipes(new ArrayList<>(List.of(recipe)));
        return r;
    }
}
