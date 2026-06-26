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
    void createAndDeployToDevIsAllowedWhenDevHasNoActiveCatalog() {
        RecordingJenkins jenkins = new RecordingJenkins();
        GitStateService gs = new GitStateService(
                remoteUri, tmp.resolve("state-clone").toString(), "main", "user", "");
        CatalogPlatformService svc = new CatalogPlatformService(
                gs, new NoopGitOps(), jenkins, new PromotionProperties());

        gs.writeVersion(sampleRelease("0.15")); // historical/catalog version exists, but DEV is empty

        HelmRelease created = svc.createAndDeployToDev(sampleRelease("0.16"));
        svc.completeDeployment("0.16", "dev", "create_deploy", null);

        assertThat(created.getVersion()).isEqualTo("0.16");
        assertThat(svc.environments()).containsEntry("dev", "0.16");
        assertThat(gs.readEnvironmentHistory("dev")).containsExactly("0.16");
        assertThat(jenkins.triggers).contains("dev@0.16");
        assertThat(svc.history()).extracting(e -> e.get("action")).contains("create", "deploy");
    }

    @Test
    void createAndDeployToDevRequiresEmptyDevAndNewVersion() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        deploySucceeded(svc, "0.16");

        assertThatThrownBy(() -> svc.createAndDeployToDev(sampleRelease("0.17")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DEV has no deployed catalog");

        GitStateService gs = new GitStateService(
                remoteUri, tmp.resolve("state-clone-duplicate").toString(), "main", "user", "");
        gs.deleteEnvironment("dev");
        CatalogPlatformService devEmpty = new CatalogPlatformService(
                gs, new NoopGitOps(), new RecordingJenkins(), new PromotionProperties());
        gs.writeVersion(sampleRelease("0.18"));

        assertThatThrownBy(() -> devEmpty.createAndDeployToDev(sampleRelease("0.18")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Version already exists");
    }

    @Test
    void deployToDevWritesGitStateOnlyAfterJenkinsSuccess() {
        RecordingJenkins jenkins = new RecordingJenkins();
        CatalogPlatformService svc = newPlatform(jenkins);
        svc.createVersion(sampleRelease("0.16"));

        svc.deployToDev("v0.16"); // leading v is tolerated and normalized

        assertThat(svc.environments()).doesNotContainKey("dev");
        assertThat(jenkins.triggers).contains("dev@0.16");
        assertThat(svc.history()).extracting(e -> e.get("action")).contains("create").doesNotContain("deploy");

        svc.completeDeployment("0.16", "dev", "deploy", null);

        assertThat(svc.environments()).containsEntry("dev", "0.16");
        assertThat(svc.history()).extracting(e -> e.get("action")).contains("deploy");
    }

    @Test
    void promoteIsSequentialAndRejectsSkips() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        deploySucceeded(svc, "0.16");

        // dev -> integration skips qa: rejected, naming the required previous stage.
        assertThatThrownBy(() -> svc.promote("0.16", "integration"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("QA");

        promoteSucceeded(svc, "0.16", "qa", "dev");
        assertThat(svc.environments()).containsEntry("qa", "0.16");

        // now the next stage is allowed
        promoteSucceeded(svc, "0.16", "integration", "qa");
        assertThat(svc.environments()).containsEntry("integration", "0.16");
    }

    @Test
    void rollbackIsOneStepForAnyEnvironment() {
        RecordingJenkins jenkins = new RecordingJenkins();
        CatalogPlatformService svc = newPlatform(jenkins);
        svc.createVersion(sampleRelease("0.16"));
        deploySucceeded(svc, "0.16");
        promoteSucceeded(svc, "0.16", "qa", "dev");

        // fork 0.17 on dev and promote to qa -> qa history [0.16, 0.17]
        editSucceeded(svc, sampleRelease("ignored"));
        promoteSucceeded(svc, "0.17", "qa", "dev");
        assertThat(svc.environments()).containsEntry("qa", "0.17");

        // one step back: qa returns to 0.16 and the successful rollback is appended.
        svc.rollback("qa");
        svc.completeDeployment("0.16", "qa", "rollback", "0.17");
        assertThat(svc.environments()).containsEntry("qa", "0.16");
        assertThat(jenkins.triggers).contains("qa@0.16");
        GitStateService afterRollback = new GitStateService(
                remoteUri, tmp.resolve("verify-rollback-clone").toString(), "main", "user", "");
        assertThat(afterRollback.readEnvironmentHistory("qa")).containsExactly("0.16", "0.17", "0.16");

        // Promoting the same version forward again appends another successful deployment entry.
        promoteSucceeded(svc, "0.17", "qa", "dev");
        assertThat(svc.environments()).containsEntry("qa", "0.17");
        GitStateService afterRepromote = new GitStateService(
                remoteUri, tmp.resolve("verify-repromote-clone").toString(), "main", "user", "");
        assertThat(afterRepromote.readEnvironmentHistory("qa")).containsExactly("0.16", "0.17", "0.16", "0.17");

        // dev history is also rollback-capable after an edit.
        Map<?, ?> rollbackOptions = (Map<?, ?>) svc.promotionOptions("0.17").get("canRollback");
        assertThat(rollbackOptions.get("dev")).isEqualTo(true);
        svc.rollback("dev");
        svc.completeDeployment("0.16", "dev", "rollback", "0.17");
        assertThat(svc.environments()).containsEntry("dev", "0.16");
        assertThat(jenkins.triggers).contains("dev@0.16");
    }

    @Test
    void editDevForksNewVersionLeavingPromotedImmutable() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        deploySucceeded(svc, "0.16");
        promoteSucceeded(svc, "0.16", "qa", "dev");

        HelmRelease forked = editSucceeded(svc, sampleRelease("ignored"));

        assertThat(forked.getVersion()).isEqualTo("0.17");
        assertThat(svc.environments()).containsEntry("dev", "0.17").containsEntry("qa", "0.16");
        assertThat(svc.versions()).contains("0.16", "0.17");
        // promoted version 0.16 is untouched
        assertThat(svc.version("0.16").getVersion()).isEqualTo("0.16");
    }

    @Test
    void devEditsNeverAutoPromoteAndPromotionIsManual() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());

        // 1. Create 0.0.1 and deploy it to DEV.
        svc.createVersion(sampleRelease("0.0.1"));
        deploySucceeded(svc, "0.0.1");

        // 2-3. Iterate in DEV (bug fixes): 0.0.1 -> 0.0.2 -> 0.0.3 -> 0.0.4 -> 0.0.5. None of these
        // edits may move a version to QA/INTEGRATION/PROD — only DEV ever holds a version.
        editSucceeded(svc, sampleRelease("ignored")); // 0.0.2
        editSucceeded(svc, sampleRelease("ignored")); // 0.0.3
        editSucceeded(svc, sampleRelease("ignored")); // 0.0.4
        editSucceeded(svc, sampleRelease("ignored")); // 0.0.5
        assertThat(svc.environments()).containsEntry("dev", "0.0.5").hasSize(1);

        // 4. After DEV qualification, MANUALLY promote 0.0.5 to QA.
        promoteSucceeded(svc, "0.0.5", "qa", "dev");
        assertThat(svc.environments()).containsEntry("dev", "0.0.5").containsEntry("qa", "0.0.5");

        // 5. QA finds a bug -> edit creates 0.0.6 and deploys to DEV ONLY; QA still runs 0.0.5
        // (no automatic promotion just because a new version was created).
        editSucceeded(svc, sampleRelease("ignored")); // 0.0.6 onto DEV
        assertThat(svc.environments())
                .containsEntry("dev", "0.0.6")
                .containsEntry("qa", "0.0.5");

        // After DEV testing passes, MANUALLY promote 0.0.6 to QA -> it replaces 0.0.5.
        promoteSucceeded(svc, "0.0.6", "qa", "dev");
        assertThat(svc.environments())
                .containsEntry("dev", "0.0.6")
                .containsEntry("qa", "0.0.6");

        // Previous versions remain in each environment's deployment history (for rollback), and
        // each environment's history is independent.
        GitStateService fresh = new GitStateService(
                remoteUri, tmp.resolve("verify-clone").toString(), "main", "user", "");
        assertThat(fresh.readEnvironmentHistory("dev"))
                .containsExactly("0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5", "0.0.6");
        assertThat(fresh.readEnvironmentHistory("qa")).containsExactly("0.0.5", "0.0.6");
    }

    @Test
    void nextTargetAdvancesForwardFromFurthestStage() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        deploySucceeded(svc, "0.16");
        promoteSucceeded(svc, "0.16", "qa", "dev");
        editSucceeded(svc, sampleRelease("ignored")); // forks 0.17 onto dev -> dev=0.17, qa=0.16

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
        deploySucceeded(svc, "0.16");
        promoteSucceeded(svc, "0.16", "qa", "dev");
        editSucceeded(svc, sampleRelease("ignored")); // dev=0.17, qa=0.16

        promoteSucceeded(svc, "0.16", "integration", "qa"); // older version races ahead: qa -> integration
        promoteSucceeded(svc, "0.17", "qa", "dev");         // newer version trails: dev -> qa, replacing 0.16

        assertThat(svc.environments())
                .containsEntry("integration", "0.16")
                .containsEntry("qa", "0.17");

        // qa held 0.16 then 0.17 -> one-step rollback target is preserved.
        GitStateService fresh = new GitStateService(
                remoteUri, tmp.resolve("verify-clone").toString(), "main", "user", "");
        assertThat(fresh.readEnvironmentHistory("qa")).containsExactly("0.16", "0.17");
    }

    @Test
    void deleteVersionUninstallsClearsPointersKeepsDeploymentHistoryAndRemovesFile() {
        RecordingJenkins jenkins = new RecordingJenkins();
        CatalogPlatformService svc = newPlatform(jenkins);
        svc.createVersion(sampleRelease("0.16"));
        deploySucceeded(svc, "0.16");
        promoteSucceeded(svc, "0.16", "qa", "dev"); // 0.16 live in dev AND qa

        svc.deleteVersion("0.16");

        assertThat(svc.environments()).doesNotContainKeys("dev", "qa");
        assertThat(svc.versions()).doesNotContain("0.16");
        assertThat(jenkins.actions).contains("uninstall:dev:0.16", "uninstall:qa:0.16");
        assertThat(svc.history()).extracting(e -> e.get("action")).contains("uninstall", "delete");
        GitStateService fresh = new GitStateService(
                remoteUri, tmp.resolve("verify-delete-history-clone").toString(), "main", "user", "");
        assertThat(fresh.readEnvironmentHistory("dev")).containsExactly("0.16");
        assertThat(fresh.readEnvironmentHistory("qa")).containsExactly("0.16");
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
        deploySucceeded(svc, "0.16");

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

    @Test
    void clearHistoryClearsOnlyDeploymentEventLog() {
        CatalogPlatformService svc = newPlatform(new RecordingJenkins());
        svc.createVersion(sampleRelease("0.16"));
        deploySucceeded(svc, "0.16");

        assertThat(svc.history()).isNotEmpty();
        svc.clearHistory();

        assertThat(svc.history()).isEmpty();
        GitStateService fresh = new GitStateService(
                remoteUri, tmp.resolve("verify-clone").toString(), "main", "user", "");
        assertThat(fresh.readEnvironmentHistory("dev")).containsExactly("0.16");
        assertThat(fresh.readEnvironmentVersion("dev")).isEqualTo("0.16");
    }

    // ---------- helpers / stubs ----------

    private CatalogPlatformService newPlatform(RecordingJenkins jenkins) {
        GitStateService gitState = new GitStateService(
                remoteUri, tmp.resolve("state-clone").toString(), "main", "user", "");
        return new CatalogPlatformService(gitState, new NoopGitOps(), jenkins, new PromotionProperties());
    }

    private void deploySucceeded(CatalogPlatformService svc, String version) {
        svc.deployToDev(version);
        svc.completeDeployment(version, "dev", "deploy", null);
    }

    private void promoteSucceeded(CatalogPlatformService svc, String version, String env, String fromEnv) {
        svc.promote(version, env);
        svc.completeDeployment(version, env, "promote", fromEnv);
    }

    private HelmRelease editSucceeded(CatalogPlatformService svc, HelmRelease edited) {
        String currentDev = svc.environments().get("dev");
        HelmRelease forked = svc.editDev(edited);
        svc.completeDeployment(forked.getVersion(), "dev", "edit", currentDev);
        return forked;
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
        final List<String> deployEvents = new ArrayList<>();

        RecordingJenkins() {
            super("user", "token", "http://localhost:8080", "job");
        }

        @Override
        public void trigger(String cluster, String action, String chartVersion, String valuesFile) {
            trigger(cluster, action, chartVersion, valuesFile, "", "");
        }

        @Override
        public void trigger(String cluster, String action, String chartVersion, String valuesFile,
                            String deployEventAction, String fromVersion) {
            triggers.add(cluster + "@" + chartVersion);
            actions.add(action + ":" + cluster + ":" + chartVersion);
            if (deployEventAction != null && !deployEventAction.isBlank()) {
                deployEvents.add(deployEventAction + ":" + cluster + ":" + chartVersion + ":"
                        + (fromVersion == null ? "" : fromVersion));
            }
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
