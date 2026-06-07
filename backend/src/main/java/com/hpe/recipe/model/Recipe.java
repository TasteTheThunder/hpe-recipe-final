package com.hpe.recipe.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;

public class Recipe {

    private String version;
    private String description;
    @JsonProperty("release_date")
    private String releaseDate;
    private String status;
    @JsonProperty("release_notes")
    private String releaseNotes;
    private Map<String, ComponentSpec> components;
    @JsonProperty("upgrade_to")
    @JsonAlias({"upgradePaths", "upgradeTo", "upgrade_to"})
    private List<String> upgradeTo;
    @JsonProperty("upgrade_from")
    @JsonAlias({"upgradeFrom", "upgrade_from"})
    private List<String> upgradeFrom;

    public Recipe() {}

    public Recipe(String version, String description, Map<String, ComponentSpec> components, List<String> upgradeTo,
                  List<String> upgradeFrom) {
        this.version = version;
        this.description = description;
        this.components = components;
        this.upgradeTo = upgradeTo;
        this.upgradeFrom = upgradeFrom;
    }

    public Recipe(String version, String description, String releaseDate, String status, String releaseNotes,
                  Map<String, ComponentSpec> components, List<String> upgradeTo, List<String> upgradeFrom) {
        this.version = version;
        this.description = description;
        this.releaseDate = releaseDate;
        this.status = status;
        this.releaseNotes = releaseNotes;
        this.components = components;
        this.upgradeTo = upgradeTo;
        this.upgradeFrom = upgradeFrom;
    }

    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getReleaseDate() { return releaseDate; }
    public void setReleaseDate(String releaseDate) { this.releaseDate = releaseDate; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getReleaseNotes() { return releaseNotes; }
    public void setReleaseNotes(String releaseNotes) { this.releaseNotes = releaseNotes; }

    public Map<String, ComponentSpec> getComponents() { return components; }
    public void setComponents(Map<String, ComponentSpec> components) { this.components = components; }

    public List<String> getUpgradeTo() { return upgradeTo; }
    public void setUpgradeTo(List<String> upgradeTo) { this.upgradeTo = upgradeTo; }

    public List<String> getUpgradeFrom() { return upgradeFrom; }
    public void setUpgradeFrom(List<String> upgradeFrom) { this.upgradeFrom = upgradeFrom; }

}
