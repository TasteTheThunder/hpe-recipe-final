package com.hpe.recipe.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.ArrayList;
import java.util.List;

public class ComponentSpec {

    private String version;

    @JsonProperty("release_date")
    private String releaseDate;

    @JsonProperty("upgrade_from")
    private List<String> upgradeFrom;

    @JsonProperty("upgrade_to")
    private List<String> upgradeTo;

    public ComponentSpec() {
        this.upgradeFrom = new ArrayList<>();
        this.upgradeTo = new ArrayList<>();
    }

    public ComponentSpec(String version, List<String> upgradeFrom, List<String> upgradeTo) {
        this.version = version;
        this.upgradeFrom = upgradeFrom != null ? new ArrayList<>(upgradeFrom) : new ArrayList<>();
        this.upgradeTo = upgradeTo != null ? new ArrayList<>(upgradeTo) : new ArrayList<>();
    }

    public ComponentSpec(String version, String releaseDate, List<String> upgradeFrom, List<String> upgradeTo) {
        this.version = version;
        this.releaseDate = releaseDate;
        this.upgradeFrom = upgradeFrom != null ? new ArrayList<>(upgradeFrom) : new ArrayList<>();
        this.upgradeTo = upgradeTo != null ? new ArrayList<>(upgradeTo) : new ArrayList<>();
    }

    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }

    public String getReleaseDate() { return releaseDate; }
    public void setReleaseDate(String releaseDate) { this.releaseDate = releaseDate; }

    public List<String> getUpgradeFrom() { return upgradeFrom; }
    public void setUpgradeFrom(List<String> upgradeFrom) { this.upgradeFrom = upgradeFrom; }

    public List<String> getUpgradeTo() { return upgradeTo; }
    public void setUpgradeTo(List<String> upgradeTo) { this.upgradeTo = upgradeTo; }
}
