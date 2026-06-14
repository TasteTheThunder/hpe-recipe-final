package com.hpe.recipe.service;

import com.hpe.recipe.config.PromotionProperties;
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
 * Logic tests for the Git-backed write paths. A real {@link GitStateService} runs against a
 * throwaway local bare repo; Git rendering and Jenkins are stubbed so the test exercises the
 * orchestration/validation (create-when-empty, sequential promotion, one-step rollback,
 * dev-fork-on-edit) without a cluster or CI.
 */
class CatalogPlatformServiceTest {

    @TempDir
    Path tmp;

    private String remoteUri;

    @BeforeEach
    void setup() throws Exception {
        File remote = tmp.resolve("remote.git").toFile();
        Git.init().setBare(true).setInitialBranch("main").setDirectory(remote).call().close();
        remoteUri = remote.toURI().toString();
        File seed = tmp.resolve("seed").toFile();
        try (Git g = Git.cloneRepository().setURI(remoteUri).setDirectory(seed).call()) {
            Files.writeString(new File(seed, "README.md").toPath(), "seed\n");
            g.add().addFilepattern("README.md").call();
            g.commit().setMessage("seed").call();
            g.push().setRefSpecs(new RefSpec("HEAD:refs/heads/main")).call();
        }
    }

    @Test
    void createOnlyWhenEmpty() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        assertThat(svc.isEmpty()).isTrue();

        HelmRelease created = svc.createVersion(sampleRelease("0.16"));
        assertThat(created.getVersion()).isEqualTo("0.16");
        assertThat(svc.versions()).containsExactly("0.16");

        // Once a version exists, create is rejected (Edit-forks-new-version is the path instead).
        assertThatThrownBy(() -> svc.createVersion(sampleRelease("0.17")))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void deployToDevWritesGitStateAndTriggersJenkins() {
        RecordingJenkins jenkins = new RecordingJenkins();
        CatalogPlatformService svc = newPlatform(jenkins);
        svc.createVersion(sampleRelease("0.16"));

        svc.deployToDev("v0.16"); // leading v is tolerated and normalized

        assertThat(svc.environments()).containsEntry("dev", "0.16");
        assertThat(jenkins.triggers).contains("dev@0.16");
        assertThat(svc.history()).extracting(e -> e.get("action")).contains("create", "deploy");
    }

    @Test
    void promoteIsSequentialAndRejectsSkips() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        svc.deployToDev("0.16");

        // dev -> integration skips qa: rejected, naming the required previous stage.
        assertThatThrownBy(() -> svc.promote("0.16", "integration"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("QA");

        svc.promote("0.16", "qa");
        assertThat(svc.environments()).containsEntry("qa", "0.16");

        // now the next stage is allowed
        svc.promote("0.16", "integration");
        assertThat(svc.environments()).containsEntry("integration", "0.16");
    }

    @Test
    void rollbackIsOneStepAndQaIntProdOnly() {
        RecordingJenkins jenkins = new RecordingJenkins();
        CatalogPlatformService svc = newPlatform(jenkins);
        svc.createVersion(sampleRelease("0.16"));
        svc.deployToDev("0.16");
        svc.promote("0.16", "qa");

        // fork 0.17 on dev and promote to qa -> qa history [0.16, 0.17]
        svc.editDev(sampleRelease("ignored"));
        svc.promote("0.17", "qa");
        assertThat(svc.environments()).containsEntry("qa", "0.17");

        // one step back: qa returns to 0.16 and is redeployed
        svc.rollback("qa");
        assertThat(svc.environments()).containsEntry("qa", "0.16");
        assertThat(jenkins.triggers).contains("qa@0.16");

        // no previous left -> disabled
        assertThatThrownBy(() -> svc.rollback("qa")).isInstanceOf(IllegalStateException.class);
        // dev is edit-only -> rollback not offered
        assertThatThrownBy(() -> svc.rollback("dev")).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void editDevForksNewVersionLeavingPromotedImmutable() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        svc.deployToDev("0.16");
        svc.promote("0.16", "qa");

        HelmRelease forked = svc.editDev(sampleRelease("ignored"));

        assertThat(forked.getVersion()).isEqualTo("0.17");
        assertThat(svc.environments()).containsEntry("dev", "0.17").containsEntry("qa", "0.16");
        assertThat(svc.versions()).contains("0.16", "0.17");
        // promoted version 0.16 is untouched
        assertThat(svc.version("0.16").getVersion()).isEqualTo("0.16");
    }

    @Test
    void nextTargetAdvancesForwardFromFurthestStage() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        svc.deployToDev("0.16");
        svc.promote("0.16", "qa");
        svc.editDev(sampleRelease("ignored")); // forks 0.17 onto dev -> dev=0.17, qa=0.16

        assertThat(svc.promotionOptions("0.16")).containsEntry("nextTarget", "integration");
        assertThat(svc.promotionOptions("0.17")).containsEntry("nextTarget", "qa");
        // 0.16 (live in qa) may only go forward to integration — never back to dev/qa or skip to prod.
        assertThat(svc.promotionOptions("0.16").get("allowedTargets")).isEqualTo(List.of("integration"));
    }

    @Test
    void noNextTargetForUndeployedOrProd() {
        GitStateService gs = new GitStateService(
                remoteUri, tmp.resolve("state-clone").toString(), "main", "user", "");
        CatalogPlatformService svc = new CatalogPlatformService(
                gs, new NoopGitOps(), new RecordingJenkins(), new PromotionProperties());

        gs.writeVersion(sampleRelease("0.16")); // exists in Git, deployed nowhere
        assertThat(svc.promotionOptions("0.16")).doesNotContainKey("nextTarget");
        assertThat(svc.promotionOptions("0.16").get("allowedTargets")).isEqualTo(List.of());

        gs.writeVersion(sampleRelease("9.9"));
        gs.setEnvironmentVersion("prod", "9.9"); // sitting in the last stage
        assertThat(svc.promotionOptions("9.9")).doesNotContainKey("nextTarget");
    }

    @Test
    void multipleVersionsPromoteForwardIndependently() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        svc.deployToDev("0.16");
        svc.promote("0.16", "qa");
        svc.editDev(sampleRelease("ignored")); // dev=0.17, qa=0.16

        svc.promote("0.16", "integration"); // older version races ahead: qa -> integration
        svc.promote("0.17", "qa");           // newer version trails: dev -> qa, replacing 0.16

        assertThat(svc.environments())
                .containsEntry("integration", "0.16")
                .containsEntry("qa", "0.17");

        // qa held 0.16 then 0.17 -> one-step rollback target is preserved.
        GitStateService fresh = new GitStateService(
                remoteUri, tmp.resolve("verify-clone").toString(), "main", "user", "");
        assertThat(fresh.readEnvironmentHistory("qa")).containsExactly("0.16", "0.17");
    }

    @Test
    void deleteVersionUninstallsClearsPointersAndRemovesFile() {
        RecordingJenkins jenkins = new RecordingJenkins();
        CatalogPlatformService svc = newPlatform(jenkins);
        svc.createVersion(sampleRelease("0.16"));
        svc.deployToDev("0.16");
        svc.promote("0.16", "qa"); // 0.16 live in dev AND qa

        svc.deleteVersion("0.16");

        assertThat(svc.environments()).doesNotContainKeys("dev", "qa");
        assertThat(svc.versions()).doesNotContain("0.16");
        assertThat(jenkins.actions).contains("uninstall:dev:0.16", "uninstall:qa:0.16");
        assertThat(svc.history()).extracting(e -> e.get("action")).contains("uninstall", "delete");
    }

    @Test
    void deleteVersionLiveInTwoEnvsUninstallsBoth() {
        GitStateService gs = new GitStateService(
                remoteUri, tmp.resolve("state-clone").toString(), "main", "user", "");
        RecordingJenkins jenkins = new RecordingJenkins();
        CatalogPlatformService svc = new CatalogPlatformService(
                gs, new NoopGitOps(), jenkins, new PromotionProperties());
        gs.writeVersion(sampleRelease("0.16"));
        gs.setEnvironmentVersion("integration", "0.16");
        gs.setEnvironmentVersion("prod", "0.16");

        svc.deleteVersion("0.16");

        assertThat(jenkins.actions).contains("uninstall:integration:0.16", "uninstall:prod:0.16");
        assertThat(svc.environments()).doesNotContainKeys("integration", "prod");
        assertThat(svc.versions()).doesNotContain("0.16");
    }

    @Test
    void deletingLastVersionReturnsToEmptyState() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        svc.deployToDev("0.16");

        svc.deleteVersion("0.16");

        assertThat(svc.isEmpty()).isTrue();
        assertThat(svc.versions()).isEmpty();
    }

    @Test
    void deletingUnknownVersionIsNoOp() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));

        svc.deleteVersion("9.9"); // exists nowhere

        assertThat(svc.versions()).contains("0.16");
    }

    @Test
    void deleteRejectsPathTraversalId() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        assertThatThrownBy(() -> svc.deleteVersion("../../evil"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ---------- helpers / stubs ----------

    private CatalogPlatformService newPlatform(RecordingJenkins jenkins) {
        GitStateService gitState = new GitStateService(
                remoteUri, tmp.resolve("state-clone").toString(), "main", "user", "");
        return new CatalogPlatformService(gitState, new NoopGitOps(), jenkins, new PromotionProperties());
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

    /** Records triggers instead of calling Jenkins. */
    static final class RecordingJenkins extends JenkinsService {
        final List<String> triggers = new ArrayList<>();
        final List<String> actions = new ArrayList<>();

        RecordingJenkins() {
            super("user", "token", "http://localhost:8080", "job");
        }

        @Override
        public void trigger(String cluster, String action, String chartVersion, String valuesFile) {
            triggers.add(cluster + "@" + chartVersion);
            actions.add(action + ":" + cluster + ":" + chartVersion);
        }
    }

    /** Skips the real clone/render/push of the chart values file. */
    static final class NoopGitOps extends GitOpsService {
        @Override
        public void generateAndPush(HelmRelease release) {
            // no-op
        }

        @Override
        public String resolveValuesFileName(HelmRelease release) {
            return "values-v" + release.getVersion() + ".yaml";
        }
    }
}
