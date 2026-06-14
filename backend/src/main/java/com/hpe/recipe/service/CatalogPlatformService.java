package com.hpe.recipe.service;

import com.hpe.recipe.config.PromotionProperties;
import com.hpe.recipe.model.HelmRelease;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Git-backed catalog platform: orchestrates the write operations (create, deploy-to-dev,
 * promote, rollback, dev-fork-on-edit) and the derived reads, using {@link GitStateService}
 * as the source of truth, {@link GitOpsService} to render the per-deploy Helm values file
 * (with the destination env's target_cluster), and {@link JenkinsService} to trigger the deploy.
 *
 * <p>Version ids are normalized to the unprefixed form (e.g. "0.16") so the rendered
 * {@code values-v<version>.yaml} and the Jenkins {@code CHART_VERSION} stay consistent with the
 * Jenkinsfile. The frontend may display them with a leading "v".
 *
 * <p>Self-contained: it does not depend on the legacy {@code HelmReleaseService}/ConfigMap path,
 * which keeps working until the frontend cutover repoints reads to these endpoints.
 */
@Service
public class CatalogPlatformService {

    private static final Logger log = LoggerFactory.getLogger(CatalogPlatformService.class);

    private final GitStateService gitState;
    private final GitOpsService gitOps;
    private final JenkinsService jenkins;
    private final PromotionProperties promotionProperties;

    public CatalogPlatformService(GitStateService gitState, GitOpsService gitOps,
                                  JenkinsService jenkins, PromotionProperties promotionProperties) {
        this.gitState = gitState;
        this.gitOps = gitOps;
        this.jenkins = jenkins;
        this.promotionProperties = promotionProperties;
    }

    // ===================== READS =====================

    public List<String> pipeline() {
        return promotionProperties.getPipeline();
    }

    public Map<String, String> environments() {
        return gitState.readAllEnvironments();
    }

    public List<String> versions() {
        return gitState.listVersions();
    }

    public List<Map<String, Object>> history() {
        return gitState.readHistory();
    }

    public HelmRelease version(String version) {
        return gitState.readVersion(normalize(version));
    }

    public boolean isEmpty() {
        return versions().isEmpty();
    }

    /** Per-version promotion view: where it's live, allowed forward targets, and rollback availability. */
    public Map<String, Object> promotionOptions(String version) {
        String v = normalize(version);
        List<String> pipeline = pipeline();
        Map<String, String> envs = gitState.readAllEnvironments();

        Map<String, Boolean> deployedOn = new LinkedHashMap<>();
        Map<String, String> activeVersions = new LinkedHashMap<>();
        Map<String, Boolean> canRollback = new LinkedHashMap<>();
        for (int i = 0; i < pipeline.size(); i++) {
            String env = pipeline.get(i);
            String active = envs.get(env);
            activeVersions.put(env, active != null ? active : "");
            deployedOn.put(env, v.equals(active));
            canRollback.put(env, i > 0 && gitState.readEnvironmentHistory(env).size() >= 2);
        }

        // Forward-only: a version advances from the FURTHEST stage it currently occupies, one
        // stage at a time. It never moves back to an earlier stage it has already left, and an
        // undeployed version has no promotion target (deploying it to the first stage is a
        // separate deploy-to-dev action, not a promotion).
        int furthest = furthestStageIndex(v, envs, pipeline);
        String nextTarget = (furthest >= 0 && furthest < pipeline.size() - 1)
                ? pipeline.get(furthest + 1)
                : null;
        List<String> allowedTargets = new ArrayList<>();
        if (nextTarget != null) {
            allowedTargets.add(nextTarget);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("pipeline", pipeline);
        result.put("deployedOn", deployedOn);
        result.put("activeVersionOnCluster", activeVersions);
        result.put("allowedTargets", allowedTargets);
        if (nextTarget != null) {
            result.put("nextTarget", nextTarget);
        }
        result.put("canRollback", canRollback);
        return result;
    }

    /** Highest pipeline index where {@code v} is the active version, or -1 if deployed nowhere. */
    private static int furthestStageIndex(String v, Map<String, String> envs, List<String> pipeline) {
        int furthest = -1;
        for (int i = 0; i < pipeline.size(); i++) {
            if (v.equals(envs.get(pipeline.get(i)))) {
                furthest = i;
            }
        }
        return furthest;
    }

    // ===================== WRITES =====================

    /** Bootstrap a brand-new catalog version. Only allowed when no version exists anywhere. */
    public HelmRelease createVersion(HelmRelease release) {
        if (release == null) {
            throw new IllegalArgumentException("Release body is required");
        }
        if (!versions().isEmpty()) {
            throw new IllegalStateException(
                    "Create is only available on an empty system; a catalog version already exists "
                            + "(use Edit on dev to fork a new version)");
        }
        String version = normalize(release.getVersion());
        release.setVersion(version);
        gitState.writeVersion(release);
        appendEvent("create", version, null, null);
        return gitState.readVersion(version);
    }

    /** Deploy an existing version to the first stage (dev) and trigger Jenkins. */
    public void deployToDev(String version) {
        String v = requireExistingVersion(version);
        String dev = pipeline().get(0);
        gitState.setEnvironmentVersion(dev, v);
        gitState.appendEnvironmentHistory(dev, v);
        appendEvent("deploy", v, dev, null);
        renderAndTrigger(v, dev);
    }

    /** Promote a version forward to the immediately next stage (rejects skips). */
    public void promote(String version, String toEnv) {
        String v = normalize(version);
        List<String> pipeline = pipeline();
        int idx = pipeline.indexOf(toEnv);
        if (idx < 0) {
            throw new IllegalStateException("Unknown environment: " + toEnv);
        }
        if (idx == 0) {
            throw new IllegalStateException("Cannot promote to " + toEnv.toUpperCase()
                    + " (it is the first stage; deploy to it directly)");
        }
        String prev = pipeline.get(idx - 1);
        if (!v.equals(gitState.readEnvironmentVersion(prev))) {
            throw new IllegalStateException("Version " + v + " must be active on " + prev.toUpperCase()
                    + " before promoting to " + toEnv.toUpperCase()
                    + " (pipeline: " + String.join(" → ", pipeline) + ")");
        }
        gitState.setEnvironmentVersion(toEnv, v);
        gitState.appendEnvironmentHistory(toEnv, v);
        appendEvent("promote", v, toEnv, prev);
        renderAndTrigger(v, toEnv);
    }

    /** Roll an environment back one step to the previous version it held, and redeploy it. */
    public void rollback(String env) {
        List<String> pipeline = pipeline();
        int idx = pipeline.indexOf(env);
        if (idx < 0) {
            throw new IllegalStateException("Unknown environment: " + env);
        }
        if (idx == 0) {
            throw new IllegalStateException("Rollback is not available on " + env.toUpperCase()
                    + " (it is edit-only; there is no previous promotion to undo)");
        }
        List<String> hist = gitState.readEnvironmentHistory(env);
        if (hist.size() < 2) {
            throw new IllegalStateException("No previous version to roll back to on " + env.toUpperCase());
        }
        String current = hist.get(hist.size() - 1);
        String previous = hist.get(hist.size() - 2);

        gitState.setEnvironmentVersion(env, previous);
        gitState.setEnvironmentHistory(env, new ArrayList<>(hist.subList(0, hist.size() - 1)));
        appendEvent("rollback", previous, env, current);
        renderAndTrigger(previous, env);
    }

    /**
     * DEV-only editing: forks a NEW version (auto patch bump) from the current dev catalog plus
     * the supplied edited content, sets dev to it, and deploys. Promoted versions are never
     * mutated because every edit creates a new version.
     */
    public HelmRelease editDev(HelmRelease edited) {
        if (edited == null) {
            throw new IllegalArgumentException("Edited catalog body is required");
        }
        String dev = pipeline().get(0);
        String currentDev = gitState.readEnvironmentVersion(dev);
        if (currentDev == null || currentDev.isBlank()) {
            throw new IllegalStateException("Nothing to edit: dev has no deployed catalog version yet");
        }
        String newVersion = nextPatchVersion(currentDev, new HashSet<>(versions()));
        edited.setVersion(newVersion);
        gitState.writeVersion(edited);
        gitState.setEnvironmentVersion(dev, newVersion);
        gitState.appendEnvironmentHistory(dev, newVersion);
        appendEvent("edit", newVersion, dev, currentDev);
        renderAndTrigger(newVersion, dev);
        return gitState.readVersion(newVersion);
    }

    /**
     * Delete a catalog version coherently with Git AND the cluster: helm-uninstall it from EVERY
     * environment currently running it (a version can be live in several at once), clear those env
     * pointers, scrub the version from every environment history (so rollback can't target it),
     * remove the version definition file, and log the events. Idempotent: deleting an unknown
     * version is a no-op. After deleting the last version the system is empty again.
     */
    public void deleteVersion(String version) {
        String v = normalize(version);
        boolean versionFileExists = gitState.versionExists(v); // validateId guards traversal/blank
        Map<String, String> envs = gitState.readAllEnvironments();

        // Every environment currently running this version (multi-version-in-flight safe).
        List<String> affected = new ArrayList<>();
        for (Map.Entry<String, String> e : envs.entrySet()) {
            if (v.equals(e.getValue())) {
                affected.add(e.getKey());
            }
        }

        if (affected.isEmpty() && !versionFileExists) {
            return; // nothing to delete
        }

        // 1. Uninstall from each environment running it, then clear its pointer + history.
        for (String env : affected) {
            try {
                jenkins.trigger(env, "uninstall", v, null);
            } catch (Exception e) {
                throw new RuntimeException("Failed to trigger uninstall of " + v + " on " + env
                        + ": " + e.getMessage(), e);
            }
            gitState.deleteEnvironment(env);
            gitState.setEnvironmentHistory(env, new ArrayList<>()); // env is now empty
            appendEvent("uninstall", v, env, null);
        }

        // 2. Scrub the version from any other environment's history (rollback can't point at it).
        for (String env : pipeline()) {
            if (affected.contains(env)) {
                continue;
            }
            List<String> hist = gitState.readEnvironmentHistory(env);
            if (hist.contains(v)) {
                List<String> trimmed = new ArrayList<>();
                for (String h : hist) {
                    if (!v.equals(h)) {
                        trimmed.add(h);
                    }
                }
                gitState.setEnvironmentHistory(env, trimmed);
            }
        }

        // 3. Remove the version definition file, then record the delete.
        if (versionFileExists) {
            gitState.deleteVersion(v);
        }
        appendEvent("delete", v, null, null);
    }

    // ===================== INTERNALS =====================

    /**
     * Render the chart values file for the destination env (target_cluster = env) and trigger
     * Jenkins. Reuses GitOpsService.generateAndPush so the values-v&lt;version&gt;.yaml the
     * Jenkinsfile reads is (re)written for this env — this is what makes rollback a real redeploy.
     */
    private void renderAndTrigger(String version, String env) {
        HelmRelease release = gitState.readVersion(version);
        if (release == null) {
            throw new IllegalStateException("Version not found in Git: " + version);
        }
        release.setCluster(env);
        release.setReleaseName(HelmReleaseService.helmReleaseNameForCluster(env));
        release.setStatus("deploying");
        try {
            String valuesFile = gitOps.resolveValuesFileName(release);
            gitOps.generateAndPush(release);
            jenkins.trigger(env, "deploy", release.getVersion(), valuesFile);
        } catch (Exception e) {
            throw new RuntimeException("Failed to deploy " + version + " to " + env + ": " + e.getMessage(), e);
        }
    }

    private void appendEvent(String action, String version, String env, String fromVersion) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("timestamp", Instant.now().toString());
        event.put("action", action);
        event.put("version", version);
        if (env != null) {
            event.put("env", env);
        }
        if (fromVersion != null) {
            event.put("fromVersion", fromVersion);
        }
        gitState.appendHistoryEvent(event);
    }

    private String requireExistingVersion(String version) {
        String v = normalize(version);
        if (!gitState.versionExists(v)) {
            throw new IllegalStateException("Version does not exist: " + v);
        }
        return v;
    }

    private static String normalize(String version) {
        String v = RecipeDataMapper.normalizeVersion(version);
        if (v == null || v.isBlank()) {
            throw new IllegalArgumentException("version must not be blank");
        }
        return v;
    }

    private String nextPatchVersion(String current, Set<String> existing) {
        String candidate = bumpLast(normalize(current));
        while (existing.contains(candidate)) {
            candidate = bumpLast(candidate);
        }
        return candidate;
    }

    private static String bumpLast(String version) {
        String[] parts = version.split("\\.");
        if (parts.length == 0) {
            return version + ".1";
        }
        String last = parts[parts.length - 1];
        try {
            int n = Integer.parseInt(last);
            parts[parts.length - 1] = String.valueOf(n + 1);
            return String.join(".", parts);
        } catch (NumberFormatException e) {
            return version + ".1";
        }
    }
}
