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

/**
 * Verifies the read cutover: {@link HelmReleaseService} reports deployment state from Git, not
 * from in-memory drafts or ConfigMaps. A fresh service over a fresh clone still sees the same
 * state, proving Git is authoritative (survives a backend restart / wiped ConfigMaps).
 */
class HelmReleaseServiceTest {

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

    private GitStateService gitState(String clone) {
        return new GitStateService(remoteUri, tmp.resolve(clone).toString(), "main", "user", "");
    }

    private HelmReleaseService service(GitStateService gs) {
        return new HelmReleaseService(Map.of(), new PromotionProperties(), gs);
    }

    @Test
    void reportsDeploymentStateFromGit() {
        GitStateService gs = gitState("clone-a");
        gs.writeVersion(sampleRelease("0.16"));
        gs.writeVersion(sampleRelease("0.17"));
        gs.setEnvironmentVersion("dev", "0.16");

        HelmReleaseService svc = service(gs);

        assertThat(svc.getActiveDeployedCatalog("dev"))
                .get().extracting(HelmRelease::getVersion).isEqualTo("0.16");
        assertThat(svc.getActiveDeployedCatalog("qa")).isEmpty();

        assertThat(svc.getDeployedFromCluster("dev", "0.16")).isNotNull();
        assertThat(svc.getDeployedFromCluster("dev", "0.17")).isNull();

        // version definitions are global, independent of any cluster
        assertThat(svc.getHelmRelease("qa", "0.17")).isNotNull();

        List<HelmRelease> all = svc.getAllHelmReleases("dev");
        assertThat(all).extracting(HelmRelease::getVersion).containsExactly("0.16", "0.17");
        assertThat(all).filteredOn(r -> r.getVersion().equals("0.16"))
                .singleElement().extracting(HelmRelease::getStatus).isEqualTo("deployed");
        assertThat(all).filteredOn(r -> r.getVersion().equals("0.17"))
                .singleElement().extracting(HelmRelease::getStatus).isEqualTo("available");
    }

    @Test
    void stateSurvivesRestart() {
        GitStateService gs = gitState("clone-a");
        gs.writeVersion(sampleRelease("0.16"));
        gs.setEnvironmentVersion("qa", "0.16");

        // brand-new service over a brand-new clone — simulates a backend restart / wiped ConfigMaps
        HelmReleaseService fresh = service(gitState("clone-b"));
        assertThat(fresh.getActiveDeployedCatalog("qa"))
                .get().extracting(HelmRelease::getVersion).isEqualTo("0.16");
        assertThat(fresh.getLatestDeployedVersion("qa")).contains("0.16");
    }

    @Test
    void diffComparesVersionsReadFromGit() {
        GitStateService gs = gitState("clone-a");
        gs.writeVersion(sampleRelease("0.16"));
        HelmRelease v17 = sampleRelease("0.17");
        v17.getRecipes().get(0).getComponents().get("spark").setVersion("3.6.0");
        gs.writeVersion(v17);

        HelmReleaseService svc = service(gs);
        Map<String, Object> diff = svc.getUpgradePathsBetweenHelmVersions("dev", "0.16", "0.17");

        assertThat(diff).containsKey("recipesChanged");
        // spark changed 3.5.0 -> 3.6.0 within recipe 1.0.0, sourced from the Git version files
        assertThat(diff.get("recipesChanged").toString()).contains("3.6.0");
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
