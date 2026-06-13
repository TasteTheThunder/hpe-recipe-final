package com.hpe.recipe.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Base64;
import java.util.Map;

/**
 * Reusable Jenkins deploy trigger — extracted so deploy/promote/rollback can all reuse the
 * existing buildWithParameters + crumb/Basic-auth mechanism (CLUSTER/ACTION/ALLOW_DEPLOY/
 * CHART_VERSION/VALUES_FILE).
 *
 * NOTE: {@code HelmReleaseController} still has its own private copy of this for the legacy
 * deploy endpoint; that copy is removed when the legacy endpoint is repointed/removed at the
 * Git cutover (cleanup, to avoid touching the working deploy path in this slice).
 */
@Service
public class JenkinsService {

    private static final Logger log = LoggerFactory.getLogger(JenkinsService.class);

    private final String jenkinsUser;
    private final String jenkinsToken;
    private final String jenkinsUrl;
    private final String jenkinsJob;

    public JenkinsService(
            @Value("${jenkins.username}") String jenkinsUser,
            @Value("${jenkins.token}") String jenkinsToken,
            @Value("${jenkins.url}") String jenkinsUrl,
            @Value("${jenkins.job}") String jenkinsJob) {
        this.jenkinsUser = jenkinsUser;
        this.jenkinsToken = jenkinsToken;
        this.jenkinsUrl = jenkinsUrl;
        this.jenkinsJob = jenkinsJob;
    }

    /** Trigger the Jenkins deploy job for {@code cluster} at {@code chartVersion}. */
    public void trigger(String cluster, String action, String chartVersion, String valuesFile) {
        if (!StringUtils.hasText(jenkinsUser) || !StringUtils.hasText(jenkinsToken)) {
            throw new IllegalStateException("Jenkins credentials are not configured (JENKINS_USER/JENKINS_TOKEN)");
        }

        try {
            RestTemplate restTemplate = new RestTemplate();

            String auth = jenkinsUser + ":" + jenkinsToken;
            String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes());

            String crumbUrl = jenkinsUrl + "/crumbIssuer/api/json";
            HttpHeaders crumbHeaders = new HttpHeaders();
            crumbHeaders.set("Authorization", "Basic " + encodedAuth);
            HttpEntity<String> crumbRequest = new HttpEntity<>(crumbHeaders);

            ResponseEntity<Map> crumbResponse = restTemplate.exchange(
                    crumbUrl, HttpMethod.GET, crumbRequest, Map.class);

            String crumb = (String) crumbResponse.getBody().get("crumb");
            String crumbField = (String) crumbResponse.getBody().get("crumbRequestField");
            log.info("Fetched Jenkins crumb");

            UriComponentsBuilder urlBuilder = UriComponentsBuilder
                    .fromHttpUrl(jenkinsUrl)
                    .pathSegment("job", jenkinsJob, "buildWithParameters")
                    .queryParam("CLUSTER", cluster)
                    .queryParam("ACTION", action)
                    .queryParam("ALLOW_DEPLOY", "yes");

            if (StringUtils.hasText(chartVersion)) {
                urlBuilder.queryParam("CHART_VERSION", chartVersion);
            }
            if (StringUtils.hasText(valuesFile)) {
                urlBuilder.queryParam("VALUES_FILE", valuesFile);
            }

            String url = urlBuilder.toUriString();
            log.info("Triggering Jenkins URL: {}", url);

            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Basic " + encodedAuth);
            headers.set(crumbField, crumb);
            HttpEntity<String> request = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    url, HttpMethod.POST, request, String.class);

            if (!(response.getStatusCode().is2xxSuccessful() || response.getStatusCode().is3xxRedirection())) {
                log.error("Jenkins trigger failed: {}", response.getBody());
                throw new RuntimeException("Jenkins trigger failed: " + response.getStatusCode());
            }

            log.info("Jenkins triggered for cluster={} status={}", cluster, response.getStatusCode().value());

        } catch (Exception e) {
            log.error("Error triggering Jenkins", e);
            throw new RuntimeException("Failed to trigger Jenkins", e);
        }
    }
}
